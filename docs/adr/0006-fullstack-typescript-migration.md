# 0006：全栈 TypeScript 重构 —— 后端从 Python 迁移到 TS

将后端从 Python（FastAPI + pydantic + openai SDK）迁移到 TypeScript（Node + Fastify + openai SDK + zod），前端保持 Vue3 + TS，最终全栈单语言、共享类型定义。

## 决策

- **范围**：后端 Python → TypeScript；前端保持 Vue3（已是 TS）；前后端共享 API 类型定义。
- **方式**：渐进重写——先 LLM 层 + 存储层 + API 骨架，跑绿后再平移 agent/记忆/编排，最后前端接入。
- **测试**：行为平移——pytest 161 用例语义 → vitest，不逐行抄，保留核心行为断言。
- **参考实现**：已写的 `states.py` / `memory_store.py` / `retriever.py` / `orchestrator.py` 作为参考实现平移成 TS，设计不废弃。

## 原因

产品定位（Agent 中心 + 状态机 + 记忆/上下文编排）是语言无关的设计；全栈 TS 带来单语言工具链、前后端共享类型、单一包管理，降低长期维护成本。当前 Python 后端代码量小（批次 1 仅 4 个新文件），迁移沉没成本最低。

## 后果

- ADR-0005 的架构决策（状态机/记忆/编排/Agent 窗口）**保持有效**，本 ADR 只改其实现语言与载体。
- ADR-0001「保留已验证底座」在语言层面不再适用——底座（LLM/agent/tools/storage/API）全部以 TS 重写；行为语义保留。
- Python 现有代码将冻结并在迁移完成后移除；迁移期间 Python 侧冻结新增功能。
- 依赖取舍：`ddgs` 无 TS 等价，搜索工具先用原生 Bing 抓取（零 Key），后续可接 Tavily/Serper。
- 测试框架 pytest → vitest；运行环境 uv/venv → npm/pnpm + Node。
