import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectStore } from "../src/storage/project_store.js";
import { DocumentRegistry } from "../src/storage/document_registry.js";
import { SettingsStore } from "../src/storage/settings_store.js";
import type { LLMClient } from "../src/llm/client.js";
import {
  applyChatSessionPlan,
  ChatApplyError,
  type ChatApplyOptions,
} from "../src/workflow/chat_apply.js";

let dir: string;
let store: ProjectStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-chatapply-"));
  store = new ProjectStore(dir);
  store.create("书A", "测试书", { status: "writing" });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
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
    this.calls.push({ content: (messages[0] as { content?: string } | undefined)?.content ?? "" });
    const content = this.replies.length > 0 ? this.replies.shift()! : "{}";
    return { content, model: "fake" };
  }
  close(): void {}
}

function baseOptions(overrides: Partial<ChatApplyOptions> = {}): ChatApplyOptions {
  return {
    projectId: "书A",
    sessionId: "sess-12345678-abc",
    topic: "第 10 章危机讨论",
    summary: "核心共识：引入外部威胁。综合方案：分两幕推进。",
    target: "document",
    llm: new FakeLLMClient() as unknown as LLMClient,
    projectStore: store,
    ...overrides,
  };
}

describe("applyChatSessionPlan（工单 08：最终方案应用）", () => {
  it("document：写入 memory/discussions/方案-*.md 并登记为 plan 文档", async () => {
    const opts = baseOptions({ target: "document" });
    const result = await applyChatSessionPlan(opts);
    expect(result.ok).toBe(true);
    expect(result.relPath).toMatch(/^memory\/discussions\/方案-.*\.md$/);
    const full = store.resolve("书A", result.relPath!);
    expect(fs.existsSync(full)).toBe(true);
    const content = fs.readFileSync(full, "utf-8");
    expect(content).toContain("第 10 章危机讨论");
    expect(content).toContain("核心共识：引入外部威胁");
    const docs = new DocumentRegistry(store).list("书A", "plan");
    expect(docs.some((d) => d.path === result.relPath)).toBe(true);
  });

  it("outline：LLM 合并后写入 settings/outline.json 且 root.type=total", async () => {
    const fake = new FakeLLMClient();
    fake.replies = [
      JSON.stringify({
        template_id: "three-act",
        root: {
          type: "total",
          summary_short: "新大纲",
          summary_long: "详细大纲",
          children: [{ type: "volume", title: "卷一" }],
        },
      }),
    ];
    const opts = baseOptions({ target: "outline", llm: fake as unknown as LLMClient });
    const result = await applyChatSessionPlan(opts);
    expect(result.ok).toBe(true);
    const full = store.resolve("书A", "settings/outline.json");
    expect(fs.existsSync(full)).toBe(true);
    const data = JSON.parse(fs.readFileSync(full, "utf-8")) as {
      root: { type: string; children: Array<{ title: string }> };
    };
    expect(data.root.type).toBe("total");
    expect(data.root.children[0]!.title).toBe("卷一");
    const readBack = new SettingsStore(store).get("书A", "outline") as {
      root: { type: string };
    };
    expect(readBack.root.type).toBe("total");
  });

  it("outline：容忍 \u0060\u0060\u0060json 围栏输出", async () => {
    const fake = new FakeLLMClient();
    fake.replies = [
      "\u0060\u0060\u0060json" +
        JSON.stringify({ root: { type: "total", summary_short: "x", summary_long: "y", children: [] } }) +
        "\u0060\u0060\u0060",
    ];
    const opts = baseOptions({ target: "outline", llm: fake as unknown as LLMClient });
    const result = await applyChatSessionPlan(opts);
    expect(result.ok).toBe(true);
  });

  it("characters：LLM 合并后写入 settings/characters.json", async () => {
    const fake = new FakeLLMClient();
    fake.replies = [
      JSON.stringify({
        template_id: "generic",
        characters: [
          { id: "c1", name: "主角", role: "protagonist", dimensions: { 外貌: "清秀" } },
        ],
      }),
    ];
    const opts = baseOptions({ target: "characters", llm: fake as unknown as LLMClient });
    const result = await applyChatSessionPlan(opts);
    expect(result.ok).toBe(true);
    const full = store.resolve("书A", "settings/characters.json");
    expect(fs.existsSync(full)).toBe(true);
    const data = JSON.parse(fs.readFileSync(full, "utf-8")) as {
      characters: Array<{ name: string }>;
    };
    expect(data.characters).toHaveLength(1);
    expect(data.characters[0]!.name).toBe("主角");
  });

  it("空 summary：抛 ChatApplyError", async () => {
    const opts = baseOptions({ summary: "" });
    await expect(applyChatSessionPlan(opts)).rejects.toThrow(ChatApplyError);
  });

  it("未知 target：抛 ChatApplyError", async () => {
    const opts = baseOptions({ target: "unknown" as ChatApplyOptions["target"] });
    await expect(applyChatSessionPlan(opts)).rejects.toThrow(ChatApplyError);
  });
});
