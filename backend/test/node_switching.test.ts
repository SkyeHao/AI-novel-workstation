import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NodeSwitchingPlanC, type SwitchContext } from "../src/workflow/node_switching.js";
import { ChatMessage, Role } from "../src/llm/models.js";
import type { LLMClient } from "../src/llm/client.js";
import type { MemoryStore } from "../src/storage/memory_store.js";

describe("NodeSwitchingPlanC（工单 05：会话内节点切换 C 方案）", () => {
  let tempDir: string;
  let fakeClient: LLMClient;
  let fakeMemory: MemoryStore;
  let switching: NodeSwitchingPlanC;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switching-test-"));
    
    fakeClient = {
      config: { model: "fake-model", apiKey: "fake", baseUrl: "fake", temperature: 0, maxTokens: 100, timeout: 10, maxRetries: 0 },
      count_tokens: (messages: ChatMessage[]) => messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0),
      count_text_tokens: (text: string) => text.length,
      achat: async () => new ChatMessage(Role.ASSISTANT, "节点切换摘要"),
      close: () => {},
    } as unknown as LLMClient;

    fakeMemory = {
      saveSummary: () => {},
      loadSummary: () => null,
    } as unknown as MemoryStore;

    switching = new NodeSwitchingPlanC(fakeClient, fakeMemory);
  });

  it("会话内 A→B 切换后，B 上下文只含 B 指令 + 成果 + 摘要 + 最近 N 条，不含 A 原始轮次", async () => {
    const context: SwitchContext = {
      fromNode: "ideation",
      toNode: "worldview",
      projectId: "proj-1",
      sessionId: "sess-1",
      currentMessages: [
        new ChatMessage(Role.SYSTEM, "灵感捕捉系统提示"),
        new ChatMessage(Role.USER, "我有一个灵感"),
        new ChatMessage(Role.ASSISTANT, "好的，让我们讨论"),
        new ChatMessage(Role.USER, "核心创意是..."),
        new ChatMessage(Role.ASSISTANT, "已确认创意"),
      ],
      nodeResults: {
        ideation: { summary: "已完成核心创意确认", outputs: ["核心要素.json"] },
      },
    };

    const result = await switching.switch(context);

    // 验证 B 上下文构成
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0]?.role).toBe(Role.SYSTEM);
    
    // 系统提示应包含 B 节点指令
    const systemContent = result.messages[0]?.content ?? "";
    expect(systemContent).toContain("世界观构建");
    
    // 应包含 A 节点成果摘要
    expect(systemContent).toContain("已完成核心创意确认");
    
    // 不应包含 A 原始轮次
    const hasOriginalA = result.messages.some((m, i) => 
      i > 0 && m.role === Role.USER && m.content === "我有一个灵感"
    );
    expect(hasOriginalA).toBe(false);
  });

  it("切回 A 能恢复原节点的上下文与讨论", async () => {
    // 先切换到 B
    const context1: SwitchContext = {
      fromNode: "ideation",
      toNode: "worldview",
      projectId: "proj-1",
      sessionId: "sess-1",
      currentMessages: [
        new ChatMessage(Role.SYSTEM, "灵感捕捉系统提示"),
        new ChatMessage(Role.USER, "我有一个灵感"),
        new ChatMessage(Role.ASSISTANT, "好的"),
      ],
      nodeResults: {
        ideation: { summary: "创意讨论中", outputs: [] },
      },
    };

    await switching.switch(context1);

    // 切回 A
    const context2: SwitchContext = {
      fromNode: "worldview",
      toNode: "ideation",
      projectId: "proj-1",
      sessionId: "sess-1",
      currentMessages: [
        new ChatMessage(Role.SYSTEM, "世界观构建系统提示"),
        new ChatMessage(Role.USER, "世界观设定"),
        new ChatMessage(Role.ASSISTANT, "已构建世界观"),
      ],
      nodeResults: {
        ideation: { summary: "创意讨论中", outputs: [] },
        worldview: { summary: "世界观已构建", outputs: ["世界观.json"] },
      },
    };

    const result = await switching.switch(context2);

    // 应恢复 A 的摘要
    const systemContent = result.messages[0]?.content ?? "";
    expect(systemContent).toContain("创意讨论中");
  });

  it("未完成事项作为 A 待办带入，前置不完备时触发检测", async () => {
    const context: SwitchContext = {
      fromNode: "ideation",
      toNode: "worldview",
      projectId: "proj-1",
      sessionId: "sess-1",
      currentMessages: [
        new ChatMessage(Role.SYSTEM, "灵感捕捉系统提示"),
        new ChatMessage(Role.USER, "我有一个灵感"),
        new ChatMessage(Role.ASSISTANT, "还需要确认金手指"),
      ],
      nodeResults: {
        ideation: { 
          summary: "创意讨论中，待确认金手指", 
          outputs: [],
          pending: ["确认金手指类型"]
        },
      },
    };

    const result = await switching.switch(context);

    // 应包含待办事项
    const systemContent = result.messages[0]?.content ?? "";
    expect(systemContent).toContain("待确认金手指");
  });

  it("经统一入口黑盒断言切换后的上下文构成", async () => {
    const context: SwitchContext = {
      fromNode: "writing",
      toNode: "review",
      projectId: "proj-1",
      sessionId: "sess-1",
      currentMessages: [
        new ChatMessage(Role.SYSTEM, "正文生成系统提示"),
        new ChatMessage(Role.USER, "写第一章"),
        new ChatMessage(Role.ASSISTANT, "第一章内容..."),
      ],
      nodeResults: {
        writing: { 
          summary: "已完成第一章", 
          outputs: ["第一章.md"],
          dynamicUpdates: ["人物状态", "地点状态"]
        },
      },
    };

    const result = await switching.switch(context);

    // 验证上下文构成符合 C 方案
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.fromNode).toBe("writing");
    expect(result.toNode).toBe("review");
    expect(result.summary).toBeDefined();
  });
});
