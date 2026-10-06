<script setup>
// ============================================================
// 公开只读分享页:无需登录即可查看某份行程(/share/:id)
// 内容:行程概览 + 每日路线 + 食宿 + 待办 + 预算
// ============================================================
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@vueuse/head'
import { usePlansStore } from '@/stores/plans'
import { useContentStore } from '@/stores/content'
import { fmtRange, fmtDay } from '@/utils/date'
import { setCurrency, money } from '@/utils/money'
import { isSupabase } from '@/api/supabase'
import AvatarStack from '@/components/ui/AvatarStack.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const route = useRoute()
const router = useRouter()
const plans = usePlansStore()
const content = useContentStore()

const loading = ref(true)
const notFound = ref(false)

const plan = computed(() => plans.plans.find((p) => p.id === route.params.id) || null)
const days = computed(() =>
  content.rowsOf(plan.value?.id, 'days').slice().sort((a, b) => a.date.localeCompare(b.date))
)
const stays = computed(() => content.rowsOf(plan.value?.id, 'stays'))
const todos = computed(() => content.rowsOf(plan.value?.id, 'todos'))
const bills = computed(() => content.rowsOf(plan.value?.id, 'bills'))
const totalSpent = computed(() => bills.value.reduce((s, b) => s + Number(b.amount || 0), 0))
const budget = computed(() => {
  const per = Number(plan.value?.budget_per) || 0
  const count = Math.max(1, plan.value?.members?.length || 1)
  if (per) return per * count
  return Number(plan.value?.budget) || 0
})

function stayDays(s) {
  if (Array.isArray(s.days) && s.days.length) return s.days
  return s.day ? [s.day] : []
}
const stayGroups = computed(() => {
  const out = []
  days.value.forEach((d, i) => {
    const items = stays.value.filter((s) => stayDays(s).includes(i + 1))
    if (items.length) out.push({ label: `第 ${i + 1} 天 · ${fmtDay(d.date, false)}`, items })
  })
  const un = stays.value.filter((s) => !stayDays(s).length)
  if (un.length) out.push({ label: '未安排日期', items: un })
  return out
})

onMounted(async () => {
  await plans.init()
  if (!plan.value) {
    notFound.value = true
    loading.value = false
    return
  }
  setCurrency(plan.value.currency || 'CNY')
  await content.ensureLoaded(plan.value)
  loading.value = false
})

useHead({
  title: computed(() => (plan.value ? `${plan.value.name} · 行程分享` : '行程分享 · 兔兔同行'))
})
</script>

