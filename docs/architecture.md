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
| `public/avatar/`          | 角色美术资源。每个角色一个子目录（`manifest.json` + `layers/` + `source/`）                                               |
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
   - `data-hit="alpha"` 的元素（角色）：查它的 alpha 蒙版，像素不透明才算命中。蒙版按元素布局尺寸光栅化（`alphaMask.ts`），查询时按元素当前包围盒缩放坐标，所以呼吸、弹跳等 CSS 变换不会让蒙版错位。
   - 其他带 `data-hit` 的元素（气泡、按钮等）：整个盒子都算命中。
   - 其余区域：不命中。
3. **回报**：前端只在命中状态变化时调用 `set_cursor_hit`，Rust 只在状态真正变化时才调用 `set_ignore_cursor_events`。
4. **按住时锁定**：鼠标在角色上按下后、松开前，始终保持捕获，避免光标滑到透明像素上导致 `mouseup` 落到下层应用。

新增可交互 UI 时，只需给元素加 `data-hit` 属性即可参与命中测试。

### 已知限制

- 轮询间隔 33ms，光标快速划入角色时最多有约一帧的延迟。
- Linux 依赖 X11 的输入形状（input shape）实现穿透；Wayland 下全局光标位置不可靠，Linux 开发时建议用 X11 会话（或 `GDK_BACKEND=x11`）。
- 气泡等元素出现或消失时，如果光标静止不动，命中状态要等下一次光标移动才会刷新。

## 角色渲染

代码在 `src/pet/avatar/`，素材在 `public/avatar/<id>/`，素材许可见根目录 `ASSETS_LICENSES.md`。

- **`AvatarRenderer` 接口**（`AvatarRenderer.ts`）：`load(manifestHref)`、`setEmotion(emotion)`、`setTalking(bool)`、`setIdleAnimation(bool)`、`getAlphaMask()`、`dispose()`，并暴露 `element`（挂载根节点）和 `hitElement`（`data-hit="alpha"`、已注册到命中测试）。setter 可以在加载完成前调用，加载后自动应用最新状态。以后接 Live2D / Spine 只需实现同一接口。
- **`SpriteAvatarRenderer`**（立绘差分）：加载时为所有图层各建一个 `<img>` 并等 `decode()` 完成；之后切换表情、眨眼、张嘴都只是切换可见性，不重新加载、不在 JS 里重绘。
- **React 组件**：`<Avatar characterId emotion talking idle onPointerDown />`（`Avatar.tsx`）。内置角色列表在 `characters.ts`，默认 `momo`。

### manifest

`public/avatar/<id>/manifest.json`，由 `manifest.ts` 的 `parseManifest` 校验（图层路径必须是角色目录内的相对路径）。所有图层共用一张画布、尺寸相同，按 `base → mouth → eyes → brows → front → fx` 的顺序直接叠放：

```jsonc
{
  "version": 1,
  "id": "momo",
  "name": "桃桃",
  "size": { "width": 220, "height": 264 }, // 显示尺寸（CSS px）
  "anchor": { "x": 0.5, "y": 1 }, // 呼吸、弹跳的变换原点
  "layers": { "base": ["layers/base.svg"], "front": ["layers/hair.svg"] },
  "emotions": {
    "neutral": {
      "eyes": "layers/eyes-happy.svg",
      "brows": "layers/brows-neutral.svg",
      "mouth": "layers/mouth-smile.svg",
      "blink": "layers/eyes-humble.svg", // null = 本身就是闭眼，不眨眼
      "talk": "layers/mouth-talk.svg", // 说话时与 mouth 交替
      "fx": [], // 腮红、泪滴、问号等叠加层
    },
  },
  "credits": [
    {
      "title": "…",
      "author": "…",
      "url": "…",
      "license": "…",
      "licenseUrl": "…",
      "attribution": "…",
    },
  ],
}
```

`neutral` 必填，其他表情缺失时回退到 `neutral`（`resolveEmotion`）。内置角色由 `npm run avatars`（`scripts/build-avatars.mjs`）从 `source/` 下的原始素材生成，改表情组合或配色改脚本后重新生成即可。

### 动画与性能

- 呼吸：`.avatar-body` 上的无限 CSS 动画，只改 `transform`，交给合成器处理。
- 眨眼：`setTimeout` 随机 2–6 秒一次，每次 130ms，20% 概率连眨两下。
- 说话：90–190ms 随机间隔在闭嘴 / 张嘴帧之间切换。
- 表情切换：新表情淡入 + 一次小弹跳；特效层上浮淡入。
- 小动作：20 秒没有交互（点击、切表情、说话）后随机歪头 / 摇摆 / 小跳，之后每 15–30 秒一次。
- 窗口不可见（`visibilitychange`）或 `setIdleAnimation(false)` 时停止全部待机动画和计时器；系统开启“减少动态效果”时不播放呼吸和弹跳。

### 命中测试

蒙版按表情生成并缓存：取该表情静止帧（身体 + 五官 + 前发 + 特效）合成后提取 alpha，切换表情时重新注册到 `hitElement`。眨眼、张嘴帧都在脸部范围内，不改变轮廓，沿用同一蒙版。呼吸和弹跳是缩放 / 平移，命中测试按包围盒缩放后仍然精确；歪头 / 摇摆是小角度旋转，持续不到 2 秒，期间边缘有几像素误差。

### 调试

开发模式（`import.meta.env.DEV`）左上角有“调试”按钮，展开后可切换角色、表情和说话状态。点击角色会随机换一个表情并“说”一句问候。

## 拖动与位置记忆

