# 记忆桌宠 Memory Pet

把 TA 说话的样子留在你的桌面上：一个常驻桌面、基于真实聊天记录学会对方语气的桌宠。

> 当前进度：**P0 地基阶段**。已完成项目骨架和桌宠窗口（透明、无边框、置顶、可拖动、按像素点击穿透、位置记忆、托盘菜单）、两个可切换的立绘差分角色（7 种表情 + 眨眼 + 说话）、加密本地存储、LLM 服务商接入和设置窗口（托盘 → 设置…）。聊天、导入、记忆等功能尚未实现。

## 技术栈

- 桌面框架：[Tauri 2](https://v2.tauri.app/)（Rust 核心 + 系统 WebView）
- 前端：React 19 + TypeScript + Vite
- 推理 sidecar：Python（`sidecar/`，P3 阶段实现，当前只有目录）
- 平台：Windows 优先，兼顾 macOS；Linux 可用于开发调试

架构与关键机制见 [docs/architecture.md](docs/architecture.md)。

## 本地开发

### 1. 安装依赖

所有平台都需要：

- [Node.js](https://nodejs.org/) 22 或更高版本
- [Rust](https://rustup.rs/) stable（1.90 或更高版本）

各平台额外需要（详见 [Tauri 官方前置条件](https://v2.tauri.app/start/prerequisites/)）：

- **Windows**：Microsoft C++ 生成工具（安装时勾选“使用 C++ 的桌面开发”）和 WebView2 运行时（Windows 10/11 一般已自带）。
- **macOS**：Xcode Command Line Tools：`xcode-select --install`。
- **Linux（Debian/Ubuntu）**：

  ```bash
  sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

### 2. 安装前端依赖

```bash
npm install
```

### 3. 启动开发模式

```bash
npm run tauri dev
```

首次启动会编译 Rust 依赖，需要几分钟。启动后桌宠出现在主显示器右下角：

- 在角色身上**点击**：弹出气泡并随机换一个表情；**按住拖动**：移动位置（重启后保留）。
- 角色以外的透明区域：点击直接落到下层窗口。
- 系统托盘图标菜单：显示 / 隐藏桌宠、重置位置、退出。
- 开发模式下，窗口左下角有一个小标签显示当前是“点击穿透”还是“捕获鼠标”，方便调试。

> Linux 上需要开启窗口合成（compositor），否则透明区域会显示为黑色；托盘图标需要桌面环境支持 StatusNotifier / AppIndicator。

### 4. 打包

```bash
npm run tauri build
```

安装包输出到 `src-tauri/target/release/bundle/`（Windows 为 `.msi` / `.exe`，macOS 为 `.dmg`）。

## 常用命令

| 命令                                                       | 作用                                               |
| ---------------------------------------------------------- | -------------------------------------------------- |
| `npm run tauri dev`                                        | 开发模式运行桌面应用                               |
| `npm run tauri build`                                      | 打包安装包                                         |
| `npm run dev`                                              | 只启动前端（浏览器里调样式，无窗口穿透等原生能力） |
| `npm run build`                                            | 类型检查 + 构建前端                                |
| `npm run lint`                                             | ESLint                                             |
| `npm run format` / `npm run format:check`                  | Prettier 格式化 / 检查                             |
| `cd src-tauri && cargo fmt && cargo clippy -- -D warnings` | Rust 格式化与静态检查                              |

## 目录结构

```
.
├── src/                 # React 前端
│   └── pet/             # 桌宠外壳：角色、alpha 命中测试、穿透桥接
├── public/avatar/       # 角色美术资源（许可见 ASSETS_LICENSES.md）
├── src-tauri/           # Tauri / Rust 核心
│   └── src/             # click_through.rs、window_state.rs、tray.rs
├── sidecar/             # Python 推理 sidecar（预留）
├── docs/                # 架构文档
└── .github/workflows/   # CI
```

## CI

GitHub Actions（`.github/workflows/ci.yml`）在每个 PR 和 `main` 分支上运行：

- 前端：ESLint、Prettier 检查、TypeScript 类型检查和 Vite 构建。
- Rust：`cargo fmt --check`、`cargo clippy -D warnings`、`cargo check`。
- 打包：在 Windows、macOS、Linux 上执行 `tauri build`，安装包作为构建产物（artifact）上传。

## 隐私原则

聊天记录、声音和记忆默认只存在本机；调用云端大模型时只发送当前请求必需的上下文，并使用用户自己的 API Key。
