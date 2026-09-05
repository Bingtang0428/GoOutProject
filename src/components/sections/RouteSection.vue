<script setup>
// ============================================================
// 路线规划
//  - 「列表」:时间轴逐日展示目的地
//  - 「地图」:Leaflet(OSM) 展示整条路线,每日节点同色圆点标记,
//    按顺序连线;缺失坐标的地点会调用 Nominatim 逆地理补全后存储
//  - 「建议」:每个目的地可提出建议,流转 open → accepted → done 闭环
// Props: plan / canEdit(参与者及以上才有写权限,围观者只读)
// ============================================================
import { ref, reactive, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { useContentStore } from '@/stores/content'
import { useAuthStore } from '@/stores/auth'
import { fmtDay, dayIndex, eachDayISO, parseISO } from '@/utils/date'
import { uid, PASTEL_GRADS } from '@/utils/misc'
import { geocodePlace, navUrl } from '@/api/geocode'
import { fetchDailyWeather, wxMeta, wxTempText } from '@/api/weather'
import { drivingLeg, transitMinutes, fmtMinute } from '@/api/route'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Avatar from '@/components/ui/Avatar.vue'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})

const store = useContentStore()
const auth = useAuthStore()

const days = computed(() => {
  const list = store.rowsOf(props.plan.id, 'days').slice()
  return list.sort((a, b) => a.date.localeCompare(b.date))
})
const totalDest = computed(() => days.value.reduce((n, d) => n + (d.destinations?.length || 0), 0))

/* ---------------- 列表与地图切换 ---------------- */
const view = ref('list')
const mapEl = ref(null)
let map = null
let routeLayer = null

function flushMap() {
  if (map) setTimeout(() => map.invalidateSize(), 60)
}

let Lmod = null // Leaflet 模块单例
async function getL() {
  if (!Lmod) Lmod = await import('leaflet')
  return Lmod
}

/* 底图源:国内网络下 OSM 瓦片常被屏蔽,自动回退到 CARTO / Esri */
const TILE_PROVIDERS = [
  {
    url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
  },
  {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, TomTom, Garmin'
  }
]
const mapStatus = ref('') // 底图/加载状态提示
let tileFailTimer = null

function switchTile(L, failMsg = true) {
  if (!map || !L || !TILE_PROVIDERS.length) return
  const next = TILE_PROVIDERS.shift()
  if (!next) {
    mapStatus.value = '底图加载失败,请检查网络后重新打开地图'
    return
  }
  const layer = L.tileLayer(next.url, { maxZoom: 19, attribution: next.attribution }).addTo(map)
  let failedOnce = false
  layer.on('tileerror', () => {
    if (failedOnce) return
    failedOnce = true
    if (map) map.removeLayer(layer)
    if (failMsg) mapStatus.value = '切换底图源中…'
    setTimeout(() => switchTile(L), 80)
  })
  clearTimeout(tileFailTimer)
  tileFailTimer = setTimeout(() => {
    // 加载超时兜底:再换一个源
    if (map && TILE_PROVIDERS.length) switchTile(L)
  }, 9000)
}

async function enterMap() {
  view.value = 'map'
  await nextTick()
  if (!mapEl.value || map) return
  const L = await getL()
  mapStatus.value = '地图加载中…'
  map = L.map(mapEl.value, { zoomControl: true, attributionControl: true }).setView([30.9, 118.6], 8)
  switchTile(L, false)
  routeLayer = L.layerGroup().addTo(map)
  await paintRoute()
  mapStatus.value = ''
}

async function leaveMap() {
  view.value = 'list'
  clearTimeout(tileFailTimer)
  if (map) {
    map.remove()
    map = null
    routeLayer = null
  }
}

/** 平整所有日期下的地点,生成 [dayIdx, day, dest] 序列 */
function flattenDests() {
  const out = []
  days.value.forEach((day, di) => {
    ;(day.destinations || []).forEach((d) => out.push({ di, day, dest: d }))
  })
  return out
}

/* ---------------- 路段时长自动计算(自驾 OSRM / 公交估算) ---------------- */
const calcBusy = reactive({}) // destId -> true
const extras = new Map() // 只读视角下仅本地展示的临时坐标 destId -> {lat,lng}
const autoRounds = reactive({}) // planId -> 自动重试轮数
const autoRun = ref(false) // 是否正在后台批量计算
const legNote = ref('')
let noteTimer = null
let autoTimer = null

/** 写坐标:围观者(只读)只放临时缓存不落库 */
function persistCoord(it, c) {
  if (!c) return
  extras.set(it.dest.id, c)
  if (props.canEdit) {
    store.updateDestinationFields(props.plan.id, it.day.date, it.dest.id, { lat: c.lat, lng: c.lng })
  }
}

/** 目的地有效坐标(库内数值优先,其次本会话临时定位) */
function effCoord(dest) {
  if (typeof dest?.lat === 'number' && typeof dest?.lng === 'number') return { lat: dest.lat, lng: dest.lng }
  return extras.get(dest?.id) || null
}

async function coordOf(it) {
  const have = effCoord(it.dest)
  if (have) return have
  const c = await geocodePlace(it.dest.place, { hint: props.plan.start_city })
  persistCoord(it, c)
  return c
}

