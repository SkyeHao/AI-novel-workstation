<template>
  <div class="settings-tab">
    <div v-if="loading" class="app-empty">
      <el-icon class="is-loading" :size="26"><Loading /></el-icon>
      <span>加载中...</span>
    </div>
    <div v-else-if="error" class="settings-error">
      <el-alert :title="error" type="error" :closable="false" show-icon />
    </div>
    <div v-else-if="isEmpty(data)" class="app-empty">
      <el-icon :size="44" color="#c0c4cc"><DocumentRemove /></el-icon>
      <span class="settings-empty-title">{{ emptyText }}</span>
      <span class="settings-empty-hint">可前往「创作引擎」与 Agent 对话，引导生成对应内容</span>
    </div>
    <div v-else class="settings-content">
      <slot :data="data" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 返回具体内容的异步函数（axios 响应解包后的 data） */
    fetcher: () => Promise<unknown>
    emptyText?: string
  }>(),
  { emptyText: '暂无数据' }
)

const loading = ref(false)
const error = ref('')
const data = ref<any>(null)

const isEmpty = (v: unknown): boolean => {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') {
    const vals = Object.values(v as Record<string, unknown>)
    return vals.length === 0 || vals.every((x) => isEmpty(x))
  }
  return false
}

onMounted(async () => {
  loading.value = true
  try {
    data.value = await props.fetcher()
  } catch (err: unknown) {
    const e = err as { message?: string }
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.settings-tab { height: 100%; }
.settings-error { max-width: 720px; margin: 24px auto; }
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
.settings-empty-title { font-size: 15px; font-weight: 500; color: var(--text-regular); }
.settings-empty-hint { font-size: 12px; color: var(--text-placeholder); }
.settings-content { padding: 4px 0; }
</style>
