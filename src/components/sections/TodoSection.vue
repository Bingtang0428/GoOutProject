<script setup>
// ============================================================
// TODO List:圆形自定义复选框 + 截止日期标签(小圆点)
// 完成时勾选圈旋转打勾、文字变灰加删除线(动画)
// ============================================================
import { ref, computed } from 'vue'
import { useContentStore } from '@/stores/content'
import { useAuthStore } from '@/stores/auth'
import { relKey, fmtDay, eachDayISO } from '@/utils/date'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseCheckbox from '@/components/ui/BaseCheckbox.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import Avatar from '@/components/ui/Avatar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { toast } from '@/composables/toast'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const store = useContentStore()
const auth = useAuthStore()

const todos = computed(() => store.rowsOf(props.plan.id, 'todos'))
const filter = ref('all') // all | open | done | mine
const newTitle = ref('')
const showAdd = ref(false)
const newDue = ref('')
const pickDueFor = ref(null) // 正在内联设置截止日期的任务 id
const assignFor = ref(null) // 正在指派负责人的任务 id

const participants = computed(() => (props.plan.members || []).slice())
const me = computed(() => auth.user || {})

/* Day 归属(第 N 天 = 出发日偏移 N-1) */
const plannedDates = computed(() =>
  props.plan.start_date && props.plan.end_date ? eachDayISO(props.plan.start_date, props.plan.end_date) : []
)
const filterDay = ref(null) // null=全部,0=未定,N=第 N 天
const newDay = ref(null)

/** 判断某任务是否属于我(按 id 或昵称) */
const isMine = (t) => {
  const a = t.assignee
  return a && (a.id === me.value.id || a.name === me.value.name)
}

const filtered = computed(() => {
  const list = todos.value.slice()
  list.sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1
    return 0
  })
  if (filter.value === 'open') return list.filter((t) => !t.done)
  if (filter.value === 'done') return list.filter((t) => t.done)
  if (filter.value === 'mine') return list.filter((t) => isMine(t))
  if (filterDay.value !== null) {
    if (filterDay.value === 0) return list.filter((t) => !t.day)
    return list.filter((t) => t.day === filterDay.value)
  }
  return list
})

const doneCount = computed(() => todos.value.filter((t) => t.done).length)
const pct = computed(() => (todos.value.length ? Math.round((doneCount.value / todos.value.length) * 100) : 0))

async function add() {
  const title = newTitle.value.trim()
  if (!title) return
  await store.addTodo(props.plan.id, { title, due: newDue.value || null, day: newDay.value })
  toast('任务已添加')
  showAdd.value = false
}

function openAdd() {
  newTitle.value = ''
  newDue.value = ''
  newDay.value = null
  showAdd.value = true
}

function dueTone(due) {
  if (!due) return 'plain'
  const k = relKey(due)
  if (k === 'earlier') return 'rose'
  if (k === 'today') return 'amber'
  return 'plain'
}

function dueText(due) {
  if (!due) return ''
  const k = relKey(due)
  if (k === 'earlier') return '已到期'
  if (k === 'today') return '今天'
  if (k === 'tomorrow') return '明天'
  return fmtDay(due, false)
}

function countOfDay(n) {
  return todos.value.filter((t) => (n === 0 ? !t.day : t.day === n)).length
}

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '进行中' },
  { key: 'done', label: '已完成' },
  { key: 'mine', label: '我负责' }
]

function countOf(key) {
  if (key === 'open') return todos.value.filter((t) => !t.done).length
  if (key === 'done') return doneCount.value
  if (key === 'mine') return todos.value.filter((t) => isMine(t)).length
  return todos.value.length
}
</script>