/** 自动计算“上一站 → 本站”的自驾与公交时长并写回;返回是否成功 */
async function autoCalcLeg(day, dest) {
  if (calcBusy[dest.id]) return false
  const items = flattenDests()
  const idx = items.findIndex((it) => it.dest.id === dest.id)
  if (idx <= 0) return false // 全程首站没有上一站
  calcBusy[dest.id] = true
  try {
    const prevItem = items[idx - 1]
    const a = await coordOf(prevItem)
    const b = await coordOf({ di: idx, day, dest })
    if (!a || !b) return false
    const leg = await drivingLeg(a, b)
    const drive = leg?.min
    const transit = transitMinutes(drive)
    if (!drive) return false
    await store.updateDestinationFields(props.plan.id, day.date, dest.id, {
      drive_min: drive,
      transit_min: transit,
      distance_km: leg?.km ?? null
    })
    if (view.value === 'map') drawSegments() // 地图同步刷新路段
    return true
  } catch {
    return false
  } finally {
    delete calcBusy[dest.id]
  }
}

/** 进入计划后自动优先计算缺失路段时长;遗留未算的会小规模重试几轮 */
function scheduleAutoDurations() {
  if (!props.canEdit || autoRun.value) return
  const pid = props.plan.id
  if (autoRounds[pid] >= 3) return // 一个计划最多自动跑 3 轮
  autoRounds[pid] = (autoRounds[pid] || 0) + 1
  clearTimeout(autoTimer)
  autoTimer = setTimeout(async () => {
    autoRun.value = true
    const items = flattenDests()
    if (items.length < 2) return
    let done = 0
    let fail = 0
    for (let i = 1; i < items.length; i++) {
      const it = items[i]
      if (it.dest.drive_min && it.dest.transit_min) continue
      ;(await autoCalcLeg(it.day, it.dest)) ? done++ : fail++
      await new Promise((r) => setTimeout(r, 220)) // 温和限速,避免触发风控
    }
    autoRun.value = false
    const left = flattenDests().filter((it) => !(it.dest.drive_min && it.dest.transit_min))
    if (done || fail) {
      legNote.value = done
        ? `已自动算好 ${done} 段路程时长` + (fail ? `,有 ${fail} 段暂无法定位` : '')
        : '路段自动计算失败,可逐段点击「自动算时长」重试'
      clearTimeout(noteTimer)
      noteTimer = setTimeout(() => (legNote.value = ''), 7000)
    }
    // 有遗留(新地点/偶发失败)且轮次未满 → 稍后自动再补一轮
    if (left.length && autoRounds[pid] < 3) {
      clearTimeout(autoTimer)
      autoTimer = setTimeout(() => scheduleAutoDurations(), 3500)
    }
  }, 900)
}

/* ---------------- 换手 / 司机安排 ---------------- */
const participants = computed(() => (props.plan.members || []).slice())

async function setDriver(day, dest, person) {
  await store.updateDestinationFields(props.plan.id, day.date, dest.id, {
    driver: person ? { id: person.id, name: person.name } : null
  })
}

/** 当日累计自驾分钟 ≥240(约 4 小时)时建议换手/休息 */
function handoverFor(destId) {
  for (const day of days.value) {
    let acc = 0
    for (const x of day.destinations || []) {
      acc += Number(x.drive_min) || 0
      if (x.id === destId) {
        if (!x.drive_min) return false
        return acc >= 240
      }
    }
  }
  return false
}

const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/* 地图路段配色:按所属天着色;跨天路段用深色虚线区分 */
const SEG_COLORS = ['#B75973', '#D98A5B', '#2FA184', '#E76F90', '#8B5FC7']

async function paintRoute() {
  if (!map || !routeLayer) return
  const lack = flattenDests().filter((it) => !effCoord(it.dest))
  geoMissing.value = lack.length

  // 逐条补全缺失坐标(Sequential,失败跳过)
  for (const it of lack) {
    const c = await geocodePlace(it.dest.place, { hint: props.plan.start_city })
    if (c && map) {
      persistCoord(it, c)
      geoMissing.value--
    }
  }
  await drawSegments()
}

/** 只取已有坐标的目的地(含临时定位),供地图绘制 */
function visItems() {
  return flattenDests()
    .map((it) => {
      const e = effCoord(it.dest)
      if (!e) return null
      return { ...it, dest: { ...it.dest, ...e } }
    })
    .filter(Boolean)
}

/** 按顺序把 单天/跨天 自驾路段画到地图上 */
async function drawSegments() {
  if (!map || !routeLayer) return
  const L = await getL()
  routeLayer.clearLayers()
  const items = visItems()
  items.forEach((it) => addMarker(L, it))
  const pts = items.map((it) => [it.dest.lat, it.dest.lng])
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]
    const cur = items[i]
    const cross = prev.di !== cur.di // 跨天自驾路段
    const color = cross ? '#7a4455' : SEG_COLORS[prev.di % SEG_COLORS.length]
    const seg = L.polyline([pts[i - 1], pts[i]], {
      color,
      weight: cross ? 2.5 : 4,
      opacity: cross ? 0.55 : 0.85,
      dashArray: cross ? '5 8' : null,
      interactive: true
    }).addTo(routeLayer)
    if (cur.dest.drive_min || cur.dest.transit_min) {
      const parts = []
      if (cur.dest.drive_min) parts.push(`自驾约 ${fmtMinute(cur.dest.drive_min)}`)
      if (cur.dest.transit_min) parts.push(`公交约 ${fmtMinute(cur.dest.transit_min)}`)
      if (parts.length) {
        seg.bindTooltip(
          `<b>${escapeHtml(prev.dest.place)}</b> → <b>${escapeHtml(cur.dest.place)}</b><br/>` +
            parts.map(escapeHtml).join(' · ') +
            (cross ? '<br/><span style="color:#7a4455">跨天路段</span>' : ''),
          { direction: 'top', opacity: 0.92 }
        )
      }
    }
  }
  if (pts.length === 1) {
    const p = items[0].dest
    map.setView([p.lat, p.lng], 14)
  } else if (pts.length > 1) {
    map.fitBounds(L.latLngBounds(pts).pad(0.25), { padding: [44, 44] })
  }
}

