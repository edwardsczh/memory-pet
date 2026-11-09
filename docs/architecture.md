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
| `public/avatar/`          | 角色美术资源。每个角色一个子目录（`manifest.json` + `layers/` + `source/`）   |
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

托盘菜单：显示 / 隐藏桌宠、重置位置、退出。桌宠窗口不出现在任务栏（`skipTaskbar`），托盘是唯一的常驻入口。

## 核心模块约定（src/core/）

`src/core/model.ts` 是所有模块共享的领域模型（聊天消息、会话、风格画像、人格卡、角色与授权、对话回复、LLM 接口）。核心逻辑写成不依赖 Tauri 的纯 TypeScript，用 vitest 测试（`npm test`）；需要系统能力（加密存储、调用 LLM）的部分通过注入接口实现，测试时替换成假实现。

| 目录                 | 内容                                                               |
| -------------------- | ------------------------------------------------------------------ |
| `src/core/ingest/`   | 聊天记录解析（微信第三方导出、QQ、通用格式）、清洗、脱敏、会话切分 |
| `src/core/persona/`  | 风格画像统计、人格卡生成、示例库与检索                             |
| `src/core/dialogue/` | 提示词组装、结构化输出解析、风格后处理                             |
| `src/core/safety/`   | 危机检测、AI 身份如实回答、内容过滤、使用时长提醒                  |
| `fixtures/`          | 虚构的示例聊天数据（不含任何真实个人信息）                         |
