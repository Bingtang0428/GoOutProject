<script setup>
// 移动端(<768px)底部固定 Tab 栏:7 个功能模块
defineProps({
  active: { type: String, default: 'route' }
})
const emit = defineEmits(['change'])

const TABS = [
  { key: 'route', icon: 'fa-route', label: '路线' },
  { key: 'stay', icon: 'fa-bed', label: '食宿' },
  { key: 'todo', icon: 'fa-list-check', label: '待办' },
  { key: 'guide', icon: 'fa-bookmark', label: '攻略' },
  { key: 'reminder', icon: 'fa-bell', label: '提醒' },
  { key: 'bill', icon: 'fa-scale-balanced', label: '分账' },
  { key: 'transit', icon: 'fa-plane-departure', label: '交通' }
]

defineExpose({ TABS })
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 lg:hidden"
    style="padding-bottom: max(12px, env(safe-area-inset-bottom))"
  >
    <div
      class="card mx-auto flex max-w-md items-center justify-between gap-0.5 !rounded-[22px] !px-1.5 !py-1.5"
      style="box-shadow: var(--shadow-pop)"
    >
      <button
        v-for="t in TABS"
        :key="t.key"
        class="relative flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 transition-all duration-250 ease-out active:scale-90"
        :class="active === t.key ? 'text-primary' : 'text-muted hover:text-ink-soft'"
        @click="emit('change', t.key)"
      >
        <span
          v-if="active === t.key"
          class="absolute inset-0 -z-10 rounded-2xl bg-primary/10"
        ></span>
        <i :class="`fa-solid ${t.icon}`" class="text-[15px]" aria-hidden="true"></i>
        <span class="text-[9.5px] font-semibold leading-none">{{ t.label }}</span>
      </button>
    </div>
  </nav>
</template>

