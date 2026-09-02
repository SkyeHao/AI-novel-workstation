<template>
  <div class="page-header">
    <div class="page-header-main">
      <div v-if="icon" class="page-header-icon">
        <el-icon :size="20"><component :is="icon" /></el-icon>
      </div>
      <div class="page-header-title-group">
        <h2 class="page-header-title">{{ title }}</h2>
        <p v-if="subtitle" class="page-header-subtitle">{{ subtitle }}</p>
      </div>
    </div>
    <div v-if="$slots.actions" class="page-header-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; subtitle?: string; icon?: string }>()
</script>
