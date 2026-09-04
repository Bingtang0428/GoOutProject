<script setup>
import { computed } from 'vue'
import { pastelOf } from '@/utils/misc'
import { fmtRange, todayISO, planDays } from '@/utils/date'
import AvatarStack from '@/components/ui/AvatarStack.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'

// 首页计划卡片:渐变封面 + 名称/日期 + 成员叠放头像 + 完成度进度条
// showManage=false(围观者/未加入)时不渲染编辑入口
const props = defineProps({
  plan: { type: Object, required: true },
  progress: { type: Object, default: () => ({ done: 0, total: 0, pct: 0 }) },
  showManage: { type: Boolean, default: true }
})
const emit = defineEmits(['open', 'edit', 'delete'])

const grad = computed(() => {
  const [a, b] = pastelOf(props.plan.gradient)
  return { '--vg1': a, '--vg2': b }
})

const status = computed(() => {
  const t = todayISO()
  if (props.plan.end_date < t) return { text: '已结束', cls: 'chip-plain' }
  if (props.plan.start_date > t) return { text: '未开始', cls: 'chip-amber' }
  return { text: '进行中', cls: 'chip-brand' }
})

const doneLabel = computed(() =>
  props.progress.total ? `${Math.round(props.progress.pct)}% 完成` : '待规划'
)
</script>

<template>
  <article
    class="card visual flex cursor-pointer flex-col p-6 transition-all duration-300 ease-out active:scale-[0.97]"
    :style="grad"
    @click="emit('open', plan.id)"
  >
    <!-- 顶行:状态 + 操作 -->
    <div class="mb-4 flex items-center justify-between gap-2">
      <span class="chip" :class="status.cls">{{ status.text }}</span>
      <div v-if="showManage" class="touch-reveal flex gap-1 opacity-0 transition-opacity duration-250 hover:opacity-100">
        <button class="icon-btn" aria-label="编辑" @click.stop="emit('edit', plan)">
          <i class="fa-solid fa-pen" aria-hidden="true"></i>
        </button>
        <button class="icon-btn icon-btn-danger" aria-label="删除" @click.stop="emit('delete', plan)">
          <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <!-- 标题与目的地 -->
    <h3 class="visual-title mb-1 text-[19px] font-semibold leading-snug">
      {{ plan.name }}
    </h3>
    <p class="visual-sub mb-4 flex items-center gap-1.5 text-[13px]">
      <i class="fa-solid fa-location-dot text-[11px]" aria-hidden="true"></i>
      {{ plan.destination || '目的地待定' }}
    </p>

    <div class="visual-sub mb-5 flex items-center gap-2 text-[12px]">
      <i class="fa-solid fa-calendar-days text-[12px]" aria-hidden="true"></i>
      {{ fmtRange(plan.start_date, plan.end_date) }}
      <span class="opacity-60">· {{ planDays(plan.start_date, plan.end_date) }} 天</span>
    </div>

    <!-- 底部:成员 + 进度 -->
    <div class="mt-auto flex items-end justify-between gap-3">
      <AvatarStack :users="plan.members" :size="28" :max="4" />
      <span class="flex items-center gap-2 text-[12px] font-semibold" :class="progress.total ? 'visual-title' : 'visual-sub'">
        <ProgressBar :value="progress.pct" :height="6" class="w-[64px]" />
        {{ doneLabel }}
      </span>
    </div>
  </article>
</template>

<style scoped>
.visual:hover .opacity-0 { opacity: 1; }
</style>
