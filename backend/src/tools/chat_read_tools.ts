/**
 * 圆桌会议只读工具集
 * 前端只给基础信息（topic + 成员），上下文由Agent按需通过工具拉取
 * 所有工具只读，不写盘，不联网
 */
import { AbstractTool, ToolResult } from "./base.js";
import type { ProjectStore } from "../storage/project_store.js";
import { StructuredSettingsStore } from "../storage/structured_settings.js";
import { MemoryStore } from "../storage/memory_store.js";
import { DocumentRegistry } from "../storage/document_registry.js";

export interface ChatReadToolContext {
  projectId: string;
  projectStore: ProjectStore;
}

function truncate(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n...[已截断，共" + text.length + "字符]";
}

export class ReadWorldviewTool extends AbstractTool {
  readonly name = "read_worldview";
  readonly description = "读取本项目的世界观设定（结构化维度 + 文档原文），用于了解时代、规则、地理、势力等";
  readonly parameters = [];
  constructor(private ctx: ChatReadToolContext) { super(); }
  async execute(): Promise<ToolResult> {
    try {
      const store = new StructuredSettingsStore(this.ctx.projectStore);
      const data = store.loadWorldview(this.ctx.projectId);
      if (data) return new ToolResult(true, truncate(JSON.stringify(data, null, 2)));
      // 旧文档兜底
      const reg = new DocumentRegistry(this.ctx.projectStore);
      const doc = reg.read(this.ctx.projectId, "worldview");
      if (doc) return new ToolResult(true, truncate(doc.content));
      return new ToolResult(true, "（世界观尚未生成）");
    } catch (e) { return new ToolResult(false, "", String(e)); }
  }
}

export class ReadCharactersTool extends AbstractTool {
  readonly name = "read_characters";
  readonly description = "读取本项目的人物设定列表，包含姓名、性格、目标、缺陷、金手指、关系等";
  readonly parameters = [];
  constructor(private ctx: ChatReadToolContext) { super(); }
  async execute(): Promise<ToolResult> {
    try {
      const store = new StructuredSettingsStore(this.ctx.projectStore);
      const data = store.loadCharacters(this.ctx.projectId);
      if (data) return new ToolResult(true, truncate(JSON.stringify(data, null, 2)));
      const reg = new DocumentRegistry(this.ctx.projectStore);
      const doc = reg.read(this.ctx.projectId, "characters");
      if (doc) return new ToolResult(true, truncate(doc.content));
      return new ToolResult(true, "（人物设定尚未生成）");
    } catch (e) { return new ToolResult(false, "", String(e)); }
  }
}

export class ReadOutlineTool extends AbstractTool {
  readonly name = "read_outline";
  readonly description = "读取本项目的大纲结构，包含卷/篇/章的层级、任务、事件、伏笔等";
  readonly parameters = [];
  constructor(private ctx: ChatReadToolContext) { super(); }
  async execute(): Promise<ToolResult> {
    try {
      const store = new StructuredSettingsStore(this.ctx.projectStore);
      const data = store.loadOutline(this.ctx.projectId);
      if (data) return new ToolResult(true, truncate(JSON.stringify(data, null, 2)));
      const reg = new DocumentRegistry(this.ctx.projectStore);
      const doc = reg.read(this.ctx.projectId, "outline");
      if (doc) return new ToolResult(true, truncate(doc.content));
      return new ToolResult(true, "（大纲尚未生成）");
    } catch (e) { return new ToolResult(false, "", String(e)); }
  }
}

export class ReadCoreElementsTool extends AbstractTool {
  readonly name = "read_core_elements";
  readonly description = "读取本项目的核心要素（唯一事实源），包含主线、愿景、风格、世界观四件套";
  readonly parameters = [];
  constructor(private ctx: ChatReadToolContext) { super(); }
  async execute(): Promise<ToolResult> {
    try {
      const reg = new DocumentRegistry(this.ctx.projectStore);
      const doc = reg.read(this.ctx.projectId, "core-elements");
      if (doc) return new ToolResult(true, truncate(doc.content));
      return new ToolResult(true, "（核心要素尚未生成）");
    } catch (e) { return new ToolResult(false, "", String(e)); }
  }
}

export class ReadMemoryTool extends AbstractTool {
  readonly name = "read_memory";
  readonly description = "读取本项目的记忆（正典事实/伏笔台账/分层摘要），可按关键词过滤";
  readonly parameters = [
    { name: "query", type: "string", description: "关键词过滤（可选），如人物名、伏笔关键词", required: false, default: null },
    { name: "limit", type: "integer", description: "最大返回条数，默认10", required: false, default: 10 },
  ];
  constructor(private ctx: ChatReadToolContext) { super(); }
  async execute(kwargs: Record<string, unknown>): Promise<ToolResult> {
    try {
      const query = String(kwargs.query ?? "").trim().toLowerCase();
      const limit = Math.min(20, Math.max(1, Number(kwargs.limit ?? 10) || 10));
      const mem = new MemoryStore(this.ctx.projectStore);
      // MemoryStore 内部是按 projectId 隔离的，直接读
      const facts = mem.listFacts ? mem.listFacts(this.ctx.projectId) : [];
      const foreshadow = mem.listForeshadow ? mem.listForeshadow(this.ctx.projectId) : [];
      let out: any[] = [];
      if (Array.isArray(facts)) out = out.concat(facts.map((f: any) => ({ type: "fact", content: typeof f === "string" ? f : JSON.stringify(f) })));
      if (Array.isArray(foreshadow)) out = out.concat(foreshadow.map((f: any) => ({ type: "foreshadow", content: typeof f === "string" ? f : JSON.stringify(f) })));
      if (query) out = out.filter((x) => x.content.toLowerCase().includes(query));
      out = out.slice(0, limit);
      if (out.length === 0) return new ToolResult(true, query ? `（未找到包含"${query}"的记忆）` : "（暂无记忆）");
      return new ToolResult(true, truncate(out.map((x) => `[${x.type}] ${x.content}`).join("\n")));
    } catch (e) { return new ToolResult(false, "", String(e)); }
  }
}

export function createChatReadTools(ctx: ChatReadToolContext): AbstractTool[] {
  return [
    new ReadCoreElementsTool(ctx),
    new ReadWorldviewTool(ctx),
    new ReadCharactersTool(ctx),
    new ReadOutlineTool(ctx),
    new ReadMemoryTool(ctx),
  ];
}

