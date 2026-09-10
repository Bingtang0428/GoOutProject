<script setup>
// ============================================================
// 一键生成「旅行 PPT」
// 旅游全景 → 每日行程(含路线示意图/住宿餐厅标注/当日待办) → 吃什么 → 住哪里 → 预算 → 待办
// 内容放不下自动分多页;支持逐页导出 PNG 或新窗口打印/另存 PDF(横向)。
// ============================================================
import { ref, computed, nextTick } from 'vue'
import { useContentStore } from '@/stores/content'
import { fmtDay, fmtRange } from '@/utils/date'
import { pastelOf } from '@/utils/misc'
import { money as fmtMoney } from '@/utils/money'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  plan: { type: Object, required: true }
})
const emit = defineEmits(['update:modelValue'])
const content = useContentStore()

const sheetRef = ref(null)
const busy = ref(false)
const notice = ref('')

const days = computed(() =>
  content.rowsOf(props.plan.id, 'days').slice().sort((a, b) => a.date.localeCompare(b.date))
)
const stays = computed(() => content.rowsOf(props.plan.id, 'stays'))
const foods = computed(() => stays.value.filter((s) => s.type === 'food'))
const hotels = computed(() => stays.value.filter((s) => s.type !== 'food'))
const bills = computed(() => content.rowsOf(props.plan.id, 'bills'))
const todos = computed(() => content.rowsOf(props.plan.id, 'todos'))

const stayById = computed(() => {
  const m = new Map()
  for (const s of stays.value) m.set(s.id, s)
  return m
})
/** 某目的地是住宿/餐厅(用于在列表里标注) */
function tagOf(x) {
  if (x.stay_role) return 'stay'
  if (x.stay_link) {
    const s = stayById.value.get(x.stay_link)
    if (s) return s.type === 'food' ? 'food' : 'stay'
    return 'stay'
  }
  return ''
}
const dayTodos = (n) => todos.value.filter((t) => Number(t.day) === n)

const totalDest = computed(() => days.value.reduce((n, d) => n + (d.destinations?.length || 0), 0))
const driveMin = computed(() =>
  days.value.reduce((s, d) => s + (d.destinations || []).reduce((a, x) => a + (Number(x.drive_min) || 0), 0), 0)
)
const estKm = computed(() => Math.round((driveMin.value / 60) * 65))
const totalSpent = computed(() => bills.value.reduce((s, b) => s + Number(b.amount || 0), 0))
const budget = computed(() => Number(props.plan.budget) || 0)
const peopleCount = computed(() => Math.max(1, props.plan.members?.length || 1))

const byCat = computed(() => {
  const map = new Map()
  const CATS = { stay: '住宿', food: '餐饮', fuel: '加油', ticket: '门票', toll: '过路', car: '租车', taxi: '打车', souvenir: '纪念品', other: '其他' }
  for (const b of bills.value) {
    const k = CATS[b.category] || '其他'
    map.set(k, (map.get(k) || 0) + Number(b.amount || 0))
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
})

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/* ---------- 每日路线示意图(离屏 canvas → dataURL,html2canvas 可靠渲染) ---------- */
const mapCache = new Map()
function getMap(day) {
  const pts = (day.destinations || []).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng))
  const key = `${day.date}|${pts.map((p) => p.id).join(',')}`
  if (mapCache.has(key)) return mapCache.get(key)
  const W = 820
  const H = 300
  const canvas = document.createElement('canvas')
  const dpr = 2
  canvas.width = W * dpr
  canvas.height = H * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#f7f2f4'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(183,89,115,0.07)'
  ctx.lineWidth = 1
  for (let x = 0; x <= W; x += 41) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
  }
  for (let y = 0; y <= H; y += 41) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }
  if (pts.length >= 1) {
    const lats = pts.map((p) => p.lat)
    const lngs = pts.map((p) => p.lng)
    let minLat = Math.min(...lats), maxLat = Math.max(...lats)
    let minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    if (maxLat - minLat < 1e-4) { minLat -= 0.004; maxLat += 0.004 }
    if (maxLng - minLng < 1e-4) { minLng -= 0.004; maxLng += 0.004 }
    const pad = 52
    const s = Math.min((W - 2 * pad) / (maxLng - minLng), (H - 2 * pad) / (maxLat - minLat))
    const ox = (W - (maxLng - minLng) * s) / 2
    const oy = (H - (maxLat - minLat) * s) / 2
    const X = (lng) => ox + (lng - minLng) * s
    const Y = (lat) => H - oy - (lat - minLat) * s
    const pos = pts.map((p) => ({ x: X(p.lng), y: Y(p.lat), name: p.place || '' }))
    ctx.strokeStyle = '#B75973'
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    ctx.beginPath()
    pos.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.stroke()
    pos.forEach((p, i) => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2)
      ctx.fillStyle = i === 0 ? '#16a34a' : i === pos.length - 1 ? '#dfa124' : '#B75973'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), p.x, p.y + 0.5)
    })
    ctx.fillStyle = '#5a3a46'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    pos.forEach((p) => ctx.fillText((p.name || '').slice(0, 9), p.x, p.y - 14))
  } else {
    ctx.fillStyle = '#9a7a86'
    ctx.font = '14px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('该日暂无坐标,无法生成地图', W / 2, H / 2)
  }
  const url = canvas.toDataURL('image/png')
  mapCache.set(key, url)
  return url
}

