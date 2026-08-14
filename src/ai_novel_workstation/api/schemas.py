"""API 请求/响应模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field

# ── 模型池 ──────────────────────────────────────────────────────

class ModelEntryOut(BaseModel):
    """模型条目输出（api_key 脱敏）。"""

    id: str = Field(description="模型唯一标识")
    name: str = Field(description="显示名称")
    provider_id: str = Field(description="服务商标识")
    api_key: str = Field(description="API Key（脱敏）")
    base_url: str = Field(description="API 基础地址")
    model: str = Field(description="模型名称")
    temperature: float = Field(description="默认温度")
    max_tokens: int | None = Field(default=None)
    timeout: float = Field(description="超时（秒）")
    max_retries: int = Field(description="重试次数")
    status: str = Field(default="untested", description="连接状态: untested/ok/failed")
    last_tested: str | None = Field(default=None, description="上次测试时间")


class ModelEntryCreate(BaseModel):
    """创建模型条目。"""

    name: str = Field(description="显示名称")
    provider_id: str = Field(default="custom")
    api_key: str = Field(description="API Key")
    base_url: str = Field(description="API 基础地址")
    model: str = Field(description="模型名称")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int | None = None
    timeout: float = Field(default=120.0, gt=0)
    max_retries: int = Field(default=3, ge=0, le=10)


class ModelEntryUpdate(BaseModel):
    """更新模型条目（所有字段可选，api_key 留空不修改）。"""

    name: str | None = None
    provider_id: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = None
    timeout: float | None = Field(default=None, gt=0)
    max_retries: int | None = Field(default=None, ge=0, le=10)


class ModelTestResult(BaseModel):
    """模型连接测试结果。"""

    success: bool
    message: str = Field(description="成功或错误信息")
    model: str = Field(default="")
    elapsed_ms: int = 0


# ── 任务分配 ────────────────────────────────────────────────────

class TaskAssignmentOut(BaseModel):
    """任务分配输出。"""

    task: str = Field(description="任务类型: text/structure/check")
    task_label: str = Field(description="任务中文名")
    model_id: str | None = Field(default=None, description="分配的模型ID")
    model_name: str | None = Field(default=None, description="模型显示名称")


class TaskAssignmentUpdate(BaseModel):
    """更新任务分配。"""

    model_id: str | None = Field(default=None, description="模型ID，设为 null 取消分配")


# ── 聊天 ────────────────────────────────────────────────────────

class ChatMessageIn(BaseModel):
    """聊天消息输入。"""

    role: str = Field(description="角色: system/user/assistant")
    content: str = Field(description="消息内容")


class ChatRequestIn(BaseModel):
    """聊天请求。"""

    task: str = Field(default="text", description="任务类型: text/structure/check")
    messages: list[ChatMessageIn] = Field(description="消息列表")
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = None


class LLMInteractionOut(BaseModel):
    """单次 LLM 交互记录输出。"""

    messages: list[dict] = Field(default_factory=list, description="请求消息列表")
    model: str = ""
    temperature: float = 0.7
    max_tokens: int | None = None
    functions: list[dict] | None = None
    function_call: str | dict | None = None
    response_content: str = ""
    response_function_call: dict | None = None
    finish_reason: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    # 工具执行结果
    tool_name: str = ""
    tool_args: dict = Field(default_factory=dict)
    tool_result: str = ""
    tool_success: bool = True
    elapsed_ms: int = 0
    error: str = ""
    timestamp: str = ""


class ChatResponseOut(BaseModel):
    """聊天响应。"""

    content: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    finish_reason: str = "stop"
    elapsed_ms: int = Field(description="耗时（毫秒）")
    interaction: LLMInteractionOut | None = Field(
        default=None, description="LLM 底层交互记录"
    )


class TokenCountRequest(BaseModel):
    """Token 计数请求。"""

    task: str = Field(default="text")
    messages: list[ChatMessageIn] = Field(description="消息列表")


class TokenCountResponse(BaseModel):
    """Token 计数响应。"""

    token_count: int


# ── 交互记录 ────────────────────────────────────────────────────

class InteractionListItem(BaseModel):
    """交互记录列表项（摘要）。"""

    id: str
    source: str = Field(description="来源: chat/stage1")
    title: str = ""
    model: str = ""
    task_type: str = ""
    total_tokens: int = 0
    elapsed_ms: int = 0
    error: str = ""
    timestamp: str = ""
    created_at: str = ""
    session_id: str = Field(default="", description="所属会话 ID（多轮对话分组用）")
    turn_id: str = Field(default="", description="所属轮次 ID（同轮多次调用分组用）")
    user_message: str = Field(default="", description="触发本轮对话的用户消息")
    response_content: str = Field(default="", description="LLM 响应文本（摘要展示用）")
    tool_result: str = Field(default="", description="工具执行结果（摘要展示用）")
    tool_name: str = Field(default="", description="触发的工具名")


class InteractionListResponse(BaseModel):
    """交互记录列表响应（分页）。"""

    items: list[InteractionListItem]
    total: int
    limit: int
    offset: int


class InteractionDetail(BaseModel):
    """交互记录完整详情。"""

    id: str
    source: str = ""
    title: str = ""
    model: str = ""
    task_type: str = ""
    temperature: float = 0.7
    max_tokens: int | None = None
    finish_reason: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    elapsed_ms: int = 0
    error: str = ""
    timestamp: str = ""
    session_id: str = Field(default="", description="所属会话 ID（多轮对话分组用）")
    turn_id: str = Field(default="", description="所属轮次 ID（同轮多次调用分组用）")
    user_message: str = Field(default="", description="触发本轮对话的用户消息")
    messages: list[dict] = Field(default_factory=list)
    functions: list[dict] | None = None
    function_call: str | dict | None = None
    response_content: str = ""
    response_function_call: dict | None = None
    # 工具执行结果
    tool_name: str = ""
    tool_args: dict = Field(default_factory=dict)
    tool_result: str = ""
    tool_success: bool = True
    created_at: str = ""


# ── 服务商 ──────────────────────────────────────────────────────

class ProviderModel(BaseModel):
    """服务商模型条目。"""

    name: str = Field(description="模型名称")
    label: str = Field(description="显示标签")
    recommended_for: list[str] = Field(default_factory=list, description="推荐任务类型: text/structure/check")


class ProviderInfo(BaseModel):
    """LLM 服务商信息。"""

    id: str = Field(description="服务商标识")
    name: str = Field(description="服务商名称")
    base_url: str = Field(description="API 基础地址")
    models: list[ProviderModel] = Field(default_factory=list, description="预置模型列表")
    website: str = Field(default="", description="获取 API Key 的网址")


# ── 项目目录 ────────────────────────────────────────────────────

class ProjectDirOut(BaseModel):
    """项目目录配置输出。"""

    project_dir: str = Field(description="项目默认目录（原始配置值）")
    absolute_path: str = Field(description="项目默认目录的绝对路径")
    exists: bool = Field(description="目录是否存在")


class ProjectDirUpdate(BaseModel):
    """项目目录配置更新。"""

    project_dir: str = Field(description="项目默认目录路径（相对或绝对）")


# ── 联网搜索配置 ──────────────────────────────────────────────────

class SearchConfigOut(BaseModel):
    """联网搜索配置输出（API Key 脱敏）。"""

    tavily_api_key: str = Field(default="", description="Tavily API Key（脱敏）")
    tavily_configured: bool = Field(default=False)
    serper_api_key: str = Field(default="", description="Serper API Key（脱敏）")
    serper_configured: bool = Field(default=False)
    providers: str = Field(default="", description="搜索源优先级（逗号分隔，空表示默认）")


class SearchConfigUpdate(BaseModel):
    """联网搜索配置更新。"""

    tavily_api_key: str = Field(default="", description="Tavily API Key（留空保持不变）")
    serper_api_key: str = Field(default="", description="Serper API Key（留空保持不变）")
    providers: str = Field(default="", description="搜索源优先级（逗号分隔，空恢复默认）")
