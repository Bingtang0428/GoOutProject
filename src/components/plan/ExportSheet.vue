<script setup>
// ============================================================
// 导出行程单
//  - 另存为 PDF:调起系统打印对话框(浏览器「另存为 PDF」)
//  - 下载长图:html2canvas 渲染整张行程单为 PNG
// 内容:计划头 + 每日路线 + 食宿 + 待办 + 大交通 + 分账结算
// ============================================================
import { ref, computed, nextTick } from 'vue'
import { useContentStore } from '@/stores/content'
import { fmtDay, fmtRange, fmtSavedAt, todayISO, relKey } from '@/utils/date'
import { pastelOf } from '@/utils/misc'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  plan: { type: Object, required: true }
})
const emit = defineEmits(['update:modelValue'])
const content = useContentStore()

const sheetRef = ref(null)
const busy = ref(false)
const notice = ref('')

const fmtMoney = (n) => `¥${Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`

const days = computed(() =>
  content.rowsOf(props.plan.id, 'days').slice().sort((a, b) => a.date.localeCompare(b.date))
)
const stays = computed(() => content.rowsOf(props.plan.id, 'stays'))
const todos = computed(() => content.rowsOf(props.plan.id, 'todos'))
const transits = computed(() => content.rowsOf(props.plan.id, 'transits'))
const reminders = computed(() => content.rowsOf(props.plan.id, 'reminders'))
const bills = computed(() => content.rowsOf(props.plan.id, 'bills'))

const openTodos = computed(() => todos.value.filter((t) => !t.done))
const upcomingOpen = computed(() => {
  const t = todayISO()
  return transits.value.filter((x) => x.leg_date >= t).sort((a, b) => a.leg_date.localeCompare(b.leg_date))
})

const billSettle = computed(() => {
  const stat = new Map()
  for (const p of props.plan.members || []) stat.set(p.id, { name: p.name, credit: 0, share: 0 })
  for (const b of bills.value) {
    const n = b.involves?.length || 0
    if (!n) continue
    const each = Number(b.amount || 0) / n
    for (const inv of b.involves) {
      const s = stat.get(inv.id)
      if (s) s.share += each
    }
    const payer = stat.get(b.paid_by?.id)
    if (payer) payer.credit += Number(b.amount || 0)
  }
  return [...stat.values()].map((s) => ({ ...s, net: s.credit - s.share }))
})

const totalSpent = computed(() => bills.value.reduce((s, b) => s + Number(b.amount || 0), 0))
const budget = computed(() => Number(props.plan.budget) || 0)

async function downloadPng() {
  busy.value = true
  notice.value = ''
  try {
    const { default: html2canvas } = await import('html2canvas')
    await nextTick()
    const canvas = await html2canvas(sheetRef.value, {
      backgroundColor: '#fff',
      scale: Math.min(2, window.devicePixelRatio || 1),
      useCORS: true,
      logging: false,
      windowWidth: 900
    })
    const a = document.createElement('a')
    a.download = `${props.plan.name || '行程单'}.png`
    a.href = canvas.toDataURL('image/png')
    a.click()
  } catch (e) {
    notice.value = '长图生成失败(可能因外链图片跨域),可改用「另存为 PDF」。'
    console.warn('[export]', e)
  } finally {
    busy.value = false
  }
}

function doPrint() {
  // 打印时只有 #export-sheet 可见(见 index.css @media print)
  window.print()
}

