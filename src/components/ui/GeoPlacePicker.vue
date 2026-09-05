<script setup>
// ============================================================
// 精确选点器:输入名称 → 候选列表(含区县/城市/坐标) → 确认选择
// 选定后携带 lat/lng,杜绝"自动猜坐标猜错";也支持清除后手动输入
// modelValue: { name, lat, lng } | null
// ============================================================
import { ref, computed, watch } from 'vue'
import { searchPlaces, cleanQuery } from '@/api/geocode'

const props = defineProps({
  modelValue: { type: Object, default: null },
  hint: { type: String, default: '' }, // 集合城市,消歧用
  placeholder: { type: String, default: '输入地点/地址名称' }
})
const emit = defineEmits(['update:modelValue'])

const q = ref(props.modelValue?.name || '')
const results = ref([])
const open = ref(false)
const searching = ref(false)
const shareState = ref('') // '', 'loading', 'ok:<名>', 'err:<原因>'
let timer = null
let shareTimer = null

function isAmapShare(text) {
  return /https?:\/\/[a-z0-9.-]*(surl\.amap|uri\.amap|www\.amap|map\.amap)[^ ]*/i.test(text)
}

/** 解析高德分享链接(surl/uri/place),成功后直接选点 */
async function parseShareLink(text) {
  if (!isAmapShare(text)) return
  shareState.value = 'loading'
  try {
    const u = new URL('/api/parse-share', window.location.origin)
    u.searchParams.set('url', text)
    const res = await fetch(u.toString())
    const j = await res.json()
    if (j?.ok && j.lat != null) {
      q.value = j.name || '分享位置'
      open.value = false
      shareState.value = `ok:${j.label || j.name}`
      emit('update:modelValue', { name: j.name || '分享位置', label: j.label || q.value, lat: j.lat, lng: j.lng, source: 'share' })
    } else {
      shareState.value = 'err:无法解析该分享链接,请改用文字搜索'
    }
  } catch {
    shareState.value = 'err:解析服务不可用,请改用文字搜索'
  } finally {
    if (shareState.value.startsWith('loading')) shareState.value = ''
  }
}

watch(
  () => props.modelValue?.name,
  (v) => {
    if (v && v !== q.value) q.value = v
  }
)

function onInput() {
  open.value = true
  clearTimeout(timer)
  clearTimeout(shareTimer)
  const kw = q.value.trim()
  if (isAmapShare(kw)) {
    shareState.value = 'loading'
    shareTimer = setTimeout(() => parseShareLink(kw), 800)
    return
  }
  shareState.value = ''
  if (kw.length < 2) {
    results.value = []
    return
  }
  searching.value = true
  timer = setTimeout(async () => {
    results.value = await searchPlaces(kw, props.hint)
    searching.value = false
  }, 350)
}

function pick(c) {
  q.value = c.name
  open.value = false
  emit('update:modelValue', { name: c.name, label: c.label, lat: c.lat, lng: c.lng })
}

/** 无匹配时,允许以纯文字保存(不定位),保持可用性 */
function saveAsText() {
  const name = q.value.trim()
  if (!name) return
  open.value = false
  emit('update:modelValue', { name, lat: null, lng: null, textOnly: true })
}

function clearSel() {
  q.value = ''
  results.value = []
  emit('update:modelValue', null)
}

const hasSel = computed(() => Boolean(props.modelValue && Number.isFinite(props.modelValue.lat)))

const amapFixUrl = computed(() => {
  const n = encodeURIComponent(q.value || props.modelValue?.name || '')
  return `https://uri.amap.com/search?keyword=${n}`
})

// 按 Enter 使用首个候选(没有时仅作为文字输入,允许无坐标保存)
function onEnter() {
  if (results.value.length) pick(results.value[0])
}
</script>

