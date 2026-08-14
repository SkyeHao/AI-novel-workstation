"""ReAct Agent。

采用 Thought → Action → Observation 循环。
基于 OpenAI function calling 实现 Action 调用。
支持多轮对话：通过 run_turn 维持会话上下文，
直到 Agent 输出指定结束词（end_token）才标记整个任务完成。
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from loguru import logger

from ai_novel_workstation.agent.context import ContextManager
from ai_novel_workstation.llm.client import LLMClient
from ai_novel_workstation.llm.models import ChatMessage, Role
from ai_novel_workstation.tools.manager import ToolManager

# DSML 文本格式工具调用（部分模型不支持 OpenAI 结构化 function_call，
# 而是以 <||DSML||invoke name="...">...</||DSML||invoke> 文本形式输出工具调用）
_DSML_INVOKE_RE = re.compile(
    r'<\|\|DSML\|\|invoke name="([^"]+)"[^>]*>(.*?)</\|\|DSML\|\|invoke>', re.DOTALL
)
_DSML_PARAM_RE = re.compile(
    r'<\|\|DSML\|\|parameter name="([^"]+)"[^>]*>(.*?)</\|\|DSML\|\|parameter>', re.DOTALL
)
_DSML_NOISE = ("<||DSML||tool_calls>", "</||DSML||tool_calls>", "</||DSML||result>")


@dataclass
class AgentStep:
    """Agent 执行步骤。"""

    thought: str = ""
    tool_name: str = ""
    tool_args: dict = field(default_factory=dict)
    observation: str = ""
    is_final: bool = False

    def to_display(self) -> str:
        """转为前端展示文本。"""
        if self.is_final:
            return self.thought
        parts = []
        if self.thought:
            parts.append(f"💭 {self.thought}")
        if self.tool_name:
            args_str = json.dumps(self.tool_args, ensure_ascii=False)
            parts.append(f"🔧 调用工具: {self.tool_name}({args_str})")
        if self.observation:
            # 截断过长的观察结果
            obs = self.observation[:500]
            if len(self.observation) > 500:
                obs += "..."
            parts.append(f"👁️ 观察结果: {obs}")
        return "\n".join(parts)


@dataclass
class AgentTurnResult:
    """单轮对话执行结果。"""

    reply: str
    steps: list[AgentStep]
    is_done: bool = False
    token_count: int = 0


class ReActAgent:
    """ReAct Agent。

    通过 Thought → Action → Observation 循环与 LLM 交互，
    LLM 可以使用工具来完成任务。
    支持多轮对话：run_turn 维持消息历史，直到输出结束词。
    """

    def __init__(
        self,
        client: LLMClient,
        tool_manager: ToolManager,
        system_prompt: str,
        max_iterations: int = 10,
        temperature: float = 0.7,
        end_token: str = "",
        context_manager: ContextManager | None = None,
        on_llm_done: Callable[[dict], Awaitable[None]] | None = None,
        on_tool_done: Callable[[str, dict, str, bool], Awaitable[None]] | None = None,
        max_output_tokens: int | None = 8000,
        tool_call_mode: str = "native",
    ) -> None:
        self.client = client
        self.tool_manager = tool_manager
        self.system_prompt = system_prompt
        self.max_iterations = max_iterations
        self.temperature = temperature
        self.end_token = end_token
        self.context_manager = context_manager
        self.on_llm_done = on_llm_done
        self.on_tool_done = on_tool_done
        self.max_output_tokens = max_output_tokens
        # native: 原生 function_call；jsonfc: JSON {"function_call":{}} 约定；
        # dsml: DSML 文本格式；auto: 优先原生，回退 DSML
        valid_modes = ("native", "jsonfc", "dsml", "auto")
        self.tool_call_mode = tool_call_mode if tool_call_mode in valid_modes else "native"

        # 会话消息历史（首条为系统提示词）
        self.messages: list[ChatMessage] = [
            ChatMessage(role=Role.SYSTEM, content=self.system_prompt),
        ]

    def reset(self) -> None:
        """清空消息历史，回到初始状态。"""
        self.messages = [ChatMessage(role=Role.SYSTEM, content=self.system_prompt)]

    def restore_messages(self, messages: list[dict]) -> None:
        """从持久化数据恢复消息历史。"""
        self.messages = [ChatMessage(**m) for m in messages]

    def serialize_messages(self) -> list[dict]:
        """序列化消息历史（用于持久化）。"""
        return [m.to_dict() for m in self.messages]

    async def run(self, user_input: str) -> tuple[str, list[AgentStep]]:
        """单次任务运行（一次性，兼容旧接口）。

        Returns:
            (最终回复, 执行步骤列表)
        """
        self.reset()
        turn = await self.run_turn(user_input)
        return turn.reply, turn.steps

    async def run_turn(
        self,
        user_input: str,
        on_step: Callable[[AgentStep], Awaitable[None]] | None = None,
        on_stream: Callable[[str], Awaitable[None]] | None = None,
        on_thinking: Callable[[str], Awaitable[None]] | None = None,
    ) -> AgentTurnResult:
        """运行一轮对话（多轮）。

        - 将用户输入加入消息历史
        - 执行 Thought → Action → Observation 循环，直到 Agent 给出最终回答
        - 若最终回答包含结束词（end_token），标记整个任务完成
        - LLM 调用为流式，逐 token 通过 on_stream 推送（剥离 DSML 工具调用文本）
        - 思考过程（工具调用轮）通过 on_thinking 实时推送

        Args:
            user_input: 本轮用户输入
            on_step: 可选回调，每产生一个执行步骤（含最终回答）时异步调用
            on_stream: 可选回调，最终回答的流式文本片段
            on_thinking: 可选回调，思考过程的流式文本片段
        """
        self.messages.append(ChatMessage(role=Role.USER, content=user_input))
        steps: list[AgentStep] = []
        total_tokens = 0

        async def _emit(step: AgentStep) -> None:
            steps.append(step)
            if on_step:
                await on_step(step)

        async def _stream_llm() -> tuple[str, int, dict | None]:
            """流式调用 LLM，返回 (原始内容, token 数, 原生 function_call)。

            流式过程中将可展示文本实时推送：
            - native 模式：通过 on_delta 感知 function_call 到达；
              出现 fc 前的 content 是思考（on_thinking），fc 之后的 content（若有）继续思考；
              全程无 fc 则 content 是最终回答（on_stream）
            - dsml 模式：检测 <||DSML||invoke> 切分思考与回答
            - auto 模式：优先 native 判断，DSML 文本作兜底
            """
            functions = self.tool_manager.to_openai_functions()
            parts: list[str] = []
            displayed_stream = ""
            displayed_think = ""
            # native 模式下：是否已检测到 function_call 到达
            fc_arrived = False
            use_native = self.tool_call_mode in ("native", "auto")
            use_jsonfc = self.tool_call_mode == "jsonfc"

            def _on_delta(delta) -> None:
                nonlocal fc_arrived
                fc = getattr(delta, "function_call", None)
                if fc is not None:
                    fc_arrived = True

            async for piece in self.client.astream(
                messages=self.messages,
                temperature=self.temperature,
                functions=functions if use_native else None,
                function_call="auto" if functions and use_native else None,
                max_tokens=self.max_output_tokens,
                on_delta=_on_delta if use_native else None,
            ):
                parts.append(piece)
                content = "".join(parts)
                if use_jsonfc:
                    # jsonfc 模式：整个回复是 JSON 协议，不流式推送（thought 从 JSON 提取）
                    continue
                elif use_native:
                    # 原生模式：fc 到达后的 content 属思考；无 fc 属最终回答
                    is_thinking = fc_arrived
                else:
                    is_thinking = "<||DSML||invoke" in content
                if is_thinking:
                    clean = self._display_text(content)
                    if len(clean) > len(displayed_think):
                        delta_t = clean[len(displayed_think):]
                        displayed_think = clean
                        if on_thinking:
                            await on_thinking(delta_t)
                else:
                    clean = self._display_text(content)
                    if len(clean) > len(displayed_stream):
                        delta_t = clean[len(displayed_stream):]
                        displayed_stream = clean
                        if on_stream:
                            await on_stream(delta_t)

            last = self.client.get_last_interaction()
            used = last.total_tokens if last else 0
            fc = getattr(last, "response_function_call", None) if last else None
            # 每次 LLM 调用完成即通知（供持久化交互记录，避免中途中断丢失）
            if self.on_llm_done and last is not None:
                try:
                    await self.on_llm_done(last.to_dict())
                except Exception:
                    logger.exception("on_llm_done 回调失败")
            return "".join(parts), used, fc

        for iteration in range(self.max_iterations):
            logger.info(f"Agent 迭代 {iteration + 1}/{self.max_iterations}")

            # 上下文管理：保证请求 token 不超限
            if self.context_manager:
                self.messages = await self.context_manager.process(self.messages)

            # 调用 LLM（流式）
            try:
                content, used_tokens, native_fc = await _stream_llm()
            except Exception as e:
                logger.exception("Agent LLM 调用失败")
                step = AgentStep(thought=f"LLM 调用失败: {e}", is_final=True)
                await _emit(step)
                return AgentTurnResult(
                    reply=f"执行失败: {e}", steps=steps, is_done=False, token_count=total_tokens
                )

            total_tokens += used_tokens

            # jsonfc 模式：完整结构化协议（thought/tool_call/done）
            if self.tool_call_mode == "jsonfc":
                proto = self._parse_jsonfc_protocol(content)
                if proto is not None:
                    thought, tool_call, done = proto
                    if tool_call:
                        # 调用工具
                        tool_name = tool_call.get("name", "")
                        tool_args = tool_call.get("arguments", {}) or {}
                        if isinstance(tool_args, str):
                            try:
                                tool_args = json.loads(tool_args)
                            except json.JSONDecodeError:
                                tool_args = {}
                        if not isinstance(tool_args, dict):
                            tool_args = {}
                        step = AgentStep(thought=thought, tool_name=tool_name, tool_args=tool_args)

                        # 阻塞工具（ask_user）：执行前先推送思考，避免前端空白等待
                        if tool_name == "ask_user":
                            if on_thinking and thought:
                                await on_thinking(thought)
                            await _emit(step)

                        result = await self.tool_manager.execute(tool_name, **tool_args)
                        step.observation = result.output if result.success else f"错误: {result.error}"
                        if tool_name != "ask_user":
                            await _emit(step)

                        # 回填交互记录 + 持久化
                        last_interaction = self.client.get_last_interaction()
                        if last_interaction:
                            last_interaction.tool_name = tool_name
                            last_interaction.tool_args = tool_args
                            last_interaction.tool_result = step.observation
                            last_interaction.tool_success = result.success
                        if self.on_tool_done:
                            try:
                                await self.on_tool_done(tool_name, tool_args, step.observation, result.success)
                            except Exception:
                                logger.exception("on_tool_done 回调失败")

                        self.messages.append(ChatMessage(role=Role.ASSISTANT, content=content))
                        self.messages.append(
                            ChatMessage(
                                role=Role.USER,
                                content=f"【工具 {tool_name} 执行结果】\n{step.observation}",
                            )
                        )
                        logger.info(f"工具 {tool_name} 执行完成: success={result.success}")
                    elif done:
                        # 全部完成
                        clean = thought
                        self.messages.append(ChatMessage(role=Role.ASSISTANT, content=clean))
                        await _emit(AgentStep(thought=clean, is_final=True))
                        logger.info("Agent 完成本轮回复 (jsonfc done=true)")
                        return AgentTurnResult(
                            reply=clean,
                            steps=steps,
                            is_done=True,
                            token_count=total_tokens,
                        )
                    else:
                        # done=false 且无工具调用：协议要求继续
                        self.messages.append(ChatMessage(role=Role.ASSISTANT, content=content))
                        self.messages.append(
                            ChatMessage(
                                role=Role.USER,
                                content=(
                                    "你设置了 done=false 且未调用工具。请继续执行下一步动作"
                                    "（调用工具或推进工作）；完成全部工作后设 done=true。"
                                ),
                            )
                        )
                        logger.info("jsonfc done=false 无工具，继续驱动")
                        await _emit(AgentStep(thought=thought))
                        continue
                    continue

            # 解析工具调用：优先原生 function_call，其次 DSML 文本格式
            tool_call = self._extract_tool_call(native_fc, content, mode=self.tool_call_mode)

            if tool_call:
                # LLM 选择调用工具
                function_call, tool_content, tool_args, _is_dsml = tool_call
                tool_name = function_call["name"]

                # 记录思考步骤
                step = AgentStep(
                    thought=tool_content,
                    tool_name=tool_name,
                    tool_args=tool_args,
                )

                # 执行工具
                result = await self.tool_manager.execute(tool_name, **tool_args)
                step.observation = result.output if result.success else f"错误: {result.error}"

                await _emit(step)

                # 回填工具执行结果到最后一条交互记录
                last_interaction = self.client.get_last_interaction()
                if last_interaction:
                    last_interaction.tool_name = tool_name
                    last_interaction.tool_args = tool_args
                    last_interaction.tool_result = step.observation
                    last_interaction.tool_success = result.success

                # 通知工具执行完成（供持久化交互记录回填工具字段）
                if self.on_tool_done:
                    try:
                        await self.on_tool_done(tool_name, tool_args, step.observation, result.success)
                    except Exception:
                        logger.exception("on_tool_done 回调失败")

                # 将工具调用和结果加入消息历史
                # 注意：当前模型 API 不接受 role=function；tool 角色又要求 tool_calls
                # 配对且受 thinking 模式约束。故 assistant 保留调用文本（DSML），
                # 工具观察结果以 user 消息回填，与 DSML 文本调用协议配合。
                self.messages.append(
                    ChatMessage(role=Role.ASSISTANT, content=content)
                )
                self.messages.append(
                    ChatMessage(
                        role=Role.USER,
                        content=f"【工具 {tool_name} 执行结果】\n{step.observation}",
                    )
                )

                logger.info(f"工具 {tool_name} 执行完成: success={result.success}")

            else:
                # LLM 没有调用工具，给出最终回答（剥离残留的 DSML 标记）
                clean_content = self._strip_dsml(content)
                is_done = bool(self.end_token) and self.end_token in clean_content
                clean = clean_content.replace(self.end_token, "").strip() or clean_content.strip()

                # 若未完成（无结束词），且文本表明模型承诺了动作（调用工具/写文件等）
                # 但实际未执行 → 注入驱动消息，继续循环，避免卡在"说了不做"
                if not is_done and self._should_drive_next(clean):
                    self.messages.append(ChatMessage(role=Role.ASSISTANT, content=clean))
                    self.messages.append(
                        ChatMessage(
                            role=Role.USER,
                            content=(
                                "你刚才表示要继续执行动作（如搜索、写文件、整理设定），"
                                "但实际没有调用任何工具。请立即调用相应工具完成它；"
                                "若确实已完成全部工作，请在回复【最后一行】输出结束词。"
                            ),
                        )
                    )
                    logger.info("检测到承诺未执行，注入驱动消息继续")
                    await _emit(AgentStep(thought=clean))
                    continue

                self.messages.append(ChatMessage(role=Role.ASSISTANT, content=clean))
                await _emit(AgentStep(thought=clean, is_final=True))
                logger.info(f"Agent 完成本轮回复, is_done={is_done}")
                return AgentTurnResult(
                    reply=clean,
                    steps=steps,
                    is_done=is_done,
                    token_count=total_tokens,
                )

        # 超过最大迭代次数
        step = AgentStep(
            thought=f"已达到最大迭代次数 ({self.max_iterations})，强制停止。",
            is_final=True,
        )
        await _emit(step)
        return AgentTurnResult(
            reply="执行超时，请缩小问题范围或增加迭代次数。",
            steps=steps,
            is_done=False,
            token_count=total_tokens,
        )

    @staticmethod
    def _extract_function_call(fc: dict | None) -> dict | None:
        """从原生 function_call（dict）中提取工具调用。

        Args:
            fc: 形如 {"name": "...", "arguments": "..."} 的字典，或 None
        """
        if not fc or not isinstance(fc, dict):
            return None
        name = fc.get("name")
        if not name:
            return None
        return {"name": name, "arguments": fc.get("arguments") or "{}"}

    @classmethod
    def _extract_tool_call(
        cls, function_call: dict | None, content: str, mode: str = "native"
    ) -> tuple[dict, str, dict, bool] | None:
        """解析 LLM 响应中的工具调用。

        按 mode 解析：
        - native：仅原生 function_call
        - jsonfc：解析 {"function_call":{"name","arguments"}} JSON 约定
        - dsml：仅 DSML 文本格式
        - auto：优先原生，回退 DSML

        Returns:
            (function_call, 思考文本, 工具参数, 是否为 DSML 格式) 或 None
        """
        # 1. 原生 function_call（流式累积）
        if mode in ("native", "auto"):
            fc = cls._extract_function_call(function_call)
            if fc:
                try:
                    args = json.loads(fc.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                return fc, content, args, False

        # 2. jsonfc：解析 {"function_call":{...}} JSON 约定
        if mode == "jsonfc":
            parsed = cls._parse_jsonfc(content)
            if parsed:
                name, args = parsed
                fc = {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}
                # 思考文本：去掉 JSON 部分
                thought = cls._strip_jsonfc(content)
                return fc, thought, args, False

        # 3. DSML 文本格式（<||DSML||invoke name="X">...</||DSML||invoke>）
        if mode in ("dsml", "auto"):
            m = _DSML_INVOKE_RE.search(content)
            if m:
                name = m.group(1)
                block = m.group(2)
                args: dict[str, Any] = {}
                for p in _DSML_PARAM_RE.finditer(block):
                    args[p.group(1)] = p.group(2)
                thought = _DSML_INVOKE_RE.sub("", content).strip()
                function_call = {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}
                return function_call, thought, args, True

        return None

    @staticmethod
    def _parse_jsonfc_protocol(content: str) -> tuple[str, dict | None, bool] | None:
        """解析完整结构化协议 JSON：{"thought","tool_call","done"}。

        对模型输出的容错处理：
        - 标准 JSON 解析
        - 失败时用修复器修复未转义引号/尾逗号等问题
        - 仍失败时尝试仅提取 tool_call 子对象

        Returns:
            (thought, tool_call 或 None, done) 或 None（解析失败）
        """
        if not content or not content.strip():
            return None

        text = content.strip()
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return None
        body = text[start : end + 1]

        data = None
        for candidate in (body, ReActAgent._repair_json(body)):
            if candidate is None:
                continue
            try:
                data = json.loads(candidate)
                break
            except json.JSONDecodeError:
                continue

        # 仍失败：尝试仅提取 tool_call 子对象
        if data is None:
            tc_obj = ReActAgent._extract_tool_call_obj(body)
            if tc_obj is not None:
                return "", tc_obj, False

        if not isinstance(data, dict):
            return None
        thought = str(data.get("thought", ""))
        done = bool(data.get("done", False))
        tool_call = data.get("tool_call")
        if tool_call is None:
            return thought, None, done
        if not isinstance(tool_call, dict) or not tool_call.get("name"):
            return thought, None, done
        return thought, tool_call, done

    @staticmethod
    def _repair_json(body: str) -> str | None:
        """修复模型输出 JSON 的常见问题。

        处理：
        - 字符串值内部的未转义双引号（"躺平+隐世大佬" 这类）
        - 多余的逗号（,} / ,]）
        - 未转义的控制字符

        Returns:
            修复后的 JSON 字符串，或 None（无法修复）
        """
        if not body:
            return None
        # 先尝试清理多余逗号
        import re as _re

        cleaned = _re.sub(r",\s*([}\]])", r"\1", body)
        if cleaned != body:
            try:
                json.loads(cleaned)
                return cleaned
            except json.JSONDecodeError:
                pass

        # 修复字符串内部的未转义引号：
        # 扫描字符，跟踪是否在字符串内；字符串内的 " 若前后是内容字符（非结构位置）则转义
        out: list[str] = []
        in_str = False
        escaped = False
        i = 0
        n = len(cleaned)
        while i < n:
            ch = cleaned[i]
            if escaped:
                out.append(ch)
                escaped = False
                i += 1
                continue
            if ch == "\\":
                out.append(ch)
                escaped = True
                i += 1
                continue
            if ch == '"':
                if in_str:
                    # 字符串内的引号：检查前后字符判断是否为内容引号
                    prev = out[-1] if out else ""
                    nxt = cleaned[i + 1] if i + 1 < n else ""
                    # 结构边界：前是 , : [ { 或 后是 , ] } : 则为结构引号
                    is_struct_prev = prev in (",", ":", "[", "{") or prev == ""
                    is_struct_next = nxt in (",", "]", "}", ":") or nxt == ""
                    if is_struct_prev or is_struct_next:
                        # 字符串结束
                        in_str = False
                        out.append(ch)
                    else:
                        # 内容引号 → 转义
                        out.append("\\\"")
                else:
                    in_str = True
                    out.append(ch)
            else:
                out.append(ch)
            i += 1
        repaired = "".join(out)
        try:
            json.loads(repaired)
            return repaired
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _extract_tool_call_obj(body: str) -> dict | None:
        """在无法完整解析 JSON 时，尽力提取 tool_call 子对象。"""
        try:
            idx = body.find('"tool_call"')
            if idx < 0:
                return None
            # 找 tool_call 值起点（第一个 { 或 null）
            val_start = body.find("{", idx)
            if val_start < 0:
                return None
            # 括号匹配提取
            depth = 0
            i = val_start
            n = len(body)
            in_str = False
            escaped = False
            while i < n:
                ch = body[i]
                if escaped:
                    escaped = False
                    i += 1
                    continue
                if ch == "\\":
                    escaped = True
                    i += 1
                    continue
                if ch == '"':
                    in_str = not in_str
                elif not in_str:
                    if ch == "{":
                        depth += 1
                    elif ch == "}":
                        depth -= 1
                        if depth == 0:
                            sub = body[val_start : i + 1]
                            for cand in (sub, ReActAgent._repair_json(sub)):
                                if cand is None:
                                    continue
                                try:
                                    obj = json.loads(cand)
                                    if isinstance(obj, dict) and obj.get("name"):
                                        return obj
                                except json.JSONDecodeError:
                                    continue
                            return None
                i += 1
        except Exception:
            return None
        return None

    @staticmethod
    def _should_drive_next(text: str) -> bool:
        """判断文本是否表明模型承诺了动作但未实际执行。

        当模型明确表示要去搜索/写文件/生成文档等，但本轮没调用工具也没结束，
        需要继续驱动它真正执行，避免卡在"说了不做"的中间态。
        """
        if not text:
            return False
        # 明确的"执行动作"承诺标记（避免误伤正常对话回复）
        commitment_marks = (
            "我去搜索", "我先搜索", "我来搜索", "让我搜索", "我将搜索", "我要搜索",
            "我去查找", "我先查找", "我来查找", "让我查找",
            "我去查", "我先查", "我来查", "让我查",
            "我去写", "我先写", "我来写", "让我写", "我将写", "我要写",
            "写入文件", "保存文档", "生成文档", "创建文件", "写入文件",
            "我先整理", "我来整理", "让我整理",
            "我去创建", "我来创建", "让我创建",
            "我把", "我先把",
        )
        return any(mark in text for mark in commitment_marks)

    @staticmethod
    def _parse_jsonfc(content: str) -> tuple[str, dict] | None:
        """从输出中解析 {"function_call":{"name","arguments"}} JSON。"""
        if not content:
            return None
        # 提取 JSON 对象（可能被 ```json 包裹或夹杂其他文本）
        try:
            # 找 { 到最后一个 }
            start, end = content.find("{"), content.rfind("}")
            if start < 0 or end <= start:
                return None
            data = json.loads(content[start : end + 1])
        except json.JSONDecodeError:
            return None
        fc = data.get("function_call")
        if not fc or not isinstance(fc, dict):
            return None
        name = fc.get("name")
        if not name:
            return None
        args = fc.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {}
        if not isinstance(args, dict):
            args = {}
        return name, args

    @classmethod
    def _strip_jsonfc(cls, content: str) -> str:
        """去掉 content 中的 JSON function_call 部分，保留思考文本。"""
        start, end = content.find("{"), content.rfind("}")
        if start >= 0 and end > start:
            return (content[:start] + content[end + 1:]).strip()
        return content.strip()

    @classmethod
    def _strip_dsml(cls, text: str) -> str:
        """剥离文本中残留的 DSML 工具调用标记。"""
        text = _DSML_INVOKE_RE.sub("", text)
        for noise in _DSML_NOISE:
            text = text.replace(noise, "")
        return text.strip()

    @classmethod
    def _display_text(cls, content: str) -> str:
        """流式展示文本：从第一个 DSML 标记处截断（工具调用部分不展示）。"""
        idx = content.find("<||DSML||")
        if idx >= 0:
            return content[:idx].rstrip()
        return content
