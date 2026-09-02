<template>
  <SettingsTabLoader :fetcher="fetchData" empty-text="暂无章尾钩子">
    <template #default="{ data }">
      <div class="hooks-wrap">
        <div class="hook-col">
          <div class="hook-col-head">
            <span class="hook-col-title">待衔接</span>
            <span class="hook-count">{{ activeOf(data).length }}</span>
          </div>
          <el-empty v-if="!activeOf(data).length" description="暂无待衔接钩子" :image-size="72" />
          <div v-else class="hook-list">
            <div v-for="h in activeOf(data)" :key="h.chapter" class="hook-card">
              <div class="hook-head">
                <span class="hook-chip chapter">第 {{ h.chapter }} 章</span>
                <span v-if="h.type" class="hook-chip type">{{ h.type }}</span>
              </div>
              <p class="hook-content">{{ h.content }}</p>
            </div>
          </div>
        </div>
        <div class="hook-col">
          <div class="hook-col-head">
            <span class="hook-col-title">已回收</span>
            <span class="hook-count">{{ reapedOf(data).length }}</span>
          </div>
          <el-empty v-if="!reapedOf(data).length" description="暂无已回收钩子" :image-size="72" />
          <div v-else class="hook-list">
            <div v-for="h in reapedOf(data)" :key="h.chapter" class="hook-card reaped">
              <div class="hook-head">
                <span class="hook-chip chapter">第 {{ h.chapter }} 章</span>
                <span v-if="h.type" class="hook-chip type">{{ h.type }}</span>
                <span v-if="h.reaped_chapter" class="hook-chip reaped-tag">→ 第 {{ h.reaped_chapter }} 章回收</span>
              </div>
              <p class="hook-content">{{ h.content }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </SettingsTabLoader>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { getDynamicAccount } from '@/api'
import SettingsTabLoader from '@/components/SettingsTabLoader.vue'

const route = useRoute()
const projectId = route.params.id as string
const fetchData = async () => (await getDynamicAccount(projectId, 'hooks')).data.data
const entriesOf = (data: any) => (Array.isArray(data?.entries) ? data.entries : [])
const isReaped = (h: any) => String(h?.status ?? '').includes('reaped') || Number(h?.reaped_chapter) > 0
const activeOf = (data: any) => entriesOf(data).filter((h: any) => !isReaped(h))
const reapedOf = (data: any) => entriesOf(data).filter((h: any) => isReaped(h))
</script>

<style scoped>
.hooks-wrap {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 14px;
  padding: 2px;
}
.hook-col {
  background: #f8f9fc;
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 180px;
}
.hook-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px;
}
.hook-col-title { font-size: 13px; font-weight: 600; color: var(--text-title); }
.hook-count {
  font-size: 11px;
  font-weight: 600;
  color: #4f46e5;
  background: rgba(79, 70, 229, 0.1);
  padding: 2px 8px;
  border-radius: 999px;
}
.hook-list { display: flex; flex-direction: column; gap: 10px; }
.hook-card {
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
}
.hook-card.reaped { opacity: 0.78; background: #fbfbfd; }
.hook-head { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.hook-chip { font-size: 11px; padding: 1px 8px; border-radius: 999px; }
.hook-chip.chapter { color: #4f46e5; background: rgba(79, 70, 229, 0.1); }
.hook-chip.type { color: #0f766e; background: rgba(20, 184, 166, 0.12); }
.hook-chip.reaped-tag { color: var(--text-secondary); background: #f2f3f7; }
.hook-content { margin: 0; font-size: 12.5px; line-height: 1.7; color: var(--text-primary); }
</style>