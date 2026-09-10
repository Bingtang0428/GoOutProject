<script setup>
// ============================================================
// 今日视图(出行陪伴):一眼看出今天/下一程要做什么
//  - 自动定位「今天」(行程中)或「下一站」(未出发)
//  - 下一站大卡 + 一键导航;出行模式全屏放大
//  - 当日行程、待办、提醒、住宿一屏收拢
// ============================================================
import { ref, computed } from 'vue'
import { useContentStore } from '@/stores/content'
import { useAuthStore } from '@/stores/auth'
import { fmtDay, todayISO } from '@/utils/date'
import { navUrl } from '@/api/geocode'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Avatar from '@/components/ui/Avatar.vue'
import InfoHint from '@/components/ui/InfoHint.vue'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const store = useContentStore()
const auth = useAuthStore()
const me = computed(() => ({ id: auth.user?.id || null, name: auth.user?.name || '' }))

const days = computed(() =>
  store.rowsOf(props.plan.id, 'days').slice().sort((a, b) => a.date.localeCompare(b.date))
)
const todos = computed(() => store.rowsOf(props.plan.id, 'todos'))
const reminders = computed(() => store.rowsOf(props.plan.id, 'reminders'))
const stays = computed(() => store.rowsOf(props.plan.id, 'stays'))

const today = todayISO()

/** 今天所在的那一天;未出发取最近的将来日;已结束取最后一天 */
const activeDay = computed(() => {
  const list = days.value
  if (!list.length) return null
  return list.find((d) => d.date === today) || list.find((d) => d.date > today) || list[list.length - 1]
})
const activeIndex = computed(() =>
  activeDay.value ? days.value.findIndex((d) => d.date === activeDay.value.date) : -1
)
const isToday = computed(() => activeDay.value?.date === today)

const stops = computed(() => (activeDay.value?.destinations || []).slice())

function toMin(t) {
  if (!t) return null
  const [h, m] = String(t).split(':').map(Number)
  return Number.isFinite(h) ? h * 60 + (m || 0) : null
}
const nowMin = computed(() => {
  const n = new Date()
  return n.getHours() * 60 + n.getMinutes()
})

/** 下一站:今天取时间未到的第一个;非今天取第一个 */
const nextStop = computed(() => {
  const list = stops.value
  if (!list.length) return null
  if (!isToday.value) return list[0]
  return list.find((x) => (toMin(x.time) ?? 0) >= nowMin.value) || null
})
const nextStopIndex = computed(() => (nextStop.value ? stops.value.indexOf(nextStop.value) : -1))

function stopStatus(x) {
  if (!isToday.value) return 'upcoming'
  const m = toMin(x.time)
  if (m == null) return 'upcoming'
  if (x.id === nextStop.value?.id) return 'next'
  return m < nowMin.value ? 'passed' : 'upcoming'
}

const dayTodos = computed(() =>
  todos.value.filter((t) => Number(t.day) === activeIndex.value + 1)
)
const dayReminders = computed(() =>
  reminders.value.filter((r) => r.date === activeDay.value?.date && !store.reminderClosed(r))
)
/** 当天选定的住宿 */
const dayHotel = computed(() => {
  const n = activeIndex.value + 1
  return (
    stays.value.find((s) => s.type !== 'food' && s.chosen && daysOf(s).includes(n)) ||
    stays.value.find((s) => s.type !== 'food' && s.chosen && daysOf(s).length === 0)
  )
})
function daysOf(s) {
  if (Array.isArray(s.days) && s.days.length) return s.days
  return s.day ? [s.day] : []
}

function navTo(x) {
  return navUrl(x.place, x)
}

/* 出行模式全屏 */
const travel = ref(false)

const samePerson = (a, b) => a && b && ((a.id && b.id && a.id === b.id) || (a.name && a.name === b.name))
function assigneesOf(t) {
  if (Array.isArray(t.assignees) && t.assignees.length) return t.assignees
  return t.assignee ? [t.assignee] : []
}
/** 我是否已完成(多人指派时按人) */
function myDone(t) {
  const list = assigneesOf(t)
  if (list.length <= 1) return !!t.done
  return (Array.isArray(t.completions) ? t.completions : []).some((c) => samePerson(c, me.value))
}

async function toggleTodo(t) {
  if (!props.canEdit) return
  await store.toggleTodo(props.plan.id, t.id, me.value)
}
async function readReminder(r) {
  if (!props.canEdit) return
  await store.readReminderBy(props.plan.id, r.id, { id: null, name: '我' }, true)
}
</script>

