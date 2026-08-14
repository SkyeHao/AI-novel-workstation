<template>
  <el-empty description="「正文生成」将在 M2 里程碑实现">
    <p class="hint">前置设定完备检测 → 手动逐章生成</p>
    <el-button type="primary" @click="$router.push(`/projects/${$route.params.id}/settings`)">
      先去完善设定
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
