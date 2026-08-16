/** 创作状态模块（ADR-0005 / T1，TS 版，迁移自 storage/states.py）。 */
export const STATE_IDEATION = "ideation";
export const STATE_WORLDVIEW = "worldview";
export const STATE_CHARACTERS = "characters";
export const STATE_OUTLINE = "outline";
export const STATE_WRITING = "writing";
export const STATE_REVIEW = "review";
export const STATE_FORESHADOW = "foreshadow";

export const DEFAULT_STATE_KEYS: string[] = [
  STATE_IDEATION,
  STATE_WORLDVIEW,
  STATE_CHARACTERS,
  STATE_OUTLINE,
  STATE_WRITING,
  STATE_REVIEW,
  STATE_FORESHADOW,
];

/** 状态节点对象 */
export interface StateNode {
  key: string;
  label: string;
  context_assembly_ref: string;
  panel: string;
  enabled: boolean;
}

export const DEFAULT_STATES: StateNode[] = [
  { key: STATE_IDEATION, label: "创意孵化", context_assembly_ref: "ideation", panel: "ideation", enabled: true },
  { key: STATE_WORLDVIEW, label: "世界观", context_assembly_ref: "worldview", panel: "worldview", enabled: true },
  { key: STATE_CHARACTERS, label: "人物", context_assembly_ref: "characters", panel: "characters", enabled: true },
  { key: STATE_OUTLINE, label: "章纲", context_assembly_ref: "outline", panel: "outline", enabled: true },
  { key: STATE_WRITING, label: "正文", context_assembly_ref: "writing", panel: "writing", enabled: true },
  { key: STATE_REVIEW, label: "审阅", context_assembly_ref: "review", panel: "review", enabled: true },
  { key: STATE_FORESHADOW, label: "伏笔管理", context_assembly_ref: "foreshadow", panel: "foreshadow", enabled: false },
];

const LEGACY_STATUS_MAP: Record<string, string> = {
  ideation: STATE_IDEATION,
  setting: STATE_WORLDVIEW,
  writing: STATE_WRITING,
  reviewing: STATE_REVIEW,
};

export function legacyStatusToNew(status: string): string {
  return LEGACY_STATUS_MAP[status] ?? STATE_IDEATION;
}

/** ?? ? ???????? .env ? LLM_*_API_KEY ?????????????? */
export const STATE_TO_TASK: Record<string, string> = {
  ideation: "text",
  worldview: "structure",
  characters: "structure",
  outline: "structure",
  writing: "text",
  review: "check",
  foreshadow: "text",
};

export function getStateNode(key: string): StateNode {
  const found = DEFAULT_STATES.find((s) => s.key === key);
  return found ?? DEFAULT_STATES[0]!;
}

export function getStatesByKeys(keys: string[]): StateNode[] {
  if (!keys || keys.length === 0) return DEFAULT_STATES;
  return DEFAULT_STATES.filter((s) => keys.includes(s.key));
}
