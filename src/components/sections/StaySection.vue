<script setup>
// ============================================================
// 食宿安排:卡片展示 餐厅/酒店 名称、地址、电话与标签
// 桌面端两列网格;支持预订状态开关与标签快速编辑
// ============================================================
import { ref, computed, reactive } from 'vue'
import { useContentStore } from '@/stores/content'
import { useAuthStore } from '@/stores/auth'
import { eachDayISO, fmtDay } from '@/utils/date'
import BaseModal from '@/components/ui/BaseModal.vue'
import Avatar from '@/components/ui/Avatar.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import GeoPlacePicker from '@/components/ui/GeoPlacePicker.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { toast } from '@/composables/toast'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const store = useContentStore()
const auth = useAuthStore()

const stays = computed(() => store.rowsOf(props.plan.id, 'stays'))
const bookedCount = computed(() => stays.value.filter((s) => s.booked).length)
const foodCount = computed(() => stays.value.filter((s) => s.type === 'food').length)

const PRESET_TAGS = ['免费停车', '含早', '人均¥100', '可带宠物']

/** 某条食宿归属的多个 Day 序号(兼容旧的单个 day 字段) */
function daysOf(s) {
  if (Array.isArray(s.days) && s.days.length) return s.days
  return s.day ? [s.day] : []
}

/* 类型维度:住宿 / 餐厅 分开看 */
const typeFilter = ref('all') // all | stay | food
const baseStays = computed(() =>
  typeFilter.value === 'all' ? stays.value : stays.value.filter((s) => s.type === typeFilter.value)
)

/* Day 分组:第 N 天 = 出发日偏移 N-1;day=0 表示未定日 */
const plannedDates = computed(() =>
  props.plan.start_date && props.plan.end_date ? eachDayISO(props.plan.start_date, props.plan.end_date) : []
)
const dayGroups = computed(() =>
  plannedDates.value
    .map((date, i) => ({
      day: i + 1,
      label: `Day ${i + 1} · ${fmtDay(date, false)}`,
      items: baseStays.value.filter((s) => daysOf(s).includes(i + 1))
    }))
    .filter((g) => g.items.length)
)
const noDayItems = computed(() => baseStays.value.filter((s) => !daysOf(s).length))
const filterDay = ref(null) // null=全部,0=未定日,N=第 N 天
const groupsForShow = computed(() => {
  const groups = dayGroups.value.filter((g) => filterDay.value === null || g.day === filterDay.value)
  if (filterDay.value === null || filterDay.value === 0) {
    if (noDayItems.value.length) groups.push({ day: 0, label: '未定日', items: noDayItems.value })
  }
  return groups
})

// —— 新增 / 编辑弹窗
const showEdit = ref(false)
const editingId = ref(null) // null = 新增
const saving = ref(false)
const form = reactive({ type: 'stay', name: '', geo: null, phone: '', tags: [], booked: false, tagInput: '', assignee: null, days: [], link: '' })

const participants = computed(() => (props.plan.members || []).slice())

/* ---------------- 票选与选定(选定后同步进当天路线) ---------------- */
const me = computed(() => ({ id: auth.user?.id || null, name: auth.user?.name || '' }))

function mineVote(s) {
  return (s.votes || []).some((v) => (me.value.id && v.id === me.value.id) || (!me.value.id && v.name === me.value.name))
}

async function toggleVote(s) {
  if (!props.canEdit || !me.value.name) return
  await store.voteStay(props.plan.id, s.id, me.value, !mineVote(s))
}

function chosenDayText(s) {
  const n = daysOf(s)[0]
  if (!n || !plannedDates.value[n - 1]) return ''
  return `第 ${n} 天 ${fmtDay(plannedDates.value[n - 1], false)}`
}