<template>
  <section>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="title-1 flex items-center gap-3">
          <i class="fa-solid fa-list-check text-[19px] text-primary" aria-hidden="true"></i>
          待办清单
          <span v-if="todos.length" class="chip chip-brand">{{ pct }}% 完成</span>
        </h2>
        <p class="muted mt-1">{{ doneCount }} / {{ todos.length }} 项已完成,协作成员的勾选实时同步</p>
      </div>
      <BaseButton v-if="canEdit" icon="fa-plus" @click="openAdd()">添加任务</BaseButton>
    </div>

    <div class="mx-auto max-w-2xl">
      <div v-if="todos.length" class="mb-5 flex flex-wrap items-center gap-2">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          class="chip cursor-pointer transition-all duration-200 ease-out active:scale-95"
          :class="filter === f.key ? 'chip-brand' : 'chip-plain'"
          @click="filter = f.key"
        >
          {{ f.label }} · {{ countOf(f.key) }}
        </button>
      </div>

      <!-- Day 分组切换 -->
      <div v-if="todos.length" class="mb-5 flex flex-wrap items-center gap-2">
        <button
          class="chip cursor-pointer transition-all duration-150 active:scale-95"
          :class="filterDay === null ? 'chip-brand' : 'chip-plain'"
          @click="filterDay = null"
        >全部日期 · {{ todos.length }}</button>
        <button
          v-for="(d, i) in plannedDates"
          :key="d"
          class="chip cursor-pointer whitespace-nowrap transition-all duration-150 active:scale-95"
          :class="filterDay === i + 1 ? 'chip-brand' : 'chip-plain'"
          @click="filterDay = filterDay === i + 1 ? null : i + 1"
        >
          Day {{ i + 1 }} · {{ fmtDay(d, false) }} · {{ countOfDay(i + 1) }}
        </button>
        <button
          v-if="countOfDay(0)"
          class="chip chip-amber cursor-pointer whitespace-nowrap transition-all duration-150 active:scale-95"
          :class="filterDay === 0 ? '!bg-rose/20 !text-rose' : ''"
          @click="filterDay = filterDay === 0 ? null : 0"
        >未定日 · {{ countOfDay(0) }}</button>
      </div>

      <div v-if="filtered.length" class="space-y-3">
        <TransitionGroup name="fade-up-list">
          <div
            v-for="t in filtered"
            :key="t.id"
            class="card flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-all duration-280 ease-out hover:shadow-card-hover active:scale-[0.985]"
          >
            <BaseCheckbox
              :model-value="t.done"
              :disabled="!canEdit"
              @update:model-value="(v) => store.setTodoDone(plan.id, t.id, v)"
            />
            <span
              class="min-w-0 flex-1 text-[14.5px] transition-all duration-300 ease-out"
              :class="t.done ? 'font-normal text-muted/80 line-through decoration-muted/60' : 'font-medium text-ink'"
            >
              {{ t.title }}
            </span>

            <!-- 负责人指派(分工):展开选择参与者 -->
            <template v-if="canEdit && assignFor === t.id">
              <div class="flex w-full flex-wrap items-center gap-1.5 pb-0.5 pl-[46px]">
                <span class="muted text-[11.5px]">指派给:</span>
                <button
                  v-for="p in participants"
                  :key="p.id"
                  type="button"
                  class="chip transition-all duration-150 active:scale-95"
                  :class="t.assignee?.id === p.id ? 'chip-brand' : 'chip-plain opacity-70'"
                  @click="store.setTodoAssignee(plan.id, t.id, t.assignee?.id === p.id ? null : { id: p.id, name: p.name }); assignFor = null"
                >
                  <Avatar :name="p.name" :size="18" :ring="false" />{{ p.name }}
                </button>
                <button
                  v-if="t.assignee"
                  class="chip chip-rose cursor-pointer !text-[11px]"
                  @click="store.setTodoAssignee(plan.id, t.id, null); assignFor = null"
                >
                  <i class="fa-solid fa-xmark" aria-hidden="true"></i>取消指派
                </button>
                <button class="chip chip-plain cursor-pointer !text-[11px]" @click="assignFor = null">完成</button>
              </div>
            </template>
            <button
              v-else
              type="button"
              class="chip shrink-0 transition-all duration-150 active:scale-95"
              :class="t.assignee ? 'chip-brand' : 'chip-plain'"
              :title="canEdit ? '点击指派负责人' : '负责人'"
              @click="canEdit ? (assignFor = t.id) : null"
            >
              <Avatar v-if="t.assignee" :name="t.assignee.name" :size="18" :ring="false" />
              <i v-else class="fa-solid fa-user-plus text-[11px]" aria-hidden="true"></i>
              {{ t.assignee?.name || (canEdit ? '指派' : '未指派') }}
            </button>

            <!-- Day 归属 -->
            <span v-if="t.day" class="chip chip-plain shrink-0 !px-2 !py-0 !text-[11px]" title="第 {{ t.day }} 天">
              D{{ t.day }}
            </span>

            <!-- 截止日期标签:小圆点 + 文字;已到期 rose / 今天 amber -->
            <template v-if="canEdit && pickDueFor === t.id">
              <input
                type="date"
                class="field !w-auto !px-3 !py-1 text-[13px]"
                @change="(e) => { if (e.target.value) store.setTodoDue(plan.id, t.id, e.target.value); pickDueFor = null }"
                @blur="pickDueFor = null"
              />
            </template>
            <template v-else-if="canEdit">
              <button
                v-if="t.due"
                class="relative"
                title="点击修改截止日期"
                @click="pickDueFor = t.id"
              >
                <span
                  class="chip"
                  :class="t.done ? 'chip-plain' : dueTone(t.due) === 'rose' ? 'chip-rose' : dueTone(t.due) === 'amber' ? 'chip-amber' : 'chip-plain'"
                >
                  <span class="dot"></span>
                  {{ dueText(t.due) }}
                </span>
              </button>
              <button v-else class="icon-btn" title="设置截止日期" @click="pickDueFor = t.id">
                <i class="fa-regular fa-calendar" aria-hidden="true"></i>
              </button>
            </template>
            <span v-else-if="t.due" class="chip" :class="t.done ? 'chip-plain' : dueTone(t.due) === 'rose' ? 'chip-rose' : dueTone(t.due) === 'amber' ? 'chip-amber' : 'chip-plain'">
              <span class="dot"></span>{{ dueText(t.due) }}
            </span>

            <button v-if="canEdit" class="icon-btn icon-btn-danger" title="删除任务" @click="store.removeTodo(plan.id, t.id)">
              <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
            </button>
          </div>
        </TransitionGroup>
      </div>

      <EmptyState
        v-else
        icon="fa-list-check"
        :title="todos.length ? '这里没有符合筛选的任务' : '清单还是空的'"
        :desc="todos.length ? '换个筛选看看' : '出发前的小事都写进来,比如检查车况、订门票'"
      >
        <BaseButton v-if="canEdit && !todos.length" icon="fa-plus" @click="openAdd()">添加第一个任务</BaseButton>
      </EmptyState>
    </div>

    <!-- 快速添加弹窗 -->
    <BaseModal v-model="showAdd" title="添加任务" :max-width="'440px'">
      <div class="space-y-4">
        <div>
          <label class="flabel">任务内容 *</label>
          <input
            v-model="newTitle"
            class="field"
            placeholder="例如:预订黄山风景区门票"
            maxlength="60"
            @keyup.enter="add"
          />
        </div>
        <div>
          <label class="flabel">安排在哪一天</label>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="chip transition-all duration-150 active:scale-95"
              :class="newDay === null ? 'chip-brand' : 'chip-plain'"
              @click="newDay = null"
            >未定</button>
            <button
              v-for="(d, i) in plannedDates"
              :key="d"
              type="button"
              class="chip transition-all duration-150 active:scale-95"
              :class="newDay === i + 1 ? 'chip-brand' : 'chip-plain'"
              @click="newDay = i + 1"
            >Day {{ i + 1 }} · {{ fmtDay(d, false) }}</button>
          </div>
        </div>
        <div>
          <label class="flabel">截止日期(可选)</label>
          <input v-model="newDue" type="date" class="field" />
        </div>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="showAdd = false">取消</BaseButton>
        <BaseButton icon="fa-plus" :disabled="!newTitle.trim()" @click="add">添加</BaseButton>
      </template>
    </BaseModal>
  </section>
</template>
