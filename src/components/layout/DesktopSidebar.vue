<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { usePlansStore } from '@/stores/plans'
import { useAuthStore } from '@/stores/auth'
import { fmtRange, todayISO } from '@/utils/date'
import AvatarStack from '@/components/ui/AvatarStack.vue'
import Avatar from '@/components/ui/Avatar.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

function statusOf(p) {
  const t = todayISO()
  if (p.end_date < t) return { text: '已结束', tone: 'chip-plain' }
  if (p.start_date > t) return { text: '未开始', tone: 'chip-amber' }
  return { text: '进行中', tone: 'chip-brand' }
}

// 桌面端左侧固定侧边栏(280px):计划列表 + 成员头像 + 用户卡片
const plansStore = usePlansStore()
const auth = useAuthStore()
const router = useRouter()

const newMember = ref('')

// 只有创建者能在侧栏直接邀请/移除参与者
const canManage = computed(() =>
  plansStore.currentPlan ? plansStore.myRole(plansStore.currentPlan) === 'owner' : false
)

const myRoleText = computed(() => {
  const p = plansStore.currentPlan
  const r = p ? plansStore.myRole(p) : null
  return { owner: '创建者', member: '参与者', viewer: '围观者' }[r] || null
})

function goPlan(id) {
  plansStore.setCurrent(id)
  router.push(`/plan/${id}`)
}

async function addMember() {
  if (!newMember.value.trim() || !plansStore.currentPlan) return
  await plansStore.inviteParticipant(plansStore.currentPlan.id, newMember.value.trim())
  newMember.value = ''
}

function removeMember(m) {
  plansStore.removePerson(plansStore.currentPlan.id, m.id)
}

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <aside class="fixed inset-y-0 left-0 z-40 hidden w-[280px] flex-col border-r border-line/70 bg-surface/80 backdrop-blur-xl lg:flex">
    <!-- 品牌 -->
    <div class="flex items-center gap-3 px-6 pb-4 pt-6">
      <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-[0_8px_20px_rgb(183_89_115/0.35)]">
        <i class="fa-solid fa-map-location-dot text-[17px]" aria-hidden="true"></i>
      </span>
      <div>
        <p class="text-[17px] font-semibold leading-tight text-ink">兔兔同行</p>
        <p class="text-[11px] text-muted">雨林通往雪景 ♪</p>
      </div>
    </div>

    <!-- 计划列表 -->
    <div class="flex items-center justify-between px-6 pb-2 pt-2">
      <h2 class="text-[12px] font-semibold uppercase tracking-wider text-muted">我的计划</h2>
      <button
        class="icon-btn"
        title="新建计划"
        @click="router.push({ name: 'home', query: { new: 1 } })"
      >
        <i class="fa-solid fa-plus" aria-hidden="true"></i>
      </button>
    </div>

    <nav class="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
      <p v-if="!plansStore.plans.length" class="px-3 pt-4 text-[12px] leading-5 text-muted">
        还没有计划<br />点击上方 + 新建第一份旅行企划
      </p>
      <button
        v-for="p in plansStore.plans"
        :key="p.id"
        class="card card-lift group w-full p-4 text-left transition-all duration-300 ease-out active:scale-[0.97]"
        :class="p.id === plansStore.currentId ? 'ring-2 ring-primary/60' : ''"
        @click="goPlan(p.id)"
      >
        <div class="mb-1.5 flex items-center justify-between gap-2">
          <p class="min-w-0 truncate text-[14px] font-semibold text-ink">{{ p.name }}</p>
          <span class="chip shrink-0 whitespace-nowrap !px-2 !py-0.5 text-[10.5px]" :class="statusOf(p).tone">
            {{ statusOf(p).text }}
          </span>
        </div>
        <p class="mb-2.5 text-[11px] text-muted">{{ fmtRange(p.start_date, p.end_date) }}</p>
        <AvatarStack :users="p.members" :size="22" :max="4" />
      </button>
    </nav>

    <!-- 当前计划成员 -->
    <div v-if="plansStore.currentPlan" class="border-t border-line/70 px-6 py-4">
      <div class="mb-2 flex items-center gap-2">
        <i class="fa-solid fa-users text-[13px] text-primary" aria-hidden="true"></i>
        <h2 class="text-[12px] font-semibold text-ink-soft">成员</h2>
        <span class="chip chip-plain !px-2 !py-0 text-[11px]">
          {{ plansStore.currentPlan.members.length + plansStore.currentPlan.viewers.length }} 人
        </span>
        <span
          v-if="myRoleText"
          class="chip ml-auto !px-2 !py-0 text-[11px]"
          :class="myRoleText === '创建者' ? 'chip-brand' : myRoleText === '参与者' ? 'chip-success' : 'chip-plain'"
        >
          {{ myRoleText }}
        </span>
      </div>
      <div class="mb-3 flex flex-wrap gap-1.5">
        <span
          v-for="m in plansStore.currentPlan.members"
          :key="m.id"
          class="chip chip-plain gap-1.5 !px-2"
          :title="m.name + (m.id === plansStore.currentPlan.owner_id ? '(创建者)' : '')"
        >
          <Avatar :name="m.name" :size="18" :ring="false" />
          <span class="max-w-[56px] truncate">{{ m.name }}</span>
          <i
            v-if="m.id === plansStore.currentPlan.owner_id"
            class="fa-solid fa-crown text-[9px] text-amber"
            aria-hidden="true"
          ></i>
          <i
            v-if="canManage && m.id !== plansStore.currentPlan.owner_id"
            class="fa-solid fa-xmark cursor-pointer opacity-40 transition-opacity hover:opacity-100"
            aria-hidden="true"
            @click.stop="removeMember(m)"
          ></i>
        </span>
        <span
          v-for="v in plansStore.currentPlan.viewers"
          :key="v.id"
          class="chip chip-plain gap-1.5 !px-2 opacity-70"
          title="围观者(只读)"
        >
          <Avatar :name="v.name" :size="18" :ring="false" />
          <span class="max-w-[56px] truncate">{{ v.name }}</span>
          <i
            v-if="canManage"
            class="fa-solid fa-xmark cursor-pointer opacity-40 transition-opacity hover:opacity-100"
            aria-hidden="true"
            @click.stop="removeMember(v)"
          ></i>
        </span>
      </div>
      <div v-if="canManage" class="flex items-center gap-2">
        <input
          v-model="newMember"
          class="field !rounded-box !px-3 !py-1.5 !text-[13px]"
          placeholder="输入昵称,回车添加参与者"
          @keyup.enter="addMember"
        />
      </div>
      <p v-else-if="myRoleText === '围观者'" class="muted text-[11.5px]">你是围观者,仅可查看内容</p>
    </div>

    <!-- 用户 -->
    <div class="flex items-center justify-between gap-3 border-t border-line/70 px-6 py-4">
      <div class="flex min-w-0 items-center gap-3">
        <Avatar :name="auth.user?.name" :size="34" />
        <div class="min-w-0">
          <p class="truncate text-[13px] font-semibold text-ink">{{ auth.user?.name }}</p>
          <p class="text-[11px] text-muted">正在计划下一程</p>
        </div>
      </div>
      <BaseButton variant="plain" size="sm" icon="fa-right-from-bracket" @click="logout" />
    </div>
  </aside>
</template>
