# 全栈 TypeScript 迁移计划（ADR-0006）

> 状态：已决策，实施中。任务票见 `.scratch/ts-migration/issues/`，架构决策见 `docs/adr/0006-fullstack-typescript-migration.md` 与 `0005-agent-centric-redesign.md`。

## 目标

后端 Python → TypeScript；前端保持 Vue3(TS)；全栈单语言、共享类型。

## 技术选型

| 层 | 选型 |
|---|---|
| 运行时 | Node.js 20+ |
| 后端框架 | Fastify（SSE 支持、轻量） |
| 语言 | TypeScript（strict） |
| schema | zod（替代 pydantic） |
| LLM | openai SDK(TS) + tiktoken(JS) |
| 存储 | 本地文件系统（沿用数据规范：作品库 + memory/） |
| 测试 | vitest（替代 pytest） |
| 包管理 | npm（或 pnpm） |

## 迁移任务（顺序）

1. **tsm-01 后端骨架**：package.json + tsconfig + Fastify + vitest + 分层目录
2. **tsm-02 LLM 层**：client + 多模型 manager + 异常 + 交互记录
3. **tsm-03 存储层**：project/memory/retriever/states + 沙箱（参考已写 Python 实现）
4. **tsm-04 agent 层**：ReAct + tools + ContextOrchestrator
5. **tsm-05 API 路由**：projects/settings/chat/workflow/config/interactions + SSE
6. **tsm-06 前端接入**：类型共享 + AgentWindow + 状态面板；删旧页
7. **tsm-07 测试迁移**：pytest 语义 → vitest；前后端补齐
8. **tsm-08 收尾**：移除 Python、更新文档、环境切换说明

## 阶段映射（对原批次）

| 原批次（Python） | TS 迁移对应 |
|---|---|
| 批次1 后端地基（T1/T5/T6/T7） | tsm-01~03（存储/检索/编排先以参考实现平移） |
| 批次2 Agent 工作流（T2/T4/T10） | tsm-04（tools + 编排器组装） |
| 批次3 前端（T3/T8） | tsm-06 |
| 批次4 正文/审阅（T9） | tsm-05~07（API + 测试迁移后实现） |

## 依赖取舍

- 搜索工具：原生 Bing 抓取（fetch，零 Key）→ 后续可接 Tavily/Serper
- 配置：zod + 环境变量（沿用 MODEL_POOL / MODEL_ASSIGNMENTS / MEMORY_RETRIEVAL_MODE 等键）

## 完成定义

- [ ] `npm run build` 通过（TS strict）
- [ ] `npm run test` 全绿（迁移后核心行为断言）
- [ ] 后端 API 行为与现 Python 版等价（SSE/ask_user/状态路由）
- [ ] 前端 Vue3 正常驱动 Agent 窗口 + 状态面板
- [ ] Python 代码冻结移除，README 更新为 TS 工作流
