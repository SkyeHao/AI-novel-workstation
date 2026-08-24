/** 交互记录路由（TS 版，迁移自 api/routes/interactions.py）。 */
import type { FastifyInstance } from "fastify";
import { listInteractions, getInteraction, deleteInteraction, deleteBySession, clearAllInteractions, aggregateInteractions } from "../../storage/interaction_store.js";
import { AgentSessionStore } from "../../storage/agent_session_store.js";
import { getProjectStore } from "../state.js";

export async function interactionsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { source?: string; limit?: string; offset?: string; session_id?: string; channel?: string } }>("/", async (req) => {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    return listInteractions({
      source: req.query.source || undefined,
      session_id: req.query.session_id || undefined,
      channel: (req.query.channel as "agent" | "group_chat" | undefined) || undefined,
      limit,
      offset,
    });
  });

  // 聚合接口：按 turn_id 聚合交互记录
  app.get<{ Querystring: { source?: string; limit?: string; offset?: string; session_id?: string; project_id?: string; channel?: string } }>("/aggregated", async (req) => {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const sStore = new AgentSessionStore(getProjectStore());
    const titleCache = new Map<string, string>();
    const sessionTitleResolver = (projectId: string, sessionId: string): string => {
      if (!sessionId) return "";
      const key = projectId + "::" + sessionId;
      const cached = titleCache.get(key);
      if (cached !== undefined) return cached;
      let title = "";
      try {
        title = sStore.get(projectId, sessionId)?.title ?? "";
      } catch {
        title = "";
      }
      titleCache.set(key, title);
      return title;
    };
    return aggregateInteractions({
      source: req.query.source || undefined,
      session_id: req.query.session_id || undefined,
      project_id: req.query.project_id || undefined,
      channel: (req.query.channel as "agent" | "group_chat" | undefined) || undefined,
      limit,
      offset,
      sessionTitleResolver,
    });
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const it = getInteraction(req.params.id);
    if (!it) return reply.code(404).send({ error: "交互记录不存在" });
    return it;
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ok = deleteInteraction(req.params.id);
    if (!ok) return reply.code(404).send({ error: "交互记录不存在" });
    return { success: true, message: "已删除" };
  });

  app.delete<{ Params: { sessionId: string } }>("/by-session/:sessionId", async (req) => {
    const count = deleteBySession(req.params.sessionId);
    return { success: true, message: `已删除 ${count} 条`, deleted_count: count };
  });

  app.delete<{ Querystring: { source?: string } }>("/", async (req) => {
    const count = clearAllInteractions(req.query.source || undefined);
    return { success: true, message: `已清空 ${count} 条`, deleted_count: count };
  });
}
