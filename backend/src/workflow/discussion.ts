/**
 * 多 Agent 讨论执行器（讨论模式）
 * 
 * 流程：
 * 1. 初始提案：各 Agent 独立生成初始观点
 * 2. 讨论轮次：每轮 Agent 看到所有其他 Agent 的发言，生成回应（支持/质疑/补充）
 * 3. 深度讨论：多轮交互，逐步深化
 * 4. 最终合成：合成者整合讨论成果
 */

import { getClientForTask } from "../api/state.js";
import { LLMClient } from "../llm/client.js";
import { ChatMessage } from "../llm/models.js";
import { listAgentRoles, type AgentRoleAsset } from "../assets/agent_roles.js";

// ============ 数据类型 ============

export interface DiscussionInput {
  projectId: string;
  projectName: string;
  topic: string;
  context: {
    worldview?: string;
    characters?: string;
    outline?: string;
    core_elements?: string;
    memory?: string;
  };
}

export interface AgentMessage {
  roleId: string;
  roleName: string;
  category: string;
  content: string;
  round: number;
  type: "proposal" | "response" | "synthesis";
  elapsedMs: number;
  // 对其他 Agent 观点的回应
  responses?: {
    targetRoleId: string;
    targetRoleName: string;
    responseType: "support" | "question" | "supplement" | "disagree";
    content: string;
  }[];
}

export interface DiscussionSession {
  id: string;
  projectId: string;
  topic: string;
  input: DiscussionInput;
  status: "initial" | "discussing" | "synthesizing" | "completed" | "terminated";
  currentRound: number;
  maxRounds: number;
  messages: AgentMessage[];
  userInstructions: string[];
  logs: string[];
  synthesis?: string;
  createdAt: string;
  updatedAt: string;
}

// ============ 核心逻辑 ============

/** 构建基础上下文 */
function buildBaseContext(input: DiscussionInput): string {
  const parts: string[] = [];
  
  parts.push(`【项目信息】
书名：${input.projectName}
讨论主题：${input.topic}`);
  
  if (input.context.core_elements) {
    parts.push(`【核心要素】
${input.context.core_elements}`);
  }
  if (input.context.worldview) {
    parts.push(`【世界观设定】
${input.context.worldview}`);
  }
  if (input.context.characters) {
    parts.push(`【人物设定】
${input.context.characters}`);
  }
  if (input.context.outline) {
    parts.push(`【大纲】
${input.context.outline}`);
  }
  if (input.context.memory) {
    parts.push(`【记忆】
${input.context.memory}`);
  }
  
  return parts.join("\n\n");
}

/** 生成初始提案 */
export async function generateInitialProposal(
  role: AgentRoleAsset,
  input: DiscussionInput,
  logs: string[]
): Promise<AgentMessage> {
  const startTime = Date.now();
  const logPrefix = `[${role.name}]`;
  
  logs.push(`${logPrefix} 生成初始提案...`);
  
  let client: LLMClient;
  try {
    client = getClientForTask("text", null);
  } catch {
    client = getClientForTask("structure", null);
  }
  
  const baseContext = buildBaseContext(input);
  
  const systemPrompt = role.systemPrompt;
  const userPrompt = `${baseContext}

作为${role.name}，请基于你的角色定位和专业视角，对讨论主题提出你的初始观点。

要求：
1. 明确表达你的核心观点
2. 说明你的理由和依据
3. 指出你认为的关键点或潜在问题
4. 保持简洁，300-500字为宜`;
  
  const messages = [
    new ChatMessage("system", systemPrompt),
    new ChatMessage("user", userPrompt),
  ];
  
  const temperature = role.modelConfig.mode === "custom" && role.modelConfig.custom
    ? role.modelConfig.custom.temperature
    : 0.7;
  
  const response = await client.achat(messages, { temperature });
  
  const elapsedMs = Date.now() - startTime;
  logs.push(`${logPrefix} ✓ 初始提案完成 (${(elapsedMs / 1000).toFixed(1)}s)`);
  
  return {
    roleId: role.id,
    roleName: role.name,
    category: role.category,
    content: response.content,
    round: 0,
    type: "proposal",
    elapsedMs,
  };
}

