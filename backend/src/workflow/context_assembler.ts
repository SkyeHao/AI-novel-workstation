/**
 * 上下文组装器（工单 05 分层上下文 L1/L2/L3）。
 *
 * 给每个发言 Agent 按固定顺序组装上下文：
 *   系统提示（角色蓝图 + 角色特性）→ 静态设定（角色 sharedContextKeys）
 *   → L3 全局要点（关键议题 / 作者历史指令）→ L2 近期脉络（滚动摘要）
 *   → L1 最近完整消息 → 触发消息（被回应原文）。
 *
 * 按模型窗口控制 token 预算：超限时逐级降级（L2 压缩 → 静态截断 → L1 裁剪 → 头部截断），
 * 绝不硬超窗口，任务指令始终保留。
 */
import type { ChatMember, ChatMessageRecord } from "./chat_session.js";

export interface ContextLayer {
  key: "static" | "l3" | "l2" | "l1" | "trigger" | "task" | "head";
  label: string;
  text: string;
}

export interface ContextAssemblerOptions {
  /** L1 最近完整消息条数，默认 5 */
  l1Count?: number;
  /** L2 近期脉络条数，默认 20 */
  l2Count?: number;
  /** 上下文 token 预算（作用于 user 提示），默认 8000 */
  maxTokens?: number;
  /** 静态设定默认注入键（成员 role 的 sharedContextKeys 优先） */
  sharedContextKeys?: string[];
  /** 单条消息摘要最大字符数，默认 60 */
  maxSummaryChars?: number;
  /** 静态设定单值最大字符数，默认 300 */
  maxStaticChars?: number;
  /** token 计数函数，默认按 2 字符/token 近似 */
  countTokens?: (text: string) => number;
}

export interface AssembleContextInput {
  member: ChatMember;
  topic: string;
  messages: ChatMessageRecord[];
  staticContext: Record<string, string>;
  triggerMessage?: ChatMessageRecord;
  authorInstructions?: string[];
  taskPrompt: string;
}

export interface AssembleContextResult {
  systemPrompt: string;
  userPrompt: string;
  layers: ContextLayer[];
  tokens: number;
  degraded: boolean;
}

function defaultCountTokens(text: string): number {
  return text ? Math.ceil(text.length / 2) : 0;
}

function compactText(text: string, maxChars: number): string {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "…";
}

export class ContextAssembler {
  private _opts: {
    l1Count: number;
    l2Count: number;
    maxTokens: number;
    sharedContextKeys: string[];
    maxSummaryChars: number;
    maxStaticChars: number;
    countTokens: (text: string) => number;
  };

  constructor(options: ContextAssemblerOptions = {}) {
    this._opts = {
      l1Count: options.l1Count ?? 5,
      l2Count: options.l2Count ?? 20,
      maxTokens: options.maxTokens ?? 8000,
      sharedContextKeys: options.sharedContextKeys ?? [],
      maxSummaryChars: options.maxSummaryChars ?? 60,
      maxStaticChars: options.maxStaticChars ?? 300,
      countTokens: options.countTokens ?? defaultCountTokens,
    };
  }

