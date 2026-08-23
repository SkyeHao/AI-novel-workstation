/**
 * 多 Agent 讨论 API 路由（讨论模式）
 * 异步执行 + 轮询进度
 */
import type { FastifyInstance } from "fastify";
import { 
  executeInitialProposals,
  executeDiscussionRound,
  executeFinalSynthesis,
  type DiscussionInput,
  type DiscussionSession,
  type AgentMessage
} from "../../workflow/discussion.js";
import { randomUUID } from "node:crypto";

// 内存存储讨论会话
const sessions = new Map<string, DiscussionSession>();

// 后台任务队列
const pendingTasks = new Map<string, Promise<void>>();

export async function discussionRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/discussions/sessions - 获取所有会话
  app.get("/sessions", async () => {
    const list = Array.from(sessions.values()).map(s => ({
      id: s.id,
      projectId: s.projectId,
      topic: s.topic,
      status: s.status,
      currentRound: s.currentRound,
      messagesCount: s.messages.length,
      hasSynthesis: !!s.synthesis,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
    return { sessions: list, total: list.length };
  });

  // POST /api/discussions/start - 开始讨论（异步）
  app.post<{ Body: DiscussionInput & { maxRounds?: number } }>("/start", async (req, reply) => {
    const input = req.body;
    
    console.log("[discussions] 开始讨论:", input.topic);
    
    if (!input?.projectId || !input?.topic) {
      return reply.code(400).send({ error: "缺少 projectId 或 topic" });
    }
    
    const sessionId = randomUUID();
    const maxRounds = input.maxRounds || 2; // 默认 2 轮讨论
    const logs: string[] = [];
    
    logs.push("=== 多 Agent 讨论开始 ===");
    logs.push(`项目: ${input.projectName}`);
    logs.push(`主题: ${input.topic}`);
    logs.push(`讨论轮次: ${maxRounds} 轮`);
    logs.push("");
    
    // 创建会话
    const session: DiscussionSession = {
      id: sessionId,
      projectId: input.projectId,
      topic: input.topic,
      input,
      status: "initial",
      currentRound: 0,
      maxRounds,
      messages: [],
      userInstructions: [],
      logs: [...logs],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    sessions.set(sessionId, session);
    
    // 后台异步执行
    const task = (async () => {
      try {
        // 阶段 1：初始提案
        session.logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        session.logs.push("[阶段 1/3] 初始提案");
        session.logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        
        const initialMessages = await executeInitialProposals(input, session.logs);
        session.messages.push(...initialMessages);
        session.currentRound = 0;
        session.status = "discussing";
        session.updatedAt = new Date().toISOString();
        
        session.logs.push("");
        session.logs.push(`✓ 初始提案完成，共 ${initialMessages.length} 个提案`);
        session.logs.push("");
        
        // 阶段 2：多轮讨论
        for (let round = 1; round <= maxRounds; round++) {
          if (session.status === "terminated") {
            session.logs.push(`[系统] 讨论已被用户终止`);
            return;
          }
          
          session.logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          session.logs.push(`[阶段 2/3] 第 ${round}/${maxRounds} 轮讨论`);
          session.logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          
          const roundMessages = await executeDiscussionRound(
            input,
            session.messages,
            round,
            session.logs
          );
          
          session.messages.push(...roundMessages);
          session.currentRound = round;
          session.updatedAt = new Date().toISOString();
          
          session.logs.push("");
          session.logs.push(`✓ 第 ${round} 轮讨论完成`);
          session.logs.push("");
        }
        
        // 阶段 3：最终合成
        session.logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        session.logs.push("[阶段 3/3] 最终合成");
        session.logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        
        session.status = "synthesizing";
        session.updatedAt = new Date().toISOString();
        
        const result = await executeFinalSynthesis(
          input,
          session.messages,
          session.userInstructions,
          session.logs
        );
        
        session.synthesis = result.synthesis;
        session.status = "completed";
        session.logs.push("");
        session.logs.push("=== 讨论完成 ===");
        session.updatedAt = new Date().toISOString();
        
        console.log("[discussions] 讨论完成");
      } catch (err) {
        session.logs.push(`[错误] ${err instanceof Error ? err.message : String(err)}`);
        session.status = "terminated";
        session.updatedAt = new Date().toISOString();
        console.error("[discussions] 讨论失败:", err);
      } finally {
        pendingTasks.delete(sessionId);
      }
    })();
    
    pendingTasks.set(sessionId, task);
    
    return {
      sessionId,
      status: session.status,
      logs: session.logs,
    };
  });
  
  // GET /api/discussions/:id/progress - 获取进度
  app.get<{ Params: { id: string } }>("/:id/progress", async (req, reply) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return reply.code(404).send({ error: "讨论会话不存在" });
    }
    
    const isRunning = pendingTasks.has(req.params.id);
    
    return {
      sessionId: session.id,
      status: session.status,
      isRunning,
      currentRound: session.currentRound,
      maxRounds: session.maxRounds,
      messages: session.messages,
      messagesCount: session.messages.length,
      logs: session.logs,
      updatedAt: session.updatedAt,
    };
  });
  
  // POST /api/discussions/:id/instruction - 追加用户指令
  app.post<{ Params: { id: string }; Body: { instruction: string } }>("/:id/instruction", async (req, reply) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return reply.code(404).send({ error: "讨论会话不存在" });
    }
    
    const instruction = req.body.instruction?.trim();
    if (!instruction) {
      return reply.code(400).send({ error: "指令不能为空" });
    }
    
    session.userInstructions.push(instruction);
    session.logs.push(`[用户] 追加指令: ${instruction}`);
    session.updatedAt = new Date().toISOString();
    
    return { success: true, instructions: session.userInstructions };
  });
  
  // POST /api/discussions/:id/complete - 完成讨论
  app.post<{ Params: { id: string } }>("/:id/complete", async (req, reply) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return reply.code(404).send({ error: "讨论会话不存在" });
    }
    if (session.status !== "completed") {
      return reply.code(400).send({ error: "讨论尚未完成" });
    }
    
    session.logs.push("");
    session.logs.push("=== 用户确认完成 ===");
    session.updatedAt = new Date().toISOString();
    
    return { success: true, status: session.status };
  });
  
  // POST /api/discussions/:id/terminate - 终止讨论
  app.post<{ Params: { id: string } }>("/:id/terminate", async (req, reply) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return reply.code(404).send({ error: "讨论会话不存在" });
    }
    
    session.status = "terminated";
    session.logs.push("");
    session.logs.push("=== 讨论已终止 ===");
    session.updatedAt = new Date().toISOString();
    
    return { success: true, status: session.status };
  });
  
  // GET /api/discussions/:id - 获取完整会话
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return reply.code(404).send({ error: "讨论会话不存在" });
    }
    return session;
  });
  
  // DELETE /api/discussions/:id - 删除会话
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const deleted = sessions.delete(req.params.id);
    if (!deleted) {
      return reply.code(404).send({ error: "讨论会话不存在" });
    }
    return { success: true };
  });
}



