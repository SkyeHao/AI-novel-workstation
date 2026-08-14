"""存储层测试：路径沙箱、项目存储、设定存储。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from ai_novel_workstation.storage.path_safety import PathSafetyError, safe_resolve
from ai_novel_workstation.storage.project_store import (
    ProjectNotFoundError,
    ProjectStore,
)
from ai_novel_workstation.storage.settings_store import SettingsStore


@pytest.fixture
def sandbox(tmp_path: Path) -> Path:
    return tmp_path / "workspace"


class TestSafeResolve:
    def test_relative_inside(self, sandbox: Path) -> None:
        p = safe_resolve(sandbox, "projects/foo/bar.txt")
        assert p == (sandbox / "projects/foo/bar.txt").resolve()
        assert p.is_absolute()

    def test_absolute_inside(self, sandbox: Path) -> None:
        target = sandbox / "a/b.txt"
        p = safe_resolve(sandbox, str(target))
        assert p == target.resolve()

    def test_traversal_escape(self, sandbox: Path) -> None:
        with pytest.raises(PathSafetyError):
            safe_resolve(sandbox, "../../etc/passwd")

    def test_absolute_outside(self, sandbox: Path, tmp_path: Path) -> None:
        outside = tmp_path / "outside.txt"
        with pytest.raises(PathSafetyError):
            safe_resolve(sandbox, str(outside))

    def test_absolute_outside_sibling(self, sandbox: Path, tmp_path: Path) -> None:
        sibling = tmp_path / "sibling"
        with pytest.raises(PathSafetyError):
            safe_resolve(sandbox, str(sibling))

    @pytest.mark.skipif(sys.platform == "win32", reason="Windows 无符号链接权限")
    def test_symlink_escape(self, sandbox: Path, tmp_path: Path) -> None:
        sandbox.mkdir(parents=True, exist_ok=True)
        outside = tmp_path / "secret.txt"
        outside.write_text("secret", encoding="utf-8")
        link = sandbox / "link"
        link.symlink_to(outside, target_is_directory=False)
        with pytest.raises(PathSafetyError):
            safe_resolve(sandbox, str(link))

    def test_empty_path(self, sandbox: Path) -> None:
        with pytest.raises(PathSafetyError):
            safe_resolve(sandbox, "")


class TestProjectStore:
    def _store(self, tmp_path: Path) -> ProjectStore:
        return ProjectStore(tmp_path / "workspace")

    def test_create_initializes_dirs(self, tmp_path: Path) -> None:
        store = self._store(tmp_path)
        proj = store.create("我的小说", idea="少年穿越修仙")
        assert (store.project_root(proj.name) / "project.json").exists()
        for sub in ("ideation/sessions", "settings", "chapters", "memory/summaries", "review"):
            assert (store.project_root(proj.name) / sub).exists()

    def test_create_cleans_name(self, tmp_path: Path) -> None:
        store = self._store(tmp_path)
        proj = store.create("  foo/bar:baz  ", idea="")
        assert proj.name == "foobarbaz"

    def test_create_duplicate_raises(self, tmp_path: Path) -> None:
        store = self._store(tmp_path)
        store.create("书名")
        from ai_novel_workstation.storage.project_store import ProjectError

        with pytest.raises(ProjectError):
            store.create("书名")

    def test_list_sorted_by_updated(self, tmp_path: Path) -> None:
        store = self._store(tmp_path)
        first = store.create("甲")
        store.create("乙")
        # 直接修改磁盘元数据的时间戳，绕过 save() 的自动更新时间
        meta = store.project_root(first.name) / "project.json"
        data = json.loads(meta.read_text(encoding="utf-8"))
        data["updated_at"] = "2099-01-01T00:00:00"
        meta.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        names = [p.name for p in store.list()]
        assert names[0] == "甲"

    def test_get_unknown_raises(self, tmp_path: Path) -> None:
        store = self._store(tmp_path)
        with pytest.raises(ProjectNotFoundError):
            store.get("不存在")

    def test_update(self, tmp_path: Path) -> None:
        store = self._store(tmp_path)
        proj = store.create("书")
        updated = store.update(proj.name, status="setting", platform="fanqie")
        assert updated.status == "setting"
        assert updated.platform == "fanqie"

    def test_delete(self, tmp_path: Path) -> None:
        store = self._store(tmp_path)
        proj = store.create("书")
        store.delete(proj.name)
        with pytest.raises(ProjectNotFoundError):
            store.get(proj.name)

    def test_resolve_inside_sandbox(self, tmp_path: Path) -> None:
        store = self._store(tmp_path)
        proj = store.create("书")
        p = store.resolve(proj.name, "chapters/1.md")
        assert p == (store.project_root(proj.name) / "chapters/1.md").resolve()
        from ai_novel_workstation.storage.path_safety import PathSafetyError

        with pytest.raises(PathSafetyError):
            store.resolve(proj.name, "../../escape.md")


class TestSettingsStore:
    def _pair(self, tmp_path: Path):
        store = ProjectStore(tmp_path / "workspace")
        proj = store.create("书")
        return SettingsStore(store), proj.name

    def test_get_default_when_missing(self, tmp_path: Path) -> None:
        settings, pid = self._pair(tmp_path)
        data = settings.get(pid, "worldview")
        assert data["sections"]["era"] == ""

    def test_save_and_get_roundtrip(self, tmp_path: Path) -> None:
        settings, pid = self._pair(tmp_path)
        data = {"sections": {"era": "玄幻", "rules": "灵气复苏"}}
        settings.save(pid, "worldview", data)
        assert settings.get(pid, "worldview") == data

    def test_unknown_type_raises(self, tmp_path: Path) -> None:
        settings, pid = self._pair(tmp_path)
        from ai_novel_workstation.storage.settings_store import SettingsError

        with pytest.raises(SettingsError):
            settings.get(pid, "nonsense")

    def test_unknown_project_raises(self, tmp_path: Path) -> None:
        store = ProjectStore(tmp_path / "workspace")
        settings = SettingsStore(store)
        with pytest.raises(ProjectNotFoundError):
            settings.get("不存在", "worldview")


class TestDeleteInteractionsBySession:
    def test_delete_by_session(self, tmp_path: Path, monkeypatch) -> None:
        from ai_novel_workstation.storage import interaction_store as is_

        db = tmp_path / "interactions.db"
        old = is_._DB_PATH
        monkeypatch.setattr(is_, "_DB_PATH", db)
        is_._INITIALIZED = False
        try:
            for i in range(3):
                is_.save_interaction(
                    source="stage1",
                    interaction={"messages": [{"role": "user", "content": f"m{i}"}], "model": "m", "total_tokens": 1},
                    session_id="ses-A",
                    turn_id=f"t{i}",
                )
            is_.save_interaction(
                source="stage1",
                interaction={"messages": [{"role": "user", "content": "other"}], "model": "m", "total_tokens": 1},
                session_id="ses-B",
                turn_id="t0",
            )
            count = is_.delete_interactions_by_session("ses-A")
            assert count == 3
            # 其余会话不受影响
            _, total = is_.list_interactions()
            assert total == 1
        finally:
            is_._INITIALIZED = False
            is_._DB_PATH = old
