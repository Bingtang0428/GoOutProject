<script setup>
// ============================================================
// 车辆与里程
//  - 车辆信息(昵称/车牌)+ 加油里程记录
//  - 统计:总里程、加油量、估算百公里油耗、每公里成本
//  - 加油可一键「同步进分账(油费)」,与账单联动
// ============================================================
import { ref, reactive, computed, watch } from 'vue'
import { useContentStore } from '@/stores/content'
import { fmtDay, todayISO } from '@/utils/date'
import { money } from '@/utils/money'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Avatar from '@/components/ui/Avatar.vue'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const store = useContentStore()

/* 多车支持:vehicles 为列表,vehicle 为当前选中的一辆 */
const vehicles = computed(() => store.rowsOf(props.plan.id, 'vehicle'))
const vehicleSel = ref(null)
const vehicle = computed(() => vehicles.value.find((v) => v.id === vehicleSel.value) || null)
watch(
  vehicles,
  (list) => {
    if (!list.some((v) => v.id === vehicleSel.value)) vehicleSel.value = list[0]?.id ?? null
  },
  { immediate: true }
)

const logs = computed(() => store.rowsOf(props.plan.id, 'fuel').slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')))

const people = computed(() => {
  const list = [...(props.plan.members || [])]
  if (props.plan.owner_id && !list.some((m) => m.id === props.plan.owner_id)) {
    const owner = [...(props.plan.viewers || []), ...list].find((m) => m.id === props.plan.owner_id)
    if (owner) list.unshift(owner)
  }
  return list
})

/* ---------- 车辆信息(多车 + 燃油/混动/纯电) ---------- */
import { makeUuid } from '@/utils/misc'

const vehForm = reactive({
  id: null, name: '', plate: '', power: 'gas',
  capacity: '', cons: '', battery: '', kwh100: ''
})

function loadDraft(v) {
  vehForm.id = v?.id || null
  vehForm.name = v?.name || ''
  vehForm.plate = v?.plate || ''
  vehForm.power = v?.power || 'gas'
  vehForm.capacity = v?.capacity_l ? String(v.capacity_l) : ''
  vehForm.cons = v?.cons_l100 ? String(v.cons_l100) : ''
  vehForm.battery = v?.battery_kwh ? String(v.battery_kwh) : ''
  vehForm.kwh100 = v?.kwh_100 ? String(v.kwh_100) : ''
}

watch(vehicle, (v) => loadDraft(v), { immediate: true })
watch(vehForm, () => (formDirty.value = true))
const formDirty = ref(false)

async function saveVehicleInfo() {
  const num = (v) => (v === '' || v == null ? null : Number(v))
  await store.saveVehicle(props.plan.id, {
    id: vehForm.id || undefined,
    name: vehForm.name.trim(),
    plate: vehForm.plate.trim(),
    power: vehForm.power,
    capacity_l: vehForm.power === 'ev' ? null : num(vehForm.capacity) > 0 ? num(vehForm.capacity) : null,
    cons_l100: vehForm.power === 'ev' ? null : num(vehForm.cons) > 0 ? num(vehForm.cons) : null,
    battery_kwh: vehForm.power === 'ev' ? (num(vehForm.battery) > 0 ? num(vehForm.battery) : null) : null,
    kwh_100: vehForm.power === 'ev' ? (num(vehForm.kwh100) > 0 ? num(vehForm.kwh100) : null) : null
  })
  formDirty.value = false
}

async function addNewVehicle() {
  const vid = makeUuid()
  await store.saveVehicle(props.plan.id, { id: vid, name: '新车', plate: '', power: 'gas' })
  vehicleSel.value = vid
}

async function deleteSelectedVehicle() {
  if (!vehicle.value) return
  if (!confirm(`删除车辆「${vehicle.value.name || '新车'}」?其加油记录会保留但不再归属任何车。`)) return
  await store.removeVehicle(props.plan.id, vehicle.value.id)
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

/* ---------- 加油/续航智能建议 ----------
 * 依据:路线中标注的自驾分钟 × 均速 65km/h ≈ 里程;
 * 油耗:优先用车速表填写的百公里油耗,否则用里程表自动测算的均值。
 */
const ADV_AVG_KMH = 65

const fuelAdvice = computed(() => {
  const minutes = store
    .rowsOf(props.plan.id, 'days')
    .reduce((sum, d) => sum + (d.destinations || []).reduce((s, x) => s + (Number(x.drive_min) || 0), 0), 0)
  const daysList = store
    .rowsOf(props.plan.id, 'days')
    .map((d) => (d.destinations || []).reduce((s, x) => s + (Number(x.drive_min) || 0), 0))
  const avgLiters = Number(vehicle.value?.cons_l100) || stats.value.avgLiters || 9
  const capacity = Number(vehicle.value?.capacity_l) || 50
  const km = (minutes / 60) * ADV_AVG_KMH
  const need = (km * avgLiters) / 100
  const rangeKm = (capacity * 100) / avgLiters
  const usable = capacity * 0.85 // 不建议烧干油箱
  const stops = need > 0 ? Math.max(0, Math.ceil(need / usable) - 1) : 0
  const longestDayKm = ((Math.max(0, ...daysList) / 60) * ADV_AVG_KMH)
  const oneDayOk = longestDayKm <= rangeKm

  const tips = []
  if (!minutes) {
    tips.push('先在「路线」里为各段点「自动算时长」,这里就能给出加油建议。')
    return { km: 0, need: 0, stops: 0, oneDayOk: true, tips }
  }
  if (stops > 0) {
    tips.push(`全程约 ${Math.round(km)} km,预计耗油约 ${Math.round(need)} L —— 建议沿途安排约 ${stops} 次加油。`)
  } else {
    tips.push(`全程约 ${Math.round(km)} km,一箱油(按 ${capacity} L)基本够用,出发前加满即可。`)
  }
  if (!oneDayOk) {
    tips.push(`最长单日行驶约 ${Math.round(longestDayKm)} km,超出满箱续航,那天中途记得补油。`)
  } else {
    tips.push(`满箱续航约 ${Math.round(rangeKm)} km,最长单日 ${Math.round(longestDayKm)} km,单日无忧。`)
  }
  if (!vehicle.value?.cons_l100) {
    tips.push(`油耗未手填,按记录测算 ${stats.value.avgLiters ? stats.value.avgLiters.toFixed(1) : '默认 9'} L/100km 估算。`)
  }
  if (!vehicle.value?.capacity_l) {
    tips.push(`油箱容积未填,按常见 ${capacity} L 估算;填准后建议更准确。`)
  }
  return { km, need, stops, oneDayOk, tips }
})

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
    <!-- 车辆信息(支持多车) -->
    <div class="card p-5 sm:p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <i class="fa-solid fa-car-side text-[20px]" aria-hidden="true"></i>
          </span>
          <div class="min-w-0">
            <select v-if="vehicles.length > 1" v-model="vehicleSel" class="field !w-56 !py-1.5 !text-[13px] font-semibold">
              <option v-for="v in vehicles" :key="v.id" :value="v.id">
                {{ v.name || '新车' }} · {{ v.power === 'ev' ? '纯电' : v.power === 'hybrid' ? '混动' : '燃油' }}
                <template v-if="v.plate"> · {{ v.plate }}</template>
              </option>
            </select>
            <p v-else class="title-2">{{ vehicle?.name || '给这趟车起个名字?' }}</p>
            <p class="muted mt-0.5 text-[12px]">
              共 {{ vehicles.length }} 辆车
              <template v-if="vehicle?.plate"> · {{ vehicle.plate }}</template>
              <template v-if="stats.lastOdo"> · 表显 {{ Math.round(stats.lastOdo) }} km</template>
            </p>
          </div>
        </div>
        <div v-if="canEdit" class="flex flex-wrap items-center gap-2">
          <BaseButton variant="soft" size="sm" icon="fa-plus" @click="addNewVehicle">新增车辆</BaseButton>
          <BaseButton
            v-if="vehicles.length > 1 && vehicle"
            variant="danger-soft"
            size="sm"
            icon="fa-trash-can"
            @click="deleteSelectedVehicle"
          >删除</BaseButton>
        </div>
      </div>

      <!-- 能源类型与参数(编辑当前车辆) -->
      <div v-if="canEdit && vehicle" class="mt-4 space-y-3 border-t border-line/70 pt-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="muted text-[12px]">能源类型:</span>
          <button
            v-for="p in [{ key: 'gas', label: '燃油' }, { key: 'hybrid', label: '混动' }, { key: 'ev', label: '纯电' }]"
            :key="p.key"
            type="button"
            class="chip cursor-pointer transition-all duration-150 active:scale-95"
            :class="vehForm.power === p.key ? 'chip-brand' : 'chip-plain'"
            @click="vehForm.power = p.key"
          >{{ p.label }}</button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <input v-model="vehForm.name" class="field !w-40 !py-1.5 !text-[13px]" placeholder="爱车昵称" />
          <input v-model="vehForm.plate" class="field !w-32 !py-1.5 !text-[13px]" placeholder="车牌号" />
          <template v-if="vehForm.power !== 'ev'">
            <input v-model="vehForm.capacity" type="number" min="0" class="field !w-24 !py-1.5 !text-[13px]" placeholder="油箱L" title="油箱容积(续航建议用)" />
            <input v-model="vehForm.cons" type="number" min="0" step="0.1" class="field !w-24 !py-1.5 !text-[13px]" placeholder="油耗L/100km" />
          </template>
          <template v-else>
            <input v-model="vehForm.battery" type="number" min="0" class="field !w-24 !py-1.5 !text-[13px]" placeholder="电池kWh" />
            <input v-model="vehForm.kwh100" type="number" min="0" step="0.1" class="field !w-24 !py-1.5 !text-[13px]" placeholder="电耗kWh/100km" />
          </template>
          <BaseButton size="sm" icon="fa-check" @click="saveVehicleInfo">保存</BaseButton>
        </div>
      </div>
      <p v-else-if="!canEdit" class="muted mt-2 text-[12px]">
        <template v-if="vehicle">
          {{ vehicle?.plate || '未填车牌号' }}
          · {{ vehicle?.power === 'ev' ? '纯电' : vehicle?.power === 'hybrid' ? '混动' : '燃油' }}
          <template v-if="vehicle?.capacity_l"> · 油箱 {{ vehicle.capacity_l }} L</template>
          <template v-if="vehicle?.battery_kwh"> · 电池 {{ vehicle.battery_kwh }} kWh</template>
        </template>
        <template v-else>等待创建者添加车辆</template>
      </p>
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

    <!-- 加油/续航智能建议 -->
    <div class="card p-5">
      <p class="title-2 mb-3 flex items-center gap-2">
        <i class="fa-solid fa-gauge-high text-primary" aria-hidden="true"></i>
        加油 / 续航建议
        <span v-if="fuelAdvice.km > 0" class="chip chip-plain !text-[11px]">
          <i class="fa-solid fa-route mr-1 text-primary/70" aria-hidden="true"></i>全程约 {{ Math.round(fuelAdvice.km) }} km
        </span>
        <span v-if="fuelAdvice.stops > 0" class="chip chip-amber !text-[11px]">
          <span class="dot"></span>建议加油 {{ fuelAdvice.stops }} 次
        </span>
      </p>
      <ul class="space-y-2 text-[13px] leading-relaxed text-ink-soft">
        <li v-for="(t, i) in fuelAdvice.tips" :key="i" class="flex items-start gap-2">
          <i
            class="fa-solid mt-1 text-[10px]"
            :class="t.includes('加满') || t.includes('无忧') ? 'fa-circle-check text-[#16a34a]' : t.includes('建议加油') || t.includes('补油') ? 'fa-circle-exclamation text-amber' : 'fa-circle-info text-primary/60'"
            aria-hidden="true"
          ></i>
          <span>{{ t }}</span>
        </li>
      </ul>
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
