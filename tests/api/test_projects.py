"""项目路由 API 测试。"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from ai_novel_workstation.api.app import app
from ai_novel_workstation.storage.project_store import reset_project_store


def _install_store(tmp_path: Path, monkeypatch) -> None:
    """将项目存储单例指向临时目录。"""
    from ai_novel_workstation.api import state

    reset_project_store()
    monkeypatch.setattr(state, "_project_dir", str(tmp_path / "workspace"))
    monkeypatch.setattr(state, "_initialized", True)
    # 重新初始化单例（基于新的 PROJECT_DIR）
    from ai_novel_workstation.storage.project_store import ProjectStore

    ProjectStore(state.get_project_dir_path())


def test_projects_crud(tmp_path: Path, monkeypatch) -> None:
    _install_store(tmp_path, monkeypatch)
    client = TestClient(app)

    # 空列表
    resp = client.get("/api/projects")
    assert resp.status_code == 200
    assert resp.json() == []

    # 创建
    resp = client.post(
        "/api/projects",
        json={"name": "我的书", "genre": "玄幻", "idea": "少年修仙", "target_words": 2000000},
    )
    assert resp.status_code == 200
    proj = resp.json()
    assert proj["name"] == "我的书"
    assert proj["idea"] == "少年修仙"
    assert proj["genre"] == "玄幻"
    assert proj["status"] == "ideation"

    pid = proj["id"]

    # 列表含一条
    resp = client.get("/api/projects")
    assert len(resp.json()) == 1

    # 详情
    resp = client.get(f"/api/projects/{pid}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "我的书"

    # 更新状态 + 类型
    resp = client.put(f"/api/projects/{pid}", json={"status": "setting", "platform": "fanqie", "genre": "系统流"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "setting"
    assert resp.json()["platform"] == "fanqie"
    assert resp.json()["genre"] == "系统流"

    # 重名创建 400
    resp = client.post("/api/projects", json={"name": "我的书"})
    assert resp.status_code == 400

    # 删除
    resp = client.delete(f"/api/projects/{pid}")
    assert resp.status_code == 200
    resp = client.get(f"/api/projects/{pid}")
    assert resp.status_code == 404


def test_project_unknown_returns_404(tmp_path: Path, monkeypatch) -> None:
    _install_store(tmp_path, monkeypatch)
    client = TestClient(app)
    resp = client.get("/api/projects/不存在")
    assert resp.status_code == 404


def test_settings_save_and_get(tmp_path: Path, monkeypatch) -> None:
    _install_store(tmp_path, monkeypatch)
    client = TestClient(app)
    pid = client.post("/api/projects", json={"name": "书"}).json()["id"]

    # 默认结构
    resp = client.get(f"/api/projects/{pid}/settings/worldview")
    assert resp.status_code == 200
    assert resp.json()["sections"]["era"] == ""

    # 保存
    body = {"sections": {"era": "玄幻", "rules": "", "geography": "", "factions": "", "history": ""}}
    resp = client.put(f"/api/projects/{pid}/settings/worldview", json=body)
    assert resp.status_code == 200

    # 读回
    resp = client.get(f"/api/projects/{pid}/settings/worldview")
    assert resp.json()["sections"]["era"] == "玄幻"


def test_prereq_check(tmp_path: Path, monkeypatch) -> None:
    _install_store(tmp_path, monkeypatch)
    client = TestClient(app)
    pid = client.post("/api/projects", json={"name": "书"}).json()["id"]

    # 初始：全部缺失
    resp = client.get(f"/api/projects/{pid}/prereq-check")
    assert resp.status_code == 200
    body = resp.json()
    assert body["complete"] is False
    assert len(body["missing"]) == 4

    # 生成一类后：worldview 就绪
    client.put(
        f"/api/projects/{pid}/settings/worldview",
        json={"sections": {"era": "玄幻", "rules": "", "geography": "", "factions": "", "history": ""}},
    )
    resp = client.get(f"/api/projects/{pid}/prereq-check")
    assert resp.json()["details"]["worldview"] is True
    assert resp.json()["missing"] == ["人物卡片", "大纲规划", "风格设定"]


def test_delete_project_removes_sessions(tmp_path: Path, monkeypatch) -> None:
    """删除项目应同步删除其会话快照，避免同名新项目恢复旧会话。"""
    _install_store(tmp_path, monkeypatch)
    import json as _json

    from ai_novel_workstation.workflow import stage1_session as mod

    # 用临时会话目录（指向测试目录）
    sessions_dir = tmp_path / "sessions"
    monkeypatch.setattr(mod, "_SESSIONS_DIR", sessions_dir)

    client = TestClient(app)
    pid = client.post("/api/projects", json={"name": "同名书"}).json()["id"]

    # 写入该项目的一个会话快照
    sessions_dir.mkdir(parents=True, exist_ok=True)
    snap = {
        "session_id": "sess-1",
        "project_id": pid,
        "project_name": "同名书",
        "done": False,
        "messages": [],
    }
    (sessions_dir / "sess-1.json").write_text(_json.dumps(snap, ensure_ascii=False), encoding="utf-8")

    # 删除项目
    resp = client.delete(f"/api/projects/{pid}")
    assert resp.status_code == 200

    # 会话快照应被删除
    assert not (sessions_dir / "sess-1.json").exists()


def test_vision_doc_endpoint(tmp_path: Path, monkeypatch) -> None:
    """读取愿景文档接口：存在/不存在两种情况。"""
    _install_store(tmp_path, monkeypatch)
    client = TestClient(app)
    pid = client.post("/api/projects", json={"name": "书"}).json()["id"]

    # 不存在
    resp = client.get(f"/api/projects/{pid}/vision-doc")
    assert resp.status_code == 200
    assert resp.json()["exists"] is False

    # 写入后存在
    from ai_novel_workstation.storage.project_store import get_project_store

    root = get_project_store().project_root(pid)
    (root / "故事愿景文档.md").write_text("# 测试愿景\n\n核心梗：测试", encoding="utf-8")
    resp = client.get(f"/api/projects/{pid}/vision-doc")
    assert resp.status_code == 200
    body = resp.json()
    assert body["exists"] is True
    assert "测试愿景" in body["content"]


def test_documents_list_endpoint(tmp_path: Path, monkeypatch) -> None:
    """列出项目内所有 Markdown 文档。"""
    _install_store(tmp_path, monkeypatch)
    client = TestClient(app)
    pid = client.post("/api/projects", json={"name": "书"}).json()["id"]

    from ai_novel_workstation.storage.project_store import get_project_store

    root = get_project_store().project_root(pid)
    (root / "故事愿景文档.md").write_text("# 愿景", encoding="utf-8")
    chapters = root / "chapters"
    chapters.mkdir(exist_ok=True)
    (chapters / "1.md").write_text("# 第一章", encoding="utf-8")
    (chapters / "2.md").write_text("# 第二章", encoding="utf-8")

    resp = client.get(f"/api/projects/{pid}/documents")
    assert resp.status_code == 200
    docs = resp.json()["documents"]
    names = [d["name"] for d in docs]
    assert "故事愿景文档.md" in names
    assert "1.md" in names
    assert "2.md" in names
    # 含相对路径
    assert any(d["path"] == "chapters/1.md" for d in docs)
