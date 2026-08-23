import { describe, expect, it, vi } from "vitest";
import { ChatSession } from "../src/workflow/chat_session.js";
import type { ChatSessionEvent, ChatMember, ChatMessageRecord } from "../src/workflow/chat_session.js";
import type { LLMClient } from "../src/llm/client.js";

class FakeLLMClient {
  config = { model: "fake", apiKey: "fake", baseUrl: "fake", temperature: 0, maxTokens: 100, timeout: 10, maxRetries: 0 };
  calls: Array<{ content: string }> = [];
  failWith: Error | null = null;
  private gate: Promise<void> | null = null;
  private resolveGate: (() => void) | null = null;

  /** 让下一次 achat 挂起，直到 release() */
  hold(): void {
    if (this.gate) return;
    this.gate = new Promise<void>((r) => {
      this.resolveGate = r;
    });
  }

  release(): void {
    this.resolveGate?.();
    this.resolveGate = null;
    this.gate = null;
  }

  count_tokens(): number {
    return 0;
  }

  count_text_tokens(text: string): number {
    return text.length;
  }

  async achat(messages: Array<{ role: string; content?: string; name?: string | null }>): Promise<{ content: string; model: string }> {
    const name = (messages[0] as { name?: string | null } | undefined)?.name ?? "角色";
    this.calls.push({ content: name });
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    return { content: `这是「${name}」的发言`, model: "fake" };
  }

  close(): void {}
}

function makeMembers(): ChatMember[] {
  return [
    { id: "r1", kind: "agent", name: "冲突制造者", description: "专注于戏剧冲突", category: "proposer", systemPrompt: "你是冲突制造者" },
    { id: "r2", kind: "agent", name: "情感锚点", description: "确保人物动机可信", category: "proposer", systemPrompt: "你是情感锚点" },
  ];
}

describe("ChatSession（工单 01：群聊骨架）", () => {
  it("状态流转 idle→running→completed；事件按序 system → chat_message → done", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-1",
      topic: "第 10 章应该发生什么危机",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      onEvent: (e) => events.push(e),
    });

    expect(session.getStatus()).toBe("idle");
    await session.start();
    expect(session.getStatus()).toBe("completed");

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("system");
    expect(types[types.length - 1]).toBe("done");
    expect(types).toContain("chat_message");

    // 两位 Agent 各发言一次
    const chatMsgs = events.filter((e) => e.type === "chat_message") as Array<{ type: "chat_message"; data: ChatMessageRecord }>;
    expect(chatMsgs.length).toBe(2);
    expect(chatMsgs[0]!.data.kind).toBe("agent");
    expect(chatMsgs[0]!.data.memberName).toBe("冲突制造者");

    // 内部消息记录一致
    expect(session.getMessages().length).toBe(2);
  });

  it("重复 start 抛出错误", async () => {
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-1",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
    });
    await session.start();
    expect(() => session.start()).toThrow(/已结束|运行/);
  });

  it("运行中 stop 进入 terminated，不产出 done", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.hold();
    const session = new ChatSession({
      projectId: "proj-1",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      onEvent: (e) => events.push(e),
    });

    const p = session.start();
    await vi.waitFor(() => expect(fake.calls.length).toBe(1));
    session.stop();
    fake.release();
    await p;

    expect(session.getStatus()).toBe("terminated");
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(events.some((e) => e.type === "system" && /终止/.test(e.data.message))).toBe(true);
  });

  it("LLM 异常时发出 error 事件且会话进入 terminated", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.failWith = new Error("LLM 连接失败");
    const session = new ChatSession({
      projectId: "proj-1",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    expect(session.getStatus()).toBe("terminated");
    const err = events.find((e) => e.type === "error");
    expect(err).toBeTruthy();
    expect((err!.data as { error: string }).error).toContain("LLM 连接失败");
  });

  it("作者消息实时插入并上屏（不影响当前 Agent 生成）", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.hold();
    const session = new ChatSession({
      projectId: "proj-1",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      onEvent: (e) => events.push(e),
    });

    const p = session.start();
    await vi.waitFor(() => expect(fake.calls.length).toBe(1));
    const msg = await session.sendUserMessage("作者说：请注意设定一致性");
    fake.release();
    await p;

    expect(msg.kind).toBe("author");
    expect(session.getMessages().some((m) => m.memberId === "author")).toBe(true);
    const authorMsg = events.find((e) => e.type === "chat_message" && e.data.kind === "author");
    expect(authorMsg).toBeTruthy();
    // 已完成的 Agent 生成不受影响
    expect(session.getMessages().filter((m) => m.kind === "agent").length).toBe(2);
  });
});
