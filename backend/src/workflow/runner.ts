/** 流程节点引擎统一入口（ADR-0007 / spec workflow-node-engine）。
 * WorkflowRunner 是本 feature 的唯一黑盒测试 seam。 */
import type { LLMClient } from "../llm/client.js";
import { ChatMessage, Role } from "../llm/models.js";
import type { MemoryStore } from "../storage/memory_store.js";
import { createRetriever, type MemoryRetriever } from "../storage/retriever.js";
import { getStateNode, type StateNode } from "../storage/states.js";
import { ContextOrchestrator, type AssemblyOptions } from "../agent/orchestrator.js";
import { NODE_PROMPTS, type NodePromptConfig } from "./node_prompts.js";

export interface WorkflowRunnerDeps {
  client: LLMClient;
  memory: MemoryStore | null;
  settingsLoader?: (projectId: string, settingType: string) => Record<string, unknown> | null;
}

export interface RunNodeOptions {
  /** 历史对话（不含系统提示） */
  history?: ChatMessage[];
  /** 覆盖默认装配选项 */
  assembly?: Partial<AssemblyOptions>;
}

export interface RunNodeResult {
  /** 最终装配出的消息列表（含系统提示） */
  messages: ChatMessage[];
  /** 当前节点 */
  node: StateNode;
  /** 节点 key */
  nodeKey: string;
}

export class WorkflowRunner {
  private _orchestrator: ContextOrchestrator;
  private _nodePrompts: NodePromptConfig;

  constructor(private _deps: WorkflowRunnerDeps) {
    const retriever: MemoryRetriever | null = _deps.memory ? createRetriever(_deps.memory) : null;
    this._orchestrator = new ContextOrchestrator(
      _deps.client,
      _deps.memory,
      retriever,
      _deps.settingsLoader ?? null
    );
    this._nodePrompts = NODE_PROMPTS;
  }

  /** 统一执行入口：按节点组装上下文 */
  async runNode(
    nodeKey: string,
    projectId: string,
    sessionId: string,
    userInput: string,
    opts: RunNodeOptions = {}
  ): Promise<RunNodeResult> {
    const node = getStateNode(nodeKey);
    const promptBuilder = this._nodePrompts[nodeKey];
    if (!promptBuilder) {
      throw new Error("未知流程节点: " + nodeKey);
    }

    // 1. 构建节点专属系统提示词
    const systemPrompt = promptBuilder({ node, projectId });

    // 2. 组装消息（系统提示 + 历史 + 用户输入）
    const messages: ChatMessage[] = [
      new ChatMessage(Role.SYSTEM, systemPrompt),
      ...(opts.history ?? []),
      new ChatMessage(Role.USER, userInput),
    ];

    // 3. 经编排器处理（记忆召回 + 分层摘要 + 设定注入 + 压缩）
    const assemblyOpts: Partial<AssemblyOptions> = {
      project_id: projectId,
      state: nodeKey,
      user_message: userInput,
      ...opts.assembly,
    };
    const processed = await this._orchestrator.process(messages, assemblyOpts);

    return {
      messages: processed,
      node,
      nodeKey,
    };
  }
}