async function confirmStay(s) {
  if (!props.canEdit) return
  const r = await store.chooseStay(props.plan.id, s.id, me.value, true)
  if (r?.ok) toast(`已选定「${s.name}」并加入${chosenDayText(s)}路线`)
  else if (r?.reason === 'no_coord') toast('这家还没有精确定位 —— 先「编辑」并用选点器选到准确位置,才能同步进路线')
  else if (r?.reason === 'no_day') toast('请先把这家安排到具体某一天,才能同步进路线')
}

async function unconfirmStay(s) {
  if (!props.canEdit) return
  await store.chooseStay(props.plan.id, s.id, null, false)
  toast('已取消选定,路线中的该地点已移除')
}

/** 地址 → 高德/国内地图检索链接 */
function mapUrl(address) {
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(address)}`
}

function openAdd() {
  editingId.value = null
  Object.assign(form, { type: 'stay', name: '', geo: null, phone: '', tags: [], booked: false, tagInput: '', assignee: null, days: [], link: '' })
  showEdit.value = true
}

function openEdit(item) {
  editingId.value = item.id
  Object.assign(form, {
    type: item.type,
    name: item.name,
    geo:
      typeof item.latitude === 'number' && typeof item.longitude === 'number'
        ? { name: item.address || item.name, label: item.address, lat: item.latitude, lng: item.longitude }
        : { name: item.address || '', lat: null, lng: null },
    phone: item.phone,
    tags: [...(item.tags || [])],
    booked: item.booked,
    tagInput: '',
    assignee: item.assignee || null,
    days: daysOf(item),
    link: item.link || ''
  })
  showEdit.value = true
}

/** 多天入住:切换某天的选中状态 */
function toggleDay(n) {
  const i = form.days.indexOf(n)
  if (i === -1) form.days.push(n)
  else form.days.splice(i, 1)
  form.days.sort((a, b) => a - b)
}

function toggleTag(t) {
  const i = form.tags.indexOf(t)
  if (i === -1) form.tags.push(t)
  else form.tags.splice(i, 1)
}

function addCustomTag() {
  const t = form.tagInput.trim()
  if (!t || form.tags.includes(t)) return
  form.tags.push(t)
  form.tagInput = ''
}

async function save() {
  if (!form.name.trim() || saving.value) return
  saving.value = true
  try {
    const payload = {
      type: form.type,
      name: form.name.trim(),
      address: form.geo?.name?.trim() || '',
      latitude: form.geo?.lat ?? null,
      longitude: form.geo?.lng ?? null,
      phone: form.phone.trim(),
      tags: form.tags,
      booked: form.booked,
      assignee: form.assignee,
      day: form.days[0] ?? null,
      days: [...form.days],
      link: form.link.trim()
    }
    if (editingId.value) await store.updateStay(props.plan.id, editingId.value, payload)
    else await store.addStay(props.plan.id, payload)
    toast('食宿已保存')
    showEdit.value = false
  } finally {
    saving.value = false
  }
}

async function toggleBooked(item) {
  await store.updateStay(props.plan.id, item.id, { booked: !item.booked })
}

function tagTone(tag) {
  if (tag.startsWith('人均') || tag.includes('¥')) return 'amber'
  return 'plain'
}
</script>

<template>
  <section>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="title-1 flex items-center gap-3">
          <i class="fa-solid fa-bed text-[19px] text-primary" aria-hidden="true"></i>
          食宿安排
          <span class="chip chip-brand">{{ stays.length }} 家</span>
          <span class="chip chip-success">{{ bookedCount }} 已预订</span>
          <span class="chip chip-amber">{{ foodCount }} 家餐厅</span>
        </h2>
        <p class="muted mt-1">酒店与餐厅分卡片收纳,电话一键拨打</p>
      </div>
      <BaseButton v-if="canEdit" icon="fa-plus" @click="openAdd">添加食宿</BaseButton>
    </div>

    <!-- Day 分组标题与切换 -->
    <template v-if="baseStays.length">
    <!-- 住宿 / 餐厅分开看 -->
    <div class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="t in [
          { key: 'all', label: '全部', icon: 'fa-layer-group' },
          { key: 'stay', label: `住宿 · ${stays.filter((s) => s.type === 'stay').length}`, icon: 'fa-hotel' },
          { key: 'food', label: `餐厅 · ${stays.filter((s) => s.type === 'food').length}`, icon: 'fa-utensils' }
        ]"
        :key="t.key"
        class="chip cursor-pointer transition-all duration-150 active:scale-95"
        :class="typeFilter === t.key ? 'chip-brand' : 'chip-plain'"
        @click="typeFilter = t.key"
      >
        <i :class="`fa-solid ${t.icon}`" aria-hidden="true"></i>{{ t.label }}
      </button>
    </div>

    <div class="mb-4 flex flex-wrap gap-2">
      <button
        class="chip cursor-pointer transition-all duration-150 active:scale-95"
        :class="filterDay === null ? 'chip-brand' : 'chip-plain'"
        @click="filterDay = null"
      >全部日期 · {{ baseStays.length }}</button>
      <button
        v-for="g in dayGroups"
        :key="g.day"
        class="chip cursor-pointer whitespace-nowrap transition-all duration-150 active:scale-95"
        :class="filterDay === g.day ? 'chip-brand' : 'chip-plain'"
        @click="filterDay = filterDay === g.day ? null : g.day"
      >
        {{ g.label }} · {{ g.items.length }}
      </button>
      <button
        v-if="noDayItems.length"
        class="chip chip-amber cursor-pointer whitespace-nowrap transition-all duration-150 active:scale-95"
        :class="filterDay === 0 ? '!bg-rose/20 !text-rose' : ''"
        @click="filterDay = filterDay === 0 ? null : 0"
      >未定日 · {{ noDayItems.length }}</button>
    </div>

    <!-- 两列网格(≥768px 并排),按 Day 严格分组展示 -->
    <div>
      <template v-for="g in groupsForShow" :key="'g' + g.day">
        <p class="mb-3 flex items-center gap-3 text-[13.5px] font-bold text-ink">
          <span
            class="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
            :class="g.day === 0 ? 'bg-muted' : 'bg-primary'"
          >{{ g.day === 0 ? '·' : g.day }}</span>
          {{ g.label }}
          <span class="h-px flex-1 bg-line"></span>
        </p>
        <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
          <article
            v-for="s in g.items"
            :key="s.id"
            class="card card-lift group flex flex-col p-6 transition-all duration-250"
            :class="s.chosen ? 'ring-2 ring-primary/70 shadow-pop' : ''"
          >
          <header class="mb-4 flex items-start justify-between gap-3">
            <div class="flex items-center gap-3">
              <span
                class="flex h-11 w-11 items-center justify-center rounded-2xl text-[17px]"
                :class="s.type === 'food' ? 'bg-amber/20 text-amber' : 'bg-primary/10 text-primary'"
              >
                <i :class="`fa-solid ${s.type === 'food' ? 'fa-utensils' : 'fa-hotel'}`" aria-hidden="true"></i>
              </span>
              <div class="flex flex-wrap items-center gap-2">
                <BaseTag :tone="s.type === 'food' ? 'amber' : 'brand'">
                  {{ s.type === 'food' ? '餐厅' : '住宿' }}
                </BaseTag>
                <BaseTag v-if="s.booked" tone="success" icon="fa-circle-check">已预订</BaseTag>
                <BaseTag v-else tone="plain">待预订</BaseTag>
                <BaseTag v-if="s.chosen" tone="success" icon="fa-check-double">已选定 · 已入路线</BaseTag>
              </div>
            </div>
            <div class="flex gap-1">
              <button v-if="canEdit" class="icon-btn" aria-label="编辑" @click="openEdit(s)">
                <i class="fa-solid fa-pen" aria-hidden="true"></i>
              </button>
              <button v-if="canEdit" class="icon-btn icon-btn-danger" aria-label="删除" @click="store.removeStay(plan.id, s.id)">
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
              </button>
            </div>
          </header>

          <h3 class="mb-3 text-[16px] font-semibold leading-snug text-ink">{{ s.name }}</h3>

          <div class="muted mb-1.5 flex items-start gap-2.5 text-[13px]">
            <i class="fa-solid fa-location-dot mt-0.5 text-[12px]" aria-hidden="true"></i>
            <a
              v-if="s.address"
              class="flex-1 font-medium text-ink-soft underline decoration-line underline-offset-2 transition-colors hover:text-primary"
              :href="mapUrl(s.address)"
              target="_blank"
              rel="noopener"
              title="在高德地图中查看"
            >
              {{ s.address }}
              <i class="fa-solid fa-arrow-up-right-from-square ml-0.5 text-[9px]" aria-hidden="true"></i>
            </a>
            <span v-else class="flex-1">{{ '地址待补充' }}</span>
          </div>
          <div v-if="s.phone" class="mb-1.5 flex items-center gap-2.5 text-[13px]">
            <i class="fa-solid fa-phone text-[12px] text-primary" aria-hidden="true"></i>
            <a class="font-medium text-primary hover:underline" :href="`tel:${s.phone}`">{{ s.phone }}</a>
          </div>
          <div v-if="s.link" class="mb-1.5 flex items-center gap-2.5 text-[13px]">
            <i class="fa-solid fa-arrow-up-right-from-square text-[11px] text-primary" aria-hidden="true"></i>
            <a class="font-semibold text-primary hover:underline" :href="s.link" target="_blank" rel="noopener">
              去预订 / 查看详情
            </a>
          </div>
          <div v-if="s.assignee" class="mb-1.5 flex items-center gap-2 text-[12.5px] text-ink-soft">
            <i class="fa-solid fa-user-check text-[11px] text-primary/70" aria-hidden="true"></i>
            负责:<Avatar :name="s.assignee.name" :size="18" :ring="false" class="ml-1" />{{ s.assignee.name }}
          </div>

          <div v-if="s.tags?.length" class="mb-4 flex flex-wrap gap-2">
            <BaseTag v-for="t in s.tags" :key="t" :tone="tagTone(t)">{{ t }}</BaseTag>
          </div>

          <!-- 票选 -->
          <div class="mb-4 rounded-[14px] bg-surface-2/70 px-4 py-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="flex items-center gap-2 text-[12.5px] font-semibold text-ink-soft">
                <i class="fa-solid fa-hand text-[11px] text-primary/70" aria-hidden="true"></i>
                成员票选
                <span v-if="s.votes?.length" class="chip chip-brand !px-2 !py-0 text-[10.5px]">{{ s.votes.length }} 票</span>
              </p>
              <button
                v-if="canEdit && me.name"
                type="button"
                class="chip cursor-pointer transition-all duration-150 active:scale-95"
                :class="mineVote(s) ? 'chip-brand' : 'chip-plain hover:!bg-primary/10'"
                @click="toggleVote(s)"
              >
                <i :class="mineVote(s) ? 'fa-solid fa-check mr-1' : 'fa-regular fa-hand-point-up mr-1'" aria-hidden="true"></i>
                {{ mineVote(s) ? '已投 · 取消' : '投一票' }}
              </button>
            </div>
            <div v-if="s.votes?.length" class="mt-2 flex flex-wrap items-center gap-1.5">
              <span v-for="v in s.votes.slice(0, 8)" :key="v.id || v.name" class="chip chip-plain !px-1.5 !py-0.5" :title="v.name">
                <Avatar :name="v.name" :size="16" :ring="false" />
                <span class="max-w-[64px] truncate">{{ v.name }}</span>
              </span>
              <span v-if="s.votes.length > 8" class="muted text-[11px]">+{{ s.votes.length - 8 }} 人</span>
            </div>
            <p v-else class="mt-1 text-[11.5px] text-muted">还没有人投票,来投出第一票</p>

            <!-- 选定(→同步进路线) -->
            <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2.5">
              <p class="min-w-0 text-[11px] leading-4 text-muted">
                <template v-if="s.chosen">
                  <i class="fa-solid fa-circle-check mr-1 text-primary" aria-hidden="true"></i>
                  已加入{{ chosenDayText(s) }}路线
                </template>
                <template v-else>
                  <i class="fa-solid fa-lightbulb mr-1 text-amber" aria-hidden="true"></i>
                  全队票完后由一人选定,自动同步进当天路线
                </template>
              </p>
              <div v-if="canEdit" class="flex items-center gap-1.5">
                <button
                  v-if="!s.chosen"
                  type="button"
                  class="btn btn-primary btn-sm !px-3"
                  :title="s.day ? '' : '需先安排到具体某一天'"
                  @click="confirmStay(s)"
                >
                  <i class="fa-solid fa-check-double mr-1" aria-hidden="true"></i>选定并入路线
                </button>
                <button v-else type="button" class="btn btn-ghost btn-sm !px-3" @click="unconfirmStay(s)">
                  <i class="fa-solid fa-rotate-left mr-1" aria-hidden="true"></i>取消选定
                </button>
              </div>
            </div>
          </div>


          <footer class="mt-auto flex items-center justify-between border-t border-line/70 pt-4">
            <span class="muted text-[12px]">预订状态</span>
            <!-- 预订开关(围观者只读) -->
            <button
              v-if="canEdit"
              type="button"
              role="switch"
              :aria-checked="s.booked"
              class="relative h-7 w-12 rounded-full transition-colors duration-250 ease-out"
              :class="s.booked ? 'bg-primary' : 'bg-surface-2'"
              @click="toggleBooked(s)"
            >
              <span
                class="absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm transition-all duration-250 ease-out"
                :class="s.booked ? 'left-[22px]' : 'left-0.5'"
              >
                <i v-if="s.booked" class="fa-solid fa-check text-[10px] text-primary" style="animation: check-pop 0.3s ease-out both" aria-hidden="true"></i>
              </span>
            </button>
            <span v-else class="chip" :class="s.booked ? 'chip-success' : 'chip-plain'">
              <span v-if="s.booked" class="dot"></span>{{ s.booked ? '已预订' : '未预订' }}
            </span>
          </footer>
        </article>
        </div>
      </template>
    </div>
    </template>


    <EmptyState
      v-else
      icon="fa-hotel"
      title="还没有食宿安排"
      desc="把订好的民宿、想吃的馆子都放进来,预订状态一目了然"
    >
      <BaseButton v-if="canEdit" icon="fa-plus" @click="openAdd">添加第一家</BaseButton>
    </EmptyState>

    <!-- 编辑弹窗 -->
    <BaseModal v-model="showEdit" :title="editingId ? '编辑食宿' : '添加食宿'" :max-width="'500px'">
      <div class="space-y-5">
        <div>
          <label class="flabel">类型</label>
          <div class="flex gap-2">
            <button
              v-for="t in [{ key: 'stay', label: '住宿', icon: 'fa-hotel' }, { key: 'food', label: '餐厅', icon: 'fa-utensils' }]"
              :key="t.key"
              type="button"
              class="chip cursor-pointer !px-4 !py-2 transition-all duration-200 ease-out active:scale-95"
              :class="form.type === t.key ? 'chip-brand' : 'chip-plain'"
              @click="form.type = t.key"
            >
              <i :class="`fa-solid ${t.icon}`" aria-hidden="true"></i>{{ t.label }}
            </button>
          </div>
        </div>
        <div>
          <label class="flabel">入住 / 就餐的日期(可多选,支持连住多天)</label>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="chip transition-all duration-150 active:scale-95"
              :class="form.days.length === 0 ? 'chip-brand' : 'chip-plain'"
              @click="form.days = []"
            >未定日</button>
            <button
              v-for="(d, i) in plannedDates"
              :key="d"
              type="button"
              class="chip transition-all duration-150 active:scale-95"
              :class="form.days.includes(i + 1) ? 'chip-brand' : 'chip-plain'"
              @click="toggleDay(i + 1)"
            >第{{ i + 1 }}天 · {{ fmtDay(d, false) }}</button>
          </div>
          <p v-if="form.days.length > 1" class="muted mt-1.5 text-[11.5px]">
            <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>已选 {{ form.days.length }} 天,将在这几天的行程里都显示
          </p>
        </div>
        <div>
          <label class="flabel">名称 *</label>
          <input v-model="form.name" class="field" placeholder="酒店 / 餐厅名称" maxlength="40" />
        </div>
        <div>
          <label class="flabel">地址 / 位置(选择候选可精确定位,用于一键导航)</label>
          <GeoPlacePicker v-model="form.geo" :hint="plan.start_city" placeholder="输入地址并选择准确位置,如:屯溪区延安路 8 号" />
        </div>
        <div>
          <label class="flabel">预订电话</label>
          <input v-model="form.phone" class="field" type="tel" placeholder="用于一键拨打" />
        </div>
        <div>
          <label class="flabel">预订 / 详情链接(可选)</label>
          <input
            v-model="form.link"
            class="field"
            type="url"
            placeholder="粘贴大众点评 / 携程 / 去哪儿 / 美团等链接,一键跳转"
          />
          <p class="muted mt-1.5 text-[11.5px]">
            <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>保存后卡片上会出现「去预订」按钮,点开直达对应页面
          </p>
        </div>
        <div>
          <label class="flabel">负责成员(可选,用于人员分配)</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="p in participants"
              :key="p.id"
              type="button"
              class="chip transition-all duration-150 active:scale-95"
              :class="form.assignee?.id === p.id ? 'chip-brand' : 'chip-plain opacity-70'"
              @click="form.assignee = form.assignee?.id === p.id ? null : { id: p.id, name: p.name }"
            >
              <Avatar :name="p.name" :size="18" :ring="false" />{{ p.name }}
            </button>
          </div>
        </div>
        <div>
          <label class="flabel">标签(点击切换)</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="t in PRESET_TAGS"
              :key="t"
              type="button"
              class="chip transition-all duration-200 ease-out active:scale-95"
              :class="form.tags.includes(t) ? 'chip-brand' : 'chip-plain'"
              @click="toggleTag(t)"
            >
              {{ t }}
            </button>
            <span v-for="t in form.tags.filter((x) => !PRESET_TAGS.includes(x))" :key="t">
              <span class="chip chip-brand">{{ t }}</span>
            </span>
          </div>
          <div class="mt-3 flex gap-2">
            <input v-model="form.tagInput" class="field flex-1 !py-2 text-[13px]" placeholder="自定义标签,如 人均¥85" @keyup.enter="addCustomTag" />
            <BaseButton variant="soft" size="sm" @click="addCustomTag">添加</BaseButton>
          </div>
        </div>
        <label class="flex cursor-pointer items-center justify-between gap-4 rounded-[12px] bg-surface-2/70 px-4 py-3">
          <span class="flex items-center gap-2.5 text-[13.5px] font-semibold text-ink-soft">
            <i class="fa-solid fa-circle-check text-primary" aria-hidden="true"></i>
            已预订
          </span>
          <input v-model="form.booked" type="checkbox" class="h-4 w-4 accent-[#B75973]" />
        </label>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="showEdit = false">取消</BaseButton>
        <BaseButton icon="fa-check" :disabled="!form.name.trim()" :loading="saving" @click="save">
          {{ editingId ? '保存修改' : '添加' }}
        </BaseButton>
      </template>
    </BaseModal>
  </section>
</template>
