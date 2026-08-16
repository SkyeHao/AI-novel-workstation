/** 工具管理器（TS 版，迁移自 tools/manager.py）。 */
import type { BaseTool } from "./base.js";
import { ToolResult } from "./base.js";

export class ToolManager {
  private _tools: Record<string, BaseTool> = {};

  register(tool: BaseTool): void {
    this._tools[tool.name] = tool;
  }

  unregister(name: string): void {
    delete this._tools[name];
  }

  get(name: string): BaseTool | null {
    return this._tools[name] ?? null;
  }

  listNames(): string[] {
    return Object.keys(this._tools);
  }

  listTools(): BaseTool[] {
    return Object.values(this._tools);
  }

  async execute(name: string, kwargs: Record<string, unknown> = {}): Promise<ToolResult> {
    const tool = this._tools[name];
    if (!tool) {
      return new ToolResult(false, "", `工具不存在: ${name}，可用工具: ${this.listNames().join(", ")}`);
    }
    try {
      return await tool.execute(kwargs);
    } catch (err) {
      return new ToolResult(false, "", err instanceof Error ? err.message : String(err));
    }
  }

  toPrompt(): string {
    if (Object.keys(this._tools).length === 0) return "（无可用工具）";
    return this.listTools().map((t) => t.toPrompt()).join("\n\n");
  }

  toOpenaiFunctions(): Array<Record<string, unknown>> {
    return this.listTools().map((t) => t.toOpenaiFunction());
  }
}
