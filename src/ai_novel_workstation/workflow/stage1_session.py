"""阶段1：多轮对话式创意会话。

支持作者与 Agent 进行多轮对话共创：
- 每轮使用 ReAct 循环处理（思考-行动-观察）
- 直到 Agent 输出结束词（STAGE1_END_TOKEN）才会话完成
- 上下文由 ContextManager 管理，避免超过模型窗口限制
- 会话可持久化到磁盘（data/sessions/*.json），服务重启后可恢复
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from loguru import logger

from ai_novel_workstation.agent.context import ContextManager
from ai_novel_workstation.agent.react import ReActAgent
from ai_novel_workstation.llm.client import LLMClient
from ai_novel_workstation.llm.interaction_logger import InteractionLogger
from ai_novel_workstation.llm.models import ChatMessage
from ai_novel_workstation.tools.ask_user import AskUserTool
from ai_novel_workstation.tools.file_read import FileReadTool
from ai_novel_workstation.tools.file_write import FileWriteTool
from ai_novel_workstation.tools.manager import ToolManager
from ai_novel_workstation.tools.web_search import WebSearchTool
from ai_novel_workstation.workflow.prompts import (
    STAGE1_CHAT_SYSTEM_PROMPT,
    STAGE1_END_TOKEN,
    TOOL_FORMAT_DSML,
    TOOL_FORMAT_JSONFC,
    TOOL_FORMAT_NATIVE,
    VISION_DOC_GUIDE,
    VISION_DOC_STRUCTURE,
)

_VISION_DOC_STRUCTURE_TEXT = VISION_DOC_STRUCTURE

# 会话持久化目录（stage1_session.py → workflow → ai_novel_workstation → src → 项目根）
_SESSIONS_DIR = Path(__file__).resolve().parents[3] / "data" / "sessions"


@dataclass
class Stage1TurnResult:
    """单轮对话结果。"""

    reply: str = ""
    is_done: bool = False
    steps: list[dict] = field(default_factory=list)
    interactions: list[dict] = field(default_factory=list)
    success: bool = False
    project_path: str = ""
    vision_doc_path: str = ""
    error: str = ""

    def to_dict(self) -> dict:
        return {
            "reply": self.reply,
            "is_done": self.is_done,
            "steps": self.steps,
            "interactions": self.interactions,
            "success": self.success,
            "project_path": self.project_path,
            "vision_doc_path": self.vision_doc_path,
            "error": self.error,
        }


class Stage1Session:
    """阶段1 多轮对话会话。"""

    def __init__(
        self,
        session_id: str,
        client: LLMClient,
        project_name: str = "",
        genre: str = "",
        platform: str = "",
        target_words: str = "",
        max_iterations: int = 10,
        temperature: float = 0.8,
        context_window: int | None = None,
        project_id: str = "",
        tool_call_mode: str = "jsonfc",
    ) -> None:
        self.session_id = session_id
        self.created_at = datetime.now().isoformat(timespec="seconds")
        self.updated_at = self.created_at
        self.project_name = project_name
        self.project_id = project_id or project_name
        self.genre = genre
        self.platform = platform
        self.target_words = target_words
        self.done = False
        self.max_iterations = max_iterations
        self.tool_call_mode = tool_call_mode

        # 向作者提问机制
        self._on_ask: Callable[[dict], Awaitable[None]] | None = None
        self._pending_answer: asyncio.Future | None = None
        self._ask_timeout = 600  # 秒，等待用户回答超时

        # 当前轮次 ID（交互记录分组用）
        self._turn_id: str = ""
        # 本轮已持久化的交互（用于 turn 结束时补全 user_message）
        self._persisted_ids: list[str] = []
        # 本轮持久化交互的记录 id 顺序（供工具结果回填）
        self._interaction_record_ids: list[str] = []

        # 创建工具管理器
        self._tool_manager = self._create_tool_manager(project_id=self.project_id)
        self._register_ask_tool()

        # 用带 logger 的 client 记录交互
        self._interaction_logger = InteractionLogger()
        self._client = LLMClient(client.config, interaction_logger=self._interaction_logger)

        # 上下文管理器
        self._context_manager = ContextManager(self._client, context_window=context_window)

        # 构建系统提示词
        system_prompt = self._build_system_prompt()

        # 创建 ReAct Agent
        self._agent = ReActAgent(
            client=self._client,
            tool_manager=self._tool_manager,
            system_prompt=system_prompt,
            max_iterations=max_iterations,
            temperature=temperature,
            end_token=STAGE1_END_TOKEN,
            context_manager=self._context_manager,
            on_llm_done=self._persist_interaction,
            on_tool_done=self._update_interaction_tool,
            tool_call_mode=self.tool_call_mode,
        )

    # ------------------------------------------------------------------
    # 工具与路径
    # ------------------------------------------------------------------

    def _build_system_prompt(self) -> str:
        """构建系统提示词（注入项目已确认信息 + 工具调用格式）。"""
        if self.tool_call_mode == "dsml":
            tool_format = TOOL_FORMAT_DSML
        elif self.tool_call_mode == "native":
            tool_format = TOOL_FORMAT_NATIVE
        else:
            tool_format = TOOL_FORMAT_JSONFC
        return STAGE1_CHAT_SYSTEM_PROMPT.format(
            tools=self._tool_manager.to_prompt(),
            end_token=STAGE1_END_TOKEN,
            project_name=self.project_name or "待定",
            genre=self.genre or "（未填写）",
            platform=self.platform or "（未填写）",
            target_words=self.target_words or "（未填写）",
            tool_format=tool_format,
            vision_doc_guide=VISION_DOC_GUIDE.format(
                VISION_DOC_STRUCTURE=(
                    "```\n" + _VISION_DOC_STRUCTURE_TEXT + "\n```"
                )
            ),
        )

    @staticmethod
    def _create_tool_manager(project_id: str = "") -> ToolManager:
        tm = ToolManager()
        read_tool = FileReadTool()
        write_tool = FileWriteTool()

        # 项目作用域：将文件工具绑定到项目沙箱根
        if project_id:
            from ai_novel_workstation.storage.project_store import get_project_store

            try:
                base = get_project_store().project_root(project_id)
                read_tool.base_dir = base
                write_tool.base_dir = base
            except Exception:
                pass

        tm.register(read_tool)
        tm.register(write_tool)
        tm.register(WebSearchTool())
        return tm

    def _register_ask_tool(self) -> None:
        """注册向作者提问工具（绑定到会话的等待机制）。"""
        self._tool_manager.register(AskUserTool(self._ask_user))

    def _get_projects_base(self) -> Path:
        from ai_novel_workstation.api.state import get_project_dir_path

        return get_project_dir_path()

    @property
    def project_path(self) -> Path:
        from ai_novel_workstation.storage.project_store import get_project_store

        try:
            return get_project_store().project_root(self.project_id)
        except Exception:
            return self._get_projects_base() / (self.project_name or "待定")

    @property
    def vision_doc_path(self) -> Path:
        return self.project_path / "故事愿景文档.md"

    # ------------------------------------------------------------------
    # 会话信息
    # ------------------------------------------------------------------

    @property
    def info(self) -> dict:
        return {
            "session_id": self.session_id,
            "project_id": self.project_id,
            "project_name": self.project_name,
            "genre": self.genre,
            "platform": self.platform,
            "target_words": self.target_words,
            "done": self.done,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "message_count": len(self._agent.messages) - 1,  # 去掉系统提示词
            "project_path": str(self.project_path),
            "vision_doc_path": str(self.vision_doc_path),
            "vision_doc_exists": self.vision_doc_path.exists(),
        }

    # ------------------------------------------------------------------
    # 多轮对话
    # ------------------------------------------------------------------

    async def send_message(
        self,
        user_input: str,
        step_callback: Callable[[dict], Awaitable[None]] | None = None,
        stream_callback: Callable[[str], Awaitable[None]] | None = None,
        thinking_callback: Callable[[str], Awaitable[None]] | None = None,
        on_ask: Callable[[dict], Awaitable[None]] | None = None,
    ) -> Stage1TurnResult:
        """发送一轮用户消息，运行 ReAct 循环，直到 Agent 给出最终回复。

        Args:
            user_input: 用户消息
            step_callback: 可选回调，每产生一个执行步骤时以序列化 dict 调用
            stream_callback: 可选回调，Agent 最终回答的流式文本片段实时回调
            thinking_callback: 可选回调，Agent 思考过程的流式文本片段实时回调
            on_ask: 可选回调，Agent 需要作者选择时以 dict 调用（含 question/options/multiple/allow_custom）
        """
        self._on_ask = on_ask or self._on_ask

        if self.done:
            return Stage1TurnResult(
                reply="会话已完成，请新建会话继续。",
                is_done=True,
                error="会话已结束",
            )

        user_input = user_input.strip()
        if not user_input:
            return Stage1TurnResult(reply="请输入内容。", error="空输入")

        # 本轮交互记录分组
        self._turn_id = str(uuid.uuid4())
        self._persisted_ids = []
        self._interaction_record_ids = []
        self._turn_user_message = user_input

        # 若未指定项目名，从第一条消息中提取
        if not self.project_name:
            self.project_name = self._extract_project_name(user_input)
            # 更新系统提示词中的项目名（重建 Agent 会丢失历史，改为替换 system 文本）
            self._update_system_project_name()

        start_idx = len(self._interaction_logger.get_all())

        # 全局步骤序号（跨多轮/多次调用递增）
        step_counter = 0

        # 将 AgentStep 序列化后转发给 step_callback（步骤序号全局递增）
        async def _step_hook(step) -> None:
            nonlocal step_counter
            if step_callback:
                step_counter += 1
                await step_callback(self._serialize_step(step, step_counter))

        try:
            turn = await self._agent.run_turn(
                user_input,
                on_step=_step_hook,
                on_stream=stream_callback,
                on_thinking=thinking_callback,
            )
        except Exception as e:
            logger.exception("会话消息处理失败")
            return Stage1TurnResult(
                reply=f"处理失败: {e}",
                error=str(e),
            )

        self.done = turn.is_done
        self.updated_at = datetime.now().isoformat(timespec="seconds")

        # 本轮产生的交互记录
        interactions = self._interaction_logger.to_list()[start_idx:]

        return Stage1TurnResult(
            reply=turn.reply,
            is_done=turn.is_done,
            steps=self._serialize_steps(turn.steps),
            interactions=interactions,
            success=self.vision_doc_path.exists(),
            project_path=str(self.project_path) if self.project_path.exists() else "",
            vision_doc_path=str(self.vision_doc_path) if self.vision_doc_path.exists() else "",
            error="",
        )

    # ------------------------------------------------------------------
    # 向作者提问（ask_user 工具）
    # ------------------------------------------------------------------

    async def _ask_user(
        self,
        question: str,
        options: list[str],
        multiple: bool,
        allow_custom: bool,
    ) -> str:
        """ask_user 工具内部调用：通知前端并等待用户回答。"""
        if self._on_ask:
            await self._on_ask(
                {
                    "question": question,
                    "options": options,
                    "multiple": multiple,
                    "allow_custom": allow_custom,
                }
            )

        loop = asyncio.get_running_loop()
        self._pending_answer = loop.create_future()
        try:
            answer = await asyncio.wait_for(
                asyncio.shield(self._pending_answer), timeout=self._ask_timeout
            )
        except TimeoutError:
            return "（用户未在超时时间内回答，已跳过）"
        finally:
            self._pending_answer = None
        return str(answer or "")

    def submit_answer(self, answer: str) -> bool:
        """提交用户回答（由 answer 接口调用）。

        Returns:
            True 表示已交付给等待中的 Agent
        """
        if self._pending_answer is None or self._pending_answer.done():
            return False
        self._pending_answer.set_result(answer)
        return True

    def _update_system_project_name(self) -> None:
        """项目名确定后，更新系统提示词中的占位项目名。"""
        if not self._agent.messages:
            return
        system = self._agent.messages[0]
        system.content = self._build_system_prompt()

    @staticmethod
    def _serialize_step(step, step_index: int) -> dict:
        """将单个 AgentStep 序列化为前端展示格式（指定全局序号）。"""
        return {
            "step_index": step_index,
            "thought": step.thought,
            "tool_name": step.tool_name,
            "tool_args": json.dumps(step.tool_args, ensure_ascii=False),
            "observation": step.observation,
            "is_final": step.is_final,
        }

    @staticmethod
    def _serialize_steps(steps) -> list[dict]:
        """将 AgentStep 序列化为前端展示格式（局部序号，兼容旧接口）。"""
        out: list[dict] = []
        for i, step in enumerate(steps, 1):
            out.append(Stage1Session._serialize_step(step, i))
        return out

    @staticmethod
    def _extract_project_name(user_input: str) -> str:
        """从用户输入中提取项目名称。"""
        cleaned = re.sub(r"[^\w\u4e00-\u9fff]", "", user_input)
        if len(cleaned) >= 4:
            return cleaned[:6]
        return cleaned or "new_project"

    # ------------------------------------------------------------------
    # 交互记录持久化（每次 LLM 调用完成即落库，避免中断丢失）
    # ------------------------------------------------------------------

    async def _persist_interaction(self, interaction: dict) -> None:
        """持久化单条 LLM 交互记录（每次调用完成时触发）。"""
        try:
            from ai_novel_workstation.storage.interaction_store import save_interaction

            rid = save_interaction(
                source="stage1",
                interaction=interaction,
                task_type="stage1",
                session_id=self.session_id,
                turn_id=self._turn_id,
                user_message=getattr(self, "_turn_user_message", ""),
            )
            self._persisted_ids.append(rid)
            # 记住该交互对应的记录 id，供工具回填
            self._interaction_record_ids.append(rid)
        except Exception as e:
            logger.warning(f"持久化交互记录失败: {e}")

    async def _update_interaction_tool(self, tool_name: str, tool_args: dict, tool_result: str, tool_success: bool) -> None:
        """将工具执行结果回填到最近一条已持久化的交互记录。"""
        if not self._interaction_record_ids:
            return
        try:
            from ai_novel_workstation.storage.interaction_store import update_interaction_tool

            rid = self._interaction_record_ids[-1]
            update_interaction_tool(rid, tool_name, tool_args, tool_result, tool_success)
        except Exception as e:
            logger.warning(f"回填工具结果到交互记录失败: {e}")

    # ------------------------------------------------------------------
    # 持久化
    # ------------------------------------------------------------------

    def to_snapshot(self) -> dict:
        """序列化为可持久化的快照。"""
        return {
            "session_id": self.session_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "project_id": self.project_id,
            "project_name": self.project_name,
            "genre": self.genre,
            "platform": self.platform,
            "target_words": self.target_words,
            "done": self.done,
            "messages": self._agent.serialize_messages(),
        }

    def restore(self, snapshot: dict) -> None:
        """从快照恢复会话状态。"""
        self.created_at = snapshot.get("created_at", self.created_at)
        self.updated_at = snapshot.get("updated_at", self.updated_at)
        self.project_id = snapshot.get("project_id", self.project_id)
        self.project_name = snapshot.get("project_name", "")
        self.genre = snapshot.get("genre", "")
        self.platform = snapshot.get("platform", "")
        self.target_words = snapshot.get("target_words", "")
        self.done = snapshot.get("done", False)
        messages = snapshot.get("messages") or []
        if messages:
            # 用快照中的系统提示词替换当前系统提示词
            self._agent.messages = [ChatMessage(**m) for m in messages]
            self._update_system_project_name()

    async def close(self) -> None:
        """释放资源。"""
        try:
            await self._client.aclose()
        except Exception as e:
            logger.warning(f"关闭会话客户端失败: {e}")


class Stage1SessionStore:
    """会话存储（内存 + 磁盘持久化）。"""

    def __init__(self) -> None:
        self._sessions: dict[str, Stage1Session] = {}
        _SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

    def create(self, client: LLMClient, **kwargs) -> Stage1Session:
        """创建并保存一个新会话。"""
        session = Stage1Session(session_id=str(uuid.uuid4()), client=client, **kwargs)
        self._sessions[session.session_id] = session
        self._save(session)
        logger.info(f"创建会话: {session.session_id}")
        return session

    def get(self, session_id: str) -> Stage1Session | None:
        """获取会话；内存中没有时尝试从磁盘恢复。"""
        session = self._sessions.get(session_id)
        if session is not None:
            return session

        snapshot = self._load(session_id)
        if not snapshot:
            return None

        # 从磁盘恢复需要一个新的 client
        from ai_novel_workstation.api import state

        try:
            client = state.get_client_for_task("text")
        except Exception as e:
            logger.error(f"恢复会话时创建 client 失败: {e}")
            return None

        session = Stage1Session(
            session_id=session_id,
            client=client,
            project_id=snapshot.get("project_id", ""),
            project_name=snapshot.get("project_name", ""),
            genre=snapshot.get("genre", ""),
            platform=snapshot.get("platform", ""),
            target_words=snapshot.get("target_words", ""),
        )
        session.restore(snapshot)
        self._sessions[session_id] = session
        logger.info(f"从磁盘恢复会话: {session_id}")
        return session

    async def delete(self, session_id: str) -> None:
        """删除会话（内存 + 磁盘）。"""
        session = self._sessions.pop(session_id, None)
        if session:
            await session.close()
        snapshot_path = self._snapshot_path(session_id)
        if snapshot_path.exists():
            snapshot_path.unlink()
        logger.info(f"删除会话: {session_id}")

    async def close_all(self) -> None:
        """关闭所有会话客户端（应用退出时调用）。"""
        for session in list(self._sessions.values()):
            await session.close()

    def save(self, session: Stage1Session) -> None:
        """持久化会话到磁盘。"""
        self._save(session)

    # ------------------------------------------------------------------

    def _snapshot_path(self, session_id: str) -> Path:
        return _SESSIONS_DIR / f"{session_id}.json"

    def _save(self, session: Stage1Session) -> None:
        try:
            self._snapshot_path(session.session_id).write_text(
                json.dumps(session.to_snapshot(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning(f"会话持久化失败: {e}")

    def _load(self, session_id: str) -> dict | None:
        path = self._snapshot_path(session_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning(f"读取会话快照失败: {e}")
            return None

    def list_by_project(self, project_id: str, project_name: str = "") -> list[dict]:
        """列出某项目下的全部会话快照（按更新时间倒序）。

        匹配规则：snapshot.project_id == project_id，
        或（无 project_id 的历史会话）snapshot.project_name 与 project_name 匹配。

        Args:
            project_id: 项目 ID（目录名）
            project_name: 项目名（兼容无 project_id 的历史快照）

        Returns:
            按 updated_at 倒序的快照列表
        """
        if not project_id and not project_name:
            return []
        snapshots: list[dict] = []
        if _SESSIONS_DIR.exists():
            for path in _SESSIONS_DIR.glob("*.json"):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if data.get("project_id") == project_id:
                    snapshots.append(data)
                elif not data.get("project_id") and project_name and data.get("project_name") == project_name:
                    snapshots.append(data)
        snapshots.sort(key=lambda s: s.get("updated_at", ""), reverse=True)
        return snapshots

    def get_messages(self, session_id: str) -> list[dict] | None:
        """获取会话的消息历史（用于前端恢复展示）。"""
        snapshot = self._load(session_id)
        if not snapshot:
            return None
        return snapshot.get("messages") or []


_store: Stage1SessionStore | None = None


def get_session_store() -> Stage1SessionStore:
    """获取全局会话存储单例。"""
    global _store
    if _store is None:
        _store = Stage1SessionStore()
    return _store
