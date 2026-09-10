<script setup>
// ============================================================
// 一键生成「旅行 PPT」
// 按 旅游全景 → 每日行程 → 吃什么 → 住哪里 → 预算 顺序生成 16:9 幻灯片,
// 支持逐页导出 PNG 或在新窗口打印/另存为 PDF(横向)。
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
  const CATS = { stay: '住宿', food: '餐饮', fuel: '加油', ticket: '门票', toll: '过路', other: '其他' }
  for (const b of bills.value) {
    const k = CATS[b.category] || '其他'
    map.set(k, (map.get(k) || 0) + Number(b.amount || 0))
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
})

/** 幻灯片列表:{ id, kind, ... } */
const slides = computed(() => {
  const out = []
  out.push({ id: 'cover', kind: 'cover' })
  out.push({ id: 'overview', kind: 'overview' })
  for (const [i, d] of days.value.entries()) {
    if (d.destinations?.length) out.push({ id: 'day-' + d.date, kind: 'day', day: d, index: i })
  }
  if (foods.value.length) out.push({ id: 'food', kind: 'food' })
  if (hotels.value.length) out.push({ id: 'hotel', kind: 'hotel' })
  if (bills.value.length) out.push({ id: 'budget', kind: 'budget' })
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
                <p class="muted mt-0.5 text-[12px]">旅游全景 · 每日行程 · 吃什么 · 住哪里 · 预算</p>
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
                      住宿 {{ hotels.length }} 处 · 餐厅 {{ foods.length }} 家 · 待办 {{ todos.filter((t) => !t.done).length }} 项 · 花费 {{ fmtMoney(totalSpent) }}
                    </p>
                  </div>

                  <!-- 每日行程 -->
                  <div v-else-if="s.kind === 'day'" class="flex h-full flex-col p-8">
                    <div class="flex items-baseline justify-between">
                      <h2 class="text-[20px] font-bold text-[#b75973]">{{ dayLabel(s.day, s.index) }}</h2>
                      <span class="text-[12px] text-[#9a7a86]">{{ s.day.title || '' }}</span>
                    </div>
                    <ol class="mt-4 flex-1 space-y-2.5">
                      <li v-for="(x, xi) in s.day.destinations" :key="x.id" class="flex items-start gap-3 text-[14px] text-[#4a3440]">
                        <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" :style="{ background: '#b75973' }">{{ xi + 1 }}</span>
                        <span class="min-w-0">
                          <b class="font-semibold">{{ x.time || '全天' }}</b> {{ x.place }}
                          <span v-if="x.note" class="block text-[12px] text-[#9a7a86]">{{ x.note }}</span>
                        </span>
                      </li>
                    </ol>
                    <p v-if="s.day.plan_b" class="mt-2 rounded-[10px] bg-[#fff7e6] px-3 py-2 text-[12px] text-[#b45309]">Plan B:{{ s.day.plan_b }}</p>
                  </div>

                  <!-- 吃什么 -->
                  <div v-else-if="s.kind === 'food'" class="flex h-full flex-col p-8">
                    <h2 class="text-[22px] font-bold text-[#b75973]">吃什么</h2>
                    <div class="mt-5 grid flex-1 grid-cols-2 gap-3">
                      <div v-for="f in foods" :key="f.id" class="rounded-[12px] bg-[#fff8ec] p-4">
                        <p class="text-[15px] font-semibold text-[#3d2931]">{{ f.name }}</p>
                        <p class="mt-1 text-[12px] text-[#9a7a86]">{{ f.address || '地址待补充' }}</p>
                        <p v-if="f.tags?.length" class="mt-1 text-[11px] text-[#b45309]">{{ f.tags.join(' · ') }}</p>
                      </div>
                    </div>
                  </div>

                  <!-- 住哪里 -->
                  <div v-else-if="s.kind === 'hotel'" class="flex h-full flex-col p-8">
                    <h2 class="text-[22px] font-bold text-[#b75973]">住哪里</h2>
                    <div class="mt-5 grid flex-1 grid-cols-2 gap-3">
                      <div v-for="h in hotels" :key="h.id" class="rounded-[12px] bg-[#fdf4f8] p-4">
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
