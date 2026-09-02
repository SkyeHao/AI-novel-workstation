<template>
  <SettingsTabLoader :fetcher="fetchData" empty-text="暂无章节摘要">
    <template #default="{ data }">
      <FlowTimeline :account="'chapter_summaries'" :entries="entriesOf(data)" />
    </template>
  </SettingsTabLoader>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { getDynamicAccount } from '@/api'
import SettingsTabLoader from '@/components/SettingsTabLoader.vue'
import FlowTimeline from '@/components/dynamic/FlowTimeline.vue'

const route = useRoute()
const projectId = route.params.id as string
const fetchData = async () => (await getDynamicAccount(projectId, 'chapter_summaries')).data.data
const entriesOf = (data: any) => (Array.isArray(data?.entries) ? data.entries : [])
</script>
