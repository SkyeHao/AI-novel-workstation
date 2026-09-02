/** ReAct Agent（TS 版，迁移自 agent/react.py），支持多工具调用模式与流式回调。 */
import type { LLMClient } from "../llm/client.js";
import { chatMessageFromDict, ChatMessage, Role } from "../llm/models.js";
import type { ToolManager } from "../tools/manager.js";

export type ToolCallMode = "native" | "jsonfc" | "dsml" | "auto";

export interface AgentStep {
  thought: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  observation: string;
  is_final: boolean;
}

export interface AgentTurnResult {
  reply: string;
  steps: AgentStep[];
  is_done: boolean;
  token_count: number;
}

export interface AskQuestion {
  question: string;
  options: string[];
  multiple: boolean;
  allow_custom: boolean;
}

/** ask 被中断时 resolve 的哨兵值：调用方据此中止本轮而不记录“作者的选择” */
export const ASK_ABORTED_SENTINEL = "__AGENT_ASK_ABORTED__";

/**
 * 自定义回答选项的标记文案：前端识别它打开自定义输入，而不是作为普通选项提交。
 * 无论 Agent 是否提供，ask 卡片都会在选项末尾追加该项，保证作者始终有可自由输入的入口。
 */
export const ASK_CUSTOM_OPTION = "✏️ 自定义回答…";

/** Agent 未提供足够候选时的兜底选项，保证作者始终有多个可点选项（工单 14：禁止裸输入） */
export const ASK_FALLBACK_OPTIONS = ["按你的建议执行", "换个方向再讨论"];

/**
 * 归一化 ask 选项：过滤空值/去重标记项，不足 2 个时用兜底选项补足，末尾追加“自定义回答”选项。
 * 保证任何 ask_user 提问都有几个可选择的候选 + 一个可直接输入的入口。
 */
export function normalizeAskOptions(options: string[]): string[] {
  const filtered = (options ?? [])
    .map((s) => String(s).trim())
    .filter((s) => s && s !== ASK_CUSTOM_OPTION);
  let out = filtered.slice(0, 6);
  if (out.length === 0) out = [...ASK_FALLBACK_OPTIONS];
  else if (out.length === 1) out = [out[0]!, ASK_FALLBACK_OPTIONS[0]!];
  if (!out.includes(ASK_CUSTOM_OPTION)) out = [...out, ASK_CUSTOM_OPTION];
  return out;
}

/** 用户手动中断 Agent 执行 */
export class AgentAbortError extends Error {
  constructor() {
    super("Agent 执行被用户中断");
    this.name = "AgentAbortError";
  }
}

/** 等待作者回答的解析器（配合 ask_user 工具） */
export class AskResolver {
  /** ask_user 等待超时（秒）；0 表示不超时，作者可无限期保持 ask 等待，之后重新打开会话仍可继续作答。可通过 AGENT_ASK_TIMEOUT 覆盖。 */
  static readonly ASK_TIMEOUT_SECONDS = Number(process.env.AGENT_ASK_TIMEOUT) || 0;
  static readonly TIMEOUT_MSG = "作者超时未回答，请给出合理默认方向并继续推进";
  private _pending: {
    question: AskQuestion;
    resolve: (answer: string) => void;
    timeout?: NodeJS.Timeout;
  } | null = null;

  constructor(private _onAsk: ((q: AskQuestion) => void) | null = null) {}

  get hasPending(): boolean {
    return this._pending !== null;
  }

  /** 查看当前等待的问题（断连恢复用） */
  peek(): AskQuestion | null {
    return this._pending ? this._pending.question : null;
  }

  ask(question: string, options: string[], multiple: boolean, allowCustom: boolean): Promise<string> {
    if (this._pending) {
      this._pending.resolve("");
      clearTimeout(this._pending.timeout);
    }
    return new Promise<string>((resolve) => {
      const pending: NonNullable<typeof this._pending> = {
        // 工单 14：无论 Agent 怎么传，选项始终归一化——保证有几个候选 + 一个自定义回答入口
        question: {
          question,
          options: normalizeAskOptions(options),
          multiple,
          allow_custom: true,
        },
        resolve,
      };
      // 默认不设超时：作者未作答则一直保持 ask 状态。只有显式配置 AGENT_ASK_TIMEOUT>0 时才启用超时默认方向。
      if (AskResolver.ASK_TIMEOUT_SECONDS > 0) {
        pending.timeout = setTimeout(() => {
          this._pending = null;
          resolve(AskResolver.TIMEOUT_MSG);
        }, AskResolver.ASK_TIMEOUT_SECONDS * 1000) as unknown as NodeJS.Timeout;
      }
      this._pending = pending;
      if (this._onAsk) this._onAsk(this._pending!.question);
    });
  }