  assemble(input: AssembleContextInput): AssembleContextResult {
    const member = input.member;
    const roleTraits = "角色定位：" + member.description + "（" + member.name + "）";
    const systemPrompt = [member.systemPrompt, roleTraits].filter(Boolean).join("\n\n");

    // ---- 静态设定（角色 sharedContextKeys 优先，其次配置默认键，最后全部键） ----
    const memberKeys =
      member.sharedContextKeys && member.sharedContextKeys.length > 0
        ? member.sharedContextKeys
        : this._opts.sharedContextKeys.length > 0
          ? this._opts.sharedContextKeys
          : Object.keys(input.staticContext);
    const staticLines = memberKeys
      .map((k) => {
        const v = input.staticContext[k];
        return v && v.length > 0 ? "- " + k + "：" + v : "";
      })
      .filter(Boolean);
    const staticLayer: ContextLayer = {
      key: "static",
      label: "静态设定",
      text: staticLines.length > 0 ? "【静态设定】\n" + staticLines.join("\n") : "",
    };

    // ---- L3 全局要点 ----
    const l3Lines = ["- 关键议题：" + input.topic];
    const author = (input.authorInstructions ?? []).filter(Boolean);
    if (author.length > 0) {
      l3Lines.push("- 作者历史指令：");
      l3Lines.push(...author.map((a) => "  · " + a));
    }
    const l3Layer: ContextLayer = { key: "l3", label: "全局要点", text: "【全局要点】\n" + l3Lines.join("\n") };

    // ---- L2 近期脉络（滚动摘要，逐条压缩） ----
    const l2Msgs = input.messages.slice(-(this._opts.l1Count + this._opts.l2Count), -this._opts.l1Count);
    const l2Layer: ContextLayer = {
      key: "l2",
      label: "近期脉络",
      text:
        l2Msgs.length > 0
          ? "【近期脉络】\n" +
            l2Msgs.map((m) => "「" + m.memberName + "」：" + compactText(m.content, this._opts.maxSummaryChars)).join("\n")
          : "",
    };

    // ---- L1 最近完整消息 ----
    const l1Msgs = input.messages.slice(-this._opts.l1Count);
    const l1Layer: ContextLayer = {
      key: "l1",
      label: "最近对话",
      text: l1Msgs.length > 0 ? "【最近对话】\n" + l1Msgs.map((m) => "「" + m.memberName + "」：" + m.content).join("\n") : "",
    };

    // ---- 触发消息（被回应的原文） ----
    const triggerLayer: ContextLayer = {
      key: "trigger",
      label: "回应对象",
      text: input.triggerMessage
        ? "【回应对象】\n「" + input.triggerMessage.memberName + "」：" + input.triggerMessage.content
        : "",
    };

    // ---- 任务 ----
    const taskLayer: ContextLayer = { key: "task", label: "任务", text: input.taskPrompt };

    const initial = [staticLayer, l3Layer, l2Layer, l1Layer, triggerLayer, taskLayer].filter((l) => l.text.length > 0);
    const enforced = this._enforceBudget(initial);
    return {
      systemPrompt,
      userPrompt: enforced.layers.map((l) => l.text).join("\n\n"),
      layers: enforced.layers,
      tokens: enforced.tokens,
      degraded: enforced.degraded,
    };
  }

  private _enforceBudget(layers: ContextLayer[]): { layers: ContextLayer[]; tokens: number; degraded: boolean } {
    const count = this._opts.countTokens;
    let total = layers.reduce((s, l) => s + count(l.text), 0);
    if (total <= this._opts.maxTokens) return { layers, tokens: total, degraded: false };

    // 超预算：开始降级
    let degraded = true;

    // ① 压缩 L2（降级摘要粒度）
    const l2 = layers.find((l) => l.key === "l2");
    if (l2) {
      const note = "【近期脉络】\n（因预算限制，近期脉络已压缩）";
      if (count(note) < count(l2.text)) l2.text = note;
    }

    // ② 截断静态设定超长值
    const stat = layers.find((l) => l.key === "static");
    if (stat) {
      const lines = stat.text.split("\n");
      const header = lines[0] ?? "【静态设定】";
      let changed = false;
      const body = lines.slice(1).map((line) => {
        if (line.length > this._opts.maxStaticChars) {
          changed = true;
          return line.slice(0, this._opts.maxStaticChars) + "…（已截断）";
        }
        return line;
      });
      if (changed) stat.text = [header, ...body].join("\n");
    }

    // ③ 裁剪 L1（保留最新消息，丢掉最旧）
    const l1 = layers.find((l) => l.key === "l1");
    if (l1) {
      const lines = l1.text.split("\n");
      const header = lines[0] ?? "【最近对话】";
      let body = lines.slice(1);
      while (body.length > 1) {
        const totalNow = layers.reduce((s, l) => s + count(l.text), 0);
        if (totalNow <= this._opts.maxTokens) break;
        body = body.slice(1);
        l1.text = [header, ...body].join("\n");
      }
    }

    // ④ 硬预算：截断上下文头部（保留任务指令）
    total = layers.reduce((s, l) => s + count(l.text), 0);
    if (total > this._opts.maxTokens) {
      const task = layers.find((l) => l.key === "task");
      const taskText = task ? task.text : "";
      const taskTokens = count(taskText);
      const head = layers
        .filter((l) => l.key !== "task")
        .map((l) => l.text)
        .join("\n\n");
      const maxHeadChars = Math.max(0, Math.floor((this._opts.maxTokens - taskTokens) * 2));
      const keptHead = head.slice(-maxHeadChars);
      const headLayer: ContextLayer = { key: "head", label: "上下文", text: keptHead };
      layers = [headLayer].filter((l) => l.text.length > 0);
      if (task) layers.push(task);
      total = layers.reduce((s, l) => s + count(l.text), 0);
    }

    return { layers, tokens: total, degraded };
  }
}
