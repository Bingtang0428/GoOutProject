<script setup>
// 根组件:仅负责路由出口与页面切换过渡。
import GlobalToast from '@/components/ui/GlobalToast.vue'
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <Transition name="fade-up" mode="out-in">
      <component :is="Component" :key="route.name" />
    </Transition>
  </RouterView>
  <GlobalToast />
</template>
