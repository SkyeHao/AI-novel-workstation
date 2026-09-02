/** 上下文压缩增强（工单 04）。
 * 四机制：模型感知窗口、阈值自动触发、摘要持久化、Agent 主动压缩工具。 */
import type { LLMClient } from "../llm/client.js";
import { ChatMessage, Role } from "../llm/models.js";
import type { MemoryStore } from "../storage/memory_store.js";

export type ModelContextMap = Record<string, number>;

export interface CompressionOptions {
  model?: string;
  modelContextMap?: ModelContextMap;
  contextWindow?: number;
  reservedOutputTokens?: number;
  compressionRatio?: number;
  targetRatio?: number;
  keepRecent?: number;
}

export interface CompressResult {
  compressed: boolean;
  reason?: string;
  audit?: {
    beforeUsage: number;
    afterUsage: number;
    droppedCount: number;
  };
}

export class ContextCompressionEnhanced {
  private _client: LLMClient;
  private _options: Required<CompressionOptions>;

  constructor(client: LLMClient, options: CompressionOptions = {}) {
    this._client = client;
    this._options = {
      model: options.model ?? "default",
      modelContextMap: options.modelContextMap ?? {},
      contextWindow: options.contextWindow ?? this._resolveContextWindow(options.model, options.modelContextMap),
      reservedOutputTokens: options.reservedOutputTokens ?? 2048,
      compressionRatio: options.compressionRatio ?? 0.8,
      targetRatio: options.targetRatio ?? 0.6,
      keepRecent: options.keepRecent ?? 12,
    };
  }

  get contextWindow(): number {
    return this._options.contextWindow;
  }

  get budget(): number {
    return this._options.contextWindow - this._options.reservedOutputTokens;
  }

  /** 按模型解析上下文窗口 */
  private _resolveContextWindow(model?: string, modelMap?: ModelContextMap): number {
    if (model && modelMap && modelMap[model]) {
      return modelMap[model];
    }
    // 回退链：显式配置 → 映射表 → 默认 32768
    return 32768;
  }

  /** 估计消息占用 */
  estimate(messages: ChatMessage[]): number {
    return this._client.count_tokens(messages);
  }

  /** 估计单条消息占用 */
  private _estimateMessage(message: ChatMessage): number {
    return this._client.count_tokens([message]);
  }

  /** 处理消息：自动压缩 */
  async process(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const usage = this.estimate(messages);
    const ratio = usage / this._options.contextWindow;

    if (ratio < this._options.compressionRatio) {
      return messages;
    }

    // 生成历史摘要（排除系统提示外的全部旧消息）
    const systemMsg = messages[0];
    const oldMessages = messages.slice(1);
    const summary = await this._summarize(oldMessages);

    const result: ChatMessage[] = [];
    let baseUsage = 0;
    if (systemMsg) {
      const systemWithSummary = new ChatMessage(
        Role.SYSTEM,
        systemMsg.content + "\n\n## 历史对话摘要\n" + summary
      );
      baseUsage = this._estimateMessage(systemWithSummary);
      result.push(systemWithSummary);
    }

    // 目标水位：压缩后占用不超过 contextWindow × targetRatio
    const targetUsage = this._options.contextWindow * this._options.targetRatio;
    const budget = targetUsage - baseUsage;

    // 在预算内尽量保留最近消息，最多 keepRecent 条
    const recentMessages = messages.slice(1);
    let used = 0;
    const kept: ChatMessage[] = [];
    for (let i = recentMessages.length - 1; i >= 0 && kept.length < this._options.keepRecent; i--) {
      const msgUsage = this._estimateMessage(recentMessages[i]);
      if (used + msgUsage > budget) break;
      kept.unshift(recentMessages[i]);
      used += msgUsage;
    }
    result.push(...kept);

    return result;
  }

  /** 主动压缩上下文 */
  async compressContext(
    messages: ChatMessage[],
    options: { reason?: string; keepRecent?: number } = {}
  ): Promise<CompressResult> {
    const beforeUsage = this.estimate(messages);
    const keepRecent = options.keepRecent ?? this._options.keepRecent;

    const systemMsg = messages[0];
    const recentMessages = messages.slice(-keepRecent);
    const oldMessages = messages.slice(1, -keepRecent);

    if (oldMessages.length === 0) {
      return { compressed: false, reason: options.reason };
    }

    const summary = await this._summarize(oldMessages);
    
    const result: ChatMessage[] = [];
    if (systemMsg) {
      const systemWithSummary = new ChatMessage(
        Role.SYSTEM,
        systemMsg.content + "\n\n## 历史对话摘要\n" + summary
      );
      result.push(systemWithSummary);
    }
    result.push(...recentMessages);

    const afterUsage = this.estimate(result);

    return {
      compressed: true,
      reason: options.reason,
      audit: {
        beforeUsage,
        afterUsage,
        droppedCount: oldMessages.length,
      },
    };
  }

  /** 恢复会话：注入摘要 */
  resumeWithSummary(summary: string): ChatMessage[] {
    return [
      new ChatMessage(Role.SYSTEM, "## 历史对话摘要\n" + summary),
    ];
  }

  /** 生成摘要 */
  private async _summarize(messages: ChatMessage[]): Promise<string> {
    if (messages.length === 0) return "";

    const serialized = messages
      .map((m) => `[${m.role}] ${m.content.slice(0, 200)}`)
      .join("\n");

    const prompt = `请总结以下对话的关键信息（需求/决策/动作/待办）：\n${serialized}\n\n摘要：`;

    try {
      const response = await this._client.achat(
        [new ChatMessage(Role.USER, prompt)],
        { temperature: 0.3, max_tokens: 500 }
      );
      return response.content;
    } catch {
      return "[摘要生成失败]";
    }
  }
}
