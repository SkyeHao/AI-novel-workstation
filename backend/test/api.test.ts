import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildApp } from "../src/server.js";

let dir: string;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-api-"));
  process.env.AI_NOVEL_STATE_FILE = path.join(dir, "app-state.json");
  app = await buildApp({ projectDir: dir });
});

afterEach(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("api（ADR-0005 集成）", () => {
  it("health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).runtime).toBe("ts");
  });

  it("项目 CRUD + 两级状态（current_state 单锚点）", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "测试书", idea: "开篇梗", genre: "玄幻" },
    });
    expect(created.statusCode).toBe(200);
    const project = JSON.parse(created.body);
    expect(project.status).toBe("ideation");

    const states = await app.inject({ method: "GET", url: `/api/projects/${project.id}/states` });
    expect(states.statusCode).toBe(200);
    const statesBody = JSON.parse(states.body);
    expect(statesBody.current_state).toBe("ideation");
    expect(statesBody.states.length).toBe(7);

    const switched = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/states/switch`,
      payload: { state: "writing" },
    });
    expect(switched.statusCode).toBe(200);
    expect(JSON.parse(switched.body).current_state).toBe("writing");

    // 状态可扩展配置
    const configRes = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/states/config`,
      payload: { states_enabled: ["ideation", "worldview", "characters", "outline", "writing", "review"], work_unit: "ch3" },
    });
    expect(configRes.statusCode).toBe(200);
    const cfg = JSON.parse(configRes.body);
    expect(cfg.states_enabled).toHaveLength(6);
    expect(cfg.work_unit).toBe("ch3");
  });

  it("记忆接口（T5）+ 前置检测（T2）", async () => {
    const project = JSON.parse(
      (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "记忆书" } })).body
    );
    const factRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/memory/facts`,
      payload: { fact: "主角林一", state: "characters", source: "对话" },
    });
    expect(factRes.statusCode).toBe(200);

    const mem = await app.inject({ method: "GET", url: `/api/projects/${project.id}/memory` });
    const memBody = JSON.parse(mem.body);
    expect(memBody.stats.facts).toBe(1);

    const prereq = await app.inject({ method: "GET", url: `/api/projects/${project.id}/prereq-check` });
    expect(prereq.statusCode).toBe(200);
    expect(JSON.parse(prereq.body).complete).toBe(false);

    // 设定写入后完备检测通过
    await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/settings/worldview`,
      payload: { sections: { era: "x", rules: "y", geography: "z", factions: "a", history: "b" } },
    });
    const prereq2 = await app.inject({ method: "GET", url: `/api/projects/${project.id}/prereq-check` });
    expect(JSON.parse(prereq2.body).details.worldview).toBe(true);
  });

  it("按状态的任务分配（config assignments，状态细分）", async () => {
    // 建一个模型
    const model = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/config/models",
          payload: { name: "测试模型", provider_id: "custom", api_key: "sk-test", base_url: "https://example.com/v1", model: "test-model" },
        })
      ).body
    );
    // GET /config/assignments 返回 7 个状态槽
    const listRes = await app.inject({ method: "GET", url: "/api/config/assignments" });
    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.body);
    expect(list.length).toBe(7);
    expect(list.map((a: { state: string }) => a.state)).toEqual([
      "ideation", "worldview", "characters", "outline", "writing", "review", "style",
    ]);

    // 给 writing 状态分配模型
    const putRes = await app.inject({
      method: "PUT",
      url: "/api/config/assignments/writing",
      payload: { model_id: model.id },
    });
    expect(putRes.statusCode).toBe(200);
    expect(JSON.parse(putRes.body).state).toBe("writing");
    expect(JSON.parse(putRes.body).model_id).toBe(model.id);

    // 非法状态被拒绝
    const badRes = await app.inject({
      method: "PUT",
      url: "/api/config/assignments/not-a-state",
      payload: { model_id: model.id },
    });
    expect(badRes.statusCode).toBe(400);
  });

  it("伏笔台账接口", async () => {
    const project = JSON.parse(
      (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "伏笔书" } })).body
    );
    const add = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/foreshadow`,
      payload: { desc: "玉佩秘密", planted_at: "第1章" },
    });
    expect(add.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: `/api/projects/${project.id}/foreshadow` });
    const items = JSON.parse(list.body).items;
    expect(items.length).toBe(1);
    const mark = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/foreshadow/${items[0].id}`,
      payload: { status: "reaped" },
    });
    expect(JSON.parse(mark.body).status).toBe("reaped");
  });
});
