<template>
  <el-empty description="「阅读」将在 M2 里程碑实现">
    <p class="hint">沉浸式阅读 + 选段 Agent 对话修改</p>
    <el-button type="primary" @click="$router.push(`/projects/${$route.params.id}/writing`)">
      返回正文生成
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
