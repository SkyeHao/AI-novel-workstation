/** 上下文编排器（ADR-0005 / T7，TS 版，迁移自 agent/orchestrator.py）。
 * ContextOrchestrator 取代旧 ContextManager，全量负责 系统提示/记忆召回/拼接/压缩。
 * 协作对象：TokenCompressor（预算/裁剪/摘要压缩）、PromptAssembler（按状态拼注入块）。 */
import type { LLMClient } from "../llm/client.js";
import { ChatMessage, Role } from "../llm/models.js";
import type { MemoryStore } from "../storage/memory_store.js";
import { createRetriever, type MemoryHit, type MemoryRetriever } from "../storage/retriever.js";
import { getStateNode } from "../storage/states.js";
import { DynamicSettingsStore } from "../storage/dynamic_settings.js";

export const SUMMARY_HEADER = "\n\n## 【历史对话摘要（旧消息已压缩）】\n";

export interface AssemblyOptions {
  project_id: string;
  state: string;
  user_message: string;
  include_memory: boolean;
  include_settings: boolean;
  include_summaries: boolean;
  memory_limit: number;
  summary_levels: number[];
  context_assembly_ref: string;
}

export type SettingsLoader = (projectId: string, settingType: string) => Record<string, unknown> | null;

// ======================================================================
// TokenCompressor
// ======================================================================

export class TokenCompressor {
  context_window: number;
  reserved_output_tokens: number;
  max_message_tokens: number;
  max_observation_tokens: number;
  enable_summary: boolean;

  constructor(
    private _client: LLMClient,
    context_window?: number,
    reserved_output_tokens?: number,
    max_message_tokens = 3000,
    max_observation_tokens = 1500,
    enable_summary = true
  ) {
    this.context_window = context_window ?? Number(process.env.MODEL_CONTEXT_WINDOW ?? "32768");
    this.reserved_output_tokens = reserved_output_tokens ?? Number(process.env.MODEL_RESERVED_OUTPUT_TOKENS ?? "2048");
    this.max_message_tokens = max_message_tokens;
    this.max_observation_tokens = max_observation_tokens;
    this.enable_summary = enable_summary;
  }

  get budget(): number {
    return Math.max(this.context_window - this.reserved_output_tokens, 512);
  }

  estimate(messages: ChatMessage[]): number {
    try {
      return this._client.count_tokens(messages);
    } catch {
      return 0;
    }
  }

  trim(messages: ChatMessage[]): { kept: ChatMessage[]; dropped: ChatMessage[] } {
    const kept = messages.map((m) => this._truncateMessage(m));
    let total = this.estimate(kept);
    if (total <= this.budget) return { kept, dropped: [] };

    const dropped: ChatMessage[] = [];
    let i = 1; // 始终保留系统提示（索引 0）
    while (total > this.budget && i < kept.length) {
      const msg = kept[i]!;
      dropped.push(msg);
      total -= Math.max(this.estimate([msg]) - 2, 0);
      i += 1;
      // assistant(function_call) 与其 function 结果成块保留配对
      if (msg.function_call) {
        while (i < kept.length && kept[i]!.role === Role.FUNCTION) {
          dropped.push(kept[i]!);
          total -= Math.max(this.estimate([kept[i]!]) - 2, 0);
          i += 1;
        }
      }
      while (i < kept.length && kept[i]!.role === Role.FUNCTION) {
        dropped.push(kept[i]!);
        total -= Math.max(this.estimate([kept[i]!]) - 2, 0);
        i += 1;
      }
    }
    const finalKept = [kept[0]!, ...kept.slice(i)];
    console.log(`上下文裁剪: 丢弃 ${dropped.length} 条, 剩余 ${finalKept.length} 条`);
    return { kept: finalKept, dropped };
  }

