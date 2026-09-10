<script setup>
import { computed } from 'vue'
import { gradOf, initialOf, AVATAR_GRADS } from '@/utils/misc'

const props = defineProps({
  name: { type: String, default: '' },
  size: { type: Number, default: 32 },
  ring: { type: Boolean, default: true }, // 白/暗色描边,叠放时更清晰
  color: { type: [Number, String], default: null }, // 手动指定配色索引(可编辑)
  seed: { type: String, default: '' } // 同名不同人时用 id 打散配色
})

const style = computed(() => {
  let pair
  const c = props.color
  if (c !== null && c !== undefined && c !== '' && Number.isFinite(Number(c))) {
    pair = AVATAR_GRADS[Math.abs(Number(c)) % AVATAR_GRADS.length]
  } else {
    pair = gradOf(props.name + (props.seed || ''))
  }
  const [a, b] = pair
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
