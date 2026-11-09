# 架构说明

本文描述当前代码结构和关键机制，随开发推进持续更新。完整产品规划见项目规划文档（P0–P4 路线图）。

## 总体结构

```
┌──────────────── 桌面应用 (Tauri 2) ─────────────────┐
│ WebView 前端（React + TypeScript，src/）             │
│  ├ 桌宠舞台：角色、气泡、命中测试                     │
│  └（后续）聊天面板、设置、导入向导、记忆管理          │
│ Rust 核心（src-tauri/）                              │
│  ├ 窗口：透明 / 无边框 / 置顶 / 位置记忆              │
│  ├ 点击穿透：全局光标轮询 + set_ignore_cursor_events  │
│  ├ 托盘菜单                                          │
│  └（后续）加密存储、LLM 调用、sidecar 进程管理        │
└───────────────┬─────────────────────────────────────┘
                │ 127.0.0.1 + token（P3 起）
┌───────────────▼──────────── Python sidecar（sidecar/，预留）┐
│ 嵌入 / ASR / TTS / 语音素材处理                             │
└────────────────────────────────────────────────────────────┘
```

## 目录约定

| 路径                      | 内容                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| `src/`                    | 前端代码。`src/pet/` 是桌宠外壳（角色、命中测试、穿透桥接）                   |
| `public/avatar/`          | 角色美术资源。每个角色一个子目录，当前只有占位图 `placeholder/`               |
| `src-tauri/src/`          | Rust 核心。一个模块一个文件：`click_through.rs`、`window_state.rs`、`tray.rs` |
| `src-tauri/capabilities/` | Tauri 权限声明，前端能调用的窗口 API 都要在这里显式列出                       |
| `sidecar/`                | Python 推理进程（P3-1 起实现）                                                |
| `docs/`                   | 架构与开发文档                                                                |

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

托盘菜单：显示 / 隐藏桌宠、重置位置、退出。桌宠窗口不出现在任务栏（`skipTaskbar`），托盘是唯一的常驻入口。

## 核心模块约定（src/core/）

`src/core/model.ts` 是所有模块共享的领域模型（聊天消息、会话、风格画像、人格卡、角色与授权、对话回复、LLM 接口）。核心逻辑写成不依赖 Tauri 的纯 TypeScript，用 vitest 测试（`npm test`）；需要系统能力（加密存储、调用 LLM）的部分通过注入接口实现，测试时替换成假实现。

| 目录                 | 内容                                                               |
| -------------------- | ------------------------------------------------------------------ |
| `src/core/ingest/`   | 聊天记录解析（微信第三方导出、QQ、通用格式）、清洗、脱敏、会话切分 |
| `src/core/persona/`  | 风格画像统计、人格卡生成、示例库与检索                             |
| `src/core/dialogue/` | 提示词组装、结构化输出解析、风格后处理、对话引擎                   |
| `src/core/text/`     | 共享文本工具：emoji / 微信表情码识别、脱敏占位检测、容错 JSON 提取 |
| `src/core/safety/`   | 危机检测、AI 身份如实回答、内容过滤、使用时长提醒                  |
| `fixtures/`          | 虚构的示例聊天数据（不含任何真实个人信息）                         |

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
