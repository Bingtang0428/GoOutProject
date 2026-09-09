<script setup>
// ============================================================
// 自驾规划 —— 深度规划每日驾驶行程
//  - 每天可拆多段「起点 → 到达」驾驶段
//  - 云端(高德):自动按真实路网计算 时长/里程/过路费/途经道路(高速/国道/…),
//    并把真实路线折线存下;本地演示模式可手动填 分钟/公里
//  - 一键「同步到路线规划」:把各段终点按日并入 route_days 时间轴,
//    同步后地图/时长/途经道路在「路线规划」中一致呈现
// ============================================================
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useContentStore } from '@/stores/content'
import { fmtDay, dayIndex, todayISO } from '@/utils/date'
import { fmtMinute, drivingLeg } from '@/api/route'
import { navUrl, wgs2gcj } from '@/api/geocode'
import { isSupabase } from '@/api/supabase'
import { toast } from '@/composables/toast'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import GeoPlacePicker from '@/components/ui/GeoPlacePicker.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})

const store = useContentStore()

/** 全部自驾日(按日期升序;PlanView 已为每一天补齐占位行) */
const days = computed(() =>
  store.rowsOf(props.plan.id, 'drive').slice().sort((a, b) => a.date.localeCompare(b.date))
)

const allLegs = computed(() =>
  days.value.flatMap((d) => (d.legs || []).map((l) => ({ date: d.date, ...l })))
)

const totals = computed(() => {
  let km = 0
  let min = 0
  let tolls = 0
  let n = 0
  for (const l of allLegs.value) {
    if (l.drive_min) min += Number(l.drive_min)
    if (l.km) km += Number(l.km)
    if (l.tolls) tolls += Number(l.tolls)
    n++
  }
  return { km, min, tolls, n }
})

const syncBusy = ref(false)
async function syncToRoute() {
  if (syncBusy.value || !props.canEdit) return
  syncBusy.value = true
  try {
    const r = await store.syncDrivesToRoute(props.plan.id)
    if (!r.days && !r.added && !r.updated && !r.removed) {
      toast('暂无驾驶段可同步 —— 先给某天添加一段「起点 → 到达」吧')
    } else {
      const msg = `已同步 ${r.days} 天:新增 ${r.added} 站、更新 ${r.updated} 站` +
        (r.removed ? `、清理残留 ${r.removed} 站` : '') + '(见「路线规划」)'
      toast(msg)
    }
  } catch {
    toast('同步失败,请稍后再试')
  } finally {
    syncBusy.value = false
  }
}

/* ---------------- 添加 / 编辑 弹窗 ---------------- */
const showForm = ref(false)
const editLeg = ref(null) // { day, leg } | null(null=新增)
const form = reactive({
  date: '',
  from: null, // {name,lat,lng} | null
  to: null,
  time: '',
  note: '',
  manualMin: '',
  manualKm: ''
})
const calc = reactive({ busy: false, done: false, msg: '', min: null, km: null, tolls: 0, tollKm: 0, roads: [], segs: [], geometry: [] })

/** 起点默认建议:上一天的最终到达;第一天给集合城市 */
function defaultFrom(date) {
  const idx = days.value.findIndex((d) => d.date === date)
  const prev = idx > 0 ? days.value[idx - 1] : null
  if (prev && prev.legs?.length) {
    const last = prev.legs[prev.legs.length - 1]
    if (last.to?.name) return { name: last.to.name, lat: last.to.lat ?? null, lng: last.to.lng ?? null }
  }
  return { name: props.plan.start_city || '出发地', lat: null, lng: null }
}

function openAdd(date) {
  editLeg.value = null
  Object.assign(form, { date, from: defaultFrom(date), to: null, time: '', note: '', manualMin: '', manualKm: '' })
  Object.assign(calc, { busy: false, done: false, msg: '', min: null, km: null, tolls: 0, tollKm: 0, roads: [], segs: [], geometry: [] })
  showForm.value = true
}

