<script setup>
// ============================================================
// 计划详情页
// - 桌面(≥768):左侧全局侧边栏常驻,主区顶部展示计划标题/日期,
//   内容卡片两列排布(食宿 / 待办 等模块)
// - 移动端(<768):底部固定 5 Tab 切换五大模块,顶部毛玻璃导航
// 顶部导航随滚动由透明渐变为半透明白(useScroll)
// ============================================================
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useHead } from '@vueuse/head'
import { usePlansStore } from '@/stores/plans'
import { useContentStore } from '@/stores/content'
import { pastelOf } from '@/utils/misc'
import { fmtRange, planDays, todayISO, relKey } from '@/utils/date'
import DesktopSidebar from '@/components/layout/DesktopSidebar.vue'
import MobileTopNav from '@/components/layout/MobileTopNav.vue'
import MobileTabBar from '@/components/layout/MobileTabBar.vue'
import PlanFormModal from '@/components/home/PlanFormModal.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import Avatar from '@/components/ui/Avatar.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import AvatarStack from '@/components/ui/AvatarStack.vue'
import RouteSection from '@/components/sections/RouteSection.vue'
import StaySection from '@/components/sections/StaySection.vue'
import TodoSection from '@/components/sections/TodoSection.vue'
import GuideSection from '@/components/sections/GuideSection.vue'
import ReminderSection from '@/components/sections/ReminderSection.vue'
import BillSection from '@/components/sections/BillSection.vue'
import { supabase, isSupabase } from '@/api/supabase'
import TransitsSection from '@/components/sections/TransitsSection.vue'
import PlanPermModal from '@/components/plan/PlanPermModal.vue'
import ExportSheet from '@/components/plan/ExportSheet.vue'
import ReportSheet from '@/components/plan/ReportSheet.vue'
import MemorySheet from '@/components/plan/MemorySheet.vue'
import IssuesSheet from '@/components/plan/IssuesSheet.vue'

const plansStore = usePlansStore()
const contentStore = useContentStore()
const router = useRouter()
const route = useRoute()

// —— 依据路由参数定位计划
const plan = computed(() => plansStore.plans.find((p) => p.id === route.params.id) || null)

useHead({
  title: computed(() => (plan.value ? `${plan.value.name} · 兔兔同行` : '计划详情 · 兔兔同行'))
})

// —— 区块:以 URL query.sec 作为唯一状态,方便底部 Tab/桌面胶囊互相同步
const SECTIONS = [
  { key: 'route', icon: 'fa-route', label: '路线规划' },
  { key: 'stay', icon: 'fa-bed', label: '食宿安排' },
  { key: 'todo', icon: 'fa-list-check', label: '待办清单' },
  { key: 'guide', icon: 'fa-bookmark', label: '收藏攻略' },
  { key: 'reminder', icon: 'fa-bell', label: '提醒事项' },
  { key: 'bill', icon: 'fa-scale-balanced', label: '分账' },
  { key: 'transit', icon: 'fa-plane-departure', label: '大交通' }
]

// ★ 权限:当前用户在该计划中的角色与写权限
const myRole = computed(() => plansStore.myRole(plan.value))
const canEdit = computed(() => plansStore.canEditContent(plan.value))
const isOwner = computed(() => myRole.value === 'owner')

const roleChip = computed(() => {
  return {
    owner: { tone: 'brand', text: '我是创建者' },
    member: { tone: 'success', text: '我是参与者' },
    viewer: { tone: 'plain', text: '我是围观者(只读)' }
  }[myRole.value] || null
})

const activeSec = computed(() => {
  const q = route.query.sec
  return SECTIONS.some((s) => s.key === q) ? q : 'route'
})

