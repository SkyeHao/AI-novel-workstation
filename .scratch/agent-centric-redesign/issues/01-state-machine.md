# 决策票 01：state-machine

Type: grilling
Status: resolved
Blocked by:

## Question

定义两级状态模型：小说级 + 工作单元级；可扩展状态集（预置 创意孵化/世界观/章纲/正文/审阅，允许每书选启用）；状态=上下文标签、自由导航、向前可触发前置检查。这是全部下游的骨架。

## Answer

两级状态机模型已定（作为全部下游的接口契约）：

- **小说级状态 = 状态节点对象集合**：`{key, label, panel, context_assembly_ref, enabled}`。无强制转移关系（自由导航）；单锚点 `current_state`（Agent 窗口聚焦一个状态）。
- **工作单元级状态**：章节/设定/卷等各有独立进度状态（章节沿用 PENDING→GENERATED→FINALIZED→REVIEWED）；进行中工作单元集合始终存在，由两级状态耦合成。
- **完整默认状态集（可扩展 + 每书选启用）**：
  1. 创意孵化（IDEA→核心要素 JSON + 愿景；对应旧 IDEATION）
  2. 世界观（时代/规则/地理/阵营/历史 + 文风风格并入）
  3. 人物（人物卡片墙：主角/配角/反派 + 关系）
  4. 章纲（四级大纲，含伏笔埋/收标记）
  5. 正文（逐章生成/阅读/选段修改）
  6. 审阅（审阅 + 去AI味，逐章回溯）
  7. 伏笔管理（横切、可选启用的全书伏笔台账）

- **旧映射（Q4-A）**：直接改写 `Project.status` 语义与枚举，替换为新状态集；世界观+人物+章纲 取代旧 `setting`，创意孵化 取代 `ideation`，正文/审阅替换 writing/reviewing。
