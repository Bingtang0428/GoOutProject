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
import { toast } from '@/composables/toast'
import BaseButton from '@/components/ui/BaseButton.vue'
import InfoHint from '@/components/ui/InfoHint.vue'

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
  { key: 'stay', label: '住宿', color: '#B75973', weight: 0.35 },
  { key: 'food', label: '餐饮', color: '#F2A48E', weight: 0.2 },
  { key: 'fuel', label: '加油', color: '#C3A0EA', weight: 0.12 },
  { key: 'ticket', label: '门票', color: '#F2C464', weight: 0.15 },
  { key: 'toll', label: '过路', color: '#7FC8A9', weight: 0.06 },
  { key: 'other', label: '其他', color: '#9BB0C9', weight: 0.12 }
]

/** 分类的规划预算与已花(全部展示,便于规划阶段先分配) */
const byCat = computed(() => {
  const map = new Map()
  for (const b of bills.value) {
    map.set(b.category, (map.get(b.category) || 0) + Number(b.amount || 0))
  }
  return CATS.map((c) => ({ ...c, amount: map.get(c.key) || 0, sub: Number(subBudgets.value[c.key]) || 0 }))
})
const anyCatData = computed(() => byCat.value.some((c) => c.amount > 0 || c.sub > 0))

/** 按参考比例把总预算分配到各分类(规划阶段一键生成) */
function autoAllocate() {
  if (!isOwner.value || totalBudget.value <= 0) return
  const next = {}
  for (const c of CATS) next[c.key] = Math.round((totalBudget.value * c.weight) / 10) * 10
  plansStore.updatePlan(props.plan.id, { sub_budgets: next })
  toast('已按参考比例生成分类预算')
}

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

    <!-- 分类预算与花费(规划 + 实际) -->
    <div class="card p-6">
      <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p class="title-2 flex items-center gap-2">
          <i class="fa-solid fa-clipboard-list text-primary" aria-hidden="true"></i>分类预算与花费
          <InfoHint
            align="left"
            text="规划阶段先给每类一个大概预算(如住宿约占多少、交通大概多少),再对照实际花费;可点「参考分配」按比例一键生成。"
          />
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <span
            v-if="subTotal"
            class="chip !text-[11px]"
            :class="totalBudget && subTotal > totalBudget ? 'chip-rose' : 'chip-plain'"
          >
            规划合计 {{ money(subTotal) }}<template v-if="totalBudget"> / 总预算 {{ money(totalBudget) }}</template>
          </span>
          <BaseButton
            v-if="isOwner && totalBudget > 0"
            size="sm"
            variant="soft"
            icon="fa-wand-magic-sparkles"
            @click="autoAllocate"
          >参考分配</BaseButton>
        </div>
      </div>
      <p class="muted mb-4 text-[11.5px]">「规划预算」为总额;括号内是该类的人均参考。</p>
      <div class="space-y-3">
        <div v-for="c in byCat" :key="c.key" class="flex flex-wrap items-center gap-3">
          <span class="chip chip-plain w-16 shrink-0 !justify-center">
            <span class="dot mr-1.5" :style="{ background: c.color }"></span>{{ c.label }}
          </span>
          <div class="min-w-[120px] flex-1">
            <div class="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                class="h-full rounded-full transition-[width] duration-500 ease-out"
                :style="{ width: Math.max(2, (c.amount / (c.sub || spent || 1)) * 100) + '%', background: c.color }"
              ></div>
            </div>
            <p class="muted mt-1 text-[11px]">
              <template v-if="c.sub">规划 {{ money(c.sub) }}(人均 {{ money(c.sub / count) }}) · 已花 </template>
              <template v-else>已花 </template>
              {{ money(c.amount) }}
              <template v-if="c.sub"> · {{ Math.round((c.amount / c.sub) * 100) }}%</template>
            </p>
          </div>
          <input
            v-if="isOwner"
            type="number"
            min="0"
            class="field !w-24 !py-1 !text-[12px]"
            :value="c.sub || ''"
            placeholder="规划"
            :title="`给「${c.label}」设置规划预算`"
            @change="(e) => onSubBudgetChange(c.key, e)"
          />
          <span v-else class="w-20 shrink-0 text-right text-[12px] font-semibold text-ink">{{ c.sub ? money(c.sub) : '—' }}</span>
        </div>
      </div>
      <p v-if="totalBudget && subTotal > totalBudget" class="mt-3 text-[12px] font-medium text-rose">
        <i class="fa-solid fa-circle-exclamation mr-1" aria-hidden="true"></i>分类规划合计已超出总预算 {{ money(subTotal - totalBudget) }}
      </p>
      <p v-else-if="!anyCatData" class="muted mt-3 text-[12px]">
        还没有预算与支出 —— 可先设置人均预算后点「参考分配」,快速得到住宿/交通/餐饮等的大致占比。
      </p>
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
