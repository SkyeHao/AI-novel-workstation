"""LLM 交互记录持久化存储（SQLite）。

记录每次 LLM 调用的完整请求与响应，支持列表查看、详情查看、删除。
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime
from pathlib import Path

from loguru import logger

# 数据库文件路径：项目根目录 / data / interactions.db
# interaction_store.py → storage/ → ai_novel_workstation/ → src/ → 项目根目录
_DB_PATH = Path(__file__).resolve().parents[3] / "data" / "interactions.db"

# 线程锁，保证并发写入安全
_lock = threading.Lock()

_INITIALIZED = False


def _get_conn() -> sqlite3.Connection:
    """获取数据库连接（每次创建新连接，SQLite 轻量足够）。"""
    global _INITIALIZED
    if not _INITIALIZED:
        _init_db()
        _INITIALIZED = True

    conn = sqlite3.connect(str(_DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    """初始化数据库表。"""
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH))
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS interactions (
                id                          TEXT PRIMARY KEY,
                source                      TEXT NOT NULL DEFAULT 'chat',
                title                       TEXT NOT NULL DEFAULT '',
                model                       TEXT NOT NULL DEFAULT '',
                task_type                   TEXT NOT NULL DEFAULT '',
                temperature                 REAL NOT NULL DEFAULT 0.7,
                max_tokens                  INTEGER,
                finish_reason               TEXT NOT NULL DEFAULT '',
                prompt_tokens               INTEGER NOT NULL DEFAULT 0,
                completion_tokens           INTEGER NOT NULL DEFAULT 0,
                total_tokens                INTEGER NOT NULL DEFAULT 0,
                elapsed_ms                  INTEGER NOT NULL DEFAULT 0,
                error                       TEXT NOT NULL DEFAULT '',
                timestamp                   TEXT NOT NULL DEFAULT '',
                messages_json               TEXT NOT NULL DEFAULT '[]',
                functions_json              TEXT,
                function_call               TEXT,
                response_content            TEXT NOT NULL DEFAULT '',
                response_function_call_json TEXT,
                tool_name                   TEXT NOT NULL DEFAULT '',
                tool_args_json              TEXT NOT NULL DEFAULT '{}',
                tool_result                 TEXT NOT NULL DEFAULT '',
                tool_success                INTEGER NOT NULL DEFAULT 1,
                created_at                  TEXT NOT NULL DEFAULT '',
                session_id                  TEXT NOT NULL DEFAULT '',
                turn_id                     TEXT NOT NULL DEFAULT '',
                user_message                TEXT NOT NULL DEFAULT ''
            )
            """
        )

        # 数据库迁移：为旧表添加新列（如果不存在）
        cursor = conn.execute("PRAGMA table_info(interactions)")
        existing_cols = {row[1] for row in cursor.fetchall()}
        migrations = [
            ("tool_name", "TEXT NOT NULL DEFAULT ''"),
            ("tool_args_json", "TEXT NOT NULL DEFAULT '{}'"),
            ("tool_result", "TEXT NOT NULL DEFAULT ''"),
            ("tool_success", "INTEGER NOT NULL DEFAULT 1"),
            ("session_id", "TEXT NOT NULL DEFAULT ''"),
            ("turn_id", "TEXT NOT NULL DEFAULT ''"),
            ("user_message", "TEXT NOT NULL DEFAULT ''"),
        ]
        for col_name, col_def in migrations:
            if col_name not in existing_cols:
                conn.execute(f"ALTER TABLE interactions ADD COLUMN {col_name} {col_def}")
                logger.info(f"数据库迁移: 添加列 {col_name}")

        # 索引：按创建时间倒序查询、按来源筛选
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_interactions_created_at ON interactions(created_at DESC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_interactions_source ON interactions(source)"
        )
        conn.commit()
        logger.debug(f"交互记录数据库已初始化: {_DB_PATH}")
    finally:
        conn.close()