function openEdit(day, leg) {
  editLeg.value = { day, leg }
  Object.assign(form, {
    date: day.date,
    from: leg.from ? { name: leg.from.name, lat: leg.from.lat ?? null, lng: leg.from.lng ?? null } : null,
    to: leg.to ? { name: leg.to.name, lat: leg.to.lat ?? null, lng: leg.to.lng ?? null } : null,
    time: leg.time || '',
    note: leg.note || '',
    manualMin: leg.drive_min ? String(leg.drive_min) : '',
    manualKm: leg.km ? String(leg.km) : ''
  })
  Object.assign(calc, {
    busy: false, done: Boolean(leg.geometry?.length || leg.drive_min), msg: '',
    min: leg.drive_min ?? null, km: leg.km ?? null, tolls: leg.tolls ?? 0,
    tollKm: leg.tollKm ?? 0, roads: leg.roads || [], segs: leg.segs || [], geometry: leg.geometry || []
  })
  showForm.value = true
}

function onPointChange() {
  Object.assign(calc, { busy: false, done: false, msg: '', min: null, km: null, tolls: 0, tollKm: 0, roads: [], segs: [], geometry: [] })
}

function canCompute() {
  const f = form.from
  const t = form.to
  return isSupabase && Boolean(f && t && f.name && t.name && Number.isFinite(f.lat) && Number.isFinite(t.lat))
}

async function doCompute() {
  if (!canCompute() || calc.busy) return
  calc.busy = true
  calc.msg = '正在向高德获取驾车路线…'
  try {
    const leg = await drivingLeg({ lat: form.from.lat, lng: form.from.lng }, { lat: form.to.lat, lng: form.to.lng }, true)
    if (leg?.min && leg?.km) {
      Object.assign(calc, {
        done: true,
        msg: `高德驾车:约 ${fmtMinute(leg.min)} · ${leg.km}km` + (leg.tolls ? ` · 过路费约 ¥${leg.tolls}` : ''),
        min: leg.min, km: leg.km, tolls: leg.tolls ?? 0, tollKm: leg.tollKm ?? 0,
        roads: leg.roads || [], segs: leg.segs || [], geometry: leg.geometry || []
      })
    } else {
      calc.done = false
      calc.msg = '未能获取路线,可保存后重试,或直接手动填写时长/公里'
    }
  } catch {
    calc.done = false
    calc.msg = '路线服务暂不可用,可保存后重试,或手动填写时长/公里'
  } finally {
    calc.busy = false
  }
}

const roadKindTone = (kind) => {
  if (/高速/.test(kind)) return 'chip-brand'
  if (/国道/.test(kind)) return 'chip-success'
  if (/省道|县道/.test(kind)) return 'chip-plain'
  return 'chip-plain'
}

async function saveLeg() {
  const to = form.to
  if (!to?.name?.trim() || !form.date) return
  const leg = {
    from: {
      name: (form.from?.name || '出发地').trim(),
      lat: form.from?.lat ?? null,
      lng: form.from?.lng ?? null
    },
    to: { name: to.name.trim(), lat: to.lat ?? null, lng: to.lng ?? null },
    time: form.time || '',
    note: form.note.trim(),
    drive_min: form.manualMin !== '' ? Number(form.manualMin) : calc.min,
    km: form.manualKm !== '' ? Number(form.manualKm) : calc.km,
    tolls: form.manualMin !== '' || form.manualKm !== '' ? calc.tolls : null,
    tollKm: calc.tollKm || null,
    roads: calc.roads || [],
    segs: calc.segs || [],
    geometry: calc.geometry || []
  }
  if (props.canEdit) {
    if (editLeg.value) {
      await store.updateDriveLeg(props.plan.id, editLeg.value.day.date, editLeg.value.leg.id, leg)
      toast('驾驶段已更新')
    } else {
      await store.addDriveLeg(props.plan.id, form.date, leg)
      toast('驾驶段已加入,可点「同步到路线规划」写入行程')
    }
  }
  showForm.value = false
}

async function removeLeg(day, leg) {
  if (!props.canEdit) return
  const removed = await store.removeDriveLeg(props.plan.id, day.date, leg.id)
  toast(removed ? `已删除该驾驶段,并清理了路线里它留下的 ${removed} 个同步地点` : '已删除该驾驶段')
}

async function recomputeLeg(day, leg) {
  if (!leg.from || !leg.to || !Number.isFinite(leg.from.lat) || !Number.isFinite(leg.to.lat)) {
    toast('该段缺少精确坐标,请先编辑并用选点器定位')
    return
  }
  if (!isSupabase) {
    toast('自动算路需云端模式(本地演示请手动填写时长)')
    return
  }
  const r = await drivingLeg({ lat: leg.from.lat, lng: leg.from.lng }, { lat: leg.to.lat, lng: leg.to.lng }, true)
  if (!r?.min) {
    toast('本次未能获取路线,请稍后重试')
    return
  }
  await store.updateDriveLeg(props.plan.id, day.date, leg.id, {
    drive_min: r.min,
    km: r.km,
    tolls: r.tolls ?? null,
    tollKm: r.tollKm ?? null,
    roads: r.roads || [],
    segs: r.segs || [],
    geometry: r.geometry || []
  })
  toast('已按最新路网重新计算')
}

