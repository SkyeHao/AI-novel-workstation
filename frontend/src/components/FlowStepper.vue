<template>
  <div class="flow-stepper">
    <div
      v-for="(node, idx) in nodes"
      :key="node.key"
      class="flow-node-wrap"
    >
      <div
        class="flow-node"
        :class="{
          'is-active': node.key === currentKey,
          'is-completed': isCompleted(node.key, idx),
          'is-clickable': clickable
        }"
        @click="handleClick(node)"
      >
        <div class="flow-node-icon">
          <el-icon v-if="isCompleted(node.key, idx)" :size="14"><Check /></el-icon>
          <el-icon v-else :size="14"><component :is="node.icon || 'Circle'" /></el-icon>
        </div>
        <span class="flow-node-label">{{ node.label }}</span>
      </div>
      <div
        v-if="idx < nodes.length - 1"
        class="flow-connector"
        :class="{ 'is-done': isCompleted(node.key, idx) }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check } from '@element-plus/icons-vue'

export interface FlowNode {
  key: string
  label: string
  icon?: string
}

defineProps<{
  nodes: FlowNode[]
  currentKey: string
  completedKeys?: string[]
  clickable?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', key: string): void
}>()

const props = defineProps<{
  nodes: FlowNode[]
  currentKey: string
  completedKeys?: string[]
  clickable?: boolean
}>()

function isCompleted(key: string, idx: number): boolean {
  if (props.completedKeys?.includes(key)) return true
  // 如果当前节点索引大于该节点，且该节点不是当前节点，则视为已完成
  const currentIdx = props.nodes.findIndex(n => n.key === props.currentKey)
  return idx < currentIdx
}

function handleClick(node: FlowNode) {
  emit('select', node.key)
}
</script>

<style scoped>
.flow-stepper {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 8px 0;
  overflow-x: auto;
}

.flow-node-wrap {
  display: flex;
  align-items: center;
}

.flow-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 20px;
  border: 1.5px dashed var(--border);
  background: var(--surface);
  color: var(--text-aux);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  transition: all var(--transition-base);
  cursor: default;
}

.flow-node.is-clickable {
  cursor: pointer;
}

.flow-node.is-clickable:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  transform: translateY(-1px);
}

.flow-node.is-active {
  border-style: solid;
  border-color: var(--accent);
  background: var(--gradient-accent);
  color: #fff;
  box-shadow: var(--shadow-glow);
  animation: breathe 2.5s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% { box-shadow: 0 0 12px rgba(79, 70, 229, 0.2); }
  50% { box-shadow: 0 0 20px rgba(79, 70, 229, 0.35); }
}

.flow-node.is-completed {
  border-style: solid;
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--accent);
}

.flow-node-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(0,0,0,0.05);
  flex-shrink: 0;
}

.flow-node.is-active .flow-node-icon {
  background: rgba(255,255,255,0.2);
}

.flow-node.is-completed .flow-node-icon {
  background: var(--accent);
  color: #fff;
}

.flow-node-label {
  line-height: 1;
}

.flow-connector {
  width: 24px;
  height: 1.5px;
  background: var(--border);
  margin: 0 4px;
  flex-shrink: 0;
  transition: background var(--transition-base);
}

.flow-connector.is-done {
  background: var(--accent);
}
</style>