import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectStore, ProjectNotFoundError, ProjectError } from "../src/storage/project_store.js";

let dir: string;
let store: ProjectStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-store-"));
  store = new ProjectStore(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("ProjectStore（T1 单锚点持久化）", () => {
  it("创建项目并初始化目录", () => {
    const p = store.create("测试项目", "一句话梗", { genre: "玄幻" });
    expect(p.name).toBe("测试项目");
    expect(p.id).toBe("测试项目");
    expect(fs.existsSync(path.join(dir, "测试项目", "project.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "测试项目", "memory", "summaries"))).toBe(true);
  });

  it("重复创建抛错", () => {
    store.create("A");
    expect(() => store.create("A")).toThrow(ProjectError);
  });

  it("更新状态（current_state 锚点）", () => {
    const p = store.create("B");
    const updated = store.update(p.id, { status: "writing", work_unit: "ch3", states_enabled: ["ideation", "worldview", "writing"] });
    expect(updated.status).toBe("writing");
    expect(updated.work_unit).toBe("ch3");
    expect(updated.states_enabled).toEqual(["ideation", "worldview", "writing"]);
    // 重新读取持久化验证
    const reloaded = store.get(p.id);
    expect(reloaded.status).toBe("writing");
    expect(reloaded.states_enabled).toEqual(["ideation", "worldview", "writing"]);
  });

  it("ghost 目录无元数据时按目录名构造", () => {
    fs.mkdirSync(path.join(dir, "ghost"), { recursive: true });
    const p = store.get("ghost");
    expect(p.name).toBe("ghost");
  });

  it("不存在项目抛 ProjectNotFoundError", () => {
    expect(() => store.get("none")).toThrow(ProjectNotFoundError);
  });

  it("list 按更新时间倒序", () => {
    store.create("较早");
    const p2 = store.create("较晚");
    store.update(p2.id, { idea: "x" });
    const list = store.list();
    expect(list[0]!.name).toBe("较晚");
  });

  it("删除项目，且删除后 get 抛错", () => {
    store.create("D");
    store.delete("D");
    expect(() => store.get("D")).toThrow(ProjectNotFoundError);
  });
});
