/**
 * 创作引擎节点提示词持久化存储。
 * 默认提示词在 workflow/node_prompts.ts 硬编码，这里仅保存用户的覆盖层。
 * 文件：data/node-prompts.json -> { "ideation": {"prompt":"...","updatedAt":"..."}, ... }
 * 7 个 key 固定：ideation / worldview / characters / outline / writing / review / style
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getDataDir } from "../config/paths.js";
import { DEFAULT_NODES } from "./states.js";
import { NODE_PROMPTS } from "../workflow/node_prompts.js";

const NODE_PROMPT_FILE = () => path.join(getDataDir(), "node-prompts.json");

export const NODE_PROMPT_KEYS = ["ideation", "worldview", "characters", "outline", "writing", "review", "style"] as const;
export type NodePromptKey = typeof NODE_PROMPT_KEYS[number];

export interface NodePromptDetail {
  key: string;
  label: string;
  prompt: string;
  defaultPrompt: string;
  isCustom: boolean;
  updatedAt: string | null;
}

function getDefaultPrompt(key: string): string {
  const builder = (NODE_PROMPTS as Record<string, unknown>)[key] as ((ctx: unknown) => string) | undefined;
  if (!builder) return "";
  const node = DEFAULT_NODES.find((n) => n.key === key) ?? DEFAULT_NODES[0]!;
  try {
    return (builder as (ctx: { node: unknown; projectId: string }) => string)({ node, projectId: "" });
  } catch {
    return "";
  }
}

function loadOverrides(): Record<string, { prompt: string; updatedAt: string }> {
  const file = NODE_PROMPT_FILE();
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, { prompt: string; updatedAt: string }>;
    return {};
  } catch {
    return {};
  }
}

function saveOverrides(map: Record<string, { prompt: string; updatedAt: string }>): void {
  const file = NODE_PROMPT_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 2), "utf-8");
}

export function listNodePrompts(): NodePromptDetail[] {
  const overrides = loadOverrides();
  return DEFAULT_NODES.map((node) => {
    const def = getDefaultPrompt(node.key);
    const override = overrides[node.key];
    return {
      key: node.key,
      label: node.label,
      prompt: override ? override.prompt : def,
      defaultPrompt: def,
      isCustom: Boolean(override),
      updatedAt: override ? override.updatedAt : null,
    };
  });
}

export function getNodePrompt(key: string): NodePromptDetail | null {
  const node = DEFAULT_NODES.find((n) => n.key === key);
  if (!node) return null;
  const def = getDefaultPrompt(key);
  const overrides = loadOverrides();
  const override = overrides[key];
  return {
    key: node.key,
    label: node.label,
    prompt: override ? override.prompt : def,
    defaultPrompt: def,
    isCustom: Boolean(override),
    updatedAt: override ? override.updatedAt : null,
  };
}

export function getEffectivePrompt(key: string): string {
  const detail = getNodePrompt(key);
  return detail ? detail.prompt : "";
}

export function setNodePrompt(key: string, prompt: string): NodePromptDetail | null {
  const node = DEFAULT_NODES.find((n) => n.key === key);
  if (!node) return null;
  if (!prompt || !prompt.trim()) throw new Error("提示词不能为空");
  const overrides = loadOverrides();
  overrides[key] = { prompt: prompt.trim(), updatedAt: new Date().toISOString() };
  saveOverrides(overrides);
  return getNodePrompt(key);
}

export function resetNodePrompt(key: string): NodePromptDetail | null {
  const node = DEFAULT_NODES.find((n) => n.key === key);
  if (!node) return null;
  const overrides = loadOverrides();
  if (overrides[key]) {
    delete overrides[key];
    saveOverrides(overrides);
  }
  return getNodePrompt(key);
}
