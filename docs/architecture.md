# 架构说明

本文描述当前代码结构和关键机制，随开发推进持续更新。完整产品规划见项目规划文档（P0–P4 路线图）。

## 总体结构

```
┌──────────────── 桌面应用 (Tauri 2) ─────────────────┐
│ WebView 前端（React + TypeScript，src/）             │
│  ├ 桌宠舞台：角色、气泡、命中测试                     │
│  ├ 设置窗口：模型服务商、API Key、连接测试            │
│  └（后续）聊天面板、导入向导、记忆管理                │
│ Rust 核心（src-tauri/）                              │
│  ├ 窗口：透明 / 无边框 / 置顶 / 位置记忆              │
│  ├ 点击穿透：全局光标轮询 + set_ignore_cursor_events  │
│  ├ 托盘菜单、设置窗口                                │
│  ├ 加密存储（vault）、LLM 调用（OpenAI 兼容）         │
│  └（后续）sidecar 进程管理                           │
└───────────────┬─────────────────────────────────────┘
                │ 127.0.0.1 + token（P3 起）
┌───────────────▼──────────── Python sidecar（sidecar/，预留）┐
│ 嵌入 / ASR / TTS / 语音素材处理                             │
└────────────────────────────────────────────────────────────┘
```

## 目录约定

| 路径                      | 内容                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/`                    | 前端代码。`src/pet/` 是桌宠外壳（角色、命中测试、穿透桥接）                                                               |
| `public/avatar/`          | 角色美术资源。每个角色一个子目录，当前只有占位图 `placeholder/`                                                           |
| `src-tauri/src/`          | Rust 核心。一个模块一个文件：`click_through.rs`、`window_state.rs`、`tray.rs`、`vault.rs`、`llm.rs`、`settings_window.rs` |
| `src-tauri/capabilities/` | Tauri 权限声明，前端能调用的窗口 API 都要在这里显式列出                                                                   |
| `sidecar/`                | Python 推理进程（P3-1 起实现）                                                                                            |
| `src/settings/`           | 设置窗口页面                                                                                                              |
| `scripts/`                | 开发脚本。`mock-llm-server.mjs` 是无依赖的 OpenAI 兼容 mock 服务                                                          |
| `docs/`                   | 架构与开发文档                                                                                                            |

## 按像素点击穿透

操作系统只能让**整个窗口**穿透（Tauri 的 `set_ignore_cursor_events`），并且窗口一旦穿透，WebView 就收不到任何鼠标事件，前端无法自己判断“鼠标是否回到了角色上”。因此采用“全局光标轮询 + alpha 采样”的方案（与 Project AIRI、animo-starter-kit 的思路一致）：

1. **Rust 轮询**（`click_through.rs`）：后台线程每 33ms 读取一次全局光标位置（`Window::cursor_position`，不依赖窗口是否接收事件）。
   - 光标在窗口外：直接设为穿透，并通知前端 `pet://cursor-left`。
   - 光标在窗口内：把窗口内坐标（换算成 CSS 像素）通过 `pet://cursor` 事件发给前端；坐标不变时不重复发送。
2. **前端命中测试**（`src/pet/hitTest.ts`）：用 `document.elementFromPoint` 找到光标下的元素。
   - `data-hit="alpha"` 的元素（角色图）：查它的 alpha 蒙版，像素不透明才算命中。蒙版在图片加载后按显示尺寸光栅化一次（`alphaMask.ts`）。
   - 其他带 `data-hit` 的元素（气泡、按钮等）：整个盒子都算命中。
   - 其余区域：不命中。
3. **回报**：前端只在命中状态变化时调用 `set_cursor_hit`，Rust 只在状态真正变化时才调用 `set_ignore_cursor_events`。
4. **按住时锁定**：鼠标在角色上按下后、松开前，始终保持捕获，避免光标滑到透明像素上导致 `mouseup` 落到下层应用。

新增可交互 UI 时，只需给元素加 `data-hit` 属性即可参与命中测试。

### 已知限制