  async process(messages: ChatMessage[], signal?: AbortSignal): Promise<ChatMessage[]> {
    const { kept, dropped } = this.trim(messages);
    if (dropped.length > 0 && this.enable_summary) {
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      const summary = await this._summarize(dropped, signal);
      if (summary) this._injectSummary(kept[0]!, summary);
      if (this.estimate(kept) > this.budget) {
        return this.trim(kept).kept;
      }
    }
    return kept;
  }

  private _truncateMessage(msg: ChatMessage): ChatMessage {
    if (!msg.content) return msg;
    const limit = msg.role === Role.FUNCTION ? this.max_observation_tokens : this.max_message_tokens;
    let tokens: number;
    try {
      tokens = this._client.count_text_tokens(msg.content);
    } catch {
      return msg;
    }
    if (tokens <= limit) return msg;
    const ratio = limit / Math.max(tokens, 1);
    const maxChars = Math.max(Math.floor(msg.content.length * ratio), 200);
    msg.content = msg.content.slice(0, maxChars) + "\n...[已截断]";
    return msg;
  }

  private _injectSummary(systemMsg: ChatMessage, summary: string): void {
    let base: string;
    if (systemMsg.content.includes(SUMMARY_HEADER)) {
      base = systemMsg.content.split(SUMMARY_HEADER)[0]!;
    } else {
      base = systemMsg.content;
    }
    systemMsg.content = base + SUMMARY_HEADER + summary;
  }

  private async _summarize(dropped: ChatMessage[], signal?: AbortSignal): Promise<string> {
    try {
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      const serialized = dropped
        .filter((m) => m.content)
        .map((m) => `[${m.role}] ${m.content.slice(0, 800)}`)
        .join("\n");
      if (!serialized) return "";
      const messages = [
        new ChatMessage(
          Role.SYSTEM,
          "你是一个对话压缩器。下面是从创作会话历史裁剪掉的旧对话。" +
            "请提炼对后续创作仍关键的信息，压缩成 3-5 条要点：" +
            "1) 作者核心需求与约束；2) 已确认决策；3) 已完成关键动作；4) 待办。中文输出要点列表。"
        ),
        new ChatMessage(Role.USER, `历史对话：\n${serialized}\n\n要点：`),
      ];
      const response = await this._client.achat(messages, { temperature: 0.2, max_tokens: 800 }, signal);
      const summary = response.content.trim();
      if (this._client.count_text_tokens(summary) > 600) {
        return summary.slice(0, 2000) + "\n...[摘要已截断]";
      }
      return summary;
    } catch (err) {
      console.warn(`历史摘要生成失败（不影响主流程）: ${err}`);
      return "";
    }
  }
}

// ======================================================================
// PromptAssembler：按状态拼注入块
// ======================================================================

export class PromptAssembler {
  constructor(
    private _memory: MemoryStore | null = null,
    private _retriever: MemoryRetriever | null = null,
    private _settingsLoader: SettingsLoader | null = null,
    private _dynamicStore: DynamicSettingsStore | null = null
  ) {}

