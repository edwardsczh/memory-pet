import type { CleanMessage, Role, Session, Turn } from "../model";

export function textMessages(turn: Turn): CleanMessage[] {
  return turn.messages.filter((m) => m.kind === "text" && m.text.trim() !== "");
}

export function messagesOf(sessions: Session[], role: Role): CleanMessage[] {
  const out: CleanMessage[] = [];
  for (const s of sessions) {
    for (const t of s.turns) {
      if (t.role === role) out.push(...textMessages(t));
    }
  }
  return out;
}

export function turnText(turn: Turn): string {
  return textMessages(turn)
    .map((m) => m.text.trim())
    .join("\n");
}
