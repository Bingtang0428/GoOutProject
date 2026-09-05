<script setup>
// ============================================================
// 旅行相册 / 打卡回忆 —— 按日期上传照片与一句话记录
// 照片存储:Supabase covers 桶 / 演示模式 base64
// ============================================================
import { ref, reactive, computed } from 'vue'
import { useContentStore } from '@/stores/content'
import { useAuthStore } from '@/stores/auth'
import { storageUrl, uploadCover, isSupabase } from '@/api/supabase'
import { fmtDay, todayISO } from '@/utils/date'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const emit = defineEmits(['update:modelValue'])
const store = useContentStore()
const auth = useAuthStore()

const items = computed(() =>
  store
    .rowsOf(props.plan.id, 'memories')
    .slice()
    .sort((a, b) => (b.day_date || '').localeCompare(a.day_date || ''))
)

const adding = ref(false)
const busy = ref(false)
const form = reactive({ date: todayISO(), file: null, preview: '', note: '' })
const hint = ref('')

function openAdd() {
  adding.value = true
  form.date = todayISO()
  form.file = null
  form.preview = ''
  form.note = ''
  hint.value = ''
}

function onPick(e) {
  const file = e.target.files?.[0]
  form.file = file || null
  form.preview = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => (form.preview = reader.result)
  reader.readAsDataURL(file)
}

async function save() {
  if (!form.file || !form.date) return
  busy.value = true
  try {
    let image = form.preview
    if (isSupabase) image = await uploadCover(form.file, `mem-${Date.now()}`) // covers 桶,路径按时间
    else if (!image) image = ''
    await store.addMemory(props.plan.id, {
      day_date: form.date,
      image,
      note: form.note.trim(),
      author: auth.user ? { id: auth.user.id, name: auth.user.name } : null
    })
    adding.value = false
  } catch (err) {
    hint.value = '照片上传失败,请重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    title="旅行相册"
    :max-width="'640px'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p class="muted text-[12.5px]">共 {{ items.length }} 张 · 按日期打卡,回程自动成册</p>
      <BaseButton v-if="canEdit" size="sm" icon="fa-camera" @click="openAdd">上传照片</BaseButton>
    </div>

    <!-- 上传面板 -->
    <div v-if="adding" class="card mb-4 !rounded-box bg-surface-2/60 p-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
        <div class="space-y-2">
          <label class="flabel !mb-0">日期</label>
          <input v-model="form.date" type="date" class="field !py-2 text-[13px]" />
          <label class="block cursor-pointer overflow-hidden rounded-[10px] border border-dashed border-line bg-surface text-center text-[12px] text-muted">
            <img v-if="form.preview" :src="form.preview" alt="" class="max-h-28 w-full object-cover" />
            <span v-else class="flex h-20 items-center justify-center gap-1"><i class="fa-solid fa-image" aria-hidden="true"></i>选择照片</span>
            <input type="file" accept="image/*" class="hidden" @change="onPick" />
          </label>
        </div>
        <div>
          <label class="flabel !mb-0">此刻的一句话</label>
          <textarea v-model="form.note" class="field mt-1" rows="3" placeholder="例如:宏村南湖的晨雾真好看"></textarea>
          <p v-if="hint" class="mt-1 text-[12px] text-rose">{{ hint }}</p>
          <div class="mt-2 flex justify-end gap-2">
            <BaseButton variant="ghost" size="sm" @click="adding = false">取消</BaseButton>
            <BaseButton size="sm" icon="fa-check" :loading="busy" :disabled="!form.file" @click="save">存入相册</BaseButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 相册墙 -->
    <div v-if="items.length" class="masonry">
      <figure v-for="m in items" :key="m.id" class="card overflow-hidden p-0">
        <img :src="storageUrl(m.image)" :alt="m.note" loading="lazy" class="w-full" />
        <figcaption class="p-3">
          <p class="muted mb-1 text-[11px]">{{ fmtDay(m.day_date, true) }}{{ m.author?.name ? ' · ' + m.author.name : '' }}</p>
          <p v-if="m.note" class="text-[13px] leading-relaxed text-ink-soft">{{ m.note }}</p>
          <div class="mt-2 flex justify-end">
            <button v-if="canEdit" class="icon-btn icon-btn-danger !h-7 !w-7" title="删除这张照片" @click="store.removeMemory(plan.id, m.id)">
              <i class="fa-solid fa-trash-can text-[12px]" aria-hidden="true"></i>
            </button>
          </div>
        </figcaption>
      </figure>
    </div>
    <EmptyState
      v-else
      icon="fa-camera"
      title="相册还空着"
      :desc="canEdit ? '路上的高光时刻都传上来,回程就是一本回忆册' : '等待成员上传照片'"
    >
      <BaseButton v-if="canEdit" icon="fa-camera" @click="openAdd">上传第一张</BaseButton>
    </EmptyState>
  </BaseModal>
</template>
