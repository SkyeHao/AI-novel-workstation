"""阶段1 多轮对话会话 单元测试。

使用 mock LLM 响应，不依赖真实 API，也不写真实文件。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from ai_novel_workstation.config.settings import LLMModelConfig
from ai_novel_workstation.llm.models import ChatResponse, TokenUsage
from ai_novel_workstation.tools.ask_user import AskUserTool
from ai_novel_workstation.tools.base import BaseTool, ToolParameter, ToolResult
from ai_novel_workstation.tools.manager import ToolManager
from ai_novel_workstation.workflow.stage1_session import Stage1Session, Stage1SessionStore


class EchoTool(BaseTool):
    """测试用假工具。"""

    @property
    def name(self) -> str:
        return "echo"

    @property
    def description(self) -> str:
        return "回显文本"

    @property
    def parameters(self) -> list[ToolParameter]:
        return [ToolParameter(name="text", type="string", description="文本")]

    async def execute(self, text: str, **kwargs) -> ToolResult:
        return ToolResult(success=True, output=f"echo:{text}")


class FakeSourceClient:
    """仅提供 config，供 Stage1Session 内部创建 LLMClient 使用。"""

    def __init__(self) -> None:
        self.config = LLMModelConfig(
            api_key="sk-test",
            base_url="https://api.openai.com/v1",
            model="gpt-4o",
        )


def _resp(content: str) -> ChatResponse:
    return ChatResponse(
        content=content,
        model="gpt-4o",
        usage=TokenUsage(prompt_tokens=5, completion_tokens=5, total_tokens=10),
        finish_reason="stop",
    )


def _make_astream(responses: list[ChatResponse]):
    """构造模拟流式输出的 async generator。"""

    async def fake_astream(messages, **kwargs):
        resp = responses.pop(0)
        content = resp.content or ""
        step = max(1, len(content) // 3)
        for i in range(0, len(content), step):
            yield content[i : i + step]

    return fake_astream


def _make_session(responses: list[ChatResponse]) -> Stage1Session:
    session = Stage1Session(
        session_id="test-session",
        client=FakeSourceClient(),
        genre="玄幻",
        tool_call_mode="dsml",
    )
    # 替换内部 client 的流式接口为 mock
    session._client.astream = _make_astream(responses)
    # 替换工具管理器为假工具，避免读写真实文件/联网（保留 ask_user）
    tm = ToolManager()
    tm.register(EchoTool())
    tm.register(AskUserTool(session._ask_user))
    session._tool_manager = tm
    session._agent.tool_manager = tm
    return session


class TestStage1Session:
    """阶段1 会话多轮对话。"""

    @pytest.mark.asyncio
    async def test_multi_turn_until_done(self) -> None:
        session = _make_session([
            _resp("好的，我们先分析创意，还需要你补充一些细节。"),
            _resp("创意已完善，文档已保存。作者确认无误，本阶段完成 <<DONE>>"),
        ])

        turn1 = await session.send_message("我想写一个程序员穿越玄幻的小说")
        assert turn1.is_done is False
        assert "分析" in turn1.reply
        assert session.done is False

        turn2 = await session.send_message("好的，就这样吧")
        assert turn2.is_done is True
        assert session.done is True
        assert "<<DONE>>" not in turn2.reply
        # 消息计数：system + 2 轮 * 2 条（user+assistant）
        assert session.info["message_count"] == 4

    @pytest.mark.asyncio
    async def test_step_index_global_increment(self) -> None:
        """步骤序号应全局递增（工具调用轮）。"""
        dsml1 = (
            '<||DSML||invoke name="echo">'
            '<||DSML||parameter name="text" string="true">a</||DSML||parameter>'
            "</||DSML||invoke>"
        )
        dsml2 = (
            '<||DSML||invoke name="echo">'
            '<||DSML||parameter name="text" string="true">b</||DSML||parameter>'
            "</||DSML||invoke>"
        )
        session = _make_session([
            _resp(content=f"调用一次\n{dsml1}"),
            _resp(content=f"调用二次\n{dsml2}"),
            _resp(content="完成 <<DONE>>"),
        ])
        received: list[dict] = []

        async def step_cb(s: dict) -> None:
            received.append(s)

        await session.send_message("测试", step_callback=step_cb)
        indices = [s["step_index"] for s in received]
        assert indices == [1, 2, 3], f"步骤序号应递增，实际: {indices}"
        tools = [s["tool_name"] for s in received]
        assert tools == ["echo", "echo", ""]

    @pytest.mark.asyncio
    async def test_project_name_extracted_from_first_message(self) -> None:
        session = _make_session([_resp("收到 <<DONE>>")])

        await session.send_message("穿越到玄幻世界的程序员")
        # 项目名应从首条消息提取（前 6 个字符）
        assert session.project_name == "穿越到玄幻世"
        assert session.info["project_name"] == "穿越到玄幻世"

    @pytest.mark.asyncio
    async def test_send_after_done_rejected(self) -> None:
        session = _make_session([_resp("完成 <<DONE>>")])
        await session.send_message("第一问")

        result = await session.send_message("还会回应吗")
        assert result.is_done is True
        assert "已完成" in result.reply

    @pytest.mark.asyncio
    async def test_ask_user_pauses_and_resumes(self) -> None:
        """ask_user 工具应暂停等待，submit_answer 后继续。"""
        dsml_ask = (
            '<||DSML||invoke name="ask_user">'
            '<||DSML||parameter name="question" string="true">选什么题材</||DSML||parameter>'
            '<||DSML||parameter name="options" string="true">["玄幻","都市"]</||DSML||parameter>'
            "</||DSML||invoke>"
        )
        session = _make_session([
            ChatResponse(
                content=dsml_ask,
                model="gpt-4o",
                usage=TokenUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
                finish_reason="stop",
            ),
            _resp("好的，就按玄幻来写。"),
        ])

        asked: list[dict] = []

        async def on_ask(info: dict) -> None:
            asked.append(info)

        task = asyncio.ensure_future(session.send_message("帮我选个题材", on_ask=on_ask))
        # 等 ask 事件发出
        for _ in range(20):
            if asked:
                break
            await asyncio.sleep(0)
        assert asked, "应触发 on_ask"
        assert asked[0]["question"] == "选什么题材"
        assert asked[0]["options"] == ["玄幻", "都市"]

        # 尚未回答时任务不应完成
        await asyncio.sleep(0)
        assert not task.done()

        # 提交回答后继续
        assert session.submit_answer("玄幻") is True
        result = await asyncio.wait_for(task, timeout=5)
        assert "玄幻" in result.reply

    @pytest.mark.asyncio
    async def test_submit_answer_without_pending(self) -> None:
        """无待回答问题时应返回 False。"""
        session = _make_session([_resp("完成 <<DONE>>")])
        await session.send_message("第一问")
        assert session.submit_answer("随便") is False

    @pytest.mark.asyncio
    async def test_snapshot_restore_roundtrip(self) -> None:
        session = _make_session([_resp("回复一 <<DONE>>")])
        await session.send_message("第一问")

        snapshot = session.to_snapshot()
        assert snapshot["done"] is True
        assert len(snapshot["messages"]) >= 3

        # 恢复到一个新会话（保持相同 tool_call_mode）
        session2 = Stage1Session(
            session_id="test-session",
            client=FakeSourceClient(),
            tool_call_mode="dsml",
        )
        session2._tool_manager = session._tool_manager
        session2._agent.tool_manager = session._tool_manager
        session2.restore(snapshot)
        assert session2.done is True
        assert session2.project_name == session.project_name
        assert session2.to_snapshot()["messages"] == snapshot["messages"]


class TestStage1SessionStore:
    """会话存储：按项目列出与消息恢复。"""

    def _make_snapshot(self, tmp_path: Path, project_id: str, n: int) -> dict:
        return {
            "session_id": f"ses-{project_id}-{n}",
            "project_id": project_id,
            "project_name": f"书{n}",
            "updated_at": f"2026-01-0{n}T00:00:00",
            "done": False,
            "messages": [
                {"role": "system", "content": "sys"},
                {"role": "user", "content": f"消息{n}"},
                {"role": "assistant", "content": "回复"},
            ],
        }

    def _write_snapshot(self, tmp_path: Path, snapshot: dict) -> None:
        d = tmp_path / "sessions"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{snapshot['session_id']}.json").write_text(
            json.dumps(snapshot, ensure_ascii=False), encoding="utf-8"
        )

    def test_list_by_project_filters_and_sorts(self, tmp_path: Path, monkeypatch) -> None:
        import ai_novel_workstation.workflow.stage1_session as mod

        monkeypatch.setattr(mod, "_SESSIONS_DIR", tmp_path / "sessions")
        self._write_snapshot(tmp_path, self._make_snapshot(tmp_path, "A", 1))
        self._write_snapshot(tmp_path, self._make_snapshot(tmp_path, "A", 2))
        self._write_snapshot(tmp_path, self._make_snapshot(tmp_path, "B", 1))

        store = Stage1SessionStore()
        result = store.list_by_project("A")
        assert len(result) == 2
        assert result[0]["updated_at"] >= result[1]["updated_at"]

        result_b = store.list_by_project("B")
        assert len(result_b) == 1
        assert result_b[0]["session_id"] == "ses-B-1"

        assert store.list_by_project("") == []

    def test_list_by_project_matches_legacy_by_name(self, tmp_path: Path, monkeypatch) -> None:
        """无 project_id 的历史会话按 project_name 匹配。"""
        import ai_novel_workstation.workflow.stage1_session as mod

        monkeypatch.setattr(mod, "_SESSIONS_DIR", tmp_path / "sessions")
        snap = self._make_snapshot(tmp_path, "A", 1)
        snap["project_id"] = ""
        self._write_snapshot(tmp_path, snap)

        store = Stage1SessionStore()
        assert len(store.list_by_project("A")) == 0
        assert len(store.list_by_project("", "书1")) == 1

    def test_get_messages(self, tmp_path: Path, monkeypatch) -> None:
        import ai_novel_workstation.workflow.stage1_session as mod

        monkeypatch.setattr(mod, "_SESSIONS_DIR", tmp_path / "sessions")
        snap = self._make_snapshot(tmp_path, "A", 1)
        self._write_snapshot(tmp_path, snap)

        store = Stage1SessionStore()
        messages = store.get_messages("ses-A-1")
        assert messages is not None
        assert len(messages) == 3
        assert store.get_messages("不存在") is None


class TestProjectConfigInjection:
    """项目已确认信息注入系统提示词。"""

    def test_genre_platform_words_in_system_prompt(self) -> None:
        session = _make_session([_resp("完成 <<DONE>>")])
        system = session._agent.messages[0].content
        assert "玄幻" in system  # genre
        assert "（未填写）" in system  # platform/target_words 未填时占位

    def test_full_config_injected(self) -> None:
        session = Stage1Session(
            session_id="cfg-session",
            client=FakeSourceClient(),
            genre="都市",
            platform="番茄",
            target_words="100万字",
        )
        session._agent.messages[0].content = session._build_system_prompt()
        system = session._agent.messages[0].content
        assert "题材类型：都市" in system
        assert "目标平台：番茄" in system
        assert "目标字数：100万字" in system

    def test_vision_doc_guide_injected(self) -> None:
        """愿景文档标准结构应注入系统提示词。"""
        session = _make_session([_resp("完成 <<DONE>>")])
        system = session._agent.messages[0].content
        assert "《故事愿景文档》标准结构" in system
        assert "一句话核心梗" in system
        assert "待作者确认事项" in system

    @pytest.mark.asyncio
    async def test_persist_interaction_writes_with_turn_id(self, monkeypatch) -> None:
        """每次 LLM 调用完成即持久化交互记录。"""
        from ai_novel_workstation.storage import interaction_store

        saved: list[dict] = []

        def fake_save(source, interaction, **kw):
            saved.append({"source": source, "interaction": interaction, **kw})
            return "rid-1"

        monkeypatch.setattr(interaction_store, "save_interaction", fake_save)
        session = _make_session([_resp("完成 <<DONE>>")])
        session._turn_id = "turn-test"
        session._turn_user_message = "测试一下"
        await session._persist_interaction({"messages": [], "model": "m"})
        assert len(saved) == 1
        assert saved[0]["source"] == "stage1"
        assert saved[0]["session_id"] == "test-session"
        assert saved[0]["turn_id"] == "turn-test"
        assert saved[0]["user_message"] == "测试一下"

    @pytest.mark.asyncio
    async def test_agent_on_llm_done_fires_persist(self, monkeypatch) -> None:
        """ReAct 每次 LLM 调用完成后触发 on_llm_done。"""
        from ai_novel_workstation.storage import interaction_store

        fired: list[dict] = []

        def fake_save(source, interaction, **kw):
            fired.append(interaction)
            return "rid"

        monkeypatch.setattr(interaction_store, "save_interaction", fake_save)
        session = _make_session([_resp("完成 <<DONE>>")])
        session._client._interaction_logger.record(
            messages=[{"role": "user", "content": "hi"}], model="gpt-4o"
        )
        interaction = session._client.get_last_interaction().to_dict()
        await session._agent.on_llm_done(interaction)
        assert len(fired) == 1

    @pytest.mark.asyncio
    async def test_tool_result_backfilled_to_interaction(self, monkeypatch) -> None:
        """工具执行结果回填到已持久化的交互记录。"""
        from ai_novel_workstation.storage import interaction_store

        updated: list[tuple] = []

        def fake_save(source, interaction, **kw):
            return "rid-1"

        def fake_update(record_id, tool_name, tool_args, tool_result, tool_success):
            updated.append((record_id, tool_name, tool_args, tool_result, tool_success))
            return True

        monkeypatch.setattr(interaction_store, "save_interaction", fake_save)
        monkeypatch.setattr(interaction_store, "update_interaction_tool", fake_update)
        session = _make_session([_resp("完成 <<DONE>>")])
        session._turn_id = "turn-1"
        await session._persist_interaction({"messages": [], "model": "m"})
        await session._update_interaction_tool("web_search", {"query": "x"}, "结果", True)
        assert len(updated) == 1
        rid, name, args, result, ok = updated[0]
        assert rid == "rid-1"
        assert name == "web_search"
        assert args == {"query": "x"}
        assert result == "结果"
        assert ok is True
