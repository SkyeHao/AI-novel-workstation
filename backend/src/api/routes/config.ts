/** 配置管理路由（TS 版，迁移自 api/routes/config.py）。 */
import type { FastifyInstance } from "fastify";
import { getSearchConfig, setSearchConfig, listModels, createModel, updateModel, deleteModel, testModel, getAssignments, setAssignment, PROVIDERS, getProjectDirPath, setProjectDirPath } from "../state.js";
import type { TaskType } from "../../llm/manager.js";
import { DEFAULT_STATE_KEYS } from "../../storage/states.js";

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // ---- 模型池 ----
  app.get("/models", async () => listModels());

  app.post<{ Body: Record<string, unknown> }>("/models", async (req, reply) => {
    const b = req.body ?? {};
    const required = ["name", "api_key", "base_url", "model"];
    for (const k of required) {
      if (!b[k]) return reply.code(400).send({ error: `缺少字段: ${k}` });
    }
    const entry = createModel({
      name: String(b.name),
      provider_id: String(b.provider_id ?? "custom"),
      api_key: String(b.api_key),
      base_url: String(b.base_url),
      model: String(b.model),
      temperature: Number(b.temperature ?? 0.7),
      max_tokens: b.max_tokens == null ? null : Number(b.max_tokens),
      timeout: Number(b.timeout ?? 120),
      max_retries: Number(b.max_retries ?? 3),
    });
    return entry;
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>("/models/:id", async (req, reply) => {
    const entry = updateModel(req.params.id, req.body ?? {});
    if (!entry) return reply.code(404).send({ error: "模型不存在" });
    return entry;
  });

  app.delete<{ Params: { id: string } }>("/models/:id", async (req, reply) => {
    const ok = deleteModel(req.params.id);
    if (!ok) return reply.code(404).send({ error: "模型不存在" });
    return { success: true };
  });

  app.post<{ Params: { id: string } }>("/models/:id/test", async (req, reply) => {
    try {
      return await testModel(req.params.id);
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 任务分配 ----
  app.get("/assignments", async () => getAssignments());

  app.put<{ Params: { state: string }; Body: { model_id?: string | null } }>("/assignments/:state", async (req, reply) => {
    const stateKey = req.params.state;
    if (!DEFAULT_STATE_KEYS.includes(stateKey)) return reply.code(400).send({ error: "非法状态" });
    setAssignment(stateKey, req.body?.model_id ?? null);
    const list = getAssignments();
    return list.find((a) => a.state === stateKey);
  });

  // ---- 服务商列表 ----
  app.get("/providers", async () => PROVIDERS);

  // ---- 项目目录 ----
  app.get("/project-dir", async () => {
    const dir = getProjectDirPath();
    return { project_dir: dir, absolute_path: dir, exists: true };
  });

  app.put<{ Body: { project_dir?: string } }>("/project-dir", async (req, reply) => {
    const dir = String(req.body?.project_dir ?? "").trim();
    if (!dir) return reply.code(400).send({ error: "project_dir 不能为空" });
    const resolved = setProjectDirPath(dir);
    return { project_dir: resolved, absolute_path: resolved, exists: true };
  });

  // ---- 联网搜索配置 ----
  app.get("/search", async () => getSearchConfig());

  app.put<{ Body: { tavily_api_key?: string; serper_api_key?: string; providers?: string } }>("/search", async (req, reply) => {
    try {
      return setSearchConfig(req.body ?? {});
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
