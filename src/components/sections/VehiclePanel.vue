<script setup>
// ============================================================
// 车辆与里程
//  - 车辆信息(昵称/车牌)+ 加油里程记录
//  - 统计:总里程、加油量、估算百公里油耗、每公里成本
//  - 加油可一键「同步进分账(油费)」,与账单联动
// ============================================================
import { ref, reactive, computed } from 'vue'
import { useContentStore } from '@/stores/content'
import { fmtDay, todayISO } from '@/utils/date'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Avatar from '@/components/ui/Avatar.vue'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const store = useContentStore()

const logs = computed(() => store.rowsOf(props.plan.id, 'fuel').slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')))
const vehicle = computed(() => store.currentVehicle(props.plan.id))

const people = computed(() => {
  const list = [...(props.plan.members || [])]
  if (props.plan.owner_id && !list.some((m) => m.id === props.plan.owner_id)) {
    const owner = [...(props.plan.viewers || []), ...list].find((m) => m.id === props.plan.owner_id)
    if (owner) list.unshift(owner)
  }
  return list
})

/* ---------- 车辆信息 ---------- */
const vehForm = reactive({ name: '', plate: '' })

function editVehicle() {
  vehForm.name = vehicle.value?.name || ''
  vehForm.plate = vehicle.value?.plate || ''
}

async function saveVehicle() {
  await store.saveVehicle(props.plan.id, {
    name: vehForm.name.trim(),
    plate: vehForm.plate.trim()
  })
}

/* ---------- 统计 ---------- */
const stats = computed(() => {
  const ordered = logs.value
  const totalLiters = ordered.reduce((s, l) => s + Number(l.liters || 0), 0)
  const totalCost = ordered.reduce((s, l) => s + Number(l.amount || 0), 0)
  let km = 0
  const legs = []
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]
    const cur = ordered[i]
    const d = Number(cur.odometer || 0) - Number(prev.odometer || 0)
    if (Number.isFinite(d) && d > 0) {
      km += d
      const liters = Number(cur.liters || 0)
      if (liters > 0) legs.push((liters / d) * 100)
    }
  }
  const avgLiters = legs.length ? legs.reduce((s, v) => s + v, 0) / legs.length : null
  return {
    totalCost,
    totalLiters,
    km,
    lastOdo: ordered.length ? Number(ordered[ordered.length - 1].odometer || 0) : null,
    avgLiters,
    costPerKm: km > 0 ? totalCost / km : null
  }
})

const money = (n) => `¥${Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`

/* ---------- 加油记录 ---------- */
const showFuel = ref(false)
const fuelForm = reactive({
  date: todayISO(), odometer: '', liters: '', amount: '',
  paid_by: null, involves: [], syncBill: true, note: ''
})

function openAddFuel() {
  const all = people.value
  Object.assign(fuelForm, {
    date: todayISO(),
    odometer: stats.value.lastOdo ?? '',
    liters: '',
    amount: '',
    paid_by: all[0] ? { id: all[0].id, name: all[0].name } : null,
    involves: all.map((p) => ({ id: p.id, name: p.name })),
    syncBill: true,
    note: ''
  })
  showFuel.value = true
}

function toggleInvolve(p) {
  const i = fuelForm.involves.findIndex((x) => x.id === p.id)
  if (i === -1) fuelForm.involves.push({ id: p.id, name: p.name })
  else fuelForm.involves.splice(i, 1)
}

const canSaveFuel = computed(() => fuelForm.date && Number(fuelForm.amount) > 0)

