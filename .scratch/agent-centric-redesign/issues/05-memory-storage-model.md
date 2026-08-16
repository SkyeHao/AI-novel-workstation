# 决策票 05：memory-storage-model

Type: prototype
Status: resolved
Blocked by: 01

## Question

单书记忆存储模型：正典事实(facts.jsonl)、人物/伏笔网络、分层摘要(L1~L5)的结构与落盘；如何用两级状态索引。这是记忆 RAG 的骨架。


## Answer

单书记忆存储模型已定（记忆层骨架，供 T6/T7/T2 使用）。四类记忆 + 两级状态索引：

- **记忆四类**：
  1. **正典事实** `memory/facts.jsonl`（append-only）——原子事实，每条 `{id, ts, fact, source, state, known_by[], superseded_by?}`；粒度=每条一句话可独立断言；更正用「追加新条 + 给旧条标 superseded」而非覆盖。
  2. **人物/关系快照** `memory/characters.json`（json，整体重写）——人物卡片当前状态 + 关系网络（配合 `settings/characters.json`，快照为一致性校验用）。
  3. **伏笔台账** `memory/foreshadow.jsonl`（append-only）——全书伏笔 `{id, desc, planted_at(ch), reaped_at?, planned_reap?, status}`；伏笔管理（横切）状态的依据。
  4. **分层摘要** `memory/summaries/L{1..5}.json`（json，原子重写）——L1 单章 → L5 全书，逐级归并。

- **两级状态索引（Q2-C）**：按类型分文件 + 每条记录带 `state`（小说级状态 key）与 `source`（工作单元 id，如 ch12）标签。T7 可「按状态」或「按类型」召回。

- **摘要驱动（Q4=A，全自动）**：每次状态工作流落盘后，状态机自动触发对应摘要沉淀（LL1 每章、L2 语义归并、L4 卷末、L5 全书），不依赖实时汇编。

- **落盘（Q5-B）**：append-only 用 jsonl（facts/伏笔），可重写快照用 json（人物/分层摘要）。

- 实现形态：新增 `storage/memory_store.py`（沿用 settings_store 的 store + 类型→文件约定），目录 `memory/`（project 已建 `memory/summaries`）。路径一律经 `safe_resolve` 沙箱校验。
