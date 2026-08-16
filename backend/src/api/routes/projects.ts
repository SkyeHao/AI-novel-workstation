/** 项目管理路由（TS 版，迁移自 api/routes/projects.py）。
 * 新增：状态机端点（states / current-state / states/switch）、伏笔与记忆端点。 */
import type { FastifyInstance } from "fastify";
import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectStore } from "../state.js";
import { Project, ProjectNotFoundError, ProjectError } from "../../storage/project_store.js";
import { SettingsStore } from "../../storage/settings_store.js";
import { MemoryStore } from "../../storage/memory_store.js";
import { DEFAULT_STATES, getStateNode, legacyStatusToNew } from "../../storage/states.js";
import { coreElementsPath, loadCoreElements } from "../../workflow/core_elements.js";

export async function projectsRoutes(app: FastifyInstance): Promise<void> {
  const store = () => getProjectStore();

  app.get("/", async () => store().list().map((p) => p.toDict()));

  app.post<{ Body: { name?: string; idea?: string; target_words?: number; platform?: string; genre?: string } }>("/", async (req, reply) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return reply.code(400).send({ error: "项目名称不能为空" });
    try {
      const p = store().create(name, req.body?.idea ?? "", {
        target_words: Number(req.body?.target_words ?? 0),
        platform: req.body?.platform ?? "",
        genre: req.body?.genre ?? "",
      });
      return p.toDict();
    } catch (err) {
      if (err instanceof ProjectError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    try {
      return store().get(req.params.id).toDict();
    } catch (err) {
      if (err instanceof ProjectNotFoundError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>("/:id", async (req, reply) => {
    try {
      const p = store().update(req.params.id, req.body ?? {});
      return p.toDict();
    } catch (err) {
      if (err instanceof ProjectNotFoundError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    try {
      store().delete(req.params.id);
      return { success: true };
    } catch (err) {
      if (err instanceof ProjectNotFoundError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  // ---- 设定 ----
  app.get<{ Params: { id: string; setting_type: string } }>("/:id/settings/:setting_type", async (req, reply) => {
    const settings = new SettingsStore(store());
    try {
      return settings.get(req.params.id, req.params.setting_type);
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put<{ Params: { id: string; setting_type: string }; Body: Record<string, unknown> }>("/:id/settings/:setting_type", async (req, reply) => {
    const settings = new SettingsStore(store());
    try {
      return settings.save(req.params.id, req.params.setting_type, req.body ?? {});
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 状态机（T1/T2） ----
  app.get<{ Params: { id: string } }>("/:id/states", async (req, reply) => {
    try {
      const p = store().get(req.params.id);
      const enabled = p.states_enabled && p.states_enabled.length > 0 ? p.states_enabled : DEFAULT_STATES.map((s) => s.key);
      const states = DEFAULT_STATES.map((s) => ({ ...s, enabled_in_project: enabled.includes(s.key) }));
      const current = getStateNode(legacyStatusToNew(p.status));
      return { states, current_state: current.key, current_label: current.label, work_unit: p.work_unit };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put<{ Params: { id: string }; Body: { states_enabled?: string[]; work_unit?: string } }>("/:id/states/config", async (req, reply) => {
    try {
      const p = store().get(req.params.id);
      const allowed = DEFAULT_STATES.map((s) => s.key);
      if (req.body?.states_enabled) {
        const filtered = req.body.states_enabled.filter((k) => allowed.includes(k));
        p.states_enabled = filtered;
      }
      if (req.body?.work_unit !== undefined) p.work_unit = req.body.work_unit;
      store().save(p);
      return p.toDict();
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string }; Body: { state: string } }>("/:id/states/switch", async (req, reply) => {
    try {
      const node = getStateNode(String(req.body?.state ?? ""));
      const p = store().update(req.params.id, { status: node.key });
      return { current_state: legacyStatusToNew(p.status), label: getStateNode(legacyStatusToNew(p.status)).label, work_unit: p.work_unit };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 核心要素 / 愿景文档 / 文档列表 ----
  app.get<{ Params: { id: string } }>("/:id/core-elements", async (req, reply) => {
    try {
      const root = store().project_root(req.params.id);
      const data = loadCoreElements(root);
      return { exists: Object.keys(data).length > 0, data };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>("/:id/core-elements", async (req, reply) => {
    try {
      const { saveCoreElements, validateCoreElements } = await import("../../workflow/core_elements.js");
      const root = store().project_root(req.params.id);
      const errors = validateCoreElements(req.body ?? {});
      if (errors.length > 0) return reply.code(400).send({ success: false, errors });
      const saved = saveCoreElements(root, req.body as Record<string, unknown>);
      return { success: true, path: saved };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { id: string } }>("/:id/vision-doc", async (req, reply) => {
    try {
      const root = store().project_root(req.params.id);
      const p = path.join(root, "故事愿景文档.md");
      if (!fs.existsSync(p)) return { exists: false, content: "", path: "" };
      return { exists: true, content: fs.readFileSync(p, "utf-8"), path: p };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { id: string } }>("/:id/documents", async (req, reply) => {
    try {
      const { getProjectDocuments } = await import("../../workflow/documents.js");
      return getProjectDocuments(store(), req.params.id);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 前置完备检测（T2） ----
  app.get<{ Params: { id: string } }>("/:id/prereq-check", async (req, reply) => {
    try {
      const settings = new SettingsStore(store());
      const checks: Record<string, string> = {
        worldview: "世界观设定",
        characters: "人物卡片",
        outline: "章纲规划",
        style: "风格设定",
      };
      const details: Record<string, boolean> = {};
      const missing: string[] = [];
      for (const [key, label] of Object.entries(checks)) {
        const ok = settings.exists(req.params.id, key);
        details[key] = ok;
        if (!ok) missing.push(label);
      }
      return { complete: missing.length === 0, missing, details };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 伏笔台账（T5） ----
  app.get<{ Params: { id: string } }>("/:id/foreshadow", async (req, reply) => {
    try {
      const memory = new MemoryStore(store());
      return { items: memory.listForeshadow(req.params.id) };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string }; Body: { desc?: string; planted_at?: string; planned_reap?: string; status?: string } }>("/:id/foreshadow", async (req, reply) => {
    try {
      const memory = new MemoryStore(store());
      const rec = memory.addForeshadow(
        req.params.id,
        String(req.body?.desc ?? "").trim(),
        req.body?.planted_at ?? "",
        req.body?.planned_reap ?? "",
        req.body?.status ?? "planted"
      );
      return rec;
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put<{ Params: { id: string; foreshadow_id: string }; Body: { status?: string; reap_info?: string } }>("/:id/foreshadow/:foreshadow_id", async (req, reply) => {
    try {
      const memory = new MemoryStore(store());
      const status = (req.body?.status ?? "reaped") as "planted" | "reaped" | "dropped";
      const rec = memory.updateForeshadow(req.params.id, req.params.foreshadow_id, status, req.body?.reap_info ?? "");
      if (!rec) return reply.code(404).send({ error: "伏笔不存在" });
      return rec;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 记忆（T5/T6） ----
  app.get<{ Params: { id: string } }>("/:id/memory", async (req, reply) => {
    try {
      const memory = new MemoryStore(store());
      return {
        facts: memory.listFacts(req.params.id),
        foreshadow: memory.listForeshadow(req.params.id),
        characters: memory.loadCharacters(req.params.id),
        summaries: [1, 2, 3, 4, 5].map((l) => ({ level: l, content: memory.loadSummary(req.params.id, l) })).filter((s) => s.content),
        stats: memory.stats(req.params.id),
      };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string }; Body: { fact?: string; source?: string; state?: string; known_by?: string[]; supersedes?: string } }>("/:id/memory/facts", async (req, reply) => {
    try {
      const memory = new MemoryStore(store());
      const rec = memory.addFact(
        req.params.id,
        String(req.body?.fact ?? "").trim(),
        req.body?.source ?? "",
        req.body?.state ?? "",
        req.body?.known_by ?? null,
        req.body?.supersedes ?? null
      );
      if (!rec.fact) return reply.code(400).send({ error: "fact 不能为空" });
      return rec;
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

