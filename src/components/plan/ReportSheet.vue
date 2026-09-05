<script setup>
// ============================================================
// 行程复盘 —— 汇总全队数据生成复盘总结
// 内容:里程与油耗 / 花费与预算 / 每日消费 / 任务完成 /
//       建议闭环 / 结算 / 大交通;支持一键复制文字摘要
// ============================================================
import { computed } from 'vue'
import { useContentStore } from '@/stores/content'
import { fmtRange, fmtDay, todayISO, relKey } from '@/utils/date'
import { money } from '@/utils/money'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  plan: { type: Object, required: true }
})
const emit = defineEmits(['update:modelValue'])
const content = useContentStore()

const days = computed(() => content.rowsOf(props.plan.id, 'days').slice().sort((a, b) => a.date.localeCompare(b.date)))
const bills = computed(() => content.rowsOf(props.plan.id, 'bills'))
const todos = computed(() => content.rowsOf(props.plan.id, 'todos'))
const comments = computed(() => content.rowsOf(props.plan.id, 'comments'))
const transits = computed(() => content.rowsOf(props.plan.id, 'transits'))
const fuel = computed(() => content.rowsOf(props.plan.id, 'fuel'))
const vehicle = computed(() => content.rowsOf(props.plan.id, 'vehicle')[0] || null)
const reminders = computed(() => content.rowsOf(props.plan.id, 'reminders'))

const isEnded = computed(() => props.plan.end_date < todayISO())

/* ---------- 里程 ---------- */
const driveMinTotal = computed(() =>
  days.value.reduce((s, d) => s + (d.destinations || []).reduce((a, x) => a + (Number(x.drive_min) || 0), 0), 0)
)
const estKm = computed(() => Math.round((driveMinTotal.value / 60) * 65))

const fuelDeltaKm = computed(() => {
  const odos = fuel.value.map((f) => Number(f.odometer)).filter((n) => n > 0)
  return odos.length >= 2 ? Math.round(Math.max(0, odos[odos.length - 1] - odos[0])) : 0
})
const fuelLiters = computed(() => fuel.value.reduce((s, f) => s + Number(f.liters || 0), 0))
const fuelCost = computed(() => fuel.value.reduce((s, f) => s + Number(f.amount || 0), 0))
const realCons = computed(() => (fuelDeltaKm.value > 0 && fuelLiters.value > 0 ? (fuelLiters.value / fuelDeltaKm.value) * 100 : null))

/* ---------- 花费 ---------- */
const totalSpent = computed(() => bills.value.reduce((s, b) => s + Number(b.amount || 0), 0))
const budget = computed(() => Number(props.plan.budget) || 0)
const budgetPct = computed(() => (budget > 0 ? Math.round((totalSpent.value / budget) * 100) : null))
const peopleCount = computed(() => Math.max(1, props.plan.members?.length || 1))

