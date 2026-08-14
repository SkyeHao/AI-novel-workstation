"""设定生成器测试（JSON 解析与规范化，LLM 用假客户端）。"""

from __future__ import annotations

from pathlib import Path

import pytest

from ai_novel_workstation.config.settings import LLMModelConfig
from ai_novel_workstation.llm.models import ChatResponse, Role, TokenUsage
from ai_novel_workstation.storage.project_store import ProjectStore
from ai_novel_workstation.storage.settings_store import SettingsStore
from ai_novel_workstation.workflow.settings_generator import (
    SettingsGenerationError,
    SettingsGenerator,
    _normalize,
    _parse_json,
    generate_all,
)


class FakeClient:
    """返回预设响应的假 LLM 客户端。"""

    def __init__(self, content: str) -> None:
        self._content = content
        self.config = LLMModelConfig(
            api_key="sk-test", base_url="https://api.openai.com/v1", model="gpt-4o"
        )

    async def achat(self, messages: list, **kwargs) -> ChatResponse:
        assert any(m.role == Role.SYSTEM for m in messages)
        return ChatResponse(
            content=self._content,
            model="gpt-4o",
            usage=TokenUsage(prompt_tokens=5, completion_tokens=5, total_tokens=10),
            finish_reason="stop",
        )


class TestParseJson:
    def test_direct_json(self) -> None:
        data = _parse_json('{"a": 1}')
        assert data == {"a": 1}

    def test_fenced_json(self) -> None:
        content = "结果如下：\n```json\n{\"sections\": {\"era\": \"玄幻\"}}\n```"
        data = _parse_json(content)
        assert data["sections"]["era"] == "玄幻"

    def test_wrapped_text(self) -> None:
        content = '以下是生成结果 {"sections": {"era": "仙侠"}} 完毕'
        data = _parse_json(content)
        assert data["sections"]["era"] == "仙侠"

    def test_invalid_returns_none(self) -> None:
        assert _parse_json("没有 JSON") is None
        assert _parse_json("") is None


class TestNormalize:
    def test_characters(self) -> None:
        data = _normalize({"characters": [{"id": "c1", "name": "张三"}]}, "characters")
        assert data["characters"][0]["name"] == "张三"

    def test_characters_list_alias(self) -> None:
        data = _normalize({"characters_list": [{"id": "c1", "name": "李四"}]}, "characters")
        assert data["characters"][0]["name"] == "李四"

    def test_worldview_merges_defaults(self) -> None:
        data = _normalize({"sections": {"era": "现代"}}, "worldview")
        assert data["sections"]["era"] == "现代"
        assert "rules" in data["sections"]

    def test_style_string(self) -> None:
        data = _normalize({"style": "冷峻克制"}, "style")
        assert data["style"] == "冷峻克制"

    def test_style_alias(self) -> None:
        data = _normalize({"style_desc": "幽默"}, "style")
        assert data["style"] == "幽默"


