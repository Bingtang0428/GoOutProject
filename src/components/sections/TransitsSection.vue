<script setup>
// ============================================================
// 大交通企划 —— 大家从五湖四海来,先各自到集合点,再一起出发
//  - 支持一次给多名队员绑定同一段行程(到达/离开分开绑定)
//  - 时间为必填(到达=到达当地时刻 / 离开=离开当地时刻)
//  - 顶部按时间线展示谁先到、谁后到及间隔
// ============================================================
import { ref, reactive, computed, watch } from 'vue'
import { useContentStore } from '@/stores/content'
import { usePresenceStore } from '@/stores/presence'
import { fmtDay } from '@/utils/date'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Avatar from '@/components/ui/Avatar.vue'
import CityInput from '@/components/ui/CityInput.vue'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const store = useContentStore()
const presence = usePresenceStore()

const transits = computed(() =>
  store.rowsOf(props.plan.id, 'transits').slice().sort((a, b) => (a.leg_date + a.time).localeCompare(b.leg_date + b.time))
)

/** 参与协作的人(创建者+参与者,不含围观者) */
const people = computed(() => {
  const list = [...(props.plan.members || [])]
  if (props.plan.owner_id && !list.some((m) => m.id === props.plan.owner_id)) {
    const owner = [...(props.plan.viewers || []), ...list].find((m) => m.id === props.plan.owner_id)
    if (owner) list.unshift(owner)
  }
  return list
})

const MODES = [
  { key: 'flight', icon: 'fa-plane', label: '飞机' },
  { key: 'train', icon: 'fa-train-subway', label: '高铁/火车' },
  { key: 'bus', icon: 'fa-bus', label: '大巴' },
  { key: 'car', icon: 'fa-car-side', label: '自驾' },
  { key: 'other', icon: 'fa-ellipsis', label: '其他' }
]
const modeOf = (k) => MODES.find((m) => m.key === k) || MODES[4]

/* ---------- 时间线:谁先到/谁后到/间隔 ---------- */
const tsOf = (t) => new Date(`${t.leg_date}T${(t.time || '00:00')}:00`).getTime()
function withGaps(list) {
  const sorted = list.slice().sort((a, b) => tsOf(a) - tsOf(b))
  return sorted.map((t, i) => ({
    ...t,
    gapMin: i ? Math.round((tsOf(t) - tsOf(sorted[i - 1])) / 60000) : null
  }))
}
const arrivals = computed(() => withGaps(transits.value.filter((t) => t.direction === 'in')))
const departures = computed(() => withGaps(transits.value.filter((t) => t.direction === 'out')))

function fmtGap(min) {
  if (min == null) return ''
  if (min <= 0) return '几乎同时'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `晚 ${h} 小时${m ? ` ${m} 分` : ''}` : `晚 ${m} 分钟`
}

/** 模式总览:哪些人需要跨城大交通,各自怎么到 */
const summary = computed(() => {
  const by = { flight: 0, train: 0, bus: 0, car: 0, other: 0 }
  const planned = new Set()
  const notPlanned = people.value.filter((p) => !transits.value.some((t) => t.person?.id === p.id && t.direction === 'in'))
  for (const t of transits.value) {
    if (t.direction !== 'in') continue
    planned.add(t.person?.id)
    by[t.mode] = (by[t.mode] || 0) + 1
  }
  const keys = Object.keys(by).filter((k) => by[k] > 0)
  const needExternal = people.value.filter((p) => {
    const inTr = transits.value.find((t) => t.person?.id === p.id && t.direction === 'in')
    return inTr && inTr.mode !== 'car'
  })
  return { by: keys.map((k) => ({ ...modeOf(k), count: by[k] })), plannedCount: planned.size, needExternal, notPlanned }
})

const legsOf = (personId, direction) => transits.value.filter((t) => t.person?.id === personId && t.direction === direction)