const byCat = computed(() => {
  const map = new Map()
  const CATS = { stay: '住宿', food: '餐饮', fuel: '加油', ticket: '门票', toll: '过路', other: '其他' }
  for (const b of bills.value) {
    const k = CATS[b.category] || '其他'
    map.set(k, (map.get(k) || 0) + Number(b.amount || 0))
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
})

/* ---------- 任务 / 建议 ---------- */
const todoDone = computed(() => todos.value.filter((t) => t.done).length)
const todoPct = computed(() => (todos.value.length ? Math.round((todoDone.value / todos.value.length) * 100) : null))
const openCount = computed(() => todos.value.length - todoDone.value)

const cmOpen = computed(() => comments.value.filter((c) => c.status === 'open').length)
const cmAccepted = computed(() => comments.value.filter((c) => c.status === 'accepted').length)
const cmDone = computed(() => comments.value.filter((c) => c.status === 'done').length)

/* ---------- 结算 ---------- */
const settle = computed(() => {
  const stat = new Map()
  for (const p of props.plan.members || []) stat.set(p.id, { id: p.id, name: p.name, credit: 0, share: 0 })
  for (const b of bills.value) {
    const n = b.involves?.length || 0
    if (!n) continue
    const each = Number(b.amount || 0) / n
    for (const inv of b.involves) {
      const s = stat.get(inv.id)
      if (s) s.share += each
    }
    const payer = stat.get(b.paid_by?.id)
    if (payer) payer.credit += Number(b.amount || 0)
  }
  return [...stat.values()].map((s) => ({ ...s, net: s.credit - s.share }))
})

/* ---------- 复制文字摘要 ---------- */
function buildText() {
  const lines = []
  lines.push(`【${props.plan.name} · 行程复盘】`)
  lines.push(`时间:${fmtRange(props.plan.start_date, props.plan.end_date)} 状态:${isEnded.value ? '已结束' : '进行中'}`)
  const kmPart = estKm.value ? `路线自驾约 ${estKm.value} km` : ''
  const fuelPart = fuelDeltaKm.value ? `里程表实测 ${fuelDeltaKm.value} km` : ''
  if (kmPart || fuelPart) lines.push(`里程:${[kmPart, fuelPart].filter(Boolean).join(' / ') || '—'}`)
  if (fuelLiters.value) lines.push(`加油:${fuelLiters.value} L,花费 ${money(fuelCost.value)}` + (realCons.value ? `,实测 ${realCons.value.toFixed(1)} L/100km` : ''))
  lines.push(`花费:合计 ${money(totalSpent.value)}` + (budget ? `,预算 ${money(budget)}(${budgetPct}%)` : '') + `,人均约 ${money(totalSpent.value / peopleCount.value)}`)
  if (byCat.value.length) lines.push(`分类:${byCat.value.map(([k, v]) => `${k} ${money(v)}`).join('、')}`)
  if (todoPct !== null) lines.push(`任务:${todoDone.value}/${todos.value.length} 完成(${todoPct}%)` + (openCount.value ? `,待办 ${openCount.value} 项` : ''))
  if (comments.value.length) lines.push(`建议:共 ${comments.value.length} 条(待采纳 ${cmOpen.value} / 已采纳 ${cmAccepted.value} / 闭环 ${cmDone.value})`)
  const transitIn = transits.value.filter((t) => t.direction === 'in' && t.mode !== 'car').length
  if (transitIn) lines.push(`大交通:${transitIn} 人乘飞机/高铁抵达`)
  const owes = settle.value.filter((s) => s.net < -0.5)
  const gets = settle.value.filter((s) => s.net > 0.5)
  if (owes.length || gets.length) {
    lines.push('结算:' + (gets.map((g) => `${g.name} 应收 ${money(g.net)}`).join('、') || '') + (owes.map((o) => `${o.name} 应补 ${money(-o.net)}`).join('、') ? ';' + owes.map((o) => `${o.name} 应补 ${money(-o.net)}`).join('、') : ''))
  }
  lines.push(`生成于 ${new Date().toLocaleString('zh-CN')} · 兔兔同行`)
  return lines.join('\n')
}

let copied = false
function copySummary() {
  const text = buildText()
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => (copied = true)).catch(() => {})
  } else {
    window.prompt('复制复盘摘要', text)
  }
  setTimeout(() => (copied = false), 2000)
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    title="行程复盘"
    :max-width="'560px'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="space-y-4">
      <p class="muted -mt-1 text-[12.5px]">
        {{ plan.name }} · {{ fmtRange(plan.start_date, plan.end_date) }}
        <span class="chip ml-1 !px-2 !py-0 !text-[10.5px]" :class="isEnded ? 'chip-plain' : relKey(plan.end_date) === 'earlier' ? '' : 'chip-brand'">
          {{ isEnded ? '已结束' : '进行中' }}
        </span>
      </p>

      <!-- 里程与车 -->
      <div class="card bg-surface-2/50 p-4">
        <p class="mb-2 flex items-center gap-2 text-[13px] font-bold text-ink">
          <i class="fa-solid fa-road text-primary" aria-hidden="true"></i>里程与车辆
        </p>
        <div class="grid grid-cols-2 gap-3 text-[12.5px]">
          <p class="text-ink-soft">路线估算:<b class="text-ink">{{ estKm }} km</b><span v-if="fuelDeltaKm" class="muted"> · 实测 {{ fuelDeltaKm }} km</span></p>
          <p class="text-ink-soft">实测油耗:<b class="text-ink">{{ realCons ? realCons.toFixed(1) + ' L/100km' : '—' }}</b><span v-if="vehicle?.name" class="muted"> · {{ vehicle.name }}</span></p>
          <p class="text-ink-soft">加油:<b class="text-ink">{{ fuelLiters ? fuelLiters.toFixed(1) + ' L' : '—' }}</b></p>
          <p class="text-ink-soft">油费:<b class="text-ink">{{ money(fuelCost) }}</b></p>
        </div>
      </div>

      <!-- 花费 -->
      <div class="card bg-surface-2/50 p-4">
        <p class="mb-2 flex items-center gap-2 text-[13px] font-bold text-ink">
          <i class="fa-solid fa-wallet text-primary" aria-hidden="true"></i>花费与预算
        </p>
        <div class="grid grid-cols-3 gap-3 text-[12.5px]">
          <p class="text-ink-soft">合计<br /><b class="text-[16px] text-ink">{{ money(totalSpent) }}</b></p>
          <p class="text-ink-soft">预算<br /><b class="text-[16px] text-ink">{{ budget ? money(budget) : '未设' }}</b></p>
          <p class="text-ink-soft">人均<br /><b class="text-[16px] text-ink">{{ money(totalSpent / peopleCount) }}</b></p>
        </div>
        <div v-if="budgetPct !== null" class="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            class="h-full rounded-full transition-[width] duration-500"
            :class="budgetPct > 100 ? 'bg-rose' : 'bg-primary'"
            :style="{ width: Math.min(100, budgetPct) + '%' }"
          ></div>
        </div>
        <p v-if="byCat.length" class="mt-3 flex flex-wrap gap-1.5">
          <span v-for="[k, v] in byCat" :key="k" class="chip chip-plain !text-[11px]">{{ k }} {{ money(v) }}</span>
        </p>
      </div>

      <!-- 任务与协作 -->
      <div class="grid grid-cols-2 gap-3">
        <div class="card bg-surface-2/50 p-4">
          <p class="mb-1 flex items-center gap-2 text-[13px] font-bold text-ink"><i class="fa-solid fa-list-check text-primary" aria-hidden="true"></i>任务</p>
          <p class="text-[15px] font-bold text-ink">{{ todoPct === null ? '无' : todoPct + '%' }}</p>
          <p class="muted text-[11.5px]">{{ todoDone }} / {{ todos.length }} 完成,剩 {{ openCount }} 项待办</p>
        </div>
        <div class="card bg-surface-2/50 p-4">
          <p class="mb-1 flex items-center gap-2 text-[13px] font-bold text-ink"><i class="fa-regular fa-message text-primary" aria-hidden="true"></i>建议闭环</p>
          <p class="text-[15px] font-bold text-ink">{{ comments.length }} 条</p>
          <p class="muted text-[11.5px]">待采纳 {{ cmOpen }} · 已采纳 {{ cmAccepted }} · 闭环 {{ cmDone }}</p>
        </div>
      </div>

      <!-- 结算 -->
      <div class="card bg-surface-2/50 p-4">
        <p class="mb-2 flex items-center gap-2 text-[13px] font-bold text-ink"><i class="fa-solid fa-scale-balanced text-primary" aria-hidden="true"></i>结算</p>
        <div v-if="settle.length" class="space-y-1 text-[12.5px]">
          <p v-for="s in settle" :key="s.id" class="flex justify-between">
            <span class="text-ink-soft">{{ s.name }}</span>
            <span class="font-semibold" :class="s.net > 0.5 ? 'text-[#16a34a]' : s.net < -0.5 ? 'text-rose' : 'text-muted'">
              {{ s.net > 0.5 ? '应收 ' + money(s.net) : s.net < -0.5 ? '应补 ' + money(-s.net) : '两清' }}
            </span>
          </p>
        </div>
        <p v-else class="muted text-[12px]">还没有分账记录</p>
      </div>

      <p v-if="reminders.filter((r) => !r.read && relKey(r.date) !== 'earlier').length" class="muted text-[11.5px]">
        还有 {{ reminders.filter((r) => !r.read && relKey(r.date) !== 'earlier').length }} 条未读提醒,建议先处理完再散伙~
      </p>
    </div>

    <template #footer>
      <span v-if="copied" class="mr-auto self-center text-[12px] text-[#16a34a]"><i class="fa-solid fa-check mr-1" aria-hidden="true"></i>已复制</span>
      <BaseButton variant="ghost" @click="emit('update:modelValue', false)">关闭</BaseButton>
      <BaseButton icon="fa-copy" @click="copySummary">复制复盘文字</BaseButton>
    </template>
  </BaseModal>
</template>
