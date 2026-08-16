import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectStore } from "../src/storage/project_store.js";
import { AgentSessionStore } from "../src/storage/agent_session_store.js";

let dir: string;
let store: ProjectStore;
let sessions: AgentSessionStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-sess-"));
  store = new ProjectStore(dir);
  sessions = new AgentSessionStore(store);
  store.create("书A", "测试书", { status: "writing" });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("AgentSessionStore（按书多会话）", () => {
  it("创建 / 列表 / 获取", () => {
    expect(sessions.list("书A")).toHaveLength(0);
    const meta = sessions.create("书A", { title: "灵感讨论", state: "ideation" });
    expect(meta.id).toBeTruthy();
    expect(meta.title).toBe("灵感讨论");
    expect(meta.state).toBe("ideation");
    expect(meta.message_count).toBe(0);
    const list = sessions.list("书A");
    expect(list).toHaveLength(1);
    expect(sessions.get("书A", meta.id)?.title).toBe("灵感讨论");
    expect(sessions.get("书A", "不存在")).toBeNull();
  });

  it("消息保存 / 加载 / 元数据 touch", () => {
    const meta = sessions.create("书A", { title: "对话" });
    const msgs = [
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好！有什么想聊的？" },
    ];
    sessions.saveMessages("书A", meta.id, msgs);
    expect(sessions.loadMessages("书A", meta.id)).toEqual(msgs);
    sessions.touch("书A", meta.id, { state: "writing", message_count: 2 });
    const updated = sessions.get("书A", meta.id)!;
    expect(updated.state).toBe("writing");
    expect(updated.message_count).toBe(2);
  });

  it("重命名 / 删除", () => {
    const meta = sessions.create("书A", { title: "旧名" });
    const renamed = sessions.rename("书A", meta.id, "新名");
    expect(renamed?.title).toBe("新名");
    expect(sessions.remove("书A", meta.id)).toBe(true);
    expect(sessions.list("书A")).toHaveLength(0);
    expect(sessions.remove("书A", meta.id)).toBe(false);
  });

  it("旧 agent_chat.jsonl 自动迁移为默认会话", () => {
    const legacy = store.resolve("书A", "memory/agent_chat.jsonl");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify({ role: "user", content: "旧消息" }) + "\n" + JSON.stringify({ role: "assistant", content: "旧回复" }) + "\n", "utf-8");
    const list = sessions.list("书A");
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("default");
    expect(list[0]!.title).toBe("默认对话");
    expect(list[0]!.message_count).toBe(2);
    expect(sessions.loadMessages("书A", "default")).toHaveLength(2);
  });

  it("多会话互不影响", () => {
    const a = sessions.create("书A", { title: "会话A" });
    const b = sessions.create("书A", { title: "会话B" });
    sessions.saveMessages("书A", a.id, [{ role: "user", content: "A 的消息" }]);
    expect(sessions.loadMessages("书A", a.id)).toHaveLength(1);
    expect(sessions.loadMessages("书A", b.id)).toHaveLength(0);
    expect(sessions.list("书A")).toHaveLength(2);
  });
});
