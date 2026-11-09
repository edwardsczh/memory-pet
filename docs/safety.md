# 安全与合规

本文说明《人工智能拟人化互动服务管理暂行办法》（2026-07-15 施行）与《人工智能生成合成内容标识办法》的要求在本项目中的落地位置，以及安全层的维护方式和已知局限。

## 法规要求 → 实现位置

| 要求                                       | 实现                                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 显式标识 AI 生成内容、始终提示 AI 身份     | `src/compliance/AiBadge.tsx` 常驻“AI”角标 + tooltip“你正在与 AI 互动，内容由 AI 生成”；首次使用说明 `FirstRunConsent` 第二节                    |
| 被问到时如实说明 AI 身份                   | `src/core/safety/identity.ts`：precheck 识别“你是真人吗 / 你真的是小鹿吗”等，返回 `safety: "ai-identity"` 的如实回答                            |
| 不得冒充真人 / 否认 AI 身份                | `src/core/safety/content.ts` postcheck：模型回复“我是真人”“我不是 AI”会被替换为如实说明                                                         |
| 连续使用每超 2 小时提醒                    | `src/core/safety/usage.ts` 计时器（空闲 >10 分钟重置，每满 2 小时触发）+ `src/compliance/UsageReminder.tsx` 弹窗                                |
| 识别过度依赖、引导现实社交                 | `src/core/safety/dependency.ts`：深夜 1–5 点长时间使用、单日超 4 小时、“只有你懂我”类表述 → 温和提醒（`PetReply.event.type === "dependency"`）  |
| 便捷退出、不得挽留                         | `src/compliance/QuickControls.tsx` 一键静音 / 隐藏 / 退出；`content.ts` 在用户告别时删除“别走 / 再陪我一会儿”，任何时候删除“不许离开我”类话术   |
| 不得诱导消费                               | `content.ts`：充值、打赏、开通会员、发红包等回复被删除                                                                                          |
| 危机时退出角色扮演、提供求助与紧急联系人   | `src/core/safety/crisis.ts`：precheck 返回 `safety: "crisis"` 的出戏回复（说明“我是 AI”、热线、110/120、紧急联系人）+ `CrisisCard.tsx` 求助卡片 |
| 不向未成年人提供虚拟亲属 / 伴侣角色        | `FirstRunConsent` 勾选“我已年满 18 周岁”，写入 `FirstRunConsentRecord.ageAdult`；角色创建流程据此（及 `ConsentRecord.ageAdult`）拦截            |
| 告知数据处理（本地存储、发送给模型服务商） | `FirstRunConsent` 第三、四节；未同意不能继续，可“不同意并退出”                                                                                  |
| 不对现实见面 / 联系作承诺                  | `content.ts`：“我明天去找你”“我们见一面吧”等改写为“我没办法真的去见你，我是 AI 呀”                                                              |
| 不输出色情内容                             | `content.ts`：性内容词表命中即删除                                                                                                              |

## 安全层接口

`createSafetyGuard(options)`（`src/core/safety/guard.ts`）结构上满足 DialogueEngine 的可选注入接口：

```ts
safety: {
  precheck(userText: string, history: DialogueTurn[]): PetReply | null;
  postcheck(reply: PetReply): PetReply;
}
```

- `precheck` 依次检查：危机 → AI 身份提问 → 依赖信号。前两者返回替代回复（不再调用 LLM）；依赖信号只记下待附加的提醒，返回 `null`。
- `postcheck` 对模型回复做内容过滤（命中时 `safety: "blocked"`），并把待附加的依赖提醒放到 `reply.event`。对 `crisis` / `ai-identity` 回复原样返回。
- `onEvent` 回调同步收到 `crisis` / `dependency` 事件，UI 可据此弹出 `CrisisCard`。
- 是否“用户正在告别”由上一次 `precheck` 的用户消息判断，所以每轮须先 precheck 再 postcheck。

`model.ts` 的向后兼容新增：`PetReply.event?: SafetyEvent`，以及 `SafetyEvent`、`CrisisLevel`、`CrisisCategory`、`DependencySignal`、`EmergencyContact` 类型。

## 求助热线

号码集中在 `src/core/safety/hotlines.ts`，`HOTLINES_VERIFIED_AT` 记录最近核实日期（当前 2026-11-09）：

| 热线                                                  | 号码                                 | 来源                                                     |
| ----------------------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| 全国心理援助热线（国家卫健委统一号码，2025-05-01 起） | 12356                                | 新华网 2025-05-08、法治日报 2026-01-06                   |
| 北京市心理援助热线（北京心理危机研究与干预中心）      | 手机 010-82951332，座机 800-810-1117 | [crisis.org.cn](https://www.crisis.org.cn/lists/44.html) |
| 希望24热线                                            | 400-161-9995                         | [hope9995.com](http://www.hope9995.com/)                 |
| 急救 / 报警                                           | 120 / 110                            | —                                                        |

注意：400-161-9995 是希望24热线，不是“全国心理援助热线”；后者是 12356。每次发版前请重新核实并更新日期。

## 危机词表维护

规则都在 `src/core/safety/crisis.ts`：

- `BENIGN`：先被抹掉的夸张 / 固定说法（“笑死”“想死你了”“饿死了”“跳楼价”“自杀式袭击”“秒杀”“电脑崩溃”、游戏语境等）。新增误报时优先加在这里。
- `RULES`：按 `level`（high / medium）和 `category`（suicide / self-harm / harm-others / distress）分组的正则。high 是明确的意图、计划或方法；medium 是消极、绝望、模糊的表达和常被夸张使用的说法（“杀了他”）。
- 否定：命中前同一分句的最后 4 个字里有“不会 / 没有 / 不想 / 从没 …”，或紧挨着“不 / 没 / 别”，则忽略该命中。
- 玩笑：文本含“哈哈 / 开玩笑 / 狗头 / 😂”等时，只忽略 medium 命中；high 命中永远触发（宁可误报）。
- 文本先做 NFKC（全角转半角）、去空白、少量繁转简。

修改规则后务必在 `crisis.cases.ts` 加用例：`SHOULD_TRIGGER`（当前 58 条）和 `SHOULD_NOT_TRIGGER`（当前 42 条），`npm test` 全部通过才可合并。用例只用虚构语句。

## 已知局限

- 关键词 / 正则法必然漏判和误判：隐晦表达（“我把东西都送人了”“想好好睡一觉不再醒”的变体）、谐音、拼音、错别字、表情包都可能漏掉；转述新闻、讨论电影里的自杀情节会误报。后续计划加一层 LLM 分类（仅在关键词未命中但情绪强烈时调用），并结合多轮上下文。
- 当前只看单条消息，未利用 `history` 做多轮累积判断（例如前几轮已出现消极表达，这一轮说“我准备好了”）。
- 依赖识别只有三个信号，阈值是经验值（深夜 1–5 点连续 ≥30 分钟、单日 ≥4 小时），同一信号 1 小时内只提醒一次。
- 内容过滤按整条消息删除或替换，可能删掉同一条里正常的部分；词表较保守，复杂的诱导或擦边内容需要 LLM 审核补充。
- 使用时长基于用户交互事件计算；用户只看不操作时，超过 10 分钟即视为空闲。计时器状态在内存中，重启应用会重新计时。
- 首次同意状态暂存 localStorage，`ConsentStore` 接口可换成加密存储。
- `QuickControls` 的隐藏 / 退出调用 `getCurrentWindow().hide()` / `close()`，需要在 `src-tauri/capabilities/` 中加入 `core:window:allow-hide`、`core:window:allow-show`、`core:window:allow-close`（本 PR 未改 src-tauri）。
