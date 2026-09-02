<template>
  <SettingsTabLoader :fetcher="fetchData" empty-text="暂无地点势力记录">
    <template #default="{ data }">
      <EntityTable :account="'locations'" :entries="entriesOf(data)" />
    </template>
  </SettingsTabLoader>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { getDynamicAccount } from '@/api'
import SettingsTabLoader from '@/components/SettingsTabLoader.vue'
import EntityTable from '@/components/dynamic/EntityTable.vue'

const route = useRoute()
const projectId = route.params.id as string
const fetchData = async () => (await getDynamicAccount(projectId, 'locations')).data.data
const entriesOf = (data: any) => (Array.isArray(data?.entries) ? data.entries : [])
</script>
