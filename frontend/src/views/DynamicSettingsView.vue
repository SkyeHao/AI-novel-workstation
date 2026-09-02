<template>
  <div class="settings-view">
    <PageHeader title="动态设定" subtitle="随故事演进自动更新：人物状态 · 地点 · 物品 · 事件 · 伏笔" icon="DataBoard">
      <template #actions>
        <el-tag size="small" type="info" effect="plain" round>{{ activeLabel }}</el-tag>
      </template>
    </PageHeader>

    <div class="dyn-notice">
      <el-icon><InfoFilled /></el-icon>
      <span>动态设定由正文生成章末自动回写，此处仅供只读浏览；直接修改可能影响 Agent 上下文的一致性。</span>
    </div>

    <div class="dyn-stats">
      <button
        v-for="account in accounts"
        :key="account.account"
        class="dyn-stat-chip"
        :class="{ active: account.account === activeTab }"
        @click="goTab(account.account)"
      >
        <span class="dyn-stat-label">{{ account.label }}</span>
        <span class="dyn-stat-count">{{ account.count }}</span>
      </button>
    </div>

    <div class="dyn-content">
      <CharactersStatusTab v-if="activeTab === 'characters'" />
      <LocationsTab v-else-if="activeTab === 'locations'" />
      <ItemsTab v-else-if="activeTab === 'items'" />
      <EventsTab v-else-if="activeTab === 'events'" />
      <TimelineTab v-else-if="activeTab === 'timeline'" />
      <ForeshadowTab v-else-if="activeTab === 'foreshadow'" />
      <InfoPerspectiveTab v-else-if="activeTab === 'info_perspective'" />
      <ChapterSummariesTab v-else-if="activeTab === 'chapter_summaries'" />
      <HooksTab v-else-if="activeTab === 'hooks'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { InfoFilled } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { getDynamicAccounts } from '@/api'
import CharactersStatusTab from '@/components/dynamic/CharactersStatusTab.vue'
import LocationsTab from '@/components/dynamic/LocationsTab.vue'
import ItemsTab from '@/components/dynamic/ItemsTab.vue'
import EventsTab from '@/components/dynamic/EventsTab.vue'
import TimelineTab from '@/components/dynamic/TimelineTab.vue'
import ForeshadowTab from '@/components/dynamic/ForeshadowTab.vue'
import InfoPerspectiveTab from '@/components/dynamic/InfoPerspectiveTab.vue'
import ChapterSummariesTab from '@/components/dynamic/ChapterSummariesTab.vue'
import HooksTab from '@/components/dynamic/HooksTab.vue'

const route = useRoute()
const router = useRouter()

/** 兼容旧连字符 key（info-perspective / chapter-summaries）→ 下划线，与后端账本名一致 */
const normalizeKey = (key: string): string => key.replace(/-/g, '_')

const activeTab = ref(normalizeKey((route.query.tab as string) || 'characters'))

const TAB_LABELS: Record<string, string> = {
  characters: '人物状态',
  locations: '地点势力',
  items: '物品',
  events: '事件流',
  timeline: '时间线',
  foreshadow: '伏笔台账',
  info_perspective: '信息视角',
  chapter_summaries: '章节摘要',
  hooks: '章尾钩子',
}

const activeLabel = computed(() => TAB_LABELS[activeTab.value] || activeTab.value)

const accounts = ref<Array<{ account: string; label: string; count: number }>>([])

onMounted(async () => {
  try {
    const res = await getDynamicAccounts(route.params.id as string)
    accounts.value = res.data.accounts.map((item) => ({
      account: item.account,
      label: item.label,
      count: item.count,
    }))
  } catch {
    // 统计条加载失败不影响主内容
  }
})

function goTab(tab: string) {
  const key = normalizeKey(tab)
  activeTab.value = key
  router.replace({ query: { ...route.query, tab: key } })
}

watch(() => route.query.tab, (tab) => {
  if (tab) {
    const key = normalizeKey(tab as string)
    if (key !== activeTab.value) activeTab.value = key
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
.dyn-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
  border-radius: 10px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(251, 191, 36, 0.04));
  color: #b45309;
  font-size: 12.5px;
}
.dyn-notice .el-icon { font-size: 16px; }
.dyn-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.dyn-stat-chip {
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
.dyn-stat-chip:hover {
  border-color: #4f46e5;
  background: #f5f5ff;
}
.dyn-stat-chip.active {
  border-color: #4f46e5;
  background: linear-gradient(135deg, #4f46e5, #2563eb);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
}
.dyn-stat-label { font-size: 12.5px; color: var(--text-regular); }
.dyn-stat-chip.active .dyn-stat-label { color: #fff; }
.dyn-stat-count {
  font-size: 11px;
  font-weight: 600;
  color: #4f46e5;
  background: rgba(79, 70, 229, 0.1);
  padding: 1px 8px;
  border-radius: 999px;
}
.dyn-stat-chip.active .dyn-stat-count { color: #fff; background: rgba(255, 255, 255, 0.25); }
.dyn-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 2px;
}
</style>
