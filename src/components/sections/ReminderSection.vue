<script setup>
// ============================================================
// 提醒事项:按日期分组(今天 / 明天 / 后续 / 已过期)
// 每条显示时间 + 内容 + 已读状态(已读变淡);未读圆点 amber 高亮
// ============================================================
import { ref, reactive, computed } from 'vue'
import { useContentStore } from '@/stores/content'
import { groupReminders, fmtDay, todayISO } from '@/utils/date'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const store = useContentStore()

const reminders = computed(() => store.rowsOf(props.plan.id, 'reminders'))
const groups = computed(() => groupReminders(reminders.value))
const unreadCount = computed(() => reminders.value.filter((r) => !r.read).length)

// —— 新增提醒
const showAdd = ref(false)
const form = reactive({ title: '', date: todayISO(), time: '09:00' })

function openAdd() {
  Object.assign(form, { title: '', date: todayISO(), time: '09:00' })
  showAdd.value = true
}

async function save() {
  if (!form.title.trim()) return
  await store.addReminder(props.plan.id, {
    title: form.title.trim(),
    date: form.date,
    time: form.time || '09:00'
  })
  showAdd.value = false
}

function markAllRead() {
  for (const r of reminders.value) {
    if (!r.read) store.setReminderRead(props.plan.id, r.id, true)
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
        <h2 class="title-1 flex items-center gap-3">
          <i class="fa-solid fa-bell text-[19px] text-primary" aria-hidden="true"></i>
          提醒事项
          <span v-if="unreadCount" class="chip chip-amber">
            <span class="dot"></span>{{ unreadCount }} 条未读
          </span>
        </h2>
        <p class="muted mt-1">按日期归组,点按一条即可标记为已读</p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton v-if="canEdit && unreadCount" variant="ghost" size="sm" @click="markAllRead">
          <i class="fa-solid fa-check-double" aria-hidden="true"></i>全部已读
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
              <button
                v-for="r in g.rows"
                :key="r.id"
                type="button"
                class="card group flex w-full items-center gap-4 px-5 py-4 text-left transition-all duration-280 ease-out hover:shadow-card-hover active:scale-[0.985]"
                :class="r.read ? 'opacity-55' : ''"
                @click="canEdit && store.setReminderRead(plan.id, r.id, !r.read)"
              >
                <!-- 时间 -->
                <span
                  class="flex w-[54px] shrink-0 flex-col items-center rounded-[12px] py-1.5"
                  :class="r.read ? 'bg-surface-2' : 'bg-primary/10'"
                >
                  <span class="text-[15px] font-bold tabular-nums" :class="r.read ? 'text-muted' : 'text-primary'">
                    {{ r.time?.slice(0, 5) }}
                  </span>
                </span>

                <!-- 内容 + 未读点 -->
                <span class="relative min-w-0 flex-1">
                  <span
                    v-if="!r.read"
                    class="absolute -left-4 top-1.5 h-2 w-2 rounded-full bg-amber"
                    style="animation: pulse-soft 2s ease-in-out infinite"
                  ></span>
                  <span
                    class="block truncate text-[14.5px] font-medium transition-all duration-300"
                    :class="r.read ? 'text-muted line-through decoration-muted/50' : 'text-ink'"
                  >
                    {{ r.title }}
                  </span>
                  <span v-if="g.key === 'later' || g.key === 'earlier'" class="muted block text-[11.5px]">
                    {{ fmtDay(r.date, true) }}
                  </span>
                </span>

                <span v-if="canEdit" class="muted shrink-0 text-[11px]">
                  {{ r.read ? '已读' : '未读' }}
                </span>
                <span
                  v-if="canEdit"
                  class="icon-btn icon-btn-danger touch-reveal !h-8 !w-8 shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  @click.stop="store.removeReminder(plan.id, r.id)"
                >
                  <i class="fa-solid fa-trash-can text-[12px]" aria-hidden="true"></i>
                </span>
              </button>
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
    <BaseModal v-model="showAdd" title="添加提醒" :max-width="'440px'">
      <div class="space-y-4">
        <div>
          <label class="flabel">提醒内容 *</label>
          <input v-model="form.title" class="field" placeholder="例如:联系民宿确认入住" maxlength="60" @keyup.enter="save" />
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
        <BaseButton icon="fa-bell" :disabled="!form.title.trim()" @click="save">添加提醒</BaseButton>
      </template>
    </BaseModal>
  </section>
</template>
