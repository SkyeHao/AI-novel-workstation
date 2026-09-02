import { describe, expect, it, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildApp } from "../src/server.js";
import { createModel, setAssignment } from "../src/api/state.js";

let dir: string;
let app: Awaited<ReturnType<typeof buildApp>> | null = null;

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  if (dir) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("新建群聊会话后立即出现在会话列表", () => {
  it("start 创建后无需作者发言，list 即可查到该会话（status=idle）", async () => {
    // 注入一个 fake 模型并分配给 text 任务：/start 只构造 client，不发起 LLM 调用
    const model = createModel({
      name: "列表测试模型",
      provider_id: "custom",
      api_key: "sk-fake-list-test",
      base_url: "https://example.com/v1",
      model: "fake-list-model",
      temperature: 0.7,
      max_tokens: 2000,
      timeout: 30,
      max_retries: 1,
    });
    setAssignment("text", model.id);

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-chatlist-"));
    app = await buildApp({ projectDir: dir });

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "列表书", idea: "开篇", genre: "玄幻" },
    });
    expect(created.statusCode).toBe(200);
    const projectId = JSON.parse(created.body).id;

    const start = await app.inject({
      method: "POST",
      url: "/api/chat-sessions/start",
      payload: {
        projectId,
        topic: "测试主题",
        memberIds: ["builtin-conflict-driver", "builtin-synthesizer"],
      },
    });
    expect(start.statusCode).toBe(200);
    const { sessionId, status } = JSON.parse(start.body);
    expect(status).toBe("idle");

    // 关键断言：尚未发送任何作者消息，新会话就已出现在列表
    const list = await app.inject({
      method: "GET",
      url: "/api/chat-sessions?projectId=" + projectId,
    });
    expect(list.statusCode).toBe(200);
    const sessions = JSON.parse(list.body).sessions;
    const found = sessions.find((s: { id: string }) => s.id === sessionId);
    expect(found).toBeTruthy();
    expect(found.status).toBe("idle");
  });

  it("start 拒绝不含合成者的会话（必须至少一名合成者收敛最终方案）", async () => {
    const model = createModel({
      name: "列表测试模型2",
      provider_id: "custom",
      api_key: "sk-fake-list-test-2",
      base_url: "https://example.com/v1",
      model: "fake-list-model-2",
      temperature: 0.7,
      max_tokens: 2000,
      timeout: 30,
      max_retries: 1,
    });
    setAssignment("text", model.id);

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-chatlist-nosyn-"));
    app = await buildApp({ projectDir: dir });

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "无合成者书", idea: "开篇", genre: "玄幻" },
    });
    expect(created.statusCode).toBe(200);
    const projectId = JSON.parse(created.body).id;

    const start = await app.inject({
      method: "POST",
      url: "/api/chat-sessions/start",
      payload: {
        projectId,
        topic: "测试主题",
        memberIds: ["builtin-conflict-driver", "builtin-world-guardian"],
      },
    });
    expect(start.statusCode).toBe(400);
    expect(JSON.parse(start.body).error).toContain("合成者");
  });
});