  submitAnswer(answer: string): boolean {
    if (!this._pending) return false;
    const p = this._pending;
    this._pending = null;
    if (p.timeout) clearTimeout(p.timeout);
    p.resolve(answer);
    return true;
  }

  /** 中断时释放等待中的 ask（resolve 哨兵值，调用方据此中止本轮） */
  abort(): void {
    if (!this._pending) return;
    const p = this._pending;
    this._pending = null;
    if (p.timeout) clearTimeout(p.timeout);
    p.resolve(ASK_ABORTED_SENTINEL);
  }
}

const DSML_INVOKE_RE = /<\|\|DSML\|\|invoke name="([^"]+)"[^>]*>([\s\S]*?)<\/\|\|DSML\|\|invoke>/g;
const DSML_PARAM_RE = /<\|\|DSML\|\|parameter name="([^"]+)"[^>]*>([\s\S]*?)<\/\|\|DSML\|\|parameter>/g;
const DSML_NOISE = ["<||DSML||tool_calls>", "</||DSML||tool_calls>", "</||DSML||result>"];

const COMMITMENT_MARKS = [
  "我去搜索", "我先搜索", "我来搜索", "让我搜索", "我将搜索", "我要搜索",
  "我去查找", "我先查找", "我来查找", "让我查找",
  "我去查", "我先查", "我来查", "让我查",
  "我去写", "我先写", "我来写", "让我写", "我将写", "我要写",
  "写入文件", "保存文档", "生成文档", "创建文件",
  "我先整理", "我来整理", "让我整理",
  "我去创建", "我来创建", "让我创建",
  "我把", "我先把",
];

function parseJsonfcArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object") return args as Record<string, unknown>;
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* 忽略 */
    }
  }
  return {};
}

function looksLikeBrokenProtocol(content: string): boolean {
  return content.includes('"tool_call"') || content.includes('"thought"') && content.includes("}") && content.includes("{");
}

/** 从 jsonfc 累积文本中提取 thought 字段相对上次的增量（处理 JSON 转义；未闭合时取到末尾） */
export function extractThoughtDelta(content: string, prevLen: number): string | null {
  // 优先匹配闭合的 thought 值；流式中间态未闭合时取到内容末尾
  const closed = content.match(/"thought"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const partial = content.match(/"thought"\s*:\s*"((?:[^"\\]|\\.)*)$/);
  const raw = closed ? closed[1]! : (partial ? partial[1]! : null);
  if (raw === null) return null;
  const thought = raw.replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (thought.length <= prevLen) return null;
  return thought.slice(prevLen);
}

export class ReActAgent {
  messages: ChatMessage[];
  client: LLMClient;
  tool_manager: ToolManager;
  system_prompt: string;
  max_iterations: number;
  temperature: number;
  end_token: string;
  max_output_tokens: number | null;
  tool_call_mode: ToolCallMode;
  ask_resolver: AskResolver;
  on_ask_pending?: () => void | Promise<void>;

  constructor(init: {
    client: LLMClient;
    tool_manager: ToolManager;
    system_prompt: string;
    max_iterations?: number;
    temperature?: number;
    end_token?: string;
    max_output_tokens?: number | null;
    tool_call_mode?: ToolCallMode;
    ask_resolver?: AskResolver;
    on_ask_pending?: () => void | Promise<void>;
  }) {
    this.client = init.client;
    this.tool_manager = init.tool_manager;
    this.system_prompt = init.system_prompt;
    this.max_iterations = init.max_iterations ?? 10;
    this.temperature = init.temperature ?? 0.7;
    this.end_token = init.end_token ?? "";
    this.max_output_tokens = init.max_output_tokens ?? 8000;
    const mode = init.tool_call_mode ?? "native";
    this.tool_call_mode = ["native", "jsonfc", "dsml", "auto"].includes(mode) ? mode : "native";
    this.ask_resolver = init.ask_resolver ?? new AskResolver();
    this.on_ask_pending = init.on_ask_pending;
    this.messages = [new ChatMessage(Role.SYSTEM, this.system_prompt)];
  }

