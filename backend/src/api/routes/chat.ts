/** 聊天测试路由（TS 版，迁移自 api/routes/chat.py）。 */
import type { FastifyInstance } from "fastify";
import { getClientForTask } from "../state.js";
import { ChatMessage } from "../../llm/models.js";
import { InteractionLogger } from "../../llm/interaction_logger.js";
import { saveInteraction } from "../../storage/interaction_store.js";

interface MsgIn {
  role?: string;
  content?: string;
}

function toMessages(messages: MsgIn[] | undefined): ChatMessage[] {
  return (messages ?? []).map((m) => new ChatMessage(m.role ?? "user", m.content ?? ""));
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { task?: string; messages?: MsgIn[]; temperature?: number | null; max_tokens?: number | null } }>("/", async (req, reply) => {
    const logger = new InteractionLogger();
    let client;
    try {
      client = getClientForTask((req.body?.task as "text" | "structure" | "check") ?? "text", logger);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const messages = toMessages(req.body?.messages);
    const kwargs: Record<string, unknown> = {};
    if (req.body?.temperature != null) kwargs.temperature = req.body.temperature;
    if (req.body?.max_tokens != null) kwargs.max_tokens = req.body.max_tokens;

    const start = Date.now();
    let response;
    try {
      response = await client.achat(messages, kwargs);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const elapsedMs = Date.now() - start;

    const interactions = logger.get_all();
    let interactionOut: Record<string, unknown> | null = null;
    if (interactions.length > 0) {
      const it = interactions[interactions.length - 1]!;
      interactionOut = { ...it };
      try {
        saveInteraction("chat", it, { task_type: req.body?.task ?? "text" });
      } catch (err) {
        console.warn(`保存交互记录失败: ${err}`);
      }
    }

    return {
      content: response.content,
      model: response.model,
      prompt_tokens: response.usage.prompt_tokens,
      completion_tokens: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens,
      finish_reason: response.finish_reason,
      elapsed_ms: elapsedMs,
      interaction: interactionOut,
    };
  });

  app.post<{ Body: { task?: string; messages?: MsgIn[]; temperature?: number | null; max_tokens?: number | null } }>("/stream", async (req, reply) => {
    let client;
    try {
      client = getClientForTask((req.body?.task as "text" | "structure" | "check") ?? "text");
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const messages = toMessages(req.body?.messages);
    const kwargs: Record<string, unknown> = {};
    if (req.body?.temperature != null) kwargs.temperature = req.body.temperature;
    if (req.body?.max_tokens != null) kwargs.max_tokens = req.body.max_tokens;

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    try {
      for await (const chunk of client.astream(messages, kwargs)) {
        reply.raw.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`);
      }
      reply.raw.write(`event: done\ndata: [DONE]\n\n`);
    } catch (err) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify(err instanceof Error ? err.message : String(err))}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  app.post<{ Body: { task?: string; messages?: MsgIn[] } }>("/tokens", async (req, reply) => {
    let client;
    try {
      client = getClientForTask((req.body?.task as "text" | "structure" | "check") ?? "text");
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const messages = toMessages(req.body?.messages);
    return { token_count: client.count_tokens(messages) };
  });
}
