/**
 * 多 Agent 群聊（ChatSession）API 路由。
 * 复用 agent.ts 的 SSE 模式（hijack + 心跳 + send）；事件按 chat_session 的事件表推送。
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  ChatSession,
  ChatSessionError,
  type ChatSessionEvent,
  type ChatMember,
} from "../../workflow/chat_session.js";
import { getAgentRole } from "../../assets/agent_roles.js";
import { getRoundtableConfig } from "../../assets/roundtable_config.js";
import { getClientByModelId, getClientForTask, getProjectStore } from "../state.js";
import { InteractionLogger } from "../../llm/interaction_logger.js";
import { saveInteraction, deleteBySession } from "../../storage/interaction_store.js";
import { TransformersEmbeddingService, type EmbeddingService } from "../../vector/embedding.js";
import { QdrantVectorStore, type VectorStore } from "../../vector/store.js";
import { FileChatStore, type ChatSessionRuntimeConfig } from "../../storage/chat_store.js";
import type { AskQuestion } from "../../agent/react.js";
import type { ChatSessionSnapshot } from "../../workflow/chat_session.js";
import type { LLMClient } from "../../llm/client.js";
import { applyChatSessionPlan, CHAT_APPLY_TARGETS, type ChatApplyTarget } from "../../workflow/chat_apply.js";

/** 内存中的群聊会话注册表（持久化与恢复见工单 07） */
const _sessions = new Map<string, ChatSession>();

/**
 * 单活跃流守卫（修复「系统消息/事件重复上屏」根因）：
 * 同一会话只允许一个活跃 SSE 连接。之前每次 /stream 连接都 session.subscribe(emit)，
 * 前端 abort 旧 fetch 后若服务端未及时感知连接关闭，同一会话会挂多个订阅 → 事件双发。
 * 新连接接入时先 close 旧连接（退订 + 结束回复），确保任意时刻最多一个订阅。
 */
const _activeStreams = new Map<string, { close: () => void }>();

/**
 * 向量服务懒加载单例（工单 06）：Qdrant / Embedding 模型不可用时由 ChatSession
 * 自动降级为关键词 + 随机，不阻塞讨论主流程；服务层保留运行时切换接口。
 */
let _vectorBundle: { embedding: EmbeddingService; store: VectorStore } | null = null;

function getVectorBundle(): { embedding: EmbeddingService; store: VectorStore } | null {
  if (!_vectorBundle) {
    try {
      _vectorBundle = {
        embedding: new TransformersEmbeddingService(),
        store: new QdrantVectorStore(),
      };
    } catch {
      _vectorBundle = null;
    }
  }
  return _vectorBundle;
}

/** 讨论记录文件存储（工单 07）：懒加载单例，路径由当前项目目录解析。 */
let _chatStore: FileChatStore | null = null;
function getChatStore(): FileChatStore {
  if (!_chatStore) _chatStore = new FileChatStore(getProjectStore());
  return _chatStore;
}

/** 磁盘恢复：内存未命中时按会话 id 跨项目查找快照（刷新 / 重启后可续看）。 */
function loadFromDisk(sessionId: string): ChatSessionSnapshot | null {
  const store = getChatStore();
  for (const project of getProjectStore().list()) {
    const snapshot = store.load(project.id, sessionId);
    if (!snapshot) continue;
    // 工单 10：孤儿运行中会话（进程重启/崩溃后留在磁盘的非终态，且不在内存注册表）恢复为 terminated，
    // 避免前端永远停在「正在运行」却无事件流
    // 工单 12：但「停在等待作者回答」的会话除外——进程重启后需要保留 running，供前端恢复 ask 卡片继续讨论
    const hasPendingAsk = !!store.getPendingAsk(project.id, sessionId);
    if (!_sessions.has(sessionId) && !hasPendingAsk && (snapshot.status === "running" || snapshot.status === "synthesizing")) {
      try { store.setStatus(project.id, sessionId, "terminated"); } catch { /* 忽略 */ }
      return store.load(project.id, sessionId) ?? snapshot;
    }
    return snapshot;
  }
  return null;
}