/** 幻灯片列表:{ id, kind, ... } */
const slides = computed(() => {
  const out = []
  out.push({ id: 'cover', kind: 'cover' })
  out.push({ id: 'overview', kind: 'overview' })
  days.value.forEach((d, di) => {
    const dests = d.destinations || []
    const dt = dayTodos(di + 1)
    if (!dests.length && !dt.length) return
    const chunks = dests.length ? chunk(dests, 5) : [[]]
    chunks.forEach((items, ci) => {
      out.push({ id: `day-${d.date}-${ci}`, kind: 'day', day: d, index: di, items, page: ci, pages: chunks.length, offset: ci * 5 })
    })
  })
  if (foods.value.length) {
    const ch = chunk(foods.value, 6)
    ch.forEach((items, ci) => out.push({ id: `food-${ci}`, kind: 'food', items, page: ci, pages: ch.length }))
  }
  if (hotels.value.length) {
    const ch = chunk(hotels.value, 6)
    ch.forEach((items, ci) => out.push({ id: `hotel-${ci}`, kind: 'hotel', items, page: ci, pages: ch.length }))
  }
  if (bills.value.length) out.push({ id: 'budget', kind: 'budget' })
  const general = todos.value.filter((t) => !t.day)
  if (general.length) {
    const ch = chunk(general, 8)
    ch.forEach((items, ci) => out.push({ id: `todo-${ci}`, kind: 'todo', items, page: ci, pages: ch.length }))
  }
  out.push({ id: 'end', kind: 'end' })
  return out
})

const grad = computed(() => {
  const [a, b] = pastelOf(props.plan.gradient)
  return `linear-gradient(135deg, ${a}, ${b})`
})
function slideGrad(i) {
  const [a, b] = pastelOf((props.plan.gradient || 0) + i)
  return `linear-gradient(135deg, ${a}, ${b})`
}
function dayLabel(d, i) {
  return `第 ${i + 1} 天 · ${fmtDay(d.date, true)}`
}
/** 当天缺少坐标、未画到地图上的地点数 */
function mapMissing(day) {
  const dests = day.destinations || []
  return dests.filter((x) => !(Number.isFinite(x.lat) && Number.isFinite(x.lng))).length
}

