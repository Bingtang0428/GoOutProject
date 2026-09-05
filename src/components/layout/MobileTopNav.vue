<script setup>
import { ref, watch } from 'vue'
import { useScroll } from '@vueuse/core'

// 移动端顶部导航:随滚动由透明渐变为半透明白(毛玻璃)
const props = defineProps({
  back: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' }
})
const emit = defineEmits(['back'])

const { y } = useScroll(window)
const scrolled = ref(false)
watch(y, (v) => {
  scrolled.value = v > 16
})
</script>

<template>
  <header
    class="top-nav sticky top-0 z-40 lg:hidden"
    :class="scrolled ? 'glass shadow-[0_4px_20px_rgba(15,23,42,0.05)]' : 'bg-transparent'"
  >
    <div
      class="flex items-center gap-3 px-4"
      style="padding-top: env(safe-area-inset-top); min-height: 52px"
    >
      <button v-if="back" class="icon-btn shrink-0" aria-label="返回" @click="emit('back')">
        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
      </button>
      <span v-else class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-white">
        <i class="fa-solid fa-map-location-dot text-[14px]" aria-hidden="true"></i>
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-[15px] font-semibold leading-tight text-ink">
          {{ title || '兔兔同行' }}
        </p>
        <p v-if="subtitle" class="truncate text-[11.5px] text-muted">{{ subtitle }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-1"><slot name="actions" /></div>
    </div>
  </header>
</template>
