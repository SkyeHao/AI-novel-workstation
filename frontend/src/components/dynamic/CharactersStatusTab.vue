<template>
  <SettingsTabLoader :fetcher="fetchData" empty-text="暂无人物状态记录">
    <template #default="{ data }">
      <EntityTable :account="'characters'" :entries="entriesOf(data)" :genre="genre" :dims="customDims" />
    </template>
  </SettingsTabLoader>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { CharacterDimension } from '@/api'
import { useRoute } from 'vue-router'
import { getDynamicAccount, getProject } from '@/api'
import SettingsTabLoader from '@/components/SettingsTabLoader.vue'
import EntityTable from '@/components/dynamic/EntityTable.vue'

const route = useRoute()
const projectId = route.params.id as string
const genre = ref('')
const customDims = ref<CharacterDimension[]>([])
const fetchData = async () => {
  try {
    const { data } = await getProject(projectId)
    genre.value = data?.genre || ''
    customDims.value = data?.character_dimensions || []
  } catch {
    // 拿不到题材时按通用模板渲染
  }
  return (await getDynamicAccount(projectId, 'characters')).data.data
}
const entriesOf = (data: any) => (Array.isArray(data?.entries) ? data.entries : [])
</script>
