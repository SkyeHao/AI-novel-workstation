/**
 * AI 小说工作站后端入口（TS，ADR-0006 / ADR-0005）。
 */
import Fastify, { type FastifyInstance } from "fastify";
import { pathToFileURL } from "node:url";
import cors from "@fastify/cors";
import { initSearchEnv } from "./api/state.js";
import { projectsRoutes } from "./api/routes/projects.js";
import { configRoutes } from "./api/routes/config.js";
import { chatRoutes } from "./api/routes/chat.js";
import { workflowRoutes } from "./api/routes/workflow.js";
import { filesRoutes } from "./api/routes/files.js";
import { interactionsRoutes } from "./api/routes/interactions.js";
import { agentRoutes } from "./api/routes/agent.js";

export interface BuildAppOptions {
  logger?: boolean;
  projectDir?: string | null;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(cors, {
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5174",
    ],
    credentials: true,
  });

  initSearchEnv();
  if (opts.projectDir) {
    const { setProjectDirPath } = await import("./api/state.js");
    setProjectDirPath(opts.projectDir);
  }

  app.get("/api/health", async () => ({ status: "ok", runtime: "ts" }));

  await app.register(projectsRoutes, { prefix: "/api/projects" });
  await app.register(configRoutes, { prefix: "/api/config" });
  await app.register(chatRoutes, { prefix: "/api/chat" });
  await app.register(workflowRoutes, { prefix: "/api/workflow" });
  await app.register(filesRoutes, { prefix: "/api/files" });
  await app.register(interactionsRoutes, { prefix: "/api/interactions" });
  await app.register(agentRoutes, { prefix: "/api/agent" });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 8000);
  await app.listen({ port, host: "127.0.0.1" });
  console.log(`[ts-backend] listening on http://127.0.0.1:${port}`);
}

