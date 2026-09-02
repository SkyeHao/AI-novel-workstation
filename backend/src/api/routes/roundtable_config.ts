/** 圆桌会议配置路由：读取 / 更新会议级默认配置（上下文预算、工具调用次数）。 */
import type { FastifyInstance } from "fastify";
import {
  getRoundtableConfig,
  updateRoundtableConfig,
  resetRoundtableConfig,
  type RoundtableConfig,
} from "../../assets/roundtable_config.js";

export async function roundtableConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => {
    return getRoundtableConfig();
  });

  app.put<{ Body: Partial<RoundtableConfig> }>("/", async (req, reply) => {
    const body = req.body ?? {};
    if (typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "配置格式错误" });
    }
    try {
      return updateRoundtableConfig(body);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/reset", async () => {
    return resetRoundtableConfig();
  });
}
