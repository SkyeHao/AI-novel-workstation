import { describe, expect, it, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DynamicSettingsStore, type DynamicAccount } from "../src/storage/dynamic_settings.js";
import { ProjectStore } from "../src/storage/project_store.js";

describe("DynamicSettingsStore（工单 02：动态设定账本层）", () => {
  let tempDir: string;
  let projectStore: ProjectStore;
  let dynamicStore: DynamicSettingsStore;
  const projectId = "test-project-02";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyn-test-"));
    projectStore = new ProjectStore(tempDir);
    projectStore.create("测试项目", "", { genre: "玄幻", platform: "起点" });
    dynamicStore = new DynamicSettingsStore(projectStore);
  });

  it("8 类账本都能持久化并可只读浏览", () => {
    // 写入各账本
    dynamicStore.update(projectId, "characters", {
      entries: [{ id: "char-1", name: "张三", level: 5, health: 100 }]
    });
    dynamicStore.update(projectId, "locations", {
      entries: [{ id: "loc-1", name: "青云门", status: "正常" }]
    });
    dynamicStore.update(projectId, "items", {
      entries: [{ id: "item-1", name: "玄铁剑", owner: "张三" }]
    });
    dynamicStore.update(projectId, "events", {
      entries: [{ id: "evt-1", chapter: 1, description: "张三入门" }]
    });
    dynamicStore.update(projectId, "timeline", {
      entries: [{ id: "tl-1", time: "第一天", event: "入门" }]
    });
    dynamicStore.update(projectId, "foreshadow", {
      entries: [{ id: "fs-1", planted_chapter: 1, expected_chapter: 10, status: "悬置" }]
    });
    dynamicStore.update(projectId, "info_perspective", {
      truth: [{ id: "truth-1", fact: "张三是转世" }],
      display: [{ id: "disp-1", fact: "张三是普通弟子" }]
    });
    dynamicStore.update(projectId, "chapter_summaries", {
      entries: [{ chapter: 1, summary: "张三入门" }]
    });

    // 读取验证
    const chars = dynamicStore.load(projectId, "characters");
    expect(chars?.entries).toHaveLength(1);
    expect(chars?.entries[0].name).toBe("张三");

    const locs = dynamicStore.load(projectId, "locations");
    expect(locs?.entries).toHaveLength(1);

    const items = dynamicStore.load(projectId, "items");
    expect(items?.entries).toHaveLength(1);

    const events = dynamicStore.load(projectId, "events");
    expect(events?.entries).toHaveLength(1);

    const timeline = dynamicStore.load(projectId, "timeline");
    expect(timeline?.entries).toHaveLength(1);

    const foreshadow = dynamicStore.load(projectId, "foreshadow");
    expect(foreshadow?.entries).toHaveLength(1);

    const info = dynamicStore.load(projectId, "info_perspective");
    expect(info?.truth).toHaveLength(1);
    expect(info?.display).toHaveLength(1);

    const summaries = dynamicStore.load(projectId, "chapter_summaries");
    expect(summaries?.entries).toHaveLength(1);
  });

  it("信息与视角状态区分真相层与展示层", () => {
    dynamicStore.update(projectId, "info_perspective", {
      truth: [
        { id: "t1", fact: "张三是转世大能" },
        { id: "t2", fact: "青云门即将被灭" }
      ],
      display: [
        { id: "d1", fact: "张三是普通弟子" },
        { id: "d2", fact: "青云门繁荣昌盛" }
      ]
    });

    const info = dynamicStore.load(projectId, "info_perspective");
    expect(info?.truth).toHaveLength(2);
    expect(info?.display).toHaveLength(2);
    // 真相层与展示层内容不同
    expect(info?.truth[0].fact).not.toBe(info?.display[0].fact);
  });

  it("账本数据持久化到文件", () => {
    dynamicStore.update(projectId, "characters", {
      entries: [{ id: "char-1", name: "李四", level: 3 }]
    });

    // 重新创建 store 实例，验证持久化
    const newStore = new DynamicSettingsStore(projectStore);
    const loaded = newStore.load(projectId, "characters");
    expect(loaded?.entries).toHaveLength(1);
    expect(loaded?.entries[0].name).toBe("李四");
  });

  it("未知账本类型返回 null", () => {
    const result = dynamicStore.load(projectId, "unknown_account" as any);
    expect(result).toBeNull();
  });

  it("列出所有账本类型", () => {
    const accounts = dynamicStore.listAccounts(projectId);
    expect(accounts).toEqual([
      "characters",
      "locations",
      "items",
      "events",
      "timeline",
      "foreshadow",
      "info_perspective",
      "chapter_summaries",
      "hooks"
    ]);
  });
});
