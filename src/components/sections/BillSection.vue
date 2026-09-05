<script setup>
// ============================================================
// 分账(与 食宿/行程 联动)
//  - 每笔记录「谁付的钱 + 涉及分摊的人」,按人聚合收支
//  - 记账时可选关联已有住宿(stays)或路线地点(dest),自动带上名称
//  - 下方按人分开展示:垫付(应收)/ 应摊(应付)/ 结余,附简易转账建议
// Props: plan / canEdit
// ============================================================
import { ref, computed, reactive } from 'vue'
import { useContentStore } from '@/stores/content'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Avatar from '@/components/ui/Avatar.vue'
import BudgetPanel from './BudgetPanel.vue'
import VehiclePanel from './VehiclePanel.vue'
import { money } from '@/utils/money'
import { toast } from '@/composables/toast'
import { fmtDay, todayISO } from '@/utils/date'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const store = useContentStore()

const linkOpen = ref(false) // 「从行程记账」下拉
const mode = ref('ledger') // ledger 记账 | budget 预算看板 | vehicle 车辆里程

const bills = computed(() => store.rowsOf(props.plan.id, 'bills').slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')))

// 全体参与分账的人 = 参与者 + 创建者(不重复)
const people = computed(() => {
  const list = [...(props.plan.members || [])]
  if (props.plan.owner_id && !list.some((m) => m.id === props.plan.owner_id)) {
    const owner = [...(props.plan.viewers || []), ...list].find((m) => m.id === props.plan.owner_id)
    if (owner) list.unshift(owner)
  }
  return list
})

const CATS = [
  { key: 'stay', icon: 'fa-hotel', label: '住宿', tone: 'brand' },
  { key: 'food', icon: 'fa-utensils', label: '餐饮', tone: 'amber' },
  { key: 'fuel', icon: 'fa-gas-pump', label: '加油', tone: 'plain' },
  { key: 'ticket', icon: 'fa-ticket', label: '门票', tone: 'brand' },
  { key: 'toll', icon: 'fa-road', label: '过路', tone: 'plain' },
  { key: 'other', icon: 'fa-ellipsis', label: '其他', tone: 'plain' }
]

// 可关联对象:全部住宿 + 全部路线地点(联动数据源)
const linkable = computed(() => {
  const stays = store.rowsOf(props.plan.id, 'stays').map((s) => ({
    type: 'stay',
    id: s.id,
    name: `${s.name}${s.address ? '(' + s.address + ')' : ''}`
  }))
  const dests = []
  for (const d of store.rowsOf(props.plan.id, 'days')) {
    for (const x of d.destinations || []) dests.push({ type: 'dest', id: x.id, name: `${x.place} · ${d.date.slice(5)}` })
  }
  return [...stays, ...dests]
})

/* ---------------- 新增/编辑 ---------------- */
const showForm = ref(false)
const editingId = ref(null)
const form = reactive({
  name: '',
  amount: null,
  date: todayISO(),
  category: 'other',
  paid_by: null, // {id,name}
  involves: [],
  split: 'equal', // equal 人均 | custom 自定义份额
  shares: {}, // personId -> 权重
  link: null, // {type,id,name}
  note: ''
})

function resetForm() {
  const all = people.value
  Object.assign(form, {
    name: '',
    amount: null,
    date: todayISO(),
    category: 'other',
    paid_by: all[0] ? { id: all[0].id, name: all[0].name } : null,
    involves: all.map((p) => ({ id: p.id, name: p.name })),
    split: 'equal',
    shares: {},
    link: null,
    note: ''
  })
}

function openAdd(preLink) {
  editingId.value = null
  resetForm()
  if (preLink) {
    form.link = preLink
    form.name = preLink.name
    if (preLink.type === 'stay') form.category = 'stay'
    else if (preLink.name?.includes('餐')) form.category = 'food'
  }
  showForm.value = true
}

function openEdit(b) {
  editingId.value = b.id
  Object.assign(form, {
    name: b.name,
    amount: b.amount,
    date: b.date || todayISO(),
    category: b.category,
    paid_by: b.paid_by ? { id: b.paid_by.id, name: b.paid_by.name } : null,
    involves: (b.involves || []).map((i) => ({ id: i.id, name: i.name })),
    split: b.split === 'custom' ? 'custom' : 'equal',
    shares: { ...(b.shares || {}) },
    link: b.link || null,
    note: b.note || ''
  })
  showForm.value = true
}

function toggleInvolve(p) {
  const i = form.involves.findIndex((x) => x.id === p.id)
  if (i === -1) form.involves.push({ id: p.id, name: p.name })
  else form.involves.splice(i, 1)
}

function amountValid() {
  const n = Number(form.amount)
  return !!(form.name.trim() && form.paid_by && form.involves.length && Number.isFinite(n) && n > 0)
}

async function save() {
  if (!amountValid()) return
  const payload = {
    name: form.name.trim(),
    amount: Math.round(Number(form.amount) * 100) / 100,
    date: form.date,
    category: form.category,
    paid_by: { id: form.paid_by.id, name: form.paid_by.name },
    involves: form.involves,
    split: form.split,
    shares:
      form.split === 'custom'
        ? form.involves.reduce((acc, p) => {
            const w = Number(form.shares[p.id])
            if (Number.isFinite(w) && w > 0) acc[p.id] = w
            return acc
          }, {})
        : {},
    link: form.link,
    note: form.note.trim()
  }
  if (editingId.value) await store.updateBill(props.plan.id, editingId.value, payload)
  else await store.addBill(props.plan.id, payload)
  toast(editingId.value ? '账单已更新' : '已记一笔')
  showForm.value = false
}

/* ---------------- 按人聚合 ---------------- */
const rows = computed(() => bills.value)

/* 分摊方式:equal 人均 / custom 自定义份额(权重,按比例分摊) */
function weightOf(b, pid) {
  const w = b.shares?.[pid]
  const n = Number(w)
  return Number.isFinite(n) && n > 0 ? n : 1
}
function sharesFor(b) {
  const list = b.involves || []
  const n = list.length
  const out = new Map()
  if (!n) return out
  if (b.split !== 'custom') {
    const each = Number(b.amount || 0) / n
    for (const inv of list) out.set(inv.id, each)
    return out
  }
  const total = list.reduce((s, inv) => s + weightOf(b, inv.id), 0) || 1
  for (const inv of list) out.set(inv.id, (Number(b.amount || 0) * weightOf(b, inv.id)) / total)
  return out
}

const settlement = computed(() => {
  const stat = new Map()
  for (const p of people.value) stat.set(p.id, { id: p.id, name: p.name, credit: 0, share: 0, count: 0 })
  for (const b of bills.value) {
    const shareMap = sharesFor(b)
    for (const inv of b.involves || []) {
      const s = stat.get(inv.id)
      if (!s) continue
      s.share += shareMap.get(inv.id) || 0
      s.count++
    }
    if (b.paid_by) {
      const s = stat.get(b.paid_by.id)
      if (s) s.credit += b.amount
      else stat.set(b.paid_by.id, { id: b.paid_by.id, name: b.paid_by.name, credit: b.amount, share: 0, count: 0 })
    }
  }
  return [...stat.values()].map((s) => ({ ...s, balance: s.credit - s.share }))
})

// 简易转账建议(贪心撮合,金额取整到元)
const transferPlan = computed(() => {
  const owes = settlement.value.filter((s) => s.balance < -0.005).map((s) => ({ ...s, v: Math.round(-s.balance) }))
  const gets = settlement.value.filter((s) => s.balance > 0.005).map((s) => ({ ...s, v: Math.round(s.balance) }))
  const steps = []
  let i = 0
  let j = 0
  while (i < owes.length && j < gets.length) {
    const m = Math.min(owes[i].v, gets[j].v)
    if (m > 0) steps.push({ from: owes[i].name, to: gets[j].name, amount: m })
    owes[i].v -= m
    gets[j].v -= m
    if (owes[i].v <= 0) i++
    if (gets[j].v <= 0) j++
  }
  return steps
})

const totalAmount = computed(() => bills.value.reduce((s, b) => s + Number(b.amount || 0), 0))

const catOf = (key) => CATS.find((c) => c.key === key) || CATS[CATS.length - 1]

/** 显示名称;若成员已离开计划则取快照 */
const whoName = (ref) => ref?.name || '未知'

function linkChip(b) {
  if (!b.link) return ''
  const hit = linkable.value.find((l) => l.type === b.link.type && l.id === b.link.id)
  return hit ? hit.name : b.link.name
}
</script>

<template>
  <section>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="title-1 flex items-center gap-3">
          <i class="fa-solid fa-scale-balanced text-[19px] text-primary" aria-hidden="true"></i>
          分账
          <span v-if="bills.length" class="chip chip-brand">{{ bills.length }} 笔</span>
          <span v-if="totalAmount" class="chip chip-amber">{{ money(totalAmount) }}</span>
        </h2>
        <p class="muted mt-1">每笔记录涉及谁、谁垫付,按人自动算清账</p>
      </div>
      <div v-if="mode === 'ledger'" class="flex items-center gap-2">
        <!-- 快捷记账:从食宿/路线一键带过来 -->
        <div v-if="canEdit" class="relative">
          <BaseButton variant="ghost" icon="fa-link" @click="linkOpen = !linkOpen">从行程记账</BaseButton>
          <Transition name="scale-in">
            <div v-if="linkOpen" class="card absolute right-0 top-11 z-30 max-h-72 w-72 overflow-y-auto p-2 shadow-pop">
              <button
                v-for="l in linkable"
                :key="l.type + l.id"
                class="flex w-full items-start gap-2 rounded-[10px] px-3 py-2 text-left transition-colors hover:bg-surface-2"
                @click="openAdd(l); linkOpen = false"
              >
                <i
                  class="fa-solid mt-1"
                  :class="l.type === 'stay' ? 'fa-hotel' : 'fa-location-dot'"
                  :style="{ color: l.type === 'stay' ? '#b75973' : '#dfa124' }"
                  aria-hidden="true"
                ></i>
                <span class="min-w-0">
                  <span class="block truncate text-[13px] font-medium text-ink">{{ l.name }}</span>
                  <span class="text-[11px] text-muted">{{ l.type === 'stay' ? '住宿' : '路线地点' }}</span>
                </span>
              </button>
              <p v-if="!linkable.length" class="px-3 py-3 text-center text-[12px] text-muted">还没有住宿或地点可关联</p>
            </div>
          </Transition>
        </div>
        <BaseButton v-if="canEdit && mode === 'ledger'" icon="fa-plus" @click="openAdd(null)">记一笔</BaseButton>
      </div>
    </div>

    <!-- 子视图切换:记账 / 预算看板 / 车辆里程 -->
    <nav class="card mb-6 flex w-fit gap-1 !rounded-pill !p-1">
      <button
        v-for="t in [
          { key: 'ledger', icon: 'fa-scale-balanced', label: '记账' },
          { key: 'budget', icon: 'fa-wallet', label: '预算看板' },
          { key: 'vehicle', icon: 'fa-car-side', label: '车辆里程' }
        ]"
        :key="t.key"
        class="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all duration-250 ease-out active:scale-95"
        :class="mode === t.key ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-primary'"
        @click="mode = t.key"
      >
        <i :class="`fa-solid ${t.icon}`" aria-hidden="true"></i>{{ t.label }}
      </button>
    </nav>

    <Transition name="fade-up" mode="out-in">
      <BudgetPanel v-if="mode === 'budget'" :key="'budget'" :plan="plan" />
      <VehiclePanel v-else-if="mode === 'vehicle'" :key="'vehicle'" :plan="plan" :can-edit="canEdit" />
      <div v-else :key="'ledger'">
    <!-- 按人结算卡片(分人展示) -->
    <div v-if="settlement.length" class="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
      <div v-for="s in settlement" :key="s.id" class="card card-lift p-5">
        <div class="mb-3 flex items-center gap-2.5">
          <Avatar :name="s.name" :size="30" />
          <div class="min-w-0">
            <p class="truncate text-[13.5px] font-semibold text-ink">{{ s.name }}</p>
            <p class="text-[11px] text-muted">参与 {{ s.count }} 笔分摊</p>
          </div>
        </div>
        <div class="space-y-1 text-[12.5px]">
          <p class="flex justify-between"><span class="muted">垫付</span><span class="font-semibold text-ink">{{ money(s.credit) }}</span></p>
          <p class="flex justify-between"><span class="muted">应摊</span><span class="font-semibold text-ink">{{ money(s.share) }}</span></p>
        </div>
        <p
          class="mt-3 rounded-[10px] px-3 py-1.5 text-center text-[13px] font-bold"
          :class="s.balance > 0.005 ? 'bg-[#16a34a]/10 text-[#16a34a]' : s.balance < -0.005 ? 'bg-rose/10 text-rose' : 'bg-surface-2 text-muted'"
        >
          {{ s.balance > 0.005 ? '应收 ' + money(s.balance) : s.balance < -0.005 ? '应补 ' + money(-s.balance) : '已两清' }}
        </p>
      </div>
      <Transition v-if="transferPlan.length" name="fade-up">
        <div class="card card-lift col-span-2 p-5 sm:col-span-3 xl:col-span-4">
          <p class="mb-3 flex items-center gap-2 text-[13.5px] font-semibold text-ink">
            <i class="fa-solid fa-arrows-rotate text-primary" aria-hidden="true"></i>转账建议(最省事)
          </p>
          <div class="flex flex-wrap gap-2">
            <span v-for="(t, i) in transferPlan" :key="i" class="chip chip-plain !px-3 !py-2 text-[13px]">
              <Avatar :name="t.from" :size="18" :ring="false" />
              {{ t.from }}
              <i class="fa-solid fa-arrow-right text-[11px] text-primary" aria-hidden="true"></i>
              <Avatar :name="t.to" :size="18" :ring="false" />
              {{ t.to }}
              <b class="text-primary">{{ money(t.amount) }}</b>
            </span>
          </div>
        </div>
      </Transition>
    </div>

    <!-- 明细列表 -->
    <div v-if="bills.length" class="space-y-3">
      <TransitionGroup name="fade-up-list">
        <article v-for="b in bills" :key="b.id" class="card card-lift flex flex-wrap items-center gap-4 px-6 py-5">
          <span
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[16px]"
            :class="catOf(b.category).tone === 'amber' ? 'bg-amber/15 text-amber' : 'bg-primary/10 text-primary'"
          >
            <i :class="`fa-solid ${catOf(b.category).icon}`" aria-hidden="true"></i>
          </span>
          <div class="min-w-0 flex-1">
            <p class="flex flex-wrap items-center gap-2">
              <span class="truncate text-[15px] font-semibold text-ink">{{ b.name }}</span>
              <BaseTag :tone="catOf(b.category).tone === 'amber' ? 'amber' : 'brand'" class="!text-[11px]">
                {{ catOf(b.category).label }}
              </BaseTag>
              <BaseTag v-if="b.split === 'custom'" tone="plain" class="!text-[11px]">
                <i class="fa-solid fa-sliders mr-1" aria-hidden="true"></i>自定义份额
              </BaseTag>
            </p>
            <p class="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
              <Avatar :name="whoName(b.paid_by)" :size="18" :ring="false" />
              <span>{{ whoName(b.paid_by) }} 垫付</span>
              <span class="chip chip-plain !px-1.5 !py-0 !text-[11px]">
                <i class="fa-regular fa-calendar mr-1" aria-hidden="true"></i>{{ fmtDay(b.date, false) }}
              </span>
              <template v-if="linkChip(b)">
                <i class="fa-solid fa-link text-[10px] text-primary/70" aria-hidden="true"></i>
                <span class="text-primary/80">{{ linkChip(b) }}</span>
              </template>
              <template v-if="b.note">
                <i class="fa-solid fa-quote-left text-[10px]" aria-hidden="true"></i>{{ b.note }}
              </template>
            </p>
          </div>
          <div class="text-right">
            <p class="text-[17px] font-bold text-ink">{{ money(b.amount) }}</p>
            <p class="mt-1 text-[11px] text-muted">
              <template v-for="(p, i) in b.involves" :key="p.id">
                <span v-if="i" class="mx-0.5 text-primary/40">·</span>{{ p.name }}
              </template>
              <span v-if="!b.involves?.length">无人分摊</span>
            </p>
          </div>
          <div v-if="canEdit" class="flex shrink-0 gap-1">
            <button class="icon-btn" title="编辑这笔账" @click="openEdit(b)">
              <i class="fa-solid fa-pen" aria-hidden="true"></i>
            </button>
            <button class="icon-btn icon-btn-danger" title="删除这笔账" @click="store.removeBill(plan.id, b.id)">
              <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
            </button>
          </div>
        </article>
      </TransitionGroup>
    </div>

    <EmptyState
      v-else
      icon="fa-scale-balanced"
      title="还没有记账"
      desc="酒店、油费、门票都可以记进来,支持关联到食宿和行程地点"
    >
      <BaseButton v-if="canEdit" icon="fa-plus" @click="openAdd(null)">记第一笔</BaseButton>
    </EmptyState>

      </div>
    </Transition>

    <!-- 记账弹窗 -->
    <BaseModal v-model="showForm" :title="editingId ? '编辑分账' : '记一笔'" :max-width="'520px'">
      <div class="space-y-5">
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="c in CATS"
            :key="c.key"
            type="button"
            class="flex flex-col items-center gap-1.5 rounded-[12px] border py-3 text-[12px] font-semibold transition-all duration-200 ease-out active:scale-95"
            :class="form.category === c.key ? 'border-primary bg-primary/10 text-primary' : 'border-line text-muted hover:border-primary/40'"
            @click="form.category = c.key"
          >
            <i :class="`fa-solid ${c.icon}`" class="text-[15px]" aria-hidden="true"></i>
            {{ c.label }}
          </button>
        </div>

        <div class="grid grid-cols-[1fr_130px] gap-3">
          <div>
            <label class="flabel">项目名称 *</label>
            <input v-model="form.name" class="field" placeholder="例如:全季酒店 2 晚 / 午餐" maxlength="40" />
          </div>
          <div>
            <label class="flabel">金额 *</label>
            <input v-model.number="form.amount" type="number" min="0" step="0.01" class="field" placeholder="0.00" />
          </div>
        </div>

        <div>
          <label class="flabel">发生日期(用于按日花费统计)</label>
          <input v-model="form.date" type="date" class="field" :max="todayISO()" />
        </div>

        <div>
          <label class="flabel">谁付的钱</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="p in people"
              :key="p.id"
              type="button"
              class="chip transition-all duration-200 ease-out active:scale-95"
              :class="form.paid_by?.id === p.id ? 'chip-brand' : 'chip-plain'"
              @click="form.paid_by = { id: p.id, name: p.name }"
            >
              <Avatar :name="p.name" :size="18" :ring="false" />{{ p.name }}
            </button>
          </div>
        </div>

        <div>
          <label class="flabel">分摊方式</label>
          <div class="flex gap-2">
            <button
              type="button"
              class="chip flex-1 cursor-pointer !px-3 !py-2.5 text-center transition-all duration-150 active:scale-95"
              :class="form.split === 'equal' ? 'chip-brand' : 'chip-plain'"
              @click="form.split = 'equal'"
            >
              <i class="fa-solid fa-equals mr-1" aria-hidden="true"></i>人均均摊
            </button>
            <button
              type="button"
              class="chip flex-1 cursor-pointer !px-3 !py-2.5 text-center transition-all duration-150 active:scale-95"
              :class="form.split === 'custom' ? 'chip-brand' : 'chip-plain'"
              @click="form.split = 'custom'"
            >
              <i class="fa-solid fa-sliders mr-1" aria-hidden="true"></i>按项目份额(自定义)
            </button>
          </div>
        </div>

        <div>
          <label class="flabel">这笔钱涉及谁(参与分摊)</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="p in people"
              :key="p.id"
              type="button"
              class="chip cursor-pointer transition-all duration-200 ease-out active:scale-95"
              :class="form.involves.some((x) => x.id === p.id) ? 'chip-brand' : 'chip-plain opacity-60'"
              @click="toggleInvolve(p)"
            >
              <i v-if="form.involves.some((x) => x.id === p.id)" class="fa-solid fa-check text-[11px]" aria-hidden="true"></i>
              {{ p.name }}
            </button>
          </div>

          <!-- 自定义份额:勾选者每人填权重(按权重比例分摊) -->
          <div v-if="form.split === 'custom'" class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label
              v-for="p in form.involves"
              :key="p.id"
              class="flex items-center justify-between gap-2 rounded-[10px] bg-surface-2/70 px-3 py-1.5"
            >
              <span class="truncate text-[12px] text-ink-soft">{{ p.name }}</span>
              <input
                v-model.number="form.shares[p.id]"
                type="number"
                min="0.1"
                step="0.1"
                class="field !w-16 !px-2 !py-1 !text-right text-[12px]"
                placeholder="1"
              />
            </label>
          </div>

          <p class="muted mt-2 text-[11.5px]">
            {{
              form.split === 'custom'
                ? '自定义份额:每人按所填数字比例分摊(留空按 1),例如 2 : 1 表示一人付双份'
                : '人均均摊 = 金额 ÷ 勾选人数'
            }}
          </p>
        </div>

        <div>
          <label class="flabel">关联食宿 / 行程地点(可选)</label>
          <select v-model="form.link" class="field">
            <option :value="null">不关联</option>
            <option v-for="l in linkable" :key="l.type + l.id" :value="l">
              {{ l.type === 'stay' ? '[住] ' : '[点] ' }}{{ l.name }}
            </option>
          </select>
        </div>

        <div>
          <label class="flabel">备注(可选)</label>
          <input v-model="form.note" class="field" placeholder="例如:两间房拼住" maxlength="60" />
        </div>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="showForm = false">取消</BaseButton>
        <BaseButton icon="fa-scale-balanced" :disabled="!amountValid()" @click="save">
          {{ editingId ? '保存' : '记下这笔' }}
        </BaseButton>
      </template>
    </BaseModal>
  </section>
</template>
