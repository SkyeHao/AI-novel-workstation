<template>
  <SettingsTabLoader :fetcher="fetchData" empty-text="暂无故事愿景文档">
    <template #default="{ data }">
      <div class="vision-wrap">
        <div class="vision-meta" v-if="data.path">
          <el-icon><Document /></el-icon>
          <span class="mono">{{ data.path }}</span>
          <el-tag size="small" type="success" effect="plain" round>已生成</el-tag>
        </div>
        <div class="vision-doc panel">
          <div class="panel-body">
            <MarkdownView :content="data.content || ''" />
          </div>
        </div>
      </div>
    </template>
  </SettingsTabLoader>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { getVisionDoc } from '@/api'
import SettingsTabLoader from '@/components/SettingsTabLoader.vue'
import MarkdownView from '@/components/MarkdownView.vue'

const route = useRoute()
const projectId = route.params.id as string
/** 不存在时返回 null -> 触发空态 */
const fetchData = async () => {
  const res = await getVisionDoc(projectId)
  return res.data.exists ? res.data : null
}
</script>

<style scoped>
.vision-wrap { display: flex; flex-direction: column; gap: 12px; }
.vision-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #fafafa;
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.vision-meta .el-icon { color: #6366f1; }
</style>