  reset(): void {
    this.messages = [new ChatMessage(Role.SYSTEM, this.system_prompt)];
  }

  restoreMessages(list: Array<Record<string, unknown>>): void {
    this.messages = list.map((m) => chatMessageFromDict(m));
  }

  serializeMessages(): Array<Record<string, unknown>> {
    return this.messages.map((m) => m.toDict());
  }

  async run(userInput: string): Promise<AgentTurnResult> {
    this.reset();
    return this.run_turn(userInput);
  }

  async run_turn(
    userInput: string,
    callbacks: {
      on_step?: (step: AgentStep) => void | Promise<void>;
      on_stream?: (text: string) => void | Promise<void>;
      on_thinking?: (text: string) => void | Promise<void>;
      on_ask?: (q: AskQuestion) => void;
    } = {},
    signal?: AbortSignal
  ): Promise<AgentTurnResult> {
    if (signal?.aborted) throw new AgentAbortError();
    this.messages.push(new ChatMessage(Role.USER, userInput));
    const steps: AgentStep[] = [];
    let total_tokens = 0;

    const _emit = async (step: AgentStep): Promise<void> => {
      steps.push(step);
      if (callbacks.on_step) await callbacks.on_step(step);
    };

    const functions = this.tool_manager.toOpenaiFunctions();
    const useNative = this.tool_call_mode === "native" || this.tool_call_mode === "auto";
    const useJsonfc = this.tool_call_mode === "jsonfc";

    let content = "";
    let protocolFailStreak = 0;
    for (let iter = 0; iter < this.max_iterations; iter++) {
      if (signal?.aborted) throw new AgentAbortError();
      // ---------------- LLM 调用（流式） ----------------
      content = "";
      let finishReason = "";
      let nativeFc: { name: string; arguments: string } | null = null;
      let fcArrived = false;
      const displayedThink: string[] = [];
      const displayedStream: string[] = [];
      let pushedThinkLen = 0;

      const streamIter = this.client.astream(
        this.messages,
        {
          temperature: this.temperature,
          functions: useNative ? functions : undefined,
          function_call: useNative && functions.length > 0 ? ("auto" as never) : undefined,
          max_tokens: this.max_output_tokens ?? undefined,
          response_format: useJsonfc ? { type: "json_object" } : undefined,
        },
        (delta) => {
          const fc = delta?.function_call;
          if (fc) {
            fcArrived = true;
            if (fc.name) {
              nativeFc = nativeFc ?? { name: "", arguments: "" };
              nativeFc.name += fc.name;
            }
            if (fc.arguments) {
              nativeFc = nativeFc ?? { name: "", arguments: "" };
              nativeFc.arguments += fc.arguments;
            }
          }
        },
        signal
      );

      try {
        for await (const piece of streamIter) {
          content += piece;
          total_tokens += 1;
          let isThinking: boolean;
          if (useJsonfc) {
            // jsonfc：整个回复是 JSON 协议，不流式推送正文；但增量推送 thought 作为思考过程
            const delta = extractThoughtDelta(content, pushedThinkLen);
            if (delta && callbacks.on_thinking) {
              pushedThinkLen += delta.length;
              await callbacks.on_thinking(delta);
            }
            continue;
          } else if (useNative) {
            isThinking = fcArrived;
          } else {
            isThinking = content.includes("<||DSML||invoke");
          }
          const clean = displayText(content);
          if (isThinking) {
            const joined = displayedThink.join("");
            if (clean.length > joined.length) {
              const delta = clean.slice(joined.length);
              displayedThink.push(delta);
              if (callbacks.on_thinking) await callbacks.on_thinking(delta);
            }
          } else {
            const joined = displayedStream.join("");
            if (clean.length > joined.length) {
              const delta = clean.slice(joined.length);
              displayedStream.push(delta);
              if (callbacks.on_stream) await callbacks.on_stream(delta);
            }
          }
        }
      } catch (err) {
        if (signal?.aborted) throw new AgentAbortError();
        throw err;
      }

      const streamedText = displayText(content);

      // ---------------- 结束判定 ----------------
      if (this.end_token && content.includes(this.end_token)) {
        await _emit({ thought: streamedText, tool_name: "", tool_args: {}, observation: "", is_final: true });
        return { reply: streamedText, steps, is_done: true, token_count: total_tokens };
      }

      // ---------------- jsonfc 协议路径 ----------------
      if (useJsonfc) {
        const parsed = parseJsonfc(content);
        if (parsed) {
          protocolFailStreak = 0;
          const { thought, tool_call, done } = parsed;
          if (done && !tool_call) {
            const clean = stripJsonfc(content) || thought;
            this.messages.push(new ChatMessage(Role.ASSISTANT, content));
            await _emit({ thought, tool_name: "", tool_args: {}, observation: "", is_final: true });
            return { reply: clean, steps, is_done: true, token_count: total_tokens };
          }
          if (tool_call && tool_call.name) {
            const toolName = tool_call.name;
            const toolArgs = parseJsonfcArgs(tool_call.arguments);
            const step = await this._executeTool({ thought: thought || "", toolName, toolArgs }, _emit);
            if (!step) continue;
            if (signal?.aborted) throw new AgentAbortError();
            continue;
          }
          // done=false 且无工具调用：协议要求继续
          this.messages.push(new ChatMessage(Role.ASSISTANT, content));
          this.messages.push(
            new ChatMessage(Role.USER, "你设置了 done=false 且未调用工具。请继续执行下一步动作（调用工具或推进工作）；完成全部工作后设 done=true。")
          );
          await _emit({ thought: thought || "继续驱动", tool_name: "", tool_args: {}, observation: "", is_final: false });
          continue;
        }
        if (looksLikeBrokenProtocol(content)) {
          protocolFailStreak++;
          if (protocolFailStreak >= 3) {
            const abortMsg = "⚠️ 模型连续多次返回无效协议内容，本轮已自动中止。请重新发送消息重试。";
            await _emit({ thought: abortMsg, tool_name: "", tool_args: {}, observation: "", is_final: true });
            return { reply: abortMsg, steps, is_done: false, token_count: total_tokens };
          }
          this.messages.push(new ChatMessage(Role.ASSISTANT, content));
          this.messages.push(
            new ChatMessage(
              Role.USER,
              "你上一条回复的 JSON 协议解析失败（期望 {\"thought\":...,\"tool_call\":...或null,\"done\":...}，" +
                "但字段缺失或结构错误，如 tool_call 必须是 {\"name\":\"工具名\",\"arguments\":{...}}）。请重新输出一个合法、完整的协议 JSON。"
            )
          );
          await _emit({ thought: "⚠️ 协议 JSON 解析失败，正在要求模型修正重试…", tool_name: "", tool_args: {}, observation: "", is_final: false });
          continue;
        }
        // 非协议文本：若为空白/无效内容（含空 JSON {} / 空数组 []），驱动模型重试，避免产出空白回复
        const fallbackReply = stripJsonfc(content) || streamedText;
        const trimmedReply = fallbackReply.trim();
        const isBareJson = trimmedReply === "{}" || trimmedReply === "[]";
        if (!trimmedReply || isBareJson) {
          protocolFailStreak++;
          if (protocolFailStreak >= 3) {
            const abortMsg = "⚠️ 模型连续多次返回无效协议内容，本轮已自动中止。请重新发送消息重试。";
            await _emit({ thought: abortMsg, tool_name: "", tool_args: {}, observation: "", is_final: true });
            return { reply: abortMsg, steps, is_done: false, token_count: total_tokens };
          }
          // 空白/畸形回复以可读占位写入历史，避免裸空 JSON（{"": ""} 等）残留在会话文件
          this.messages.push(new ChatMessage(Role.ASSISTANT, "（模型返回了空白/无效协议内容，已提示重新输出）"));
          this.messages.push(
            new ChatMessage(Role.USER, "你上一条回复没有实际内容（返回了空 JSON {} / [] 或空白）。请重新输出一个合法、完整的协议 JSON（thought + tool_call 或 done=true）。")
          );
          await _emit({ thought: "⚠️ 检测到空白回复，要求模型重新输出…", tool_name: "", tool_args: {}, observation: "", is_final: false });
          continue;
        }
        // 模型偶尔输出非协议的普通 JSON 对象（如 {"文件路径":"内容" }），提取其中的字符串值作为可读回复
        let readableReply = fallbackReply;
        let parsedAsJsonObject = false;
        try {
          const maybeObj = JSON.parse(fallbackReply);
          if (maybeObj && typeof maybeObj === "object" && !Array.isArray(maybeObj)) {
            parsedAsJsonObject = true;
            const textVal = Object.values(maybeObj).find((v): v is string => typeof v === "string" && v.trim() !== "");
            if (textVal) readableReply = textVal;
          }
        } catch {
          /* 非 JSON 文本，原样返回 */
        }
        // 返回的是 JSON 对象但提取不出可读文本（如 {"": 0} / {"key": 123}）：视为协议失败，驱动重试，避免把畸形 JSON 当最终回复展示给作者
        if (parsedAsJsonObject && readableReply === fallbackReply) {
          protocolFailStreak++;
          if (protocolFailStreak >= 3) {
            const abortMsg = "⚠️ 模型连续多次返回无效协议内容，本轮已自动中止。请重新发送消息重试。";
            await _emit({ thought: abortMsg, tool_name: "", tool_args: {}, observation: "", is_final: true });
            return { reply: abortMsg, steps, is_done: false, token_count: total_tokens };
          }
          this.messages.push(new ChatMessage(Role.ASSISTANT, "（模型返回了无效协议内容，已提示重新输出）"));
          this.messages.push(
            new ChatMessage(Role.USER, '你上一条回复没有包含可读文本或合法协议 JSON（期望 {"thought":...,"tool_call":...或null,"done":...}）。请重新输出一个合法、完整的协议 JSON。')
          );
          await _emit({ thought: "⚠️ 检测到无内容的 JSON 回复，要求模型重新输出…", tool_name: "", tool_args: {}, observation: "", is_final: false });
          continue;
        }
        // 落盘一致性：把本次 assistant 回复写入消息历史，供上层持久化（否则会话文件缺失该回复）
        this.messages.push(new ChatMessage(Role.ASSISTANT, content));
        await _emit({ thought: readableReply, tool_name: "", tool_args: {}, observation: "", is_final: true });
        return { reply: readableReply, steps, is_done: false, token_count: total_tokens };
      }

      // ---------------- 工具调用解析 ----------------
      const toolCall = this._extractToolCall(nativeFc, content);
      if (toolCall) {
        const { name, args, thought } = toolCall;
        const step = await this._executeTool({ thought, toolName: name, toolArgs: args }, _emit);
        if (!step) continue;
        if (signal?.aborted) throw new AgentAbortError();
        continue;
      }

      // ---------------- 无工具调用：最终回复 ----------------
      const replyText = streamedText || content.trim();
      if (!replyText) {
        // 空回复兜底：驱动继续
        continue;
      }
      // 承诺动作但未执行：驱动其真正执行
      if (shouldDriveNext(replyText)) {
        this.messages.push(new ChatMessage(Role.ASSISTANT, content));
        this.messages.push(
          new ChatMessage(Role.USER, "你承诺了要执行动作但没有调用工具。请立刻调用对应工具完成任务，完成后再给出最终回复。")
        );
        await _emit({ thought: "检测到动作承诺未执行，继续驱动…", tool_name: "", tool_args: {}, observation: "", is_final: false });
        continue;
      }
      this.messages.push(new ChatMessage(Role.ASSISTANT, content));
      await _emit({ thought: replyText, tool_name: "", tool_args: {}, observation: "", is_final: true });
      return { reply: replyText, steps, is_done: false, token_count: total_tokens };
    }

    if (content.trim()) this.messages.push(new ChatMessage(Role.ASSISTANT, content));
    const lastText = displayText(content ?? "");
    await _emit({ thought: lastText || "已达到最大迭代次数，结束本轮。", tool_name: "", tool_args: {}, observation: "", is_final: true });
    return { reply: lastText || "（达到最大迭代次数，未完成）", steps, is_done: false, token_count: total_tokens };
  }

