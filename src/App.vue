<script setup>
// 根组件:仅负责路由出口与页面切换过渡。
// 布局(侧边栏/底部 Tab 等)由各视图自行组合,见 views/ 下各文件。
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <Transition name="fade-up" mode="out-in">
      <component :is="Component" :key="route.name" />
    </Transition>
  </RouterView>
</template>
