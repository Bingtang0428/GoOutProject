<script setup>
// 圆形叠放的头像组(超出数量以 +N 展示)
const props = defineProps({
  users: { type: Array, default: () => [] }, // [{id,name}]
  size: { type: Number, default: 30 },
  max: { type: Number, default: 4 }
})
</script>

<template>
  <div class="flex items-center">
    <template v-for="(u, i) in users.slice(0, max)" :key="u.id || i">
      <div class="-ml-1.5 first:ml-0">
        <Avatar :name="u.name" :size="size" />
      </div>
    </template>
    <span
      v-if="users.length > max"
      class="-ml-1.5 inline-flex items-center justify-center rounded-full bg-surface-2 font-bold text-muted ring-2 ring-surface"
      :style="{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.38) + 'px' }"
    >
      +{{ users.length - max }}
    </span>
  </div>
</template>