  /** 执行工具并回填消息历史；返回是否继续循环 */
  private async _executeTool(
    info: { thought: string; toolName: string; toolArgs: Record<string, unknown> },
    _emit: (step: AgentStep) => Promise<void>
  ): Promise<boolean> {
    const { thought, toolName, toolArgs } = info;

    // ask_user 工具：先推送提问事件，等待作者回答
    if (toolName === "ask_user" && this.ask_resolver) {
      const question = String(toolArgs.question ?? "").trim() || "请做出选择";
      const opts = normalizeList(toolArgs.options);
      const multiple = toBool(toolArgs.multiple);
      const allowCustom = toBool(toolArgs.allow_custom);
      const step: AgentStep = { thought, tool_name: toolName, tool_args: toolArgs, observation: "", is_final: false };
      await _emit(step);
      this.messages.push(new ChatMessage(Role.ASSISTANT, thought || `调用 ask_user：${question}`));
      if (this.on_ask_pending) await this.on_ask_pending();
     const answer = await this.ask_resolver.ask(question, opts, multiple, allowCustom);
     if (answer === ASK_ABORTED_SENTINEL) throw new AgentAbortError();
     const observation = `作者的选择：${answer}`;
     step.observation = observation;
     this.messages.push(new ChatMessage(Role.USER, observation));
      // 作者回答后立即落盘（含“作者的选择”记录），前端重开/刷新时可还原紫色思考气泡与 ask_user 工具气泡
      if (this.on_ask_pending) await this.on_ask_pending();
      return true;
    }

    const result = await this.tool_manager.execute(toolName, toolArgs);
    const observation = result.success ? result.output : `错误: ${result.error}`;

    const step: AgentStep = {
      thought,
      tool_name: toolName,
      tool_args: toolArgs,
      observation: observation.slice(0, 1500),
      is_final: false,
    };
    await _emit(step);

    // 回填工具执行结果到最后一条交互记录
    const lastInteraction = this.client.get_last_interaction();
    if (lastInteraction) {
      lastInteraction.tool_name = toolName;
      lastInteraction.tool_args = toolArgs;
      lastInteraction.tool_result = step.observation;
      lastInteraction.tool_success = result.success;
    }

    this.messages.push(new ChatMessage(Role.ASSISTANT, info.thought || `调用工具: ${info.toolName}`));
    this.messages.push(
      new ChatMessage(Role.USER, `工具 ${toolName} 执行结果：\n${observation}`)
    );
    return true;
  }