const hasCoord = (p) => Boolean(p && Number.isFinite(p.lat))
const fmtGeo = (p) => (hasCoord(p) ? `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}` : '')

/* ---------------- 单段地图预览 ---------------- */
const preview = ref(null) // { day, leg }
const prevMapEl = ref(null)
let prevMap = null
let prevRoute = null
let prevTileIdx = 0
const PREVIEW_TILES = [
  'https://webrd0{s}.is.autonavi.com/appmaptile?style=7&x={x}&y={y}&z={z}&lang=zh_cn&size=1&scale=1',
  'https://wprd0{s}.is.autonavi.com/appmaptile?style=7&x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1',
  'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
]

function openPreview(day, leg) {
  preview.value = { day, leg }
  nextTick(initPreviewMap)
}

async function initPreviewMap() {
  if (!preview.value || !prevMapEl.value) return
  const L = await import('leaflet')
  if (preview.value === null) return // 关闭竞态
  destroyPreviewMap()
  const leg = preview.value.leg
  const pts = []
  if (leg.geometry?.length) {
    // 库内 WGS84 → 高德底图 GCJ-02 投影
    for (const p of leg.geometry) pts.push(wgs2gcj(p.lat, p.lng))
  } else if (hasCoord(leg.from) && hasCoord(leg.to)) {
    pts.push(wgs2gcj(leg.from.lat, leg.from.lng), wgs2gcj(leg.to.lat, leg.to.lng))
  }
  const center = pts.length ? pts[Math.floor(pts.length / 2)] : [30.9, 118.6]
  prevMap = L.map(prevMapEl.value, { zoomControl: true, attributionControl: true })
  prevTileIdx = 0
  addPrevTiles(L)
  prevRoute = L.layerGroup().addTo(prevMap)
  if (pts.length) {
    const color = '#B75973'
    const hasSegs = (leg.segs || []).some((s) => s.pts?.length > 1)
    const pieces = hasSegs
      ? leg.segs
          .filter((s) => s.pts?.length > 1)
          .map((s) => ({ pts: s.pts.map((p) => wgs2gcj(p.lat, p.lng)), kind: s.kind }))
      : [{ pts, kind: '' }]
    pieces.forEach((p, i) => {
      L.polyline(p.pts, {
        color: p.kind === '高速/快速' ? '#8E44AD' : color,
        weight: 4.5,
        opacity: 0.9
      }).addTo(prevRoute)
      void i
    })
    if (!hasSegs && !leg.geometry?.length) {
      L.polyline(pts, { color, weight: 3, opacity: 0.6, dashArray: '4 6' }).addTo(prevRoute)
    }
    L.marker(pts[0], { icon: pinIcon(L, '起') }).addTo(prevRoute)
    L.marker(pts[pts.length - 1], { icon: pinIcon(L, '止') }).addTo(prevRoute)
    prevMap.fitBounds(L.latLngBounds(pts).pad(0.3), { padding: [26, 26] })
  } else {
    prevMap.setView(center, 5)
    const tip = L.popup({ closeButton: false }).setLatLng(center).setContent('该段还没有坐标,无法预览路线')
    tip.openOn(prevMap)
  }
}

