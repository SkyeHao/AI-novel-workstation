<template>
  <div class="settings-tab">
    <div v-if="loading" class="app-empty">
      <el-icon class="is-loading" :size="26"><Loading /></el-icon>
      <span>加载中...</span>
    </div>
    <div v-else-if="error" class="settings-error">
      <el-alert :title="error" type="error" :closable="false" show-icon />
    </div>
    <div v-else-if="empty" class="app-empty">
      <el-icon :size="44" color="#c0c4cc"><DocumentRemove /></el-icon>
      <span class="settings-empty-title">{{ emptyText }}</span>
      <span class="settings-empty-hint">可前往「创作引擎」与 Agent 对话，引导生成对应内容</span>
    </div>
    <div v-else class="settings-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    loading?: boolean
    error?: string
    empty?: boolean
    emptyText?: string
  }>(),
  { loading: false, error: '', empty: false, emptyText: '暂无数据' }
)
</script>

<style scoped>
.settings-tab {
  height: 100%;
}
.settings-error {
  max-width: 720px;
  margin: 24px auto;
}
.app-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 260px;
  color: var(--text-placeholder);
  font-size: 13px;
}
.settings-empty-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-regular);
}
.settings-empty-hint {
  font-size: 12px;
  color: var(--text-placeholder);
}
.settings-content {
  padding: 4px 0;
}
</style>
