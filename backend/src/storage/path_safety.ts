/** 路径安全模块（TS 版，迁移自 storage/path_safety.py）。 */
import * as path from "node:path";

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

/** 在沙箱根内安全解析路径 */
export function safeResolve(baseDir: string, p: string): string {
  if (p === null || p === undefined || String(p).trim() === "") {
    throw new PathSafetyError("路径不能为空");
  }
  const base = path.resolve(baseDir);
  const target = path.isAbsolute(p) ? path.resolve(p) : path.resolve(base, p);
  const rel = path.relative(base, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathSafetyError(`路径越界: ${target} 不在沙箱根 ${base} 内`);
  }
  return target;
}