function pinIcon(L, tag) {
  return L.divIcon({
    className: '',
    html: `<span class="drive-pin">${tag}</span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  })
}

function addPrevTiles(L) {
  if (!prevMap) return
  const url = PREVIEW_TILES[prevTileIdx]
  if (!url) return
  const layer = L.tileLayer(url, {
    subdomains: ['1', '2', '3', '4'],
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.amap.com/">高德地图</a>'
  }).addTo(prevMap)
  let once = false
  layer.on('tileerror', () => {
    if (once || !prevMap) return
    once = true
    prevMap.removeLayer(layer)
    prevTileIdx++
    addPrevTiles(L)
  })
}

function destroyPreviewMap() {
  if (prevMap) {
    prevMap.remove()
    prevMap = null
    prevRoute = null
  }
}

watch(preview, (v) => {
  if (!v) destroyPreviewMap()
})

onBeforeUnmount(destroyPreviewMap)

/* ---------------- 标题 ---------------- */
async function onTitle(day, e) {
  await store.updateDriveDayTitle(props.plan.id, day.date, e.target.value)
}

const segDates = computed(() => days.value.map((d) => d.date))
const segLabel = (date, i) => `第${dayIndex(props.plan.start_date, date)}天 · ${fmtDay(date, false)}`

function firstFreeDay() {
  const free = days.value.find((d) => !(d.legs || []).length)
  return free?.date || days.value[0]?.date || todayISO()
}
</script>

<template>
  <section>
    <!-- 顶部概览与操作 -->
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="title-1 flex items-center gap-3">
          <i class="fa-solid fa-car-side text-[19px] text-primary" aria-hidden="true"></i>
          自驾规划
          <span v-if="totals.n" class="chip chip-brand">{{ totals.n }} 段驾驶</span>
          <span v-if="syncBusy" class="chip chip-amber">
            <i class="fa-solid fa-circle-notch" style="animation: spin 0.9s linear infinite" aria-hidden="true"></i>
            同步中…
          </span>
        </h2>
        <p class="muted mt-1">
          每天从 <b class="font-semibold text-primary">xx</b> 开到 <b class="font-semibold text-primary">xx</b> —— 真实路网算时长与途经道路
        </p>
        <p v-if="totals.n" class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted">
          <span><i class="fa-solid fa-route mr-1 text-primary/60" aria-hidden="true"></i>全程约 {{ Math.round(totals.km) }} km</span>
          <span><i class="fa-regular fa-clock mr-1 text-amber" aria-hidden="true"></i>驾驶约 {{ fmtMinute(totals.min) }}</span>
          <span v-if="totals.tolls"><i class="fa-solid fa-money-bill-1 mr-1 text-primary/60" aria-hidden="true"></i>过路费约 ¥{{ Math.round(totals.tolls) }}</span>
        </p>
        <p v-else class="muted mt-1 text-[12px]">还没有驾驶段 —— 为每个旅行日添加「起点 → 到达」,云端将自动按真实路网计算</p>
      </div>
      <div v-if="canEdit" class="flex flex-wrap items-center gap-2">
        <BaseButton icon="fa-route" :loading="syncBusy" @click="syncToRoute">
          同步到路线规划
        </BaseButton>
        <BaseButton icon="fa-plus" @click="openAdd(firstFreeDay())">添加驾驶段</BaseButton>
      </div>
    </div>

    <!-- 每日驾驶安排 -->
    <div v-if="days.length" class="space-y-10">
      <div v-for="(day, i) in days" :key="day.id || day.date" class="fade-up relative pl-11" style="animation: fade-up 0.35s ease-out both">
        <span
          class="absolute left-0 top-1.5 z-10 flex items-center justify-center rounded-full text-[10px] font-bold text-white ring-4"
          :class="i === 0 ? 'bg-primary' : 'bg-primary-deep/70'"
          :style="{ width: '26px', height: '26px', boxShadow: '0 4px 12px rgb(183 89 115 / 0.4)' }"
        >
          D{{ dayIndex(plan.start_date, day.date) }}
        </span>
        <span v-if="i < days.length - 1" class="absolute bottom-[-34px] left-[13px] top-11 w-px bg-primary/15"></span>

        <article class="card p-0">
          <header class="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 pb-4 pt-5">
            <span class="text-[13px] font-semibold text-ink">{{ fmtDay(day.date) }}</span>
            <input
              v-if="canEdit"
              :value="day.title"
              class="inline-title"
              :placeholder="`第${dayIndex(plan.start_date, day.date)}天 · 例如:赶路到宏村`"
              @change="onTitle(day, $event)"
            />
            <span v-else class="flex-1 truncate text-[14.5px] font-semibold text-ink-soft">
              {{ day.title || `第${dayIndex(plan.start_date, day.date)}天自驾` }}
            </span>
            <span v-if="day.legs?.length" class="ml-auto muted text-[12px]">{{ day.legs.length }} 段</span>
            <button
              v-if="canEdit"
              class="chip shrink-0 cursor-pointer !text-[11px] transition-all duration-150 active:scale-95"
              :class="'chip-plain hover:!bg-primary/10'"
              @click="openAdd(day.date)"
            >
              <i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>加一段
            </button>
          </header>

          <div v-if="day.legs?.length" class="divide-y divide-line/60">
            <div v-for="(leg, li) in day.legs" :key="leg.id" class="px-6 py-4">
              <!-- 路段主体 -->
              <div class="flex flex-wrap items-start gap-x-6 gap-y-3">
                <div class="min-w-[130px] flex-1 basis-40">
                  <div class="flex items-start gap-2">
                    <span class="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      :style="{ background: leg.geometry?.length ? 'rgb(var(--c-primary))' : 'rgba(183,89,115,0.4)' }">
                      {{ li + 1 }}
                    </span>
                    <div class="min-w-0">
                      <p class="text-[13.5px] font-semibold text-ink">{{ leg.from?.name || '出发地' }}</p>
                      <p v-if="fmtGeo(leg.from)" class="muted text-[10.5px] tabular-nums">{{ fmtGeo(leg.from) }}</p>
                    </div>
                  </div>
                </div>
                <div class="flex h-8 shrink-0 flex-col items-center justify-center px-1">
                  <i class="fa-solid fa-car text-[13px] text-primary/60" aria-hidden="true"></i>
                  <i class="fa-solid fa-chevron-right text-[9px] text-muted" aria-hidden="true"></i>
                </div>
                <div class="min-w-[130px] flex-1 basis-40">
                  <div class="flex items-start gap-2">
                    <span class="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style="background: rgb(var(--c-primary))">
                      <i class="fa-solid fa-location-dot text-[9px]" aria-hidden="true"></i>
                    </span>
                    <div class="min-w-0">
                      <p class="text-[13.5px] font-semibold text-ink">{{ leg.to?.name }}</p>
                      <p class="muted text-[10.5px]">
                        <span v-if="fmtGeo(leg.to)" class="tabular-nums">{{ fmtGeo(leg.to) }}</span>
                        <span v-if="leg.time" class="ml-1">· 约 {{ leg.time }} 到</span>
                      </p>
                    </div>
                  </div>
                </div>
                <!-- 时长/里程/收费 -->
                <div class="flex flex-wrap items-center gap-1.5">
                  <span v-if="leg.drive_min" class="chip chip-plain !py-1 !text-[11px]">
                    <i class="fa-regular fa-clock mr-1 text-amber" aria-hidden="true"></i>{{ fmtMinute(leg.drive_min) }}
                  </span>
                  <span v-if="leg.km" class="chip chip-plain !py-1 !text-[11px]">
                    <i class="fa-solid fa-route mr-1 text-primary/60" aria-hidden="true"></i>{{ leg.km }} km
                  </span>
                  <span v-if="leg.tolls" class="chip chip-plain !py-1 !text-[11px]">
                    <i class="fa-solid fa-money-bill-1 mr-1 text-primary/60" aria-hidden="true"></i>过路 ¥{{ leg.tolls }}
                  </span>
                </div>
              </div>

              <!-- 途经道路 -->
              <div v-if="leg.roads?.length" class="mt-2.5 ml-7 flex flex-wrap items-center gap-1.5">
                <span class="text-[10.5px] text-muted">途经</span>
                <span
                  v-for="(r, ri) in leg.roads.slice(0, 5)"
                  :key="ri"
                  class="chip !py-0.5 !text-[10.5px]"
                  :class="roadKindTone(r.kind)"
                  :title="r.via?.length ? `经:${r.via.join('、')}` : r.kind"
                >
                  {{ r.kind }} {{ Math.round(r.km) }}km
                </span>
              </div>

              <!-- 备注 -->
              <p v-if="leg.note" class="mt-1.5 ml-7 text-[12.5px] leading-relaxed text-muted">{{ leg.note }}</p>

              <!-- 操作 -->
              <div class="mt-2 ml-7 flex flex-wrap items-center gap-1.5">
                <button
                  class="btn btn-ghost btn-sm !px-2.5"
                  title="在地图上预览该段的真实路线"
                  @click="openPreview(day, leg)"
                >
                  <i class="fa-solid fa-map text-[11px] text-primary/70" aria-hidden="true"></i>预览路线
                </button>
                <template v-if="canEdit">
                  <button class="btn btn-soft btn-sm !px-2.5 !py-0.5 !text-[11px]" @click="recomputeLeg(day, leg)">
                    <i class="fa-solid fa-arrows-rotate text-[10px]" aria-hidden="true"></i>重算路线
                  </button>
                  <button class="btn btn-ghost btn-sm !px-2.5" @click="openEdit(day, leg)">
                    <i class="fa-solid fa-pen text-[11px]" aria-hidden="true"></i>编辑
                  </button>
                  <button class="icon-btn icon-btn-danger !h-7 !w-7" :title="`删除第${li + 1}段`" @click="removeLeg(day, leg)">
                    <i class="fa-solid fa-xmark text-[11px]" aria-hidden="true"></i>
                  </button>
                </template>
                <a
                  v-if="hasCoord(leg.to)"
                  class="btn btn-ghost btn-sm !px-2.5"
                  :href="navUrl(leg.to.name, leg.to)"
                  target="_blank"
                  rel="noopener"
                  title="打开导航"
                >
                  <i class="fa-solid fa-location-arrow text-[11px]" aria-hidden="true"></i>导航
                </a>
              </div>
            </div>
          </div>

          <p v-else class="px-6 py-5 text-[13px] italic text-muted">
            这天没有驾驶安排 ——
            <button v-if="canEdit" class="font-semibold text-primary not-italic hover:underline" @click="openAdd(day.date)">
              添加今天的驾驶段
            </button>
            <span v-else>由其他成员规划后自动同步</span>
          </p>
        </article>
      </div>
    </div>

    <EmptyState
      v-if="!days.length"
      icon="fa-car-side"
      title="自驾规划还没开始"
      desc="进入计划后会自动生成每一天的驾驶日,把每天 出发→到达 拆成一段段驾驶即可"
    >
      <BaseButton v-if="canEdit" icon="fa-plus" @click="openAdd(firstFreeDay())">添加第一段驾驶</BaseButton>
    </EmptyState>

    <!-- ============ 单段路线预览弹窗 ============ -->
    <BaseModal v-model="preview" title="驾驶路线预览" :max-width="'720px'">
      <template v-if="preview">
        <div class="mb-3 flex flex-wrap items-center gap-1.5">
          <span class="chip chip-plain !py-1 !text-[11.5px]">
            <i class="fa-solid fa-route mr-1 text-primary/60" aria-hidden="true"></i>
            {{ preview.leg.from?.name || '出发地' }} → {{ preview.leg.to?.name }}
          </span>
          <span v-if="preview.leg.drive_min" class="chip chip-plain !py-1 !text-[11.5px]">
            <i class="fa-regular fa-clock mr-1 text-amber" aria-hidden="true"></i>{{ fmtMinute(preview.leg.drive_min) }}
          </span>
          <span v-if="preview.leg.km" class="chip chip-plain !py-1 !text-[11.5px]">{{ preview.leg.km }} km</span>
          <span v-if="preview.leg.tolls" class="chip chip-plain !py-1 !text-[11.5px]">
            <i class="fa-solid fa-money-bill-1 mr-1 text-primary/60" aria-hidden="true"></i>过路 ¥{{ preview.leg.tolls }}
          </span>
        </div>
        <div
          ref="prevMapEl"
          class="h-[min(52vh,480px)] w-full overflow-hidden rounded-[14px]"
          style="min-height: 300px"
        ></div>
        <p v-if="!(preview.leg.geometry?.length || (hasCoord(preview.leg.from) && hasCoord(preview.leg.to)))"
           class="muted mt-2 text-center text-[12px]">
          该段还没有坐标,无法预览;在编辑里为起终点精确定位后会自动计算真实路线
        </p>
        <p v-else class="muted mt-2 text-center text-[12px]">
          紫/主色线为真实驾车路线(高德);无路网数据时以虚线示意
        </p>
      </template>
    </BaseModal>

    <!-- ============ 驾驶段 新增 / 编辑 弹窗 ============ -->
    <BaseModal v-model="showForm" :title="editLeg ? '编辑驾驶段' : '添加驾驶段'" :max-width="'620px'">
      <div class="space-y-4">
        <div v-if="!editLeg">
          <label class="flabel">安排在哪一天</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="(date, i) in segDates"
              :key="date"
              type="button"
              class="chip transition-all duration-200 ease-out active:scale-95"
              :class="form.date === date ? 'chip-brand' : 'chip-plain hover:!bg-primary/10'"
              @click="form.date = date"
            >
              {{ segLabel(date, i) }}
            </button>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="flabel">起点</label>
            <GeoPlacePicker v-model="form.from" :hint="plan.start_city" placeholder="如:合肥(建议用上一天到达地)" @update:modelValue="onPointChange" />
          </div>
          <div>
            <label class="flabel">到达(终点)*</label>
            <GeoPlacePicker v-model="form.to" :hint="plan.start_city" placeholder="选点或粘贴高德分享链接" @update:modelValue="onPointChange" />
          </div>
        </div>
        <p class="muted -mt-2 text-[11.5px] leading-5">
          <i class="fa-solid fa-circle-info mr-1 text-primary/60" aria-hidden="true"></i>
          建议都用<a href="https://uri.amap.com" target="_blank" rel="noopener" class="font-semibold text-primary">高德选点器</a>精确定位
          (带坐标才能按真实路网计算);第一天起点默认集合城市
        </p>

        <!-- 路线计算 -->
        <div class="rounded-[12px] border border-primary/20 bg-primary/5 px-4 py-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-[12.5px] font-semibold text-ink">
              <i class="fa-solid fa-map-location-dot mr-1.5 text-primary" aria-hidden="true"></i>
              驾车路线
            </p>
            <button
              v-if="canEdit"
              type="button"
              class="btn btn-soft btn-sm !px-2.5 !py-0.5 !text-[11px]"
              :disabled="!canCompute() || calc.busy"
              @click="doCompute"
            >
              <i v-if="calc.busy" class="fa-solid fa-circle-notch mr-1" style="animation: spin 0.9s linear infinite" aria-hidden="true"></i>
              <i v-else class="fa-solid fa-wand-magic-sparkles mr-1" aria-hidden="true"></i>
              {{ calc.done ? '重新计算' : '自动计算' }}
            </button>
          </div>
          <p class="muted mt-1 text-[12px]">{{ calc.msg || (canCompute() ? '高德将按真实路网规划并汇总途经高速/国道等' : '起点与终点都完成精确定位后即可自动计算') }}</p>
          <div v-if="calc.roads?.length" class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="(r, ri) in calc.roads.slice(0, 6)"
              :key="ri"
              class="chip !py-0.5 !text-[10.5px]"
              :class="roadKindTone(r.kind)"
              :title="r.via?.length ? `经:${r.via.join('、')}` : ''"
            >
              {{ r.kind }} {{ Math.round(r.km) }}km
            </span>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="flabel">时长(分钟)</label>
            <input v-model.number="form.manualMin" type="number" min="1" class="field" :placeholder="calc.min ? String(calc.min) : '自动结果,可覆盖'" />
          </div>
          <div>
            <label class="flabel">里程(km)</label>
            <input v-model.number="form.manualKm" type="number" min="1" class="field" :placeholder="calc.km ? String(calc.km) : '自动结果,可覆盖'" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="flabel">到达时刻(可选)</label>
            <input v-model="form.time" type="time" class="field" />
          </div>
          <div class="flex items-end pb-1 text-[12px] text-muted">
            <i class="fa-solid fa-lightbulb mr-1.5 text-amber" aria-hidden="true"></i>大约几点到,方便同伴等
          </div>
        </div>

        <div>
          <label class="flabel">备注(可选)</label>
          <textarea v-model="form.note" class="field" rows="2" placeholder="如:避开早高峰 7:30 前上高速 / 留意跨省收费"></textarea>
        </div>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="showForm = false">取消</BaseButton>
        <BaseButton icon="fa-check" :disabled="!(form.to?.name || '').trim()" @click="saveLeg">
          {{ editLeg ? '保存修改' : '加入驾驶段' }}
        </BaseButton>
      </template>
    </BaseModal>
  </section>
</template>

<style scoped>
.inline-title {
  flex: 1;
  min-width: 120px;
  background: transparent;
  border: 1px dashed transparent;
  border-radius: 8px;
  padding: 3px 8px;
  font-size: 14.5px;
  font-weight: 600;
  color: rgb(var(--c-ink));
  outline: none;
  transition: border-color 0.2s ease-out;
}
.inline-title:hover { border-color: rgb(var(--c-line)); }
.inline-title:focus { border-color: rgb(var(--c-primary) / 0.5); }
</style>

<style>
/* Leaflet 挂载节点在组件子树外,需全局样式 */
.drive-pin {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: rgb(183 89 115);
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  box-shadow: 0 2px 8px rgba(183, 89, 115, 0.45), 0 0 0 2px #fff;
}
.leaflet-container { font-family: inherit; }
.leaflet-popup-content-wrapper { border-radius: 14px; }
</style>
