<template>
  <div class="settings-view">
    <PageHeader title="静态设定" subtitle="故事愿景 · 世界观 · 人物 · 大纲 · 风格规范" icon="Notebook">
      <template #actions>
        <el-tag size="small" type="info" effect="plain" round>{{ activeLabel }}</el-tag>
      </template>
    </PageHeader>

    <div class="st-stats">
      <button
        v-for="item in settings"
        :key="item.type"
        class="st-stat-chip"
        :class="{ active: item.type === activeTab }"
        @click="goTab(item.type)"
      >
        <span class="st-stat-label">{{ item.label }}</span>
        <span class="st-stat-count" :class="{ empty: !item.exists }">{{ item.count }}</span>
      </button>
    </div>

    <div class="st-content">
      <VisionTab v-if="activeTab === 'vision'" />
      <WorldviewTab v-else-if="activeTab === 'worldview'" />
      <CharactersTab v-else-if="activeTab === 'characters'" />
      <OutlineTab v-else-if="activeTab === 'outline'" />
      <StyleTab v-else-if="activeTab === 'style'" :project-id="projectId" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '@/components/PageHeader.vue'
import { getSettingsSummary } from '@/api'
import VisionTab from '@/components/settings/VisionTab.vue'
import WorldviewTab from '@/components/settings/WorldviewTab.vue'
import CharactersTab from '@/components/settings/CharactersTab.vue'
import OutlineTab from '@/components/settings/OutlineTab.vue'
import StyleTab from '@/components/settings/StyleTab.vue'

const route = useRoute()
const projectId = route.params.id as string
const router = useRouter()
const activeTab = ref((route.query.tab as string) || 'vision')

const TAB_LABELS: Record<string, string> = {
  vision: '故事愿景',
  worldview: '世界观构建',
  characters: '人物塑造',
  outline: '大纲',
  style: '风格规范',
}

const activeLabel = computed(() => TAB_LABELS[activeTab.value] || activeTab.value)

const settings = ref<Array<{ type: string; label: string; exists: boolean; count: number }>>([])

onMounted(async () => {
  try {
    const res = await getSettingsSummary(route.params.id as string)
    settings.value = res.data.settings
  } catch {
    settings.value = Object.entries(TAB_LABELS).map(([type, label]) => ({ type, label, exists: false, count: 0 }))
  }
})

function goTab(tab: string) {
  activeTab.value = tab
  router.replace({ query: { ...route.query, tab } })
}

watch(() => route.query.tab, (tab) => {
  if (tab && tab !== activeTab.value) {
    activeTab.value = tab as string
  }
})
</script>

<style scoped>
.settings-view {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 120px);
}
.st-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.st-stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border: 1px solid var(--border-color-light);
  border-radius: 999px;
  background: #fff;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.st-stat-chip:hover {
  border-color: #4f46e5;
  background: #f5f5ff;
}
.st-stat-chip.active {
  border-color: #4f46e5;
  background: linear-gradient(135deg, #4f46e5, #2563eb);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
}
.st-stat-label { font-size: 12.5px; color: var(--text-regular); }
.st-stat-chip.active .st-stat-label { color: #fff; }
.st-stat-count {
  font-size: 11px;
  font-weight: 600;
  color: #4f46e5;
  background: rgba(79, 70, 229, 0.1);
  padding: 1px 8px;
  border-radius: 999px;
}
.st-stat-count.empty { color: #909399; background: rgba(144, 147, 153, 0.12); }
.st-stat-chip.active .st-stat-count { color: #fff; background: rgba(255, 255, 255, 0.25); }
.st-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 2px;
}
</style>










