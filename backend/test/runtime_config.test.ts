import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildApp } from "../src/server.js";
import { getDataDir, getEmbeddingDir } from "../src/config/paths.js";
import { TransformersEmbeddingService } from "../src/vector/embedding.js";
import { QdrantVectorStore } from "../src/vector/store.js";

const ENV_KEYS = ["AI_NOVEL_DATA_DIR", "AI_NOVEL_EMBEDDING_DIR", "QDRANT_URL"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("运行配置契约（工单 01）", () => {
  it("注入静态目录：首页/SPA 回退/静态资源 200，API 未命中返回 JSON 404", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-static-"));
    try {
      fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><body>app</body></html>");
      fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
      fs.writeFileSync(path.join(dir, "assets", "x.css"), "body{}");

      const app = await buildApp({ staticDir: dir });
      const home = await app.inject({ method: "GET", url: "/" });
      expect(home.statusCode).toBe(200);
      expect(home.body).toContain("app");

      const spa = await app.inject({ method: "GET", url: "/projects/p1/agent" });
      expect(spa.statusCode).toBe(200);
      expect(spa.headers["content-type"]).toContain("text/html");

      const asset = await app.inject({ method: "GET", url: "/assets/x.css" });
      expect(asset.statusCode).toBe(200);
      expect(asset.body).toContain("body");

      const api404 = await app.inject({ method: "GET", url: "/api/nonexistent" });
      expect(api404.statusCode).toBe(404);
      expect(JSON.parse(api404.body)).toHaveProperty("error");

      await app.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("设置 AI_NOVEL_DATA_DIR：数据目录与 embedding 默认目录均落到该根下", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-data-"));
    try {
      process.env.AI_NOVEL_DATA_DIR = path.join(dir, "data");
      expect(getDataDir()).toBe(path.resolve(dir, "data"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("设置 AI_NOVEL_EMBEDDING_DIR：embedding 服务指向该离线目录", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-emb-"));
    try {
      process.env.AI_NOVEL_EMBEDDING_DIR = path.join(dir, "models");
      const svc = new TransformersEmbeddingService();
      expect(svc.cacheDir).toBe(path.resolve(dir, "models"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("设置 QDRANT_URL：向量客户端指向该地址", () => {
    process.env.QDRANT_URL = "http://127.0.0.1:6335";
    const store = new QdrantVectorStore();
    expect(store.url).toBe("http://127.0.0.1:6335");
  });

  it("未设置任何配置时行为与现有 Web 版一致（兼容性回归）", () => {
    // getDataDir 默认落到仓库根 data/（buildApp 未注入项目目录时的既有行为）
    expect(getDataDir()).toBe(path.resolve(process.cwd(), "..", "data"));
    expect(getEmbeddingDir()).toContain("models");
    const svc = new TransformersEmbeddingService();
    expect(svc.cacheDir).toBe(getEmbeddingDir());
    const store = new QdrantVectorStore();
    expect(store.url).toBe("http://127.0.0.1:6333");
  });
});
