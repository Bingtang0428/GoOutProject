<script setup>
// ============================================================
// 登录页
// Supabase 模式:昵称 + 一次性邀请码(由后台生成,绑定角色与计划)
// 演示模式:昵称直达(数据存本地,便于体验)
// ============================================================
import { ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useHead } from '@vueuse/head'
import { useAuthStore } from '@/stores/auth'
import { usePlansStore } from '@/stores/plans'
import BaseButton from '@/components/ui/BaseButton.vue'

useHead({ title: '登录 · 兔兔同行自驾旅行企划' })

const auth = useAuthStore()
const plansStore = usePlansStore()
const router = useRouter()
const route = useRoute()

const nickname = ref('')
const code = ref('')
const errorMsg = ref('')
const busy = ref(false)

watch([nickname, code], () => (errorMsg.value = ''))

async function enter() {
  if (auth.isSupabase && !code.value.trim()) {
    errorMsg.value = '请输入邀请码'
    return
  }
  errorMsg.value = ''
  busy.value = true
  try {
    const me = await auth.loginWithInviteCode(nickname.value, code.value)
    // 邀请码若绑定计划:自动把本人放入对应角色名单(参与者/围观者)
    if (auth.isSupabase && me.invite_plan_id) {
      await plansStore.init()
      const target = plansStore.plans.find((p) => p.id === me.invite_plan_id)
      if (target) {
        if (me.role === 'viewer') await plansStore.inviteViewer(me.invite_plan_id, { id: me.id, name: me.name })
        else if (me.role === 'member') await plansStore.inviteParticipant(me.invite_plan_id, { id: me.id, name: me.name })
      }
    }
    const target = route.query.redirect
    if (typeof target === 'string' && target.startsWith('/') && !target.startsWith('/admin')) router.replace(target)
    else router.replace('/')
  } catch (e) {
    errorMsg.value = e?.message || '登录失败,请稍后重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center p-3 sm:p-4">
    <div class="grid w-full max-w-4xl overflow-hidden rounded-card shadow-card md:grid-cols-2">
      <!-- 左侧品牌视觉(桌面) -->
      <div class="visual hidden flex-col justify-between p-8 md:flex" style="--vg1: #f9dfe7; --vg2: #f2cad8">
        <div class="flex items-center gap-3">
          <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-lg">
            <i class="fa-solid fa-map-location-dot text-[19px]" aria-hidden="true"></i>
          </span>
          <div class="visual-title">
            <p class="text-xl font-bold leading-none">兔兔同行</p>
            <p class="visual-sub text-[12px]">自驾旅行企划</p>
          </div>
        </div>
        <div class="visual-title">
          <p class="text-[11px] font-semibold tracking-[0.2em] text-primary mb-2">兔兔同行 · 自驾旅行企划</p>
          <p class="mb-3 text-[25px] font-bold leading-snug">雨林通往雪景<br />你向往的旅行 ♪</p>
          <p class="visual-sub text-[14px] leading-relaxed">
            路线 / 食宿 / 分账 / 大交通 · 一车一队<br />从集合出发到算清账目,全程安排得明明白白
          </p>
        </div>
        <p class="visual-sub text-[12px]"><i class="fa-solid fa-key mr-1.5" aria-hidden="true"></i>凭邀请码加入 · 无需邮箱注册</p>
      </div>

      <!-- 右侧表单 -->
      <div class="bg-surface p-6 sm:p-10">
        <div class="mb-7 flex items-center gap-3 md:hidden">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
            <i class="fa-solid fa-map-location-dot text-[16px]" aria-hidden="true"></i>
          </span>
          <span class="text-lg font-bold text-ink">兔兔同行 · 自驾旅行企划</span>
        </div>

        <template v-if="auth.isSupabase">
          <h1 class="title-1 mb-1 text-[22px]">凭邀请码加入行程</h1>
          <p class="mb-6 text-[13px] leading-relaxed text-muted">
            由计划管理员/后台发放的一次性邀请码,<br />输一次即可加入对应计划,无需邮箱注册。
          </p>

          <label class="flabel">你的昵称</label>
          <input v-model="nickname" class="field mb-4" placeholder="例如:阿澈" maxlength="12" />

          <label class="flabel">邀请码</label>
          <input
            v-model="code"
            class="field mb-4 font-mono tracking-widest"
            placeholder="例如:TT-ADMIN-2026"
            maxlength="40"
            spellcheck="false"
            autocomplete="off"
            @keyup.enter="enter"
          />

          <p v-if="errorMsg" class="mb-3 rounded-[10px] bg-rose/10 px-3 py-2 text-[12.5px] text-rose">{{ errorMsg }}</p>

          <BaseButton block icon="fa-key" :loading="busy" @click="enter">进入兔兔同行</BaseButton>
        </template>

        <!-- 演示模式:昵称直达 -->
        <template v-else>
          <h1 class="title-1 mb-1 text-[22px]">开始你的旅程</h1>
          <p class="mb-6 text-[13px] text-muted">
            当前为本地演示模式,数据保存在浏览器;<br />
            配置 Supabase 后即切换为「邀请码 + 多人协作」。
          </p>
          <label class="flabel">你的昵称</label>
          <input v-model="nickname" class="field mb-4" placeholder="例如:阿澈" maxlength="12" @keyup.enter="enter" />
          <BaseButton block icon="fa-right-to-bracket" @click="enter">进入兔兔同行</BaseButton>
        </template>

        <p class="mt-6 text-center text-[12px] leading-relaxed text-muted">
          管理员可在后台生成邀请码,并管理计划与成员
        </p>
      </div>
    </div>
  </div>
</template>