  private _extractToolCall(
    nativeFc: { name: string; arguments: string } | null,
    content: string
  ): { name: string; args: Record<string, unknown>; thought: string } | null {
    // 原生 function_call
    if (nativeFc && nativeFc.name) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(nativeFc.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      return { name: nativeFc.name, args, thought: displayThink(content) };
    }
    // DSML 文本格式
    if (this.tool_call_mode === "dsml" || this.tool_call_mode === "auto") {
      DSML_INVOKE_RE.lastIndex = 0;
      const m = DSML_INVOKE_RE.exec(content);
      if (m) {
        const name = m[1];
        const args: Record<string, unknown> = {};
        DSML_PARAM_RE.lastIndex = 0;
        let pm: RegExpExecArray | null;
        while ((pm = DSML_PARAM_RE.exec(m[2]))) {
          let val: unknown = pm[2];
          try {
            val = JSON.parse(pm[2]);
          } catch {
            /* 保持字符串 */
          }
          args[pm[1]] = val;
        }
        return { name, args, thought: content.slice(0, m.index).trim() };
      }
    }
    // jsonfc 协议 JSON 兜底：非 jsonfc 模式下模型仍可能按协议输出 JSON（受历史/习惯影响）。
    // 识别出 tool_call 就执行，避免协议 JSON 被当作普通最终回复落盘，导致 ask_user 等工具永不执行（静默卡住）。
    if (content.includes("{")) {
      const parsed = parseJsonfc(content);
      if (parsed && parsed.tool_call && parsed.tool_call.name) {
        return {
          name: parsed.tool_call.name,
          args: parseJsonfcArgs(parsed.tool_call.arguments),
          thought: parsed.thought || "",
        };
      }
    }
    return null;
  }
}

