<template>
  <SettingsTabLoader :fetcher="fetchData" empty-text="暂无信息视角记录">
    <template #default="{ data }">
      <DualColumnView :account="'info_perspective'" :data="data" />
    </template>
  </SettingsTabLoader>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { getDynamicAccount } from '@/api'
import SettingsTabLoader from '@/components/SettingsTabLoader.vue'
import DualColumnView from '@/components/dynamic/DualColumnView.vue'

const route = useRoute()
const projectId = route.params.id as string
const fetchData = async () => (await getDynamicAccount(projectId, 'info_perspective')).data.data
</script>
