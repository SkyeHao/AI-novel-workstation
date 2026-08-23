import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectStore } from "../src/storage/project_store.js";
import { FileChatStore } from "../src/storage/chat_store.js";
import type { ChatConsensusNode } from "../src/storage/chat_store.js";
import {
  ChatSession,
  type ChatSessionSnapshot,
  type ChatMember,
  type ChatMessageRecord,
} from "../src/workflow/chat_session.js";
import type { LLMClient } from "../src/llm/client.js";

let dir: string;
let store: ProjectStore;
let chatStore: FileChatStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-chatstore-"));
  store = new ProjectStore(dir);
  store.create("书A", "测试书", { status: "writing" });
  chatStore = new FileChatStore(store);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeSnapshot(overrides: Partial<ChatSessionSnapshot> = {}): ChatSessionSnapshot {
  return {
    id: "sess-1",
    projectId: "书A",
    topic: "第 10 章危机讨论",
    members: [
      { id: "r1", kind: "agent", name: "冲突制造者", description: "冲突", category: "proposer", systemPrompt: "你" },
    ],
    messages: [
      {
        id: "m1",
        sessionId: "sess-1",
        memberId: "r1",
        memberName: "冲突制造者",
        kind: "agent",
        category: "proposer",
        content: "应当引入外部威胁",
        timestamp: "2026-08-24T00:00:00.000Z",
      },
    ],
    status: "completed",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    summary: undefined,
    consensusNodes: [],
    ...overrides,
  };
}

describe("FileChatStore（工单 07 持久化层）", () => {
  it("save→load 往返一致：消息 / 状态 / 共识 / 最终方案均可恢复", () => {
    const snapshot = makeSnapshot({
      summary: "核心共识：引入外部威胁。",
      consensusNodes: [
        { level: 1, message: "已达成共识，开始合成最终方案", timestamp: "2026-08-24T00:00:00.000Z" },
      ],
    });
    chatStore.save(snapshot);
    const loaded = chatStore.load("书A", "sess-1")!;
    expect(loaded).not.toBeNull();
    expect(loaded.id).toBe("sess-1");
    expect(loaded.projectId).toBe("书A");
    expect(loaded.topic).toBe("第 10 章危机讨论");
    expect(loaded.status).toBe("completed");
    expect(loaded.messages).toEqual(snapshot.messages);
    expect(loaded.summary).toBe("核心共识：引入外部威胁。");
    expect(loaded.consensusNodes).toHaveLength(1);
    expect(loaded.consensusNodes[0]!.message).toContain("已达成共识");
  });

  it("过程记录与共识 / 最终方案分离落库（两个文件）", () => {
    chatStore.save(makeSnapshot());
    const recordFile = store.resolve("书A", "memory/discussions/sess-1.json");
    const consensusFile = store.resolve("书A", "memory/discussions/sess-1.consensus.json");
    expect(fs.existsSync(recordFile)).toBe(true);
    // 无共识时不上成果文件
    expect(fs.existsSync(consensusFile)).toBe(false);

    const node: ChatConsensusNode = {
      level: 1,
      message: "已达成共识，开始合成最终方案",
      timestamp: "2026-08-24T00:00:00.000Z",
    };
    chatStore.appendConsensus("书A", "sess-1", node);
    chatStore.setSummary("书A", "sess-1", "最终方案内容");
    expect(fs.existsSync(consensusFile)).toBe(true);

    const loaded = chatStore.load("书A", "sess-1")!;
    expect(loaded.consensusNodes).toHaveLength(1);
    expect(loaded.summary).toBe("最终方案内容");
    // 过程记录文件不含成果字段
    const raw = JSON.parse(fs.readFileSync(recordFile, "utf-8")) as Record<string, unknown>;
    expect(raw.summary).toBeUndefined();
    expect(raw.consensusNodes).toBeUndefined();
  });

  it("appendMessage 增量追加，重复 save 不重复共识节点", () => {
    chatStore.save(makeSnapshot());
    const msg: ChatMessageRecord = {
      id: "m2",
      sessionId: "sess-1",
      memberId: "r1",
      memberName: "冲突制造者",
      kind: "agent",
      category: "proposer",
      content: "第二段发言",
      timestamp: "2026-08-24T00:00:00.001Z",
    };
    chatStore.appendMessage("书A", "sess-1", msg);
    let loaded = chatStore.load("书A", "sess-1")!;
    expect(loaded.messages).toHaveLength(2);

    // 再次 save（含同一共识节点）不产生重复
    const node: ChatConsensusNode = {
      level: 1,
      message: "已达成共识，开始合成最终方案",
      timestamp: "2026-08-24T00:00:00.000Z",
    };
    chatStore.appendConsensus("书A", "sess-1", node);
    chatStore.save(makeSnapshot({ consensusNodes: [node] }));
    loaded = chatStore.load("书A", "sess-1")!;
    expect(loaded.consensusNodes).toHaveLength(1);
    expect(loaded.messages).toHaveLength(2);
  });

  it("list 按 updatedAt 倒序，跨会话互不干扰", () => {
    chatStore.save(makeSnapshot({ id: "sess-a", updatedAt: "2026-08-24T00:00:00.000Z" }));
    chatStore.save(makeSnapshot({ id: "sess-b", updatedAt: "2026-08-24T00:00:01.000Z" }));
    const list = chatStore.list("书A");
    expect(list.map((s) => s.id)).toEqual(["sess-b", "sess-a"]);
    // 其他书为空
    expect(chatStore.list("书B")).toEqual([]);
  });

  it("损坏文件返回 null / []，不抛异常", () => {
    const recordFile = store.resolve("书A", "memory/discussions/broken.json");
    fs.mkdirSync(path.dirname(recordFile), { recursive: true });
    fs.writeFileSync(recordFile, "{ not valid json", "utf-8");
    expect(chatStore.load("书A", "broken")).toBeNull();
    expect(chatStore.list("书A")).toEqual([]);
  });
});

