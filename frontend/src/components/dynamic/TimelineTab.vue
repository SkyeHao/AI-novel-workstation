<template>
  <SettingsTabLoader :fetcher="fetchData" empty-text="暂无时间线记录">
    <template #default="{ data }">
      <FlowTimeline :account="'timeline'" :entries="entriesOf(data)" />
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
const fetchData = async () => (await getDynamicAccount(projectId, 'timeline')).data.data
const entriesOf = (data: any) => (Array.isArray(data?.entries) ? data.entries : [])
</script>
