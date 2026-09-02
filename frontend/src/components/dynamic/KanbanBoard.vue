<template>
  <div class="kanban">
    <el-empty v-if="!entries.length" description="暂无伏笔台账" :image-size="90" />
    <div v-else class="kb-board">
      <div v-for="column in columns" :key="column.key" class="kb-col" :class="{ 'kb-col-overdue': column.key === 'overdue' }">
        <div class="kb-col-head">
          <span class="kb-col-title">{{ column.label }}</span>
          <span class="kb-col-count">{{ column.items.length }}</span>
        </div>
        <div class="kb-col-body">
          <div v-for="(item, index) in column.items" :key="index" class="kb-card" :class="{ 'kb-card-overdue': column.key === 'overdue' }">
            <div class="kb-card-head">
              <span v-if="item.planted_chapter" class="kb-chip">第 {{ item.planted_chapter }} 章埋</span>
              <span v-if="item.expected_chapter" class="kb-expected">期望 {{ item.expected_chapter }} 章</span>
            </div>
            <p class="kb-desc">{{ item.description }}</p>
          </div>
          <div v-if="!column.items.length" class="kb-col-empty">暂无</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  account: string
  entries: Array<Record<string, any>>
}>()

const currentChapter = computed(() => {
  const meta = (props.entries as unknown as { meta?: { last_chapter?: number } })?.meta
  if (meta && Number(meta.last_chapter) > 0) return Number(meta.last_chapter)
  let max = 0
  for (const item of props.entries) {
    max = Math.max(max, Number(item.planted_chapter) || 0)
  }
  return max || 0
})

const columns = computed(() => {
  const planted: Array<Record<string, any>> = []
  const pending: Array<Record<string, any>> = []
  const consumed: Array<Record<string, any>> = []
  const overdue: Array<Record<string, any>> = []
  for (const item of props.entries) {
    const status = String(item.status ?? '')
    const consumedNow = /消费|回收/.test(status)
    const expected = Number(item.expected_chapter) || 0
    if (consumedNow) {
      consumed.push(item)
    } else if (status.includes('悬置')) {
      pending.push(item)
    } else if (expected > 0 && currentChapter.value > expected) {
      overdue.push(item)
    } else {
      planted.push(item)
    }
  }
  return [
    { key: 'planted', label: '埋设', items: planted },
    { key: 'pending', label: '悬置', items: pending },
    { key: 'consumed', label: '消费', items: consumed },
    { key: 'overdue', label: '超期', items: overdue },
  ]
})
</script>

<style scoped>
.kanban { height: 100%; }
.kb-board {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
  padding: 2px;
}
.kb-col {
  background: #f8f9fc;
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 200px;
}
.kb-col-overdue { background: rgba(244, 63, 94, 0.04); border-color: rgba(244, 63, 94, 0.25); }
.kb-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px;
}
.kb-col-title { font-size: 13px; font-weight: 600; color: var(--text-title); }
.kb-col-overdue .kb-col-title { color: #e11d48; }
.kb-col-count {
  font-size: 11px;
  font-weight: 600;
  color: #4f46e5;
  background: rgba(79, 70, 229, 0.1);
  padding: 2px 8px;
  border-radius: 999px;
}
.kb-col-overdue .kb-col-count { color: #e11d48; background: rgba(244, 63, 94, 0.1); }
.kb-col-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.kb-card {
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
}
.kb-card-overdue {
  border-color: rgba(244, 63, 94, 0.45);
  box-shadow: 0 1px 6px rgba(244, 63, 94, 0.15);
}
.kb-card-head {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.kb-chip {
  font-size: 11px;
  color: #4f46e5;
  background: rgba(79, 70, 229, 0.1);
  padding: 1px 8px;
  border-radius: 999px;
}
.kb-expected {
  font-size: 11px;
  color: var(--text-secondary);
  background: #f2f3f7;
  padding: 1px 8px;
  border-radius: 999px;
}
.kb-card-overdue .kb-chip { color: #e11d48; background: rgba(244, 63, 94, 0.1); }
.kb-desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-primary);
}
.kb-col-empty {
  text-align: center;
  font-size: 12px;
  color: var(--text-placeholder);
  padding: 20px 0;
}
</style>
