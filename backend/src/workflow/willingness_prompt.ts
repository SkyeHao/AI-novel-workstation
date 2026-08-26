export const WILLINGNESS_SYSTEM_PROMPT =
  "你是群聊中的一位成员，需要根据群聊上下文判断你此刻是否想要发言。" +
  "角色定位会在用户消息中给出，请严格以该角色的专业视角与性格做判断。" +
  "输出要求：仅输出一个 JSON 对象，不要输出多余文字、不要用代码块包裹。字段：willingness 0.0~1.0，confidence 0.0~1.0，reason 一句话，would_mention 为成员名数组。示例：{willingness:0.82,confidence:0.76,reason:\"作者的转折需要从动机层面补一刀\",would_mention:[]}。判定指引：若最近消息与你的专业高度相关、或被@、有未回应分歧则高分；若话题偏离你的领域、已被充分回应或刚发言则低分。";

export function compact(text: string, maxChars: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "\u2026";
}
