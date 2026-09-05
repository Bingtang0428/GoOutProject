<script setup>
// 骨架屏:加载占位卡片(标题/行/条),灰粉柔和呼吸动画
defineProps({
  lines: { type: Number, default: 3 }
})
</script>

<template>
  <div class="card space-y-3 p-6" aria-busy="true" aria-label="加载中">
    <div class="h-5 w-2/5 rounded-[8px] bg-surface-2" style="animation: pulse-soft 1.6s ease-in-out infinite"></div>
    <div class="h-3 w-4/5 rounded-[8px] bg-surface-2" style="animation: pulse-soft 1.6s ease-in-out infinite; animation-delay: 0.15s"></div>
    <div v-for="i in lines" :key="i" class="h-3 rounded-[8px] bg-surface-2" :style="{ width: `${90 - i * 10}%`, animation: 'pulse-soft 1.6s ease-in-out infinite', animationDelay: `${i * 0.15}s` }"></div>
  </div>
</template>
