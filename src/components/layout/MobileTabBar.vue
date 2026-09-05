<script setup>
// 移动端(<768px)底部固定 Tab 栏:7 个功能模块(触控友好版)
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
    class="fixed inset-x-0 bottom-0 z-40 px-2.5 pb-2.5 lg:hidden"
    style="padding-bottom: max(10px, env(safe-area-inset-bottom))"
    aria-label="功能模块"
  >
    <div
      class="card mx-auto grid max-w-md grid-cols-7 items-stretch gap-1 !rounded-[24px] !p-1.5"
      style="box-shadow: 0 10px 30px rgba(60, 30, 44, 0.18)"
    >
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        :aria-current="active === t.key ? 'page' : undefined"
        class="relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-[16px] py-2 transition-all duration-250 ease-out active:scale-90"
        :class="active === t.key ? 'text-primary' : 'text-muted/90 hover:text-ink-soft'"
        @click="emit('change', t.key)"
      >
        <span
          v-if="active === t.key"
          class="absolute -top-0.5 left-1/2 h-1 w-6 -translate-x-1/2 rounded-full bg-primary/60"
        ></span>
        <i
          :class="`fa-solid ${t.icon}`"
          class="text-[17px] leading-none"
          :style="active === t.key ? 'filter: drop-shadow(0 1px 6px rgba(183,89,115,.35))' : ''"
          aria-hidden="true"
        ></i>
        <span
          class="w-full truncate px-0.5 text-center text-[9px] font-semibold leading-none"
          :class="active === t.key ? '' : 'opacity-75'"
        >{{ t.label }}</span>
      </button>
    </div>
  </nav>
</template>