function goSec(key) {
  if (key === activeSec.value) return
  router.replace({ path: `/plan/${route.params.id}`, query: key === 'route' ? {} : { sec: key } })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// —— 计划内容载入 + 实时订阅(切计划时释放旧通道)
// 覆盖三种场景:URL 直达(需先 init)、路由切换计划、计划日期区间被编辑
let prevPlanId = null
async function loadPlan() {
  await plansStore.init() // 保证计划列表已就绪(深度链接直达时也安全)
  if (!plan.value) {
    router.replace('/')
    return
  }
  plansStore.setCurrent(plan.value.id)
  if (prevPlanId && prevPlanId !== plan.value.id) contentStore.detachRemote(prevPlanId)
  prevPlanId = plan.value.id
  await contentStore.ensureLoaded(plan.value)
  await contentStore.ensureDayRows(plan.value) // 日期区间变化时补齐每日占位
}
watch(
  [() => route.params.id, () => plan.value?.start_date, () => plan.value?.end_date],
  loadPlan,
  { immediate: true, flush: 'post' }
)

// —— 概要统计(用于计划头部小徽标)
const stats = computed(() => {
  const id = plan.value?.id
  if (!id) return {}
  const days = contentStore.rowsOf(id, 'days')
  const destCount = days.reduce((n, d) => n + (d.destinations?.length || 0), 0)
  const todos = contentStore.rowsOf(id, 'todos')
  const reminders = contentStore.rowsOf(id, 'reminders')
  return {
    days: days.length,
    dest: destCount,
    stays: contentStore.rowsOf(id, 'stays').length,
    bills: contentStore.rowsOf(id, 'bills').length,
    todoOpen: todos.filter((t) => !t.done).length,
    todoPct: todos.length ? Math.round((todos.filter((t) => t.done).length / todos.length) * 100) : 0,
    unread: reminders.filter((r) => !r.read && relKey(r.date) !== 'earlier').length
  }
})

// —— 编辑 / 删除 / 权限 / 导出 / 撤销 / 动态
const showForm = ref(false)
const showDelete = ref(false)
const showPerm = ref(false)
const showExport = ref(false)
const showLogs = ref(false)
const showReport = ref(false)
const showMemory = ref(false)
const showIssues = ref(false)
const planLogs = ref([])

async function loadPlanLogs() {
  if (!isSupabase || !plan.value) return
  const { data, error } = await supabase
    .from('plan_logs')
    .select('*')
    .eq('plan_id', plan.value.id)
    .order('at', { ascending: false })
    .limit(30)
  if (!error) planLogs.value = data || []
}

function openLogs() {
  planLogs.value = []
  showLogs.value = true
  loadPlanLogs()
}

function agoTxt(iso) {
  const d = new Date(iso)
  const diff = Math.max(0, (Date.now() - d.getTime()) / 60000)
  if (diff < 1) return '刚刚'
  if (diff < 60) return `${Math.floor(diff)} 分钟前`
  if (diff < 1440) return `${Math.floor(diff / 60)} 小时前`
  if (diff < 10080) return `${Math.floor(diff / 1440)} 天前`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 条目级撤销浮层:删除操作会先在 content store 留下快照
const undoSnack = ref(null)
let undoTimer = null
watch(
  () => contentStore.lastDeleted,
  (v) => {
    clearTimeout(undoTimer)
    undoSnack.value = v
    if (v) undoTimer = setTimeout(() => (undoSnack.value = null), 7000)
  }
)
async function doUndo() {
  await contentStore.undoLast()
  undoSnack.value = null
}
onBeforeUnmount(() => clearTimeout(undoTimer))

function openEdit() {
  showForm.value = true
}

async function onSave(payload) {
  await plansStore.updatePlan(plan.value.id, payload)
}

async function doDelete() {
  const id = plan.value?.id
  await plansStore.removePlan(id)
  router.replace('/')
}

const gradStyle = computed(() => {
  const [a, b] = pastelOf(plan.value?.gradient)
  return { '--vg1': a, '--vg2': b }
})

const statusText = computed(() => {
  const t = todayISO()
  if (!plan.value) return ''
  if (plan.value.end_date < t) return '旅程已结束'
  if (plan.value.start_date > t) return `还有 ${Math.round((new Date(plan.value.start_date) - new Date()) / 86400000)} 天出发`
  return '行程进行中'
})

function backHome() {
  router.replace('/')
}

// 切页时释放订阅
onBeforeUnmount(() => {
  if (prevPlanId) contentStore.detachRemote(prevPlanId)
})
</script>

<template>
  <div class="min-h-dvh" v-if="plan">
    <DesktopSidebar />
    <MobileTopNav :back="true" :title="plan.name" :subtitle="fmtRange(plan.start_date, plan.end_date)" @back="backHome">
      <template #actions>
        <button v-if="isSupabase" class="icon-btn" aria-label="最近动态" @click="openLogs">
          <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
        </button>
        <button class="icon-btn" aria-label="旅行相册" @click="showMemory = true">
          <i class="fa-solid fa-images" aria-hidden="true"></i>
        </button>
        <button class="icon-btn" aria-label="导出行程单" @click="showExport = true">
          <i class="fa-solid fa-file-export" aria-hidden="true"></i>
        </button>
        <button v-if="isOwner" class="icon-btn" aria-label="成员与权限" @click="showPerm = true">
          <i class="fa-solid fa-user-shield" aria-hidden="true"></i>
        </button>
        <button v-if="isOwner" class="icon-btn" aria-label="编辑计划" @click="openEdit">
          <i class="fa-solid fa-pen" aria-hidden="true"></i>
        </button>
        <button v-if="isOwner" class="icon-btn icon-btn-danger" aria-label="删除计划" @click="showDelete = true">
          <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
        </button>
      </template>
    </MobileTopNav>

    <main class="min-h-dvh pb-[7.5rem] lg:pl-[280px] lg:pb-16">
      <div class="wrap pt-2 sm:pt-6">
        <!-- 计划头部 Hero:标题 / 日期 / 成员 -->
        <section class="card visual relative overflow-hidden p-5 sm:p-8" :style="gradStyle">
          <span class="pointer-events-none absolute -right-10 -top-14 h-48 w-48 rounded-full bg-white/30 blur-2xl" style="mix-blend-mode: overlay"></span>
          <div class="relative flex flex-wrap items-start justify-between gap-6">
            <div class="min-w-0 flex-1">
              <div class="mb-3 flex flex-wrap items-center gap-2">
                <span class="chip chip-plain" :style="{ background: 'rgba(255,255,255,0.55)' }">
                  <i class="fa-solid fa-location-dot text-[11px] text-primary" aria-hidden="true"></i>
                  {{ plan.destination || '目的地待定' }}
                </span>
                <span class="chip chip-plain" :style="{ background: 'rgba(255,255,255,0.55)' }">
                  <i class="fa-regular fa-calendar text-[11px]" aria-hidden="true"></i>
                  {{ fmtRange(plan.start_date, plan.end_date) }} · {{ planDays(plan.start_date, plan.end_date) }} 天
                </span>
              </div>
              <h1 class="visual-title mb-1 break-words text-[22px] font-bold leading-tight sm:text-[30px]">
                {{ plan.name }}
              </h1>
              <p class="visual-sub mb-3 text-[13px]">
                <i class="fa-regular fa-clock mr-1" aria-hidden="true"></i>{{ statusText }}
              </p>
              <div class="mb-3 flex items-center gap-3">
                <AvatarStack :users="plan.members" :size="30" :max="5" />
                <BaseTag v-if="roleChip" :tone="roleChip.tone" dot class="!py-1">
                  {{ roleChip.text }}
                </BaseTag>
              </div>
              <!-- 未加入的访客:可申请以参与者身份加入 -->
              <button
                v-if="!roleChip"
                class="chip chip-brand cursor-pointer !px-4 !py-2 transition-all duration-200 ease-out active:scale-95"
                style="background: rgba(255,255,255,0.75)"
                @click="plansStore.joinAsParticipant(plan.id)"
              >
                <i class="fa-solid fa-user-plus" aria-hidden="true"></i>
                加入这份计划(成为参与者)
              </button>
            </div>

            <!-- 桌面操作 -->
            <div class="hidden items-center gap-2 md:flex">
              <button v-if="isSupabase" class="btn btn-ghost btn-sm" style="background: rgba(255,255,255,0.6)" @click="openLogs">
                <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>最近动态
              </button>
              <button class="btn btn-ghost btn-sm" style="background: rgba(255,255,255,0.6)" @click="showIssues = true">
                <i class="fa-solid fa-stethoscope" aria-hidden="true"></i>体检
              </button>
              <button class="btn btn-ghost btn-sm" style="background: rgba(255,255,255,0.6)" @click="showReport = true">
                <i class="fa-solid fa-chart-pie" aria-hidden="true"></i>复盘
              </button>
              <button class="btn btn-ghost btn-sm" style="background: rgba(255,255,255,0.6)" @click="showExport = true">
                <i class="fa-solid fa-file-export" aria-hidden="true"></i>导出行程单
              </button>
              <button v-if="isOwner" class="btn btn-ghost btn-sm" style="background: rgba(255,255,255,0.6)" @click="showPerm = true">
                <i class="fa-solid fa-user-shield" aria-hidden="true"></i>成员与权限
              </button>
              <button v-if="isOwner" class="btn btn-ghost btn-sm" style="background: rgba(255,255,255,0.6)" @click="openEdit">
                <i class="fa-solid fa-pen" aria-hidden="true"></i>编辑计划
              </button>
              <button v-if="isOwner" class="btn btn-danger-soft btn-sm" @click="showDelete = true">
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i>删除
              </button>
            </div>
          </div>

          <!-- 概要统计小徽标 -->
          <div class="relative mt-6 flex flex-wrap gap-2">
            <button class="chip" style="background: rgba(255,255,255,0.6)" @click="goSec('route')">
              <i class="fa-solid fa-map-pin text-[11px] text-primary" aria-hidden="true"></i>{{ stats.dest || 0 }} 地点
            </button>
            <button class="chip" style="background: rgba(255,255,255,0.6)" @click="goSec('stay')">
              <i class="fa-solid fa-bed text-[11px] text-primary" aria-hidden="true"></i>{{ stats.stays || 0 }} 家
            </button>
            <button class="chip" style="background: rgba(255,255,255,0.6)" @click="goSec('todo')">
              <i class="fa-solid fa-circle-check text-[11px] text-primary" aria-hidden="true"></i>
              待办 {{ stats.todoPct || 0 }}%
            </button>
            <button class="chip" style="background: rgba(255,255,255,0.6)" @click="goSec('reminder')">
              <i class="fa-solid fa-bell text-[11px] text-amber" aria-hidden="true"></i>
              {{ stats.unread || 0 }} 条未读提醒
            </button>
            <button class="chip" style="background: rgba(255,255,255,0.6)" @click="goSec('bill')">
              <i class="fa-solid fa-scale-balanced text-[11px] text-primary" aria-hidden="true"></i>
              {{ stats.bills || 0 }} 笔分账
            </button>
          </div>
        </section>

        <!-- 桌面胶囊导航(移动端由底部 Tab 接管) -->
        <nav class="sticky top-0 z-30 -mx-1 mb-6 mt-8 hidden gap-2 overflow-x-auto px-1 py-3 md:flex" style="scrollbar-width: none">
          <div class="glass card flex gap-1 !rounded-pill !p-1.5" style="border-radius: 999px">
            <button
              v-for="s in SECTIONS"
              :key="s.key"
              class="flex items-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-[13.5px] font-semibold transition-all duration-250 ease-out active:scale-95"
              :class="activeSec === s.key ? 'bg-primary text-white shadow-[0_6px_18px_rgb(183_89_115/0.35)]' : 'text-ink-soft hover:bg-surface-2'"
              @click="goSec(s.key)"
            >
              <i :class="`fa-solid ${s.icon}`" class="text-[13px]" aria-hidden="true"></i>
              {{ s.label }}
            </button>
          </div>
        </nav>

        <!-- 模块主体:切换带 fade-up 过渡 -->
        <Transition name="fade-up" mode="out-in">
          <RouteSection :key="'route'" v-if="activeSec === 'route'" :plan="plan" :can-edit="canEdit" />
          <StaySection :key="'stay'" v-else-if="activeSec === 'stay'" :plan="plan" :can-edit="canEdit" />
          <TodoSection :key="'todo'" v-else-if="activeSec === 'todo'" :plan="plan" :can-edit="canEdit" />
          <GuideSection :key="'guide'" v-else-if="activeSec === 'guide'" :plan="plan" :can-edit="canEdit" />
          <ReminderSection :key="'reminder'" v-else-if="activeSec === 'reminder'" :plan="plan" :can-edit="canEdit" />
          <BillSection :key="'bill'" v-else-if="activeSec === 'bill'" :plan="plan" :can-edit="canEdit" />
          <TransitsSection :key="'transit'" v-else :plan="plan" :can-edit="canEdit" />
        </Transition>
      </div>
    </main>

    <!-- 移动端底部 Tab -->
    <MobileTabBar :active="activeSec" @change="goSec" />

    <!-- 撤销浮层(全局可见,仅本页删除操作触发) -->
    <Transition name="fade-up">
      <div
        v-if="undoSnack"
        class="card no-print fixed bottom-[7.2rem] left-1/2 z-[70] flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 px-5 py-3 lg:bottom-8"
        style="box-shadow: var(--shadow-pop)"
      >
        <i class="fa-solid fa-rotate-left text-primary" aria-hidden="true"></i>
        <p class="min-w-0 flex-1 truncate text-[13px] text-ink-soft">
          已删除「{{ undoSnack.label }}」
        </p>
        <button class="btn btn-soft btn-sm !px-3" @click="doUndo">撤销</button>
      </div>
    </Transition>

    <PlanFormModal v-model="showForm" :plan="plan" @save="onSave" />
    <PlanPermModal v-if="isOwner" v-model="showPerm" :plan="plan" />
    <ExportSheet v-model="showExport" :plan="plan" />
    <ReportSheet v-model="showReport" :plan="plan" />
    <MemorySheet v-model="showMemory" :plan="plan" :can-edit="canEdit" />
    <IssuesSheet v-model="showIssues" :plan="plan" />

    <!-- 最近动态 -->
    <BaseModal v-model="showLogs" title="最近动态" :max-width="'480px'">
      <p v-if="!isSupabase" class="muted py-6 text-center text-[13px]">动态日志仅在云端模式下记录</p>
      <ul v-else class="space-y-2">
        <li v-for="l in planLogs" :key="l.id" class="card flex items-start gap-3 px-4 py-3">
          <Avatar :name="l.actor?.name || '系统'" :size="30" />
          <div class="min-w-0 flex-1">
            <p class="text-[13.5px] text-ink-soft">
              <b class="font-semibold text-ink">{{ l.actor?.name || '系统' }}</b> {{ l.action }}
            </p>
            <p class="muted mt-0.5 text-[11.5px]">{{ agoTxt(l.at) }}</p>
          </div>
        </li>
        <li v-if="!planLogs.length" class="muted py-6 text-center text-[13px]">
          还没有变更记录 —— 成员新增/修改/删除内容后会显示在这里
        </li>
      </ul>
    </BaseModal>
    <ConfirmDialog
      v-model="showDelete"
      title="删除这份计划?"
      :message="`「${plan.name}」及其全部数据将被删除;本地演示模式下会先进入首页回收站,可一键恢复。`"
      confirm-text="删除计划"
      @confirm="doDelete"
    />
  </div>
</template>
