<script setup>
defineProps({
  icon: { type: String, default: 'fa-compass' },
  title: { type: String, default: '这里空空如也' },
  desc: { type: String, default: '' }
})
</script>

<template>
  <div class="card flex flex-col items-center justify-center gap-8 px-8 py-14 text-center">
    <span
      class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-2xl text-primary"
    >
      <i :class="`fa-regular ${icon}`" aria-hidden="true"></i>
    </span>
    <div>
      <p class="title-2 mb-1">{{ title }}</p>
      <p v-if="desc" class="muted max-w-sm">{{ desc }}</p>
    </div>
    <slot />
  </div>
</template>
