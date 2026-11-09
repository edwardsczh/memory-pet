# 素材许可

本仓库使用的第三方美术素材逐项列在这里。新增素材时：只接受可商用且允许修改的许可（CC0 优先，其次 CC BY / CC BY-SA），不接受 NC、“仅个人使用”、来源不明或许可不清的 AI 生成素材；把原始文件或来源说明放进对应目录的 `source/`，并在本文件追加一节。

## 角色立绘：桃桃（`public/avatar/momo/`）、小凯（`public/avatar/kai/`）

| 项目     | 内容                                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 素材名称 | ToonHead（DiceBear “Toon Head” 风格定义）                                                                                                                                                      |
| 作者     | Johan Melin（<https://www.johanmelin.com>）；DiceBear 版由 Florian Körner 的 DiceBear 项目导出                                                                                                 |
| 原作地址 | <https://www.figma.com/community/file/1589627891082866389>                                                                                                                                     |
| 下载地址 | <https://cdn.hopjs.net/npm/@dicebear/styles@10.6.0/dist/toon-head.min.json>（说明页 <https://www.dicebear.com/styles/toon-head/>，许可总览 <https://www.dicebear.com/licenses/>）              |
| 许可证   | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)：允许商用、修改、再分发，须署名并注明修改                                                                                            |
| 许可依据 | DiceBear 说明页写明 “This avatar style is a remix of: ToonHead by Johan Melin, licensed under CC BY 4.0”；下载文件的 `meta.license` 字段同样写明 CC BY 4.0。DiceBear 的导出代码本身为 MIT 许可 |
| 下载日期 | 2026-11-09                                                                                                                                                                                     |
| 原始文件 | `public/avatar/momo/source/toon-head.min.json`（`kai/source/` 下为同一文件），来源说明见同目录 `README.md`                                                                                     |

### 所做修改

由 `scripts/build-avatars.mjs`（`npm run avatars`）生成：

- **配色与部件选择**：为两个角色分别选定发型、后发、服装、肤色、发色、服装颜色。
- **拆层**：把整张头像拆成同一画布上的独立图层（身体底图、前发、眉毛、眼睛、嘴、特效），并裁剪为半身构图。
- **新增部件变体**：从原有部件派生出“向上看”“向下看”两种眼睛（移动瞳孔并裁剪在眼白内）和一个“说话”小张嘴（缩放原有 `agape` 嘴型）。
- **新增特效图层（本项目原创）**：腮红、害羞斜线、泪滴、汗滴、生气符号、惊讶线、星星、问号。
- **表情组合**：把部件组合成 neutral / happy / sad / angry / surprised / shy / thinking 七种表情，外加眨眼（闭眼）帧和说话（张嘴）帧。

### 要求的署名文本

> 角色立绘改编自 Johan Melin 的 “ToonHead”（<https://www.figma.com/community/file/1589627891082866389>），经 DiceBear（<https://www.dicebear.com>）导出，按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可使用。已修改：重新配色、拆分图层、新增眼睛/嘴部变体与表情特效。
>
> Character art adapted from “ToonHead” by Johan Melin (https://www.figma.com/community/file/1589627891082866389), via DiceBear, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified: recolored, split into layers, added eye/mouth variants and expression effects.

发布安装包时须在“关于”页面或随附文档中保留上述署名。每个角色的 `manifest.json` 的 `credits` 字段也带有同样信息，便于界面读取展示。
