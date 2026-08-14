"""多轮对话上下文管理。

在长对话中控制发送给 LLM 的消息总 token 数，避免超过模型的上下文窗口。
采用分层策略：

1. **预算模型（Budget）**
   - 请求预算 = 上下文窗口(context_window) - 预留输出空间(reserved_output_tokens)
   - 预留空间保证模型每次回复都有足够的生成 token，避免"因提示词过长导致无法作答"

2. **单条消息裁剪（Per-message truncation）**
   - 工具观察结果（function 消息）可能非常长（搜索结果、文档内容），单独设上限 max_observation_tokens
   - 其余消息（system/user/assistant）上限 max_message_tokens
   - 超出上限按字符比例截断，保留前缀并追加省略标记

3. **滑动窗口（Sliding window）**
   - 总 token 仍超出预算时，从最旧的消息开始丢弃
   - 以"完整块"为单位丢弃，保证 OpenAI function calling 消息配对完整：
     - user 消息独立成块
     - assistant(function_call) 消息与其后续的 function 结果成块
   - 始终保留系统提示词和最新消息，保证对话连贯性

4. **摘要压缩（Summary compression，可选，默认开启）**
   - 被丢弃的旧消息由 LLM 压缩成简短要点，注入系统提示词
   - 保留作者的原始需求、已确认的决策、已完成的动作等关键信息，避免信息丢失
   - 摘要失败不影响主流程（降级为静默丢弃）

可调参数均支持通过环境变量覆盖：
- MODEL_CONTEXT_WINDOW: 模型上下文窗口（默认 32768）
- MODEL_RESERVED_OUTPUT_TOKENS: 预留输出 token（默认 2048）
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from loguru import logger

from ai_novel_workstation.llm.models import ChatMessage, Role

if TYPE_CHECKING:
    from ai_novel_workstation.llm.client import LLMClient


class ContextManager:
    """多轮对话上下文管理器。"""

    def __init__(
        self,
        client: LLMClient,
        context_window: int | None = None,
        reserved_output_tokens: int | None = None,
        max_message_tokens: int = 3000,
        max_observation_tokens: int = 1500,
        enable_summary: bool = True,
    ) -> None:
        """初始化上下文管理器。

        Args:
            client: LLM Client（用于 token 估算与摘要生成）
            context_window: 模型上下文窗口（token），默认取环境变量 MODEL_CONTEXT_WINDOW，否则 32768
            reserved_output_tokens: 为模型回复预留的输出 token，默认取环境变量 MODEL_RESERVED_OUTPUT_TOKENS，否则 2048
            max_message_tokens: 单条非 function 消息的 token 上限
            max_observation_tokens: 单条 function（工具观察结果）消息的 token 上限
            enable_summary: 是否启用摘要压缩
        """
        self._client = client
        self.context_window = context_window or int(os.getenv("MODEL_CONTEXT_WINDOW", "32768"))
        self.reserved_output_tokens = reserved_output_tokens or int(
            os.getenv("MODEL_RESERVED_OUTPUT_TOKENS", "2048")
        )
        self.max_message_tokens = max_message_tokens
        self.max_observation_tokens = max_observation_tokens
        self.enable_summary = enable_summary

        self._summary_header = "\n\n## 【历史对话摘要（旧消息已压缩）】\n"

    @property
    def budget(self) -> int:
        """请求可用预算（token）。"""
        return max(self.context_window - self.reserved_output_tokens, 512)

    def estimate(self, messages: list[ChatMessage]) -> int:
        """估算消息列表的 token 数。"""
        try:
            return self._client.count_tokens(messages)
        except Exception as e:
            logger.warning(f"Token 估算失败，回退为 0: {e}")
            return 0

    def trim(self, messages: list[ChatMessage]) -> tuple[list[ChatMessage], list[ChatMessage]]:
        """裁剪消息列表。

        Returns:
            (保留的消息, 被丢弃的消息)
        """
        kept = list(messages)

        # 1. 单条消息裁剪
        for msg in kept:
            self._truncate_message(msg)

        # 2. 估算总量
        total = self.estimate(kept)
        if total <= self.budget:
            return kept, []

        # 3. 滑动窗口：从最旧开始，按"完整块"丢弃
        dropped: list[ChatMessage] = []
        i = 1  # 始终保留索引 0 的系统提示词
        while total > self.budget and i < len(kept):
            msg = kept[i]
            dropped.append(msg)
            # estimate([m]) 含结尾 +2 开销，但列表整体只计一次结尾，故减 (estimate([m]) - 2)
            total -= (self.estimate([msg]) - 2)
            i += 1

            # assistant(function_call) 消息与其后续 function 结果成块
            if msg.function_call:
                while i < len(kept) and kept[i].role == Role.FUNCTION:
                    dropped.append(kept[i])
                    total -= (self.estimate([kept[i]]) - 2)
                    i += 1

            # 跳过游离的 function 消息（保持消息配对完整）
            while i < len(kept) and kept[i].role == Role.FUNCTION:
                dropped.append(kept[i])
                total -= (self.estimate([kept[i]]) - 2)
                i += 1

        kept = [kept[0]] + kept[i:]
        logger.info(
            f"上下文裁剪: 丢弃 {len(dropped)} 条消息, 剩余 {len(kept)} 条, 约 {max(total, 0)} tokens"
        )
        return kept, dropped

    async def process(self, messages: list[ChatMessage]) -> list[ChatMessage]:
        """裁剪并（可选）注入摘要，返回最终发送给 LLM 的消息列表。

        同时会更新传入消息列表的引用内容（在 trim 时已原地截断超长消息）。
        """
        kept, dropped = self.trim(messages)

        if dropped and self.enable_summary:
            summary = await self._summarize(dropped)
            if summary:
                self._inject_summary(kept[0], summary)
            # 摘要注入后系统提示词略有增长，若仍超预算则重新裁剪一次（不再摘要）
            if self.estimate(kept) > self.budget:
                kept, _ = self.trim(kept)

        return kept

    # ------------------------------------------------------------------
    # 内部方法
    # ------------------------------------------------------------------

    def _truncate_message(self, msg: ChatMessage) -> None:
        """裁剪单条超长消息（原地修改）。"""
        if not msg.content:
            return
        limit = self.max_observation_tokens if msg.role == Role.FUNCTION else self.max_message_tokens
        try:
            tokens = self._client.count_text_tokens(msg.content)
        except Exception:
            return
        if tokens <= limit:
            return
        # 按字符比例截断，保留前缀
        ratio = limit / max(tokens, 1)
        max_chars = max(int(len(msg.content) * ratio), 200)
        msg.content = msg.content[:max_chars] + "\n...[已截断]"

    def _inject_summary(self, system_msg: ChatMessage, summary: str) -> None:
        """将摘要注入系统提示词（幂等：重复调用会替换旧摘要）。"""
        if self._summary_header in system_msg.content:
            base = system_msg.content.split(self._summary_header)[0]
        else:
            base = system_msg.content
        system_msg.content = base + self._summary_header + summary

    async def _summarize(self, dropped: list[ChatMessage]) -> str:
        """将被丢弃的旧消息压缩成要点摘要。失败时返回空字符串。"""
        try:
            serialized = "\n".join(
                f"[{m.role.value}] {m.content[:800]}" for m in dropped if m.content
            )
            if not serialized:
                return ""

            from ai_novel_workstation.llm.models import ChatMessage as _CM
            from ai_novel_workstation.llm.models import Role as _Role

            messages = [
                _CM(
                    role=_Role.SYSTEM,
                    content=(
                        "你是一个对话压缩器。下面是一段从创作会话历史中裁剪掉的旧对话"
                        "（可能包含作者的需求、助手的回复和工具执行结果）。"
                        "请提炼出对后续创作仍然关键的信息，压缩成 3-5 条要点，中文输出，"
                        "只输出要点列表本身。要点包括："
                        "1) 作者的核心需求与约束；2) 已确认的决策（题材/平台/字数等）；"
                        "3) 已完成的关键动作（如已写入的文件）；4) 待办事项。"
                    ),
                ),
                _CM(role=_Role.USER, content=f"历史对话：\n{serialized}\n\n要点："),
            ]
            response = await self._client.achat(
                messages=messages,
                temperature=0.2,
                max_tokens=800,
            )
            summary = response.content.strip()
            # 限制摘要长度，防止挤占预算
            if self._client.count_text_tokens(summary) > 600:
                summary = summary[:2000] + "\n...[摘要已截断]"
            return summary
        except Exception as e:
            logger.warning(f"历史对话摘要生成失败（不影响主流程）: {e}")
            return ""
