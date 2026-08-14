<template>
  <el-empty description="「审阅与去AI味」将在 M3 里程碑实现">
    <p class="hint">手动触发 · 逐章可回溯</p>
    <el-button type="primary" @click="$router.push(`/projects/${$route.params.id}/reading`)">
      返回阅读
    </el-button>
  </el-empty>
</template>

<script setup lang="ts">
</script>

<style scoped>
.hint {
  color: var(--text-secondary);
  margin-bottom: 16px;
}
</style>