// ======================================================================
// 工具函数
// ======================================================================

function contentOf(info: { thought: string; toolName: string }): string {
  return info.thought || `调用工具: ${info.toolName}`;
}

function displayText(content: string): string {
  const idx = content.indexOf("<||DSML||");
  if (idx >= 0) return content.slice(0, idx).trimEnd();
  return content;
}

function displayThink(content: string): string {
  const idx = content.indexOf("<||DSML||");
  if (idx >= 0) return content.slice(0, idx).trim();
  return content.trim();
}

/**
 * 扫描一段 JSON 对象文本，返回指定顶层键的"所有出现"值（按出现顺序）。
 * 模型有时会输出重复键的畸形 JSON（如两个 thought、两个 tool_call），
 * JSON.parse 只会保留最后一个键值对，导致真实的 tool_call 被 null 覆盖。
 * 这里手工扫描顶层键，逐个提取值，供调用方按"取第一个合法值"的策略处理。
 */
function topLevelFieldValues(json: string, key: string): unknown[] {
  const values: unknown[] = [];
  const n = json.length;
  let depth = 0;
  let i = 0;
  while (i < n) {
    const ch = json[i];
    if (ch === '"') {
      // 跳过完整字符串（含转义），若它处于顶层且紧跟冒号则视为键
      let j = i + 1;
      while (j < n) {
        if (json[j] === "\\") { j += 2; continue; }
        if (json[j] === '"') break;
        j++;
      }
      const token = json.slice(i + 1, j);
      let c = j + 1;
      while (c < n && (json[c] === " " || json[c] === "\t" || json[c] === "\n" || json[c] === "\r")) c++;
      if (depth === 1 && c < n && json[c] === ":" && token === key) {
        let v = c + 1;
        while (v < n && (json[v] === " " || json[v] === "\t" || json[v] === "\n" || json[v] === "\r")) v++;
        const vEnd = scanJsonValueEnd(json, v);
        if (vEnd > v) {
          try { values.push(JSON.parse(json.slice(v, vEnd))); } catch { /* 单值解析失败则跳过 */ }
        }
        i = vEnd;
        continue;
      }
      i = j + 1;
      continue;
    }
    if (ch === "{" || ch === "[") { depth++; i++; continue; }
    if (ch === "}" || ch === "]") { depth--; i++; continue; }
    i++;
  }
  return values;
}