def save_interaction(
    source: str,
    interaction: dict,
    title: str = "",
    task_type: str = "",
    session_id: str = "",
    turn_id: str = "",
    user_message: str = "",
) -> str:
    """保存单条交互记录。

    Args:
        source: 来源标识，如 'chat' / 'stage1'
        interaction: 交互记录字典（来自 InteractionLogger.to_dict()）
        title: 可读标题（留空则自动从消息中提取）
        task_type: 任务类型
        session_id: 所属会话 ID（多轮对话），用于分组展示层级关系
        turn_id: 所属轮次 ID（同一轮内多次 LLM 调用共享），用于分组展示层级关系
        user_message: 触发本轮对话的用户消息
    Returns:
        记录 ID
    """
    record_id = str(uuid.uuid4())
    created_at = datetime.now().isoformat(timespec="seconds")

    # 自动生成标题：取第一条 user 消息的前 30 字
    if not title:
        messages = interaction.get("messages", [])
        for msg in messages:
            if msg.get("role") == "user" and msg.get("content"):
                title = msg["content"][:30]
                break
        if not title:
            title = interaction.get("response_content", "")[:30] or "无标题"

    messages_json = json.dumps(interaction.get("messages", []), ensure_ascii=False)
    functions = interaction.get("functions")
    functions_json = json.dumps(functions, ensure_ascii=False) if functions else None

    fc = interaction.get("function_call")
    function_call = json.dumps(fc, ensure_ascii=False) if fc is not None else None

    rfc = interaction.get("response_function_call")
    rfc_json = json.dumps(rfc, ensure_ascii=False) if rfc else None

    # 工具执行结果
    tool_name = interaction.get("tool_name", "")
    tool_args = interaction.get("tool_args", {})
    tool_args_json = json.dumps(tool_args, ensure_ascii=False) if tool_args else "{}"
    tool_result = interaction.get("tool_result", "")
    tool_success = 1 if interaction.get("tool_success", True) else 0

    with _lock:
        conn = _get_conn()
        try:
            conn.execute(
                """
                INSERT INTO interactions (
                    id, source, title, model, task_type, temperature, max_tokens,
                    finish_reason, prompt_tokens, completion_tokens, total_tokens,
                    elapsed_ms, error, timestamp, messages_json, functions_json,
                    function_call, response_content, response_function_call_json,
                    tool_name, tool_args_json, tool_result, tool_success,
                    created_at, session_id, turn_id, user_message
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record_id,
                    source,
                    title,
                    interaction.get("model", ""),
                    task_type,
                    interaction.get("temperature", 0.7),
                    interaction.get("max_tokens"),
                    interaction.get("finish_reason", ""),
                    interaction.get("prompt_tokens", 0),
                    interaction.get("completion_tokens", 0),
                    interaction.get("total_tokens", 0),
                    interaction.get("elapsed_ms", 0),
                    interaction.get("error", ""),
                    interaction.get("timestamp", ""),
                    messages_json,
                    functions_json,
                    function_call,
                    interaction.get("response_content", ""),
                    rfc_json,
                    tool_name,
                    tool_args_json,
                    tool_result,
                    tool_success,
                    created_at,
                    session_id,
                    turn_id,
                    user_message,
                ),
            )
            conn.commit()
            logger.debug(f"交互记录已保存: id={record_id}, source={source}")
            return record_id
        finally:
            conn.close()


def update_interaction_tool(
    record_id: str,
    tool_name: str,
    tool_args: dict,
    tool_result: str,
    tool_success: bool,
) -> bool:
    """更新已持久化交互记录的工具执行字段。

    工具在 LLM 调用之后执行，因此工具结果需要回填到已保存的记录。

    Returns:
        True 表示更新成功
    """
    with _lock:
        conn = _get_conn()
        try:
            cursor = conn.execute(
                """
                UPDATE interactions
                SET tool_name = ?, tool_args_json = ?, tool_result = ?, tool_success = ?
                WHERE id = ?
                """,
                (
                    tool_name,
                    json.dumps(tool_args, ensure_ascii=False),
                    tool_result,
                    1 if tool_success else 0,
                    record_id,
                ),
            )
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()


def list_interactions(
    source: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """查询交互记录列表（摘要字段）。

    Args:
        source: 按来源筛选（None 表示全部）
        limit: 每页数量
        offset: 偏移量

    Returns:
        (记录列表, 总数)
    """
    conn = _get_conn()
    try:
        if source:
            total = conn.execute(
                "SELECT COUNT(*) FROM interactions WHERE source = ?", (source,)
            ).fetchone()[0]
            rows = conn.execute(
                """
                SELECT id, source, title, model, task_type, total_tokens,
                       elapsed_ms, error, timestamp, created_at,
                       session_id, turn_id, user_message,
                       response_content, tool_result, tool_name
                FROM interactions
                WHERE source = ?
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                (source, limit, offset),
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) FROM interactions").fetchone()[0]
            rows = conn.execute(
                """
                SELECT id, source, title, model, task_type, total_tokens,
                       elapsed_ms, error, timestamp, created_at,
                       session_id, turn_id, user_message,
                       response_content, tool_result, tool_name
                FROM interactions
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()

        return [dict(r) for r in rows], total
    finally:
        conn.close()


def get_interaction(record_id: str) -> dict | None:
    """获取单条交互记录完整详情。"""
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM interactions WHERE id = ?", (record_id,)
        ).fetchone()
        if row is None:
            return None

        data = dict(row)
        # 反序列化 JSON 字段
        data["messages"] = json.loads(data.pop("messages_json", "[]"))
        functions_json = data.pop("functions_json", None)
        data["functions"] = json.loads(functions_json) if functions_json else None
        fc = data.pop("function_call", None)
        data["function_call"] = json.loads(fc) if fc else None
        rfc_json = data.pop("response_function_call_json", None)
        data["response_function_call"] = json.loads(rfc_json) if rfc_json else None
        # 反序列化工具参数
        tool_args_json = data.pop("tool_args_json", "{}")
        data["tool_args"] = json.loads(tool_args_json) if tool_args_json else {}
        # SQLite 用 INTEGER 存布尔值
        data["tool_success"] = bool(data.get("tool_success", 1))
        return data
    finally:
        conn.close()


def delete_interaction(record_id: str) -> bool:
    """删除单条交互记录。"""
    with _lock:
        conn = _get_conn()
        try:
            cursor = conn.execute(
                "DELETE FROM interactions WHERE id = ?", (record_id,)
            )
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()


def delete_interactions_by_session(session_id: str) -> int:
    """删除某会话下的全部交互记录（会话级删除）。

    Args:
        session_id: 会话 ID

    Returns:
        删除的记录数
    """
    with _lock:
        conn = _get_conn()
        try:
            cursor = conn.execute(
                "DELETE FROM interactions WHERE session_id = ?", (session_id,)
            )
            conn.commit()
            count = cursor.rowcount
            logger.info(f"按会话删除交互记录: session={session_id}, count={count}")
            return count
        finally:
            conn.close()


def clear_all_interactions(source: str | None = None) -> int:
    """清空交互记录。

    Args:
        source: 仅清空指定来源（None 表示全部）

    Returns:
        删除的记录数
    """
    with _lock:
        conn = _get_conn()
        try:
            if source:
                cursor = conn.execute(
                    "DELETE FROM interactions WHERE source = ?", (source,)
                )
            else:
                cursor = conn.execute("DELETE FROM interactions")
            conn.commit()
            count = cursor.rowcount
            logger.info(f"已清空 {count} 条交互记录 (source={source})")
            return count
        finally:
            conn.close()
