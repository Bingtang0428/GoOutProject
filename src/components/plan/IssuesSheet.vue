<script setup>
// ============================================================
// 行程体检 —— 自动冲突与遗漏检测
// ============================================================
import { computed } from 'vue'
import { useContentStore } from '@/stores/content'
import { todayISO, fmtDay, relKey, fmtRange } from '@/utils/date'
import BaseModal from '@/components/ui/BaseModal.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  plan: { type: Object, required: true }
})
const emit = defineEmits(['update:modelValue'])
const content = useContentStore()

const issues = computed(() => {
  const planId = props.plan.id
  const today = todayISO()
  const rows = {
    days: content.rowsOf(planId, 'days'),
    todos: content.rowsOf(planId, 'todos'),
    reminders: content.rowsOf(planId, 'reminders'),
    bills: content.rowsOf(planId, 'bills'),
    transits: content.rowsOf(planId, 'transits'),
    stays: content.rowsOf(planId, 'stays')
  }
  const out = []
  const push = (tone, icon, text) => out.push({ tone, icon, text })

  const s = props.plan.start_date
  const e = props.plan.end_date

  // 1) 逾期 / 临期任务
  for (const t of rows.todos) {
    if (!t.done && t.due && t.due < today) push('rose', 'fa-circle-exclamation', `任务「${t.title}」已逾期(${fmtDay(t.due, false)})`)
    else if (!t.done && t.due === today) push('amber', 'fa-clock', `任务「${t.title}」今天到期`)
  }
  // 2) 重复提醒(同日同时)
  const seen = new Map()
  for (const r of rows.reminders) {
    const k = `${r.date}|${(r.time || '').slice(0, 5)}`
    if (seen.has(k)) push('rose', 'fa-bell', `提醒「${seen.get(k)}」与「${r.title}」时间重复(${fmtDay(r.date, false)} ${k.split('|')[1] || '全天'})`)
    else seen.set(k, r.title)
  }
  // 3) 账单日期不在行程内
  for (const b of rows.bills) {
    if (b.date && (b.date < s || b.date > e)) push('amber', 'fa-scale-balanced', `账单「${b.name}」的发生日期 ${b.date} 不在行程日期内`)
  }
  // 4) 大交通:离开早于到达 / 日期偏离行程过大
  for (const tr of rows.transits) {
    const other = rows.transits.filter((x) => x.person?.id === tr.person?.id && x.id !== tr.id)
    if (tr.direction === 'out' && other.some((x) => x.direction === 'in' && tr.leg_date <= x.leg_date)) {
      push('amber', 'fa-plane-departure', `${tr.person?.name} 的离开日期(${tr.leg_date})不晚于其到达日期,请核对`)
    }
    if (tr.leg_date && (tr.leg_date < s - 7 || tr.leg_date > e + 7)) {
      push('plain', 'fa-circle-info', `${tr.person?.name} 的大交通日期(${tr.leg_date})偏离行程较远,确认是否早到/晚走`)
    }
  }
  // 5) 未来日期还没排内容
  const sorted = rows.days.slice().sort((a, b) => a.date.localeCompare(b.date))
  for (const d of sorted) {
    if (d.date >= today && d.date <= e && !(d.destinations || []).length) {
      push('amber', 'fa-map', `${fmtDay(d.date)} 还没有安排地点`)
    }
  }
  // 6) 未开始空行程提示
  if (!rows.days.some((d) => (d.destinations || []).length) && s >= today) {
    push('plain', 'fa-route', '整个行程还没排任何地点,路线里点「添加目的地」开始吧')
  }
  // 7) 已预订数核对
  const bookedStays = rows.stays.filter((x) => x.booked).length
  if (rows.stays.length && bookedStays < rows.stays.length) {
    push('plain', 'fa-hotel', `食宿还有 ${rows.stays.length - bookedStays} 家未标记预订`)
  }

  const toneCls = { rose: 'chip-rose', amber: 'chip-amber', plain: 'chip-plain' }
  return { list: out, toneCls }
})

const summary = computed(() => ({
  severe: issues.value.list.filter((i) => i.tone === 'rose').length,
  warn: issues.value.list.filter((i) => i.tone === 'amber').length
}))
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    title="行程体检"
    :max-width="'520px'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="muted -mt-1 mb-3 text-[12.5px]">
      {{ fmtRange(plan.start_date, plan.end_date) }}
      <span class="chip ml-2 chip-rose !text-[11px]" v-if="summary.severe"><span class="dot"></span>{{ summary.severe }} 项需处理</span>
      <span class="chip ml-1 chip-amber !text-[11px]" v-if="summary.warn"><span class="dot"></span>{{ summary.warn }} 项建议确认</span>
    </p>

    <div v-if="issues.list.length" class="space-y-2">
      <div
        v-for="(it, i) in issues.list"
        :key="i"
        class="card flex items-start gap-3 !rounded-box px-4 py-3"
      >
        <i
          class="mt-0.5 text-[13px]"
          :class="`fa-solid ${it.icon} ${it.tone === 'rose' ? 'text-rose' : it.tone === 'amber' ? 'text-amber' : 'text-muted'}`"
          aria-hidden="true"
        ></i>
        <p class="flex-1 text-[13px] leading-relaxed text-ink-soft">{{ it.text }}</p>
        <span class="chip" :class="issues.toneCls[it.tone]" v-if="it.tone !== 'plain'">{{ it.tone === 'rose' ? '需处理' : '建议' }}</span>
      </div>
    </div>
    <div v-else class="card flex flex-col items-center gap-2 py-8 text-center">
      <span class="flex h-12 w-12 items-center justify-center rounded-full bg-[#16a34a]/10 text-[#16a34a]">
        <i class="fa-solid fa-circle-check text-[18px]" aria-hidden="true"></i>
      </span>
      <p class="text-[14px] font-semibold text-ink">行程安排很清爽</p>
      <p class="muted text-[12px]">未发现冲突与遗漏,放心出发</p>
    </div>
  </BaseModal>
</template>
