/** 每节点 RAG 召回与装配块序（工单 06）。
 * 按节点定义召回规则和装配顺序，四维规则完整消费。 */
import type { MemoryStore } from "../storage/memory_store.js";
import type { MemoryRetriever } from "../storage/retriever.js";

export interface AssemblyContext {
  nodeKey: string;
  projectId: string;
  userMessage: string;
}

export interface AssemblyBlock {
  type: "system" | "recall" | "summary" | "user";
  content: string;
  priority: number;
}

export interface CompressionRules {
  blockPriorities: Record<string, number>;
  degradationChain: string[];
}

export interface AssemblyResult {
  systemPrompt: string;
  recallBlocks: string[];
  blocks: AssemblyBlock[];
  compressionRules: CompressionRules;
}

export class NodeAssembly {
  private _memory: MemoryStore;
  private _retriever: MemoryRetriever;

  constructor(memory: MemoryStore, retriever: MemoryRetriever) {
    this._memory = memory;
    this._retriever = retriever;
  }

  /** 按节点装配上下文 */
  assemble(context: AssemblyContext): AssemblyResult {
    const { nodeKey, projectId, userMessage } = context;

    // 1. 获取节点专属系统提示
    const systemPrompt = this._getNodeSystemPrompt(nodeKey);

    // 2. 按节点规则召回内容
    const recallBlocks = this._recallByNode(nodeKey, projectId, userMessage);

    // 3. 按节点规则装配块顺序
    const blocks = this._assembleBlocks(nodeKey, systemPrompt, recallBlocks, userMessage);

    // 4. 获取节点压缩规则
    const compressionRules = this._getCompressionRules(nodeKey);

    return {
      systemPrompt,
      recallBlocks,
      blocks,
      compressionRules,
    };
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

  /** 按节点规则召回内容 */
  private _recallByNode(nodeKey: string, projectId: string, userMessage: string): string[] {
    const recallBlocks: string[] = [];

    switch (nodeKey) {
      case "ideation":
        // 灵感捕捉：不召回正文记忆，只召回核心创意卡
        recallBlocks.push("核心创意卡进度（已确认要素）");
        break;

      case "worldview":
        // 世界观构建：召回核心创意卡
        recallBlocks.push("核心创意卡");
        break;

      case "characters":
        // 人物塑造：召回创意卡 + 世界观摘要
        recallBlocks.push("核心创意卡");
        recallBlocks.push("世界观摘要");
        break;

      case "outline":
        // 大纲生成：召回创意卡 + 世界观/人物摘要 + 活跃伏笔
        recallBlocks.push("核心创意卡");
        recallBlocks.push("世界观摘要");
        recallBlocks.push("人物摘要");
        recallBlocks.push("活跃伏笔");
        break;

      case "writing":
        // 正文生成：召回最重 - 章纲 + 动态状态 + 摘要 + 伏笔 + 风格
        recallBlocks.push("章纲");
        recallBlocks.push("人物状态");
        recallBlocks.push("地点状态");
        recallBlocks.push("章节摘要");
        recallBlocks.push("上一章钩子");
        recallBlocks.push("活跃伏笔");
        recallBlocks.push("风格规范");
        break;

      case "review":
        // 质量审查：召回正文 + 相关设定 + 事件流 + 展示层
        recallBlocks.push("当前章节正文");
        recallBlocks.push("人物设定");
        recallBlocks.push("世界观设定");
        recallBlocks.push("事件流");
        recallBlocks.push("信息展示层");
        break;

      case "style":
        // 文风优化：召回抽样章节 + 命名表 + 偏好
        recallBlocks.push("抽样章节");
        recallBlocks.push("命名表");
        recallBlocks.push("用户偏好");
        break;
    }

    return recallBlocks;
  }

  /** 按节点规则装配块顺序 */
  private _assembleBlocks(
    nodeKey: string,
    systemPrompt: string,
    recallBlocks: string[],
    userMessage: string
  ): AssemblyBlock[] {
    const blocks: AssemblyBlock[] = [];

    // 1. 系统提示（硬块，优先级 1）
    blocks.push({
      type: "system",
      content: systemPrompt,
      priority: 1,
    });

    // 2. 召回内容（软块，优先级按节点不同）
    for (const recall of recallBlocks) {
      blocks.push({
        type: "recall",
        content: recall,
        priority: this._getRecallPriority(nodeKey),
      });
    }

    // 3. 分层摘要（软块，优先级 3）
    const summaryL2 = this._memory.loadSummary("", 2);
    const summaryL3 = this._memory.loadSummary("", 3);
    if (summaryL2) {
      blocks.push({
        type: "summary",
        content: summaryL2,
        priority: 3,
      });
    }
    if (summaryL3) {
      blocks.push({
        type: "summary",
        content: summaryL3,
        priority: 3,
      });
    }

    // 4. 用户消息（硬块，优先级 1）
    blocks.push({
      type: "user",
      content: userMessage,
      priority: 1,
    });

    return blocks;
  }

  /** 获取召回块优先级 */
  private _getRecallPriority(nodeKey: string): number {
    switch (nodeKey) {
      case "writing":
        return 2; // 正文节点召回优先级高
      case "review":
        return 2;
      default:
        return 3;
    }
  }

  /** 获取节点压缩规则 */
  private _getCompressionRules(nodeKey: string): CompressionRules {
    const blockPriorities: Record<string, number> = {
      system: 1,
      user: 1,
      recall: this._getRecallPriority(nodeKey),
      summary: 3,
    };

    const degradationChain: string[] = ["summary", "recall"];

    return {
      blockPriorities,
      degradationChain,
    };
  }
}
