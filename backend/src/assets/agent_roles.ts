/**
 * Agent 角色蓝图（多 Agent 讨论架构 Phase 1）
 *
 * 角色蓝图是可复用的 Agent 角色资产，用于多 Agent 讨论场景。
 * 内置 5 个基础角色：冲突制造者、情感锚点、意外推手、世界守护者、合成者。
 * 用户可自定义扩展，存储在 data/agent-roles.json。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PROJECT_ROOT } from "../config/paths.js";

export type AgentRoleCategory = "proposer" | "synthesizer" | "reviewer";

export interface AgentRoleModelConfig {
  mode: "reference" | "custom";
  globalConfigId?: string;
  custom?: {
    modelId: string;
    temperature: number;
    maxTokens?: number;
    topP?: number;
  };
}

export interface AgentRoleContextConfig {
  sharedContextKeys: string[];
  roleFocusHint: string;
}

export interface AgentRoleAsset {
  id: string;
  name: string;
  description: string;
  category: AgentRoleCategory;
  systemPrompt: string;
  promptVariables?: string[];
  modelConfig: AgentRoleModelConfig;
  contextConfig: AgentRoleContextConfig;
  createdAt: string;
  updatedAt: string;
  isBuiltin: boolean;
}

const AGENT_ROLES_FILE = path.join(PROJECT_ROOT, "data", "agent-roles.json");

/** 内置 Agent 角色（5 个基础角色） */
export const BUILTIN_AGENT_ROLES: AgentRoleAsset[] = [
  {
    id: "builtin-conflict-driver",
    name: "冲突制造者",
    description: "专注于戏剧冲突，寻找人物之间的利益矛盾和价值观碰撞",
    category: "proposer",
    systemPrompt: "你是一个专注于戏剧冲突的编剧顾问。你的核心关注点是：\n- 人物之间的利益是否对立？\n- 价值观是否碰撞？\n- 是否有\"两难选择\"的情境？\n\n当看到平淡的剧情时，你要问：\n\"这里如果让两个角色的目标互相阻碍，会发生什么？\"\n\n你倾向于让角色面临艰难选择，暴露隐藏的矛盾，制造意外的人际张力。\n你反对过于和谐的解决方案、角色之间没有摩擦的对话、轻易达成的共识。",
    modelConfig: { mode: "custom", custom: { modelId: "", temperature: 0.8 } },
    contextConfig: { sharedContextKeys: ["worldview", "characters", "current_chapter"], roleFocusHint: "重点关注人物之间的利益冲突和价值观碰撞" },
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    isBuiltin: true,
  },
  {
    id: "builtin-emotional-anchor",
    name: "情感锚点",
    description: "确保人物动机可信、情感弧线完整",
    category: "proposer",
    systemPrompt: "你是一个专注于人物心理和情感真实性的顾问。你的核心关注点是：\n- 角色的行为是否符合已建立的性格？\n- 情感转变是否有足够的铺垫？\n- 读者能否共情这个角色的处境？\n\n当看到剧情转折时，你要问：\n\"这个角色为什么会在这个时刻做出这个选择？之前的经历是否支撑了这个决定？\"\n\n你倾向于细腻的情感铺垫、角色内心矛盾的外化、让读者感受到挣扎。\n你反对突兀的性格转变、为剧情牺牲人物逻辑、情感过于直白。",
    modelConfig: { mode: "custom", custom: { modelId: "", temperature: 0.6 } },
    contextConfig: { sharedContextKeys: ["worldview", "characters", "current_chapter"], roleFocusHint: "重点关注人物动机的可信度和情感弧线的完整性" },
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    isBuiltin: true,
  },
  {
    id: "builtin-surprise-engineer",
    name: "意外推手",
    description: "寻找翻转点，打破读者预期",
    category: "proposer",
    systemPrompt: "你是一个专注于剧情惊喜和反转的顾问。你的核心关注点是：\n- 读者现在预期什么？\n- 如何打破这个预期但又合理？\n- 有哪些伏笔可以在此刻引爆？\n\n当看到剧情发展时，你要问：\n\"如果反过来呢？如果这个看似正确的线索其实是误导呢？\"\n\n你倾向于伏笔的巧妙回收、视角突然转换、无关细节突然变得重要。\n你反对无铺垫的机械降神、为反转而反转、破坏世界观一致性。",
    modelConfig: { mode: "custom", custom: { modelId: "", temperature: 0.9 } },
    contextConfig: { sharedContextKeys: ["worldview", "characters", "current_chapter", "foreshadow"], roleFocusHint: "重点关注如何打破读者预期，寻找可以引爆的伏笔" },
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    isBuiltin: true,
  },
  {
    id: "builtin-world-guardian",
    name: "世界守护者",
    description: "维护设定一致性，防止剧情崩坏",
    category: "proposer",
    systemPrompt: "你是一个专注于世界观一致性和逻辑自洽的顾问。你的核心关注点是：\n- 这个剧情是否符合已建立的规则？\n- 时间线、地理位置、能力限制是否合理？\n- 是否有未解释的矛盾？\n\n当看到剧情发展时，你要问：\n\"根据已建立的规则，这个角色现在是否应该有能力做到这件事？\"\n\n你倾向于严格的设定遵守、清晰的因果链条、对细节的精确把控。\n你反对为方便而修改规则、未解释的能力突破、时间线矛盾。",
    modelConfig: { mode: "custom", custom: { modelId: "", temperature: 0.4 } },
    contextConfig: { sharedContextKeys: ["worldview", "characters", "current_chapter", "dynamic_settings"], roleFocusHint: "重点关注世界观一致性和逻辑自洽" },
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    isBuiltin: true,
  },
  {
    id: "builtin-synthesizer",
    name: "合成者",
    description: "整合多方意见，生成统一方案",
    category: "synthesizer",
    systemPrompt: "你是一个资深的剧情总监，负责整合多个顾问的意见，形成最终的剧情方案。\n\n你的工作流程：\n1. 识别所有提案中的共同点（这些通常是核心要素）\n2. 识别争议点（这些是需要创造性解决方案的地方）\n3. 对于每个争议，找到能同时满足多方关切的方案\n4. 确保最终方案既有张力又逻辑自洽\n\n关键原则：\n- 不要简单投票或取平均值\n- 保留有价值的冲突（剧情需要张力）\n- 解决无价值的矛盾（逻辑需要自洽）\n- 明确标注哪些是妥协、哪些是创新",
    modelConfig: { mode: "custom", custom: { modelId: "", temperature: 0.5 } },
    contextConfig: { sharedContextKeys: ["worldview", "characters", "current_chapter"], roleFocusHint: "整合所有提案和质疑，生成统一的剧情方案" },
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    isBuiltin: true,
  },
];

