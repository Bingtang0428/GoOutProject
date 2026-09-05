<script setup>
// 全局 Toast 容器:顶部居中堆叠,自动消失
import { toasts } from '@/composables/toast'

const META = {
  success: { icon: 'fa-circle-check', cls: 'border-[#16a34a]/40 bg-[#16a34a]/10 text-[#16a34a]' },
  error: { icon: 'fa-circle-exclamation', cls: 'border-rose/50 bg-rose/10 text-rose' },
  info: { icon: 'fa-circle-info', cls: 'border-primary/40 bg-primary/10 text-primary' }
}
</script>

<template>
  <div class="pointer-events-none fixed left-1/2 top-4 z-[9999] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col items-center gap-2">
    <TransitionGroup name="fade-up">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="card pointer-events-auto flex w-full items-center gap-3 !rounded-[14px] border px-4 py-3 shadow-pop"
        :class="META[t.type]?.cls"
      >
        <i :class="`fa-solid ${META[t.type]?.icon || 'fa-circle-info'}`" aria-hidden="true"></i>
        <span class="min-w-0 flex-1 text-[13px] font-semibold">{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>
