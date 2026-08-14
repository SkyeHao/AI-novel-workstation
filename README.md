# AI 小说工作站

工程化 AI 辅助长篇网络小说创作系统（20 万~500 万字量级）。

> 📌 **文档**：产品定义见 [docs/蓝图.md](./docs/蓝图.md)，技术设计见 [docs/技术设计.md](./docs/技术设计.md)，术语见 [CONTEXT.md](./CONTEXT.md)，决策记录见 [docs/adr/](./docs/adr/)。

## 快速开始

### 1. 安装依赖

```bash
# 克隆项目后，创建虚拟环境
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 安装项目（含开发依赖）
pip install -e ".[dev]"
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的 API Key 和模型配置
```

### 3. 使用 LLM Client

```python
import asyncio
from ai_novel_workstation.llm import LLMClientManager, ChatMessage, Role
from ai_novel_workstation.config.settings import LLMModelConfig

# ---- 方式一：从 .env 配置自动初始化 ----
manager = LLMClientManager.from_settings()

# 按任务类型获取 client
text_client = manager.get_client("text")       # 正文生成（大模型）
check_client = manager.get_client("check")     # 校验审稿（小模型）

# 同步调用
response = text_client.chat([
    ChatMessage(role=Role.SYSTEM, content="你是一个小说写作助手"),
    ChatMessage(role=Role.USER, content="写一段打斗场景"),
])
print(response.content)
print(f"Token 用量: {response.usage.total_tokens}")

# 异步调用
async def async_call():
    response = await check_client.achat([
        ChatMessage(role=Role.USER, content="检查这段文字是否有AI味"),
    ])
    print(response.content)

asyncio.run(async_call())

# 流式输出
for chunk in text_client.stream([
    ChatMessage(role=Role.USER, content="写一个开头"),
]):
    print(chunk, end="", flush=True)


# ---- 方式二：手动创建单个 client ----
from ai_novel_workstation.llm import LLMClient

client = LLMClient(LLMModelConfig(
    api_key="sk-xxx",
    base_url="https://api.deepseek.com/v1",  # 兼容任意 OpenAI 协议 API
    model="deepseek-chat",
    temperature=0.8,
))
response = client.chat([ChatMessage(role=Role.USER, content="你好")])
```

### 4. 运行测试

```bash
pytest tests/
```

## 项目结构

```
AI-novel-workstation/
├── src/ai_novel_workstation/     # 源代码
│   ├── agent/                    # ReAct Agent 与上下文管理
│   ├── api/                      # FastAPI 路由（项目/设定/会话/交互记录）
│   ├── config/                   # 配置与用户配置目录解析
│   ├── llm/                      # LLM 客户端、多模型管理、交互记录
│   ├── storage/                  # 存储层（项目/设定/交互记录/路径沙箱）
│   ├── tools/                    # 工具系统（web_search/file/ask_user）
│   └── workflow/                 # 工作流（IDEATION 会话、设定生成、prompt）
├── frontend/                     # Vue3 前端
├── tests/                        # 单元测试
├── docs/                         # 蓝图、技术设计、ADR 决策记录
├── data/                         # 运行数据（会话快照、交互记录库）
├── scripts/                      # 启动脚本
├── CONTEXT.md                    # 术语表
├── pyproject.toml                # 项目配置
├── .env.example                  # 环境变量模板
└── .gitignore
```

> 用户配置（`.env`）存于 `%APPDATA%\AI-Novel-Workstation\`，用户产物（小说项目）存于 `PROJECT_DIR`（默认 `%USERPROFILE%\Documents\AI-Novels`），均与代码分离。

## 支持的 LLM 服务

所有兼容 OpenAI Chat Completions API 协议的服务均可接入：

| 服务 | base_url | 示例 model |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | gpt-4o, gpt-4o-mini |
| DeepSeek | `https://api.deepseek.com/v1` | deepseek-chat |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-max, qwen-plus |
| Moonshot | `https://api.moonshot.cn/v1` | moonshot-v1-8k |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | glm-4 |
| 本地 Ollama | `http://localhost:11434/v1` | llama3, qwen2 |

## LLM Client 核心特性

- **OpenAI 协议兼容**：通过自定义 `base_url` 接入任意兼容服务
- **同步 + 异步**：`chat()` / `achat()` / `stream()` / `astream()`
- **流式输出**：逐 token 返回，支持 SSE
- **自动重试**：tenacity 指数退避，默认 3 次
- **Token 计数**：tiktoken 精确计数，支持预算管理
- **多模型路由**：按任务类型（正文/结构/校验）分配不同模型
- **降级策略**：大模型不可用时自动降级到小模型
- **异常分层**：认证/限流/超时/响应解析等 6 类异常
