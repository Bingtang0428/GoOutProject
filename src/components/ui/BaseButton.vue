<script setup>
defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (v) => ['primary', 'soft', 'ghost', 'danger', 'danger-soft', 'plain'].includes(v)
  },
  size: { type: String, default: 'md', validator: (v) => ['md', 'sm'].includes(v) },
  icon: { type: String, default: '' },
  block: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  type: { type: String, default: 'button' }
})
const emit = defineEmits(['click'])
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="[`btn-${variant}`, size === 'sm' ? 'btn-sm' : '', block ? 'btn-block' : '']"
    :disabled="disabled || loading"
    @click="emit('click', $event)"
  >
    <i v-if="loading" class="fa-solid fa-circle-notch text-[0.9em]" style="animation: spin 0.8s linear infinite" aria-hidden="true"></i>
    <i v-else-if="icon" :class="`fa-solid ${icon}`" class="text-[0.9em]" aria-hidden="true"></i>
    <slot />
  </button>
</template>
