#!/usr/bin/env node
// Mock OpenAI-compatible `/chat/completions` server for local and CI testing. No dependencies.
//
//   node scripts/mock-llm-server.mjs [--port 11435] [--key sk-test]
//
// Base URL: http://127.0.0.1:<port>/v1. With --key (or MOCK_LLM_KEY) requests must send
// `Authorization: Bearer <key>`, otherwise 401. Magic words in the last user message:
//   [429] -> rate limited, [500] -> server error, [slow] -> 3s delay before answering.
import http from "node:http";
import process from "node:process";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const port = Number(arg("port") ?? process.env.MOCK_LLM_PORT ?? 11435);
const requiredKey = arg("key") ?? process.env.MOCK_LLM_KEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function reply(messages, json) {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (json)
    return JSON.stringify({
      messages: ["收到～", `你说的是：${last.slice(0, 20)}`],
      emotion: "happy",
    });
  if (last.includes("连接测试")) return "连接成功";
  return `（模拟回复）我听到你说“${last.slice(0, 30)}”啦，今天也要开心哦～`;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function error(res, status, message) {
  sendJson(res, status, { error: { message, type: "mock_error" } });
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  if (req.method === "GET" && req.url === "/health") return sendJson(res, 200, { ok: true });
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    return error(res, 404, `no route for ${req.method} ${req.url}`);
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return error(res, 400, "invalid JSON body");
  }

  const auth = req.headers.authorization;
  // Never log the key itself; only whether it matched.
  const authState = !auth ? "none" : requiredKey && auth !== `Bearer ${requiredKey}` ? "bad" : "ok";
  const json = body.response_format?.type === "json_object";
  console.log(
    `${new Date().toISOString()} model=${body.model} stream=${!!body.stream} json=${json} auth=${authState} messages=${body.messages?.length}`,
  );

  if (requiredKey && authState !== "ok") return error(res, 401, "Incorrect API key provided");
  if (!Array.isArray(body.messages) || !body.model)
    return error(res, 400, "model and messages are required");

  const last = body.messages.at(-1)?.content ?? "";
  if (last.includes("[429]")) return error(res, 429, "Rate limit reached");
  if (last.includes("[500]")) return error(res, 500, "Internal error");
  if (last.includes("[slow]")) await sleep(3000);

  const text = reply(body.messages, json);
  const id = `chatcmpl-mock-${started}`;
  const created = Math.floor(started / 1000);

  if (!body.stream) {
    return sendJson(res, 200, {
      id,
      object: "chat.completion",
      created,
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: text.length, total_tokens: 10 + text.length },
    });
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const event = (delta, finish = null) =>
    res.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model: body.model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`,
    );
  event({ role: "assistant", content: "" });
  res.write(": keep-alive\n\n");
  for (const piece of text.match(/.{1,3}/gsu) ?? []) {
    event({ content: piece });
    await sleep(40);
  }
  event({}, "stop");
  res.end("data: [DONE]\n\n");
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `mock LLM server on http://127.0.0.1:${port}/v1${requiredKey ? " (API key required)" : ""}`,
  );
});