<template>
  <div class="relative">
    <!-- 输入 -->
    <div class="flex items-center gap-2">
      <div class="relative flex-1">
        <i class="fa-solid fa-magnifying-glass pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-muted" aria-hidden="true"></i>
        <input
          v-model="q"
          class="field !pl-9"
          :placeholder="placeholder"
          maxlength="60"
          @input="onInput"
          @focus="q.length >= 2 && (open = true)"
          @keydown.enter.prevent="onEnter"
        />
        <button
          v-if="q || modelValue"
          type="button"
          class="icon-btn !absolute !right-1 !top-1/2 !h-7 !w-7 !-translate-y-1/2"
          title="清空"
          @click="clearSel"
        >
          <i class="fa-solid fa-xmark text-[11px]" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <!-- 已选坐标状态 -->
    <div v-if="hasSel" class="mt-1.5 flex flex-wrap items-center gap-2">
      <span class="chip chip-success !px-2 !py-0 !text-[11px]">
        <i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i>
        已精确定位 {{ Number(modelValue.lat).toFixed(5) }},{{ Number(modelValue.lng).toFixed(5) }}
        <span v-if="modelValue.label" class="ml-1 max-w-[180px] truncate opacity-80">{{ modelValue.label }}</span>
      </span>
    </div>

    <!-- 分享链接解析状态 -->
    <p
      v-if="shareState"
      class="mt-1.5 flex items-center gap-1.5 text-[12px]"
      :class="shareState === 'loading' ? 'text-muted' : shareState.startsWith('ok:') ? 'text-[#16a34a]' : 'text-rose'"
    >
      <i v-if="shareState === 'loading'" class="fa-solid fa-circle-notch" style="animation: spin 0.8s linear infinite" aria-hidden="true"></i>
      <i v-else-if="shareState.startsWith('ok:')" class="fa-solid fa-circle-check" aria-hidden="true"></i>
      <i v-else class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
      {{ shareState === 'loading' ? '正在解析高德分享链接…' : shareState.startsWith('ok:') ? `已解析:${shareState.slice(3)}` : shareState.slice(4) }}
    </p>

    <!-- 候选列表 -->
    <Transition name="fade-up">
      <div v-if="open && q.trim().length >= 2" class="card absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-64 overflow-y-auto p-1.5 shadow-pop">
        <p v-if="searching" class="px-3 py-3 text-center text-[12px] text-muted">
          <i class="fa-solid fa-circle-notch mr-1" style="animation: spin 0.8s linear infinite" aria-hidden="true"></i>查找中…
        </p>
        <p v-else-if="!results.length" class="px-3 py-3 text-center text-[12px] text-muted">
          没有匹配项
        </p>
        <button
          v-if="results.length === 0 && !searching"
          type="button"
          class="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[12px] transition-colors hover:bg-primary/10"
          @click="saveAsText"
        >
          <i class="fa-solid fa-font text-[11px] text-amber" aria-hidden="true"></i>
          以文字「{{ q.trim() }}」保存(不定位)
        </button>
        <button
          v-for="(c, i) in results"
          :key="c.label + i"
          type="button"
          class="flex w-full items-start gap-2 rounded-[10px] px-3 py-2 text-left transition-colors hover:bg-primary/10"
          @click="pick(c)"
        >
          <i class="fa-solid fa-location-dot mt-0.5 text-[11px] text-primary" aria-hidden="true"></i>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] font-semibold text-ink">{{ c.name }}</span>
            <span class="muted block truncate text-[11.5px]">{{ c.label }}</span>
          </span>
        </button>
      </div>
    </Transition>

    <p v-if="!hasSel && !shareState.startsWith('ok:')" class="muted mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
      <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
      <span>直接粘贴 <b class="font-semibold text-primary">高德分享链接</b>(surl/uri)可自动定位,或从候选列表点选更准;也可以<a :href="amapFixUrl" target="_blank" rel="noopener" class="font-semibold text-primary hover:underline">在高德确认后回来填</a></span>
    </p>
  </div>
</template>
