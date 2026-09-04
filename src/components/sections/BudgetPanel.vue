<script setup>
// ============================================================
// 预算看板 —— 与分账数据联动
// 总预算(创建者可设)→ 实时已花/剩余/超支,按分类可视化
// ============================================================
import { computed } from 'vue'
import { useContentStore } from '@/stores/content'
import { usePlansStore } from '@/stores/plans'
import { money } from '@/utils/money'

const props = defineProps({
  plan: { type: Object, required: true }
})
const content = useContentStore()
const plansStore = usePlansStore()

const bills = computed(() => content.rowsOf(props.plan.id, 'bills'))
const budget = computed(() => Number(props.plan.budget) || 0)

const spent = computed(() => bills.value.reduce((s, b) => s + Number(b.amount || 0), 0))
const pct = computed(() => (budget.value > 0 ? Math.min(100, (spent.value / budget.value) * 100) : 0))
const remaining = computed(() => budget.value - spent.value)
const isOwner = computed(() => plansStore.myRole(props.plan) === 'owner')

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
  return CATS.map((c) => ({ ...c, amount: map.get(c.key) || 0 })).filter((c) => c.amount > 0)
})

/** 预算输入(仅创建者) */
function onBudgetChange(e) {
  const v = e.target.value
  plansStore.updatePlan(props.plan.id, { budget: v === '' ? null : Number(v) || 0 })
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
          <label class="flabel !mb-0">总预算 ¥</label>
          <input
            type="number"
            min="0"
            class="field !w-32 !py-2 text-[14px] font-bold text-ink"
            :value="budget || ''"
            placeholder="未设置"
            @change="onBudgetChange"
          />
        </div>
        <span v-else-if="budget" class="chip chip-brand">{{ money(budget) }} 总预算</span>
      </div>

      <template v-if="budget > 0">
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
        <p class="muted mt-2 text-[12px]">已用 {{ Math.round(pct) }}%</p>
      </template>
      <p v-else class="muted mt-4 text-[13px]">
        <i class="fa-regular fa-lightbulb mr-1.5" aria-hidden="true"></i>
        {{ isOwner ? '设置一个总预算,账单花到哪一目了然。' : '创建者还未设置总预算,可以提个建议让他设置。' }}
      </p>
    </div>

    <!-- 按分类 -->
    <div class="card p-6">
      <p class="title-2 mb-4">按分类花费</p>
      <div v-if="byCat.length" class="space-y-4">
        <div v-for="c in byCat" :key="c.key" class="flex items-center gap-4">
          <span class="chip chip-plain w-16 shrink-0 !justify-center">
            <span class="dot mr-1.5" :style="{ background: c.color }"></span>{{ c.label }}
          </span>
          <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              class="h-full rounded-full transition-[width] duration-500 ease-out"
              :style="{ width: Math.max(4, (c.amount / spent) * 100) + '%', background: c.color }"
            ></div>
          </div>
          <span class="w-20 shrink-0 text-right text-[13px] font-bold text-ink">{{ money(c.amount) }}</span>
        </div>
      </div>
      <p v-else class="muted text-[13px]">还没有任何支出,记下第一笔后这里会自动统计。</p>
    </div>

    <!-- 人日均/预算分配提示 -->
    <div class="card p-6">
      <p class="title-2 mb-3">分摊参考</p>
      <p class="text-[13.5px] leading-7 text-ink-soft">
        全队 {{ plan.members?.length || 1 }} 名参与者
        <template v-if="budget > 0">
          ,人均预算约 <b class="text-primary">{{ money(budget / Math.max(1, plan.members?.length || 1)) }}</b>;
        </template>
        <template v-if="spent > 0">
          人均已花 <b class="text-primary">{{ money(spent / Math.max(1, plan.members?.length || 1)) }}</b>
        </template>
        。详情可在「记账」页查看每人应收 / 应补。
      </p>
    </div>
  </section>
</template>