function addMarker(L, { di, day, dest }) {
  const [c1, c2] = PASTEL_GRADS[di % PASTEL_GRADS.length]
  const popup = L.popup({ maxWidth: 260, offset: [0, -6] }).setContent(
    `<div class="rt-pop">
       <div class="rt-pop-title">D${dayIndex(props.plan.start_date, day.date)} · ${escapeHtml(dest.place)}</div>
       <div class="rt-pop-sub">${escapeHtml(fmtDay(day.date))}${dest.time ? ' · ' + escapeHtml(dest.time) : ''}</div>
       ${dest.note ? `<div class="rt-pop-note">${escapeHtml(dest.note)}</div>` : ''}
       <a class="rt-pop-link" target="_blank" rel="noopener" href="${escapeHtml(navUrl(dest.place, { lat: dest.lat, lng: dest.lng }))}">打开导航 ↗</a>
     </div>`
  )
  L.marker([dest.lat, dest.lng], {
    icon: L.divIcon({
      className: 'rt-dot-wrap',
      html: `<span class="rt-dot" style="background:linear-gradient(135deg,${c1},${c2});color:#8a2b45">D${di + 1}</span>`
    }),
    iconSize: [26, 26],
    iconAnchor: [13, 26]
  })
    .addTo(routeLayer)
    .bindPopup(popup)
}
const geoMissing = ref(0)

watch(
  () => props.plan?.id,
  () => {
    // 切换计划后回到列表视图,避免地图与旧数据竞态
    if (map) {
      map.remove()
      map = null
      routeLayer = null
      geoMissing.value = 0
    }
    extras.clear()
    legNote.value = ''
    autoRun.value = false
    view.value = 'list'
  }
)

// 进入计划后数据就绪即自动优先计算路段时长
watch(
  () => totalDest.value,
  (n) => {
    if (n > 1) scheduleAutoDurations()
  }
)

onBeforeUnmount(() => {
  if (map) map.remove()
  map = null
  clearTimeout(autoTimer)
  clearTimeout(noteTimer)
})

/* ---------------- 添加目的地 ---------------- */
const showAdd = ref(false)
const destForm = reactive({ date: '', place: '', time: '', note: '', driveMin: '' })

function openAdd(date) {
  destForm.date = date || days.value[0]?.date || props.plan.start_date
  destForm.place = ''
  destForm.time = ''
  destForm.note = ''
  destForm.driveMin = ''
  showAdd.value = true
}

function chooseFirstFreeDay() {
  const free = days.value.find((d) => !(d.destinations || []).length)
  openAdd(free?.date)
}

async function saveDest() {
  if (!destForm.place.trim() || !destForm.date) return
  const destId = uid('x')
  await store.addDestination(props.plan.id, destForm.date, {
    id: destId,
    place: destForm.place.trim(),
    time: destForm.time || '',
    note: destForm.note.trim(),
    drive_min: destForm.driveMin ? Number(destForm.driveMin) : null
  })
  showAdd.value = false
  // 后台定位坐标,并自动尝试计算“上一站→本站”时长
  const item = flattenDests().find((it) => it.dest.id === destId)
  if (item && props.canEdit) {
    autoCalcLeg(item.day, item.dest) // 不阻塞表单关闭
  } else if (item) {
    coordOf(item)
  }
}

async function onTitleChange(day, e) {
  await store.updateDayTitle(props.plan.id, day.date, e.target.value)
}

async function onRemoveDest(day, d) {
  // 同时清掉挂在该目的地下的建议评论
  for (const c of commentsOf(props.plan.id, day.date, d.id)) {
    if (c.status !== 'done') store.removeComment(props.plan.id, c.id)
  }
  await store.removeDestination(props.plan.id, day.date, d.id)
}

const segDates = computed(() =>
  days.value.length ? days.value.map((d) => d.date) : eachDayISO(props.plan.start_date, props.plan.end_date)
)
const segLabel = (date, i) => `第${i + 1}天 · ${fmtDay(date, false)}`

/* ---------------- 建议评论(采纳闭环) ---------------- */
const comments = computed(() => store.rowsOf(props.plan.id, 'comments'))
const openFor = ref(null) // 'date|destId'
const draft = reactive({})

const commentsOf = (planId, date, destId) =>
  comments.value.filter((c) => c.day_date === date && c.dest_id === destId).sort((a, b) => a.created_at.localeCompare(b.created_at))