function roleToMember(roleId: string): ChatMember {
  const role = getAgentRole(roleId);
  if (!role) throw new ChatSessionError(`角色不存在: ${roleId}`);
  return {
    id: role.id,
    kind: "agent",
    name: role.name,
    description: role.description,
    category: role.category,
    modelId: role.modelId ?? null,
    systemPrompt: role.systemPrompt,
    sharedContextKeys: role.contextConfig?.sharedContextKeys,
  };
 }

/**
 * 解析系统角色卡片（导演 / 共识裁判）的提示词与模型。
 * 导演与共识裁判已独立为角色卡片（提示词管理 → 圆桌会议），
 * 模型与提示词以角色卡片为准，缺省回落圆桌会议全局配置（向后兼容）。
 */
function resolveSystemRole(roleId: string): {
  systemPrompt?: string;
  modelId?: string | null;
  config?: { enabled?: boolean; temperature?: number; timeoutMs?: number; maxTokens?: number | null };
} {
  const role = getAgentRole(roleId);
  if (!role) return {};
  return { systemPrompt: role.systemPrompt, modelId: role.modelId ?? null, config: role.systemRoleConfig };
}

/** 跨项目在磁盘上定位会话的运行时配置 + 快照；无则返回 null。 */
function findSessionRuntime(
  sessionId: string
): { projectId: string; config: ChatSessionRuntimeConfig; snapshot: ChatSessionSnapshot } | null {
  const store = getChatStore();
  for (const project of getProjectStore().list()) {
    const config = store.loadConfig(project.id, sessionId);
    if (!config) continue;
    const snapshot = store.load(project.id, sessionId);
    if (!snapshot) continue;
    return { projectId: project.id, config, snapshot };
  }
  return null;
}

/** 跨项目在磁盘上定位待答 ask；无则返回 null。 */
function findPendingAskOnDisk(
  sessionId: string
): { question: AskQuestion; memberId: string; memberName: string } | null {
  const store = getChatStore();
  for (const project of getProjectStore().list()) {
    const pending = store.getPendingAsk(project.id, sessionId);
    if (!pending) continue;
    return {
      memberId: pending.memberId,
      memberName: pending.memberName,
      question: {
        question: pending.question,
        options: pending.options,
        multiple: pending.multiple,
        allow_custom: pending.allow_custom,
      },
    };
  }
  return null;
}

/**
 * 工单 12：从磁盘重建「停在等待作者回答」的会话（进程重启后恢复继续讨论）。
 * - 仅在内存未命中、且磁盘存在待答 ask 时重建，否则返回 null；
 * - 重建后会话状态置 running、停在 ask，作者作答经 submitAskAnswer 续跑；
 * - 调度 Agent（导演）按运行时配置的 modelId 恢复独立 client。
 */
