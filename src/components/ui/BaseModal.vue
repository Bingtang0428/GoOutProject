<script setup>
import { watch, onBeforeUnmount } from 'vue'

// 通用弹窗:遮罩毛玻璃 + 面板 scale-in,ease-out ~280ms
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  maxWidth: { type: String, default: '560px' },
  closable: { type: Boolean, default: true }
})
const emit = defineEmits(['update:modelValue'])

function close() {
  if (!props.closable) return
  emit('update:modelValue', false)
}

watch(
  () => props.modelValue,
  (v) => {
    document.body.style.overflow = v ? 'hidden' : ''
  }
)

function onKey(e) {
  if (e.key === 'Escape' && props.modelValue) close()
}
onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-mask">
      <div
        v-if="modelValue"
        class="modal-mask fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6"
        @keydown="onKey"
        @click.self="close"
      >
        <Transition name="modal-panel">
          <div
            class="modal card relative flex max-h-[92dvh] w-full flex-col rounded-b-none rounded-t-card p-5 sm:rounded-card sm:p-6"
            :style="{ maxWidth: maxWidth }"
            role="dialog"
            aria-modal="true"
          >
            <header class="flex items-center justify-between gap-4 pb-4">
              <h3 class="title-1 text-[17px] sm:text-[20px]">{{ title }}</h3>
              <button v-if="closable" class="icon-btn shrink-0" aria-label="关闭" @click="close">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            </header>
            <div class="min-h-0 flex-1 overflow-y-auto pr-1">
              <slot />
            </div>
            <footer v-if="$slots.footer" class="flex flex-wrap justify-end gap-12 pt-5" style="padding-bottom: max(6px, env(safe-area-inset-bottom))">
              <slot name="footer" />
            </footer>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
