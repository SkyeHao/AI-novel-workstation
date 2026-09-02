/** 提示词管理路由：创作引擎 7 节点提示词可编辑，圆桌会议复用 agent-roles */
import type { FastifyInstance } from "fastify";
import { listNodePrompts, getNodePrompt, setNodePrompt, resetNodePrompt } from "../../storage/node_prompt_store.js";

export async function promptsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => {
    return { prompts: listNodePrompts() };
  });

  app.get<{ Params: { key: string } }>("/:key", async (req, reply) => {
    const detail = getNodePrompt(req.params.key);
    if (!detail) return reply.code(404).send({ error: "未知节点" });
    return detail;
  });

  app.put<{ Params: { key: string }; Body: { prompt?: string } }>("/:key", async (req, reply) => {
    const key = req.params.key;
    const prompt = String(req.body?.prompt ?? "");
    if (!prompt.trim()) return reply.code(400).send({ error: "提示词不能为空" });
    try {
      const detail = setNodePrompt(key, prompt);
      if (!detail) return reply.code(404).send({ error: "未知节点" });
      return detail;
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { key: string } }>("/:key/reset", async (req, reply) => {
    const detail = resetNodePrompt(req.params.key);
    if (!detail) return reply.code(404).send({ error: "未知节点" });
    return detail;
  });
}