function toggleComments(date, destId) {
  const key = `${date}|${destId}`
  openFor.value = openFor.value === key ? null : key
  draft[key] = ''
}

async function postComment(date, destId) {
  const key = `${date}|${destId}`
  const text = (draft[key] || '').trim()
  if (!text) return
  await store.addComment(props.plan.id, {
    day_date: date,
    dest_id: destId,
    text,
    author: { id: auth.user?.id, name: auth.user?.name }
  })
  draft[key] = ''
}

const me = () => auth.user || {}

function ago(iso) {
  if (!iso) return ''
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 86400000)
  if (diff <= 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff < 30) return `${diff} 天前`
  return fmtDay(iso.slice(0, 10), false)
}

/* 状态样式映射 */
const statusMeta = {
  open: { tone: 'amber', text: '待采纳', icon: 'fa-lightbulb' },
  accepted: { tone: 'brand', text: '已采纳 · 待落实', icon: 'fa-circle-check' },
  done: { tone: 'success', text: '已落实 · 闭环', icon: 'fa-circle-check' }
}

function canRemoveComment(c) {
  return (
    props.canEdit &&
    (c.status === 'open' || c.status === 'accepted') &&
    (c.author?.id === me().id || c.author?.name === me().name)
  )
}

/* ---------------- 天气(按日,取当天首个有坐标的地点) ---------------- */
const wx = reactive({}) // date -> {min,max,code} | 'pending'
const wxTried = reactive({}) // date -> true(已尝试,避免反复失败重试)
let wxScanner = null

function firstCoordOf(day) {
  return (day.destinations || []).find((d) => typeof d.lat === 'number' && typeof d.lng === 'number')
}

async function ensureWeather(dateISO, force = false) {
  if (wx[dateISO] && !force) return
  if (!force && wxTried[dateISO]) return
  wxTried[dateISO] = true
  wx[dateISO] = 'pending'
  const day = days.value.find((d) => d.date === dateISO)
  let spot = day && firstCoordOf(day)
  if (day && !spot) {
    const first = day.destinations?.[0]
    if (first) {
      const c = await geocodePlace(first.place, { hint: props.plan.start_city })
      if (c && props.canEdit) {
        await store.updateDestinationFields(props.plan.id, dateISO, first.id, { lat: c.lat, lng: c.lng })
        spot = { ...first, ...c }
      } else if (c) {
        spot = { ...first, ...c } // 围观者仅本次会话定位,不落库
      }
    }
  }
  // Open-Meteo 免费源只提供未来约两周的预报:超出范围直接提示,不再请求
  const daysAhead = Math.round((parseISO(dateISO) - new Date()) / 86400000)
  if (daysAhead > 15) {
    wx[dateISO] = 'range'
    return
  }
  const data = spot ? await fetchDailyWeather(spot.lat, spot.lng, dateISO) : null
  wx[dateISO] = data || null
}

/** 内容就绪后逐个日期排队拉取(约 0.4s/日,避免触发限流) */
/* ---------------- Plan B 雨天/备选预案 ---------------- */
const planBShow = ref(false)
const planBDay = ref(null)
const planBText = ref('')

/** 天气码是否属雨雪/雷雨等"需要预案"类型 */
function rainOf(w) {
  if (!w || typeof w === 'string') return false
  const c = Number(w.code)
  return c >= 51 && c <= 99
}

function openPlanB(day) {
  planBDay.value = day
  planBText.value = day.plan_b || ''
  planBShow.value = true
}

async function savePlanB() {
  if (!planBDay.value) return
  await store.updateDayPlanB(props.plan.id, planBDay.value.date, planBText.value.trim())
  planBShow.value = false
}

function scheduleWeatherScan() {
  if (wxScanner) clearTimeout(wxScanner)
  wxScanner = setTimeout(async () => {
    for (const day of days.value) {
      if (day.destinations?.length) await ensureWeather(day.date)
      await new Promise((r) => setTimeout(r, 350))
    }
  }, 500)
}

watch(
  () => props.plan?.id,
  () => {
    for (const k of Object.keys(wx)) delete wx[k]
    for (const k of Object.keys(wxTried)) delete wxTried[k]
  }
)

watch(
  () => days.value.filter((d) => (d.destinations || []).length).length,
  (n) => n > 0 && scheduleWeatherScan(),
  { immediate: true }
)
</script>