/** 返回从位置 v 开始的 JSON 值的结束位置（含结束字符），无法识别时返回 v。 */
function scanJsonValueEnd(json: string, v: number): number {
  const n = json.length;
  const first = json[v];
  if (first === "{" || first === "[") {
    const close = first === "{" ? "}" : "]";
    let d = 0;
    let inStr = false;
    for (let i = v; i < n; i++) {
      const ch = json[i];
      if (inStr) {
        if (ch === "\\") { i++; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === first) d++;
      else if (ch === close) { d--; if (d === 0) return i + 1; }
    }
  } else if (first === '"') {
    for (let i = v + 1; i < n; i++) {
      const ch = json[i];
      if (ch === "\\") { i++; continue; }
      if (ch === '"') return i + 1;
    }
  } else {
    let i = v;
    while (i < n && !/[},\]\s]/.test(json[i])) i++;
    return i;
  }
  return v;
}

function parseJsonfc(content: string): { thought: string; tool_call: { name: string; arguments: unknown } | null; done: boolean } | null {
  if (!content) return null;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const json = content.slice(start, end + 1);

 // 取"第一个合法值"：thought 取首个非空字符串，tool_call 取首个带 name 的对象，done 取首个布尔
  // thought 容错：模型可能把 thought 误写成数字/布尔（如 {"thought": 0}），此时转字符串而非判定协议失败
  const thoughtRaw = topLevelFieldValues(json, "thought").find(
    (v): v is string | number | boolean => v !== null && v !== undefined && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
  );
  const thought = thoughtRaw === undefined ? "" : String(thoughtRaw).trim();
 const toolCallRaw = topLevelFieldValues(json, "tool_call").find(
    (v): v is { name?: string; arguments?: unknown } => !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as { name?: unknown }).name === "string"
  );
  const done = topLevelFieldValues(json, "done").find((v): v is boolean => typeof v === "boolean") ?? false;

  const tool_call = toolCallRaw ? { name: toolCallRaw.name ?? "", arguments: toolCallRaw.arguments ?? {} } : null;
  if (thought === "" && !tool_call) return null;
  if (tool_call && !tool_call.name) return null;
  return { thought, tool_call, done };
}

function stripJsonfc(content: string): string {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return content.slice(0, start) + content.slice(end + 1);
  }
  return content.trim();
}

function shouldDriveNext(text: string): boolean {
  if (!text) return false;
  return COMMITMENT_MARKS.some((mark) => text.includes(mark));
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes", "y", "是"].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function normalizeList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* 忽略 */
    }
    return s.split(",").map((x) => x.trim()).filter((x) => x);
  }
  return [String(value)];
}
