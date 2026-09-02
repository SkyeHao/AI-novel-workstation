/** 小说创作专用工具面（T4，ADR-0005）。
 * 新增：read_current_state / list_states / switch_state / memory_search。 */
import { AbstractTool, ToolResult } from "./base.js";
import { DEFAULT_STATES, getStatesByKeys, getStateNode, legacyStatusToNew } from "../storage/states.js";
import type { MemoryStore } from "../storage/memory_store.js";
import type { MemoryRetriever } from "../storage/retriever.js";
import type { ProjectStore } from "../storage/project_store.js";

export interface NovelToolContext {
  projectId: string;
  projectStore: ProjectStore;
  memory: MemoryStore;
  retriever: MemoryRetriever;
  /** 读取两级状态中的小说级锚点（current_state） */
  getCurrentState(): string;
  /** 切换小说级状态（写入 project 并返回新状态） */
  switchState(key: string): string;
  /** 当前工作单元（如 ch3），可为空 */
  getWorkUnit(): string;
  /** 读取该书启用的状态集合（可扩展，默认全部） */
  getEnabledStates(): string[];
}

export function createNovelToolCtx(ctx: NovelToolContext): NovelToolContext {
  return ctx;
}

function formatHits(hits: Array<{ kind: string; data: Record<string, unknown> }>): string {
  if (hits.length === 0) return "（无相关记忆命中）";
  const lines = hits.map((h) => {
    const d = h.data;
    const desc = String(d.fact ?? d.desc ?? "");
    return `- [${h.kind}] ${desc}`;
  });
  return lines.join("\n");
}

/** 读取当前小说级状态与工作单元状态（两级状态） */
export class ReadCurrentStateTool extends AbstractTool {
  constructor(private ctx: NovelToolContext) {
    super();
  }

  readonly name = "read_current_state";
  readonly description =
    "读取当前小说所处的创作状态（如创意孵化/世界观/人物/章纲/正文/审阅）以及当前工作单元（如第几章）。每次开始创作前建议先调用。";
  readonly parameters = [
    { name: "work_unit", type: "string", description: "可选：指定要查询的工作单元（如 ch3）", required: false, default: null },
  ];

  async execute(kwargs: Record<string, unknown>): Promise<ToolResult> {
    const key = this.ctx.getCurrentState();
    const node = getStateNode(key);
    const unit = kwargs.work_unit ? String(kwargs.work_unit) : this.ctx.getWorkUnit();
    const enabled = this.ctx.getEnabledStates();
    const project = this.ctx.projectStore.get(this.ctx.projectId);
    const lines = [
      `小说级状态：${node.label}（key=${node.key}）`,
      `状态上下文规则：${node.context_assembly_ref}`,
      `当前工作单元：${unit || "（未指定）"}`,
      `项目状态字段：${project.status}`,
      `启用状态集：${enabled.join(", ") || "（默认全部）"}`,
    ];
    return new ToolResult(true, lines.join("\n"));
  }
}

/** 列出全部可用创作状态 */
export class ListStatesTool extends AbstractTool {
  constructor(private ctx: NovelToolContext) {
    super();
  }

  readonly name = "list_states";
  readonly description = "列出本书可用的创作状态（灵感捕捉/世界观构建/人物塑造/大纲生成/正文生成/质量审查/文风优化）及当前处于哪个状态。";
  readonly parameters = [];

  async execute(): Promise<ToolResult> {
    const current = this.ctx.getCurrentState();
    const enabled = this.ctx.getEnabledStates();
    const states = getStatesByKeys(enabled);
    const lines = states.map((s) => {
      const mark = s.key === current ? "（当前）" : "";
      const flag = s.enabled ? "" : "（默认关闭）";
      return `- ${s.label} (key=${s.key})${mark}${flag}`;
    });
    return new ToolResult(true, `可用状态：\n${lines.join("\n")}`);
  }
}

/** 切换小说级状态（自由导航，单锚点） */
export class SwitchStateTool extends AbstractTool {
  constructor(private ctx: NovelToolContext) {
    super();
  }

  readonly name = "switch_state";
  readonly description =
    "切换当前小说级创作状态并重置 Agent 上下文组装规则，使后续对话聚焦于该状态的创作内容。" +
    "合法状态 key：ideation/worldview/characters/outline/writing/review/style。";
  readonly parameters = [
    { name: "state", type: "string", description: "目标状态 key", required: true, default: null },
    { name: "work_unit", type: "string", description: "可选：同步指定工作单元（如 ch3）", required: false, default: null },
  ];

  async execute(kwargs: Record<string, unknown>): Promise<ToolResult> {
    const target = String(kwargs.state ?? "").trim();
    if (!target) return new ToolResult(false, "", "state 不能为空");
    const allowed = ["ideation", "worldview", "characters", "outline", "writing", "review", "style"];
    if (!allowed.includes(target)) {
      return new ToolResult(false, "", `非法状态 key: ${target}，合法值: ${allowed.join("/")}`);
    }
    let next: string;
    try {
      next = this.ctx.switchState(target);
    } catch (err) {
      return new ToolResult(false, "", err instanceof Error ? err.message : String(err));
    }
    const node = getStateNode(next);
    return new ToolResult(true, `已切换到状态：${node.label}（key=${node.key}）。后续对话将按该状态的上下文规则组装。`);
  }
}

/** 记忆检索工具（T6 三管召回中的 Agent 主动读取） */
export class MemorySearchTool extends AbstractTool {
  constructor(private ctx: NovelToolContext) {
    super();
  }

  readonly name = "memory_search";
  readonly description =
    "在本书的单书记忆库中检索相关记忆（正典事实/伏笔台账/人物快照）。" +
    "当你需要确认某个设定、人物关系、已埋伏笔或历史决策时调用。";
  readonly parameters = [
    { name: "query", type: "string", description: "检索关键词（人物名、地名、设定名等）", required: false, default: "" },
    { name: "state", type: "string", description: "按小说级状态过滤（可选）", required: false, default: "" },
    { name: "source", type: "string", description: "按来源/工作单元过滤（可选，如 ch12）", required: false, default: "" },
    { name: "limit", type: "integer", description: "返回条数上限（默认 10）", required: false, default: 10 },
  ];

  async execute(kwargs: Record<string, unknown>): Promise<ToolResult> {
    const query = String(kwargs.query ?? "");
    const state = String(kwargs.state ?? "");
    const source = String(kwargs.source ?? "");
    const limit = Number(kwargs.limit ?? 10);
    try {
      const hits = this.ctx.retriever.retrieve(this.ctx.projectId, { query, state, source, limit });
      return new ToolResult(true, formatHits(hits));
    } catch (err) {
      return new ToolResult(false, "", err instanceof Error ? err.message : String(err));
    }
  }
}