<template>
  <section>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="title-1 flex items-center gap-3">
          <i class="fa-solid fa-route text-[19px] text-primary" aria-hidden="true"></i>
          路线规划
          <span v-if="totalDest" class="chip chip-brand">{{ totalDest }} 个地点</span>
          <span v-if="autoRun" class="chip chip-amber">
            <i class="fa-solid fa-circle-notch" style="animation: spin 0.9s linear infinite" aria-hidden="true"></i>
            自动算时长中…
          </span>
        </h2>
        <p class="muted mt-1">每日行程一目了然,打开地图查看整条路线</p>
        <p v-if="legNote" class="mt-1 text-[12.5px] font-medium text-primary">{{ legNote }}</p>
      </div>
      <div class="flex items-center gap-2">
        <!-- 列表 / 地图 切换 -->
        <div class="card flex gap-1 !rounded-pill !p-1">
          <button
            class="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all duration-250 ease-out active:scale-95"
            :class="view === 'list' ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-primary'"
            @click="leaveMap()"
          >
            <i class="fa-solid fa-list-ul" aria-hidden="true"></i>列表
          </button>
          <button
            class="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-all duration-250 ease-out active:scale-95"
            :class="view === 'map' ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-primary'"
            @click="enterMap()"
          >
            <i class="fa-solid fa-map" aria-hidden="true"></i>地图
          </button>
        </div>
        <BaseButton v-if="canEdit" icon="fa-plus" @click="chooseFirstFreeDay()">添加地点</BaseButton>
      </div>
    </div>

    <!-- ============ 地图视图 ============ -->
    <div v-if="view === 'map'" class="fade-up">
      <div class="card relative overflow-hidden !rounded-card">
        <!-- 高度自适应:小屏按视口比例,避免半屏被地图占掉 -->
        <div ref="mapEl" class="h-[min(54vh,460px)] w-full sm:h-[540px]" style="min-height: 300px"></div>
        <span v-if="geoMissing" class="chip chip-amber absolute left-4 top-4 z-[500] shadow-sm">
          <i class="fa-solid fa-magnifying-glass-location" aria-hidden="true"></i>
          正在定位 {{ geoMissing }} 个地点…
        </span>
        <span v-if="mapStatus" class="chip chip-amber absolute left-4 top-12 z-[500] shadow-sm">
          <i class="fa-solid fa-map" aria-hidden="true"></i>{{ mapStatus }}
        </span>
        <div class="absolute bottom-3 left-4 z-[500] flex gap-2 rounded-[12px] bg-surface/85 px-3 py-2 backdrop-blur">
          <span class="text-[11px] font-semibold text-muted">图例</span>
          <span v-for="(d, di) in days" :key="d.id || d.date" class="flex items-center gap-1 text-[11px] text-ink-soft">
            <i class="fa-solid fa-circle text-[8px]" :style="{ color: PASTEL_GRADS[di % PASTEL_GRADS.length][0] }" aria-hidden="true"></i>
            D{{ di + 1 }}
          </span>
          <span class="flex items-center gap-1 text-[11px] text-ink-soft">
            <span class="inline-block h-0 w-4 border-t-2 border-dashed border-[#7a4455]"></span>跨天路段
          </span>
        </div>
      </div>
      <p class="muted mt-3 text-center text-[12px]">
        地图由 OpenStreetMap 提供;点击「添加地点」后可在地图中查看实时同步
      </p>
    </div>

    <!-- ============ 列表视图(时间轴) ============ -->
    <div v-else class="space-y-10">
      <div v-if="days.length">
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
                :placeholder="`第${dayIndex(plan.start_date, day.date)}天 · 给今天起个主题`"
                @change="onTitleChange(day, $event)"
              />
              <span v-else class="flex-1 truncate text-[14.5px] font-semibold text-ink-soft">{{ day.title || `第${dayIndex(plan.start_date, day.date)}天` }}</span>
              <span v-if="day.destinations?.length" class="ml-auto muted text-[12px]">{{ day.destinations.length }} 站</span>
              <button
                class="chip shrink-0 cursor-pointer !text-[11px]"
                :class="day.plan_b ? 'chip-success' : 'chip-plain'"
                :title="day.plan_b ? '查看/编辑 Plan B 预案' : '设置雨天/备选预案(Plan B)'"
                @click="openPlanB(day)"
              >
                <i class="fa-solid fa-flag mr-1" aria-hidden="true"></i>
                {{ day.plan_b ? '预案已备' : 'Plan B' }}
              </button>
              <!-- 雨天自动提示:预报有雨且还没备方案 -->
              <button
                v-if="canEdit && !day.plan_b && rainOf(wx[day.date])"
                class="chip chip-amber shrink-0 cursor-pointer !text-[11px]"
                @click="openPlanB(day)"
              >
                <span class="dot"></span>当日可能有雨,建议备好 Plan B
              </button>
              <!-- 当日天气(首个地点所在地) -->
              <button
                v-if="day.destinations?.length"
                class="chip chip-plain transition-all duration-200 hover:!bg-amber/20"
                title="天气为目的地所在位置预报,点击刷新"
                @click="ensureWeather(day.date, true)"
              >
                <template v-if="wx[day.date] && typeof wx[day.date] === 'object'">
                  <i :class="`fa-solid ${wxMeta(wx[day.date].code).icon} text-amber`" aria-hidden="true"></i>
                  {{ wxTempText(wx[day.date]) }}
                  <span class="muted !text-[11px]">{{ wxMeta(wx[day.date].code).label }}</span>
                </template>
                <template v-else-if="wx[day.date] === 'pending'">
                  <i class="fa-solid fa-circle-notch" style="animation: spin 0.9s linear infinite" aria-hidden="true"></i>
                  <span class="muted !text-[11px]">天气</span>
                </template>
                <template v-else-if="wx[day.date] === 'range'">
                  <i class="fa-solid fa-calendar-xmark text-muted" aria-hidden="true"></i>
                  <span class="muted !text-[11px]">出发过早 · 临近再看</span>
                </template>
                <template v-else>
                  <i class="fa-solid fa-cloud" aria-hidden="true"></i>
                  <span class="muted !text-[11px]">暂无预报</span>
                </template>
              </button>
            </header>

            <!-- Plan B 预案展示 -->
            <div
              v-if="day.plan_b"
              class="mx-5 mt-3 flex items-start gap-2.5 rounded-[12px] border border-amber/40 bg-amber/10 px-4 py-2.5 text-[12.5px] leading-relaxed text-ink-soft"
            >
              <i class="fa-solid fa-flag mt-0.5 text-amber" aria-hidden="true"></i>
              <div class="min-w-0">
                <b class="text-[11.5px] uppercase tracking-wider text-amber">Plan B 预案</b>
                <p class="mt-0.5">{{ day.plan_b }}</p>
              </div>
            </div>

            <div v-if="day.destinations?.length" class="divide-y divide-line/60">
              <div v-for="d in day.destinations" :key="d.id">
                <div class="grid grid-cols-[64px_1fr] items-start gap-x-3 px-6 py-3 transition-colors duration-200 sm:grid-cols-[72px_1fr_auto] hover:bg-surface-2/60">
                  <span class="pt-0.5 text-[12.5px] font-semibold text-primary/80 tabular-nums">
                    {{ d.time || '全天' }}
                  </span>
                  <div class="min-w-0">
                    <p class="flex items-center gap-2 text-[14.5px] font-medium text-ink">
                      <i class="fa-solid fa-location-dot text-[11px] text-primary/60" aria-hidden="true"></i>
                      {{ d.place }}
                    </p>
                    <p v-if="d.note" class="mt-0.5 text-[12.5px] leading-relaxed text-muted">{{ d.note }}</p>
                    <!-- 路段时长:自驾 / 公交,支持手动填写或「自动计算」 -->
                    <div v-if="canEdit" class="mt-1 flex flex-wrap items-center gap-1.5">
                      <i class="fa-solid fa-car-side text-[10px] text-primary/50" aria-hidden="true"></i>
                      <input
                        type="number"
                        min="1"
                        class="drive-min-input"
                        :value="d.drive_min ?? ''"
                        placeholder="自驾?分"
                        title="从上一站自驾到这里大约多少分钟"
                        @change="(e) => store.updateDestinationFields(plan.id, day.date, d.id, { drive_min: e.target.value ? Number(e.target.value) : null })"
                      />
                      <i class="fa-solid fa-bus-simple text-[10px] text-amber/80" aria-hidden="true"></i>
                      <input
                        type="number"
                        min="1"
                        class="drive-min-input"
                        :value="d.transit_min ?? ''"
                        placeholder="公交?分"
                        title="公共交通大约多少分钟(自动为估算值)"
                        @change="(e) => store.updateDestinationFields(plan.id, day.date, d.id, { transit_min: e.target.value ? Number(e.target.value) : null })"
                      />
                      <button
                        class="btn btn-soft btn-sm !px-2.5 !py-0.5 !text-[11px]"
                        title="按地图路线自动计算自驾时长,并估算公交时长"
                        @click="autoCalcLeg(day, d)"
                      >
                        <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>自动算时长
                      </button>
                    </div>
                    <p v-else-if="d.drive_min || d.transit_min" class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted/80">
                      <template v-if="d.drive_min">
                        <span><i class="fa-solid fa-car-side text-[10px]" aria-hidden="true"></i> 自驾约 {{ fmtMinute(d.drive_min) }}</span>
                      </template>
                      <template v-if="d.transit_min">
                        <span><i class="fa-solid fa-bus-simple text-[10px]" aria-hidden="true"></i> 公交约 {{ fmtMinute(d.transit_min) }}</span>
                      </template>
                    </p>
                    <!-- 换手 / 司机安排 -->
                    <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <i
                        class="fa-solid fa-arrows-rotate text-[10px]"
                        :class="handoverFor(d.id) ? 'text-amber' : 'text-primary/40'"
                        aria-hidden="true"
                      ></i>
                      <template v-if="canEdit && participants.length">
                        <button
                          v-for="p in participants"
                          :key="p.id"
                          type="button"
                          class="chip !px-1.5 !py-0.5 transition-all duration-150 active:scale-90"
                          :class="d.driver?.id === p.id ? 'chip-brand' : 'chip-plain opacity-70'"
                          :title="d.driver?.id === p.id ? `取消 ${p.name} 负责此段` : `${p.name} 负责此段`"
                          @click="setDriver(day, d, d.driver?.id === p.id ? null : p)"
                        >
                          <Avatar :name="p.name" :size="16" :ring="false" />
                          {{ p.name }}
                        </button>
                        <span v-if="d.driver" class="chip chip-success !py-0.5 !text-[11px]">
                          <i class="fa-solid fa-check" aria-hidden="true"></i>{{ d.driver.name }} 开此段
                        </span>
                      </template>
                      <span v-else-if="d.driver" class="text-[11.5px] text-muted">
                        <i class="fa-solid fa-user mr-1" aria-hidden="true"></i>司机:{{ d.driver.name }}
                      </span>
                      <span
                        v-if="handoverFor(d.id)"
                        class="chip chip-amber !py-0.5 !text-[11px]"
                        title="累计驾驶已超 4 小时,建议换手或休息 15 分钟"
                      >
                        <span class="dot"></span>连续驾驶 ≥4h · 建议换手/休息
                      </span>
                    </div>
                  </div>
                  <div class="col-span-2 flex items-center gap-1 pt-1 pl-[76px] sm:col-span-1 sm:pl-0 sm:pt-0">
                    <button
                      class="btn btn-ghost btn-sm !px-2.5"
                      @click="toggleComments(day.date, d.id)"
                      :class="openFor === `${day.date}|${d.id}` ? '!text-primary !border-primary/50' : ''"
                    >
                      <i class="fa-regular fa-message text-[11px]" aria-hidden="true"></i>
                      建议{{ commentsOf(plan.id, day.date, d.id).length ? ` ${commentsOf(plan.id, day.date, d.id).length}` : '' }}
                    </button>
                    <a class="btn btn-ghost btn-sm !px-2.5" :href="navUrl(d.place, d)" target="_blank" rel="noopener" title="打开导航">
                      <i class="fa-solid fa-location-arrow text-[11px]" aria-hidden="true"></i>导航
                    </a>
                    <button v-if="canEdit" class="icon-btn icon-btn-danger" :title="`移除 ${d.place}`" @click="onRemoveDest(day, d)">
                      <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>

                <!-- 建议评论面板 -->
                <Transition name="fade">
                  <div v-if="openFor === `${day.date}|${d.id}`" class="border-t border-line/60 bg-surface-2/40 px-6 py-4">
                    <div v-if="commentsOf(plan.id, day.date, d.id).length" class="space-y-3">
                      <div v-for="c in commentsOf(plan.id, day.date, d.id)" :key="c.id" class="card flex gap-3 p-4" :class="c.status === 'done' ? 'opacity-70' : ''">
                        <Avatar :name="c.author?.name" :size="30" />
                        <div class="min-w-0 flex-1">
                          <div class="mb-1 flex flex-wrap items-center gap-2">
                            <span class="text-[12.5px] font-semibold text-ink">{{ c.author?.name }}</span>
                            <span class="muted text-[11px]">{{ ago(c.created_at) }}</span>
                            <BaseTag :tone="statusMeta[c.status].tone" :icon="statusMeta[c.status].icon" class="!px-2 !text-[11px]">
                              {{ statusMeta[c.status].text }}
                              <template v-if="c.status === 'accepted' || c.status === 'done'">
                                · {{ c.accepted_by?.name }}
                              </template>
                            </BaseTag>
                          </div>
                          <p class="text-[13.5px] leading-relaxed text-ink-soft">{{ c.text }}</p>
                          <div class="mt-2 flex flex-wrap items-center gap-2 text-[11.5px]">
                            <template v-if="c.status === 'done'">
                              <span class="muted">{{ c.accepted_at ? `采纳于 ${ago(c.accepted_at)}` : '' }}{{ c.done_at ? ` · 落实于 ${ago(c.done_at)}` : '' }}</span>
                            </template>
                            <!-- 参与者可按状态推进闭环 -->
                            <template v-else-if="canEdit">
                              <button
                                v-if="c.status === 'open'"
                                class="chip chip-brand cursor-pointer transition-all duration-200 active:scale-95"
                                @click="store.adoptComment(plan.id, c.id, { id: auth.user?.id, name: auth.user?.name })"
                              >
                                <i class="fa-solid fa-check" aria-hidden="true"></i>采纳这条建议
                              </button>
                              <button
                                v-if="c.status === 'accepted'"
                                class="chip chip-success cursor-pointer transition-all duration-200 active:scale-95"
                                @click="store.completeComment(plan.id, c.id)"
                              >
                                <i class="fa-solid fa-check-double" aria-hidden="true"></i>已落实,闭环
                              </button>
                              <button
                                v-if="c.status === 'accepted'"
                                class="chip chip-plain cursor-pointer transition-all duration-200 active:scale-95"
                                @click="store.reopenComment(plan.id, c.id)"
                              >
                                重新打开
                              </button>
                              <button
                                v-if="canRemoveComment(c)"
                                class="icon-btn icon-btn-danger !h-7 !w-7 ml-1"
                                title="删除这条建议"
                                @click="store.removeComment(plan.id, c.id)"
                              >
                                <i class="fa-solid fa-trash-can text-[11px]" aria-hidden="true"></i>
                              </button>
                            </template>
                          </div>
                        </div>
                      </div>
                    </div>
                    <p v-else-if="!canEdit" class="muted text-[12.5px] italic">还没有人提建议</p>
                    <!-- 发表建议(围观者隐藏) -->
                    <div v-if="canEdit" class="mt-3 flex gap-2">
                      <input
                        v-model="draft[`${day.date}|${d.id}`]"
                        class="field flex-1 !py-2 text-[13px]"
                        placeholder="给这个地点提个建议 / 发表意见…"
                        maxlength="120"
                        @keyup.enter="postComment(day.date, d.id)"
                      />
                      <BaseButton size="sm" :disabled="!(draft[`${day.date}|${d.id}`] || '').trim()" @click="postComment(day.date, d.id)">
                        提交
                      </BaseButton>
                    </div>
                  </div>
                </Transition>
              </div>
            </div>

            <p v-else class="px-6 py-5 text-[13px] italic text-muted">
              这一天还没有安排 ——
              <button v-if="canEdit" class="font-semibold text-primary not-italic hover:underline" @click="openAdd(day.date)">
                点击添加第一个目的地
              </button>
            </p>

            <footer v-if="canEdit && day.destinations?.length" class="px-6 pb-4">
              <button
                class="w-full rounded-[12px] border border-dashed border-line py-2 text-[12.5px] font-semibold text-muted transition-all duration-200 ease-out hover:border-primary/40 hover:text-primary active:scale-[0.98]"
                @click="openAdd(day.date)"
              >
                <i class="fa-solid fa-plus mr-1.5 text-[11px]" aria-hidden="true"></i>添加目的地
              </button>
            </footer>
          </article>
        </div>
      </div>
    </div>

    <EmptyState
      v-if="view === 'list' && !days.length"
      icon="fa-map"
      title="路线还没开始规划"
      desc="先选一天,把想去的打卡点按顺序排进时间轴"
    >
      <BaseButton v-if="canEdit" icon="fa-plus" @click="openAdd()">添加第一个地点</BaseButton>
    </EmptyState>

    <!-- 新增目的地弹窗 -->
    <BaseModal v-model="showAdd" title="添加目的地" :max-width="'480px'">
      <div class="space-y-5">
        <div>
          <label class="flabel">安排在哪一天</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="(date, i) in segDates"
              :key="date"
              type="button"
              class="chip transition-all duration-200 ease-out active:scale-95"
              :class="destForm.date === date ? 'chip-brand' : 'chip-plain hover:!bg-primary/10'"
              @click="destForm.date = date"
            >
              {{ segLabel(date, i) }}
            </button>
          </div>
        </div>
        <div>
          <label class="flabel">地点名称 *</label>
          <input v-model="destForm.place" class="field" placeholder="例如:屯溪老街停车场" maxlength="40" />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="flabel">时间(可选)</label>
            <input v-model="destForm.time" type="time" class="field" />
          </div>
          <div class="flex items-end pb-1 text-[12px] text-muted">
            <i class="fa-solid fa-lightbulb mr-1.5 text-amber" aria-hidden="true"></i>
            到达大致时刻,留空显示「全天」
          </div>
        </div>
        <div>
          <label class="flabel">备注</label>
          <textarea v-model="destForm.note" class="field" rows="3" placeholder="停车建议 / 门票提醒 / 同伴任务…"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="flabel">自驾路段(距上一站,分钟)</label>
            <input v-model.number="destForm.driveMin" type="number" min="1" class="field" placeholder="例如 80" />
          </div>
          <div class="flex items-end pb-1 text-[12px] leading-5 text-muted">
            <i class="fa-solid fa-car-side mr-1.5 mt-0.5 text-amber" aria-hidden="true"></i>
            自驾从上一个地点开到这里的时间,用于行程单与地图展示
          </div>
        </div>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="showAdd = false">取消</BaseButton>
        <BaseButton icon="fa-check" :disabled="!destForm.place.trim()" @click="saveDest">加入行程</BaseButton>
      </template>
    </BaseModal>

    <!-- Plan B 预案编辑 -->
    <BaseModal v-model="planBShow" title="Plan B 预案" :max-width="'460px'">
      <p class="muted -mt-1 mb-3 text-[12.5px]">
        {{ planBDay ? fmtDay(planBDay.date) : '' }} · 适合雨天、堵车或临时调整时启用
      </p>
      <textarea
        v-model="planBText"
        class="field"
        rows="4"
        placeholder="例如:若下雨则改游徽州古城(室内为主),晚餐改订老街第二家徽菜馆"
      ></textarea>
      <template #footer>
        <BaseButton
          variant="ghost"
          @click="store.updateDayPlanB(plan.id, planBDay?.date, ''); planBShow = false"
        >
          清除预案
        </BaseButton>
        <BaseButton variant="ghost" @click="planBShow = false">取消</BaseButton>
        <BaseButton icon="fa-flag" :disabled="!planBText.trim()" @click="savePlanB">保存预案</BaseButton>
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
.drive-min-input {
  width: 9rem;
  background: transparent;
  border: 1px dashed transparent;
  border-radius: 8px;
  padding: 1px 8px;
  font-size: 11.5px;
  color: rgb(var(--c-ink-soft));
  outline: none;
  transition: border-color 0.2s ease-out;
}
.drive-min-input::placeholder { color: rgb(var(--c-muted)); opacity: 0.7; }
.drive-min-input:hover { border-color: rgb(var(--c-line)); }
.drive-min-input:focus { border-color: rgb(var(--c-primary) / 0.5); width: 9.5rem; }
</style>

<style>
/* Leaflet 弹窗与标记样式(全局,因挂载在 .leaflet-popup 内) */
.rt-pop-title { font-weight: 700; font-size: 14px; color: #8a2b45; }
.rt-pop-sub { font-size: 12px; color: #a2727e; margin-top: 2px; }
.rt-pop-note { font-size: 12px; margin-top: 6px; line-height: 1.5; color: #7b5a64; }
.rt-pop-link { display: inline-block; margin-top: 8px; font-size: 12px; font-weight: 700; color: #b75973; }
.rt-dot-wrap { background: transparent; border: none; }
.rt-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  box-shadow: 0 2px 8px rgba(183, 89, 115, 0.45), 0 0 0 3px #fff;
}
.leaflet-container { font-family: inherit; }
.leaflet-popup-content-wrapper { border-radius: 14px; box-shadow: 0 8px 30px rgba(80, 40, 55, 0.16); }
</style>
