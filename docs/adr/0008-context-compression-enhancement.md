# 0008：上下文压缩增强 —— 模型感知窗口 + 阈值自动压缩 + Agent 主动压缩工具

扩展 ADR-0007 实现层的压缩机制，将被动「超限才裁剪」升级为「模型感知 + 阈值触发 + 摘要持久化 + Agent 主动控制」的四机制协同。

## 决策

- **模型感知窗口**：建立「模型 → 上下文窗口」映射表 `MODEL_CONTEXT_MAP`（按 provider/model 匹配）；回退链：显式配置（`MODEL_CONTEXT_WINDOW` / `LLMModelConfig`）→ 映射表 → 默认 32768。text/structure/check 按各自模型分别查窗口。预算 = 窗口 − 保留输出余量（默认 2048）。
- **阈值自动压缩**：每轮组装后估计占用 ≥ `compression_ratio`（默认 0.80，`CONTEXT_COMPRESSION_RATIO` 可配）即触发压缩，目标压到 `target_ratio`（默认 0.60）以下，留足后续读取/输出余量；已在阈值内不压缩（防抖动）。
- **摘要持久化 + 保留最近对话**：压缩保留最近 N 条消息原样（默认 12，`keep_recent` 可配），更早历史由 LLM 压成四类要点（作者核心需求/已确认决策/已完成动作/待办），**持久化**到 `memory/sessions/<session_id>.summary.json`（覆盖式）；会话重开/恢复先加载摘要再注入系统提示。对话摘要与分层摘要 L1~L5 解耦（前者记协作过程、后者记故事内容）。
- **Agent 主动压缩工具** `compress_context`：参数 `reason` / `keep_recent`；Agent 在「大量读取前 / 复杂操作后 / 观察到占用较高」时自行调用。自动触发是兜底（硬水位），Agent 主动是优化（提前腾空间）。
- **降级链沿用**：硬块（系统提示/节点指令/用户本轮输入）不可裁；软块按各节点优先级 裁块 → 压块 → 摘要兜底（L2→L1…）→ 熔断。每次压缩记录触发方式与压缩前后占用。

## 原因

不同模型上下文窗口差异巨大（8k~200k），统一 32768 不准确；被动等超限才裁剪会撞墙且压缩突然后丢失大量协作历史；Agent 是创作中枢、全知视角，需要工具化的上下文自控手段来支撑「大量读取前主动腾空间」的创作场景。

## 后果

- 修订 `docs/design/workflow-node-designs.md` 1.2 节（四机制 + 块分级降级链）。
- 实现影响：`TokenCompressor` 增窗口解析（模型映射表）、阈值检测、保留最近 N、摘要持久化；`ContextOrchestrator.process` turn 前做阈值检测；Agent 工具集新增 `compress_context`；会话恢复逻辑加载 `.summary.json`。
- 环境变量新增：`CONTEXT_COMPRESSION_RATIO`（默认 0.80）、`CONTEXT_TARGET_RATIO`（默认 0.60）、`CONTEXT_KEEP_RECENT`（默认 12）；`MODEL_CONTEXT_MAP` 支持内置映射表或配置文件覆盖。
