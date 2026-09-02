<template>
  <div class="dual-view">
    <el-empty v-if="!truth.length && !display.length" description="暂无信息视角记录" :image-size="90" />
    <template v-else>
      <div v-if="gap.length" class="dual-gap">
        <el-icon class="dual-gap-icon"><WarningFilled /></el-icon>
        <div class="dual-gap-text">
          <span class="dual-gap-title">信息差 {{ gap.length }} 条</span>
          <span class="dual-gap-sub">以下内容仅在「世界真相」中，读者尚未知晓，可用于视角一致性检查</span>
        </div>
      </div>

      <div class="dual-cols">
        <div class="dual-col">
          <div class="dual-col-head truth-head">
            <el-icon><Lock /></el-icon>
            <span>世界真相</span>
            <span class="dual-count">{{ truth.length }}</span>
          </div>
          <div class="dual-list">
            <div v-for="(item, index) in truth" :key="index" class="dual-fact">
              <span class="dual-badge truth-badge">真</span>
              <span class="dual-fact-text">{{ item.fact }}</span>
            </div>
            <el-empty v-if="!truth.length" description="暂无真相" :image-size="60" />
          </div>
        </div>
        <div class="dual-col">
          <div class="dual-col-head display-head">
            <el-icon><View /></el-icon>
            <span>读者已知</span>
            <span class="dual-count">{{ display.length }}</span>
          </div>
          <div class="dual-list">
            <div v-for="(item, index) in display" :key="index" class="dual-fact">
              <span class="dual-badge display-badge">示</span>
              <span class="dual-fact-text">{{ item.fact }}</span>
            </div>
            <el-empty v-if="!display.length" description="暂无展示" :image-size="60" />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Lock, View, WarningFilled } from '@element-plus/icons-vue'

const props = defineProps<{
  account: string
  data: Record<string, any>
}>()

const truth = computed(() => (Array.isArray(props.data.truth) ? props.data.truth : []))
const display = computed(() => (Array.isArray(props.data.display) ? props.data.display : []))

const gap = computed(() => {
  const displayFacts = new Set(display.value.map((item) => String(item.fact)))
  return truth.value.filter((item) => !displayFacts.has(String(item.fact)))
})
</script>

<style scoped>
.dual-view { height: 100%; }
.dual-gap {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(251, 191, 36, 0.06));
  border: 1px solid rgba(245, 158, 11, 0.28);
}
.dual-gap-icon {
  font-size: 20px;
  color: #d97706;
  margin-top: 2px;
}
.dual-gap-text { display: flex; flex-direction: column; gap: 2px; }
.dual-gap-title { font-size: 13px; font-weight: 600; color: #b45309; }
.dual-gap-sub { font-size: 12px; color: var(--text-secondary); }
.dual-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
  padding: 2px;
}
.dual-col {
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  display: flex;
  flex-direction: column;
  max-height: 70vh;
}
.dual-col-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-title);
  border-bottom: 1px solid var(--border-color-light);
}
.truth-head { background: linear-gradient(90deg, rgba(79, 70, 229, 0.08), #fff); }
.display-head { background: linear-gradient(90deg, rgba(16, 185, 129, 0.08), #fff); }
.dual-col-head .el-icon { color: #4f46e5; }
.display-head .el-icon { color: #10b981; }
.dual-count {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: #4f46e5;
  background: rgba(79, 70, 229, 0.1);
  padding: 2px 8px;
  border-radius: 999px;
}
.display-head .dual-count { color: #10b981; background: rgba(16, 185, 129, 0.1); }
.dual-list {
  overflow: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dual-fact {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--border-color-light);
  border-radius: 10px;
  background: #fafafa;
}
.dual-badge {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  border-radius: 6px;
  color: #fff;
}
.truth-badge { background: #4f46e5; }
.display-badge { background: #10b981; }
.dual-fact-text { font-size: 13px; line-height: 1.7; color: var(--text-primary); }
</style>