<template>
  <section>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="title-1 flex flex-wrap items-center gap-3">
          <i class="fa-solid fa-sun text-[19px] text-primary" aria-hidden="true"></i>
          今日视图
          <span v-if="activeDay" class="chip chip-brand">{{ isToday ? '今天' : '下一程' }} · 第 {{ activeIndex + 1 }} 天</span>
        </h2>
        <p class="muted mt-1">一眼看出还要做什么 —— 下一站、待办、提醒、住宿</p>
      </div>
      <BaseButton v-if="activeDay" icon="fa-person-walking-arrow-right" @click="travel = true">出行模式</BaseButton>
      <InfoHint align="right" text="出行模式=全屏放大,只显示下一站与一键导航,方便旅途中随时查看。" />
    </div>

    <div v-if="!activeDay" class="card p-6">
      <EmptyState icon="fa-sun" title="还没有行程" desc="先在路线规划里排好每天的目的地,这里会自动显示今天要做什么" />
    </div>

    <template v-else>
      <!-- 下一站大卡 -->
      <div v-if="nextStop" class="card visual mb-6 overflow-hidden p-6" :style="{ '--vg1': '#F7DFE7', '--vg2': '#EFE6F7' }">
        <p class="mb-1 flex items-center gap-2 text-[12px] font-bold tracking-wider text-primary">
          <i class="fa-solid fa-location-arrow" aria-hidden="true"></i>下一站
        </p>
        <h3 class="visual-title text-[24px] font-bold leading-snug">{{ nextStop.place }}</h3>
        <p class="visual-sub mt-1 text-[13px]">
          <i class="fa-regular fa-clock mr-1" aria-hidden="true"></i>{{ nextStop.time || '全天' }}
          <span v-if="nextStop.note"> · {{ nextStop.note }}</span>
        </p>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <a class="btn btn-primary" :href="navTo(nextStop)" target="_blank" rel="noopener">
            <i class="fa-solid fa-location-arrow" aria-hidden="true"></i>立即导航
          </a>
          <BaseButton variant="soft" icon="fa-person-walking-arrow-right" @click="travel = true">进入出行模式</BaseButton>
          <span v-if="nextStopIndex >= 0" class="chip chip-plain">当天第 {{ nextStopIndex + 1 }}/{{ stops.length }} 站</span>
        </div>
      </div>
      <div v-else class="card mb-6 p-6 text-center">
        <i class="fa-solid fa-flag-checkered text-[22px] text-primary" aria-hidden="true"></i>
        <p class="mt-2 text-[15px] font-semibold text-ink">今天的行程都走完啦</p>
        <p class="muted mt-1 text-[12.5px]">好好休息,明天继续 ♪</p>
      </div>

      <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <!-- 当日行程 -->
        <div class="card p-5 lg:col-span-2">
          <h3 class="mb-3 flex flex-wrap items-center gap-2 text-[14px] font-bold text-ink">
            <i class="fa-solid fa-route text-primary" aria-hidden="true"></i>
            {{ isToday ? '今日' : '当日' }}行程
            <span class="muted text-[11.5px] font-normal">{{ activeDay ? fmtDay(activeDay.date, true) : '' }}</span>
            <span v-if="activeDay?.title" class="chip chip-plain">{{ activeDay.title }}</span>
          </h3>
          <p v-if="!stops.length" class="muted py-4 text-center text-[12.5px]">这一天还没有安排地点</p>
          <ol v-else class="space-y-2">
            <li
              v-for="(x, i) in stops"
              :key="x.id"
              class="flex items-center gap-3 rounded-[12px] px-3.5 py-2.5 transition-colors"
              :class="stopStatus(x) === 'next' ? 'bg-primary/10 ring-1 ring-primary/40' : stopStatus(x) === 'passed' ? 'bg-surface-2/50 opacity-70' : 'bg-surface-2/60'"
            >
              <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" :class="stopStatus(x) === 'next' ? 'bg-primary' : 'bg-muted'">{{ i + 1 }}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-[13.5px] text-ink">
                  <b class="font-semibold">{{ x.time || '全天' }}</b> {{ x.place }}
                  <span v-if="x.stay_role" class="ml-1 text-[11px] text-primary">🏨 酒店</span>
                </p>
                <p v-if="x.note" class="truncate text-[11.5px] text-muted">{{ x.note }}</p>
              </div>
              <span v-if="stopStatus(x) === 'next'" class="chip chip-brand !text-[11px]">下一站</span>
              <span v-else-if="stopStatus(x) === 'passed'" class="chip chip-plain !text-[11px]">已过</span>
              <a class="icon-btn !h-8 !w-8" :href="navTo(x)" target="_blank" rel="noopener" title="导航">
                <i class="fa-solid fa-location-arrow text-[12px]" aria-hidden="true"></i>
              </a>
            </li>
          </ol>
        </div>

        <!-- 侧栏:住宿 / 待办 / 提醒 -->
        <div class="space-y-6">
          <div v-if="dayHotel" class="card p-5">
            <h3 class="mb-2 flex items-center gap-2 text-[13.5px] font-bold text-ink">
              <i class="fa-solid fa-hotel text-primary" aria-hidden="true"></i>今晚住哪
            </h3>
            <p class="text-[14px] font-semibold text-ink">{{ dayHotel.name }}</p>
            <p class="muted mt-0.5 text-[12px]">{{ dayHotel.address || '地址待补充' }}</p>
            <a v-if="dayHotel.phone" class="mt-1 inline-block text-[12.5px] font-semibold text-primary" :href="`tel:${dayHotel.phone}`">{{ dayHotel.phone }}</a>
          </div>

          <div class="card p-5">
            <h3 class="mb-2 flex items-center gap-2 text-[13.5px] font-bold text-ink">
              <i class="fa-solid fa-list-check text-primary" aria-hidden="true"></i>当日待办
            </h3>
            <p v-if="!dayTodos.length" class="muted text-[12px]">今天没有指定待办</p>
            <ul v-else class="space-y-2">
              <li v-for="t in dayTodos" :key="t.id" class="flex items-center gap-2">
                <button
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all"
                  :class="myDone(t) ? 'border-primary bg-primary text-white' : 'border-line text-transparent'"
                  :disabled="!canEdit"
                  @click="toggleTodo(t)"
                >
                  <i class="fa-solid fa-check text-[10px]" aria-hidden="true"></i>
                </button>
                <span class="text-[13px]" :class="myDone(t) ? 'text-muted line-through' : 'text-ink-soft'">{{ t.title }}</span>
              </li>
            </ul>
          </div>

          <div v-if="dayReminders.length" class="card p-5">
            <h3 class="mb-2 flex items-center gap-2 text-[13.5px] font-bold text-ink">
              <i class="fa-solid fa-bell text-amber" aria-hidden="true"></i>当日提醒
            </h3>
            <ul class="space-y-2">
              <li v-for="r in dayReminders" :key="r.id" class="flex items-start gap-2">
                <span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber"></span>
                <span class="min-w-0 flex-1 text-[13px] text-ink-soft">{{ r.title }}<span class="muted"> {{ r.time?.slice(0, 5) }}</span></span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </template>

    <!-- 出行模式全屏 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="travel" class="fixed inset-0 z-[95] flex flex-col bg-page">
          <header class="flex items-center justify-between px-5 py-4" style="padding-top: max(14px, env(safe-area-inset-top))">
            <div>
              <p class="text-[12px] font-semibold text-muted">{{ plan.name }}</p>
              <p class="text-[16px] font-bold text-ink">{{ isToday ? '今日出行' : '下一程' }} · 第 {{ activeIndex + 1 }} 天</p>
            </div>
            <button class="btn btn-ghost btn-sm" @click="travel = false"><i class="fa-solid fa-xmark" aria-hidden="true"></i>退出</button>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
            <div v-if="nextStop" class="card visual p-6" :style="{ '--vg1': '#F7DFE7', '--vg2': '#EFE6F7' }">
              <p class="mb-1 text-[13px] font-bold tracking-wider text-primary"><i class="fa-solid fa-location-arrow mr-1" aria-hidden="true"></i>下一站</p>
              <h2 class="visual-title text-[30px] font-bold leading-tight">{{ nextStop.place }}</h2>
              <p class="visual-sub mt-2 text-[16px]"><i class="fa-regular fa-clock mr-1" aria-hidden="true"></i>{{ nextStop.time || '全天' }}</p>
              <p v-if="nextStop.note" class="visual-sub mt-1 text-[14px]">{{ nextStop.note }}</p>
              <a class="btn btn-primary btn-block mt-5 !py-4 text-[17px]" :href="navTo(nextStop)" target="_blank" rel="noopener">
                <i class="fa-solid fa-location-arrow" aria-hidden="true"></i>立即导航
              </a>
            </div>
            <p v-else class="card p-8 text-center text-[16px] font-semibold text-ink">今天的行程都走完啦 ♪</p>

            <h3 class="mb-2 mt-6 text-[14px] font-bold text-ink">全天行程</h3>
            <ol class="space-y-2">
              <li v-for="(x, i) in stops" :key="x.id" class="flex items-center gap-3 rounded-[12px] bg-surface-2/60 px-4 py-3">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" :class="x.id === nextStop?.id ? 'bg-primary' : 'bg-muted'">{{ i + 1 }}</span>
                <span class="min-w-0 flex-1 text-[15px] text-ink"><b>{{ x.time || '全天' }}</b> {{ x.place }}</span>
                <a class="icon-btn" :href="navTo(x)" target="_blank" rel="noopener"><i class="fa-solid fa-location-arrow" aria-hidden="true"></i></a>
              </li>
            </ol>
          </div>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>
