<script setup>
// ============================================================
// 悬浮说明:一个「?」按钮,点击弹出简短解释(点空白处关闭)
// 用法:<InfoHint text="解释文字" /> 或 <InfoHint align="left|right" text="..." />
// ============================================================
import { ref, watch, onBeforeUnmount } from 'vue'

defineProps({
  text: { type: String, required: true },
  align: { type: String, default: 'center' } // left | center | right
})

const open = ref(false)
function toggle(e) {
  e.stopPropagation()
  open.value = !open.value
}
function close() {
  open.value = false
}
function onDoc() {
  close()
}
watch(open, (v) => {
  if (v) setTimeout(() => document.addEventListener('click', onDoc), 0)
  else document.removeEventListener('click', onDoc)
})
onBeforeUnmount(() => document.removeEventListener('click', onDoc))
</script>

<template>
  <span class="info-hint-wrap">
    <button
      type="button"
      class="info-hint-btn"
      :aria-expanded="open"
      title="点击查看说明"
      @click="toggle"
    >
      ?
    </button>
    <Transition name="scale-in">
      <span v-if="open" class="info-hint-pop" :class="`info-hint-pop--${align}`" @click.stop>{{ text }}</span>
    </Transition>
  </span>
</template>

<style scoped>
.info-hint-wrap {
  position: relative;
  display: inline-flex;
  vertical-align: middle;
}
.info-hint-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  color: rgb(var(--c-primary-deep));
  background: rgb(var(--c-primary) / 0.14);
  border: none;
  cursor: pointer;
  transition: background 0.2s ease-out, transform 0.15s ease-out;
}
.info-hint-btn:hover { background: rgb(var(--c-primary) / 0.26); }
.info-hint-btn:active { transform: scale(0.9); }
.info-hint-pop {
  position: absolute;
  top: calc(100% + 6px);
  z-index: 60;
  width: max-content;
  max-width: min(78vw, 280px);
  padding: 8px 10px;
  border-radius: 10px;
  background: rgb(var(--c-ink));
  color: rgb(var(--c-bg));
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.55;
  text-align: left;
  box-shadow: var(--shadow-pop);
}
.info-hint-pop--left { left: 0; }
.info-hint-pop--center { left: 50%; transform: translateX(-50%); }
.info-hint-pop--right { right: 0; }
</style>
