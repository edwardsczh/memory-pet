//! OpenAI-compatible `/chat/completions` client.
//!
//! The API key is kept in the vault's `secrets` namespace and only ever read
//! here; it is never returned to the webview or written to logs or errors.

use std::time::{Duration, Instant};

use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::State;
use tauri::ipc::Channel;

use crate::vault::{self, SECRETS_NS, SharedVault, Vault, VaultError};

const SETTINGS_NS: &str = "settings";
const SETTINGS_KEY: &str = "llm";
const API_KEY_KEY: &str = "llm-api-key";
const DEFAULT_BASE_URL: &str = "https://api.deepseek.com/v1";
const DEFAULT_MODEL: &str = "deepseek-chat";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Max silence between bytes; also bounds a stalled stream.
const READ_TIMEOUT: Duration = Duration::from_secs(60);
const COMPLETE_TIMEOUT: Duration = Duration::from_secs(120);
const TEST_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_ERROR_DETAIL: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: Role,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRequest {
    pub messages: Vec<LlmMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub json: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettings {
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSettings {
    base_url: String,
    model: String,
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.into(),
            model: DEFAULT_MODEL.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmTestResult {
    pub ok: bool,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum StreamEvent {
    Delta(String),
    /// Sent last so the webview knows every delta has been delivered.
    Done,
}

/// Resolved connection settings. Deliberately not `Debug`: it holds the API key.
struct Endpoint {
    url: Url,
    model: String,
    api_key: Option<String>,
}

pub struct LlmService {
    client: Client,
}

impl LlmService {
    pub fn new() -> Self {
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .user_agent(concat!("memory-pet/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("static reqwest config is valid");
        Self { client }
    }

    async fn send(
        &self,
        endpoint: &Endpoint,
        body: &Value,
        timeout: Option<Duration>,
    ) -> Result<reqwest::Response, String> {
        let mut request = self.client.post(endpoint.url.clone()).json(body);
        if let Some(key) = &endpoint.api_key {
            request = request.bearer_auth(key);
        }
        if let Some(timeout) = timeout {
            request = request.timeout(timeout);
        }
        let response = request
            .send()
            .await
            .map_err(|err| describe_transport(&err, &endpoint.url))?;
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let body = response.text().await.unwrap_or_default();
        Err(describe_status(status, provider_message(&body)))
    }

    async fn complete(
        &self,
        endpoint: &Endpoint,
        req: &LlmRequest,
        timeout: Duration,
    ) -> Result<String, String> {
        let body = request_body(&endpoint.model, req, false);
        let response = self.send(endpoint, &body, Some(timeout)).await?;
        let value: Value = response
            .json()
            .await
            .map_err(|err| describe_transport(&err, &endpoint.url))?;
        message_content(&value)
    }

    async fn stream(
        &self,
        endpoint: &Endpoint,
        req: &LlmRequest,
        channel: &Channel<StreamEvent>,
    ) -> Result<String, String> {
        let body = request_body(&endpoint.model, req, true);
        let mut response = self.send(endpoint, &body, None).await?;
        let send = |event| {
            channel
                .send(event)
                .map_err(|err| format!("推送流式结果失败：{err}"))
        };

        let is_sse = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/event-stream"));
        if !is_sse {
            // Some servers ignore `stream: true` and answer with a plain completion.
            let value: Value = response
                .json()
                .await
                .map_err(|err| describe_transport(&err, &endpoint.url))?;
            let text = message_content(&value)?;
            send(StreamEvent::Delta(text.clone()))?;
            send(StreamEvent::Done)?;
            return Ok(text);
        }

        let mut parser = SseParser::default();
        let mut full = String::new();
        'read: while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|err| describe_transport(&err, &endpoint.url))?
        {
            for item in parser.push(&chunk) {
                match item {
                    SseItem::Delta(text) => {
                        full.push_str(&text);
                        send(StreamEvent::Delta(text))?;
                    }
                    SseItem::Error(msg) => return Err(format!("模型服务返回错误：{msg}")),
                    SseItem::Done => break 'read,
                }
            }
        }
        send(StreamEvent::Done)?;
        Ok(full)
    }
}

fn request_body(model: &str, req: &LlmRequest, stream: bool) -> Value {
    let mut body = json!({
        "model": model,
        "messages": req.messages,
        "stream": stream,
    });
    if let Some(t) = req.temperature {
        body["temperature"] = json!(t);
    }
    if let Some(n) = req.max_tokens {
        body["max_tokens"] = json!(n);
    }
    if req.json {
        body["response_format"] = json!({ "type": "json_object" });
    }
    body
}

fn message_content(value: &Value) -> Result<String, String> {
    value["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "模型服务返回了无法识别的响应".into())
}

fn provider_message(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let msg = value["error"]["message"]
        .as_str()
        .or_else(|| value["error"].as_str())
        .or_else(|| value["message"].as_str())?;
    Some(truncate(msg.trim(), MAX_ERROR_DETAIL))
}

fn describe_status(status: StatusCode, detail: Option<String>) -> String {
    let code = status.as_u16();
    let base = match code {
        401 => "API Key 无效或已过期（401），请检查后重新填写".to_owned(),
        403 => "没有访问权限（403），请确认 API Key 有权使用该模型".to_owned(),
        404 => "接口或模型不存在（404），请检查 Base URL 和模型名".to_owned(),
        408 => "请求超时（408），请稍后再试".to_owned(),
        429 => "请求太频繁或账户额度不足（429），请稍后再试或检查余额".to_owned(),
        400 | 422 => format!("请求参数被拒绝（{code}），请检查模型名是否正确"),
        500..=599 => format!("模型服务暂时不可用（{code}），请稍后再试"),
        _ => format!("请求失败（{code}）"),
    };
    match detail {
        Some(detail) if !detail.is_empty() => format!("{base}。服务商返回：{detail}"),
        _ => base,
    }
}

fn describe_transport(err: &reqwest::Error, url: &Url) -> String {
    let local = is_local(url);
    if err.is_timeout() {
        "请求超时：模型服务长时间没有响应，请检查网络后重试".into()
    } else if err.is_connect() {
        let host = url.host_str().unwrap_or_default();
        if local {
            format!("无法连接到 {host}：请确认本地模型服务（如 Ollama）已经启动")
        } else {
            format!("无法连接到 {host}：请检查 Base URL、网络或代理设置")
        }
    } else if err.is_decode() || err.is_body() {
        "读取模型服务响应失败，响应可能不是 OpenAI 兼容格式".into()
    } else {
        "网络请求失败，请检查网络后重试".into()
    }
}

fn is_local(url: &Url) -> bool {
    matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    )
}

fn truncate(text: &str, max_chars: usize) -> String {
    let mut out: String = text.chars().take(max_chars).collect();
    if text.chars().count() > max_chars {
        out.push('…');
    }
    out
}

/// Normalizes a user-entered base URL; tolerates a pasted full endpoint.
fn normalize_base_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let trimmed = trimmed
        .strip_suffix("/chat/completions")
        .unwrap_or(trimmed)
        .trim_end_matches('/');
    let url = Url::parse(trimmed)
        .map_err(|_| "Base URL 格式不正确，例如 https://api.deepseek.com/v1".to_owned())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Base URL 需要以 http:// 或 https:// 开头".into());
    }
    Ok(trimmed.to_owned())
}

fn chat_url(base_url: &str) -> Result<Url, String> {
    Url::parse(&format!("{base_url}/chat/completions"))
        .map_err(|_| "Base URL 格式不正确，请在设置中修改".to_owned())
}

#[derive(Debug, PartialEq, Eq)]
enum SseItem {
    Delta(String),
    Error(String),
    Done,
}

/// Incremental parser for OpenAI-style `data: {...}` server-sent events.
#[derive(Default)]
struct SseParser {
    buf: Vec<u8>,
}

impl SseParser {
    fn push(&mut self, chunk: &[u8]) -> Vec<SseItem> {
        self.buf.extend_from_slice(chunk);
        let mut items = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line);
            let Some(data) = line.trim_end().strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                items.push(SseItem::Done);
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if !value["error"].is_null() {
                let msg = provider_message(data).unwrap_or_else(|| "未知错误".into());
                items.push(SseItem::Error(msg));
                continue;
            }
            if let Some(text) = value["choices"][0]["delta"]["content"].as_str()
                && !text.is_empty()
            {
                items.push(SseItem::Delta(text.to_owned()));
            }
        }
        items
    }
}

fn read_settings(v: &Vault) -> Result<(StoredSettings, Option<String>), VaultError> {
    let settings = match v.get(SETTINGS_NS, SETTINGS_KEY)? {
        Some(value) => serde_json::from_value(value)?,
        None => StoredSettings::default(),
    };
    let key = v
        .get(SECRETS_NS, API_KEY_KEY)?
        .and_then(|value| value.as_str().map(str::to_owned));
    Ok((settings, key))
}

async fn load_endpoint(vault: &SharedVault) -> Result<Endpoint, String> {
    let (settings, api_key) = vault::run(vault, read_settings).await?;
    let url = chat_url(&settings.base_url)?;
    if api_key.is_none() && !is_local(&url) {
        return Err("还没有填写 API Key，请先在设置中保存".into());
    }
    Ok(Endpoint {
        url,
        model: settings.model,
        api_key,
    })
}

#[tauri::command]
pub async fn llm_get_settings(vault: State<'_, SharedVault>) -> Result<LlmSettings, String> {
    let (settings, key) = vault::run(&vault, read_settings).await?;
    Ok(LlmSettings {
        base_url: settings.base_url,
        model: settings.model,
        has_key: key.is_some(),
    })
}

#[tauri::command]
pub async fn llm_save_settings(
    vault: State<'_, SharedVault>,
    base_url: String,
    model: String,
) -> Result<(), String> {
    let model = model.trim().to_owned();
    if model.is_empty() {
        return Err("模型名不能为空".into());
    }
    let settings = StoredSettings {
        base_url: normalize_base_url(&base_url)?,
        model,
    };
    let value = serde_json::to_value(settings).map_err(|err| err.to_string())?;
    vault::run(&vault, move |v| v.put(SETTINGS_NS, SETTINGS_KEY, &value)).await
}

#[tauri::command]
pub async fn llm_set_key(vault: State<'_, SharedVault>, key: String) -> Result<(), String> {
    let key = key.trim().to_owned();
    if key.is_empty() {
        return Err("API Key 不能为空".into());
    }
    if key.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("API Key 中不能包含空格或换行".into());
    }
    vault::run(&vault, move |v| {
        v.put(SECRETS_NS, API_KEY_KEY, &Value::String(key))
    })
    .await
}

#[tauri::command]
pub async fn llm_clear_key(vault: State<'_, SharedVault>) -> Result<(), String> {
    vault::run(&vault, |v| v.delete(SECRETS_NS, API_KEY_KEY)).await
}

#[tauri::command]
pub async fn llm_test(
    vault: State<'_, SharedVault>,
    llm: State<'_, LlmService>,
) -> Result<LlmTestResult, String> {
    let started = Instant::now();
    let result = match load_endpoint(&vault).await {
        Ok(endpoint) => {
            let req = LlmRequest {
                messages: vec![LlmMessage {
                    role: Role::User,
                    content: "这是一次连接测试，请只回复“连接成功”。".into(),
                }],
                temperature: Some(0.0),
                max_tokens: Some(16),
                json: false,
            };
            llm.complete(&endpoint, &req, TEST_TIMEOUT).await
        }
        Err(err) => Err(err),
    };
    let latency_ms = started.elapsed().as_millis() as u64;
    Ok(match result {
        Ok(text) => LlmTestResult {
            ok: true,
            latency_ms,
            sample: Some(truncate(text.trim(), 60)),
            error: None,
        },
        Err(err) => LlmTestResult {
            ok: false,
            latency_ms,
            sample: None,
            error: Some(err),
        },
    })
}

#[tauri::command]
pub async fn llm_complete(
    vault: State<'_, SharedVault>,
    llm: State<'_, LlmService>,
    req: LlmRequest,
) -> Result<String, String> {
    let endpoint = load_endpoint(&vault).await?;
    llm.complete(&endpoint, &req, COMPLETE_TIMEOUT).await
}

#[tauri::command]
pub async fn llm_stream(
    vault: State<'_, SharedVault>,
    llm: State<'_, LlmService>,
    req: LlmRequest,
    channel: Channel<StreamEvent>,
) -> Result<String, String> {
    let endpoint = load_endpoint(&vault).await?;
    llm.stream(&endpoint, &req, &channel).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(json: bool) -> LlmRequest {
        LlmRequest {
            messages: vec![LlmMessage {
                role: Role::System,
                content: "hi".into(),
            }],
            temperature: Some(0.5),
            max_tokens: Some(64),
            json,
        }
    }

    #[test]
    fn builds_openai_body() {
        let body = request_body("m", &req(true), true);
        assert_eq!(body["model"], "m");
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["max_tokens"], 64);
        assert_eq!(body["response_format"]["type"], "json_object");

        let plain = request_body("m", &req(false), false);
        assert!(plain.get("response_format").is_none());
    }

    #[test]
    fn parses_request_from_webview_json() {
        let req: LlmRequest = serde_json::from_value(json!({
            "messages": [{ "role": "user", "content": "x" }],
            "maxTokens": 10,
        }))
        .unwrap();
        assert_eq!(req.max_tokens, Some(10));
        assert!(!req.json);
        assert!(
            serde_json::from_value::<LlmRequest>(json!({
                "messages": [{ "role": "tool", "content": "x" }],
            }))
            .is_err()
        );
    }

    #[test]
    fn parses_sse_across_chunk_boundaries() {
        let mut parser = SseParser::default();
        let mut items = parser.push(b"data: {\"choices\":[{\"delta\":{\"content\":\"\xe4\xbd");
        assert!(items.is_empty());
        items.extend(
            parser.push(
                b"\xa0\"}}]}\r\n\r\n: keep-alive\n\ndata: {\"choices\":[{\"delta\":{}}]}\n\n",
            ),
        );
        items.extend(parser.push(
            "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\ndata: [DONE]\n\n".as_bytes(),
        ));
        assert_eq!(
            items,
            [
                SseItem::Delta("你".into()),
                SseItem::Delta("好".into()),
                SseItem::Done
            ]
        );
    }

    #[test]
    fn surfaces_errors_inside_stream() {
        let mut parser = SseParser::default();
        let items = parser.push(b"data: {\"error\":{\"message\":\"quota\"}}\n");
        assert_eq!(items, [SseItem::Error("quota".into())]);
    }

    #[test]
    fn friendly_status_messages() {
        let msg = describe_status(StatusCode::UNAUTHORIZED, Some("bad key".into()));
        assert!(msg.contains("API Key 无效") && msg.contains("bad key"));
        assert!(describe_status(StatusCode::TOO_MANY_REQUESTS, None).contains("429"));
        assert!(describe_status(StatusCode::BAD_GATEWAY, None).contains("暂时不可用"));
        assert_eq!(
            provider_message(r#"{"error":{"message":"Incorrect API key"}}"#).as_deref(),
            Some("Incorrect API key")
        );
        assert_eq!(provider_message("<html>"), None);
    }

    #[test]
    fn normalizes_base_url() {
        assert_eq!(
            normalize_base_url(" https://api.deepseek.com/v1/ ").unwrap(),
            "https://api.deepseek.com/v1"
        );
        assert_eq!(
            normalize_base_url("http://localhost:11434/v1/chat/completions").unwrap(),
            "http://localhost:11434/v1"
        );
        assert!(normalize_base_url("api.deepseek.com").is_err());
        assert!(normalize_base_url("ftp://x.com").is_err());
        assert!(is_local(&chat_url("http://127.0.0.1:1/v1").unwrap()));
        assert!(!is_local(&chat_url("https://api.openai.com/v1").unwrap()));
    }

    #[test]
    fn truncates_by_chars() {
        assert_eq!(truncate("你好世界", 2), "你好…");
        assert_eq!(truncate("ab", 5), "ab");
    }
}
