import type { ConsentRecord, SubjectStatus } from "../core/model";

export interface DataSubjectDeclarationProps {
  value: ConsentRecord;
  firstRunAdult: boolean;
  onChange(value: ConsentRecord): void;
  onExport?(): void;
}

const SUBJECT_OPTIONS: { id: SubjectStatus; label: string; hint: string }[] = [
  { id: "self", label: "我自己", hint: "用你自己的聊天记录，桌宠模仿的是你自己的说话方式。" },
  { id: "living", label: "在世的人", hint: "需要确认 TA 已同意你导入聊天记录并在本机使用。" },
  {
    id: "deceased",
    label: "已故的人",
    hint: "仅限个人纪念，默认开启哀伤友好模式；不得用于商业或对外传播。",
  },
];

export function DataSubjectDeclaration({
  value,
  firstRunAdult,
  onChange,
  onExport,
}: DataSubjectDeclarationProps) {
  const patch = (p: Partial<ConsentRecord>, declaredAt = value.declaredAt) =>
    onChange({ ...value, ...p, declaredAt });

  return (
    <section className="mgr-panel">
      <header className="mgr-panel-head">
        <h2>数据主体声明</h2>
        <p className="mgr-muted">
          导入聊天记录前必须完成声明。授权记录会随角色保存在本机，可随时导出。
        </p>
      </header>

      <fieldset className="mgr-fieldset">
        <legend>数据主体类型</legend>
        <div className="mgr-radio-grid">
          {SUBJECT_OPTIONS.map((o) => (
            <label key={o.id} className="mgr-radio-card">
              <input
                type="radio"
                name="subject"
                checked={value.subject === o.id}
                onChange={() => {
                  const declaredAt = Date.now();
                  patch(
                    {
                      subject: o.id,
                      subjectConsented: o.id === "self" ? true : value.subjectConsented,
                    },
                    declaredAt,
                  );
                }}
              />
              <span className="mgr-radio-title">{o.label}</span>
              <span className="mgr-radio-hint">{o.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mgr-form-grid">
        <label>
          TA 的称呼
          <input
            value={value.subjectName}
            onChange={(e) => patch({ subjectName: e.target.value }, Date.now())}
            placeholder={value.subject === "self" ? "你的名字或昵称" : "聊天记录里的称呼"}
          />
        </label>
        <label>
          与你的关系
          <input
            value={value.relation}
            onChange={(e) => patch({ relation: e.target.value }, Date.now())}
            placeholder="如：女朋友、母亲、朋友"
          />
        </label>
      </div>

      {value.subject === "living" && (
        <label className="mgr-check">
          <input
            type="checkbox"
            checked={value.subjectConsented}
            onChange={(e) => patch({ subjectConsented: e.target.checked }, Date.now())}
          />
          TA 已知情并同意我导入聊天记录，仅在本机个人使用，不对外传播。
        </label>
      )}

      {value.subject === "deceased" && (
        <p className="mgr-callout">
          我确认作为近亲属，仅为个人纪念目的在本机使用，遵守相关法律规定，不损害逝者名誉。
        </p>
      )}

      <label className="mgr-check">
        <input
          type="checkbox"
          checked={value.personalUseOnly}
          onChange={(e) => patch({ personalUseOnly: e.target.checked }, Date.now())}
        />
        仅个人使用，不用于商业、冒充或向他人发送 AI 合成内容。
      </label>

      <label className="mgr-check">
        <input
          type="checkbox"
          checked={value.ageAdult}
          onChange={(e) => patch({ ageAdult: e.target.checked }, Date.now())}
          disabled={!firstRunAdult}
        />
        我确认数据主体相关方均已年满 18 周岁（首次使用已声明年满 18：{firstRunAdult ? "是" : "否"}
        ）。
      </label>

      {onExport && (
        <div className="mgr-row-actions">
          <button type="button" className="mgr-btn mgr-btn-ghost" onClick={onExport}>
            导出授权记录
          </button>
        </div>
      )}
    </section>
  );
}
