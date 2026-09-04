<script setup>
import { computed } from 'vue'
import { gradOf, initialOf } from '@/utils/misc'

const props = defineProps({
  name: { type: String, default: '' },
  size: { type: Number, default: 32 },
  ring: { type: Boolean, default: true } // 白/暗色描边,叠放时更清晰
})

const style = computed(() => {
  const [a, b] = gradOf(props.name)
  return {
    width: props.size + 'px',
    height: props.size + 'px',
    fontSize: Math.round(props.size * 0.4) + 'px',
    background: `linear-gradient(135deg, ${a}, ${b})`
  }
})

const ringClass = computed(() =>
  props.ring ? 'ring-2 ring-surface' : ''
)
</script>

<template>
  <span
    class="inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold text-white"
    :class="ringClass"
    :style="style"
    :title="name"
  >
    {{ initialOf(name) }}
  </span>
</template>
