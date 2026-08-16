/** 文件读取路由（TS 版，迁移自 api/routes/files.py）。 */
import type { FastifyInstance } from "fastify";
import * as path from "node:path";
import * as fs from "node:fs";
import { getProjectDirPath } from "../state.js";
import { safeResolve } from "../../storage/path_safety.js";

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { path?: string; max_chars?: string } }>("/read", async (req, reply) => {
    const raw = req.query.path ?? "";
    if (!raw) return reply.code(400).send({ success: false, content: "", error: "path 不能为空" });
    const parts = raw.split("/").filter(Boolean);
    const projectId = parts[0] ?? "";
    const rel = parts.slice(1).join("/");
    if (!projectId || !rel) return reply.code(400).send({ success: false, content: "", error: "path 需为 <projectId>/<相对路径>" });
    const base = path.join(getProjectDirPath(), projectId);
    let target: string;
    try {
      target = safeResolve(base, rel);
    } catch (err) {
      return reply.code(400).send({ success: false, content: "", error: err instanceof Error ? err.message : String(err) });
    }
    if (!fs.existsSync(target)) {
      return reply.code(404).send({ success: false, content: "", error: `文件不存在: ${rel}` });
    }
    const maxChars = Number(req.query.max_chars ?? 50000);
    try {
      let content = fs.readFileSync(target, "utf-8");
      if (content.length > maxChars) content = content.slice(0, maxChars) + "...";
      return { success: true, content, error: "" };
    } catch (err) {
      return reply.code(500).send({ success: false, content: "", error: err instanceof Error ? err.message : String(err) });
    }
  });
}

