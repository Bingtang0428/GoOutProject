<script setup>
// ============================================================
// 全局搜索:跨当前计划的地点/食宿/待办/攻略/提醒/分账 快速查找
// ============================================================
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useContentStore } from '@/stores/content'
import BaseModal from '@/components/ui/BaseModal.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  plan: { type: Object, required: true }
})
const emit = defineEmits(['update:modelValue', 'go'])
const store = useContentStore()

const q = ref('')
const inputRef = ref(null)

const results = computed(() => {
  const kw = q.value.trim().toLowerCase()
  if (!kw) return []
  const pid = props.plan.id
  const hit = (s) => String(s || '').toLowerCase().includes(kw)
  const out = []
  for (const d of store.rowsOf(pid, 'days')) {
    for (const x of d.destinations || []) {
      if (hit(x.place) || hit(x.note)) {
        out.push({ sec: 'route', icon: 'fa-location-dot', title: x.place, sub: `${d.date}${x.note ? ' · ' + x.note : ''}`, type: '路线地点' })
      }
    }
  }
  for (const s of store.rowsOf(pid, 'stays')) {
    if (hit(s.name) || hit(s.address)) {
      out.push({ sec: 'stay', icon: s.type === 'food' ? 'fa-utensils' : 'fa-hotel', title: s.name, sub: s.address || '', type: s.type === 'food' ? '餐厅' : '住宿' })
    }
  }
  for (const t of store.rowsOf(pid, 'todos')) {
    if (hit(t.title)) out.push({ sec: 'todo', icon: 'fa-list-check', title: t.title, sub: t.done ? '已完成' : '待办', type: '待办' })
  }
  for (const g of store.rowsOf(pid, 'guides')) {
    if (hit(g.title) || (g.tags || []).some(hit)) {
      out.push({ sec: 'guide', icon: 'fa-bookmark', title: g.title, sub: (g.tags || []).join(' / '), type: '攻略' })
    }
  }
  for (const r of store.rowsOf(pid, 'reminders')) {
    if (hit(r.title)) out.push({ sec: 'reminder', icon: 'fa-bell', title: r.title, sub: r.date || '', type: '提醒' })
  }
  for (const b of store.rowsOf(pid, 'bills')) {
    if (hit(b.name) || hit(b.note)) out.push({ sec: 'bill', icon: 'fa-scale-balanced', title: b.name, sub: `¥${b.amount || 0}`, type: '分账' })
  }
  return out.slice(0, 60)
})

function pick(r) {
  emit('go', r.sec)
  emit('update:modelValue', false)
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      q.value = ''
      nextTick(() => inputRef.value?.focus())
    }
  }
)
onBeforeUnmount(() => {})
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    title="搜索计划内容"
    :max-width="'560px'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="relative">
      <i class="fa-solid fa-magnifying-glass pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted" aria-hidden="true"></i>
      <input
        ref="inputRef"
        v-model="q"
        class="field !pl-9"
        placeholder="搜索地点 / 食宿 / 待办 / 攻略 / 提醒 / 分账…"
        maxlength="40"
      />
    </div>

    <div v-if="q.trim()" class="mt-3 max-h-[60vh] space-y-1.5 overflow-y-auto">
      <button
        v-for="(r, i) in results"
        :key="i"
        type="button"
        class="flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
        @click="pick(r)"
      >
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
          <i :class="`fa-solid ${r.icon}`" aria-hidden="true"></i>
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[14px] font-semibold text-ink">{{ r.title }}</span>
          <span class="muted block truncate text-[11.5px]">{{ r.sub }}</span>
        </span>
        <span class="chip chip-plain shrink-0 !px-2 !py-0 !text-[10.5px]">{{ r.type }}</span>
      </button>
      <p v-if="!results.length" class="muted py-8 text-center text-[13px]">没有找到匹配内容</p>
    </div>
    <p v-else class="muted mt-3 py-6 text-center text-[12.5px]">输入关键词,跨模块快速查找</p>
  </BaseModal>
</template>