let _customRoles: AgentRoleAsset[] | null = null;

function loadCustomRoles(): AgentRoleAsset[] {
  if (_customRoles !== null) return _customRoles;
  try {
    if (fs.existsSync(AGENT_ROLES_FILE)) {
      const data = JSON.parse(fs.readFileSync(AGENT_ROLES_FILE, "utf-8"));
      _customRoles = Array.isArray(data) ? data : [];
    } else {
      _customRoles = [];
    }
  } catch (err) {
    console.warn("读取 agent-roles.json 失败:", err);
    _customRoles = [];
  }
  return _customRoles;
}

function saveCustomRoles(): void {
  if (_customRoles === null) return;
  fs.mkdirSync(path.dirname(AGENT_ROLES_FILE), { recursive: true });
  fs.writeFileSync(AGENT_ROLES_FILE, JSON.stringify(_customRoles, null, 2), "utf-8");
}

/** 获取所有 Agent 角色（内置 + 自定义） */
export function listAgentRoles(): AgentRoleAsset[] {
  return [...BUILTIN_AGENT_ROLES, ...loadCustomRoles()];
}

/** 获取单个 Agent 角色 */
export function getAgentRole(id: string): AgentRoleAsset | null {
  const builtin = BUILTIN_AGENT_ROLES.find((r) => r.id === id);
  if (builtin) return builtin;
  return loadCustomRoles().find((r) => r.id === id) ?? null;
}

/** 创建自定义 Agent 角色 */
export function createAgentRole(data: Omit<AgentRoleAsset, "id" | "createdAt" | "updatedAt" | "isBuiltin">): AgentRoleAsset {
  const role: AgentRoleAsset = {
    ...data,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isBuiltin: false,
  };
  const custom = loadCustomRoles();
  custom.push(role);
  saveCustomRoles();
  return role;
}

/** 更新 Agent 角色（内置角色也可修改，但 isBuiltin 字段不可改变） */
export function updateAgentRole(id: string, patch: Partial<Omit<AgentRoleAsset, "id" | "isBuiltin">>): AgentRoleAsset | null {
  // 先检查是否是内置角色
  const builtinIdx = BUILTIN_AGENT_ROLES.findIndex((r) => r.id === id);
  if (builtinIdx >= 0) {
    // 更新内置角色
    const role = BUILTIN_AGENT_ROLES[builtinIdx];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue;
      if (k === "isBuiltin") continue; // 不允许改变 isBuiltin
      (role as unknown as Record<string, unknown>)[k] = v;
    }
    role.updatedAt = new Date().toISOString();
    return role;
  }
  
  // 否则更新自定义角色
  const custom = loadCustomRoles();
  const idx = custom.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const role = custom[idx];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) continue;
    if (k === "isBuiltin") continue;
    (role as unknown as Record<string, unknown>)[k] = v;
  }
  role.updatedAt = new Date().toISOString();
  saveCustomRoles();
  return role;
}

/** 删除自定义 Agent 角色（内置角色不可删除） */
export function deleteAgentRole(id: string): boolean {
  const custom = loadCustomRoles();
  const idx = custom.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  custom.splice(idx, 1);
  saveCustomRoles();
  return true;
}

/** 复制角色为自定义角色（可用于修改内置角色的副本） */
export function duplicateAgentRole(id: string): AgentRoleAsset | null {
  const source = getAgentRole(id);
  if (!source) return null;
  const copy: AgentRoleAsset = {
    ...JSON.parse(JSON.stringify(source)),
    id: randomUUID(),
    name: source.name + " (副本)",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isBuiltin: false,
  };
  const custom = loadCustomRoles();
  custom.push(copy);
  saveCustomRoles();
  return copy;
}



