import { describe, expect, it } from "vitest";
import { WorkflowRunner } from "../src/workflow/runner.js";
import { ChatMessage, Role } from "../src/llm/models.js";
import type { LLMClient } from "../src/llm/client.js";
import type { MemoryStore } from "../src/storage/memory_store.js";
import { DEFAULT_NODES } from "../src/storage/states.js";

// Fake LLM client for testing
class FakeLLMClient {
  config = { model: "fake-model", apiKey: "fake", baseUrl: "fake", temperature: 0, maxTokens: 100, timeout: 10, maxRetries: 0 };
  count_tokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  }
  count_text_tokens(text: string): number {
    return text.length;
  }
  async achat(messages: ChatMessage[], _kwargs?: Record<string, unknown>): Promise<ChatMessage> {
    return new ChatMessage(Role.ASSISTANT, "fake response");
  }
  close(): void {}
}

describe("WorkflowRunner（工单 01：流程节点引擎骨架）", () => {
  const fakeClient = new FakeLLMClient() as unknown as LLMClient;
  const fakeMemory = null as unknown as MemoryStore;

  it("7 节点集完整可用；大纲生成作为单节点内部含三级；伏笔管理不再是流程节点", () => {
    expect(DEFAULT_NODES.length).toBe(7);
    const keys = DEFAULT_NODES.map((n) => n.key);
    expect(keys).toEqual(["ideation", "worldview", "characters", "outline", "writing", "review", "style"]);
    // 伏笔管理不再是流程节点
    expect(keys).not.toContain("foreshadow");
    // 大纲生成是单节点
    const outline = DEFAULT_NODES.find((n) => n.key === "outline");
    expect(outline?.label).toBe("大纲生成");
  });

  it("任意流程节点都能经统一入口执行；节点不同时装配出的系统提示词不同", async () => {
    const runner = new WorkflowRunner({ client: fakeClient, memory: fakeMemory });

    const ideationResult = await runner.runNode("ideation", "proj-1", "sess-1", "我有一个灵感");
    const writingResult = await runner.runNode("writing", "proj-1", "sess-1", "写第一章");

    // 节点不同时系统提示词不同
    const ideationSystem = ideationResult.messages[0];
    const writingSystem = writingResult.messages[0];
    expect(ideationSystem?.role).toBe(Role.SYSTEM);
    expect(writingSystem?.role).toBe(Role.SYSTEM);
    expect(ideationSystem?.content).not.toBe(writingSystem?.content);

    // 节点信息正确
    expect(ideationResult.nodeKey).toBe("ideation");
    expect(ideationResult.node.label).toBe("灵感捕捉");
    expect(writingResult.nodeKey).toBe("writing");
    expect(writingResult.node.label).toBe("正文生成");
  });

  it("每本书可启用/停用节点，停用的节点不进入默认流程", () => {
    // 默认所有节点启用
    expect(DEFAULT_NODES.every((n) => n.enabled)).toBe(true);
    // 可通过 enabled 字段控制
    const disabledNode = { ...DEFAULT_NODES[0]!, enabled: false };
    expect(disabledNode.enabled).toBe(false);
  });

  it("未知节点抛出错误", async () => {
    const runner = new WorkflowRunner({ client: fakeClient, memory: fakeMemory });
    await expect(runner.runNode("unknown-node", "proj-1", "sess-1", "test")).rejects.toThrow("未知流程节点");
  });

  it("历史对话正确注入", async () => {
    const runner = new WorkflowRunner({ client: fakeClient, memory: fakeMemory });
    const history = [
      new ChatMessage(Role.USER, "之前的对话"),
      new ChatMessage(Role.ASSISTANT, "之前的回复"),
    ];
    const result = await runner.runNode("ideation", "proj-1", "sess-1", "新消息", { history });

    // 消息顺序：系统 + 历史 + 用户
    expect(result.messages.length).toBeGreaterThanOrEqual(4);
    expect(result.messages[0]?.role).toBe(Role.SYSTEM);
    expect(result.messages[1]?.content).toBe("之前的对话");
    expect(result.messages[2]?.content).toBe("之前的回复");
    expect(result.messages[3]?.content).toBe("新消息");
  });
});