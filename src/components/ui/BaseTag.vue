<script setup>
defineProps({
  tone: {
    type: String,
    default: 'plain',
    validator: (v) => ['brand', 'amber', 'rose', 'success', 'plain'].includes(v)
  },
  icon: { type: String, default: '' },
  dot: { type: Boolean, default: false }
})
</script>

<template>
  <span class="chip" :class="`chip-${tone}`">
    <span v-if="dot" class="dot" aria-hidden="true"></span>
    <i v-if="icon" :class="`fa-solid ${icon}`" class="text-[0.85em]" aria-hidden="true"></i>
    <slot />
  </span>
</template>