- 轮询间隔 33ms，光标快速划入角色时最多有约一帧的延迟。
- Linux 依赖 X11 的输入形状（input shape）实现穿透；Wayland 下全局光标位置不可靠，Linux 开发时建议用 X11 会话（或 `GDK_BACKEND=x11`）。
- 气泡等元素出现或消失时，如果光标静止不动，命中状态要等下一次光标移动才会刷新。

## 拖动与位置记忆

- 在角色上按下并移动超过 4px 才调用 `startDragging()` 开始拖动；没有移动就松开算作点击（切换气泡）。
- 窗口 `Moved` 事件只记录最新位置，由轮询线程在位置稳定 500ms 后写入 `<app_config_dir>/window-state.json`；退出时再立即写一次。
- 启动时先定位再显示窗口（配置里 `visible: false`），避免闪烁。如果保存的位置不在任何已连接的显示器上（例如拔掉了副屏），回退到主显示器右下角。

## 托盘

托盘菜单：显示 / 隐藏桌宠、重置位置、设置…、退出。桌宠窗口不出现在任务栏（`skipTaskbar`），托盘是唯一的常驻入口。

## 多窗口与权限

- 所有窗口共用一个 Vite 入口（`index.html` → `src/main.tsx`），按窗口 label 选择页面：`pet` 渲染桌宠，`settings` 渲染 `src/settings/SettingsApp.tsx`。纯浏览器预览时用 URL 参数 `?view=settings`。
- 设置窗口（label `settings`，520×640，有边框）不在配置文件里声明，由 `settings_window::open` 按需创建；已存在时直接显示并聚焦，关闭即销毁。入口：托盘“设置…”，或前端命令 `open_settings_window`。
- `build.rs` 通过 `AppManifest::commands` 声明全部应用命令，使每个命令**默认拒绝**；`capabilities/default.json`（pet）和 `capabilities/settings.json`（settings）分别列出各窗口允许的命令。新增命令时三处都要改：`lib.rs` 的 `generate_handler!`、`build.rs` 的 `COMMANDS`、对应窗口的 capability。

## 加密本地存储（vault）

**决策：不用 SQLCipher，改用“文件级 AES-256-GCM 加密的 JSON 文档存储”。** SQLCipher 需要在三个平台上编译带加密的 SQLite（依赖 OpenSSL 或平台加密库），交叉构建和 CI 都复杂；本项目的数据量（人格卡、示例库、对话历史）用按文档存取已经足够，需要检索的部分（P2 的向量索引）再单独设计。

- 布局：`<app_data_dir>/vault/<namespace>/<key>.bin`。namespace 和 key 只允许 `[A-Za-z0-9._-]`、1–128 字符、不以 `.` 开头（防路径穿越，兼容 Windows 文件名）。
- 文件格式：`"MPV1"`（4 字节）+ 随机 nonce（12 字节）+ AES-256-GCM 密文与 tag。AAD 为 `memory-pet/vault/v1\0<ns>\0<key>`，把密文绑定到它的位置，文件被调换或改名后无法解密。写入先写 `.bin.tmp` 再原子 rename。
- 主密钥：32 字节随机数，存在系统凭据库（`keyring` crate：Windows 凭据管理器 / macOS Keychain / Linux Secret Service），服务名 `com.memorypet.app`、账户 `vault-master-key`。首次访问 vault 时才加载（可能弹出解锁提示），在阻塞线程池里执行。
- 回退：凭据库不可用（例如没有 Secret Service 的 Linux）时，生成 `<app_data_dir>/vault.key`（Unix 下权限 0600），`vault_status` 返回 `protected: false`，设置页显示“密钥未受系统保护”。之后凭据库可用时会自动把密钥迁入凭据库并删除该文件。凭据库暂时读不到、但 vault 里已有数据时直接报错，**不会**生成新密钥覆盖（否则旧数据永久无法解密）。
- `secrets` 命名空间只供 Rust 读取（目前存 LLM API Key），前端的 `vault_*` 命令拒绝访问它。
- `vault_wipe()` 不带参数时删除整个 vault 目录、密钥文件和凭据库条目。
- 前端封装 `src/core/storage/vault.ts`：Tauri 中调用命令；浏览器预览 / 测试中回退到**不加密**的 localStorage / 内存实现，名称规则与 Rust 一致。

