<script setup>
// ============================================================
// 权限管理弹窗(仅创建者可操作)
// 三种角色:创建者(锁定)/ 参与者(可编辑内容)/ 围观者(只读)
// ============================================================
import { ref, computed } from 'vue'
import { usePlansStore } from '@/stores/plans'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Avatar from '@/components/ui/Avatar.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  plan: { type: Object, required: true }
})
const emit = defineEmits(['update:modelValue'])
const plansStore = usePlansStore()

const addName = ref('')
const addAs = ref('participant') // participant | viewer

// 汇总所有人员及当前角色
const roster = computed(() => {
  const rows = []
  const owner = props.plan.members.find((m) => m.id === props.plan.owner_id)
  rows.push({ id: props.plan.owner_id, name: owner?.name || '创建者', role: 'owner' })
  for (const m of props.plan.members || []) {
    if (m.id === props.plan.owner_id) continue
    rows.push({ id: m.id, name: m.name, role: 'participant' })
  }
  for (const v of props.plan.viewers || []) rows.push({ id: v.id, name: v.name, role: 'viewer' })
  return rows
})

async function addPerson() {
  const name = addName.value.trim()
  if (!name) return
  if (addAs.value === 'participant') await plansStore.inviteParticipant(props.plan.id, name)
  else await plansStore.inviteViewer(props.plan.id, name)
  addName.value = ''
}

const ROLE_META = {
  owner: { text: '创建者', tone: 'brand', hint: '可编辑计划、删除、管理权限' },
  participant: { text: '参与者', tone: 'success', hint: '可编辑全部内容' },
  viewer: { text: '围观者', tone: 'plain', hint: '只读查看' }
}

async function toggleRole(p) {
  if (p.role === 'owner') return
  const to = p.role === 'viewer' ? 'participant' : 'viewer'
  await plansStore.setPersonRole(props.plan.id, p.id, to)
}

async function removePerson(p) {
  if (p.role === 'owner') return
  await plansStore.removePerson(props.plan.id, p.id)
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    title="成员与权限"
    :max-width="'520px'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="space-y-5">
      <p class="muted -mt-1 text-[12.5px] leading-relaxed">
        创建者可编辑计划与成员;<b>参与者</b>可编辑路线 / 食宿 / 待办 / 攻略 / 分账;<b>围观者</b>只读查看。
      </p>

      <!-- 添加 -->
      <div class="card flex items-end gap-2 !rounded-box bg-surface-2/60 p-3">
        <div class="min-w-0 flex-1">
          <label class="flabel">添加成员(输入昵称)</label>
          <input
            v-model="addName"
            class="field !py-2 text-[13px]"
            placeholder="例如:阿澈"
            maxlength="12"
            @keyup.enter="addPerson"
          />
        </div>
        <div class="flex gap-1">
          <button
            class="chip !px-3 !py-2.5"
            :class="addAs === 'participant' ? 'chip-brand' : 'chip-plain'"
            @click="addAs = 'participant'"
          >参与者</button>
          <button
            class="chip !px-3 !py-2.5"
            :class="addAs === 'viewer' ? 'chip-brand' : 'chip-plain'"
            @click="addAs = 'viewer'"
          >围观者</button>
          <BaseButton size="sm" icon="fa-plus" :disabled="!addName.trim()" @click="addPerson">添加</BaseButton>
        </div>
      </div>

      <!-- 名单 -->
      <ul class="space-y-2">
        <li
          v-for="p in roster"
          :key="p.id"
          class="card flex items-center gap-3 px-4 py-3"
          :class="p.role === 'owner' ? 'ring-1 ring-primary/40' : ''"
        >
          <Avatar :name="p.name" :size="34" />
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2">
              <span class="truncate text-[14px] font-semibold text-ink">{{ p.name }}</span>
              <span v-if="p.role === 'owner'" class="chip chip-brand !text-[11px] !px-2 !py-0">创建者</span>
            </p>
            <p class="text-[11.5px] text-muted">{{ ROLE_META[p.role].hint }}</p>
          </div>
          <template v-if="p.role !== 'owner'">
            <BaseButton variant="ghost" size="sm" @click="toggleRole(p)">
              {{ p.role === 'viewer' ? '设为参与者' : '设为围观者' }}
            </BaseButton>
            <button class="icon-btn icon-btn-danger" title="移出计划" @click="removePerson(p)">
              <i class="fa-solid fa-user-minus" aria-hidden="true"></i>
            </button>
          </template>
        </li>
        <li v-if="!roster.length" class="muted px-2 py-3 text-center text-[13px]">
          还没有成员,邀请队友一起规划吧
        </li>
      </ul>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('update:modelValue', false)">完成</BaseButton>
    </template>
  </BaseModal>
</template>
