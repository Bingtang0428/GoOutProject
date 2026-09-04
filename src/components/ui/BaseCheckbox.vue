<script setup>
import { computed } from 'vue'

// 自定义圆形复选框:勾选时主色填充 + 「旋转打勾」动画
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const checked = computed(() => props.modelValue)

function toggle() {
  if (props.disabled) return
  emit('update:modelValue', !checked.value)
}

function onKey(e) {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    toggle()
  }
}
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="checked"
    :disabled="disabled"
    class="group flex shrink-0 items-center justify-center rounded-full p-0.5 transition-transform duration-150 ease-out active:scale-90"
    @click.stop="toggle"
    @keydown="onKey"
  >
    <span
      class="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition-all duration-250 ease-out"
      :class="
        checked
          ? 'border-primary bg-primary shadow-[0_2px_10px_rgb(183_89_115/0.45)]'
          : 'border-line group-hover:border-primary/60'
      "
    >
      <i
        v-if="checked"
        class="fa-solid fa-check text-[11px] text-white"
        style="animation: check-pop 0.35s ease-out both"
        aria-hidden="true"
      ></i>
    </span>
  </button>
</template>
