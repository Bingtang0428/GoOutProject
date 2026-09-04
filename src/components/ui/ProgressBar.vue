<script setup>
import { computed } from 'vue'

// 进度条:主色渐变填充,宽度过渡 0.5s
const props = defineProps({
  value: { type: Number, default: 0 }, // 0-100
  height: { type: Number, default: 8 }
})

const pct = computed(() => Math.max(0, Math.min(100, props.value)))
</script>

<template>
  <div
    class="w-full overflow-hidden rounded-full bg-surface-2"
    :style="{ height: height + 'px' }"
    role="progressbar"
    :aria-valuenow="Math.round(pct)"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div
      class="h-full rounded-full bg-gradient-to-r from-[#F0A9BD] to-primary transition-[width] duration-500 ease-out"
      :style="{ width: pct + '%' }"
    ></div>
  </div>
</template>
