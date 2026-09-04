<script setup>
// ============================================================
// 食宿安排:卡片展示 餐厅/酒店 名称、地址、电话与标签
// 桌面端两列网格;支持预订状态开关与标签快速编辑
// ============================================================
import { ref, computed, reactive } from 'vue'
import { useContentStore } from '@/stores/content'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const store = useContentStore()

const stays = computed(() => store.rowsOf(props.plan.id, 'stays'))
const bookedCount = computed(() => stays.value.filter((s) => s.booked).length)
const foodCount = computed(() => stays.value.filter((s) => s.type === 'food').length)

const PRESET_TAGS = ['免费停车', '含早', '人均¥100', '可带宠物']

// —— 新增 / 编辑弹窗
const showEdit = ref(false)
const editingId = ref(null) // null = 新增
const form = reactive({ type: 'stay', name: '', address: '', phone: '', tags: [], booked: false, tagInput: '' })

function openAdd() {
  editingId.value = null
  Object.assign(form, { type: 'stay', name: '', address: '', phone: '', tags: [], booked: false, tagInput: '' })
  showEdit.value = true
}

function openEdit(item) {
  editingId.value = item.id
  Object.assign(form, {
    type: item.type,
    name: item.name,
    address: item.address,
    phone: item.phone,
    tags: [...(item.tags || [])],
    booked: item.booked,
    tagInput: ''
  })
  showEdit.value = true
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
  if (!form.name.trim()) return
  const payload = {
    type: form.type,
    name: form.name.trim(),
    address: form.address.trim(),
    phone: form.phone.trim(),
    tags: form.tags,
    booked: form.booked
  }
  if (editingId.value) await store.updateStay(props.plan.id, editingId.value, payload)
  else await store.addStay(props.plan.id, payload)
  showEdit.value = false
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

    <!-- 两列网格(≥768px 并排) -->
    <div v-if="stays.length" class="grid grid-cols-1 gap-6 md:grid-cols-2">
      <TransitionGroup name="fade-up-list" tag="div" class="contents">
        <article v-for="s in stays" :key="s.id" class="card card-lift group flex flex-col p-6">
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
            <span class="flex-1">{{ s.address || '地址待补充' }}</span>
          </div>
          <div v-if="s.phone" class="mb-3 flex items-center gap-2.5 text-[13px]">
            <i class="fa-solid fa-phone text-[12px] text-primary" aria-hidden="true"></i>
            <a class="font-medium text-primary hover:underline" :href="`tel:${s.phone}`">{{ s.phone }}</a>
          </div>

          <div v-if="s.tags?.length" class="mb-4 flex flex-wrap gap-2">
            <BaseTag v-for="t in s.tags" :key="t" :tone="tagTone(t)">{{ t }}</BaseTag>
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
      </TransitionGroup>
    </div>

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
          <label class="flabel">名称 *</label>
          <input v-model="form.name" class="field" placeholder="酒店 / 餐厅名称" maxlength="40" />
        </div>
        <div>
          <label class="flabel">地址</label>
          <input v-model="form.address" class="field" placeholder="方便成员直接导航" maxlength="80" />
        </div>
        <div>
          <label class="flabel">预订电话</label>
          <input v-model="form.phone" class="field" type="tel" placeholder="用于一键拨打" />
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
        <BaseButton icon="fa-check" :disabled="!form.name.trim()" @click="save">
          {{ editingId ? '保存修改' : '添加' }}
        </BaseButton>
      </template>
    </BaseModal>
  </section>
</template>
