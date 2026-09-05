<script setup>
// ============================================================
// 登录 / 注册
// Supabase 模式:
//   注册(首次)  = 昵称 + 密码 + 邀请码(注册验证码,由管理员发放)
//   登录(之后)  = 昵称 + 密码 —— 不再需要邀请码
// 演示模式:昵称直达
// ============================================================
import { ref, watch, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useHead } from '@vueuse/head'
import { useAuthStore } from '@/stores/auth'
import BaseButton from '@/components/ui/BaseButton.vue'

useHead({ title: '登录 · 兔兔同行自驾旅行企划' })

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const mode = ref('login') // login | register(仅 Supabase 模式)
const nickname = ref('')
const password = ref('')
const code = ref('')
const errorMsg = ref('')
const busy = ref(false)

const isRegister = computed(() => auth.isSupabase && mode.value === 'register')

watch([nickname, password, code, mode], () => (errorMsg.value = ''))

function submit() {
  if (busy.value) return
  if (auth.isSupabase) {
    isRegister.value ? doRegister() : doLogin()
  } else {
    enterDemo()
  }
}

async function enterDemo() {
  auth.loginLocal(nickname.value)
  afterAuth(null, null)
}

async function doRegister() {
  if (password.value.length < 4) {
    errorMsg.value = '密码至少 4 位'
    return
  }
  if (!code.value.trim()) {
    errorMsg.value = '请填写注册邀请码'
    return
  }
  errorMsg.value = ''
  busy.value = true
  try {
    const me = await auth.registerWithCode(nickname.value, password.value, code.value)
    afterAuth(me, me.invite_plan_id)
  } catch (e) {
    errorMsg.value = e?.message || '注册失败,请稍后重试'
  } finally {
    busy.value = false
  }
}

async function doLogin() {
  errorMsg.value = ''
  busy.value = true
  try {
    const me = await auth.loginWithPassword(nickname.value, password.value)
    afterAuth(me, null)
  } catch (e) {
    errorMsg.value = e?.message || '登录失败,请稍后重试'
  } finally {
    busy.value = false
  }
}

/** 登录/注册成功后的跳转 */
function afterAuth(me, invitePlanId) {
  if (auth.isSupabase && me?.role === 'admin') {
    router.replace('/admin')
    return
  }
  if (invitePlanId) {
    router.replace(`/plan/${invitePlanId}`)
    return
  }
  const target = route.query.redirect
  if (typeof target === 'string' && target.startsWith('/') && target !== '/admin') router.replace(target)
  else router.replace('/')
}

function focusCode() {
  document.getElementById('invite-code-input')?.focus()
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center p-3 sm:p-4">
    <div class="grid w-full max-w-4xl overflow-hidden rounded-card shadow-card md:grid-cols-2">
      <!-- 品牌视觉 -->
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
          <p class="mb-3 text-[25px] font-bold leading-snug">雨林通往雪景<br />你向往的旅行 ♪</p>
          <p class="visual-sub text-[14px] leading-relaxed">
            路线 / 食宿 / 分账 / 大交通 · 一车一队<br />注册一次,以后直接登录
          </p>
        </div>
        <p class="visual-sub text-[12px]"><i class="fa-solid fa-key mr-1.5" aria-hidden="true"></i>邀请码仅注册时需要</p>
      </div>

      <!-- 表单 -->
      <div class="bg-surface p-6 sm:p-10">
        <div class="mb-6 flex items-center gap-3 md:hidden">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
            <i class="fa-solid fa-map-location-dot text-[16px]" aria-hidden="true"></i>
          </span>
          <span class="text-lg font-bold text-ink">兔兔同行 · 自驾旅行企划</span>
        </div>

        <template v-if="auth.isSupabase">
          <!-- 登录 / 注册 切换 -->
          <div class="mb-5 flex rounded-[12px] bg-surface-2 p-1">
            <button
              class="flex-1 rounded-[9px] py-2 text-[13.5px] font-semibold transition-all"
              :class="mode === 'login' ? 'bg-surface text-ink shadow-sm' : 'text-muted'"
              @click="mode = 'login'"
            >登 录</button>
            <button
              class="flex-1 rounded-[9px] py-2 text-[13.5px] font-semibold transition-all"
              :class="mode === 'register' ? 'bg-surface text-ink shadow-sm' : 'text-muted'"
              @click="mode = 'register'"
            >注 册</button>
          </div>

          <!-- 注册模式:邀请码作为“注册验证码” -->
          <template v-if="isRegister">
            <h2 class="mb-1 text-[17px] font-semibold text-ink">首次加入,用邀请码注册</h2>
            <p class="muted mb-4 text-[12.5px]">邀请码由计划管理员发放;注册一次,以后直接用昵称+密码登录。</p>

            <label class="flabel" for="reg-code">注册邀请码</label>
            <input
              id="reg-code"
              v-model="code"
              class="field mb-4 font-mono tracking-widest"
              placeholder="TT-XXXX-XXX"
              maxlength="40"
              spellcheck="false"
              autocomplete="off"
            />

            <label class="flabel">昵称(登录名)</label>
            <input v-model="nickname" class="field mb-4" placeholder="例如:阿澈" maxlength="12" />

            <label class="flabel">设置密码(至少 4 位)</label>
            <input v-model="password" type="password" class="field mb-4" autocomplete="new-password" @keyup.enter="submit" />

            <p v-if="errorMsg" class="mb-3 rounded-[10px] bg-rose/10 px-3 py-2 text-[12.5px] text-rose">{{ errorMsg }}</p>
            <BaseButton block icon="fa-user-plus" :loading="busy" @click="submit">注册并进入</BaseButton>
          </template>

          <!-- 登录模式:昵称 + 密码 -->
          <template v-else>
            <h2 class="mb-1 text-[17px] font-semibold text-ink">欢迎回来</h2>
            <p class="muted mb-4 text-[12.5px]">老用户直接登录,不需要邀请码。</p>

            <label class="flabel" for="login-name">昵称</label>
            <input id="login-name" v-model="nickname" class="field mb-4" placeholder="注册时使用的昵称" maxlength="12" />

            <label class="flabel" for="login-pwd">密码</label>
            <input id="login-pwd" v-model="password" type="password" class="field mb-4" autocomplete="current-password" @keyup.enter="submit" />

            <p v-if="errorMsg" class="mb-3 rounded-[10px] bg-rose/10 px-3 py-2 text-[12.5px] text-rose">{{ errorMsg }}</p>
            <BaseButton block icon="fa-right-to-bracket" :loading="busy" @click="submit">登 录</BaseButton>
          </template>

          <!-- 管理员入口 -->
          <button
            class="mt-4 flex w-full items-center justify-center gap-2 text-[12.5px] font-semibold text-primary transition-opacity hover:opacity-80"
            @click="mode = 'register'; focusCode()"
          >
            <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
            管理员?切到「注册」输入管理员邀请码,登录后直达后台
          </button>
        </template>

        <!-- 演示模式 -->
        <template v-else>
          <h1 class="title-1 mb-1 text-[22px]">开始你的旅程</h1>
          <p class="mb-6 text-[13px] text-muted">当前为本地演示模式,数据保存在浏览器;配置 Supabase 后切换为「邀请码注册 + 账号登录」。</p>
          <label class="flabel">你的昵称</label>
          <input v-model="nickname" class="field mb-4" placeholder="例如:阿澈" maxlength="12" @keyup.enter="submit" />
          <BaseButton block icon="fa-right-to-bracket" @click="submit">进入兔兔同行</BaseButton>
        </template>
      </div>
    </div>
  </div>
</template>
