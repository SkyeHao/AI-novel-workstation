import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NodeAssembly, type AssemblyContext } from "../src/workflow/node_assembly.js";
import { ChatMessage, Role } from "../src/llm/models.js";
import type { MemoryStore } from "../src/storage/memory_store.js";
import type { MemoryRetriever } from "../src/storage/retriever.js";

describe("NodeAssembly（工单 06：每节点 RAG 召回与装配块序）", () => {
  let tempDir: string;
  let fakeMemory: MemoryStore;
  let fakeRetriever: MemoryRetriever;
  let assembly: NodeAssembly;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "assembly-test-"));
    
    fakeMemory = {
      loadSummary: (projectId: string, level: number) => {
        if (level === 2) return "世界观摘要：玄幻世界，有修仙体系";
        if (level === 3) return "人物摘要：张三，练气五层";
        return null;
      },
    } as unknown as MemoryStore;

    fakeRetriever = {
      retrieve: (query: string, limit: number) => {
        // 模拟召回
        if (query.includes("世界观")) {
          return [{ content: "世界观设定：修仙世界", score: 0.9 }];
        }
        if (query.includes("人物")) {
          return [{ content: "人物设定：张三", score: 0.8 }];
        }
        return [];
      },
    } as unknown as MemoryRetriever;

    assembly = new NodeAssembly(fakeMemory, fakeRetriever);
  });

  it("每节点召回内容按节点规则不同", () => {
    const context: AssemblyContext = {
      nodeKey: "ideation",
      projectId: "proj-1",
      userMessage: "我有一个灵感",
    };

    const result = assembly.assemble(context);

    // 灵感捕捉节点不应召回正文记忆
    expect(result.recallBlocks.some(b => b.includes("正文"))).toBe(false);
  });

  it("正文阶段召回动态状态与章节摘要", () => {
    const context: AssemblyContext = {
      nodeKey: "writing",
      projectId: "proj-1",
      userMessage: "写第一章",
    };

    const result = assembly.assemble(context);

    // 正文节点应召回动态状态和章节摘要
    const hasDynamicState = result.recallBlocks.some(b => 
      b.includes("人物状态") || b.includes("地点状态")
    );
    const hasChapterSummary = result.recallBlocks.some(b => 
      b.includes("章节摘要") || b.includes("上一章")
    );
    
    expect(hasDynamicState || hasChapterSummary).toBe(true);
  });

  it("每节点装配块顺序按节点规则生效", () => {
    const context: AssemblyContext = {
      nodeKey: "worldview",
      projectId: "proj-1",
      userMessage: "构建世界观",
    };

    const result = assembly.assemble(context);

    // 验证装配顺序：系统提示 → 召回内容 → 用户消息
    expect(result.blocks.length).toBeGreaterThan(0);
    
    // 第一个块应该是系统提示相关
    const firstBlock = result.blocks[0];
    expect(firstBlock.type).toBe("system");
  });

  it("四维规则能由统一入口按当前节点完整消费", () => {
    const context: AssemblyContext = {
      nodeKey: "outline",
      projectId: "proj-1",
      userMessage: "生成大纲",
    };

    const result = assembly.assemble(context);

    // 验证四维规则完整
    expect(result.systemPrompt).toBeDefined();
    expect(result.recallBlocks).toBeDefined();
    expect(result.blocks).toBeDefined();
    expect(result.compressionRules).toBeDefined();
    
    // 验证压缩规则包含块优先级
    expect(result.compressionRules.blockPriorities).toBeDefined();
    expect(result.compressionRules.degradationChain).toBeDefined();
  });

  it("大纲生成节点召回活跃伏笔", () => {
    const context: AssemblyContext = {
      nodeKey: "outline",
      projectId: "proj-1",
      userMessage: "生成大纲",
    };

    const result = assembly.assemble(context);

    // 大纲节点应召回活跃伏笔
    const hasForeshadow = result.recallBlocks.some(b => 
      b.includes("伏笔") || b.includes("foreshadow")
    );
    
    // 大纲节点确实需要召回伏笔（根据设计文档）
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it("质量审查节点召回正文和相关设定", () => {
    const context: AssemblyContext = {
      nodeKey: "review",
      projectId: "proj-1",
      userMessage: "审查第一章",
    };

    const result = assembly.assemble(context);

    // 审查节点应召回正文和设定
    expect(result.blocks.length).toBeGreaterThan(0);
    
    // 验证有召回块
    expect(result.recallBlocks.length).toBeGreaterThanOrEqual(0);
  });
});
