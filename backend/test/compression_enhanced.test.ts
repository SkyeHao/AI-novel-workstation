import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ContextCompressionEnhanced, type ModelContextMap } from "../src/agent/compression_enhanced.js";
import { ChatMessage, Role } from "../src/llm/models.js";
import type { LLMClient } from "../src/llm/client.js";
import type { MemoryStore } from "../src/storage/memory_store.js";

describe("ContextCompressionEnhanced（工单 04：上下文压缩增强）", () => {
  let tempDir: string;
  let fakeClient: LLMClient;
  let fakeMemory: MemoryStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "compression-test-"));
    
    // Fake LLM client
    fakeClient = {
      config: { model: "fake-model", apiKey: "fake", baseUrl: "fake", temperature: 0, maxTokens: 100, timeout: 10, maxRetries: 0 },
      count_tokens: (messages: ChatMessage[]) => messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0),
      count_text_tokens: (text: string) => text.length,
      achat: async () => new ChatMessage(Role.ASSISTANT, "压缩后的摘要"),
      close: () => {},
    } as unknown as LLMClient;

    // Fake MemoryStore
    fakeMemory = {
      saveSummary: () => {},
      loadSummary: () => null,
    } as unknown as MemoryStore;
  });

  it("不同模型的上下文窗口预算不同", () => {
    const modelMap: ModelContextMap = {
      "gpt-4": 128000,
      "gpt-3.5": 16384,
      "claude-3": 200000,
    };
    
    const compressor1 = new ContextCompressionEnhanced(fakeClient, {
      model: "gpt-4",
      modelContextMap: modelMap,
    });
    
    const compressor2 = new ContextCompressionEnhanced(fakeClient, {
      model: "gpt-3.5",
      modelContextMap: modelMap,
    });
    
    expect(compressor1.contextWindow).toBe(128000);
    expect(compressor2.contextWindow).toBe(16384);
    expect(compressor1.budget).toBeGreaterThan(compressor2.budget);
  });

  it("占用达到阈值自动压缩到目标水位", async () => {
    const compressor = new ContextCompressionEnhanced(fakeClient, {
      model: "fake-model",
      contextWindow: 1000,
      compressionRatio: 0.8,
      targetRatio: 0.6,
    });

    // 创建大量消息，占用超过 80%
    const messages: ChatMessage[] = [
      new ChatMessage(Role.SYSTEM, "系统提示"),
    ];
    for (let i = 0; i < 20; i++) {
      messages.push(new ChatMessage(Role.USER, "用户消息".repeat(50)));
      messages.push(new ChatMessage(Role.ASSISTANT, "助手回复".repeat(50)));
    }

    const result = await compressor.process(messages);
    
    // 压缩后占用应低于目标水位
    const usage = compressor.estimate(result);
    expect(usage).toBeLessThan(1000 * 0.6);
  });

  it("压缩后保留最近 N 条", async () => {
    const compressor = new ContextCompressionEnhanced(fakeClient, {
      model: "fake-model",
      contextWindow: 500,
      keepRecent: 4,
    });

   const messages: ChatMessage[] = [
     new ChatMessage(Role.SYSTEM, "系统提示"),
      new ChatMessage(Role.USER, "用户消息".repeat(30)),
      new ChatMessage(Role.ASSISTANT, "助手回复".repeat(30)),
      new ChatMessage(Role.USER, "用户消息".repeat(30)),
      new ChatMessage(Role.ASSISTANT, "助手回复".repeat(30)),
      new ChatMessage(Role.USER, "用户消息".repeat(30)),
      new ChatMessage(Role.ASSISTANT, "助手回复".repeat(30)),
   ];

   const result = await compressor.process(messages);
   
   // 保留系统提示 + 最近 4 条
   expect(result.length).toBeLessThanOrEqual(5);
   expect(result[0]?.role).toBe(Role.SYSTEM);
 });

 it("会话重开后仍能恢复续写", () => {
    const compressor = new ContextCompressionEnhanced(fakeClient, {
      model: "fake-model",
      contextWindow: 1000,
    });

    // 模拟摘要持久化
    const summary = "之前的对话摘要：作者确认了核心创意";
    const messages = compressor.resumeWithSummary(summary);
    
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe(Role.SYSTEM);
    expect(messages[0]?.content).toContain(summary);
  });

  it("Agent 可主动调用 compress_context 触发压缩", async () => {
    const compressor = new ContextCompressionEnhanced(fakeClient, {
      model: "fake-model",
      contextWindow: 1000,
    });

   const messages: ChatMessage[] = [
     new ChatMessage(Role.SYSTEM, "系统提示"),
     new ChatMessage(Role.USER, "消息".repeat(100)),
     new ChatMessage(Role.ASSISTANT, "回复".repeat(100)),
      new ChatMessage(Role.USER, "消息".repeat(100)),
   ];

   const result = await compressor.compressContext(messages, {
     reason: "即将执行大量读取",
     keepRecent: 2,
   });

   expect(result.compressed).toBe(true);
    expect(result.reason).toBe("即将执行大量读取");
    expect(result.audit).toBeDefined();
  });
});