class FakeLLMClient {
  config = { model: "fake", apiKey: "fake", baseUrl: "fake", temperature: 0, maxTokens: 100, timeout: 10, maxRetries: 0 };
  calls: Array<{ content: string }> = [];
  replies: string[] = [];
  count_tokens(): number {
    return 0;
  }
  count_text_tokens(text: string): number {
    return text.length;
  }
  async achat(messages: Array<{ role: string; content?: string; name?: string | null }>): Promise<{ content: string; model: string }> {
    const name = (messages[0] as { name?: string | null } | undefined)?.name ?? "角色";
    this.calls.push({ content: name });
    const content = this.replies.length > 0 ? this.replies.shift()! : "这是「" + name + "」的发言";
    return { content, model: "fake" };
  }
  close(): void {}
}

function makeMembersWithSynthesizer(): ChatMember[] {
  return [
    { id: "r1", kind: "agent", name: "冲突制造者", description: "冲突", category: "proposer", systemPrompt: "你是冲突制造者" },
    { id: "r2", kind: "agent", name: "情感锚点", description: "情感", category: "proposer", systemPrompt: "你是情感锚点" },
    { id: "r3", kind: "agent", name: "合成者", description: "整理成果", category: "synthesizer", systemPrompt: "你是合成者" },
  ];
}

describe("ChatSession + FileChatStore（工单 07 黑盒：讨论记录落盘可恢复）", () => {
  it("共识达成并合成后：load 出完整消息、状态 completed、共识节点与最终方案", async () => {
    const AGREE_1 = "我同意这个方案。\n【共识度：0.9】";
    const AGREE_2 = "我也一致认可。\n【共识度：0.95】";
    const SUMMARY = "核心共识：引入外部威胁。\n综合方案：分两幕推进。";
    const fake = new FakeLLMClient();
    fake.replies = [AGREE_1, AGREE_2, SUMMARY];
    const session = new ChatSession({
      projectId: "书A",
      topic: "第 10 章危机",
      members: makeMembersWithSynthesizer(),
      llm: fake as unknown as LLMClient,
      chatStore,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 4,
    });

    await session.start();
    expect(session.getStatus()).toBe("completed");

    // 两个落库文件都真实存在
    const recordFile = store.resolve("书A", "memory/discussions/" + session.id + ".json");
    const consensusFile = store.resolve("书A", "memory/discussions/" + session.id + ".consensus.json");
    expect(fs.existsSync(recordFile)).toBe(true);
    expect(fs.existsSync(consensusFile)).toBe(true);

    // 从磁盘加载：消息完整、终态、成果齐全
    const loaded = chatStore.load("书A", session.id)!;
    expect(loaded.status).toBe("completed");
    expect(loaded.messages.filter((m) => m.kind === "agent")).toHaveLength(2);
    expect(loaded.consensusNodes.length).toBeGreaterThan(0);
    expect(loaded.summary).toBe(SUMMARY);
  });

  it("作者手动终止：状态 terminated 落盘，无最终方案", async () => {
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "书A",
      topic: "t",
      members: makeMembersWithSynthesizer(),
      llm: fake as unknown as LLMClient,
      chatStore,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 4,
    });
    session.start();
    session.stop();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const loaded = chatStore.load("书A", session.id)!;
    expect(loaded.status).toBe("terminated");
    expect(loaded.summary).toBeUndefined();
    expect(loaded.consensusNodes).toEqual([]);
  });
});
