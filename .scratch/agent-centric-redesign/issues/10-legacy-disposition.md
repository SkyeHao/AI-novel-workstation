# 决策票 10：legacy-disposition

Type: task
Status: resolved
Blocked by: 08,09

## Question

对既有实现的处置：IDEATION 会话、setting store、路径沙箱、核心要素 JSON、旧 104 测试，哪些保留/重构/废弃。依赖前端与功能实现的取舍。
## Answer
删 stage1（创意孵化从零写，保留核心要素JSON与SSE/ask_user机制）；存储层保留并对齐记忆；ContextManager→ContextOrchestrator；前端全新建、LLM层保留；测试分类迁移。规划完成。


