<script setup>
// ============================================================
// 登录页:演示模式(昵称直达) / Supabase 模式(邮箱注册登录)
// ============================================================
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useHead } from '@vueuse/head'
import { useAuthStore } from '@/stores/auth'
import BaseButton from '@/components/ui/BaseButton.vue'

useHead({ title: '登录 · 兔兔同行自驾旅行企划' })

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const nickname = ref('')
const mode = ref('login') // login | register(仅 Supabase 模式)
const email = ref('')
const password = ref('')
const errorMsg = ref('')
const busy = ref(false)

async function enterDemo() {
  auth.loginLocal(nickname.value || '自驾队员')
  const target = route.query.redirect
  if (typeof target === 'string' && target.startsWith('/')) router.replace(target)
  else router.replace('/')
}

async function submitSupabase() {
  if (!email.value || !password.value) return
  errorMsg.value = ''
  busy.value = true
  try {
    if (mode.value === 'register') {
      await auth.signupWithSupabase(nickname.value || email.value.split('@')[0], email.value, password.value)
      errorMsg.value = '注册成功,请返回登录(或确认邮箱验证链接后重试)'
    } else {
      await auth.loginWithSupabase(email.value, password.value)
      router.replace('/')
    }
  } catch (e) {
    errorMsg.value = e?.message || '登录失败,请检查邮箱与密码'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center p-4">
    <div class="grid w-full max-w-4xl overflow-hidden rounded-card shadow-card md:grid-cols-2">
      <!-- 左侧品牌视觉(桌面) -->
      <div class="visual hidden flex-col justify-between p-8 md:flex" style="--vg1: #f9dfe7; --vg2: #f2cad8">
        <div class="flex items-center gap-3">
          <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-lg">
            <i class="fa-solid fa-map-location-dot text-[19px]" aria-hidden="true"></i>
          </span>
          <div class="visual-title">
            <p class="text-xl font-bold leading-none">同行</p>
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
          <p class="visual-sub text-[12px]"><i class="fa-solid fa-users mr-1.5" aria-hidden="true"></i>多人实时协作 · 云端保存</p>
      </div>

      <!-- 右侧表单 -->
      <div class="bg-surface p-8 sm:p-10">
        <div class="mb-7 flex items-center gap-3 md:hidden">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
            <i class="fa-solid fa-map-location-dot text-[16px]" aria-hidden="true"></i>
          </span>
          <span class="text-lg font-bold text-ink">兔兔同行 · 自驾旅行企划</span>
        </div>

        <!-- Supabase 邮箱模式 -->
        <template v-if="auth.isSupabase">
          <div class="mb-5 flex rounded-[12px] bg-surface-2 p-1">
            <button
              class="flex-1 rounded-[9px] py-2 text-[13.5px] font-semibold transition-all"
              :class="mode === 'login' ? 'bg-surface text-ink shadow-sm' : 'text-muted'"
              @click="mode = 'login'"
            >登录</button>
            <button
              class="flex-1 rounded-[9px] py-2 text-[13.5px] font-semibold transition-all"
              :class="mode === 'register' ? 'bg-surface text-ink shadow-sm' : 'text-muted'"
              @click="mode = 'register'"
            >注册</button>
          </div>

          <label class="flabel">昵称</label>
          <input v-model="nickname" class="field mb-4" placeholder="你的称呼" maxlength="12" />

          <label class="flabel">邮箱</label>
          <input v-model="email" type="email" class="field mb-4" placeholder="you@example.com" autocomplete="email" />

          <label class="flabel">密码</label>
          <input v-model="password" type="password" class="field mb-3" placeholder="至少 6 位" autocomplete="current-password" @keyup.enter="submitSupabase" />

          <p v-if="errorMsg" class="mb-3 rounded-[10px] bg-rose/10 px-3 py-2 text-[12.5px] text-rose">{{ errorMsg }}</p>

          <BaseButton block icon="fa-right-to-bracket" :loading="busy" @click="submitSupabase">
            {{ mode === 'login' ? '登 录' : '注 册' }}
          </BaseButton>

          <p class="mt-5 text-center text-[12px] text-muted">
            想先逛逛?<button class="font-semibold text-primary hover:underline" @click="enterDemo">以演示身份体验</button>
          </p>
        </template>

        <!-- 演示模式:昵称直达 -->
        <template v-else>
          <h1 class="title-1 mb-1 text-[22px]">开始你的旅程</h1>
          <p class="mb-6 text-[13px] text-muted">
            当前为本地演示模式,数据保存在浏览器;<br />
            配置 Supabase 环境变量后即切换云端多人协作。
          </p>
          <label class="flabel">你的昵称</label>
          <input v-model="nickname" class="field mb-4" placeholder="例如:阿澈" maxlength="12" @keyup.enter="enterDemo" />
          <BaseButton block icon="fa-right-to-bracket" @click="enterDemo">进入兔兔同行</BaseButton>
          <p class="mt-6 text-center text-[12px] leading-relaxed text-muted">
            已内置一份演示计划「环皖南 · 徽州秋色自驾」<br />包含路线、食宿、待办、攻略与提醒
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
