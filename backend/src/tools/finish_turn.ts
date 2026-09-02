/** finish_turn 工具：Agent 完成本轮全部工具查询后，显式提交最终结论并结束本轮。
 * 一轮发言被建模为「原子工具流事务」：事务内不调度其他人发言；
 * 只有 Agent 调用 finish_turn（或系统兜底收尾）后，才进入下一位发言者的调度点。
 */
import { AbstractTool, ToolResult } from "./base.js";

export const FINISH_TURN_MARKER = "[FINISH_TURN]";

export class FinishTurnTool extends AbstractTool {
  readonly name = "finish_turn";

  readonly description =
    "结束你本轮发言并提交最终结论。在你完成全部工具查询、形成最终结论后调用本工具，系统会把 conclusion 作为你的最终发言展示并进入讨论历史；" +
    "在你调用本工具之前，本轮不会结束、也不会安排其他人发言，因此无需担心过程被打断，可放心先完成所有工具查询与思考。" +
    "请把最终结论完整写入 conclusion 字段，不要只写摘要；summary 可留空由系统自动截取。"

  readonly parameters = [
    { name: "conclusion", type: "string", description: "本轮最终结论全文（将作为你的独立发言气泡展示）", required: true, default: null },
    { name: "summary", type: "string", description: "可选的一两句简短摘要", required: false, default: null },
  ];

  async execute(kwargs: Record<string, unknown>): Promise<ToolResult> {
    const conclusion = String(kwargs.conclusion ?? "").trim();
    if (!conclusion) return new ToolResult(false, "", "conclusion 不能为空");
    const summary = String(kwargs.summary ?? "").trim() || conclusion.slice(0, 120);
    return new ToolResult(true, FINISH_TURN_MARKER + " " + summary, "");
  }
}

