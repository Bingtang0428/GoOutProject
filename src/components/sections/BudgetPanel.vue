<script setup>
// ============================================================
// 预算看板 —— 与分账数据联动
// 总预算(创建者可设)→ 实时已花/剩余/超支,按分类可视化
// ============================================================
import { computed } from 'vue'
import { useContentStore } from '@/stores/content'
import { usePlansStore } from '@/stores/plans'
import { money } from '@/utils/money'
import { fmtDay } from '@/utils/date'

const props = defineProps({
  plan: { type: Object, required: true }
})
const content = useContentStore()
const plansStore = usePlansStore()

const bills = computed(() => content.rowsOf(props.plan.id, 'bills'))
const budget = computed(() => Number(props.plan.budget) || 0) // 兼容旧的「总额」预算
const count = computed(() => Math.max(1, props.plan.members?.length || 1))

/** 人均预算:优先用 budget_per;旧数据回退为 总额/人数 */
const perBudget = computed(() => {
  const bp = Number(props.plan.budget_per) || 0
  if (bp > 0) return bp
  return budget.value > 0 ? budget.value / count.value : 0
})
const totalBudget = computed(() => perBudget.value * count.value)

const spent = computed(() => bills.value.reduce((s, b) => s + Number(b.amount || 0), 0))
const perSpent = computed(() => spent.value / count.value)
const pct = computed(() => (totalBudget.value > 0 ? Math.min(100, (spent.value / totalBudget.value) * 100) : 0))
const remaining = computed(() => totalBudget.value - spent.value)
const isOwner = computed(() => plansStore.myRole(props.plan) === 'owner')

/* 分类子预算 */
const subBudgets = computed(() => props.plan.sub_budgets || {})
const subTotal = computed(() =>
  Object.values(subBudgets.value).reduce((s, v) => s + (Number(v) || 0), 0)
)
function onSubBudgetChange(key, e) {
  const v = e.target.value
  const next = { ...subBudgets.value }
  if (v === '' || Number(v) <= 0) delete next[key]
  else next[key] = Number(v)
  plansStore.updatePlan(props.plan.id, { sub_budgets: next })
}

const CATS = [
  { key: 'stay', label: '住宿', color: '#B75973' },
  { key: 'food', label: '餐饮', color: '#F2A48E' },
  { key: 'fuel', label: '加油', color: '#C3A0EA' },
  { key: 'ticket', label: '门票', color: '#F2C464' },
  { key: 'toll', label: '过路', color: '#7FC8A9' },
  { key: 'other', label: '其他', color: '#9BB0C9' }
]

const byCat = computed(() => {
  const map = new Map()
  for (const b of bills.value) {
    const c = CATS.find((x) => x.key === b.category) || CATS[5]
    map.set(c.key, (map.get(c.key) || 0) + Number(b.amount || 0))
  }
  return CATS.map((c) => ({ ...c, amount: map.get(c.key) || 0, sub: Number(subBudgets.value[c.key]) || 0 })).filter(
    (c) => c.amount > 0 || c.sub > 0
  )
})

