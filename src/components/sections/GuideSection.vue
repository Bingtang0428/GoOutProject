<script setup>
// ============================================================
// 收藏攻略:瀑布流(Masonry)展示
// 卡片含标题 / 来源链接 / 缩略图(封面上传→storage 或 base64)/ 收藏时间
// ============================================================
import { ref, reactive, computed } from 'vue'
import { useContentStore } from '@/stores/content'
import { isSupabase, storageUrl, uploadCover } from '@/api/supabase'
import { hostOf } from '@/utils/misc'
import { fmtSavedAt } from '@/utils/date'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const store = useContentStore()

const guides = computed(() => store.rowsOf(props.plan.id, 'guides'))

// —— 新增收藏
const showAdd = ref(false)
const form = reactive({ title: '', url: '', image: '', file: null, fileHint: '', uploading: false })

function openAdd() {
  Object.assign(form, { title: '', url: '', image: '', file: null, fileHint: '', uploading: false })
  showAdd.value = true
}

function onPickFile(e) {
  const file = e.target.files?.[0]
  form.file = file || null
  form.fileHint = ''
  if (!file) {
    form.image = ''
    return
  }
  // 先本地预览(数据URL或缩略);正式提交时才决定走 storage 还是 base64
  const reader = new FileReader()
  reader.onload = () => (form.image = reader.result)
  reader.readAsDataURL(file)
}

async function save() {
  if (!form.title.trim() || !form.url.trim()) return
  form.uploading = true
  let image = form.image
  try {
    if (form.file) {
      if (isSupabase) {
        // ★ Supabase 存储:上传到 covers 桶,拿到公开路径
        image = await uploadCover(form.file, props.plan.id)
      }
      // 演示模式:form.image 已由 FileReader 转成 base64,直接入库
    }
    await store.addGuide(props.plan.id, {
      title: form.title.trim(),
      url: form.url.trim(),
      image: image || '',
      created_at: new Date().toISOString()
    })
    showAdd.value = false
  } catch (err) {
    form.fileHint = '图片上传失败,可稍后重试(链接仍可保存)'
    console.warn('[guides] 封面上传失败', err)
  } finally {
    form.uploading = false
  }
}
</script>

<template>
  <section>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 class="title-1 flex items-center gap-3">
          <i class="fa-solid fa-bookmark text-[19px] text-primary" aria-hidden="true"></i>
          收藏攻略
          <span v-if="guides.length" class="chip chip-brand">{{ guides.length }} 篇</span>
        </h2>
        <p class="muted mt-1">把刷到的好文章、好视频攒进这一程,出发前慢慢看</p>
      </div>
      <BaseButton v-if="canEdit" icon="fa-plus" @click="openAdd">收藏一篇</BaseButton>
    </div>

    <!-- 瀑布流:CSS columns 实现,图片按自然比例错落排布 -->
    <div v-if="guides.length" class="masonry">
      <TransitionGroup name="fade-up-list" tag="div" class="contents">
        <article v-for="g in guides" :key="g.id" class="card card-lift group overflow-hidden p-0">
          <a
            v-if="g.image"
            :href="g.url || '#'"
            target="_blank"
            rel="noopener"
            class="block overflow-hidden"
          >
            <img
              :src="storageUrl(g.image)"
              :alt="g.title"
              loading="lazy"
              class="w-full transition-transform duration-500 ease-out group-hover:scale-[1.04]"
            />
          </a>
          <div
            v-else
            class="visual flex h-36 items-center justify-center"
            style="--vg1: #e8edff; --vg2: #dbe4ff"
          >
            <i class="fa-regular fa-bookmark text-3xl text-primary/50" aria-hidden="true"></i>
          </div>

          <div class="p-5">
            <div class="mb-2 flex items-center justify-between gap-2">
              <BaseTag tone="amber" icon="fa-link">{{ g.url ? hostOf(g.url) : '收藏' }}</BaseTag>
              <span class="muted text-[11.5px]">{{ fmtSavedAt(g.created_at) }}</span>
            </div>
            <h3 class="mb-1 line-clamp-2 text-[15px] font-semibold leading-relaxed text-ink">
              <a v-if="g.url" :href="g.url" target="_blank" rel="noopener" class="hover:text-primary">
                {{ g.title }}
              </a>
              <template v-else>{{ g.title }}</template>
            </h3>
            <div class="mt-3 flex items-center justify-between">
              <a v-if="g.url" :href="g.url" target="_blank" rel="noopener" class="text-[12.5px] font-semibold text-primary hover:underline">
                阅读原文 <i class="fa-solid fa-arrow-up-right-from-square text-[10px]" aria-hidden="true"></i>
              </a>
              <button
                v-if="canEdit"
                class="icon-btn icon-btn-danger touch-reveal !h-7 !w-7 shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                title="取消收藏"
                @click="store.removeGuide(plan.id, g.id)"
              >
                <i class="fa-solid fa-trash-can text-[12px]" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </article>
      </TransitionGroup>
    </div>

    <EmptyState
      v-else
      icon="fa-bookmark"
      title="还没有收藏攻略"
      desc="粘贴链接 + 封面,把想抄的作业都留在这"
    >
      <BaseButton v-if="canEdit" icon="fa-plus" @click="openAdd">收藏第一篇</BaseButton>
    </EmptyState>

    <!-- 收藏弹窗 -->
    <BaseModal v-model="showAdd" title="收藏攻略" :max-width="'500px'">
      <div class="space-y-5">
        <div>
          <label class="flabel">标题 *</label>
          <input v-model="form.title" class="field" placeholder="例如:黄山看日出全攻略" maxlength="60" />
        </div>
        <div>
          <label class="flabel">原文链接 *</label>
          <input v-model="form.url" class="field" placeholder="https://…" type="url" />
        </div>
        <div>
          <label class="flabel">封面图</label>
          <label
            class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-surface-2/50 py-6 transition-colors duration-200 hover:border-primary/50"
            :class="form.image ? '!p-3' : ''"
          >
            <template v-if="form.image">
              <img :src="form.image" alt="封面预览" class="max-h-44 rounded-xl object-cover" />
              <span class="text-[12px] font-semibold text-primary">
                <i class="fa-solid fa-rotate mr-1" aria-hidden="true"></i>点击更换图片
              </span>
            </template>
            <template v-else>
              <i class="fa-regular fa-image text-2xl text-primary/60" aria-hidden="true"></i>
              <span class="text-[12.5px] text-muted">上传本地封面(可选),留空使用渐变占位</span>
            </template>
            <input type="file" accept="image/*" class="hidden" @change="onPickFile" />
          </label>
          <p v-if="form.fileHint" class="mt-2 text-[12px] font-medium text-rose">{{ form.fileHint }}</p>
        </div>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="showAdd = false">取消</BaseButton>
        <BaseButton icon="fa-bookmark" :disabled="!form.title.trim() || !form.url.trim()" :loading="form.uploading" @click="save">
          收藏
        </BaseButton>
      </template>
    </BaseModal>
  </section>
</template>
