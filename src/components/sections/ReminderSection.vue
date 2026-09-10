<script setup>
// ============================================================
// 提醒事项:按日期分组(今天 / 明天 / 后续 / 已过期)
// 每条可指定「提醒谁」;被提醒的成员点按即记为已读,
// 多人提醒时需所有人已读后整条才关闭,并展示谁已读。
// ============================================================
import { ref, reactive, computed } from 'vue'
import { useContentStore } from '@/stores/content'
import { useAuthStore } from '@/stores/auth'
import { groupReminders, fmtDay, todayISO } from '@/utils/date'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Avatar from '@/components/ui/Avatar.vue'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const store = useContentStore()
const auth = useAuthStore()

const reminders = computed(() => store.rowsOf(props.plan.id, 'reminders'))
const groups = computed(() => groupReminders(reminders.value))

/** 参与提醒的成员(创建者 + 参与者,去重) */
const members = computed(() => {
  const list = [...(props.plan.members || [])]
  if (props.plan.owner_id && !list.some((m) => m.id === props.plan.owner_id)) {
    const owner = [...(props.plan.viewers || []), ...list].find((m) => m.id === props.plan.owner_id)
    if (owner) list.unshift(owner)
  }
  return list
})

const me = computed(() => (auth.user ? { id: auth.user.id, name: auth.user.name } : null))

const targetsOf = (r) => (Array.isArray(r.targets) ? r.targets : [])
const readsOf = (r) => (Array.isArray(r.reads) ? r.reads : [])
const samePerson = (a, b) => a && b && ((a.id && b.id && a.id === b.id) || a.name === b.name)

/** 是否已关闭:指定了多人时需全部已读;否则任意已读即关闭 */
function isClosed(r) {
  if (r.read) return true
  const targets = targetsOf(r)
  if (!targets.length) return false
  return targets.every((t) => readsOf(r).some((x) => samePerson(t, x)))
}
function iRead(r) {
  return readsOf(r).some((x) => samePerson(x, me.value))
}
/** 指定成员里还没读的人 */
function unreadTargets(r) {
  return targetsOf(r).filter((t) => !readsOf(r).some((x) => samePerson(t, x)))
}
const unreadCount = computed(() => reminders.value.filter((r) => !isClosed(r)).length)

async function toggleRead(r) {
  if (!props.canEdit || !me.value) return
  await store.readReminderBy(props.plan.id, r.id, me.value, !iRead(r))
}

async function markAllMine() {
  if (!props.canEdit || !me.value) return
  for (const r of reminders.value) {
    if (!iRead(r)) await store.readReminderBy(props.plan.id, r.id, me.value, true)
  }
}

// —— 新增提醒
const showAdd = ref(false)
const form = reactive({ title: '', date: todayISO(), time: '09:00', targets: [] })

function openAdd() {
  Object.assign(form, {
    title: '',
    date: todayISO(),
    time: '09:00',
    targets: members.value.map((m) => ({ id: m.id, name: m.name }))
  })
  showAdd.value = true
}

function toggleTarget(p) {
  const i = form.targets.findIndex((t) => t.id === p.id)
  if (i === -1) form.targets.push({ id: p.id, name: p.name })
  else form.targets.splice(i, 1)
}

const saving = ref(false)
async function save() {
  if (!form.title.trim() || saving.value) return
  saving.value = true
  try {
    await store.addReminder(props.plan.id, {
      title: form.title.trim(),
      date: form.date,
      time: form.time || '09:00',
      targets: form.targets,
      reads: []
    })
    showAdd.value = false
  } finally {
    saving.value = false
  }
}

function groupTone(key) {
  if (key === 'today') return 'amber'
  if (key === 'earlier') return 'rose'
  return 'plain'
}
</script>