async function resumeSessionFromDisk(sessionId: string): Promise<ChatSession | null> {
  const existing = _sessions.get(sessionId);
  if (existing) return existing;
  const store = getChatStore();
  const found = findSessionRuntime(sessionId);
  if (!found) return null;
  const { projectId, config, snapshot } = found;
  // 只恢复「停在 ask」的会话：磁盘必须有待答提问，否则重建后没有继续驱动入口
  if (!store.getPendingAsk(projectId, sessionId)) return null;

  const roundtableCfg = getRoundtableConfig();
 let speaking: { memberId: string; memberName: string } | null = null;
 let client: LLMClient;
 let schedulerLlm: LLMClient;
 let judgeLlm: LLMClient;
  let directorSystemPrompt: string | undefined;
  let judgeSystemPrompt: string | undefined;
  let directorCfg: { enabled?: boolean; temperature?: number; timeoutMs?: number; maxTokens?: number | null } = {};
  let judgeCfg: { enabled?: boolean; temperature?: number; timeoutMs?: number; maxTokens?: number | null } = {};
 let logger: InteractionLogger | null = null;
  try {
    logger = new InteractionLogger((it) => {
      try {
        saveInteraction("chat", it, {
          task_type: "text",
          session_id: "chat:" + sessionId,
          project_id: projectId,
          channel: "group_chat",
          member_id: speaking?.memberId ?? "",
          member_name: speaking?.memberName ?? "",
        });
      } catch (err) {
        console.warn("保存群聊交互记录失败: " + (err instanceof Error ? err.message : String(err)));
      }
    });
   client = getClientForTask("text", logger);
    // 工单 16：导演/共识裁判以角色卡片配置为准；磁盘运行时配置优先（恢复时精确还原），
    // 再回落角色卡片，最后回落圆桌会议全局配置（向后兼容）
    const directorCard = resolveSystemRole("builtin-director");
    directorCfg = directorCard.config ?? {};
   const directorModelId = config.schedulerAgent?.modelId ?? directorCard.modelId ?? roundtableCfg.scheduler?.modelId ?? null;
    directorSystemPrompt = config.schedulerAgent?.systemPrompt ?? directorCard.systemPrompt;
   schedulerLlm = directorModelId
     ? getClientByModelId(directorModelId, logger) ?? client
     : client;
   const judgeCard = resolveSystemRole("builtin-consensus-judge");
   judgeCfg = judgeCard.config ?? {};
   const judgeModelId = config.consensus?.llmJudge?.modelId ?? judgeCard.modelId ?? null;
    judgeSystemPrompt = config.consensus?.llmJudge?.systemPrompt ?? judgeCard.systemPrompt;
   judgeLlm = judgeModelId
     ? getClientByModelId(judgeModelId, logger) ?? client
     : client;
 } catch (err) {
   return null;
 }

  const session = new ChatSession({
    id: sessionId,
    projectId,
    topic: config.topic,
    members: config.members,
    staticContext: config.staticContext ?? {},
    llm: client,
    // 工单 15：成员可指定专属模型；未指定时回落讨论默认 client
    clientResolver: (member) => (member.modelId ? getClientByModelId(member.modelId, logger) ?? client : client),
    maxRounds: config.maxRounds ?? 8,
    maxToolCalls: config.maxToolCalls ?? roundtableCfg.maxToolCalls,
    context: config.context ?? { maxTokens: roundtableCfg.maxTokens },
   chatStore: store,
    consensus: {
      useLLM: config.consensus?.useLLM ?? judgeCfg.enabled ?? roundtableCfg.consensus?.enabled ?? true,
      llmJudge: {
        llm: judgeLlm,
        systemPrompt: judgeSystemPrompt,
        timeoutMs: config.consensus?.llmJudge?.timeoutMs ?? judgeCfg.timeoutMs ?? roundtableCfg.consensus?.timeoutMs ?? 60000,
        modelTemperature: config.consensus?.llmJudge?.modelTemperature ?? judgeCfg.temperature ?? roundtableCfg.consensus?.temperature ?? 0.2,
        maxTokens: config.consensus?.llmJudge?.maxTokens ?? judgeCfg.maxTokens ?? roundtableCfg.consensus?.maxTokens ?? null,
      },
    },
   vector: getVectorBundle() ? { embedding: getVectorBundle()!.embedding, store: getVectorBundle()!.store } : undefined,
   schedulerAgent: {
     enabled: config.schedulerAgent?.enabled ?? directorCfg.enabled ?? roundtableCfg.scheduler?.enabled ?? true,
     llm: schedulerLlm,
      systemPrompt: directorSystemPrompt,
     timeoutMs: config.schedulerAgent?.timeoutMs ?? directorCfg.timeoutMs ?? roundtableCfg.scheduler?.timeoutMs,
     maxTokens: config.schedulerAgent?.maxTokens ?? directorCfg.maxTokens ?? roundtableCfg.scheduler?.maxTokens,
     temperature: config.schedulerAgent?.temperature ?? directorCfg.temperature ?? roundtableCfg.scheduler?.temperature,
   },
    // 恢复已用轮次：以历史中 agent 消息条数近似发言轮数，续跑不超出轮次预算
    resume: {
      history: snapshot.messages ?? [],
      turnsUsed: (snapshot.messages ?? []).filter((m) => m.kind === "agent").length,
    },
  });
  // 与 /start 一致：通过会话事件追踪「当前发言成员」，供 LLM 调用记录标注到具体成员
  const memberNameById = new Map(config.members.map((m) => [m.id, m.name]));
  session.subscribe((event) => {
    if (event.type === "speaker") {
      speaking = { memberId: event.data.memberId, memberName: event.data.memberName };
    } else if (event.type === "agent_status") {
      if (event.data.status === "generating") {
        speaking = { memberId: event.data.memberId, memberName: memberNameById.get(event.data.memberId) ?? "" };
      } else if (event.data.status === "idle") {
        speaking = null;
      }
    } else if (event.type === "chat_message" || event.type === "done" || event.type === "error") {
      speaking = null;
    }
  });
  _sessions.set(sessionId, session);
  try {
    store.save(session.getSnapshot());
  } catch (err) {
    console.warn("恢复会话落盘失败: " + (err instanceof Error ? err.message : String(err)));
  }
  return session;
}

