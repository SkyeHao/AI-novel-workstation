<template>
  <div class="flow-timeline">
    <!-- 事件流：按章折叠 -->
    <template v-if="isEvents">
      <el-collapse v-model="openChapters" class="ev-collapse">
        <el-collapse-item v-for="group in chapters" :key="group.chapter" :name="group.chapter">
          <template #title>
            <div class="ev-ch-title">
              <el-tag size="small" effect="dark" round>第 {{ group.chapter }} 章</el-tag>
              <span class="ev-ch-count">{{ group.items.length }} 个事件</span>
            </div>
          </template>
          <div class="ev-list">
            <div v-for="(eventItem, index) in group.items" :key="index" class="ev-item">
              <span class="ev-dot" />
              <span class="ev-text">{{ eventItem.description }}</span>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
      <el-empty v-if="!chapters.length" description="暂无事件流" :image-size="90" />
    </template>

    <!-- 故事时间线 -->
    <template v-else-if="isTimeline">
      <el-timeline v-if="timelineEntries.length" class="tl-list">
        <el-timeline-item v-for="(item, index) in timelineEntries" :key="index" :timestamp="String(item.time || '')" placement="top" type="primary">
          <div class="tl-card">{{ item.event }}</div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="暂无时间线" :image-size="90" />
    </template>

    <!-- 章节摘要 -->
    <template v-else>
      <div v-if="summaryEntries.length" class="sum-grid">
        <div v-for="summary in summaryEntries" :key="summary.chapter" class="sum-card lift-card">
          <div class="sum-head">
            <el-tag size="small" effect="dark" round>第 {{ summary.chapter }} 章</el-tag>
            <span v-if="summary.word_count" class="sum-words">{{ summary.word_count }} 字</span>
          </div>
          <p class="sum-text">{{ summary.summary }}</p>
          <div v-if="summary.hook" class="sum-hook">
            <span class="sum-hook-tag">{{ hookType(summary.hook) }}</span>
            <span class="sum-hook-text">{{ hookText(summary.hook) }}</span>
          </div>
        </div>
      </div>
      <el-empty v-else description="暂无章节摘要" :image-size="90" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  account: string
  entries: Array<Record<string, any>>
}>()

const isEvents = computed(() => props.account === 'events')
const isTimeline = computed(() => props.account === 'timeline')

const openChapters = ref<Array<string | number>>([])

const chapters = computed(() => {
  const map = new Map<number, Array<Record<string, any>>>()
  for (const item of props.entries) {
    const chapter = Number(item.chapter ?? 0) || 0
    if (!map.has(chapter)) map.set(chapter, [])
    map.get(chapter)!.push(item)
  }
  return [...map.entries()]
    .map(([chapter, items]) => ({ chapter, items }))
    .sort((a, b) => a.chapter - b.chapter)
})

const timelineEntries = computed(() =>
  [...props.entries].sort((a, b) => String(a.time ?? '').localeCompare(String(b.time ?? ''), 'zh-Hans-CN'))
)

const summaryEntries = computed(() =>
  [...props.entries].sort((a, b) => (Number(a.chapter) || 0) - (Number(b.chapter) || 0))
)

function hookType(hook: unknown): string {
  if (!hook) return '章尾钩子'
  if (typeof hook === 'string') return '章尾钩子'
  return String((hook as Record<string, unknown>).type || '章尾钩子')
}

function hookText(hook: unknown): string {
  if (!hook) return ''
  if (typeof hook === 'string') return hook
  return String((hook as Record<string, unknown>).content || '')
}
</script>

<style scoped>
.flow-timeline { height: 100%; }
.ev-collapse { border: none; }
.ev-collapse :deep(.el-collapse-item__header) {
  height: 44px;
  border-bottom: 1px solid var(--border-color-light);
  background: transparent;
}
.ev-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: none;
  background: transparent;
}
.ev-ch-title { display: flex; align-items: center; gap: 10px; }
.ev-ch-count { font-size: 12px; color: var(--text-secondary); }
.ev-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 6px 2px 14px;
}
.ev-item { display: flex; gap: 10px; align-items: flex-start; }
.ev-dot {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4f46e5, #2563eb);
}
.ev-text { font-size: 13px; line-height: 1.7; color: var(--text-primary); }
.tl-list { padding: 4px 6px 8px 2px; }
.tl-card {
  padding: 10px 14px;
  border: 1px solid var(--border-color-light);
  border-radius: 10px;
  background: #fff;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
  box-shadow: var(--card-shadow);
}
.sum-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
  padding: 2px;
}
.sum-card {
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sum-head { display: flex; align-items: center; justify-content: space-between; }
.sum-words { font-size: 12px; color: var(--text-secondary); }
.sum-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-primary);
}
.sum-hook {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(79, 70, 229, 0.08), rgba(37, 99, 235, 0.06));
  border: 1px solid rgba(79, 70, 229, 0.18);
}
.sum-hook-tag {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  color: #4f46e5;
  background: rgba(79, 70, 229, 0.12);
  padding: 2px 8px;
  border-radius: 999px;
}
.sum-hook-text { font-size: 13px; color: var(--text-primary); line-height: 1.7; }
</style>