/* ---------- 导出 ---------- */
async function renderAll() {
  const { default: html2canvas } = await import('html2canvas')
  const nodes = sheetRef.value?.querySelectorAll('.ppt-slide') || []
  const canvases = []
  for (const node of nodes) {
    canvases.push(
      await html2canvas(node, {
        backgroundColor: '#fff',
        scale: 1.5,
        useCORS: true,
        allowTaint: false,
        logging: false,
        windowWidth: 960
      })
    )
  }
  return canvases
}
function triggerDownload(url, filename) {
  const a = document.createElement('a')
  a.download = filename
  a.href = url
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 1500)
}
async function downloadAll() {
  busy.value = true
  notice.value = ''
  try {
    await nextTick()
    const canvases = await renderAll()
    for (let i = 0; i < canvases.length; i++) {
      const blob = await new Promise((r) => canvases[i].toBlob(r, 'image/png'))
      if (!blob) continue
      triggerDownload(URL.createObjectURL(blob), `${props.plan.name || '旅行'}-${String(i + 1).padStart(2, '0')}.png`)
      await new Promise((r) => setTimeout(r, 500))
    }
    notice.value = `已导出 ${canvases.length} 张幻灯片图片。`
  } catch (e) {
    notice.value = '导出失败(可能因外链图片跨域),可改用「打印 / 另存 PDF」。'
    console.warn('[ppt]', e)
  } finally {
    busy.value = false
  }
}
async function printPdf() {
  busy.value = true
  notice.value = ''
  try {
    await nextTick()
    const canvases = await renderAll()
    const imgs = canvases.map((c) => `<img src="${c.toDataURL('image/png')}" style="width:100%;display:block" />`).join('')
    const w = window.open('', '_blank')
    if (!w) {
      notice.value = '浏览器拦截了新窗口,请允许弹窗后重试。'
      return
    }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${props.plan.name || '旅行'} · PPT</title>
      <style>@page{size:A4 landscape;margin:0}body{margin:0}img{page-break-after:always}</style></head>
      <body>${imgs}</body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 400)
  } catch (e) {
    notice.value = '生成 PDF 失败,请重试。'
    console.warn('[ppt]', e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-mask">
      <div v-if="modelValue" class="modal-mask fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6">
        <Transition name="modal-panel">
          <div class="card flex max-h-[94dvh] w-full max-w-[960px] flex-col overflow-hidden">
            <header class="flex items-center justify-between gap-3 px-6 py-4">
              <div>
                <h3 class="title-1 text-[18px]">生成旅行 PPT</h3>
                <p class="muted mt-0.5 text-[12px]">旅游全景 · 每日行程(含地图) · 待定餐厅 · 住哪里 · 预算 · 待办</p>
              </div>
              <button class="btn btn-ghost btn-sm" @click="emit('update:modelValue', false)">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>关闭
              </button>
            </header>

            <div class="min-h-0 flex-1 overflow-y-auto bg-surface-2/40 p-4">
              <div ref="sheetRef" class="mx-auto flex max-w-[860px] flex-col gap-5">
                <section
                  v-for="(s, si) in slides"
                  :key="s.id"
                  class="ppt-slide overflow-hidden rounded-[16px] bg-white shadow-card"
                  :style="{ width: '100%', aspectRatio: '16 / 9', fontFamily: 'inherit' }"
                >
                  <!-- 封面 -->
                  <div v-if="s.kind === 'cover'" class="flex h-full flex-col justify-center p-10" :style="{ background: grad }">
                    <p class="text-[12px] font-bold tracking-[0.2em]" style="color:#8a2b45">TOGETHER TRIP · 兔兔同行</p>
                    <h1 class="mt-3 text-[34px] font-bold leading-tight" style="color:#3d2931">{{ plan.name }}</h1>
                    <p class="mt-2 text-[16px]" style="color:#6d4a58">{{ plan.destination || '目的地待定' }}</p>
                    <p class="mt-1 text-[14px]" style="color:#6d4a58">{{ fmtRange(plan.start_date, plan.end_date) }}</p>
                    <p class="mt-3 text-[13px]" style="color:#6d4a58">
                      成员:<span v-for="(m, i) in plan.members" :key="m.id">{{ i ? '、' : '' }}{{ m.name }}</span>
                    </p>
                  </div>

                  <!-- 旅游全景 -->
                  <div v-else-if="s.kind === 'overview'" class="flex h-full flex-col p-9">
                    <h2 class="text-[22px] font-bold text-[#b75973]">旅游全景</h2>
                    <p class="mt-1 text-[13px] text-[#9a7a86]">{{ fmtRange(plan.start_date, plan.end_date) }} · 共 {{ days.length }} 天</p>
                    <div class="mt-6 grid grid-cols-4 gap-4">
                      <div class="rounded-[12px] bg-[#fdf4f8] p-4">
                        <p class="text-[12px] text-[#9a7a86]">行程天数</p>
                        <p class="mt-1 text-[26px] font-bold text-[#3d2931]">{{ days.length }}</p>
                      </div>
                      <div class="rounded-[12px] bg-[#fdf4f8] p-4">
                        <p class="text-[12px] text-[#9a7a86]">打卡地点</p>
                        <p class="mt-1 text-[26px] font-bold text-[#3d2931]">{{ totalDest }}</p>
                      </div>
                      <div class="rounded-[12px] bg-[#fdf4f8] p-4">
                        <p class="text-[12px] text-[#9a7a86]">预估里程</p>
                        <p class="mt-1 text-[26px] font-bold text-[#3d2931]">{{ estKm }}<span class="text-[14px]"> km</span></p>
                      </div>
                      <div class="rounded-[12px] bg-[#fdf4f8] p-4">
                        <p class="text-[12px] text-[#9a7a86]">同行伙伴</p>
                        <p class="mt-1 text-[26px] font-bold text-[#3d2931]">{{ peopleCount }}</p>
                      </div>
                    </div>
                    <p class="mt-6 text-[13px] text-[#6d4a58]">
                      住宿 {{ hotels.length }} 处 · 待定餐厅 {{ foods.length }} 家 · 待办 {{ todos.filter((t) => !t.done).length }} 项 · 花费 {{ fmtMoney(totalSpent) }}
                    </p>
                  </div>

                  <!-- 每日行程(可多页) -->
                  <div v-else-if="s.kind === 'day'" class="flex h-full flex-col p-6">
                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 class="text-[19px] font-bold text-[#b75973]">
                        {{ dayLabel(s.day, s.index) }}
                        <span v-if="s.pages > 1" class="text-[12px] font-normal text-[#9a7a86]">({{ s.page + 1 }}/{{ s.pages }})</span>
                      </h2>
                      <span class="text-[12px] text-[#9a7a86]">{{ s.day.title || '' }}</span>
                    </div>

                    <img
                      v-if="s.page === 0"
                      :src="getMap(s.day)"
                      alt="当日路线"
                      class="mt-2 w-full rounded-[12px] bg-[#f7f2f4]"
                      style="height: 172px; object-fit: contain"
                    />
                    <p v-if="s.page === 0 && mapMissing(s.day)" class="mt-1 text-[10.5px] text-[#9a7a86]">
                      <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>{{ mapMissing(s.day) }} 个地点缺少坐标,未显示在地图上
                    </p>

                    <ol class="mt-3 flex-1 space-y-1.5 overflow-hidden">
                      <li v-for="(x, xi) in s.items" :key="x.id" class="flex items-start gap-2 text-[13px] text-[#4a3440]">
                        <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#b75973] text-[10px] font-bold text-white">{{ s.offset + xi + 1 }}</span>
                        <span class="min-w-0 flex-1">
                          <b class="font-semibold">{{ x.time || '全天' }}</b> {{ x.place }}
                          <span v-if="tagOf(x) === 'stay'" class="ml-1 rounded-full bg-[#fdf4f8] px-1.5 py-0.5 text-[10px] font-semibold text-[#b75973]">🏨 住宿</span>
                          <span v-else-if="tagOf(x) === 'food'" class="ml-1 rounded-full bg-[#fff8ec] px-1.5 py-0.5 text-[10px] font-semibold text-[#b45309]">🍽 餐厅</span>
                          <span v-if="x.note" class="block text-[11px] text-[#9a7a86]">{{ x.note }}</span>
                        </span>
                      </li>
                    </ol>

                    <div v-if="s.page === 0 && dayTodos(s.index + 1).length" class="mt-2 rounded-[10px] bg-[#fff7e6] px-3 py-1.5">
                      <b class="text-[11px] text-[#b45309]">今日待办</b>
                      <span v-for="t in dayTodos(s.index + 1)" :key="t.id" class="ml-2 text-[11.5px] text-[#6d4a58]">
                        · {{ t.title }}<span v-if="t.done" class="text-[#16a34a]">(已完成)</span>
                      </span>
                    </div>
                  </div>

                  <!-- 待定餐厅(可多页) -->
                  <div v-else-if="s.kind === 'food'" class="flex h-full flex-col p-8">
                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 class="text-[22px] font-bold text-[#b75973]">
                        待定餐厅
                        <span v-if="s.pages > 1" class="text-[12px] font-normal text-[#9a7a86]">({{ s.page + 1 }}/{{ s.pages }})</span>
                      </h2>
                      <span class="text-[12px] text-[#9a7a86]">候选餐厅,待选定</span>
                    </div>
                    <div class="mt-5 grid flex-1 grid-cols-2 gap-3">
                      <div v-for="f in s.items" :key="f.id" class="rounded-[12px] bg-[#fff8ec] p-4">
                        <div class="flex items-center justify-between gap-2">
                          <p class="min-w-0 truncate text-[15px] font-semibold text-[#3d2931]">{{ f.name }}</p>
                          <span
                            class="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                            :style="f.chosen ? 'background:rgba(22,163,74,.1);color:#16a34a' : 'background:rgba(180,83,9,.1);color:#b45309'"
                          >{{ f.chosen ? '已选定' : '待定' }}</span>
                        </div>
                        <p class="mt-1 text-[12px] text-[#9a7a86]">{{ f.address || '地址待补充' }}</p>
                        <p class="mt-1 text-[11px]" :style="{ color: f.booked ? '#16a34a' : '#b45309' }">
                          {{ f.booked ? '已预订' : '待预订' }}<template v-if="f.tags?.length"> · {{ f.tags.join(' · ') }}</template>
                        </p>
                      </div>
                    </div>
                  </div>

                  <!-- 住哪里(可多页) -->
                  <div v-else-if="s.kind === 'hotel'" class="flex h-full flex-col p-8">
                    <h2 class="text-[22px] font-bold text-[#b75973]">
                      住哪里
                      <span v-if="s.pages > 1" class="text-[12px] font-normal text-[#9a7a86]">({{ s.page + 1 }}/{{ s.pages }})</span>
                    </h2>
                    <div class="mt-5 grid flex-1 grid-cols-2 gap-3">
                      <div v-for="h in s.items" :key="h.id" class="rounded-[12px] bg-[#fdf4f8] p-4">
                        <p class="text-[15px] font-semibold text-[#3d2931]">{{ h.name }}</p>
                        <p class="mt-1 text-[12px] text-[#9a7a86]">{{ h.address || '地址待补充' }}</p>
                        <p class="mt-1 text-[11px]" :style="{ color: h.booked ? '#16a34a' : '#b45309' }">{{ h.booked ? '已预订' : '待预订' }}</p>
                      </div>
                    </div>
                  </div>

                  <!-- 预算 -->
                  <div v-else-if="s.kind === 'budget'" class="flex h-full flex-col p-9">
                    <h2 class="text-[22px] font-bold text-[#b75973]">预算与花费</h2>
                    <div class="mt-5 flex gap-8">
                      <div>
                        <p class="text-[12px] text-[#9a7a86]">总花费</p>
                        <p class="text-[30px] font-bold text-[#3d2931]">{{ fmtMoney(totalSpent) }}</p>
                      </div>
                      <div>
                        <p class="text-[12px] text-[#9a7a86]">预算</p>
                        <p class="text-[30px] font-bold text-[#3d2931]">{{ budget ? fmtMoney(budget) : '未设' }}</p>
                      </div>
                      <div>
                        <p class="text-[12px] text-[#9a7a86]">人均</p>
                        <p class="text-[30px] font-bold text-[#3d2931]">{{ fmtMoney(totalSpent / peopleCount) }}</p>
                      </div>
                    </div>
                    <div class="mt-6 flex flex-wrap gap-2">
                      <span v-for="[k, v] in byCat" :key="k" class="rounded-full bg-[#fdf4f8] px-3 py-1.5 text-[13px] text-[#6d4a58]">
                        {{ k }} {{ fmtMoney(v) }}
                      </span>
                    </div>
                  </div>

                  <!-- 待办(未归属到某天) -->
                  <div v-else-if="s.kind === 'todo'" class="flex h-full flex-col p-8">
                    <h2 class="text-[22px] font-bold text-[#b75973]">
                      出发前待办
                      <span v-if="s.pages > 1" class="text-[12px] font-normal text-[#9a7a86]">({{ s.page + 1 }}/{{ s.pages }})</span>
                    </h2>
                    <ul class="mt-4 flex-1 space-y-2">
                      <li v-for="t in s.items" :key="t.id" class="flex items-center gap-2 text-[14px] text-[#4a3440]">
                        <i :class="t.done ? 'fa-solid fa-circle-check text-[#16a34a]' : 'fa-regular fa-circle text-[#b75973]'" aria-hidden="true"></i>
                        <span :class="t.done ? 'text-[#9a7a86] line-through' : ''">{{ t.title }}</span>
                        <span v-if="t.due" class="text-[11px] text-[#9a7a86]">({{ fmtDay(t.due, false) }} 截止)</span>
                      </li>
                    </ul>
                  </div>

                  <!-- 结束页 -->
                  <div v-else class="flex h-full flex-col items-center justify-center" :style="{ background: slideGrad(si) }">
                    <h2 class="text-[30px] font-bold" style="color:#3d2931">雨林通往雪景,你向往的旅行 ♪</h2>
                    <p class="mt-3 text-[14px]" style="color:#6d4a58">{{ plan.name }} · 兔兔同行</p>
                  </div>
                </section>
              </div>
            </div>

            <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 px-6 py-4">
              <p v-if="notice" class="muted text-[12px]">{{ notice }}</p>
              <p v-else class="muted text-[12px]">共 {{ slides.length }} 页 · 16:9 幻灯片</p>
              <div class="flex items-center gap-2">
                <button class="btn btn-ghost" :disabled="busy" @click="printPdf">
                  <i class="fa-solid fa-file-pdf" aria-hidden="true"></i>打印 / 另存 PDF
                </button>
                <button class="btn btn-primary" :disabled="busy" @click="downloadAll">
                  <i v-if="busy" class="fa-solid fa-circle-notch" style="animation: spin 0.8s linear infinite" aria-hidden="true"></i>
                  <i v-else class="fa-solid fa-download" aria-hidden="true"></i>
                  导出全部图片
                </button>
              </div>
            </footer>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
