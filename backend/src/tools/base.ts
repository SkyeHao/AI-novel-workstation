/** 工具基类（TS 版，迁移自 tools/base.py）。 */

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default: unknown;
}

export class ToolResult {
  success: boolean;
  output: string;
  error: string;

  constructor(success: boolean, output = "", error = "") {
    this.success = success;
    this.output = output;
    this.error = error;
  }
}

export interface BaseTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameter[];
  execute(kwargs: Record<string, unknown>): Promise<ToolResult>;
  toPrompt(): string;
  toOpenaiFunction(): Record<string, unknown>;
}

export abstract class AbstractTool implements BaseTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: ToolParameter[];
  abstract execute(kwargs: Record<string, unknown>): Promise<ToolResult>;

  toPrompt(): string {
    const paramsStr = this.parameters
      .map(
        (p) =>
          `  - ${p.name} (${p.type}): ${p.description}` +
          (p.required ? "" : " (可选)") +
          (p.default !== null && p.default !== undefined ? ` [默认: ${String(p.default)}]` : "")
      )
      .join("\n");
    return `工具: ${this.name}\n描述: ${this.description}\n参数:\n${paramsStr}`;
  }

  toOpenaiFunction(): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of this.parameters) {
      const prop: Record<string, unknown> = { type: p.type, description: p.description };
      if (p.default !== null && p.default !== undefined) prop.default = p.default;
      properties[p.name] = prop;
      if (p.required) required.push(p.name);
    }
    return {
      name: this.name,
      description: this.description,
      parameters: { type: "object", properties, required },
    };
  }
}
