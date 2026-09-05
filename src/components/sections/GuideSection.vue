<script setup>
// ============================================================
// 收藏攻略:瀑布流(Masonry)展示
// 卡片含标题 / 来源链接 / 缩略图(封面上传→storage 或 base64)/ 收藏时间
// ============================================================
import { ref, reactive, computed } from 'vue'
import { useContentStore } from '@/stores/content'
import { useAuthStore } from '@/stores/auth'
import { isSupabase, storageUrl, uploadCover } from '@/api/supabase'
import { fetchLinkMeta } from '@/api/metadata'
import { hostOf } from '@/utils/misc'
import { fmtSavedAt } from '@/utils/date'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import Avatar from '@/components/ui/Avatar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

const props = defineProps({
  plan: { type: Object, required: true },
  canEdit: { type: Boolean, default: true }
})
const store = useContentStore()
const auth = useAuthStore()

const guides = computed(() => store.rowsOf(props.plan.id, 'guides'))

/* ---- 攻略评论 ---- */
const gcomments = computed(() => store.rowsOf(props.plan.id, 'gcomments'))
const openCmt = ref(null) // guideId | null
const draftCmt = reactive({})
const commentsOf = (gid) =>
  gcomments.value.filter((c) => c.guide_id === gid).sort((a, b) => a.created_at.localeCompare(b.created_at))

async function postComment(gid) {
  const text = (draftCmt[gid] || '').trim()
  if (!text) return
  await store.addGuideComment(props.plan.id, {
    guide_id: gid,
    text,
    author: auth.user ? { id: auth.user.id, name: auth.user.name } : null
  })
  draftCmt[gid] = ''
}

function canRemoveCmt(c) {
  return (
    props.canEdit &&
    c.author &&
    (c.author.id === auth.user?.id || c.author.name === auth.user?.name)
  )
}

/* ---- 链接自动识别 ---- */
const fetching = ref(false)
const metaHint = ref('')

async function autoDetect() {
  const url = form.url.trim()
  if (!/^https?:\/\//i.test(url)) {
    metaHint.value = '先粘贴 https:// 开头的分享链接'
    return
  }
  fetching.value = true
  metaHint.value = ''
  try {
    const meta = await fetchLinkMeta(url)
    if (meta) {
      if (!form.title) form.title = meta.title || ''
      if (!form.image && meta.image) form.image = meta.image
      metaHint.value = meta.title ? '识别成功:标题与封面已自动填入,可继续修改' : '已识别链接,但未取到标题,请手动填写'
    } else {
      metaHint.value = '暂时无法自动识别(部分平台反爬/网络限制),请手动填写标题'
    }
  } finally {
    fetching.value = false
  }
}

// —— 新增收藏
const showAdd = ref(false)
const form = reactive({ title: '', url: '', image: '', file: null, fileHint: '', uploading: false })

function openAdd() {
  Object.assign(form, { title: '', url: '', image: '', file: null, fileHint: '', uploading: false })
  metaHint.value = ''
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
            <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <button
                  class="btn btn-ghost btn-sm !px-2.5"
                  :class="openCmt === g.id ? '!text-primary !border-primary/50' : ''"
                  @click="openCmt = openCmt === g.id ? null : g.id"
                >
                  <i class="fa-regular fa-message text-[11px]" aria-hidden="true"></i>
                  评论{{ commentsOf(g.id).length ? ' ' + commentsOf(g.id).length : '' }}
                </button>
                <a v-if="g.url" :href="g.url" target="_blank" rel="noopener" class="text-[12.5px] font-semibold text-primary hover:underline">
                  阅读原文 <i class="fa-solid fa-arrow-up-right-from-square text-[10px]" aria-hidden="true"></i>
                </a>
              </div>
              <button
                v-if="canEdit"
                class="icon-btn icon-btn-danger touch-reveal !h-7 !w-7 shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                title="取消收藏"
                @click="store.removeGuide(plan.id, g.id)"
              >
                <i class="fa-solid fa-trash-can text-[12px]" aria-hidden="true"></i>
              </button>
            </div>

            <!-- 攻略评论线程 -->
            <Transition name="fade">
              <div v-if="openCmt === g.id" class="mt-3 space-y-2 rounded-[12px] bg-surface-2/50 p-3">
                <div v-for="c in commentsOf(g.id)" :key="c.id" class="flex items-start gap-2.5">
                  <Avatar :name="c.author?.name || '匿名'" :size="26" />
                  <div class="min-w-0 flex-1">
                    <p class="text-[12.5px] leading-relaxed text-ink-soft">
                      <b class="font-semibold text-ink">{{ c.author?.name || '匿名' }}</b> {{ c.text }}
                    </p>
                    <p class="muted mt-0.5 text-[10.5px]">{{ fmtSavedAt(c.created_at) }}</p>
                  </div>
                  <button
                    v-if="canRemoveCmt(c)"
                    class="icon-btn icon-btn-danger !h-6 !w-6"
                    title="删除"
                    @click="store.removeGuideComment(plan.id, c.id)"
                  >
                    <i class="fa-solid fa-xmark text-[10px]" aria-hidden="true"></i>
                  </button>
                </div>
                <div v-if="canEdit" class="flex gap-2 pt-1">
                  <input
                    v-model="draftCmt[g.id]"
                    class="field !py-2 text-[13px]"
                    :placeholder="commentsOf(g.id).length ? '补充你的看法…' : '第一个评论:这篇靠谱吗?'"
                    maxlength="200"
                    @keyup.enter="postComment(g.id)"
                  />
                  <BaseButton size="sm" :disabled="!(draftCmt[g.id] || '').trim()" @click="postComment(g.id)">发送</BaseButton>
                </div>
              </div>
            </Transition>
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
          <div class="flex gap-2">
            <input v-model="form.url" class="field flex-1" placeholder="粘贴小红书/B站/公众号等分享链接" type="url" @paste="setTimeout(autoDetect, 30)" />
            <BaseButton variant="soft" size="sm" :loading="fetching" icon="fa-wand-magic-sparkles" @click="autoDetect">
              自动识别
            </BaseButton>
          </div>
          <p class="mt-1.5 flex items-center gap-1.5 text-[12px]" :class="metaHint.includes('成功') ? 'text-[#16a34a]' : metaHint ? 'text-amber' : 'text-muted'">
            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
            {{ metaHint || '粘贴分享链接后点「自动识别」,自动带出标题和封面' }}
          </p>
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