  assemble(messages: ChatMessage[], options: AssemblyOptions): ChatMessage[] {
    const stateNode = getStateNode(options.state);
    const blocks: string[] = [];

    // 1 状态说明
    blocks.push(
      `当前创作状态：${stateNode.label}（key=${stateNode.key}）。状态关联上下文规则：${stateNode.context_assembly_ref}`
    );

    // 2 记忆召回（turn 前预注入）
    if (options.include_memory && this._retriever && options.project_id) {
      try {
        const hits = this._retriever.injectAll(options.project_id, { state: options.state, limit: options.memory_limit });
        if (hits.length > 0) {
          const lines = hits
            .map((h: MemoryHit) => {
              const desc = String(h.data.fact ?? h.data.desc ?? "");
              return desc ? `- [${h.kind}] ${desc}` : "";
            })
            .filter((l) => l);
          if (lines.length > 0) blocks.push("## 【记忆召回（预注入）】\n" + lines.join("\n"));
        }
      } catch (err) {
        console.warn(`记忆召回失败（降级继续）: ${err}`);
      }
    }

    // 3 分层摘要兜底（long-range 记忆）
    if (options.include_summaries && this._memory && options.project_id) {
      try {
        const summaries: string[] = [];
        for (const level of options.summary_levels) {
          const content = this._memory.loadSummary(options.project_id, level);
          if (content) summaries.push(`[L${level}] ${content.slice(0, 500)}`);
        }
        if (summaries.length > 0) blocks.push("## 【分层摘要（long-range 记忆）】\n" + summaries.join("\n"));
      } catch (err) {
        console.warn(`分层摘要加载失败: ${err}`);
      }
    }

    // 4 相关设定片段
    if (options.include_settings && this._settingsLoader && options.project_id) {
      try {
        for (const key of ["worldview", "characters"]) {
          const data = this._settingsLoader(options.project_id, key);
          if (data) {
            blocks.push(`## 【设定片段：${key}】\n${JSON.stringify(data).slice(0, 600)}`);
          }
        }
      } catch (err) {
        console.warn(`设定加载失败: ${err}`);
      }
    }

    // 5 动态设定预注入（按节点：正文/审阅注入关键动态账本，其余节点不注入避免浪费上下文）
    if (this._dynamicStore && options.project_id) {
      try {
        const dynBlocks = dynamicInjectBlocks(this._dynamicStore, options.project_id, options.state);
        if (dynBlocks.length > 0) {
          blocks.push("## 【动态设定预注入】\n" + dynBlocks.join("\n\n"));
        }
      } catch (err) {
        console.warn("动态设定预注入失败: " + err);
      }
    }

    if (blocks.length === 0) return messages;

    const composed = blocks.join("\n\n");
    if (messages.length === 0) {
      return [new ChatMessage(Role.SYSTEM, composed)];
    }
    const system = messages[0]!;
    if (system.role === Role.SYSTEM) {
      system.content = system.content + "\n\n---\n" + composed;
    } else {
      messages = [new ChatMessage(Role.SYSTEM, composed), ...messages];
    }
    return messages;
  }
}

// ======================================================================
// ContextOrchestrator：编排入口
// ======================================================================

export class ContextOrchestrator {
  private _assembler: PromptAssembler;
  private _compressor: TokenCompressor;

  constructor(
    private _client: LLMClient,
    private _memory: MemoryStore | null = null,
    retriever: MemoryRetriever | null = null,
    private _settingsLoader: SettingsLoader | null = null,
    private _dynamicStore: DynamicSettingsStore | null = null,
    compressor: TokenCompressor | null = null
  ) {
    const r = retriever ?? (this._memory ? createRetriever(this._memory) : null);
    this._assembler = new PromptAssembler(this._memory, r, this._settingsLoader, this._dynamicStore);
    this._compressor = compressor ?? new TokenCompressor(this._client);
  }