/** 按日花费:优先按「实际消费日期」分摊到旅行各天;未填则按付款日期 */
const byDay = computed(() => {
  const map = new Map()
  const bump = (d, amount) => {
    const list = map.get(d) || { date: d, amount: 0, count: 0 }
    list.amount += amount
    list.count++
    map.set(d, list)
  }
  for (const b of bills.value) {
    const amount = Number(b.amount || 0)
    const sd = Array.isArray(b.spend_dates) ? [...new Set(b.spend_dates.filter(Boolean))] : []
    if (sd.length) {
      const each = amount / sd.length
      for (const d of sd) bump(d, each)
    } else {
      bump(b.date || new Date(b.created_at || Date.now()).toISOString().slice(0, 10), amount)
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
})
const dayMax = computed(() => Math.max(1, ...byDay.value.map((d) => d.amount)))
const dayTotal = computed(() => byDay.value.reduce((s, d) => s + d.amount, 0))

/** 人均预算输入(仅创建者) */
function onBudgetChange(e) {
  const v = e.target.value
  plansStore.updatePlan(props.plan.id, { budget_per: v === '' ? null : Number(v) || 0 })
}
</script>

<template>
  <section class="space-y-5">
    <!-- 预算主卡片 -->
    <div class="card p-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="title-2 flex items-center gap-2">
            <i class="fa-solid fa-wallet text-primary" aria-hidden="true"></i>
            预算总览
          </p>
          <p class="muted mt-1 text-[12.5px]">{{ bills.length }} 笔已记录 · 实时汇总自分账</p>
        </div>
        <div v-if="isOwner" class="flex items-center gap-2">
          <label class="flabel !mb-0">人均预算 ¥</label>
          <input
            type="number"
            min="0"
            class="field !w-32 !py-2 text-[14px] font-bold text-ink"
            :value="perBudget ? Math.round(perBudget) : ''"
            placeholder="未设置"
            @change="onBudgetChange"
          />
        </div>
        <span v-else-if="perBudget" class="chip chip-brand">人均 {{ money(perBudget) }}</span>
      </div>

      <template v-if="perBudget > 0">
        <div class="mt-5 flex items-end justify-between text-[13px]">
          <span class="font-semibold text-ink">{{ money(spent) }} <span class="muted font-normal">已花</span></span>
          <span
            class="chip"
            :class="remaining < 0 ? 'chip-rose' : pct >= 80 ? 'chip-amber' : 'chip-success'"
          >
            <span class="dot"></span>
            {{ remaining < 0 ? '超支 ' + money(-remaining) : pct >= 80 ? '接近预算 · 剩 ' + money(remaining) : '剩余 ' + money(remaining) }}
          </span>
        </div>
        <div class="mt-2 h-3 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            class="h-full rounded-full transition-[width] duration-500 ease-out"
            :class="remaining < 0 ? 'bg-gradient-to-r from-rose to-[#f43f5e]' : 'bg-gradient-to-r from-[#e79ab1] to-primary'"
            :style="{ width: Math.min(100, pct) + '%' }"
          ></div>
        </div>
        <p class="muted mt-2 text-[12px]">
          已用 {{ Math.round(pct) }}% · 人均预算 {{ money(perBudget) }} × {{ count }} 人 = 总预算 {{ money(totalBudget) }}
        </p>
      </template>
      <p v-else class="muted mt-4 text-[13px]">
        <i class="fa-regular fa-lightbulb mr-1.5" aria-hidden="true"></i>
        {{ isOwner ? '设置一个「人均预算」,账单花到哪一目了然。' : '创建者还未设置预算,可以提个建议让他设置。' }}
      </p>
    </div>

    <!-- 按分类 -->
    <div class="card p-6">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p class="title-2">按分类花费</p>
        <span v-if="subTotal" class="chip chip-plain !text-[11px]">分类子预算合计 {{ money(subTotal) }}</span>
      </div>
      <div v-if="byCat.length" class="space-y-3">
        <div v-for="c in byCat" :key="c.key" class="flex flex-wrap items-center gap-3">
          <span class="chip chip-plain w-16 shrink-0 !justify-center">
            <span class="dot mr-1.5" :style="{ background: c.color }"></span>{{ c.label }}
          </span>
          <div class="min-w-[120px] flex-1">
            <div class="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                class="h-full rounded-full transition-[width] duration-500 ease-out"
                :style="{ width: Math.max(4, (c.amount / (c.sub || spent || 1)) * 100) + '%', background: c.color }"
              ></div>
            </div>
            <p v-if="c.sub" class="muted mt-1 text-[11px]">
              子预算 {{ money(c.sub) }} · 已用 {{ Math.round((c.amount / c.sub) * 100) }}%
            </p>
          </div>
          <span class="w-20 shrink-0 text-right text-[13px] font-bold text-ink">{{ money(c.amount) }}</span>
          <input
            v-if="isOwner"
            type="number"
            min="0"
            class="field !w-24 !py-1 !text-[12px]"
            :value="c.sub || ''"
            placeholder="子预算"
            :title="`给「${c.label}」设置分类子预算`"
            @change="(e) => onSubBudgetChange(c.key, e)"
          />
        </div>
      </div>
      <p v-else class="muted text-[13px]">还没有任何支出,记下第一笔后这里会自动统计。</p>
    </div>

    <!-- 按日花费 -->
    <div class="card p-6">
      <div class="mb-4 flex items-center justify-between">
        <p class="title-2">按日花费</p>
        <span v-if="byDay.length" class="chip chip-plain !text-[11px]">
          <i class="fa-solid fa-chart-column mr-1 text-primary/70" aria-hidden="true"></i>共 {{ dayTotal ? money(dayTotal) : '¥0' }}
        </span>
      </div>
      <div v-if="byDay.length" class="space-y-3">
        <div v-for="d in byDay" :key="d.date" class="flex items-center gap-3">
          <span class="w-20 shrink-0 text-[12px] font-semibold text-ink-soft">{{ fmtDay(d.date, false) }}</span>
          <div class="relative h-7 flex-1 overflow-hidden rounded-[8px] bg-surface-2">
            <div
              class="h-full rounded-[8px] bg-gradient-to-r from-[#e79ab1] to-primary transition-[width] duration-500 ease-out"
              :style="{ width: Math.max(6, (d.amount / dayMax) * 100) + '%' }"
            ></div>
            <span class="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold" :class="d.amount / dayMax > 0.45 ? 'text-white' : 'text-muted'">
              {{ money(d.amount) }}
              <template v-if="d.count > 1">({{ d.count }} 笔)</template>
            </span>
          </div>
        </div>
      </div>
      <p v-else class="muted text-[13px]">
        还没有按日账单 —— 记一笔时填上「实际消费日期」,这里会显示每天的消费曲线。
      </p>
    </div>

    <!-- 人日均/预算分配提示 -->
    <div class="card p-6">
      <p class="title-2 mb-3">分摊参考</p>
      <p class="text-[13.5px] leading-7 text-ink-soft">
        全队 {{ plan.members?.length || 1 }} 名参与者
        <template v-if="perBudget > 0">
          ,人均预算约 <b class="text-primary">{{ money(perBudget) }}</b>(总预算 {{ money(totalBudget) }});
        </template>
        <template v-if="spent > 0">
          人均已花 <b class="text-primary">{{ money(perSpent) }}</b>
        </template>
        。详情可在「记账」页查看每人应收 / 应补。
      </p>
    </div>
  </section>
</template>
