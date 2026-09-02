<template>
  <SettingsTabLoader :fetcher="fetchData" empty-text="暂无伏笔台账">
    <template #default="{ data }">
      <KanbanBoard :account="'foreshadow'" :entries="entriesOf(data)" />
    </template>
  </SettingsTabLoader>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { getDynamicAccount } from '@/api'
import SettingsTabLoader from '@/components/SettingsTabLoader.vue'
import KanbanBoard from '@/components/dynamic/KanbanBoard.vue'

const route = useRoute()
const projectId = route.params.id as string
const fetchData = async () => (await getDynamicAccount(projectId, 'foreshadow')).data.data
const entriesOf = (data: any) => (Array.isArray(data?.entries) ? data.entries : [])
</script>