  async process(messages: ChatMessage[], opts: Partial<AssemblyOptions> = {}, signal?: AbortSignal): Promise<ChatMessage[]> {
    const options: AssemblyOptions = {
      project_id: opts.project_id ?? "",
      state: opts.state ?? "",
      user_message: opts.user_message ?? "",
      include_memory: opts.include_memory ?? true,
      include_settings: opts.include_settings ?? true,
      include_summaries: opts.include_summaries ?? true,
      memory_limit: opts.memory_limit ?? 10,
      summary_levels: opts.summary_levels ?? [2, 3, 4, 5],
      context_assembly_ref: opts.context_assembly_ref ?? "",
    };
    const assembled = this._assembler.assemble(messages, options);
    return this._compressor.process(assembled, signal);
  }
}
/** 按节点提取动态设定预注入块（写作：上一章钩子/人物状态/活跃伏笔/最近事件；审阅：摘要/读者已知/最近事件）。 */
export function dynamicInjectBlocks(
  dynamic: DynamicSettingsStore,
  projectId: string,
  state: string
): string[] {
  const blocks: string[] = [];
  if (state === "writing") {
    const sums = dynamic.load(projectId, "chapter_summaries");
    const hooks = dynamic.load(projectId, "hooks");
    const maxChapter = Math.max(
      0,
      ...(sums?.entries ?? []).map((e) => Number(e.chapter) || 0),
      ...(hooks?.entries ?? []).map((e) => Number(e.chapter) || 0)
    );
    if (maxChapter > 0) {
      const prevSum = (sums?.entries ?? []).find((e) => Number(e.chapter) === maxChapter);
      const prevHook = (hooks?.entries ?? []).find((e) => Number(e.chapter) === maxChapter);
      const hookText = prevHook
        ? String(prevHook.content ?? "")
        : prevSum && prevSum.hook
          ? (typeof prevSum.hook === "string" ? prevSum.hook : String((prevSum.hook as Record<string, unknown>).content ?? ""))
          : "";
      const summaryText = prevSum ? String(prevSum.summary ?? "") : "";
      if (summaryText || hookText) {
        const lines = ["上一章（第" + maxChapter + "章）："];
        if (summaryText) lines.push("摘要：" + summaryText.slice(0, 300));
        if (hookText) lines.push("章尾钩子：" + hookText);
        blocks.push(lines.join("\n"));
      }
    }
    const chars = dynamic.load(projectId, "characters");
    const charLines = (chars?.entries ?? [])
      .slice(0, 5)
      .map((e) => {
        const name = String(e.name ?? "");
        const status = String(e.status ?? "");
        const level = e.level === undefined || e.level === null || e.level === "" ? "" : "，等级" + e.level;
        const health = e.health === undefined || e.health === null || e.health === "" ? "" : "，健康" + e.health;
        return name + level + health + (status ? "：" + status : "");
      })
      .filter((l) => l);
    if (charLines.length) blocks.push("当前人物状态：" + charLines.join("；"));

    const fs = dynamic.load(projectId, "foreshadow");
    const active = (fs?.entries ?? [])
      .filter((e) => ["埋设", "悬置"].includes(String(e.status ?? "")))
      .slice(0, 5);
    if (active.length) {
      blocks.push(
        "活跃伏笔：" +
          active
            .map((e) => "第" + e.planted_chapter + "章埋设：" + String(e.description ?? ""))
            .join("；")
      );
    }

    const ev = dynamic.load(projectId, "events");
    const recent = [...(ev?.entries ?? [])]
      .sort((a, b) => (Number(b.chapter) || 0) - (Number(a.chapter) || 0))
      .slice(0, 3);
    if (recent.length) {
      blocks.push(
        "最近事件：" + recent.map((e) => "第" + e.chapter + "章：" + String(e.description ?? "")).join("；")
      );
    }
  } else if (state === "review") {
    const sums = dynamic.load(projectId, "chapter_summaries");
    const maxChapter = Math.max(0, ...(sums?.entries ?? []).map((e) => Number(e.chapter) || 0));
    if (maxChapter > 0) {
      const cur = (sums?.entries ?? []).find((e) => Number(e.chapter) === maxChapter);
      if (cur) blocks.push("第" + maxChapter + "章摘要：" + String(cur.summary ?? "").slice(0, 300));
    }
    const info = dynamic.load(projectId, "info_perspective");
    const infoDisplay = info?.display;
    const display = Array.isArray(infoDisplay) ? (infoDisplay as Array<Record<string, unknown>>) : [];
    if (display.length) {
      blocks.push("读者已知信息：" + display.slice(0, 5).map((e) => String(e.fact ?? "")).join("；"));
    }
    const ev = dynamic.load(projectId, "events");
    const recent = [...(ev?.entries ?? [])]
      .sort((a, b) => (Number(b.chapter) || 0) - (Number(a.chapter) || 0))
      .slice(0, 5);
    if (recent.length) {
      blocks.push(
        "最近事件：" + recent.map((e) => "第" + e.chapter + "章：" + String(e.description ?? "")).join("；")
      );
    }
  }
  return blocks;
}