<template>
  <div class="min-h-dvh bg-page">
    <header class="glass sticky top-0 z-30">
      <div class="wrap flex items-center gap-3 py-3">
        <span class="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary text-white">
          <i class="fa-solid fa-map-location-dot text-[15px]" aria-hidden="true"></i>
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[14px] font-semibold leading-tight text-ink">兔兔同行 · 行程分享</p>
          <p class="truncate text-[11px] text-muted">只读预览</p>
        </div>
        <BaseButton size="sm" variant="soft" icon="fa-right-to-bracket" @click="router.push('/login')">登录/加入</BaseButton>
      </div>
    </header>

    <main class="wrap py-5">
      <p v-if="loading" class="muted py-16 text-center text-[13px]">
        <i class="fa-solid fa-circle-notch mr-1" style="animation: spin .8s linear infinite" aria-hidden="true"></i>加载中…
      </p>
      <div v-else-if="notFound" class="card p-10 text-center">
        <i class="fa-solid fa-circle-exclamation text-[22px] text-rose" aria-hidden="true"></i>
        <p class="mt-2 text-[15px] font-semibold text-ink">找不到这份行程</p>
        <p class="muted mt-1 text-[12.5px]">链接可能已失效或计划已被删除</p>
      </div>

      <template v-else-if="plan">
        <!-- 概览 -->
        <section class="card visual overflow-hidden p-6" style="--vg1: #F7DFE7; --vg2: #EFE6F7">
          <h1 class="visual-title text-[24px] font-bold leading-snug sm:text-[30px]">{{ plan.name }}</h1>
          <p class="visual-sub mt-2 text-[13px]">
            <i class="fa-solid fa-location-dot mr-1" aria-hidden="true"></i>{{ plan.destination || '目的地待定' }}
            · {{ fmtRange(plan.start_date, plan.end_date) }}
          </p>
          <p v-if="plan.start_city" class="visual-sub mt-1 text-[12.5px]">集合城市:{{ plan.start_city }}</p>
          <div class="mt-3"><AvatarStack :users="plan.members" :size="28" :max="8" /></div>
        </section>

        <p v-if="!isSupabase" class="mt-4 rounded-[12px] bg-amber/10 px-4 py-2 text-[12.5px] text-amber">
          <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>这是本地演示数据,分享链接仅本机可查看。
        </p>

        <!-- 每日路线 -->
        <section class="mt-5">
          <h2 class="mb-3 text-[16px] font-bold text-ink"><i class="fa-solid fa-route mr-2 text-primary" aria-hidden="true"></i>每日路线</h2>
          <div class="space-y-3">
            <article v-for="(d, i) in days" :key="d.date" class="card p-4">
              <p class="mb-2 text-[13.5px] font-bold text-ink">
                第 {{ i + 1 }} 天 · {{ fmtDay(d.date, true) }}
                <span v-if="d.title" class="font-normal text-ink-soft">—— {{ d.title }}</span>
              </p>
              <ol v-if="(d.destinations || []).length" class="space-y-1.5">
                <li v-for="(x, xi) in d.destinations" :key="x.id" class="flex items-start gap-2 text-[13.5px] text-ink">
                  <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{{ xi + 1 }}</span>
                  <span class="min-w-0">
                    <b class="font-semibold">{{ x.time || '全天' }}</b> {{ x.place }}
                    <span v-if="x.note" class="muted block text-[11.5px]">{{ x.note }}</span>
                  </span>
                </li>
              </ol>
              <p v-else class="muted text-[12.5px] italic">待安排</p>
              <p v-if="d.memo" class="mt-2 rounded-[10px] bg-amber/10 px-3 py-1.5 text-[12px] text-ink-soft">
                <i class="fa-solid fa-note-sticky mr-1 text-amber" aria-hidden="true"></i>{{ d.memo }}
              </p>
            </article>
          </div>
        </section>

        <!-- 食宿 -->
        <section v-if="stays.length" class="mt-6">
          <h2 class="mb-3 text-[16px] font-bold text-ink"><i class="fa-solid fa-bed mr-2 text-primary" aria-hidden="true"></i>食宿安排</h2>
          <div class="space-y-3">
            <div v-for="grp in stayGroups" :key="grp.label" class="card p-4">
              <p class="mb-2 text-[13px] font-bold text-ink-soft">{{ grp.label }}</p>
              <ul class="space-y-1.5">
                <li v-for="s in grp.items" :key="s.id" class="flex items-center gap-2 text-[13.5px] text-ink">
                  <i :class="s.type === 'food' ? 'fa-solid fa-utensils text-amber' : 'fa-solid fa-hotel text-primary'" aria-hidden="true"></i>
                  <span class="min-w-0 flex-1 truncate">{{ s.name }}</span>
                  <span v-if="s.price" class="muted text-[12px]">{{ s.type === 'food' ? `人均 ¥${s.price}` : `¥${s.price}/晚` }}</span>
                  <span class="chip chip-plain !px-2 !py-0 !text-[10.5px]">{{ s.booked ? '已订' : '待订' }}</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <!-- 待办 -->
        <section v-if="todos.length" class="mt-6">
          <h2 class="mb-3 text-[16px] font-bold text-ink"><i class="fa-solid fa-list-check mr-2 text-primary" aria-hidden="true"></i>待办清单</h2>
          <div class="card p-4">
            <ul class="space-y-1.5">
              <li v-for="t in todos" :key="t.id" class="flex items-center gap-2 text-[13.5px]">
                <i :class="t.done ? 'fa-solid fa-circle-check text-[#16a34a]' : 'fa-regular fa-circle text-primary'" aria-hidden="true"></i>
                <span :class="t.done ? 'text-muted line-through' : 'text-ink'">{{ t.title }}</span>
                <span v-if="t.due" class="muted ml-auto text-[11.5px]">{{ fmtDay(t.due, false) }} 截止</span>
              </li>
            </ul>
          </div>
        </section>

        <!-- 预算概览 -->
        <section v-if="bills.length" class="mt-6 mb-10">
          <h2 class="mb-3 text-[16px] font-bold text-ink"><i class="fa-solid fa-wallet mr-2 text-primary" aria-hidden="true"></i>预算概览</h2>
          <div class="card flex flex-wrap gap-6 p-5 text-[13.5px]">
            <p>已花 <b class="text-ink">{{ money(totalSpent) }}</b></p>
            <p v-if="budget">预算 <b class="text-ink">{{ money(budget) }}</b></p>
            <p>人均 <b class="text-ink">{{ money(totalSpent / Math.max(1, plan.members?.length || 1)) }}</b></p>
          </div>
        </section>

        <p class="muted mb-10 text-center text-[11.5px]">兔兔同行 · 雨林通往雪景,你向往的旅行 ♪</p>
      </template>
    </main>
  </div>
</template>
