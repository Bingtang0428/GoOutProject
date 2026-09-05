<script setup>
// ============================================================
// 计划列表页(首页)
//  - 计划卡片:名称/日期/成员/完成度进度条/柔和渐变
//  - 顶部看板:对当前主计划展示 已规划日期 / 整体路线 /
//    下一站 / 下一项任务 / 今日提醒,可切换计划并一键跳转
//  - 权限:仅创建者可在卡片上编辑/删除;其余角色只读进入
// ============================================================
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useHead } from '@vueuse/head'
import { usePlansStore } from '@/stores/plans'
import { useContentStore } from '@/stores/content'
import { useAuthStore } from '@/stores/auth'
import { fmtRange, todayISO, relKey, fmtDay } from '@/utils/date'
import DesktopSidebar from '@/components/layout/DesktopSidebar.vue'
import MobileTopNav from '@/components/layout/MobileTopNav.vue'
import PlanCard from '@/components/home/PlanCard.vue'
import PlanFormModal from '@/components/home/PlanFormModal.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Avatar from '@/components/ui/Avatar.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import { isSupabase } from '@/api/supabase'

useHead({ title: '我的计划 · 兔兔同行自驾旅行企划' })

const plansStore = usePlansStore()
const contentStore = useContentStore()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const progressMap = ref({}) // planId -> {done,total,pct}
const today = todayISO()

/* ---------------- 计划卡片数据 ---------------- */
async function refreshProgress() {
  progressMap.value = await contentStore.loadProgress(plansStore.plans)
}

onMounted(() => {
  refreshAll()
  window.addEventListener('focus', refreshAll)
})

async function refreshAll() {
  await plansStore.init()
  refreshProgress()
}

watch(
  () => plansStore.plans.length,
  () => refreshProgress()
)

/* ---------------- 顶部看板(当前主计划) ---------------- */
const boardId = ref(null)
let boardPrev = null

const boardPlan = computed(() => plansStore.plans.find((p) => p.id === boardId.value) || null)

const board = computed(() => {
  if (!boardPlan.value) return null
  const id = boardPlan.value.id
  const days = [...contentStore.rowsOf(id, 'days')].sort((a, b) => a.date.localeCompare(b.date))
  const todos = contentStore.rowsOf(id, 'todos')
  const reminders = contentStore.rowsOf(id, 'reminders')
  const p = boardPlan.value

  const withDest = days.filter((d) => (d.destinations || []).length)
  const plannedDates = withDest.length
  const totalDates = days.length || 1

  // 整体路线:全部目的地按日期顺序首尾
  const all = []
  days.forEach((d) => (d.destinations || []).forEach((x) => all.push({ ...x, date: d.date })))
  const firstDest = all.find((x) => x.date >= today) || all[0]
  const lastDest = [...all].reverse()[0]

  // 下一项待完成任务:优先有截止日期且未到期,其次最早创建
  const open = todos.filter((t) => !t.done)
  const nextTodo = open
    .slice()
    .sort((a, b) => {
      if (!!a.due !== !!b.due) return a.due ? -1 : 1
      return (a.created_at || '').localeCompare(b.created_at || '')
    })[0]

  const todayUnread = reminders.filter((r) => !r.read && relKey(r.date) === 'today').length

  return {
    plan: p,
    plannedDates,
    totalDates,
    datePct: Math.round((plannedDates / totalDates) * 100),
    destCount: all.length,
    firstDest,
    lastDest,
    nextTodo,
    todayUnread
  }
})

function pickBoard(id) {
  boardId.value = id
}

// 切换主计划时载入其内容(便于看板统计);离开时释放远端通道
watch(boardId, async (id) => {
  const p = plansStore.plans.find((x) => x.id === id)
  if (!p) return
  if (boardPrev && boardPrev !== id) contentStore.detachRemote(boardPrev)
  boardPrev = id
  await contentStore.ensureLoaded(p)
})

watch(
  () => plansStore.plans.length,
  () => {
    if (!boardId.value && plansStore.plans.length) boardId.value = plansStore.plans[0].id
  }
)

onBeforeUnmount(() => {
  if (boardPrev) contentStore.detachRemote(boardPrev)
  window.removeEventListener('focus', refreshAll)
})

