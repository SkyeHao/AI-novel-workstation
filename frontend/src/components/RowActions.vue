<template>
  <el-dropdown trigger="click" @command="onCommand">
    <el-button link class="row-actions-btn" @click.stop>
      <el-icon :size="16"><MoreFilled /></el-icon>
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="item in items"
          :key="item.command"
          :command="item.command"
          :divided="item.divided"
          :disabled="item.disabled"
        >
          <el-icon v-if="item.icon"><component :is="item.icon" /></el-icon>
          <span :class="item.type === 'danger' ? 'danger-item' : ''">{{ item.label }}</span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { MoreFilled } from '@element-plus/icons-vue'

export interface RowActionItem {
  command: string
  label: string
  icon?: string
  type?: 'default' | 'danger' | 'success'
  divided?: boolean
  disabled?: boolean
}

defineProps<{ items: RowActionItem[] }>()
const emit = defineEmits<{ (e: 'command', command: string): void }>()

function onCommand(cmd: string) {
  emit('command', cmd)
}
</script>

<style>
.row-actions-btn {
  padding: 4px 6px;
  border-radius: 6px;
  color: var(--text-secondary);
}
.row-actions-btn:hover {
  background: var(--el-fill-color-light);
  color: var(--app-primary);
}
.el-dropdown-menu__item .danger-item {
  color: var(--el-color-danger);
}
.el-dropdown-menu__item .danger-item:hover {
  color: var(--el-color-danger);
}
</style>
