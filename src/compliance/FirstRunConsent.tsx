import { useId, useState } from "react";
import { AiBadge } from "./AiBadge";
import { exitApp } from "./windowActions";
import "./compliance.css";

export interface FirstRunConsentProps {
  onAccept(input: { ageAdult: boolean }): void;
  /** "不同意并退出". Defaults to closing the app. */
  onDecline?: () => void;
  /** Model provider name shown in the data notice, e.g. "DeepSeek". */
  providerName?: string;
}

const SECTIONS = (provider: string) => [
  {
    icon: "🌱",
    title: "这是什么",
    body: "记忆桌宠是一个常驻桌面的陪伴程序。你可以导入和某个人的聊天记录，桌宠会用 AI 学着 TA 的说话方式和你聊天。",
  },
  {
    icon: "🤖",
    title: "内容由 AI 生成",
    body: "桌宠说的每一句话都由人工智能生成，不是 TA 本人，也不是真人。界面上会一直显示“AI”标识；你问起时，桌宠也会如实说明自己是 AI。",
  },
  {
    icon: "🔒",
    title: "数据保存在本机",
    body: "导入的聊天记录、人格卡和对话记录只保存在这台电脑上，不会上传到我们的服务器。你可以随时在设置里删除。",
  },
  {
    icon: "📤",
    title: "会发送给模型服务商的内容",
    body: `聊天时，你发的消息、最近几轮对话，以及从聊天记录中挑出的少量相关片段，会发送给你选择的大模型服务商（${provider}）用来生成回复。发送前会去掉手机号、身份证号等敏感信息。请不要导入对方不愿意被使用的聊天记录。`,
  },
  {
    icon: "⏰",
    title: "使用时长提醒",
    body: "连续使用超过 2 小时会提醒你休息；深夜长时间使用，或者聊天中流露出过度依赖时，桌宠也会温和地提醒你多和身边的人联系。",
  },
  {
    icon: "🤝",
    title: "需要帮助时",
    body: "如果你提到伤害自己或他人，桌宠会暂停角色扮演，给你心理援助热线等求助方式。",
  },
  {
    icon: "🚪",
    title: "随时可以离开",
    body: "随时可以一键静音、隐藏或退出，桌宠不会挽留你。",
  },
];

export function FirstRunConsent({
  onAccept,
  onDecline = () => void exitApp(),
  providerName = "在设置中选择的服务商",
}: FirstRunConsentProps) {
  const [ageAdult, setAgeAdult] = useState(false);
  const ageId = useId();

  return (
    <div className="mp-overlay" role="dialog" aria-modal aria-labelledby={`${ageId}-title`}>
      <div className="mp-card mp-consent" data-hit>
        <header className="mp-consent-head">
          <h2 id={`${ageId}-title`}>欢迎使用记忆桌宠</h2>
          <AiBadge />
        </header>
        <p className="mp-muted">开始之前，请花一分钟读完下面的说明。</p>

        <ul className="mp-consent-list">
          {SECTIONS(providerName).map((s) => (
            <li key={s.title}>
              <span className="mp-consent-icon" aria-hidden>
                {s.icon}
              </span>
              <div>
                <strong>{s.title}</strong>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mp-age">
          <label htmlFor={ageId} className="mp-check">
            <input
              id={ageId}
              type="checkbox"
              checked={ageAdult}
              onChange={(e) => setAgeAdult(e.target.checked)}
              data-hit
            />
            <span>我已年满 18 周岁</span>
          </label>
          <p className="mp-muted mp-small">
            {ageAdult
              ? "感谢确认。"
              : "未满 18 周岁时，不能创建伴侣、亲属等陪伴角色，只能使用基础功能。"}
          </p>
        </div>

        <footer className="mp-actions">
          <button type="button" className="mp-btn mp-btn-ghost" onClick={onDecline} data-hit>
            不同意并退出
          </button>
          <button
            type="button"
            className="mp-btn mp-btn-primary"
            onClick={() => onAccept({ ageAdult })}
            data-hit
          >
            我已阅读并同意
          </button>
        </footer>
      </div>
    </div>
  );
}
