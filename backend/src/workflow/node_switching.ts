/** 会话内节点切换 C 方案（工单 05）。
 * 切换时只携带摘要+最近N条，不携带原始对话轮次。 */
import type { LLMClient } from "../llm/client.js";
import type { MemoryStore } from "../storage/memory_store.js";
import { ChatMessage, Role } from "../llm/models.js";

export interface NodeResult {
  summary: string;
  outputs: string[];
  pending?: string[];
  dynamicUpdates?: string[];
}

export interface SwitchContext {
  fromNode: string;
  toNode: string;
  projectId: string;
  sessionId: string;
  currentMessages: ChatMessage[];
  nodeResults: Record<string, NodeResult>;
}

const RECENT_KEEP_COUNT = 3;

export interface SwitchResult {
  messages: ChatMessage[];
  fromNode: string;
  toNode: string;
  summary: string;
}

export class NodeSwitchingPlanC {
  private _client: LLMClient;
  private _memory: MemoryStore;

  constructor(client: LLMClient, memory: MemoryStore) {
    this._client = client;
    this._memory = memory;
  }

  /** 执行节点切换 */
  async switch(context: SwitchContext): Promise<SwitchResult> {
    const { fromNode, toNode, currentMessages, nodeResults } = context;
    
    // 1. 生成 A 节点对话摘要
    const summary = await this._generateSummary(currentMessages);
    
    // 2. 获取 B 节点系统提示
    const bSystemPrompt = this._getNodeSystemPrompt(toNode);
    
    // 3. 构建 B 上下文：B 指令 + 成果 + 摘要 + 最近 N 条
    const messages: ChatMessage[] = [];
    
    // B 节点系统提示（包含 A 节点成果和摘要）
    const systemContent = this._buildSystemContent(bSystemPrompt, nodeResults, fromNode, toNode, summary);
    messages.push(new ChatMessage(Role.SYSTEM, systemContent));
    
        // 最近 N 条：排除系统提示后取对话的最后几条，避免把源节点的早期原始轮次直接带入目标节点上下文
    const dialogMessages = currentMessages.filter((m) => m.role !== Role.SYSTEM);
    const recentMessages = dialogMessages.slice(-RECENT_KEEP_COUNT);
    messages.push(...recentMessages);
    
    return {
      messages,
      fromNode,
      toNode,
      summary,
    };
  }

  /** 生成对话摘要 */
  private async _generateSummary(messages: ChatMessage[]): Promise<string> {
    if (messages.length <= 1) {
      return "无对话历史";
    }
    
    // 过滤掉系统提示
    const dialogMessages = messages.filter(m => m.role !== Role.SYSTEM);
    
    if (dialogMessages.length === 0) {
      return "无对话历史";
    }
    
    const serialized = dialogMessages
      .map(m => `[${m.role}] ${m.content.slice(0, 200)}`)
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

  /** 获取节点系统提示 */
  private _getNodeSystemPrompt(nodeKey: string): string {
    const prompts: Record<string, string> = {
      ideation: "你是灵感捕捉助手，负责创意孵化。",
      worldview: "你是世界观构建助手，负责构建世界观设定。",
      characters: "你是人物塑造助手，负责设计人物设定。",
      outline: "你是大纲生成助手，负责规划故事大纲。",
      writing: "你是正文生成助手，负责撰写小说正文。",
      review: "你是质量审查助手，负责审查正文质量。",
      style: "你是文风优化助手，负责优化文风。",
    };
    return prompts[nodeKey] ?? `你是${nodeKey}节点助手。`;
  }

  /** 构建系统提示内容 */
  private _buildSystemContent(
    basePrompt: string,
    nodeResults: Record<string, NodeResult>,
    fromNode: string,
    toNode: string,
    summary: string
  ): string {
    let content = basePrompt;
    
    // 目标节点自身的成果摘要（切回时恢复该节点上下文与讨论）
    const targetResult = nodeResults[toNode];
    if (targetResult) {
      content += '\n\n## 当前节点上下文\n';
      content += `摘要：${targetResult.summary}\n`;
      if (targetResult.outputs.length > 0) {
        content += `产出：${targetResult.outputs.join(', ')}\n`;
      }
      if (targetResult.pending && targetResult.pending.length > 0) {
        content += `待办：${targetResult.pending.join(', ')}\n`;
      }
    }

    // 前节点成果（来自 fromNode，切换前的产出）
    const fromResult = nodeResults[fromNode];
    if (fromResult && fromNode !== toNode) {
      content += '\n\n## 前节点成果\n';
      content += `摘要：${fromResult.summary}\n`;
      if (fromResult.outputs.length > 0) {
        content += `产出：${fromResult.outputs.join(', ')}\n`;
      }
      if (fromResult.pending && fromResult.pending.length > 0) {
        content += `待办：${fromResult.pending.join(', ')}\n`;
      }
      if (fromResult.dynamicUpdates && fromResult.dynamicUpdates.length > 0) {
        content += `动态更新：${fromResult.dynamicUpdates.join(', ')}\n`;
      }
    }

        // 添加对话摘要
    content += "\n\n## 前节点对话摘要\n" + summary;
    
    return content;
  }
}