const grad = computed(() => {
  const [a, b] = pastelOf(props.plan.gradient)
  return `linear-gradient(135deg, ${a}, ${b})`
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-mask">
      <div v-if="modelValue" class="modal-mask fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6">
        <Transition name="modal-panel">
          <div class="card flex max-h-[94dvh] w-full max-w-[860px] flex-col overflow-hidden">
            <!-- 顶栏:打印时隐藏 -->
            <header class="no-print flex items-center justify-between gap-3 px-6 py-4">
              <div>
                <h3 class="title-1 text-[18px]">导出行程单</h3>
                <p class="muted text-[12px] mt-0.5">成员人手一份,出发前发群里即可</p>
              </div>
              <div class="flex items-center gap-2">
                <button class="btn btn-ghost btn-sm" @click="emit('update:modelValue', false)">
                  <i class="fa-solid fa-xmark" aria-hidden="true"></i>关闭
                </button>
              </div>
            </header>

            <!-- 行程单本体(打印/长图范围) -->
            <div class="min-h-0 flex-1 overflow-y-auto bg-white p-6 sm:p-8">
              <div id="export-sheet" ref="sheetRef" class="export-sheet mx-auto max-w-[760px] bg-white font-sans text-[#4a3440]" style="print-color-adjust: exact; -webkit-print-color-adjust: exact">
                <div class="export-pad">
                <!-- 抬头 -->
                <div class="rounded-[16px] p-6" :style="{ background: grad }">
                  <p class="text-[12px] font-bold tracking-[0.18em]" style="color:#8a2b45">
                    兔兔同行 · 自驾旅行企划 <span style="opacity:.6">/ TOGETHER TRIP</span>
                  </p>
                  <h1 class="mt-2 text-[24px] font-bold" style="color:#3d2931">{{ plan.name }}</h1>
                  <p class="mt-1 text-[13px]" style="color:#6d4a58">
                    目的地:{{ plan.destination || '待定' }} · {{ fmtRange(plan.start_date, plan.end_date) }}
                  </p>
                  <p v-if="plan.start_city" class="mt-1 text-[12.5px]" style="color:#6d4a58">
                    集合城市:{{ plan.start_city }} · 先集合再出发
                  </p>
                  <p class="mt-2 text-[12.5px]" style="color:#6d4a58">
                    成员:<span v-for="(m, i) in plan.members" :key="m.id">{{ i ? '、' : '' }}{{ m.name }}</span>
                    <span v-if="plan.viewers?.length"> · 围观:{{ plan.viewers.map((v) => v.name).join('、') }}</span>
                  </p>
                </div>

                <!-- 大交通(先到集合点) -->
                <template v-if="upcomingOpen.length">
                  <h2 class="print-h2">一、集合交通</h2>
                  <p class="print-note">大家从不同城市出发,先抵达起点再同行</p>
                  <table class="print-table">
                    <tbody>
                      <tr v-for="t in upcomingOpen" :key="t.id">
                        <td class="w-20">{{ t.direction === 'in' ? '到达' : '离开' }}</td>
                        <td class="w-14">{{ fmtDay(t.leg_date, false) }}</td>
                        <td>{{ t.person?.name }}</td>
                        <td>{{ t.from_city }} → {{ t.to_city }}</td>
                        <td class="w-28">{{ t.ref_no || '' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </template>

                <!-- 每日路线 -->
                <h2 class="print-h2">二、每日路线</h2>
                <div v-for="(d, di) in days" :key="d.date" class="print-day">
                  <p class="print-day-title">
                    第 {{ di + 1 }} 天 · {{ fmtDay(d.date, true) }}
                    <template v-if="d.title">—— {{ d.title }}</template>
                  </p>
                  <p v-if="d.destinations?.length" class="mb-1">
                    <span v-for="(x, i) in d.destinations" :key="x.id" class="print-dest">
                      {{ x.time || '全天' }} {{ x.place }}<template v-if="x.drive_min">(自驾 {{ x.drive_min }}min)</template><template v-if="i < d.destinations.length - 1"> → </template>
                    </span>
                  </p>
                  <p v-else class="text-[12px] italic" style="color:#9a7a86">待安排</p>
                  <p v-if="(d.destinations || []).some((x) => x.note)" class="mt-1">
                    <span v-for="x in d.destinations.filter((y) => y.note)" :key="'n' + x.id" class="block text-[11.5px]" style="color:#7c5a66">
                      · {{ x.place }}:{{ x.note }}
                    </span>
                  </p>
                </div>

                <!-- 食宿 -->
                <template v-if="stays.length">
                  <h2 class="print-h2">三、食宿安排</h2>
                  <table class="print-table">
                    <tbody>
                      <tr v-for="s in stays" :key="s.id">
                        <td class="w-14">{{ s.type === 'food' ? '餐厅' : '住宿' }}</td>
                        <td>{{ s.name }}</td>
                        <td>{{ s.address }}</td>
                        <td class="w-16">{{ s.booked ? '已订' : '待订' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </template>

                <!-- 待办 -->
                <template v-if="openTodos.length">
                  <h2 class="print-h2">四、出发前待办({{ openTodos.length }} 项)</h2>
                  <p class="text-[13px] leading-6" style="color:#3d2931">
                    <span v-for="(t, i) in openTodos" :key="t.id" class="inline-block">
                      <template v-if="i"> ; </template>{{ t.title }}<template v-if="t.due">({{ t.due === todayISO() ? '今天' : fmtDay(t.due, false) }}截止)</template>
                    </span>
                  </p>
                </template>

                <!-- 分账 -->
                <template v-if="bills.length">
                  <h2 class="print-h2">五、分账概览(共 {{ bills.length }} 笔)</h2>
                  <table class="print-table">
                    <tbody>
                      <tr>
                        <td>总支出</td>
                        <td>{{ fmtMoney(totalSpent) }}</td>
                        <td>预算</td>
                        <td>{{ budget ? fmtMoney(budget) : '未设' }}</td>
                        <td>{{ budget ? (totalSpent > budget ? '超支 ' + fmtMoney(totalSpent - budget) : '余 ' + fmtMoney(budget - totalSpent)) : '' }}</td>
                      </tr>
                      <tr v-for="s in billSettle" :key="s.name">
                        <td>{{ s.name }}</td>
                        <td>垫付 {{ fmtMoney(s.credit) }}</td>
                        <td>应摊 {{ fmtMoney(s.share) }}</td>
                        <td :colspan="2">
                          {{ s.net > 0.005 ? '应收 ' + fmtMoney(s.net) : s.net < -0.005 ? '应补 ' + fmtMoney(-s.net) : '两清' }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </template>

                <p class="print-footer">兔兔同行 · 雨林通往雪景,你向往的旅行 ♪　{{ todayISO() }} 导出</p>
                </div>
              </div>
            </div>

            <!-- 底部操作:打印时隐藏 -->
            <footer class="no-print flex flex-wrap items-center justify-between gap-3 border-t border-line/70 px-6 py-4">
              <p v-if="notice" class="muted text-[12px]">{{ notice }}</p>
              <p v-else class="muted text-[12px]">共 {{ days.length }} 天 · {{ stays.length }} 住宿安排 · {{ openTodos.length }} 项待办</p>
              <div class="flex items-center gap-2">
                <button class="btn btn-ghost" @click="doPrint">
                  <i class="fa-solid fa-file-pdf" aria-hidden="true"></i>另存为 PDF
                </button>
                <button class="btn btn-primary" :disabled="busy" @click="downloadPng">
                  <i v-if="busy" class="fa-solid fa-circle-notch" style="animation: spin 0.8s linear infinite" aria-hidden="true"></i>
                  <i v-else class="fa-solid fa-image" aria-hidden="true"></i>
                  下载长图
                </button>
              </div>
            </footer>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 供导出的打印/长图样式 */
.export-pad { padding: 4px 6px; } /* 屏幕预览时内衬,避免内容贴边 */
@media print {
  .export-pad { padding: 4mm 5mm !important; } /* 纸张上四周留白,页面不拥挤 */
  .print-h2 { margin-top: 8mm; }
}
.print-h2 {
  margin-top: 26px;
  margin-bottom: 6px;
  font-size: 15px;
  font-weight: 700;
  color: #b75973;
  border-bottom: 2px solid #f3d9e2;
  padding-bottom: 6px;
  letter-spacing: 0.02em;
}
.print-note { font-size: 11.5px; color: #9a7a86; margin-bottom: 6px; }
.print-day { margin-top: 12px; }
.print-day-title { font-size: 13.5px; font-weight: 700; color: #3d2931; margin-bottom: 4px; }
.print-dest { font-size: 13px; color: #4a3440; }
.print-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.print-table td {
  border: 1px solid #f0dbe4;
  padding: 6px 8px;
  vertical-align: top;
}
.print-table tbody tr:first-child td { background: #fdf4f8; font-weight: 700; color: #b75973; }
.print-footer {
  margin-top: 30px;
  text-align: center;
  font-size: 11px;
  color: #b99aa6;
}
</style>
