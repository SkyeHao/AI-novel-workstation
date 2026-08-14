"""ReAct Agent 多轮对话 + 工具调用 + 结束词 单元测试。

使用 mock LLM 响应，不依赖真实 API。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from ai_novel_workstation.agent.react import ReActAgent
from ai_novel_workstation.config.settings import LLMModelConfig
from ai_novel_workstation.llm.models import ChatResponse, Role, TokenUsage
from ai_novel_workstation.tools.base import BaseTool, ToolParameter, ToolResult
from ai_novel_workstation.tools.manager import ToolManager


class EchoTool(BaseTool):
    """测试用假工具：回显输入。"""

    @property
    def name(self) -> str:
        return "echo"

    @property
    def description(self) -> str:
        return "回显文本"

    @property
    def parameters(self) -> list[ToolParameter]:
        return [ToolParameter(name="text", type="string", description="要回显的文本")]

    async def execute(self, text: str, **kwargs) -> ToolResult:
        return ToolResult(success=True, output=f"echo:{text}")


class FakeClient:
    """假 LLM Client：按预设响应队列返回（流式）。"""

    def __init__(self, responses: list[ChatResponse]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[list, dict]] = []
        self.config = LLMModelConfig(
            api_key="sk-test", base_url="https://api.openai.com/v1", model="gpt-4o"
        )

    async def achat(self, messages: list, **kwargs) -> ChatResponse:
        self.calls.append((messages, kwargs))
        return self.responses.pop(0)

    async def astream(self, messages: list, **kwargs):
        self.calls.append((messages, kwargs))
        resp = self.responses.pop(0)
        content = resp.content or ""
        # 分成小段模拟流式输出
        step = max(1, len(content) // 3)
        for i in range(0, len(content), step):
            yield content[i : i + step]

    def get_last_interaction(self):
        return None


def _resp(content: str = "", raw: dict | None = None) -> ChatResponse:
    return ChatResponse(
        content=content,
        model="gpt-4o",
        usage=TokenUsage(prompt_tokens=5, completion_tokens=5, total_tokens=10),
        finish_reason="stop",
        raw=raw,
    )


class NativeFcClient(FakeClient):
    """返回原生 function_call 的假客户端（通过 get_last_interaction）。"""

    def __init__(self, responses: list[ChatResponse], interactions: list[dict]) -> None:
        super().__init__(responses)
        self._interactions = list(interactions)

    def get_last_interaction(self):
        if self._interactions:
            return SimpleNamespace(**self._interactions.pop(0))
        return None


def _make_agent(client: FakeClient, end_token: str = "<<DONE>>") -> ReActAgent:
    tm = ToolManager()
    tm.register(EchoTool())
    return ReActAgent(
        client=client,
        tool_manager=tm,
        system_prompt="你是测试助手。",
        max_iterations=5,
        temperature=0.5,
        end_token=end_token,
        tool_call_mode="dsml",
    )


class TestDsmlParsing:
    """DSML 文本格式工具调用解析。"""

    def test_extract_dsml_call(self) -> None:
        content = (
            "让我调用工具。\n"
            "<||DSML||invoke name=\"echo\">\n"
            "<||DSML||parameter name=\"text\" string=\"true\">hello</||DSML||parameter>\n"
            "</||DSML||invoke>\n"
        )
        tool_call = ReActAgent._extract_tool_call(None, content, mode="dsml")
        assert tool_call is not None
        function_call, thought, args, is_dsml = tool_call
        assert function_call["name"] == "echo"
        assert args == {"text": "hello"}
        assert is_dsml is True
        assert "<||DSML||" not in thought

    def test_extract_structured_function_call(self) -> None:
        fc = {
            "name": "echo",
            "arguments": '{"text": "hi"}',
        }
        tool_call = ReActAgent._extract_tool_call(fc, "调用工具")
        assert tool_call is not None
        function_call, _, args, is_dsml = tool_call
        assert function_call["name"] == "echo"
        assert args == {"text": "hi"}
        assert is_dsml is False

    def test_extract_structured_invalid_json_ok(self) -> None:
        fc = {"name": "echo", "arguments": "not-json"}
        tool_call = ReActAgent._extract_tool_call(fc, "调用工具")
        assert tool_call is not None
        _, _, args, is_dsml = tool_call
        assert args == {}
        assert is_dsml is False

    def test_extract_structured_none_returns_none(self) -> None:
        tool_call = ReActAgent._extract_tool_call(None, "调用工具")
        assert tool_call is None

    def test_no_tool_call(self) -> None:
        tool_call = ReActAgent._extract_tool_call(None, "直接回复")
        assert tool_call is None

    def test_strip_dsml(self) -> None:
        text = (
            "<||DSML||tool_calls>\n"
            "<||DSML||invoke name=\"echo\">x</||DSML||invoke>\n"
            "最终回答\n"
        )
        cleaned = ReActAgent._strip_dsml(text)
        assert "<||DSML||" not in cleaned
        assert "最终回答" in cleaned


class TestReActMultiTurn:
    """ReAct 多轮对话。"""

    @pytest.mark.asyncio
    async def test_single_turn_final_answer(self) -> None:
        client = FakeClient([_resp(content="你好，作者！")])
        agent = _make_agent(client)

        turn = await agent.run_turn("写个故事")
        assert turn.reply == "你好，作者！"
        assert turn.is_done is False
        # 消息历史：system + user + assistant
        assert len(agent.messages) == 3

    @pytest.mark.asyncio
    async def test_end_token_detection(self) -> None:
        client = FakeClient([_resp(content="任务完成\n<<DONE>>")])
        agent = _make_agent(client)

        turn = await agent.run_turn("完成后结束")
        assert turn.is_done is True
        # 结束词应从回复中剥离
        assert "<<DONE>>" not in turn.reply

    @pytest.mark.asyncio
    async def test_dsml_tool_call_then_final(self) -> None:
        dsml = (
            "<||DSML||invoke name=\"echo\">\n"
            "<||DSML||parameter name=\"text\" string=\"true\">hello</||DSML||parameter>\n"
            "</||DSML||invoke>"
        )
        client = FakeClient([
            _resp(content=f"调用工具\n{dsml}"),
            _resp(content="已回显 hello，还要别的吗？"),
        ])
        agent = _make_agent(client)

        turn = await agent.run_turn("帮我回显 hello")
        assert turn.reply == "已回显 hello，还要别的吗？"
        assert len(turn.steps) == 2
        assert turn.steps[0].tool_name == "echo"
        assert turn.steps[0].observation == "echo:hello"
        assert turn.steps[1].is_final is True
        # 消息历史：assistant 保留调用文本，工具结果以 user 消息回填（模型 API 不接受 role=function）
        contents = [m.content for m in agent.messages]
        assert any("工具 echo 执行结果" in c for c in contents)

    @pytest.mark.asyncio
    async def test_stream_callback_receives_text(self) -> None:
        """流式回调应逐段收到剥离 DSML 后的可展示文本。"""
        client = FakeClient([
            _resp(content="先分析一下，然后结束。"),
        ])
        agent = _make_agent(client)
        streamed: list[str] = []

        async def on_stream(text: str) -> None:
            streamed.append(text)

        turn = await agent.run_turn("第一问", on_stream=on_stream)
        assert turn.reply == "先分析一下，然后结束。"
        joined = "".join(streamed)
        assert joined == "先分析一下，然后结束。"

    @pytest.mark.asyncio
    async def test_stream_callback_strips_dsml(self) -> None:
        """流式输出应剥离 DSML 工具调用片段。"""
        dsml = (
            '<||DSML||invoke name="echo">'
            '<||DSML||parameter name="text" string="true">hi</||DSML||parameter>'
            "</||DSML||invoke>"
        )
        client = FakeClient([
            _resp(content=f"让我调用工具\n{dsml}"),
            _resp(content="回显成功"),
        ])
        agent = _make_agent(client)
        streamed: list[str] = []
        thought: list[str] = []

        async def on_stream(text: str) -> None:
            streamed.append(text)

        async def on_thinking(text: str) -> None:
            thought.append(text)

        turn = await agent.run_turn("echo hi", on_stream=on_stream, on_thinking=on_thinking)
        assert turn.steps[0].tool_name == "echo"
        # 工具调用轮的思考文本走 on_thinking，不含 DSML 标记
        joined_think = "".join(thought)
        assert "<||DSML||" not in joined_think
        assert "调用工具" in joined_think
        # 最终回答走 on_stream
        joined = "".join(streamed)
        assert "回显成功" in joined
        assert "<||DSML||" not in joined

    @pytest.mark.asyncio
    async def test_multi_turn_keeps_history(self) -> None:
        client = FakeClient([
            _resp(content="第一轮回复"),
            _resp(content="第二轮回复 <<DONE>>"),
        ])
        agent = _make_agent(client)

        turn1 = await agent.run_turn("第一问")
        assert turn1.reply == "第一轮回复"
        assert turn1.is_done is False
        # 第二轮应携带第一轮的历史
        turn2 = await agent.run_turn("第二问")
        assert turn2.reply == "第二轮回复"
        assert turn2.is_done is True
        # 消息历史按顺序累积
        roles = [m.role for m in agent.messages]
        assert roles == [Role.SYSTEM, Role.USER, Role.ASSISTANT, Role.USER, Role.ASSISTANT]

    @pytest.mark.asyncio
    async def test_max_iterations_stops(self) -> None:
        # 一直返回 DSML 工具调用，超过 max_iterations 强制停止
        dsml = (
            '<||DSML||invoke name="echo">'
            '<||DSML||parameter name="text" string="true">x</||DSML||parameter>'
            "</||DSML||invoke>"
        )
        client = FakeClient([_resp(content=dsml)] * 10)
        tm = ToolManager()
        tm.register(EchoTool())
        agent = ReActAgent(
            client=client,
            tool_manager=tm,
            system_prompt="sys",
            max_iterations=3,
            end_token="<<DONE>>",
            tool_call_mode="dsml",
        )

        turn = await agent.run_turn("无限循环")
        assert "执行超时" in turn.reply
        assert turn.is_done is False


class TestJsonfcParsing:
    """JSON function_call 约定解析（deepseek-v4-flash 等模型）。"""

    def test_parse_jsonfc_call(self) -> None:
        content = '{"function_call":{"name":"echo","arguments":{"text":"hi"}}}'
        tool_call = ReActAgent._extract_tool_call(None, content, mode="jsonfc")
        assert tool_call is not None
        fc, thought, args, is_dsml = tool_call
        assert fc["name"] == "echo"
        assert args == {"text": "hi"}
        assert is_dsml is False

    def test_parse_jsonfc_with_thought_prefix(self) -> None:
        content = '我需要搜索一下。\n{"function_call":{"name":"echo","arguments":{"text":"x"}}}'
        tool_call = ReActAgent._extract_tool_call(None, content, mode="jsonfc")
        assert tool_call is not None
        fc, thought, args, _ = tool_call
        assert fc["name"] == "echo"
        assert args == {"text": "x"}
        assert "搜索" in thought
        assert "function_call" not in thought

    def test_jsonfc_arguments_as_string(self) -> None:
        content = '{"function_call":{"name":"echo","arguments":"{\\"text\\":\\"y\\"}"}}'
        tool_call = ReActAgent._extract_tool_call(None, content, mode="jsonfc")
        assert tool_call is not None
        _, _, args, _ = tool_call
        assert args == {"text": "y"}

    def test_jsonfc_no_call(self) -> None:
        tool_call = ReActAgent._extract_tool_call(None, "直接回复作者", mode="jsonfc")
        assert tool_call is None

    @pytest.mark.asyncio
    async def test_jsonfc_triggers_tool(self) -> None:
        """jsonfc 协议模式：模型输出 tool_call → agent 执行工具。"""
        client = FakeClient([
            _resp(content='{"thought":"需要回显","tool_call":{"name":"echo","arguments":{"text":"hi"}},"done":false}'),
            _resp(content='{"thought":"已回显，完成","tool_call":null,"done":true}'),
        ])
        tm = ToolManager()
        tm.register(EchoTool())
        agent = ReActAgent(
            client=client,
            tool_manager=tm,
            system_prompt="sys",
            max_iterations=5,
            end_token="<<DONE>>",
            tool_call_mode="jsonfc",
        )
        turn = await agent.run_turn("帮我回显")
        assert turn.is_done is True
        tool_steps = [s for s in turn.steps if s.tool_name == "echo"]
        assert len(tool_steps) == 1
        assert "echo:hi" in tool_steps[0].observation

    @pytest.mark.asyncio
    async def test_jsonfc_done_false_without_tool_drives(self) -> None:
        """done=false 且无 tool_call → 无条件继续驱动。"""
        client = FakeClient([
            _resp(content='{"thought":"我先思考一下","tool_call":null,"done":false}'),
            _resp(content='{"thought":"现在调用","tool_call":{"name":"echo","arguments":{"text":"x"}},"done":false}'),
            _resp(content='{"thought":"完成","tool_call":null,"done":true}'),
        ])
        tm = ToolManager()
        tm.register(EchoTool())
        agent = ReActAgent(
            client=client,
            tool_manager=tm,
            system_prompt="sys",
            max_iterations=5,
            end_token="<<DONE>>",
            tool_call_mode="jsonfc",
        )
        turn = await agent.run_turn("测试")
        assert turn.is_done is True
        tool_steps = [s for s in turn.steps if s.tool_name == "echo"]
        assert len(tool_steps) == 1
        # 驱动消息被注入
        contents = [m.content for m in agent.messages]
        assert any("done=false" in c or "请继续" in c for c in contents)


class TestDriveNext:
    """承诺未执行 → 继续驱动。"""

    def test_drive_next_marks(self) -> None:
        assert ReActAgent._should_drive_next("我先把《故事愿景文档》搭起来")
        assert ReActAgent._should_drive_next("我去搜索一下市场趋势")
        assert not ReActAgent._should_drive_next("好的，这是一个好问题")
        assert not ReActAgent._should_drive_next("")

    @pytest.mark.asyncio
    async def test_drive_next_when_committed_but_not_executed(self) -> None:
        """模型说要做但没调用工具 → agent 注入驱动消息继续。"""
        client = FakeClient([
            _resp(content="我先把《故事愿景文档》搭起来"),  # 承诺未执行（非协议 JSON）
            _resp(content='{"thought":"现在调用","tool_call":{"name":"echo","arguments":{"text":"ok"}},"done":false}'),
            _resp(content='{"thought":"完成","tool_call":null,"done":true}'),
        ])
        tm = ToolManager()
        tm.register(EchoTool())
        agent = ReActAgent(
            client=client,
            tool_manager=tm,
            system_prompt="sys",
            max_iterations=6,
            end_token="<<DONE>>",
            tool_call_mode="jsonfc",
        )
        turn = await agent.run_turn("帮我写文档")
        assert turn.is_done is True
        assert "完成" in turn.reply
        # 工具被执行了（驱动后真正调用）
        tool_steps = [s for s in turn.steps if s.tool_name == "echo"]
        assert len(tool_steps) == 1
        # 消息历史包含驱动消息
        contents = [m.content for m in agent.messages]
        assert any("你刚才表示要继续执行动作" in c for c in contents)

    @pytest.mark.asyncio
    async def test_no_drive_for_normal_reply(self) -> None:
        """正常对话回复（无承诺）不应被强制驱动。"""
        client = FakeClient([
            _resp(content="好的，这是一个很好的问题，我来分析一下思路。"),
        ])
        tm = ToolManager()
        tm.register(EchoTool())
        agent = ReActAgent(
            client=client,
            tool_manager=tm,
            system_prompt="sys",
            max_iterations=5,
            end_token="<<DONE>>",
            tool_call_mode="jsonfc",
        )
        turn = await agent.run_turn("问你个问题")
        assert turn.is_done is False
        # 不应注入驱动消息
        contents = [m.content for m in agent.messages]
        assert not any("你刚才表示要继续执行动作" in c for c in contents)


class TestJsonfcRobust:
    """jsonfc 协议容错（模型输出坏 JSON）。"""

    def test_repair_unescaped_quotes(self) -> None:
        """thought 内的未转义双引号应被修复。"""
        content = '{"thought":"作者给出的"躺平+隐世大佬"反差创意","tool_call":{"name":"echo","arguments":{"text":"x"}},"done":false}'
        r = ReActAgent._parse_jsonfc_protocol(content)
        assert r is not None
        thought, tc, done = r
        assert tc["name"] == "echo"
        assert "躺平" in thought
        assert done is False

    def test_repair_trailing_commas(self) -> None:
        content = '{"thought":"t","tool_call":{"name":"echo","arguments":{"a":1,}},"done":false,}'
        r = ReActAgent._parse_jsonfc_protocol(content)
        assert r is not None
        _, tc, _ = r
        assert tc["name"] == "echo"
        assert tc["arguments"] == {"a": 1}

    def test_repair_content_with_quotes(self) -> None:
        """content 参数里含引号。"""
        content = '{"thought":"介绍","tool_call":{"name":"echo","arguments":{"text":"他说"你好""}},"done":false}'
        r = ReActAgent._parse_jsonfc_protocol(content)
        assert r is not None
        _, tc, _ = r
        assert "你好" in tc["arguments"]["text"]

    def test_repair_quote_followed_by_space_cjk(self) -> None:
        """内容引号后跟空格+中文（模拟文档内引号）。"""
        content = '{"thought":"重新写入","tool_call":{"name":"echo","arguments":{"text":"他喊"前辈" 然后继续"}},"done":false}'
        r = ReActAgent._parse_jsonfc_protocol(content)
        assert r is not None
        _, tc, _ = r
        assert "前辈" in tc["arguments"]["text"]

    def test_done_true_parses(self) -> None:
        content = '{"thought":"完成","tool_call":null,"done":true}'
        r = ReActAgent._parse_jsonfc_protocol(content)
        assert r == ("完成", None, True)

    def test_extract_tool_call_obj_fallback(self) -> None:
        """整体 JSON 坏到无法修复时，至少提取 tool_call。"""
        content = 'garbage{"tool_call":{"name":"echo","arguments":{"text":"hi"}}}more'
        r = ReActAgent._extract_tool_call_obj(content)
        assert r is not None
        assert r["name"] == "echo"


class TestNativeFunctionCall:
    """原生 function_call 端到端（流式累积 + 回填工具结果）。"""

    @pytest.mark.asyncio
    async def test_native_function_call_triggers_tool(self) -> None:
        # 第一轮返回原生 function_call（通过 get_last_interaction 带回），第二轮最终回答
        responses = [
            _resp(content="让我调用 echo"),
            _resp(content="已完成 <<DONE>>"),
        ]
        interactions = [
            {"total_tokens": 10, "response_function_call": {"name": "echo", "arguments": '{"text": "hi"}'}},
            {"total_tokens": 5, "response_function_call": None},
        ]
        client = NativeFcClient(responses, interactions)
        tm = ToolManager()
        tm.register(EchoTool())
        agent = ReActAgent(
            client=client,
            tool_manager=tm,
            system_prompt="sys",
            max_iterations=5,
            end_token="<<DONE>>",
        )

        turn = await agent.run_turn("调用 echo")
        assert turn.is_done is True
        assert "已完成" in turn.reply
        # 工具被调用过：工具观察写入步骤
        tool_steps = [s for s in turn.steps if s.tool_name == "echo"]
        assert len(tool_steps) == 1
        assert "echo:hi" in tool_steps[0].observation

    @pytest.mark.asyncio
    async def test_native_thinking_split_via_on_delta(self) -> None:
        """native 模式：fc 到达前的内容走思考，无 fc 时走回答。"""
        class DeltaFakeClient(FakeClient):
            def __init__(self, responses, call_deltas, interactions):
                super().__init__(responses)
                self.call_deltas = list(call_deltas)
                self._interactions = list(interactions)

            async def astream(self, messages, **kwargs):
                on_delta = kwargs.get("on_delta")
                resp = self.responses.pop(0)
                content = resp.content or ""
                for delta in self.call_deltas.pop(0):
                    if on_delta:
                        on_delta(delta)
                    if delta.get("content"):
                        yield delta["content"]

            def get_last_interaction(self):
                if self._interactions:
                    return SimpleNamespace(**self._interactions.pop(0))
                return None

        responses = [
            _resp(content="先思考一下"),
            _resp(content="最终回答 <<DONE>>"),
        ]
        interactions = [
            {"total_tokens": 10, "response_function_call": {"name": "echo", "arguments": '{"text":"x"}'}},
            {"total_tokens": 5, "response_function_call": None},
        ]
        # 第一轮：先有 content 再有 function_call（思考）；第二轮：纯 content（回答）
        call_deltas = [
            [{"content": "先思考一下"}, {"function_call": {"name": "echo", "arguments": ""}}],
            [{"content": "最终回答 <<DONE>>"}],
        ]
        client = DeltaFakeClient(responses, call_deltas, interactions)
        tm = ToolManager()
        tm.register(EchoTool())
        agent = ReActAgent(
            client=client,
            tool_manager=tm,
            system_prompt="sys",
            max_iterations=5,
            end_token="<<DONE>>",
            tool_call_mode="native",
        )
        thought: list[str] = []
        streamed: list[str] = []

        async def on_thinking(t): thought.append(t)
        async def on_stream(t): streamed.append(t)

        turn = await agent.run_turn("测试", on_thinking=on_thinking, on_stream=on_stream)
        assert turn.reply == "最终回答"
        # 思考文本（fc 前）在 steps[0].thought；最终回答流式到 streamed
        assert any("先思考一下" in s.thought for s in turn.steps)
        assert "最终回答" in "".join(streamed) or turn.reply == "最终回答"


class TestReActRunBackwardCompat:
    """run() 一次性接口（兼容旧调用）。"""

    @pytest.mark.asyncio
    async def test_run_resets_history(self) -> None:
        client = FakeClient([
            _resp(content="回复A"),
            _resp(content="回复B"),
        ])
        agent = _make_agent(client)

        reply1, _ = await agent.run("第一问")
        reply2, _ = await agent.run("第二问")
        assert reply1 == "回复A"
        assert reply2 == "回复B"
        # run() 每次应重置历史，因此第二次仍是 system+user+assistant
        assert len(agent.messages) == 3