/** 生成讨论回应 */
export async function generateDiscussionResponse(
  role: AgentRoleAsset,
  input: DiscussionInput,
  previousMessages: AgentMessage[],
  round: number,
  logs: string[]
): Promise<AgentMessage> {
  const startTime = Date.now();
  const logPrefix = `[${role.name}]`;
  
  logs.push(`${logPrefix} 第 ${round} 轮讨论...`);
  
  let client: LLMClient;
  try {
    client = getClientForTask("text", null);
  } catch {
    client = getClientForTask("structure", null);
  }
  
  const baseContext = buildBaseContext(input);
  
  // 构建其他 Agent 的发言历史
  const otherMessages = previousMessages
    .filter(m => m.roleId !== role.id)
    .map(m => {
      const roundLabel = m.round === 0 ? "初始提案" : `第 ${m.round} 轮`;
      return `### ${m.roleName} (${roundLabel})
${m.content}`;
    })
    .join("\n\n");
  
  const systemPrompt = role.systemPrompt;
  const userPrompt = `${baseContext}

## 讨论进展

以下是其他参与者的发言：

${otherMessages}

## 你的任务

作为${role.name}，请：
1. 回应其他参与者的观点（支持、质疑、补充或反对）
2. 指出你认同的观点及理由
3. 指出你不同意的观点及理由
4. 补充新的视角或信息
5. 如果有新的想法，请提出

要求：
- 针对性回应，不要重复已有观点
- 保持建设性，推动讨论深入
- 300-500字为宜`;
  
  const messages = [
    new ChatMessage("system", systemPrompt),
    new ChatMessage("user", userPrompt),
  ];
  
  const temperature = role.modelConfig.mode === "custom" && role.modelConfig.custom
    ? role.modelConfig.custom.temperature
    : 0.7;
  
  const response = await client.achat(messages, { temperature });
  
  const elapsedMs = Date.now() - startTime;
  logs.push(`${logPrefix} ✓ 第 ${round} 轮讨论完成 (${(elapsedMs / 1000).toFixed(1)}s)`);
  
  return {
    roleId: role.id,
    roleName: role.name,
    category: role.category,
    content: response.content,
    round,
    type: "response",
    elapsedMs,
  };
}

/** 执行初始提案阶段 */
export async function executeInitialProposals(
  input: DiscussionInput,
  logs: string[]
): Promise<AgentMessage[]> {
  const proposers = listAgentRoles().filter((r) => r.category === "proposer");
  if (proposers.length === 0) {
    throw new Error("未找到提案者角色");
  }
  
  logs.push(`=== 初始提案阶段 ===`);
  logs.push(`找到 ${proposers.length} 个提案者角色`);
  
  const messages: AgentMessage[] = [];
  for (const role of proposers) {
    const message = await generateInitialProposal(role, input, logs);
    messages.push(message);
  }
  
  return messages;
}

/** 执行一轮讨论 */
export async function executeDiscussionRound(
  input: DiscussionInput,
  previousMessages: AgentMessage[],
  round: number,
  logs: string[]
): Promise<AgentMessage[]> {
  const proposers = listAgentRoles().filter((r) => r.category === "proposer");
  
  logs.push(`\n=== 第 ${round} 轮讨论 ===`);
  
  const newMessages: AgentMessage[] = [];
  for (const role of proposers) {
    const message = await generateDiscussionResponse(role, input, previousMessages, round, logs);
    newMessages.push(message);
  }
  
  return newMessages;
}

/** 执行最终合成 */
export async function executeFinalSynthesis(
  input: DiscussionInput,
  allMessages: AgentMessage[],
  userInstructions: string[],
  logs: string[]
): Promise<{
  synthesis: string;
  elapsedMs: number;
}> {
  const startTime = Date.now();
  const logPrefix = "[合成者]";
  
  logs.push(`\n=== 最终合成 ===`);
  
  const synthesizer = listAgentRoles().find((r) => r.category === "synthesizer");
  if (!synthesizer) {
    throw new Error("未找到合成者角色");
  }
  
  let client: LLMClient;
  try {
    client = getClientForTask("text", null);
  } catch {
    client = getClientForTask("structure", null);
  }
  
  const baseContext = buildBaseContext(input);
  
  // 构建完整讨论历史
  const discussionHistory = allMessages
    .map(m => {
      const roundLabel = m.round === 0 ? "初始提案" : `第 ${m.round} 轮讨论`;
      return `### ${m.roleName} (${roundLabel})
${m.content}`;
    })
    .join("\n\n");
  
  let instructionsText = "";
  if (userInstructions.length > 0) {
    instructionsText = `

## 用户指令
${userInstructions.map((inst, i) => `${i + 1}. ${inst}`).join("\n")}`;
  }
  
  const userPrompt = `${baseContext}

## 完整讨论历史

${discussionHistory}${instructionsText}

## 你的任务

作为讨论的主持人和总结者，请：
1. 梳理讨论的主要观点和共识
2. 指出存在的分歧和争议点
3. 提出综合性的解决方案或建议
4. 给出明确的结论和下一步行动建议

输出格式：
## 核心共识
（各方达成一致的观点）

## 主要分歧
（存在的不同意见及理由）

## 综合方案
（整合各方观点的最终方案）

## 行动建议
（具体的下一步建议）`;
  
  const messages = [
    new ChatMessage("system", synthesizer.systemPrompt),
    new ChatMessage("user", userPrompt),
  ];
  
  const temperature = synthesizer.modelConfig.mode === "custom" && synthesizer.modelConfig.custom
    ? synthesizer.modelConfig.custom.temperature
    : 0.5;
  
  logs.push(`${logPrefix} 开始合成...`);
  
  const response = await client.achat(messages, { temperature });
  
  const elapsedMs = Date.now() - startTime;
  logs.push(`${logPrefix} ✓ 合成完成 (${(elapsedMs / 1000).toFixed(1)}s)`);
  
  return {
    synthesis: response.content,
    elapsedMs,
  };
}

