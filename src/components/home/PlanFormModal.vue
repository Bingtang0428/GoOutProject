<script setup>
import { ref, reactive, watch } from 'vue'
import { PASTEL_GRADS } from '@/utils/misc'
import { uid } from '@/utils/misc'
import { todayISO } from '@/utils/date'
import { useAuthStore } from '@/stores/auth'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import Avatar from '@/components/ui/Avatar.vue'
import CityInput from '@/components/ui/CityInput.vue'

// 新建 / 编辑计划弹窗
// Props: modelValue / plan(null=新建)   Emits: save(payload)
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  plan: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue', 'save'])
const auth = useAuthStore()

const form = reactive({
  name: '',
  destination: '',
  start_city: '',
  start_date: '',
  end_date: '',
  gradient: 0,
  budget: '',
  memberName: '',
  members: []
})
const saving = ref(false)

function reset() {
  const p = props.plan
  form.name = p?.name || ''
  form.destination = p?.destination || ''
  form.start_city = p?.start_city || ''
  form.start_date = p?.start_date || todayISO()
  form.end_date = p?.end_date || todayISO()
  form.gradient = p?.gradient ?? 0
  form.budget = p?.budget ? String(p.budget) : ''
  form.members = p?.members?.map((m) => ({ ...m })) || []
  form.memberName = ''
}

watch(() => props.modelValue, (v) => v && reset())

function addMember() {
  const n = form.memberName.trim()
  if (!n) return
  if (form.members.some((m) => m.name === n)) {
    form.memberName = ''
    return
  }
  form.members.push({ id: uid('m'), name: n })
  form.memberName = ''
}

function removeMember(id) {
  form.members = form.members.filter((m) => m.id !== id)
}

async function save() {
  if (!form.name.trim()) return
  saving.value = true
  try {
    const members =
      form.members.length || props.plan
        ? form.members
        : [{ id: uid('m'), name: auth.user?.name || '我' }]
    emit('save', {
      name: form.name.trim(),
      destination: form.destination.trim(),
      start_city: form.start_city,
      start_date: form.start_date,
      end_date: form.end_date,
      gradient: form.gradient,
      budget: form.budget === '' ? null : Number(form.budget) || 0,
      members
    })
    emit('update:modelValue', false)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="plan ? '编辑计划' : '新建计划'"
    :max-width="'540px'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="space-y-5">
      <div>
        <label class="flabel">计划名称 *</label>
        <input v-model="form.name" class="field" placeholder="例如:环皖南 · 徽州秋色自驾" maxlength="30" />
      </div>

      <div>
        <label class="flabel">集合城市(创建者设置,队员大交通自动带入)</label>
        <CityInput v-model="form.start_city" placeholder="选择集合城市(省市)" />
      </div>

      <div>
        <label class="flabel">目的地</label>
        <input v-model="form.destination" class="field" placeholder="例如:安徽 · 黄山 / 宏村" maxlength="30" />
      </div>

      <div class="grid grid-cols-3 gap-4">
        <div class="col-span-2 grid grid-cols-2 gap-4">
          <div>
            <label class="flabel">出发日期</label>
            <input v-model="form.start_date" type="date" class="field" />
          </div>
          <div>
            <label class="flabel">返程日期</label>
            <input v-model="form.end_date" type="date" class="field" :min="form.start_date" />
          </div>
        </div>
        <div>
          <label class="flabel">总预算 ¥(可选)</label>
          <input v-model="form.budget" type="number" min="0" class="field" placeholder="6000" />
        </div>
      </div>

      <div>
        <label class="flabel">卡片配色</label>
        <div class="flex gap-3">
          <button
            v-for="(g, i) in PASTEL_GRADS"
            :key="i"
            type="button"
            class="h-9 w-14 rounded-[10px] transition-all duration-200 ease-out active:scale-95"
            :style="{ background: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }"
            :class="form.gradient === i ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface' : ''"
            :aria-label="'配色 ' + (i + 1)"
            @click="form.gradient = i"
          ></button>
        </div>
      </div>

      <div>
        <label class="flabel">协作成员</label>
        <div class="mb-2 flex flex-wrap gap-2">
          <span v-for="m in form.members" :key="m.id" class="chip chip-plain gap-1.5 !px-2 !py-1">
            <Avatar :name="m.name" :size="18" :ring="false" />
            {{ m.name }}
            <i
              class="fa-solid fa-xmark cursor-pointer opacity-40 hover:opacity-100"
              aria-hidden="true"
              @click="removeMember(m.id)"
            ></i>
          </span>
          <span v-if="!form.members.length" class="chip chip-plain text-muted">尚未添加(默认加入你自己)</span>
        </div>
        <div class="flex gap-2">
          <input
            v-model="form.memberName"
            class="field flex-1"
            placeholder="输入成员昵称后回车"
            @keyup.enter="addMember"
          />
          <BaseButton variant="soft" icon="fa-plus" @click="addMember">添加</BaseButton>
        </div>
      </div>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('update:modelValue', false)">取消</BaseButton>
      <BaseButton :disabled="!form.name.trim()" :loading="saving" @click="save">
        {{ plan ? '保存修改' : '创建计划' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