function personStatus(p) {
  if (p.id === props.plan.owner_id) return '创建者 · 自驾从集合点出发'
  const ins = legsOf(p.id, 'in')
  if (!ins.length) return '未补充到达方式'
  const cars = ins.filter((t) => t.mode === 'car')
  return cars.length ? '自驾,可与其他队员拼车' : '需大交通到达'
}

/* ---------- 接驳任务自动闭环 ---------- */
function pickupTodo(t) {
  const todos = store.rowsOf(props.plan.id, 'todos')
  const key = `[接站] 接 ${t.person?.name || ''}`
  return todos.find((x) => x.title.startsWith(key)) || null
}
async function createPickup(t) {
  if (pickupTodo(t)) return
  const suffix = []
  if (t.ref_no) suffix.push(t.ref_no)
  if (t.from_city && t.to_city) suffix.push(`${t.from_city} → ${t.to_city}`)
  await store.addTodo(props.plan.id, {
    title: `[接站] 接 ${t.person?.name || ''}${suffix.length ? '(' + suffix.join(' ') + ')' : ''}`,
    due: t.leg_date || null
  })
}

/* ---------- 编辑弹窗 ---------- */
const showForm = ref(false)
const saving = ref(false)
watch(showForm, (v) => presence.setEditing(v ? 'transit' : null))
const editing = ref(null) // 编辑的 transit | null 新增
const form = reactive({
  personIds: [], direction: 'in', mode: 'train',
  from_city: '', to_city: '', leg_date: '', time: '', ref_no: '', note: ''
})

function openAdd(person) {
  editing.value = null
  Object.assign(form, {
    personIds: person ? [person.id] : [],
    direction: 'in', mode: 'train', from_city: '', to_city: '',
    leg_date: props.plan.start_date, time: '', ref_no: '', note: ''
  })
  // ★ 创建者设置的「集合城市」自动带入为默认到达地(到达段)/出发地(离开段)
  form.to_city = props.plan.start_city || ''
  showForm.value = true
}

function openEdit(t) {
  editing.value = t
  Object.assign(form, {
    personIds: t.person?.id ? [t.person.id] : [],
    direction: t.direction, mode: t.mode,
    from_city: t.from_city, to_city: t.to_city, leg_date: t.leg_date,
    time: t.time, ref_no: t.ref_no, note: t.note
  })
  showForm.value = true
}

function togglePerson(p) {
  if (editing.value) {
    form.personIds = [p.id] // 编辑时只能改单人
    return
  }
  const i = form.personIds.indexOf(p.id)
  if (i === -1) form.personIds.push(p.id)
  else form.personIds.splice(i, 1)
}

/** 切换到达/离开:新行程下把集合城市带入未填写的对应端 */
function switchDirection(d) {
  if (form.direction === d) return
  form.direction = d
  if (!editing.value) {
    if (d === 'in' && !form.to_city) form.to_city = props.plan.start_city || ''
    if (d === 'out' && !form.from_city) form.from_city = props.plan.start_city || ''
  }
}

const canSave = computed(() => form.personIds.length > 0 && form.leg_date && form.time)

async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true
  try {
    const base = {
      direction: form.direction,
      mode: form.mode,
      from_city: form.from_city.trim(),
      to_city: form.to_city.trim(),
      leg_date: form.leg_date,
      time: form.time,
      ref_no: form.ref_no.trim(),
      note: form.note.trim()
    }
    if (editing.value) {
      const p = people.value.find((x) => x.id === form.personIds[0])
      await store.updateTransit(props.plan.id, editing.value.id, {
        ...base,
        person: { id: form.personIds[0], name: p?.name || editing.value.person?.name || '' }
      })
    } else {
      // 一键绑定:给每位选中队员写入该段(同方向已有则覆盖,避免重复)
      for (const pid of form.personIds) {
        const p = people.value.find((x) => x.id === pid)
        if (!p) continue
        const existing = transits.value.find((t) => t.person?.id === pid && t.direction === form.direction)
        const payload = { ...base, person: { id: p.id, name: p.name } }
        if (existing) await store.updateTransit(props.plan.id, existing.id, payload)
        else await store.addTransit(props.plan.id, payload)
      }
    }
    showForm.value = false
  } finally {
    saving.value = false
  }
}

