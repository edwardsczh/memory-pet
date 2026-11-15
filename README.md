# 记忆桌宠 Memory Pet

把 TA 说话的样子留在你的桌面上：常驻桌宠、基于真实聊天记录学会对方语气，用文字和你聊天。

> 当前版本：**MVP 文字聊天**（v0.1.3）。含透明穿透桌宠、聊天气泡、角色管理（提示创建 / 导入 / 截图核对 / 授权 / 人格卡）、加密本地存储、LLM 设置、合规与安全层。语音与长期记忆为后续迭代。聊天截图在本机读取，不上传。

## 安装（GitHub Release）

在 [Releases](https://github.com/edwardsczh/memory-pet/releases) 下载对应系统的安装包（**未签名**：Windows `.msi` / `.exe`，macOS `.dmg`，Linux `.deb` / `.AppImage`）。

### Windows

1. 下载 `.msi` 或 `.exe` 并运行安装。
2. 若 SmartScreen 提示「未知发布者」：点 **更多信息** → **仍要运行**（本仓库 CI 产出尚未做代码签名）。
3. 首次使用需已安装 [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)（Win10/11 通常已带）。

### macOS

1. 打开 `.dmg`，将「Memory Pet」拖入应用程序文件夹。
2. 若 Gatekeeper 拦截：**系统设置 → 隐私与安全性** → 允许打开，或右键应用 → **打开** 确认一次。
3. 本发行版**未公证（notarized）**，仅建议内测自用。

### Linux

- 推荐 `.deb`（Debian/Ubuntu）：`sudo dpkg -i memory-pet_*.deb`，缺依赖时 `sudo apt -f install`。
- 或运行 `.AppImage`：`chmod +x Memory_Pet_*.AppImage && ./Memory_Pet_*.AppImage`。
- 需要合成器（compositor）才能正确显示透明窗口；托盘需 AppIndicator 支持。

## 首次使用

1. 启动后托盘有图标；桌宠在屏幕一角，**透明区域点击可穿透到下层软件**。
2. 首次聊天前阅读并同意 **AI 使用说明**（全程 AI 标识、时长提醒等）。
3. **托盘 → 角色管理…**（或点桌宠上的「去创建」）：
   - 完成 **数据主体声明**（本人 / 在世他人 / 已故亲人）。
   - **写一段提示**即可创建角色，不必先选文件。
   - 可以把微信聊天截图（png、jpg、webp）拖进截图区。文字在这台电脑上读取。保存之前会列出抽出的句子，并标明是你、对方，还是分不出来。可以删除一句、一张图，或全部不保存。确认之后，这些句子才进入和导入文件相同的记忆。读不出文字的图片不会用来保存角色。
   - 若已有导出文件，仍可选择文件导入（见下），再选出「我是谁 / TA 是谁」。
4. **发出第一句之前**：如果还没填 API Key，桌宠会用中文说明，并在同一窗口给出现有的模型设置。默认是 DeepSeek（OpenAI 兼容）。请填**你自己的 Key** 并保存。安装包里没有 Key。本地地址可以不填。Key 存系统凭据库，不落明文。
5. 回到桌宠即可打字聊天。开发模式可在管理窗口 **载入演示角色（小鹿）**。

### 导出微信聊天记录（第三方工具）

本产品**不**内置微信解密，只解析导出文件。常用工具（任选其一，操作细节见 [docs/import-guide.md](docs/import-guide.md)）：

| 工具                                                               | 说明              |
| ------------------------------------------------------------------ | ----------------- |
| [chatlog-keeper](https://github.com/labazhou2024/chatlog-keeper)   | 微信 / QQ JSON 等 |
| [WeChatExporter](https://github.com/93857536-pixel/WeChatExporter) | JSON / TXT        |
| [wx-cli](https://github.com/jackwener/wx-cli)                      | JSON / Markdown   |

导出后通过「角色管理 → 导入」选择文件即可。

### 无 API Key 时

可配合本仓库 `scripts/mock-llm-server.mjs` 在本地起一个 OpenAI 兼容 mock（`node scripts/mock-llm-server.mjs`），设置里把 Base URL 设为 `http://127.0.0.1:8787/v1`，模型随意填写 `mock`。

## 技术栈

- [Tauri 2](https://v2.tauri.app/) + React 19 + TypeScript + Vite
- 架构说明：[docs/architecture.md](docs/architecture.md)

## 本地开发

- Node.js **22+**，Rust **stable（≥1.90，Cargo edition 2024）**
- `npm install` → `npm run tauri dev`
- 浏览器预览：`npm run dev` 后访问 `http://localhost:1420/?view=settings` 或 `?view=manager`（无穿透与原生 vault 加密行为，逻辑与内存 vault 一致）

常用命令见原 CI 表：`npm test`、`npm run lint`、`npm run tauri build`。

## 隐私原则

聊天记录、人格与记忆默认**仅本机** AES 加密存储；调用云端模型时只发送当前对话所需上下文，并使用**用户自备 API Key**。

## 已知限制（v0.1.3）

- 安装包**无** Windows 代码签名 / macOS 公证。
- 截图文字用安装包里的本机识别模型读取，可能认错字，保存前需要自己核对。没有云端识别，也不用另外的 Key。读不出文字就说明，并且不会用那张图保存角色。
- 人格卡默认由统计 fallback 生成；可选 LLM 生成需已配置 Key。
- 语音克隆、长期记忆、主动问候完整版仍在路线图 P2/P3。
- 危机干预热线：**12356**（全国心理援助热线）。