const goSec = (sec) =>
  router.push({ name: 'plan', params: { id: boardId.value }, query: sec === 'route' ? {} : { sec } })

/* ---------------- 问候 ---------------- */
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const todayText = computed(() => {
  const d = new Date()
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${d.toLocaleDateString('zh-CN', { weekday: 'long' })}`
})

/* ---------------- 新建 / 编辑 / 删除 ---------------- */
const showForm = ref(false)
const editingPlan = ref(null)
const deletingPlan = ref(null)
const showDeleteConfirm = ref(false)

watch(
  () => route.query.new,
  (v) => {
    if (v) {
      editingPlan.value = null
      showForm.value = true
      router.replace({ query: {} })
    }
  },
  { immediate: true }
)

function openCreate() {
  editingPlan.value = null
  showForm.value = true
}

function openEdit(plan) {
  editingPlan.value = plan
  showForm.value = true
}

async function onSave(payload) {
  if (editingPlan.value) {
    await plansStore.updatePlan(editingPlan.value.id, payload)
  } else {
    const p = await plansStore.createPlan(payload)
    router.push({ name: 'plan', params: { id: p.id } })
  }
  refreshAll()
}

function requestDelete(plan) {
  deletingPlan.value = plan
  showDeleteConfirm.value = true
}

async function onDelete() {
  await plansStore.removePlan(deletingPlan.value.id)
  deletingPlan.value = null
  showDeleteConfirm.value = false
  refreshAll()
}

function openPlan(id) {
  plansStore.setCurrent(id)
  router.push({ name: 'plan', params: { id } })
}

/** 是否创建者(决定卡片上编辑/删除入口) */
const isOwner = (p) => plansStore.myRole(p) === 'owner'

/* ---------------- 回收站 ---------------- */
const showTrash = ref(false)
function fmtTrashAt(entry) {
  const d = new Date(entry.at)
  const now = Date.now()
  const diff = Math.round((now - entry.at) / 86400000)
  const label = `${d.getMonth() + 1}月${d.getDate()}日`
  return diff <= 1 ? `今天` : `${diff} 天前(${label})`
}
async function restoreFromTrash(id) {
  await plansStore.restorePlan(id)
  refreshAll()
}
async function purgeOne(entry) {
  if (!confirm(`永久删除「${entry.name}」及其全部数据?此操作不可恢复。`)) return
  plansStore.purgePlan(entry.id)
}
</script>

<template>
  <div class="min-h-dvh">
    <DesktopSidebar />
    <MobileTopNav title="兔兔同行" subtitle="我的自驾计划" />

    <main class="min-h-dvh pb-24 lg:pl-[280px] lg:pb-12">
      <div class="wrap pt-2 sm:pt-4">
        <!-- 问候区 -->
        <section class="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <Avatar :name="auth.user?.name" :size="42" />
            <div>
              <h1 class="text-[19px] font-bold text-ink">{{ greeting }},{{ auth.user?.name }}</h1>
              <p class="muted text-[12.5px]">
                {{ todayText }}
                <span v-if="!isSupabase" class="chip chip-plain ml-1.5 !px-2 !py-0 !text-[11px]">本地演示</span>
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              v-if="auth.isAdmin"
              class="btn btn-ghost btn-sm !rounded-[12px] !px-4 !py-3"
              title="后台管理"
              @click="router.push('/admin')"
            >
              <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>后台
            </button>
            <button
              v-if="!isSupabase && plansStore.trash.length"
              class="icon-btn relative !h-10 !w-10 !rounded-[12px] bg-surface-2"
              title="回收站"
              @click="showTrash = true"
            >
              <i class="fa-solid fa-trash-can text-muted" aria-hidden="true"></i>
              <span class="chip chip-rose absolute -right-1.5 -top-1.5 !px-1.5 !py-0 !text-[10px]">
                {{ plansStore.trash.length }}
              </span>
            </button>
            <button class="btn btn-primary btn-sm !rounded-[12px] !px-5 !py-3" @click="openCreate">
              <i class="fa-solid fa-plus" aria-hidden="true"></i>新建计划
            </button>
          </div>
        </section>

        <!-- ════════ 首页看板 ════════ -->
        <section v-if="board" class="card p-6 sm:p-7">
          <div class="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-2.5">
              <i class="fa-solid fa-gauge-high text-[17px] text-primary" aria-hidden="true"></i>
              <h2 class="title-2">旅程看板</h2>
              <span class="chip chip-brand">{{ board.plan.name }}</span>
            </div>
            <div class="no-scrollbar -mx-2 flex gap-2 overflow-x-auto px-2 py-0.5">
              <button
                v-for="p in plansStore.plans"
                :key="p.id"
                class="chip shrink-0 cursor-pointer whitespace-nowrap transition-all duration-200 active:scale-95"
                :class="boardId === p.id ? 'ring-1 ring-primary/60 text-primary !bg-primary/10' : 'chip-plain opacity-70'"
                @click="pickBoard(p.id)"
              >
                {{ p.name }}
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <!-- 已完成规划日期 -->
            <button class="board-tile" @click="goSec('route')">
              <p class="board-tile-icon"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i></p>
              <p class="board-tile-label">已规划日期</p>
              <p class="board-tile-value">
                {{ board.plannedDates }} <span class="text-[13px] text-muted">/ {{ board.totalDates }} 天</span>
              </p>
              <ProgressBar :value="board.datePct" :height="6" />
              <p class="board-tile-hint">{{ board.datePct >= 100 ? '每一天都排好了' : board.datePct > 0 ? '还有空档可以安排' : '还没有排行程' }}</p>
            </button>

            <!-- 整体路线概览 -->
            <button class="board-tile" @click="goSec('route')">
              <p class="board-tile-icon"><i class="fa-solid fa-route" aria-hidden="true"></i></p>
              <p class="board-tile-label">整体路线 · {{ board.destCount }} 个地点</p>
              <p class="board-tile-value truncate text-[19px]">
                <template v-if="board.firstDest">{{ board.firstDest.place }} <i class="fa-solid fa-arrow-right mx-1 text-[12px] text-primary/60" aria-hidden="true"></i> {{ board.lastDest?.place || '' }}</template>
                <span v-else class="text-[15px] font-semibold text-muted">尚未规划</span>
              </p>
              <p class="board-tile-hint">{{ fmtDay(board.plan.start_date, false) }} 出发 · {{ board.plan.destination }}</p>
            </button>

            <!-- 下一站 -->
            <button class="board-tile" @click="goSec('route')">
              <p class="board-tile-icon"><i class="fa-solid fa-map-pin" aria-hidden="true"></i></p>
              <p class="board-tile-label">下一站({{ board.firstDest?.date ? fmtDay(board.firstDest.date) : '-' }})</p>
              <p class="board-tile-value truncate text-[19px]">
                <template v-if="board.firstDest">{{ board.firstDest.place }}</template>
                <span v-else class="text-[15px] font-semibold text-muted">待添加地点</span>
              </p>
              <p class="board-tile-hint truncate">{{ board.firstDest?.time ? board.firstDest.time + ' 到' : '全天' }} {{ board.firstDest?.note || '' }}</p>
            </button>

            <!-- 下一项任务 & 提醒 -->
            <div class="space-y-3">
              <button class="board-tile flex-1" @click="goSec('todo')">
                <p class="board-tile-icon"><i class="fa-solid fa-list-check" aria-hidden="true"></i></p>
                <p class="board-tile-label">下一项待办任务</p>
                <p class="board-tile-value truncate text-[16px]">
                  {{ board.nextTodo ? board.nextTodo.title : '全部任务已完成' }}
                </p>
                <p class="board-tile-hint">
                  <span v-if="board.nextTodo?.due" class="chip mr-1 !px-2 !py-0 !text-[11px]" :class="relKey(board.nextTodo.due) === 'earlier' ? 'chip-rose' : relKey(board.nextTodo.due) === 'today' ? 'chip-amber' : 'chip-plain'">
                    {{ relKey(board.nextTodo.due) === 'earlier' ? '已到期' : relKey(board.nextTodo.due) === 'today' ? '今天' : fmtDay(board.nextTodo.due, false) }} 截止
                  </span>
                  <span v-else-if="!board.nextTodo">行程没有遗漏的小事了</span>
                  <span v-else>未设截止日</span>
                </p>
              </button>
              <button
                v-if="board.todayUnread"
                class="board-tile flex flex-row items-center gap-3 !py-3"
                @click="goSec('reminder')"
              >
                <i class="fa-solid fa-bell text-[16px] text-amber" style="animation: pulse-soft 2s infinite" aria-hidden="true"></i>
                <span class="min-w-0 flex-1 text-left">
                  <span class="block text-[13px] font-semibold text-ink">今天有 {{ board.todayUnread }} 条未读提醒</span>
                  <span class="text-[11.5px] text-muted">点此查看</span>
                </span>
              </button>
            </div>
          </div>
        </section>

        <!-- 计划网格 -->
        <section v-if="plansStore.plans.length" class="mt-8">
          <h2 class="title-2 mb-4 flex items-center gap-2">
            全部计划
            <span class="muted text-[12.5px] font-normal">{{ plansStore.plans.length }} 份</span>
          </h2>
          <div class="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            <PlanCard
              v-for="p in plansStore.plans"
              :key="p.id"
              :plan="p"
              :progress="progressMap[p.id] || { done: 0, total: 0, pct: 0 }"
              :show-manage="isOwner(p)"
              @open="openPlan"
              @edit="openEdit"
              @delete="requestDelete"
            />
          </div>
        </section>

        <section v-else class="mt-8">
          <EmptyState icon="fa-route" title="还没有任何旅行计划" desc="新建一份计划,把路线、食宿、待办、攻略、提醒和分账都收进同一条时间线">
            <button class="btn btn-primary" @click="openCreate">
              <i class="fa-solid fa-plus" aria-hidden="true"></i>创建第一份计划
            </button>
          </EmptyState>
        </section>
      </div>
    </main>

    <PlanFormModal v-model="showForm" :plan="editingPlan" @save="onSave" />

    <!-- 回收站(本地模式) -->
    <BaseModal v-model="showTrash" title="回收站" :max-width="'560px'">
      <p class="muted mb-4 text-[12.5px]">
        删除的计划先进入回收站,内容完整保留,可随时恢复;彻底清空后不可找回。
      </p>
      <ul class="space-y-2">
        <li v-for="t in plansStore.trash" :key="t.id" class="card flex items-center gap-4 px-5 py-3.5">
          <Avatar :name="t.name" :size="34" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-[14px] font-semibold text-ink">{{ t.name }}</p>
            <p class="text-[11.5px] text-muted">{{ t.plan?.destination }} · {{ fmtRange(t.plan?.start_date, t.plan?.end_date) }} · {{ fmtTrashAt(t) }}删除</p>
          </div>
          <BaseButton variant="soft" size="sm" icon="fa-rotate-left" @click="restoreFromTrash(t.id)">恢复</BaseButton>
          <button class="icon-btn icon-btn-danger" title="永久删除" @click="purgeOne(t)">
            <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
          </button>
        </li>
      </ul>
      <p v-if="!plansStore.trash.length" class="muted py-6 text-center text-[13px]">回收站是空的</p>
      <template #footer>
        <BaseButton v-if="plansStore.trash.length" variant="danger-soft" size="sm" icon="fa-bomb" @click="plansStore.clearTrash()">
          清空回收站
        </BaseButton>
      </template>
    </BaseModal>

    <ConfirmDialog
      :model-value="showDeleteConfirm"
      @update:model-value="showDeleteConfirm = $event"
      title="删除这份计划?"
      :message="
        isSupabase
          ? `「${deletingPlan?.name}」将被永久删除,此操作不可恢复。`
          : `「${deletingPlan?.name}」将移入回收站,可在首页一键恢复。`
      "
      confirm-text="删除计划"
      @confirm="onDelete"
    />
  </div>
</template>

<style scoped>
.board-tile {
  @apply flex flex-col gap-1 rounded-[14px] bg-surface-2/60 p-4 text-left transition-all duration-250 ease-out;
}
@media (hover: hover) {
  .board-tile:hover {
    background: rgb(var(--c-primary) / 0.08);
    transform: translateY(-2px);
    box-shadow: var(--shadow-card-hover);
  }
}
.board-tile:active { transform: scale(0.97); }
.board-tile-icon { @apply mb-1 text-[13px] text-primary; }
.board-tile-label { @apply text-[11.5px] font-semibold tracking-wide text-muted; }
.board-tile-value { @apply text-[20px] font-bold text-ink leading-snug; }
.board-tile-hint { @apply mt-1 text-[11.5px] text-muted truncate; }
</style>
