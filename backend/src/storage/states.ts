/** 创作流程节点模块（ADR-0007，流程节点重构）。 */
export const NODE_IDEATION = "ideation";
export const NODE_WORLDVIEW = "worldview";
export const NODE_CHARACTERS = "characters";
export const NODE_OUTLINE = "outline";
export const NODE_WRITING = "writing";
export const NODE_REVIEW = "review";
export const NODE_STYLE = "style";

export const DEFAULT_NODE_KEYS: string[] = [
  NODE_IDEATION,
  NODE_WORLDVIEW,
  NODE_CHARACTERS,
  NODE_OUTLINE,
  NODE_WRITING,
  NODE_REVIEW,
  NODE_STYLE,
];

/** 流程节点对象 */
export interface StateNode {
  key: string;
  label: string;
  context_assembly_ref: string;
  panel: string;
  enabled: boolean;
}

export const DEFAULT_NODES: StateNode[] = [
  { key: NODE_IDEATION, label: "灵感捕捉", context_assembly_ref: "ideation", panel: "ideation", enabled: true },
  { key: NODE_WORLDVIEW, label: "世界观构建", context_assembly_ref: "worldview", panel: "worldview", enabled: true },
  { key: NODE_CHARACTERS, label: "人物塑造", context_assembly_ref: "characters", panel: "characters", enabled: true },
  { key: NODE_OUTLINE, label: "大纲生成", context_assembly_ref: "outline", panel: "outline", enabled: true },
  { key: NODE_WRITING, label: "正文生成", context_assembly_ref: "writing", panel: "writing", enabled: true },
  { key: NODE_REVIEW, label: "质量审查", context_assembly_ref: "review", panel: "review", enabled: true },
  { key: NODE_STYLE, label: "文风优化", context_assembly_ref: "style", panel: "style", enabled: true },
];

/** 向后兼容：DEFAULT_STATES 仍可用，指向 DEFAULT_NODES */
export const DEFAULT_STATES: StateNode[] = DEFAULT_NODES;

const LEGACY_STATUS_MAP: Record<string, string> = {
  ideation: NODE_IDEATION,
  setting: NODE_WORLDVIEW,
  writing: NODE_WRITING,
  reviewing: NODE_REVIEW,
};

export function legacyStatusToNew(status: string): string {
  if (!status) return NODE_IDEATION;
  const mapped = LEGACY_STATUS_MAP[status];
  if (mapped) return mapped;
  // 已是新式节点 key 时直接透传，避免 worldview/characters/outline/style 被降级为 ideation
  return DEFAULT_NODES.some((s) => s.key === status) ? status : NODE_IDEATION;
}

/** 节点 → 任务类型映射（用于模型分配） */
export const STATE_TO_TASK: Record<string, string> = {
  ideation: "text",
  worldview: "structure",
  characters: "structure",
  outline: "structure",
  writing: "text",
  review: "check",
  style: "text",
};

export function getStateNode(key: string): StateNode {
  const found = DEFAULT_NODES.find((s) => s.key === key);
  return found ?? DEFAULT_NODES[0]!;
}

export function getStatesByKeys(keys: string[]): StateNode[] {
  if (!keys || keys.length === 0) return DEFAULT_NODES;
  return DEFAULT_NODES.filter((s) => keys.includes(s.key));
}

/** 向后兼容：旧常量别名 */
export const STATE_IDEATION = NODE_IDEATION;
export const STATE_WORLDVIEW = NODE_WORLDVIEW;
export const STATE_CHARACTERS = NODE_CHARACTERS;
export const STATE_OUTLINE = NODE_OUTLINE;
export const STATE_WRITING = NODE_WRITING;
export const STATE_REVIEW = NODE_REVIEW;
export const DEFAULT_STATE_KEYS: string[] = DEFAULT_NODE_KEYS;

/** 向后兼容：STATE_FORESHADOW 已移除，保留为 undefined 避免编译错误 */
export const STATE_FORESHADOW: string | undefined = undefined;