<template>
  <section>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="title-1 flex flex-wrap items-center gap-3">
          <i class="fa-solid fa-bell text-[19px] text-primary" aria-hidden="true"></i>
          提醒事项
          <span v-if="unreadCount" class="chip chip-amber">
            <span class="dot"></span>{{ unreadCount }} 条未读
          </span>
        </h2>
        <p class="muted mt-1">可指定提醒谁;多人提醒需所有人已读后才关闭</p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton v-if="canEdit && unreadCount" variant="ghost" size="sm" @click="markAllMine">
          <i class="fa-solid fa-check-double" aria-hidden="true"></i>我全部已读
        </BaseButton>
        <BaseButton v-if="canEdit" icon="fa-plus" @click="openAdd">添加提醒</BaseButton>
      </div>
    </div>

    <div class="mx-auto max-w-2xl space-y-10">
      <template v-for="g in groups" :key="g.key">
        <div>
          <div class="mb-3 flex items-center gap-3">
            <span class="chip" :class="groupTone(g.key) === 'amber' ? 'chip-amber' : groupTone(g.key) === 'rose' ? 'chip-rose' : 'chip-brand'">
              <span class="dot"></span>{{ g.label }}
            </span>
            <span v-if="g.key === 'later'" class="muted text-[12px]">按日期正序</span>
            <hr class="hr !my-0 flex-1" />
          </div>

          <div class="space-y-3">
            <TransitionGroup name="fade-up-list">
              <div
                v-for="r in g.rows"
                :key="r.id"
                class="card group flex w-full items-center gap-3 px-4 py-4 text-left transition-all duration-280 ease-out sm:gap-4 sm:px-5"
                :class="isClosed(r) ? 'opacity-55' : ''"
              >
                <!-- 时间 -->
                <span
                  class="flex w-[54px] shrink-0 flex-col items-center rounded-[12px] py-1.5"
                  :class="isClosed(r) ? 'bg-surface-2' : 'bg-primary/10'"
                >
                  <span class="text-[15px] font-bold tabular-nums" :class="isClosed(r) ? 'text-muted' : 'text-primary'">
                    {{ r.time?.slice(0, 5) }}
                  </span>
                </span>

                <!-- 内容 + 未读点 + 已读情况 -->
                <div class="relative min-w-0 flex-1">
                  <span
                    v-if="!isClosed(r)"
                    class="absolute -left-4 top-1.5 h-2 w-2 rounded-full bg-amber"
                    style="animation: pulse-soft 2s ease-in-out infinite"
                  ></span>
                  <span
                    class="block truncate text-[14.5px] font-medium transition-all duration-300"
                    :class="isClosed(r) ? 'text-muted line-through decoration-muted/50' : 'text-ink'"
                  >
                    {{ r.title }}
                  </span>
                  <span v-if="g.key === 'later' || g.key === 'earlier'" class="muted block text-[11.5px]">
                    {{ fmtDay(r.date, true) }}
                  </span>

                  <!-- 提醒谁 / 谁已读 -->
                  <div v-if="targetsOf(r).length" class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                    <span class="flex items-center gap-1 text-muted">
                      <i class="fa-solid fa-user-clock text-[10px]" aria-hidden="true"></i>
                      提醒 {{ targetsOf(r).length }} 人
                    </span>
                    <span class="flex items-center gap-1 text-[#16a34a]">
                      <i class="fa-solid fa-circle-check text-[10px]" aria-hidden="true"></i>
                      已读 {{ targetsOf(r).filter((t) => readsOf(r).some((x) => samePerson(t, x))).length }}/{{ targetsOf(r).length }}
                    </span>
                    <span v-if="unreadTargets(r).length" class="flex items-center gap-1 font-medium text-rose">
                      <i class="fa-regular fa-clock text-[10px]" aria-hidden="true"></i>
                      未读:{{ unreadTargets(r).map((t) => t.name).join('、') }}
                    </span>
                    <span v-else class="flex items-center gap-1 font-medium text-[#16a34a]">
                      <i class="fa-solid fa-check-double text-[10px]" aria-hidden="true"></i>全部已读
                    </span>
                    <span class="flex flex-wrap items-center gap-1">
                      <span
                        v-for="t in targetsOf(r)"
                        :key="t.id || t.name"
                        class="flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-1.5"
                        :class="readsOf(r).some((x) => samePerson(t, x)) ? 'bg-[#16a34a]/10' : 'bg-surface-2'"
                        :title="readsOf(r).some((x) => samePerson(t, x)) ? `${t.name} 已读` : `${t.name} 未读`"
                      >
                        <Avatar :name="t.name" :size="16" :ring="false" :seed="t.id" />
                        <span class="max-w-[48px] truncate" :class="readsOf(r).some((x) => samePerson(t, x)) ? 'text-[#16a34a]' : 'text-muted'">{{ t.name }}</span>
                        <i
                          class="text-[9px]"
                          :class="readsOf(r).some((x) => samePerson(t, x)) ? 'fa-solid fa-check text-[#16a34a]' : 'fa-regular fa-clock text-muted'"
                          aria-hidden="true"
                        ></i>
                      </span>
                    </span>
                  </div>
                </div>

                <!-- 操作 -->
                <div v-if="canEdit" class="flex shrink-0 items-center gap-1">
                  <button
                    v-if="!iRead(r)"
                    class="chip chip-brand cursor-pointer whitespace-nowrap transition-all duration-150 active:scale-95"
                    @click.stop="toggleRead(r)"
                  >
                    <i class="fa-solid fa-check text-[10px]" aria-hidden="true"></i>我已读
                  </button>
                  <button
                    v-else
                    class="chip chip-success cursor-pointer whitespace-nowrap transition-all duration-150 active:scale-95"
                    title="点击可取消已读"
                    @click.stop="toggleRead(r)"
                  >
                    <i class="fa-solid fa-check text-[10px]" aria-hidden="true"></i>已读
                  </button>
                  <span
                    class="icon-btn icon-btn-danger touch-reveal !h-8 !w-8 shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    @click.stop="store.removeReminder(plan.id, r.id)"
                  >
                    <i class="fa-solid fa-trash-can text-[12px]" aria-hidden="true"></i>
                  </span>
                </div>
              </div>
            </TransitionGroup>
          </div>
        </div>
      </template>
    </div>

    <EmptyState
      v-if="!reminders.length"
      icon="fa-bell"
      title="没有待办提醒"
      desc="例如「出发前加满油」「第三天联系民宿」,按日子帮你盯住"
    >
      <BaseButton v-if="canEdit" icon="fa-plus" @click="openAdd">添加第一条提醒</BaseButton>
    </EmptyState>

    <!-- 添加提醒弹窗 -->
    <BaseModal v-model="showAdd" title="添加提醒" :max-width="'460px'">
      <div class="space-y-4">
        <div>
          <label class="flabel">提醒内容 *</label>
          <input v-model="form.title" class="field" placeholder="例如:联系民宿确认入住" maxlength="60" @keyup.enter="save" />
        </div>
        <div>
          <label class="flabel">提醒谁(需谁已读)</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="p in members"
              :key="p.id"
              type="button"
              class="chip transition-all duration-150 active:scale-95"
              :class="form.targets.some((t) => t.id === p.id) ? 'chip-brand' : 'chip-plain opacity-70'"
              @click="toggleTarget(p)"
            >
              <Avatar :name="p.name" :size="18" :ring="false" :color="p.color" :seed="p.id" />{{ p.name }}
            </button>
          </div>
          <p class="muted mt-1.5 text-[11.5px]">
            <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
            不选=任何人已读即关闭;选多名成员时,需这些人全部已读后整条才关闭
          </p>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="flabel">日期</label>
            <input v-model="form.date" type="date" class="field" :min="todayISO()" />
          </div>
          <div>
            <label class="flabel">时间</label>
            <input v-model="form.time" type="time" class="field" />
          </div>
        </div>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="showAdd = false">取消</BaseButton>
        <BaseButton icon="fa-bell" :disabled="!form.title.trim()" :loading="saving" @click="save">添加提醒</BaseButton>
      </template>
    </BaseModal>
  </section>
</template>
