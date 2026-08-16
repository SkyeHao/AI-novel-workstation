import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { InteractionLogger } from "../src/llm/interaction_logger.js";
import { ChatMessage, Role } from "../src/llm/models.js";
import { saveInteraction, listInteractions, getInteraction, clearAllInteractions } from "../src/storage/interaction_store.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-int-"));
  process.env.AI_NOVEL_DATA_DIR = dir;
  clearAllInteractions();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Agent 交互记录（logger -> interaction_store）", () => {
  it("logger 记录可通过 saveInteraction 以 source=agent 落盘并查询", () => {
    const logger = new InteractionLogger();
    const it = logger.record([new ChatMessage(Role.USER, "你好")], "test-model", 0.7, 2000, null, null);
    it.response_content = "你好！";
    it.finish_reason = "stop";
    it.total_tokens = 12;

    saveInteraction("agent", it, { task_type: "text", session_id: "sess-1", user_message: "你好" });

    const list = listInteractions({});
    expect(list.total).toBe(1);
    expect(list.items[0]!.source).toBe("agent");
    expect(list.items[0]!.session_id).toBe("sess-1");
    expect(list.items[0]!.response_content).toBe("你好！");

    const byId = getInteraction(list.items[0]!.id);
    expect(byId?.model).toBe("test-model");

    const filtered = listInteractions({ source: "agent" });
    expect(filtered.total).toBe(1);
  });

  it("多会话按 session_id 区分，clear 可按 source 清理", () => {
    const logger = new InteractionLogger();
    const a = logger.record([new ChatMessage(Role.USER, "A")], "m1");
    const b = logger.record([new ChatMessage(Role.USER, "B")], "m1");
    saveInteraction("agent", a, { session_id: "s1", user_message: "A" });
    saveInteraction("agent", b, { session_id: "s2", user_message: "B" });
    saveInteraction("chat", b, { session_id: "x", user_message: "C" });

    expect(listInteractions({}).total).toBe(3);
    expect(listInteractions({ source: "agent" }).total).toBe(2);
    const cleared = clearAllInteractions("agent");
    expect(cleared).toBe(2);
    expect(listInteractions({}).total).toBe(1);
  });
});