export async function chatSessionsRoutes(app: FastifyInstance): Promise<void> {
  // ---- 开始群聊 ----
  app.post<{
    Body: {
      projectId?: string;
      topic?: string;
      memberIds?: string[];
      staticContext?: Record<string, string>;
      maxRounds?: number;
      /** 单轮上下文 token 预算（缺省用全局圆桌会议配置） */
      context?: { maxTokens?: number };
      /** 每轮工具调用次数上限（缺省用全局圆桌会议配置） */
      maxToolCalls?: number;
    };
  }>("/start", async (req, reply) => {
    const body = req.body ?? {};
    const projectId = String(body.projectId ?? "");
    const topic = String(body.topic ?? "").trim();
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds : [];
    if (!projectId || !topic) return reply.code(400).send({ error: "projectId 与 topic 不能为空" });
    if (memberIds.length === 0) return reply.code(400).send({ error: "请至少选择一个参与角色" });

    let members: ChatMember[];
    try {
      members = memberIds.map(roleToMember);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    // 合成者是共识收束的必备成员，不允许创建不含合成者的会话
    if (!members.some((m) => m.kind === "agent" && m.category === "synthesizer")) {
      return reply.code(400).send({ error: "圆桌会议必须包含至少一名合成者，用于在达成共识后收敛最终方案" });
    }

    const sessionId = randomUUID();
    // 工单 09：通过会话事件追踪「当前发言成员」，让群聊 LLM 调用记录标注到具体成员
    let speaking: { memberId: string; memberName: string } | null = null;
    let client;
    let logger: InteractionLogger | null = null;
    try {
      logger = new InteractionLogger((it) => {
        try {
          saveInteraction("chat", it, {
            task_type: "text",
            session_id: "chat:" + sessionId,
            project_id: projectId,
            channel: "group_chat",
            member_id: speaking?.memberId ?? "",
            member_name: speaking?.memberName ?? "",
          });
        } catch (err) {
          console.warn("保存群聊交互记录失败: " + (err instanceof Error ? err.message : String(err)));
        }
      });
      client = getClientForTask("text", logger);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }

    const roundtableCfg = getRoundtableConfig();
    // 工单 16：导演与共识裁判已独立为角色卡片——模型、提示词、启用状态与运行参数
    // 全部以角色卡片为准，缺省回落圆桌会议全局配置（向后兼容）
    const directorCard = resolveSystemRole("builtin-director");
    const directorCfg = directorCard.config ?? {};
    const schedulerCfg = roundtableCfg.scheduler ?? {};
    const directorModelId = directorCard.modelId ?? schedulerCfg.modelId ?? null;
    const directorSystemPrompt = directorCard.systemPrompt;
    const directorEnabled = directorCfg.enabled ?? schedulerCfg.enabled ?? true;
    const directorTemperature = directorCfg.temperature ?? schedulerCfg.temperature ?? 0.3;
    const directorTimeoutMs = directorCfg.timeoutMs ?? schedulerCfg.timeoutMs ?? 60000;
    const directorMaxTokens = directorCfg.maxTokens ?? schedulerCfg.maxTokens ?? 300;
    let schedulerLlm: LLMClient = client;
    if (directorModelId) {
      schedulerLlm = getClientByModelId(directorModelId, logger) ?? client;
    }
    const judgeCard = resolveSystemRole("builtin-consensus-judge");
    const judgeCfg = judgeCard.config ?? {};
    const consensusCfg = roundtableCfg.consensus ?? {};
    const judgeModelId = judgeCard.modelId ?? null;
    const judgeSystemPrompt = judgeCard.systemPrompt;
    const judgeEnabled = judgeCfg.enabled ?? consensusCfg.enabled ?? true;
    const judgeTemperature = judgeCfg.temperature ?? consensusCfg.temperature ?? 0.2;
    const judgeTimeoutMs = judgeCfg.timeoutMs ?? consensusCfg.timeoutMs ?? 60000;
    const judgeMaxTokens = judgeCfg.maxTokens ?? consensusCfg.maxTokens ?? null;
    let judgeLlm: LLMClient = client;
    if (judgeModelId) {
      judgeLlm = getClientByModelId(judgeModelId, logger) ?? client;
    }
    const session = new ChatSession({
      id: sessionId,
      projectId,
      topic,
      members,
      staticContext: body.staticContext ?? {},
      llm: client,
      // 工单 15：成员可指定专属模型；未指定时回落讨论默认 client
      clientResolver: (member) => (member.modelId ? getClientByModelId(member.modelId, logger) ?? client : client),
      maxRounds: body.maxRounds ?? 8,
      maxToolCalls: body.maxToolCalls ?? roundtableCfg.maxToolCalls,
      context: { maxTokens: body.context?.maxTokens ?? roundtableCfg.maxTokens },
      // 工单 07：讨论记录 / 共识 / 最终方案按书落盘
      chatStore: getChatStore(),
      // 工单 06：注入本地 Embedding + Qdrant；不可用时降级，不阻断
      // 纯 LLM 共识：不计成本，默认启用 LLM 裁判；
      // 是否启用读取「提示词管理 → 圆桌会议 → 共识检测」的 enabled 开关（之前误硬编码为 true）；
      // 超时与导演对齐（默认 60000），输出 token 默认跟随所选模型，可经讨论配置调整
     consensus: {
       useLLM: judgeEnabled,
       llmJudge: {
          llm: judgeLlm,
          systemPrompt: judgeSystemPrompt,
         timeoutMs: judgeTimeoutMs,
         modelTemperature: judgeTemperature,
         maxTokens: judgeMaxTokens,
       },
     },
     vector: getVectorBundle() ? { embedding: getVectorBundle()!.embedding, store: getVectorBundle()!.store } : undefined,
     // 工单 11：发言调度交给统一调度 Agent（群聊导演）；缺省启用，失败自动回退规则调度
     schedulerAgent: {
       enabled: directorEnabled,
       llm: schedulerLlm,
        systemPrompt: directorSystemPrompt,
       timeoutMs: directorTimeoutMs,
       maxTokens: directorMaxTokens,
       temperature: directorTemperature,
     },
      });
    // 工单 09：通过会话事件追踪「当前发言成员」，让群聊 LLM 调用记录标注到具体成员
    const memberNameById = new Map(members.map((m) => [m.id, m.name]));
    session.subscribe((event) => {
      if (event.type === "speaker") {
        speaking = { memberId: event.data.memberId, memberName: event.data.memberName };
      } else if (event.type === "agent_status") {
        if (event.data.status === "generating") {
          speaking = { memberId: event.data.memberId, memberName: memberNameById.get(event.data.memberId) ?? "" };
        } else if (event.data.status === "idle") {
          speaking = null;
        }
      } else if (event.type === "chat_message" || event.type === "done" || event.type === "error") {
        speaking = null;
      }
    });
    _sessions.set(sessionId, session);
    // 会话创建后停在 idle：由作者第一条消息激活，标题仅作会话名
    // 立即落盘 idle 快照：否则会话列表（读磁盘）在作者首条消息激活前看不到新会话
    try {
      getChatStore().save(session.getSnapshot());
    } catch (err) {
      console.warn("落盘新建会话失败: " + (err instanceof Error ? err.message : String(err)));
    }
    // 工单 12：落盘会话运行时配置（进程重启后据此重建会话继续讨论），含导演模型 id
    try {
      getChatStore().saveConfig(projectId, sessionId, {
        projectId,
        topic,
        members,
        staticContext: body.staticContext ?? {},
        maxRounds: body.maxRounds ?? 8,
        maxToolCalls: body.maxToolCalls ?? roundtableCfg.maxToolCalls,
        context: { maxTokens: body.context?.maxTokens ?? roundtableCfg.maxTokens },
       consensus: {
         useLLM: judgeEnabled,
         llmJudge: {
            modelId: judgeModelId,
            systemPrompt: judgeSystemPrompt,
           timeoutMs: judgeTimeoutMs,
           modelTemperature: judgeTemperature,
           maxTokens: judgeMaxTokens,
         },
       },
       schedulerAgent: {
         enabled: directorEnabled,
          modelId: directorModelId,
          systemPrompt: directorSystemPrompt,
         timeoutMs: directorTimeoutMs,
         maxTokens: directorMaxTokens,
         temperature: directorTemperature,
       },
      });
    } catch (err) {
      console.warn("落盘会话运行时配置失败: " + (err instanceof Error ? err.message : String(err)));
    }
    return { sessionId, status: session.getStatus(), members, topic };
  });

  // ---- 会话列表（按书；含共识 / 最终方案，恢复入口） ----
  app.get<{ Querystring: { projectId?: string } }>("/", async (req, reply) => {
    const projectId = String(req.query?.projectId ?? "");
    if (!projectId) return reply.code(400).send({ error: "projectId 不能为空" });
    const store = getChatStore();
    // 工单 10：列表同样清理磁盘上的孤儿运行中会话（不在内存注册表 → 恢复为 terminated）
    for (const s of store.list(projectId)) {
      if (!_sessions.has(s.id) && (s.status === "running" || s.status === "synthesizing")) {
        // 工单 12：停在 ask 的会话例外——进程重启后保留 running 供前端恢复继续讨论
        if (store.getPendingAsk(projectId, s.id)) continue;
        try { store.setStatus(projectId, s.id, "terminated"); } catch { /* 忽略 */ }
      }
    }
    return { sessions: store.list(projectId) };
  });

  // ---- 会话详情（含完整记录；刷新 / 恢复用） ----
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const session = _sessions.get(req.params.id);
    if (session) return session.getSnapshot();
    // 工单 07：内存未命中回退磁盘（重启后仍可查看历史）
    const snapshot = loadFromDisk(req.params.id);
    if (!snapshot) return reply.code(404).send({ error: "讨论会话不存在" });
    return snapshot;
  });

  // ---- 作者发言 ----
  app.post<{ Params: { id: string }; Body: { content?: string } }>("/:id/message", async (req, reply) => {
    const session = _sessions.get(req.params.id);
    if (!session) return reply.code(404).send({ error: "讨论会话不存在" });
    // 若当前有待回答的 ask_user 提问，作者的普通发言应视为对提问的回答，避免挂起的 Agent 永远等待
    if (session.hasPendingAsk) {
      const text = String(req.body?.content ?? "").trim();
      if (!text) return reply.code(400).send({ error: "消息不能为空" });
      const ok = await session.submitAskAnswer(text);
      if (ok) return { success: true, message: session.getMessages().slice(-1)[0], viaAsk: true };
      // 若提交失败则回退到普通消息流程
    }
    try {
      const message = await session.sendUserMessage(String(req.body?.content ?? ""));
      return { success: true, message };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 查询等待中的作者提问（工单 12：断连 / 刷新后恢复 ask 卡片） ----
  app.get<{ Params: { id: string } }>("/:id/pending-ask", async (req, reply) => {
    const session = _sessions.get(req.params.id);
    if (session) {
      const pending = session.peekPendingAsk();
      return pending
        ? { has_pending: true, question: pending.question, memberId: pending.memberId, memberName: pending.memberName }
        : { has_pending: false, question: null, memberId: null, memberName: null };
    }
    // 工单 12：内存未命中回退磁盘（进程重启后仍可恢复 ask 卡片）
    const pending = findPendingAskOnDisk(req.params.id);
    return pending
      ? { has_pending: true, question: pending.question, memberId: pending.memberId, memberName: pending.memberName }
      : { has_pending: false, question: null, memberId: null, memberName: null };
  });

  // ---- 提交作者对 ask_user 的回答（工单 12） ----
  app.post<{ Params: { id: string }; Body: { answer?: string } }>("/:id/answer", async (req, reply) => {
    const answer = String(req.body?.answer ?? "").trim();
    if (!answer) return reply.code(400).send({ error: "回答不能为空" });
    // 工单 12：内存未命中时从磁盘自动恢复「停在 ask」的会话，回答照常提交并续跑
    let session: ChatSession | null = _sessions.get(req.params.id) ?? null;
    let resumed = false;
    if (!session) {
      session = await resumeSessionFromDisk(req.params.id);
      resumed = !!session;
    }
    if (!session) return reply.code(404).send({ error: "讨论会话不存在" });
    try {
      const ok = await session.submitAskAnswer(answer);
      if (!ok) return reply.code(400).send({ error: "当前没有等待回答的提问" });
      // resumed 标记：前端据此重连事件流（会话刚重建，尚无活跃订阅）
      return { success: true, resumed };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 工单 12：从磁盘恢复「停在 ask」的会话（进程重启后进入会话前先恢复） ----
  app.post<{ Params: { id: string } }>("/:id/resume", async (req, reply) => {
    let session: ChatSession | null = _sessions.get(req.params.id) ?? null;
    let resumed = false;
    if (!session) {
      session = await resumeSessionFromDisk(req.params.id);
      resumed = !!session;
    }
    if (!session) return reply.code(404).send({ error: "讨论会话不存在，或当前没有可恢复的未完成讨论" });
    return { success: true, resumed, sessionId: session.id, status: session.getStatus() };
  });

  // ---- 手动终止 ----
  app.post<{ Params: { id: string } }>("/:id/stop", async (req, reply) => {
    const session = _sessions.get(req.params.id);
    if (!session) return reply.code(404).send({ error: "讨论会话不存在" });
    try {
      session.stop();
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    return { success: true, status: session.getStatus() };
  });

  // ---- 删除会话（内存 + 磁盘彻底移除） ----
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const sessionId = req.params.id;
    // 关闭该会话既有的活跃 SSE 流，避免删除后残留订阅 / 心跳
    const activeStream = _activeStreams.get(sessionId);
    if (activeStream) {
      try {
        activeStream.close();
      } catch {
        /* 忽略 */
      }
      _activeStreams.delete(sessionId);
    }
    const session = _sessions.get(sessionId);
    if (session) {
      // 中止调度 + 停止落盘，避免异步收尾把已删除会话重新写回磁盘
      session.dispose();
      _sessions.delete(sessionId);
    }
    // 磁盘删除：跨项目查找（与 loadFromDisk 一致）
    let deleted = false;
    for (const project of getProjectStore().list()) {
      if (getChatStore().delete(project.id, sessionId)) {
        deleted = true;
        break;
      }
    }
    if (!deleted && !session) {
      return reply.code(404).send({ error: "讨论会话不存在" });
    }
    // 工单 09：级联清除该会话在 interactions.jsonl 中的全部 LLM 调用记录
    deleteBySession("chat:" + sessionId);
    return { success: true };
  });

  // ---- 应用最终方案（工单 08）：保存文档 / 应用大纲 / 应用人设 ----
  app.post<{ Params: { id: string }; Body: { target?: string } }>("/:id/apply", async (req, reply) => {
    const session = _sessions.get(req.params.id);
    const snapshot = session ? session.getSnapshot() : loadFromDisk(req.params.id);
    if (!snapshot) return reply.code(404).send({ error: "讨论会话不存在" });
    if (snapshot.status !== "completed" || !snapshot.summary || !snapshot.summary.trim()) {
      return reply.code(400).send({ error: "会话尚未完成，无最终方案可应用" });
    }
    const target = String(req.body?.target ?? "") as ChatApplyTarget;
    if (!CHAT_APPLY_TARGETS.includes(target)) {
      return reply.code(400).send({ error: "未知应用目标: " + target + "（可选：document / outline / characters）" });
    }

    let client: LLMClient;
    try {
      const logger = new InteractionLogger((it) => {
        try {
          saveInteraction("chat_apply", it, {
            task_type: "text",
            session_id: "chat:" + snapshot.id,
            project_id: snapshot.projectId,
            channel: "group_chat",
            member_name: "方案应用",
          });
        } catch (err) {
          console.warn("保存群聊应用交互记录失败: " + (err instanceof Error ? err.message : String(err)));
        }
      });
      client = getClientForTask("text", logger);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }

    try {
      const result = await applyChatSessionPlan({
        projectId: snapshot.projectId,
        sessionId: snapshot.id,
        topic: snapshot.topic,
        summary: snapshot.summary,
        target,
        llm: client,
        projectStore: getProjectStore(),
      });
      return result;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- SSE 实时事件流 ----
  app.get<{ Params: { id: string } }>("/:id/stream", async (req, reply) => {
    // 单活跃流守卫：新连接先关闭该会话既有的活跃流，避免重复订阅
    const existingStream = _activeStreams.get(req.params.id);
    if (existingStream) {
      try {
        existingStream.close();
      } catch {
        /* 忽略旧连接关闭异常 */
      }
    }

    let session: ChatSession | null = _sessions.get(req.params.id) ?? null;
    // 工单 07：内存未命中时从磁盘恢复终态会话（历史回放后补发 done）
    let snapshot = session ? undefined : loadFromDisk(req.params.id);
    // 工单 12：停在 ask 的会话（进程重启后）自动重建，前端无需先调 /resume 即可继续订阅
    if (!session && snapshot && (snapshot.status === "running" || snapshot.status === "synthesizing")) {
      session = await resumeSessionFromDisk(req.params.id);
      if (session) snapshot = undefined;
    }
    if (!session && !snapshot) return reply.code(404).send({ error: "讨论会话不存在" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.on("error", () => {});

    const send = (event: string, data: unknown): void => {
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* 连接已关闭，忽略 */
      }
    };
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        /* 忽略 */
      }
    }, 15000);

    let closed = false;
    let unsubscribe: () => void = () => {};
    const close = (): void => {
      if (closed) return;
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
      // 仅当本流仍是最新活跃流时移除注册，避免误删新连接的条目
      if (_activeStreams.get(req.params.id)?.close === close) {
        _activeStreams.delete(req.params.id);
      }
      try {
        reply.raw.end();
      } catch {
        /* 忽略 */
      }
    };
    reply.raw.on("close", close);
    // 提前注册为活跃流：若新连接在订阅前接入，也能被正确关闭（后续 unsubscribe 为 no-op 前已 close）
    _activeStreams.set(req.params.id, { close });

    const emit = (event: ChatSessionEvent): void => {
      if (closed) return;
      send(event.type, event.data);
      // 会话终态事件到达后关闭流，前端据此收尾
      if (event.type === "done" || event.type === "error") close();
    };

    // 断线重连 / 刷新时回放历史，前端按消息 id 去重
    const messages = session ? session.getMessages() : (snapshot?.messages ?? []);
    const status = session ? session.getStatus() : (snapshot?.status ?? "terminated");
    for (const m of messages) {
      send("chat_message", m);
    }
    send("system", {
      message: `已连接会话，当前状态：${status}`,
      status,
    });
    // 已结束会话补发终态事件，让前端一次拉齐
    if (status === "completed") {
      send("done", { status: "completed", summary: snapshot?.summary });
      close();
      return;
    }
    if (status === "terminated") {
      send("done", { status: "terminated" });
      close();
      return;
    }

    if (!session) {
      send("error", { error: "会话未在内存中运行，无法继续订阅" });
      close();
      return;
    }
    unsubscribe = session.subscribe(emit);
  });
}