const DIR_META = {
  in: { text: '到达', icon: 'fa-arrow-right-to-bracket', tone: 'brand' },
  out: { text: '离开', icon: 'fa-arrow-right-from-bracket', tone: 'amber' }
}
</script>

<template>
  <section>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="title-1 flex flex-wrap items-center gap-3">
          <i class="fa-solid fa-plane-departure text-[19px] text-primary" aria-hidden="true"></i>
          大交通企划
          <span v-if="presence.editors('transit').length" class="chip chip-amber" :title="presence.editors('transit').map((e) => e.name).join('、')">
            <span class="dot"></span>{{ presence.editors('transit').map((e) => e.name).join('、') }} 正在编辑
          </span>
        </h2>
        <p class="muted mt-1">天南地北先到集合点 —— 每个人怎么来、怎么走,一目了然</p>
      </div>
      <BaseButton v-if="canEdit" icon="fa-plus" @click="openAdd(null)">添加行程</BaseButton>
    </div>

    <!-- 总览 -->
    <div class="card mb-6 p-5">
      <div class="flex flex-wrap items-center gap-x-8 gap-y-3">
        <span class="chip chip-plain !px-3 !py-2">
          <i class="fa-solid fa-users mr-1 text-primary" aria-hidden="true"></i>
          {{ people.length }} 名队员
        </span>
        <span v-if="summary.notPlanned.length" class="chip chip-amber">
          <span class="dot"></span>{{ summary.notPlanned.length }} 人待补到达方案
        </span>
        <span v-else class="chip chip-success">全部到达方案已就绪</span>
        <span class="text-[12.5px] text-muted">
          <template v-for="(m, i) in summary.by" :key="m.key">
            <template v-if="i">·</template>
            <i :class="`fa-solid ${m.icon}`" class="mx-1 text-primary/70" aria-hidden="true"></i>{{ m.label }} {{ m.count }} 人
          </template>
        </span>
      </div>
      <p v-if="summary.needExternal.length" class="mt-3 flex flex-wrap gap-2 text-[12.5px]">
        <i class="fa-solid fa-lightbulb mt-0.5 text-amber" aria-hidden="true"></i>
        <span>建议:{{ summary.needExternal.map((p) => p.name).join('、') }} 从外地来,可安排首日接驳/留房</span>
      </p>
    </div>

    <!-- 到达 / 离开 时间线 -->
    <div class="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div class="card p-5">
        <h3 class="mb-3 flex items-center gap-2 text-[14px] font-bold text-ink">
          <i class="fa-solid fa-arrow-right-to-bracket text-primary" aria-hidden="true"></i>
          到达时间线
          <span class="muted text-[11.5px] font-normal">(到达当地时刻,越靠前越早到)</span>
        </h3>
        <p v-if="!arrivals.length" class="muted py-3 text-center text-[12.5px]">还没有到达安排</p>
        <ol v-else class="space-y-2">
          <li v-for="(t, i) in arrivals" :key="t.id" class="flex items-center gap-3 rounded-[12px] bg-surface-2/60 px-3.5 py-2.5">
            <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">{{ i + 1 }}</span>
            <Avatar :name="t.person?.name" :size="26" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13px] text-ink">
                <b class="font-semibold">{{ t.person?.name }}</b>
                <span class="muted"> {{ t.from_city || '?' }} → {{ t.to_city || '集合点' }}</span>
              </p>
              <p class="muted text-[11.5px]">
                <i :class="`fa-solid ${modeOf(t.mode).icon}`" aria-hidden="true"></i>
                {{ fmtDay(t.leg_date, true) }} <b class="text-primary">{{ t.time }}</b>
                <span v-if="t.ref_no"> · {{ t.ref_no }}</span>
              </p>
            </div>
            <span v-if="t.gapMin != null" class="chip chip-amber shrink-0 !text-[11px]">{{ fmtGap(t.gapMin) }}</span>
            <span v-else class="chip chip-success shrink-0 !text-[11px]">最早到</span>
          </li>
        </ol>
      </div>

      <div class="card p-5">
        <h3 class="mb-3 flex items-center gap-2 text-[14px] font-bold text-ink">
          <i class="fa-solid fa-arrow-right-from-bracket text-amber" aria-hidden="true"></i>
          离开时间线
          <span class="muted text-[11.5px] font-normal">(离开当地时刻,越靠前越早走)</span>
        </h3>
        <p v-if="!departures.length" class="muted py-3 text-center text-[12.5px]">还没有离开安排</p>
        <ol v-else class="space-y-2">
          <li v-for="(t, i) in departures" :key="t.id" class="flex items-center gap-3 rounded-[12px] bg-surface-2/60 px-3.5 py-2.5">
            <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber text-[11px] font-bold text-white">{{ i + 1 }}</span>
            <Avatar :name="t.person?.name" :size="26" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13px] text-ink">
                <b class="font-semibold">{{ t.person?.name }}</b>
                <span class="muted"> {{ t.from_city || '集合点' }} → {{ t.to_city || '?' }}</span>
              </p>
              <p class="muted text-[11.5px]">
                <i :class="`fa-solid ${modeOf(t.mode).icon}`" aria-hidden="true"></i>
                {{ fmtDay(t.leg_date, true) }} <b class="text-amber">{{ t.time }}</b>
                <span v-if="t.ref_no"> · {{ t.ref_no }}</span>
              </p>
            </div>
            <span v-if="t.gapMin != null" class="chip chip-amber shrink-0 !text-[11px]">{{ fmtGap(t.gapMin) }}</span>
            <span v-else class="chip chip-success shrink-0 !text-[11px]">最早走</span>
          </li>
        </ol>
      </div>
    </div>

    <!-- 按人分组展示(每人 到达/离开 两段) -->
    <div v-if="people.length" class="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      <TransitionGroup name="fade-up-list" tag="div" class="contents">
        <article v-for="p in people" :key="p.id" class="card card-lift flex flex-col p-5">
          <header class="mb-4 flex items-center gap-3">
            <Avatar :name="p.name" :size="34" :color="p.color" :seed="p.id" />
            <div class="min-w-0">
              <p class="truncate text-[14.5px] font-semibold text-ink">{{ p.name }}</p>
              <p class="text-[11.5px] text-muted">{{ personStatus(p) }}</p>
            </div>
            <span class="ml-auto text-[11.5px] text-muted">
              已规划 {{ legsOf(p.id, 'in').length + legsOf(p.id, 'out').length }}/2
            </span>
          </header>

          <!-- 到达 -->
          <div v-for="leg in legsOf(p.id, 'in')" :key="leg.id" class="mb-2">
            <div class="group flex items-center gap-3 rounded-[12px] bg-surface-2/60 px-3.5 py-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                <i :class="`fa-solid ${modeOf(leg.mode).icon}`" aria-hidden="true"></i>
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-[13px] leading-snug text-ink">
                  <span class="font-semibold">{{ leg.from_city || '?' }}</span>
                  <i class="fa-solid fa-arrow-right mx-1 text-[10px] text-primary/60" aria-hidden="true"></i>
                  <span class="font-semibold">{{ leg.to_city || leg.person?.name }}</span>
                  <span class="muted ml-1">{{ leg.ref_no || '' }}</span>
                </p>
                <p class="text-[11.5px] text-muted">
                  {{ fmtDay(leg.leg_date, true) }} {{ leg.time }}{{ leg.note ? ' · ' + leg.note : '' }}
                </p>
              </div>
              <BaseTag tone="brand" icon="fa-arrow-down">到达</BaseTag>
              <div v-if="canEdit" class="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <button class="icon-btn !h-6 !w-6" title="编辑" @click="openEdit(leg)"><i class="fa-solid fa-pen text-[10px]" aria-hidden="true"></i></button>
                <button class="icon-btn icon-btn-danger !h-6 !w-6" title="删除" @click="store.removeTransit(plan.id, leg.id)"><i class="fa-solid fa-xmark text-[10px]" aria-hidden="true"></i></button>
              </div>
            </div>
            <div v-if="canEdit && leg.mode !== 'car'" class="mt-1 flex items-center gap-2 px-2">
              <span v-if="pickupTodo(leg)" class="chip chip-success !text-[11px]">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                已生成接站任务{{ pickupTodo(leg).done ? ' · 已完成' : '' }}
              </span>
              <button v-else class="chip chip-brand cursor-pointer !text-[11px] transition-all duration-150 active:scale-95" @click="createPickup(leg)">
                <i class="fa-solid fa-hands-holding-child" aria-hidden="true"></i>生成接站任务
              </button>
            </div>
          </div>

          <!-- 离开 -->
          <div v-for="leg in legsOf(p.id, 'out')" :key="leg.id" class="mb-2">
            <div class="group flex items-center gap-3 rounded-[12px] bg-surface-2/60 px-3.5 py-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-amber/15 text-amber">
                <i :class="`fa-solid ${modeOf(leg.mode).icon}`" aria-hidden="true"></i>
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-[13px] leading-snug text-ink">
                  <span class="font-semibold">{{ leg.from_city || '?' }}</span>
                  <i class="fa-solid fa-arrow-right mx-1 text-[10px] text-amber" aria-hidden="true"></i>
                  <span class="font-semibold">{{ leg.to_city || leg.person?.name }}</span>
                  <span class="muted ml-1">{{ leg.ref_no || '' }}</span>
                </p>
                <p class="text-[11.5px] text-muted">
                  {{ fmtDay(leg.leg_date, true) }} {{ leg.time }}{{ leg.note ? ' · ' + leg.note : '' }}
                </p>
              </div>
              <BaseTag tone="amber" icon="fa-arrow-up">离开</BaseTag>
              <div v-if="canEdit" class="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <button class="icon-btn !h-6 !w-6" title="编辑" @click="openEdit(leg)"><i class="fa-solid fa-pen text-[10px]" aria-hidden="true"></i></button>
                <button class="icon-btn icon-btn-danger !h-6 !w-6" title="删除" @click="store.removeTransit(plan.id, leg.id)"><i class="fa-solid fa-xmark text-[10px]" aria-hidden="true"></i></button>
              </div>
            </div>
          </div>

          <div v-if="!legsOf(p.id, 'in').length && !legsOf(p.id, 'out').length" class="mb-2 flex items-center justify-between rounded-[12px] border border-dashed border-line px-3.5 py-3 text-[12.5px] text-muted">
            还未规划大交通
            <button v-if="canEdit" class="chip chip-brand cursor-pointer" @click="openAdd(p)"><i class="fa-solid fa-plus" aria-hidden="true"></i>添加</button>
          </div>
        </article>
      </TransitionGroup>
    </div>

    <EmptyState
      v-else
      icon="fa-plane"
      title="还没有任何交通安排"
      desc="大家从不同城市出发?每人一段「到达/离开」,集合接送一目了然"
    >
      <BaseButton v-if="canEdit" icon="fa-plus" @click="openAdd(null)">添加第一段</BaseButton>
    </EmptyState>

    <!-- 新增 / 编辑弹窗 -->
    <BaseModal v-model="showForm" :title="editing ? '编辑大交通' : '添加大交通'" :max-width="'520px'">
      <div class="space-y-5">
        <div>
          <label class="flabel">
            哪位队员 *(可多选,一键绑定同样行程{{ editing ? ',编辑时仅一人' : '' }})
          </label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="p in people"
              :key="p.id"
              type="button"
              class="chip transition-all duration-200 ease-out active:scale-95"
              :class="form.personIds.includes(p.id) ? 'chip-brand' : 'chip-plain opacity-70'"
              @click="togglePerson(p)"
            >
              <i v-if="form.personIds.includes(p.id)" class="fa-solid fa-check text-[10px]" aria-hidden="true"></i>
              <Avatar :name="p.name" :size="18" :ring="false" :color="p.color" :seed="p.id" />{{ p.name }}
            </button>
          </div>
          <p v-if="form.personIds.length > 1" class="muted mt-1.5 text-[11.5px]">
            <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>将为这 {{ form.personIds.length }} 名队员绑定同一段行程
          </p>
        </div>

        <div class="flex gap-2">
          <button
            v-for="d in [{ key: 'in', text: '到达(集合)' }, { key: 'out', text: '离开(返程)' }]"
            :key="d.key"
            type="button"
            class="chip flex-1 cursor-pointer !px-4 !py-2.5 text-center"
            :class="form.direction === d.key ? 'chip-brand' : 'chip-plain'"
            @click="switchDirection(d.key)"
          >
            {{ d.text }}
          </button>
        </div>

        <div>
          <label class="flabel">交通方式</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="m in MODES"
              :key="m.key"
              type="button"
              class="chip transition-all duration-200 ease-out active:scale-95"
              :class="form.mode === m.key ? 'chip-brand' : 'chip-plain'"
              @click="form.mode = m.key"
            >
              <i :class="`fa-solid ${m.icon}`" aria-hidden="true"></i>{{ m.label }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label class="flabel">{{ form.direction === 'in' ? '出发城市(家)' : '出发地点(集合点)' }}</label>
            <CityInput v-model="form.from_city" :placeholder="form.direction === 'in' ? '所在城市' : '集合城市'" />
          </div>
          <div>
            <label class="flabel">{{ form.direction === 'in' ? '到达地(集合点)' : '目的地(家)' }}</label>
            <CityInput v-model="form.to_city" :placeholder="form.direction === 'in' ? '集合城市' : '回家的方向'" />
          </div>
        </div>
        <p v-if="plan.start_city" class="muted text-[11.5px]">
          <i class="fa-solid fa-route mr-1 text-amber" aria-hidden="true"></i>
          创建者设置的集合城市「{{ plan.start_city }}」已自动带入,可按自己的行程修改
        </p>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="flabel">日期 *</label>
            <input v-model="form.leg_date" type="date" class="field" />
          </div>
          <div>
            <label class="flabel">{{ form.direction === 'in' ? '到达时间(当地)*' : '离开时间(当地)*' }}</label>
            <input v-model="form.time" type="time" class="field" />
          </div>
        </div>

        <div>
          <label class="flabel">班次 / 航班号(可选)</label>
          <input v-model="form.ref_no" class="field" placeholder="例如 G7311 / MU9137 / 大巴 07:30" />
        </div>

        <div>
          <label class="flabel">备注(可选)</label>
          <input v-model="form.note" class="field" placeholder="是否需要接站、拼车、寄存行李…" />
        </div>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="showForm = false">取消</BaseButton>
        <BaseButton icon="fa-check" :disabled="!canSave" :loading="saving" @click="save">
          {{ editing ? '保存修改' : (form.personIds.length > 1 ? `绑定 ${form.personIds.length} 人` : '加入安排') }}
        </BaseButton>
      </template>
    </BaseModal>
  </section>
</template>

<style scoped>
@media (hover: none) {
  :deep(.opacity-0) { opacity: 1; }
}
</style>
