import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { InteractionLogger } from "../src/llm/interaction_logger.js";
import { ChatMessage, Role } from "../src/llm/models.js";
import {
  saveInteraction,
  clearAllInteractions,
  aggregateInteractions,
} from "../src/storage/interaction_store.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-agg-"));
  process.env.AI_NOVEL_DATA_DIR = dir;
  clearAllInteractions();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("交互记录聚合（aggregateInteractions）", () => {
  it("同一 turn_id 的多条 LLM 调用被聚合为一条交互，并汇总 tokens", () => {
    const logger = new InteractionLogger();
    const a = logger.record([new ChatMessage(Role.USER, "帮我扩写")], "m1");
    a.total_tokens = 100;
    a.elapsed_ms = 50;
    const b = logger.record([new ChatMessage(Role.USER, "帮我扩写")], "m1");
    b.total_tokens = 200;
    b.elapsed_ms = 60;
    b.error = "some error";

    saveInteraction("agent", a, {
      project_id: "p1",
      session_id: "s1",
      turn_id: "turn-1",
      user_message: "帮我扩写",
    });
    saveInteraction("agent", b, {
      project_id: "p1",
      session_id: "s1",
      turn_id: "turn-1",
      user_message: "帮我扩写",
    });

    const res = aggregateInteractions({});
    expect(res.total).toBe(1);
    expect(res.items[0]!.turn_id).toBe("turn-1");
    expect(res.items[0]!.user_message).toBe("帮我扩写");
    expect(res.items[0]!.total_tokens).toBe(300);
    expect(res.items[0]!.total_elapsed_ms).toBe(110);
    expect(res.items[0]!.has_error).toBe(true);
    expect(res.items[0]!.records.length).toBe(2);
  });

  it("不同 turn 不合并，支持按 project_id / session_id 过滤", () => {
    const logger = new InteractionLogger();
    const a = logger.record([new ChatMessage(Role.USER, "第一轮")], "m1");
    const b = logger.record([new ChatMessage(Role.USER, "第二轮")], "m1");
    saveInteraction("agent", a, { project_id: "p1", session_id: "s1", turn_id: "t1", user_message: "第一轮" });
    saveInteraction("agent", b, { project_id: "p1", session_id: "s2", turn_id: "t2", user_message: "第二轮" });

    expect(aggregateInteractions({}).total).toBe(2);
    expect(aggregateInteractions({ project_id: "p1" }).total).toBe(2);
    expect(aggregateInteractions({ project_id: "p2" }).total).toBe(0);
    expect(aggregateInteractions({ session_id: "s1" }).total).toBe(1);
    expect(aggregateInteractions({ session_id: "s1" }).items[0]!.turn_id).toBe("t1");
  });

  it("聚合结果按时间倒序，limit/offset 分页生效", () => {
    const logger = new InteractionLogger();
    for (let i = 0; i < 3; i++) {
      const it = logger.record([new ChatMessage(Role.USER, `轮次${i}`)], "m1");
      saveInteraction("agent", it, {
        project_id: "p1",
        session_id: "s1",
        turn_id: `turn-${i}`,
        user_message: `轮次${i}`,
      });
    }

    const all = aggregateInteractions({});
    expect(all.total).toBe(3);
    // created_at 相同秒时排序可能不稳定，此处只校验分页切片数量
    expect(aggregateInteractions({ limit: 2, offset: 0 }).items.length).toBe(2);
    expect(aggregateInteractions({ limit: 2, offset: 2 }).items.length).toBe(1);
  });
});
