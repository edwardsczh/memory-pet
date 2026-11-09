# Python sidecar（预留）

本目录为后续阶段的 Python 推理进程预留，**P0 阶段不实现、不打包、不启动**。

按产品规划，sidecar 从 P3-1 开始引入，负责重计算任务：

| 能力           | 计划方案                                  | 阶段                                |
| -------------- | ----------------------------------------- | ----------------------------------- |
| 嵌入（本地）   | bge-m3（ONNX）                            | P1-8 起可选，MVP 可先走云端嵌入 API |
| ASR            | SenseVoice（FunASR），备选 faster-whisper | P3-8                                |
| TTS / 声音克隆 | CosyVoice 3，精修用 GPT-SoVITS            | P3-2 / P3-6 / P3-7                  |
| 语音素材处理   | SILK 解码、降噪、VAD、说话人验证          | P3-3 / P3-4                         |

## 约定

- 与桌面端通过本地 HTTP/WebSocket 通信，只监听 `127.0.0.1`，每次启动由 Rust 核心生成随机 token 并通过环境变量传入。
- 由 Rust 核心负责按需下载安装、启动、健康检查和崩溃重启（P3-1）。
- 代码放在 `src/memory_pet_sidecar/`，依赖在 `pyproject.toml` 中声明。