class TestSettingsGenerator:
    def _pair(self, tmp_path: Path):
        store = ProjectStore(tmp_path / "workspace")
        proj = store.create("书", idea="少年修仙")
        return SettingsStore(store), proj

    @pytest.mark.asyncio
    async def test_generate_worldview(self, tmp_path: Path) -> None:
        settings, proj = self._pair(tmp_path)
        client = FakeClient('{"sections": {"era": "玄幻大陆"}}')
        data = await SettingsGenerator(client, settings).generate(proj, "worldview")
        assert data["sections"]["era"] == "玄幻大陆"
        assert settings.get(proj.id, "worldview")["sections"]["era"] == "玄幻大陆"

    def test_load_vision_doc(self, tmp_path: Path, monkeypatch) -> None:
        """设定生成应能读到愿景文档（注入上游依据）。"""
        from ai_novel_workstation.storage.project_store import reset_project_store
        from ai_novel_workstation.api import state

        reset_project_store()
        monkeypatch.setattr(state, "_project_dir", str(tmp_path / "workspace"))
        monkeypatch.setattr(state, "_initialized", True)
        from ai_novel_workstation.storage.project_store import ProjectStore as PS

        PS(state.get_project_dir_path())

        store = ProjectStore(tmp_path / "workspace")
        proj = store.create("书", idea="少年修仙")
        # 写入愿景文档
        root = store.project_root(proj.id)
        (root / "故事愿景文档.md").write_text(
            "# 故事愿景文档\n\n## 一句话核心梗\n少年修仙逆袭\n\n## 核心要素\n玄幻+重生",
            encoding="utf-8",
        )
        text = SettingsGenerator.load_vision_doc(proj)
        assert "一句话核心梗" in text
        assert "玄幻+重生" in text

    def test_load_vision_doc_missing_returns_empty(self, tmp_path: Path, monkeypatch) -> None:
        from ai_novel_workstation.storage.project_store import reset_project_store
        from ai_novel_workstation.api import state

        reset_project_store()
        monkeypatch.setattr(state, "_project_dir", str(tmp_path / "workspace"))
        monkeypatch.setattr(state, "_initialized", True)
        from ai_novel_workstation.storage.project_store import ProjectStore as PS

        PS(state.get_project_dir_path())

        store = ProjectStore(tmp_path / "workspace")
        proj = store.create("书", idea="x")
        assert SettingsGenerator.load_vision_doc(proj) == ""

    @pytest.mark.asyncio
    async def test_generate_injects_vision_doc(self, tmp_path: Path, monkeypatch) -> None:
        """生成时 prompt 应包含愿景文档内容。"""
        from ai_novel_workstation.storage.project_store import reset_project_store
        from ai_novel_workstation.api import state

        reset_project_store()
        monkeypatch.setattr(state, "_project_dir", str(tmp_path / "workspace"))
        monkeypatch.setattr(state, "_initialized", True)
        from ai_novel_workstation.storage.project_store import ProjectStore as PS

        PS(state.get_project_dir_path())

        store = ProjectStore(tmp_path / "workspace")
        proj = store.create("书", idea="少年修仙")
        (store.project_root(proj.id) / "故事愿景文档.md").write_text(
            "# 愿景\n\n差异化卖点：躺平反差",
            encoding="utf-8",
        )
        seen = {}

        class SpyClient(FakeClient):
            def __init__(self):
                super().__init__('{"sections": {"era": "玄幻"}}')

            async def achat(self, messages, **kwargs):
                seen["prompt"] = messages[0].content
                return await super().achat(messages, **kwargs)

        settings = SettingsStore(store)
        await SettingsGenerator(SpyClient(), settings).generate(proj, "worldview")
        assert "故事愿景文档" in seen["prompt"]
        assert "躺平反差" in seen["prompt"]

    @pytest.mark.asyncio
    async def test_generate_fenced_output(self, tmp_path: Path) -> None:
        settings, proj = self._pair(tmp_path)
        client = FakeClient('```json\n{"style": "简洁有力"}\n```')
        data = await SettingsGenerator(client, settings).generate(proj, "style")
        assert data["style"] == "简洁有力"

    @pytest.mark.asyncio
    async def test_generate_invalid_output_raises(self, tmp_path: Path) -> None:
        settings, proj = self._pair(tmp_path)
        client = FakeClient("完全没有 JSON 的内容")
        with pytest.raises(SettingsGenerationError):
            await SettingsGenerator(client, settings).generate(proj, "outline")

    @pytest.mark.asyncio
    async def test_generate_all(self, tmp_path: Path) -> None:
        settings, proj = self._pair(tmp_path)
        payload = {
            "worldview": '{"sections": {"era": "玄幻"}}',
            "characters": '{"characters": [{"id": "c1", "name": "主角"}]}',
            "outline": '{"root": {"summary_short": "简纲", "children": []}}',
            "style": '{"style": "热血"}',
        }
        count = 0

        class MultiClient:
            config = LLMModelConfig(
                api_key="sk-test", base_url="https://api.openai.com/v1", model="gpt-4o"
            )

            async def achat(self, messages, **kwargs):
                nonlocal count
                key = ["worldview", "characters", "outline", "style"][count]
                count += 1
                return ChatResponse(
                    content=payload[key],
                    model="gpt-4o",
                    usage=TokenUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
                    finish_reason="stop",
                )

        results = await generate_all(MultiClient(), settings, proj)
        assert set(results.keys()) == {"worldview", "characters", "outline", "style"}
        assert settings.exists(proj.id, "characters")
