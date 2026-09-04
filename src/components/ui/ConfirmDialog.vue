<script setup>
import BaseModal from './BaseModal.vue'
import BaseButton from './BaseButton.vue'

// 轻量确认弹窗(删除等危险操作)
defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  message: { type: String, default: '' },
  confirmText: { type: String, default: '确认删除' },
  danger: { type: Boolean, default: true }
})
const emit = defineEmits(['update:modelValue', 'confirm', 'cancel'])

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="title"
    :max-width="'420px'"
    @update:model-value="(v) => (v ? null : close())"
  >
    <div class="flex items-start gap-4">
      <span
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
        :class="danger ? 'bg-rose/15 text-rose' : 'bg-amber/20 text-amber'"
      >
        <i :class="`fa-solid ${danger ? 'fa-triangle-exclamation' : 'fa-circle-question'}`" aria-hidden="true"></i>
      </span>
      <p class="pt-2 text-[14px] leading-relaxed text-ink-soft">{{ message }}</p>
    </div>
    <template #footer>
      <BaseButton variant="ghost" @click="close; emit('cancel')">取消</BaseButton>
      <BaseButton :variant="danger ? 'danger' : 'primary'" @click="close; emit('confirm')">
        {{ confirmText }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