| 命令                                                | 说明                                         |
| --------------------------------------------------- | -------------------------------------------- |
| `vault_put(ns, key, value)`                         | 写入任意 JSON                                |
| `vault_get(ns, key) -> JSON \| null`                | 不存在返回 null；损坏或密钥不匹配返回错误    |
| `vault_delete(ns, key)` / `vault_list(ns) -> key[]` | 删除不存在的文档不报错；list 按字典序        |
| `vault_wipe(ns?)`                                   | 删除一个命名空间；不传则删除全部数据与主密钥 |
| `vault_status() -> { protected }`                   | 主密钥是否在系统凭据库中                     |

## LLM 调用

- `src-tauri/src/llm.rs` 调用 OpenAI 兼容的 `<baseUrl>/chat/completions`，reqwest + rustls（不依赖 OpenSSL / native-tls）。支持非流式和 SSE 流式；`LlmRequest.json = true` 时发送 `response_format: {type: "json_object"}`。
- 设置 `{baseUrl, model}` 存 vault `settings/llm`；API Key 存 vault `secrets/llm-api-key`，永不返回给前端，不写日志，也不出现在错误信息里。本地地址（localhost / 127.0.0.1）可以不填 Key。
- 流式：`llm_stream(req, channel)` 通过 `tauri::ipc::Channel` 推送 `{event: "delta", data}`，最后推送 `{event: "done"}`；命令本身返回完整文本。前端在收到 `done` 后才 resolve，避免命令返回早于最后几条 delta。
- 超时：连接 10s；读取间隔 60s（也约束卡住的流）；非流式总超时 120s；连接测试 20s。
- 错误统一转成中文提示（401/403/404/429/5xx、超时、连不上、响应格式不对），附带服务商返回的 `error.message`（截断到 200 字）。
- 预设服务商在 `src/core/llm/presets.ts`（DeepSeek、通义千问、Kimi、智谱、OpenAI、本地 Ollama），模型名可自由填写。
- 本地联调：`node scripts/mock-llm-server.mjs --key sk-test` 启动 mock 服务（`http://127.0.0.1:11435/v1`，支持流式、JSON 模式，最后一条消息含 `[429]` / `[500]` / `[slow]` 时模拟错误或延迟）。开发模式下设置页底部有“调试：试聊”面板，可直接走 `llm_complete` / `llm_stream` 全链路。

| 命令 / 函数（`src/core/llm/tauriClient.ts`）                        | 说明                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `llm_get_settings() -> LlmSettings` / `getLlmSettings()`            | 未保存过时返回 DeepSeek 默认值                                |
| `llm_save_settings(baseUrl, model)` / `saveLlmSettings()`           | 校验并规范化 URL（去掉结尾 `/` 和误贴的 `/chat/completions`） |
| `llm_set_key(key)` / `llm_clear_key()`                              | 写入 / 删除 API Key                                           |
| `llm_test() -> {ok, latencyMs, sample?, error?}` / `testLlm()`      | 用已保存的设置发一个极小请求；服务商错误不 reject             |
| `llm_complete(req) -> string`、`llm_stream(req, channel) -> string` | 由 `createTauriLlmClient()`（实现 `LlmClient`）封装           |

## 核心模块约定（src/core/）

`src/core/model.ts` 是所有模块共享的领域模型（聊天消息、会话、风格画像、人格卡、角色与授权、对话回复、LLM 接口）。核心逻辑写成不依赖 Tauri 的纯 TypeScript，用 vitest 测试（`npm test`）；需要系统能力（加密存储、调用 LLM）的部分通过注入接口实现，测试时替换成假实现。

| 目录                 | 内容                                                               |
| -------------------- | ------------------------------------------------------------------ |
| `src/core/ingest/`   | 聊天记录解析（微信第三方导出、QQ、通用格式）、清洗、脱敏、会话切分 |
| `src/core/persona/`  | 风格画像统计、人格卡生成、示例库与检索                             |
| `src/core/dialogue/` | 提示词组装、结构化输出解析、风格后处理                             |
| `src/core/safety/`   | 危机检测、AI 身份如实回答、内容过滤、使用时长提醒                  |
| `fixtures/`          | 虚构的示例聊天数据（不含任何真实个人信息）                         |