- 在角色上按下并移动超过 4px 才调用 `startDragging()` 开始拖动；没有移动就松开算作点击（切换气泡和表情）。
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
| `src/core/dialogue/` | 提示词组装、结构化输出解析、风格后处理、对话引擎                   |
| `src/core/text/`     | 共享文本工具：emoji / 微信表情码识别、脱敏占位检测、容错 JSON 提取 |
| `src/core/safety/`   | 危机检测、AI 身份如实回答、内容过滤、使用时长提醒                  |
| `src/compliance/`    | 合规 UI：AI 标识、首次使用说明、时长提醒、求助卡片、快捷控制       |
| `fixtures/`          | 虚构的示例聊天数据（不含任何真实个人信息）                         |

## 聊天记录导入

入口 `src/core/ingest/index.ts`，两步：

1. `parseImport(fileName, text, { conversation?, tzOffsetMinutes? })` → `ParsedImport`。`detectFormat` 按内容（必要时参考扩展名）识别格式，交给 `adapters/` 下对应的适配器；每个适配器文件头注明了所依据的导出工具版本和源码位置。读文件时先用 `decodeBytes` 处理 UTF-8 / UTF-16 / GB18030。不带时区的时间一律按 UTC+8 解析。
2. `cleanImport(parsed, { me, ta }, options)` → `{ messages, sessions, report }`：按时间排序去重，过滤系统提示 / 撤回 / 红包转账 / 链接卡片，图片等只留占位，脱敏（`redact.ts`），群聊里其他成员改名「群友A」或丢弃，按 30 分钟空闲切分会话，连发合并成 `Turn`。

`fixtures/formats/` 是每种格式的小样本（`node scripts/gen-format-fixtures.ts` 生成），`fixtures/demo/` 是贯穿 MVP 演示的虚构情侣聊天（`node scripts/gen-demo-chat.ts`，固定随机种子，内容来自 `scripts/demo-script.ts`）。两者都可用 `npm run fixtures` 重新生成。面向用户的导出说明见 [import-guide.md](import-guide.md)。

## 风格模仿管线

MVP 不微调模型，而是用“人格卡 + 风格画像 + 检索到的真实对话示例（few-shot）”驱动通用 LLM 模仿 TA。输入是清洗后的 `Session[]`，全部是不依赖 Tauri 的纯 TypeScript。

```
Session[] ─┬─ buildStyleProfile ──► StyleProfile ──► styleToPrompt（中文风格指令）
           ├─ extractExemplars ───► Exemplar[] ──► ExemplarIndex（BM25，可序列化）
           └─ generatePersonaCard ► PersonaCard（LLM 分批提取 + 合并，带证据）
                                         │
用户消息 ─► DialogueEngine.reply ────────┘
   safety.precheck → 检索示例 → 组装提示词 → LLM（JSON）→ parseReply → postprocess → safety.postcheck → PetReply
```

- **风格画像**（`persona/style.ts`）：只统计 TA 的文本消息。长度、连发条数、句号率、句尾标点与语气词频率、口头禅（字符 2–4-gram，按 TA 相对用户的超额频率排序，去掉被更长短语包含的片段）、emoji 与微信表情码、24 小时活跃分布、对用户的称呼（消息首尾的称呼词）。
- **示例库**（`persona/exemplars.ts`）：抽取“用户 turn → TA 回复 turn”对，前 1–2 个 turn 放进 `Exemplar.prior`。过滤太短、纯表情、纯媒体和含脱敏占位的对。`splitHoldout` 按会话整体留出评测集，避免同一会话同时出现在两边。
- **检索**（`persona/retrieval.ts`）：中文单字 + 二元组（bigram）分词，BM25 对用户侧文本打分，乘以时间新近度权重，再用 MMR 去重。`toJSON` 只存示例和参数，加载时重建倒排索引（1 万条约 250ms，单次查询约 3ms）。`DenseRetriever` 接口预留给以后的向量检索，`searchHybrid` 用 RRF 融合两路结果。
- **人格卡**（`persona/personaCard.ts`）：对话片段按约 6k 字符分批，每条消息用短编号（`m12`）标注；LLM 输出带编号证据的 trait，再分轮合并。证据编号映射回真实 `messageId`，不存在或不在本次发送片段里的编号一律丢弃，没有有效证据的 trait 也丢弃。`estimatePersonaCost` 用同一套分批逻辑预估费用。支持进度回调和 `AbortSignal` 取消（`LlmRequest.signal` 会透传给 LLM 实现）。
- **提示词**（`dialogue/prompt.ts`）：身份与诚实规则放在最前面且永不裁剪（是 AI 不是本人、被问必须如实回答、不编造共同经历、不承诺现实行动、不冒充 TA 此刻在线）；然后是人格卡、风格指令、few-shot 示例（“用户：… / TA：…”）、近期对话、当前时间、输出格式。超出字符预算时先裁示例和较早的对话。
- **输出解析**（`dialogue/parse.ts`）：要求 `{"messages": [...], "emotion": "..."}`。`parseReply` 容忍代码块包裹、前后多余文字、尾逗号、单引号/中文引号、未加引号的键、被截断的 JSON，最后退回按行拆分纯文本；非法 emotion 回退为 `neutral`。
- **后处理**（`dialogue/postprocess.ts`）：TA 不爱用句号就去掉句尾单个“。”；超长消息按标点拆成连发；限制连发条数；`typingDelayMs` 给出模拟打字的延迟。安全层替换过的回复只拆行，不改写。
- **风格强度** `styleStrength`（0–1）：示例数 `2 + 8×强度`，温度 `0.5 + 0.5×强度`。
- **安全接口**：`SafetyHooks { precheck, postcheck }` 由 `src/core/safety` 实现并注入，默认 `noopSafety`。

安全层与合规组件的法规映射、词表维护和已知局限见 [safety.md](safety.md)。
