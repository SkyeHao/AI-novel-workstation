"""用户配置路径与迁移测试。"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from ai_novel_workstation.config import paths


@pytest.fixture(autouse=True)
def _no_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """确保测试不受真实环境 AI_NOVEL_CONFIG_DIR 影响。"""
    monkeypatch.delenv("AI_NOVEL_CONFIG_DIR", raising=False)


class TestUserConfigDir:
    def test_override_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AI_NOVEL_CONFIG_DIR", r"D:\tmp\cfg")
        assert paths.get_user_config_dir() == Path(r"D:\tmp\cfg").resolve()

    def test_windows_uses_appdata(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(paths.os, "name", "nt")
        monkeypatch.setenv("APPDATA", r"C:\Users\foo\AppData\Roaming")
        assert str(paths.get_user_config_dir()) == str(
            Path(r"C:\Users\foo\AppData\Roaming") / "AI-Novel-Workstation"
        )

    @pytest.mark.skipif(os.name != "posix", reason="posix 分支仅在非 Windows 可构造")
    def test_posix_uses_config(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(paths.os, "name", "posix")
        monkeypatch.delenv("APPDATA", raising=False)
        monkeypatch.setenv("HOME", "/home/foo")
        assert paths.get_user_config_dir() == Path("/home/foo/.config") / "AI-Novel-Workstation"


class TestMigrateEnv:
    def test_no_legacy_no_target(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(paths, "get_env_file_path", lambda: tmp_path / "new" / ".env")
        monkeypatch.setattr(paths, "get_legacy_env_path", lambda: tmp_path / "legacy" / ".env")
        result = paths.migrate_env_if_needed()
        assert result == tmp_path / "new" / ".env"
        assert not result.exists()

    def test_target_exists_keeps_target(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        target = tmp_path / "new"
        target.mkdir()
        (target / ".env").write_text("EXISTING=1", encoding="utf-8")
        legacy = tmp_path / "legacy"
        legacy.mkdir()
        (legacy / ".env").write_text("LEGACY=1", encoding="utf-8")
        monkeypatch.setattr(paths, "get_env_file_path", lambda: target / ".env")
        monkeypatch.setattr(paths, "get_legacy_env_path", lambda: legacy / ".env")
        result = paths.migrate_env_if_needed()
        assert result.read_text(encoding="utf-8") == "EXISTING=1"

    def test_legacy_migrates_to_target(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        target = tmp_path / "new" / ".env"
        legacy = tmp_path / "legacy"
        legacy.mkdir()
        (legacy / ".env").write_text("MODEL_POOL=[1]", encoding="utf-8")
        monkeypatch.setattr(paths, "get_env_file_path", lambda: target)
        monkeypatch.setattr(paths, "get_legacy_env_path", lambda: legacy / ".env")
        result = paths.migrate_env_if_needed()
        assert result.exists()
        assert result.read_text(encoding="utf-8") == "MODEL_POOL=[1]"


class TestEnvPath:
    def test_get_env_file_creates_dir(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        cfg = tmp_path / "cfgdir"
        monkeypatch.setattr(paths, "get_user_config_dir", lambda: cfg)
        env = paths.get_env_file_path()
        assert env == cfg / ".env"
        assert cfg.exists()
