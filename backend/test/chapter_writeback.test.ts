import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ChapterEndWriteback, type WritebackData } from "../src/workflow/chapter_writeback.js";
import { DynamicSettingsStore } from "../src/storage/dynamic_settings.js";
import { ProjectStore } from "../src/storage/project_store.js";

describe("ChapterEndWriteback（工单 03：正文章末回写与章尾钩子）", () => {
  let tempDir: string;
  let projectStore: ProjectStore;
  let dynamicStore: DynamicSettingsStore;
  let writeback: ChapterEndWriteback;
  const projectId = "test-project-03";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "writeback-test-"));
    projectStore = new ProjectStore(tempDir);
    projectStore.create("测试项目", "", { genre: "玄幻", platform: "起点" });
    dynamicStore = new DynamicSettingsStore(projectStore);
    writeback = new ChapterEndWriteback(dynamicStore);
  });

  it("正文输出后 8 类账本按正文自动更新", () => {
    const writebackData: WritebackData = {
      chapter: 1,
      content: "张三突破到练气五层，击败了李四。",
      characterUpdates: [
        { id: "char-1", name: "张三", level: 5, health: 100 },
        { id: "char-2", name: "李四", health: 50 },
      ],
      locationUpdates: [
        { id: "loc-1", name: "青云门", status: "正常" },
      ],
      itemUpdates: [
        { id: "item-1", name: "玄铁剑", owner: "张三" },
      ],
      events: [
        { chapter: 1, description: "张三突破到练气五层" },
        { chapter: 1, description: "张三击败李四" },
      ],
      timeline: [
        { time: "第一天", event: "张三突破" },
      ],
      foreshadowUpdates: [
        { planted_chapter: 1, expected_chapter: 10, status: "悬置", description: "神秘老人出现" },
      ],
      infoPerspective: {
        truth: [{ fact: "张三已突破到练气五层" }],
        display: [{ fact: "张三还是练气三层" }],
      },
      chapterSummary: "张三在青云门突破到练气五层，击败了前来挑衅的李四。",
    };

    writeback.execute(projectId, writebackData);

    // 验证各账本已更新
    const chars = dynamicStore.load(projectId, "characters");
    expect(chars?.entries).toHaveLength(2);
    expect(chars?.entries[0].level).toBe(5);

    const locs = dynamicStore.load(projectId, "locations");
    expect(locs?.entries).toHaveLength(1);

    const items = dynamicStore.load(projectId, "items");
    expect(items?.entries).toHaveLength(1);

    const events = dynamicStore.load(projectId, "events");
    expect(events?.entries).toHaveLength(2);

    const timeline = dynamicStore.load(projectId, "timeline");
    expect(timeline?.entries).toHaveLength(1);

    const foreshadow = dynamicStore.load(projectId, "foreshadow");
    expect(foreshadow?.entries).toHaveLength(1);

    const info = dynamicStore.load(projectId, "info_perspective");
    expect(info?.truth).toHaveLength(1);
    expect(info?.display).toHaveLength(1);

    const summaries = dynamicStore.load(projectId, "chapter_summaries");
    expect(summaries?.entries).toHaveLength(1);
    expect(summaries?.entries[0].summary).toContain("突破");
  });

  it("每章记录含章尾钩子", () => {
    const writebackData: WritebackData = {
      chapter: 1,
      content: "张三突破后，突然感觉到一股神秘的气息...",
      hook: {
        type: "悬念",
        content: "神秘气息的来源是什么？",
      },
      characterUpdates: [],
      locationUpdates: [],
      itemUpdates: [],
      events: [],
      timeline: [],
      foreshadowUpdates: [],
      infoPerspective: { truth: [], display: [] },
      chapterSummary: "张三突破后感受到神秘气息。",
    };

    writeback.execute(projectId, writebackData);

    const summaries = dynamicStore.load(projectId, "chapter_summaries");
    expect(summaries?.entries[0].hook).toBeDefined();
    expect(summaries?.entries[0].hook.type).toBe("悬念");
    expect(summaries?.entries[0].hook.content).toContain("神秘气息");
  });

  it("卷末/终章可豁免钩子生成", () => {
    const writebackData: WritebackData = {
      chapter: 100,
      content: "故事圆满结束。",
      hook: null, // 终章无钩子
      characterUpdates: [],
      locationUpdates: [],
      itemUpdates: [],
      events: [],
      timeline: [],
      foreshadowUpdates: [],
      infoPerspective: { truth: [], display: [] },
      chapterSummary: "故事圆满结束。",
    };

    writeback.execute(projectId, writebackData);

    const summaries = dynamicStore.load(projectId, "chapter_summaries");
    expect(summaries?.entries[0].hook).toBeNull();
  });

  it("手动修改正文后重跑回写，账本与正文保持一致", () => {
    // 第一次回写
    const firstWriteback: WritebackData = {
      chapter: 1,
      content: "张三突破到练气五层。",
      characterUpdates: [{ id: "char-1", name: "张三", level: 5 }],
      locationUpdates: [],
      itemUpdates: [],
      events: [],
      timeline: [],
      foreshadowUpdates: [],
      infoPerspective: { truth: [], display: [] },
      chapterSummary: "张三突破。",
    };
    writeback.execute(projectId, firstWriteback);

    let chars = dynamicStore.load(projectId, "characters");
    expect(chars?.entries[0].level).toBe(5);

    // 手动修改正文后重跑回写
    const secondWriteback: WritebackData = {
      chapter: 1,
      content: "张三突破到练气六层。",
      characterUpdates: [{ id: "char-1", name: "张三", level: 6 }],
      locationUpdates: [],
      itemUpdates: [],
      events: [],
      timeline: [],
      foreshadowUpdates: [],
      infoPerspective: { truth: [], display: [] },
      chapterSummary: "张三突破到练气六层。",
    };
    writeback.execute(projectId, secondWriteback);

    chars = dynamicStore.load(projectId, "characters");
    expect(chars?.entries[0].level).toBe(6);
  });

  it("实体账本按归一化名称合并，不受模型自产 id 漂移影响", () => {
    writeback.execute(projectId, {
      chapter: 1, content: "", hook: null,
      characterUpdates: [{ id: "linyi", name: "林逸", level: 1 }],
      locationUpdates: [{ id: "shenzhen_university", name: "深城大学", status: "报到中" }],
      itemUpdates: [], events: [], timeline: [], foreshadowUpdates: [],
      infoPerspective: { truth: [], display: [] },
      chapterSummary: "第一章",
    });
    writeback.execute(projectId, {
      chapter: 2, content: "", hook: null,
      characterUpdates: [{ id: "林逸", name: "林逸", level: 2, status: "躺平" }],
      locationUpdates: [{ id: "深城大学", name: "深城大学", status: "开学" }],
      itemUpdates: [], events: [], timeline: [], foreshadowUpdates: [],
      infoPerspective: { truth: [], display: [] },
      chapterSummary: "第二章",
    });

    const chars = dynamicStore.load(projectId, "characters");
    expect(chars?.entries).toHaveLength(1);
    expect(chars?.entries[0].level).toBe(2);
    expect(chars?.entries[0].status).toBe("躺平");
    expect(chars?.entries[0].key).toBe("characters::林逸");

    const locs = dynamicStore.load(projectId, "locations");
    expect(locs?.entries).toHaveLength(1);
    expect(locs?.entries[0].status).toBe("开学");
  });

  it("章节摘要一章一条，重跑同章回写幂等覆盖", () => {
    writeback.execute(projectId, {
      chapter: 1, content: "", hook: { type: "期待", content: "钩子A" },
      characterUpdates: [], locationUpdates: [], itemUpdates: [],
      events: [], timeline: [], foreshadowUpdates: [],
      infoPerspective: { truth: [], display: [] },
      chapterSummary: "第一版摘要",
    });
    writeback.execute(projectId, {
      chapter: 1, content: "", hook: { type: "悬念", content: "钩子B" },
      characterUpdates: [], locationUpdates: [], itemUpdates: [],
      events: [], timeline: [], foreshadowUpdates: [],
      infoPerspective: { truth: [], display: [] },
      chapterSummary: "第二版摘要",
    });
    const summaries = dynamicStore.load(projectId, "chapter_summaries");
    expect(summaries?.entries).toHaveLength(1);
    expect(summaries?.entries[0].summary).toBe("第二版摘要");
    expect(summaries?.entries[0].hook.content).toBe("钩子B");
  });

  it("事件/时间线/伏笔按内容指纹去重，重复回写不翻倍", () => {
    const base = {
      chapter: 1, content: "", hook: null,
      characterUpdates: [], locationUpdates: [], itemUpdates: [],
      events: [{ chapter: 1, description: "林逸重生" }],
      timeline: [{ time: "2010年9月", event: "林逸重生" }],
      foreshadowUpdates: [{ planted_chapter: 1, expected_chapter: 10, status: "埋设", description: "林逸隐藏实力" }],
      infoPerspective: { truth: [{ fact: "林逸是重生者" }], display: [{ fact: "林逸是新生" }] },
      chapterSummary: "第一章",
    } as WritebackData;
    writeback.execute(projectId, { ...base, chapterSummary: "第一次" });
    writeback.execute(projectId, { ...base, chapterSummary: "第二次" });

    expect(dynamicStore.load(projectId, "events")?.entries).toHaveLength(1);
    expect(dynamicStore.load(projectId, "timeline")?.entries).toHaveLength(1);
    expect(dynamicStore.load(projectId, "foreshadow")?.entries).toHaveLength(1);
    const info = dynamicStore.load(projectId, "info_perspective");
    expect(info?.truth).toHaveLength(1);
    expect(info?.display).toHaveLength(1);
    expect(dynamicStore.load(projectId, "chapter_summaries")?.entries).toHaveLength(1);
  });

  it("每类账本写入 meta（last_chapter / updated_at）", () => {
    writeback.execute(projectId, {
      chapter: 3, content: "", hook: null,
      characterUpdates: [{ id: "c1", name: "张三", level: 3 }],
      locationUpdates: [], itemUpdates: [],
      events: [{ chapter: 3, description: "事件" }],
      timeline: [], foreshadowUpdates: [],
      infoPerspective: { truth: [], display: [] },
      chapterSummary: "第三章",
    });
    const chars = dynamicStore.load(projectId, "characters");
    expect(chars?.meta?.last_chapter).toBe(3);
    expect(chars?.meta?.updated_at).toBeTruthy();
    expect(dynamicStore.load(projectId, "events")?.meta?.last_chapter).toBe(3);
  });
});
