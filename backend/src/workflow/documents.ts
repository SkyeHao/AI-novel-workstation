/** 项目文档列表（TS 版，迁移自 workflow.py 中 documents 端点逻辑）。 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectStore } from "../storage/project_store.js";

export function getProjectDocuments(projectStore: ProjectStore, projectId: string): { documents: Array<Record<string, unknown>> } {
  const root = projectStore.project_root(projectId);
  const docs: Array<Record<string, unknown>> = [];
  if (fs.existsSync(root)) {
    const walk = (dir: string): void => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".md")) {
          try {
            const stat = fs.statSync(full);
            const rel = path.relative(root, full).split("\\").join("/");
            docs.push({ name: entry.name, path: rel, size: stat.size, modified: stat.mtimeMs });
          } catch {
            /* 忽略 */
          }
        }
      }
    };
    walk(root);
  }
  docs.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  return { documents: docs };
}