async function saveFuel() {
  if (!canSaveFuel.value) return
  const amount = Math.round(Number(fuelForm.amount || 0) * 100) / 100
  const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))
  const payload = {
    date: fuelForm.date,
    odometer: num(fuelForm.odometer),
    liters: num(fuelForm.liters),
    amount,
    paid_by: fuelForm.paid_by ? { id: fuelForm.paid_by.id, name: fuelForm.paid_by.name } : null,
    bill_id: null,
    note: fuelForm.note.trim()
  }
  if (fuelForm.syncBill) {
    // ★ 同步进分账:创建一笔油费账单,记录其 bill_id 以便联删
    const row = await store.addBill(props.plan.id, {
      name: `加油 · ${fmtDay(fuelForm.date, false)}${fuelForm.note ? ' ' + fuelForm.note : ''}`,
      amount,
      category: 'fuel',
      paid_by: payload.paid_by,
      involves: fuelForm.involves,
      link: null,
      note: payload.note
    })
    payload.bill_id = row?.id || null
  }
  await store.addFuel(props.plan.id, payload)
  showFuel.value = false
}
</script>

<template>
  <section class="space-y-5">
    <!-- 车辆信息 -->
    <div class="card p-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <i class="fa-solid fa-car-side text-[20px]" aria-hidden="true"></i>
          </span>
          <div>
            <p class="title-2">{{ vehicle?.name || '给这趟车起个名字?' }}</p>
            <p class="muted text-[12px]">
              {{ vehicle?.plate || '未填车牌号' }}
              <span v-if="stats.lastOdo"> · 表显 {{ Math.round(stats.lastOdo) }} km</span>
            </p>
          </div>
        </div>
        <div v-if="canEdit" class="flex flex-wrap items-center gap-2">
          <input v-model="vehForm.name" class="field !w-40 !py-1.5 !text-[13px]" placeholder="爱车昵称" @focus="editVehicle" />
          <input v-model="vehForm.plate" class="field !w-32 !py-1.5 !text-[13px]" placeholder="车牌号" @focus="editVehicle" />
          <BaseButton size="sm" icon="fa-check" @click="saveVehicle">保存</BaseButton>
        </div>
      </div>
    </div>

    <!-- 统计 -->
    <div class="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <div class="card card-lift p-4">
        <p class="muted text-[11.5px] font-semibold">加油花费</p>
        <p class="mt-1 text-[19px] font-bold text-ink">{{ money(stats.totalCost) }}</p>
        <p class="text-[11.5px] text-muted">共 {{ logs.length }} 次</p>
      </div>
      <div class="card card-lift p-4">
        <p class="muted text-[11.5px] font-semibold">加油量</p>
        <p class="mt-1 text-[19px] font-bold text-ink">{{ stats.totalLiters ? stats.totalLiters.toFixed(1) : 0 }} <span class="text-[13px]">L</span></p>
        <p class="text-[11.5px] text-muted">约 {{ stats.costPerKm ? Math.round(stats.totalLiters / Math.max(1, stats.km) * 100) : '--' }} L/100km</p>
      </div>
      <div class="card card-lift p-4">
        <p class="muted text-[11.5px] font-semibold">行驶里程</p>
        <p class="mt-1 text-[19px] font-bold text-ink">{{ stats.km ? Math.round(stats.km) : '--' }} <span class="text-[13px]">km</span></p>
        <p class="text-[11.5px] text-muted">按相邻两次里程表差值</p>
      </div>
      <div class="card card-lift p-4">
        <p class="muted text-[11.5px] font-semibold">百公里油耗</p>
        <p class="mt-1 text-[19px] font-bold text-ink">{{ stats.avgLiters ? stats.avgLiters.toFixed(1) : '--' }} <span class="text-[13px]">L</span></p>
        <p class="text-[11.5px] text-muted">每公里成本 {{ stats.costPerKm ? '¥' + stats.costPerKm.toFixed(2) : '--' }}</p>
      </div>
    </div>

    <!-- 记录列表 -->
    <div class="flex items-center justify-between">
      <p class="title-2">加油 / 里程记录</p>
      <BaseButton v-if="canEdit" size="sm" icon="fa-plus" @click="openAddFuel">记录一次</BaseButton>
    </div>

    <div v-if="logs.length" class="space-y-3">
      <article v-for="(l, i) in logs.slice().reverse()" :key="l.id" class="card card-lift flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5">
        <span class="text-[12.5px] font-semibold tabular-nums text-ink">{{ fmtDay(l.date) }}</span>
        <span class="flex items-center gap-1.5 text-[13px] text-ink-soft">
          <i class="fa-solid fa-gas-pump text-primary/70" aria-hidden="true"></i>
          {{ l.liters ? l.liters + ' L' : '--' }}
        </span>
        <span class="text-[13px] font-bold text-ink">{{ money(l.amount) }}</span>
        <span v-if="l.odometer" class="muted text-[12px]">里程 {{ Math.round(l.odometer) }} km</span>
        <span v-if="l.bill_id" class="chip chip-success !text-[11px]"><i class="fa-solid fa-scale-balanced" aria-hidden="true"></i>已记入分账</span>
        <span v-if="l.paid_by" class="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
          <Avatar :name="l.paid_by.name" :size="18" :ring="false" />{{ l.paid_by.name }} 垫付
        </span>
        <button
          v-if="canEdit"
          class="icon-btn icon-btn-danger !h-7 !w-7"
          :title="l.bill_id ? '删除并撤回分账账单' : '删除'"
          @click="store.removeFuel(plan.id, l.id)"
        >
          <i class="fa-solid fa-trash-can text-[12px]" aria-hidden="true"></i>
        </button>
      </article>
    </div>
    <p v-else class="muted text-center text-[13px]">还没有加油记录 —— {{ canEdit ? '记一次满箱,油耗就有了参考' : '等待成员记录' }}</p>

    <!-- 加油记录弹窗 -->
    <BaseModal v-model="showFuel" title="记录加油" :max-width="'480px'">
      <div class="space-y-4">
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="flabel">日期</label>
            <input v-model="fuelForm.date" type="date" class="field" />
          </div>
          <div>
            <label class="flabel">里程表 km</label>
            <input v-model="fuelForm.odometer" type="number" class="field" placeholder="32140" />
          </div>
          <div>
            <label class="flabel">加油量 L</label>
            <input v-model="fuelForm.liters" type="number" step="0.1" class="field" placeholder="45.6" />
          </div>
        </div>
        <div>
          <label class="flabel">金额 *</label>
          <input v-model="fuelForm.amount" type="number" min="0" step="0.01" class="field" placeholder="360" />
        </div>
        <div>
          <label class="flabel">谁付的钱</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="p in people"
              :key="p.id"
              type="button"
              class="chip transition-all duration-200 active:scale-95"
              :class="fuelForm.paid_by?.id === p.id ? 'chip-brand' : 'chip-plain'"
              @click="fuelForm.paid_by = { id: p.id, name: p.name }"
            >
              <Avatar :name="p.name" :size="18" :ring="false" />{{ p.name }}
            </button>
          </div>
        </div>
        <div v-if="fuelForm.syncBill">
          <label class="flabel">这笔钱涉及谁(同步到分账)</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="p in people"
              :key="p.id"
              type="button"
              class="chip transition-all duration-200 active:scale-95"
              :class="fuelForm.involves.some((x) => x.id === p.id) ? 'chip-brand' : 'chip-plain opacity-60'"
              @click="toggleInvolve(p)"
            >
              <i v-if="fuelForm.involves.some((x) => x.id === p.id)" class="fa-solid fa-check text-[11px]" aria-hidden="true"></i>
              {{ p.name }}
            </button>
          </div>
        </div>
        <label class="flex cursor-pointer items-center gap-3 rounded-[12px] bg-surface-2/70 px-4 py-3 text-[13px] font-semibold text-ink-soft">
          <input v-model="fuelForm.syncBill" type="checkbox" class="h-4 w-4 accent-[#b75973]" />
          同时记入「分账 · 加油」,和队友平摊
        </label>
        <div>
          <label class="flabel">备注</label>
          <input v-model="fuelForm.note" class="field" placeholder="例如:中石化 92# 满箱" />
        </div>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="showFuel = false">取消</BaseButton>
        <BaseButton icon="fa-check" :disabled="!canSaveFuel" @click="saveFuel">保存记录</BaseButton>
      </template>
    </BaseModal>
  </section>
</template>
