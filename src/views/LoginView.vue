<script setup>
// ============================================================
// 登录页:昵称 + 邀请码(无需邮箱)
// Supabase 模式:必须填邀请码(管理员码登录后直达后台)
// 演示模式:邀请码可留空,昵称直达
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
    // 邀请码绑定计划:自动加入对应名单
    if (auth.isSupabase && me.invite_plan_id) {
      await plansStore.init()
      const target = plansStore.plans.find((p) => p.id === me.invite_plan_id)
      if (target) {
        const person = { id: me.id, name: me.name }
        if (me.role === 'viewer') await plansStore.inviteViewer(me.invite_plan_id, person)
        else if (me.role === 'member') await plansStore.inviteParticipant(me.invite_plan_id, person)
      }
    }
    // 管理员直达后台
    if (me.role === 'admin') {
      router.replace('/admin')
      return
    }
    const target = route.query.redirect
    if (typeof target === 'string' && target.startsWith('/') && target !== '/admin') router.replace(target)
    else router.replace('/')
  } catch (e) {
    errorMsg.value = e?.message || '登录失败,请稍后重试'
  } finally {
    busy.value = false
  }
}

function focusCode() {
  document.getElementById('invite-code-input')?.focus()
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
            路线 / 食宿 / 分账 / 大交通 · 一车一队<br />一个邀请码,一份随时同步的企划
          </p>
        </div>
        <p class="visual-sub text-[12px]"><i class="fa-solid fa-key mr-1.5" aria-hidden="true"></i>凭邀请码加入 · 无需邮箱注册</p>
      </div>

      <!-- 右侧表单 -->
      <div class="bg-surface p-6 sm:p-10">
        <div class="mb-6 flex items-center gap-3 md:hidden">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
            <i class="fa-solid fa-map-location-dot text-[16px]" aria-hidden="true"></i>
          </span>
          <span class="text-lg font-bold text-ink">兔兔同行 · 自驾旅行企划</span>
        </div>

        <h1 class="title-1 mb-1 text-[22px]">进入兔兔同行</h1>
        <p class="mb-6 text-[13px] leading-relaxed text-muted">
          输入邀请码即可加入对应计划
          <template v-if="!auth.isSupabase">(演示模式可留空)</template>
          ,无需邮箱注册。
        </p>

        <!-- ★ 邀请码:独立输入框 -->
        <div
          class="mb-5 rounded-[16px] border-2 p-4 transition-colors duration-250"
          :class="errorMsg ? 'border-rose/60' : 'border-primary/25 focus-within:border-primary/60'"
        >
          <label class="flabel flex items-center gap-1.5" for="invite-code-input">
            <i class="fa-solid fa-key text-primary" aria-hidden="true"></i>
            邀请码
            <span v-if="auth.isSupabase" class="muted font-normal">(必填)</span>
          </label>
          <input
            id="invite-code-input"
            v-model="code"
            type="text"
            class="w-full bg-transparent text-center font-mono text-[20px] font-bold uppercase tracking-[0.25em] text-ink outline-none"
            placeholder="····-····"
            maxlength="40"
            spellcheck="false"
            autocomplete="off"
            @keyup.enter="enter"
          />
          <p class="muted mt-1 text-center text-[11.5px]">由计划管理员或后台发放</p>
        </div>

        <label class="flabel" for="nickname-input">昵称</label>
        <input
          id="nickname-input"
          v-model="nickname"
          class="field mb-4"
          placeholder="例如:阿澈(同伴之间可见)"
          maxlength="12"
          @keyup.enter="enter"
        />

        <p v-if="errorMsg" class="mb-3 rounded-[10px] bg-rose/10 px-3 py-2 text-[12.5px] text-rose">{{ errorMsg }}</p>

        <BaseButton block icon="fa-right-to-bracket" :loading="busy" @click="enter">进入</BaseButton>

        <!-- 管理员入口 -->
        <button
          class="mt-4 flex w-full items-center justify-center gap-2 text-[12.5px] font-semibold text-primary transition-opacity hover:opacity-80"
          @click="focusCode"
        >
          <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
          我是管理员:输入管理员邀请码登录,直达后台管理
        </button>
      </div>
    </div>
  </div>
</template>
