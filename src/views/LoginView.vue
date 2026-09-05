<script setup>
// ============================================================
// 进入兔兔同行 —— 三类入口引导
//  - 登 录   :已有账号,昵称 + 密码(无需邀请码)
//  - 首次注册:邀请码引导向导(邀请码仅注册时使用)
//  - 管理员  :专门引导(管理员邀请码 → 注册后直达后台)
// 演示模式仍为昵称直达
// ============================================================
import { ref, watch, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useHead } from '@vueuse/head'
import { useAuthStore } from '@/stores/auth'
import { isSupabase, APP_VERSION } from '@/api/supabase'
import BaseButton from '@/components/ui/BaseButton.vue'

useHead({ title: '登录 · 兔兔同行自驾旅行企划' })

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const mode = ref('login') // login | register | admin(管理员模式复用注册,但更强调引导)
const nickname = ref('')
const password = ref('')
const code = ref('')
const errorMsg = ref('')
const busy = ref(false)

const needsCode = computed(() => mode.value === 'register' || mode.value === 'admin')

watch([nickname, password, code, mode], () => (errorMsg.value = ''))

const ENTRIES = [
  { key: 'login', icon: 'fa-right-to-bracket', label: '登录', desc: '老用户直接登录' },
  { key: 'register', icon: 'fa-user-plus', label: '首次注册', desc: '凭邀请码加入' },
  { key: 'admin', icon: 'fa-shield-halved', label: '管理员', desc: '后台管理入口' }
]

/* 注册向导文案(按目标给出步骤) */
const stepsFor = computed(() => {
  if (mode.value === 'register') {
    return [
      { icon: 'fa-key', text: '填写管理员发放的注册邀请码' },
      { icon: 'fa-signature', text: '设置昵称与登录密码(至少 4 位)' },
      { icon: 'fa-circle-check', text: '注册成功即自动进入对应计划' }
    ]
  }
  if (mode.value === 'admin') {
    return [
      { icon: 'fa-key', text: '输入管理员邀请码(由后台或内置种子发放)' },
      { icon: 'fa-signature', text: '首次请设置自己的昵称与密码' },
      { icon: 'fa-shield-halved', text: '此后每次都用 昵称+密码 登录并直达后台' }
    ]
  }
  return []
})

function submit() {
  if (busy.value) return
  if (!isSupabase) return enterDemo()
  mode.value === 'login' ? doLogin() : doRegister()
}

function enterDemo() {
  auth.loginLocal(nickname.value)
  routeTo(null)
}

async function doRegister() {
  if (password.value.length < 4) {
    errorMsg.value = '密码至少 4 位'
    return
  }
  if (!code.value.trim()) {
    errorMsg.value = mode.value === 'admin' ? '请输入管理员邀请码' : '请填写注册邀请码'
    return
  }
  errorMsg.value = ''
  busy.value = true
  try {
    const me = await auth.registerWithCode(nickname.value, password.value, code.value)
    routeTo(me)
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
    routeTo(me)
  } catch (e) {
    errorMsg.value = e?.message || '登录失败,请稍后重试'
  } finally {
    busy.value = false
  }
}

function routeTo(me) {
  // 管理员登录/注册后直达后台
  if (me?.role === 'admin') {
    router.replace('/admin')
    return
  }
  if (me?.invite_plan_id) {
    router.replace(`/plan/${me.invite_plan_id}`)
    return
  }
  const target = route.query.redirect
  if (typeof target === 'string' && target.startsWith('/') && target !== '/admin') router.replace(target)
  else router.replace('/')
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center p-3 py-6 sm:p-4">
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
            路线 / 食宿 / 分账 / 大交通<br />邀请码注册一次,之后直接登录
          </p>
        </div>
        <ul class="visual-sub space-y-1.5 text-[12.5px]">
          <li><i class="fa-solid fa-key mr-1.5" aria-hidden="true"></i>邀请码仅首次注册使用</li>
          <li><i class="fa-solid fa-lock mr-1.5" aria-hidden="true"></i>管理员入口有专门引导</li>
          <li><i class="fa-solid fa-users mr-1.5" aria-hidden="true"></i>同一码可设置多次使用</li>
        </ul>
      </div>

      <!-- 右侧 -->
      <div class="bg-surface p-5 sm:p-8">
        <div class="mb-3 flex items-center justify-between gap-2">
          <span class="muted text-[10.5px]">v{{ APP_VERSION }}</span>
          <span class="chip !px-2 !py-0.5 !text-[10.5px]" :class="isSupabase ? 'chip-success' : 'chip-amber'">
            <span class="dot"></span>{{ isSupabase ? '云端模式' : '本地演示模式' }}
          </span>
        </div>

        <div class="mb-5 flex items-center gap-3 md:hidden">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
            <i class="fa-solid fa-map-location-dot text-[16px]" aria-hidden="true"></i>
          </span>
          <span class="text-lg font-bold text-ink">兔兔同行 · 自驾旅行企划</span>
        </div>

        <!-- 演示模式 -->
        <template v-if="!isSupabase">
          <h1 class="title-1 mb-1 text-[22px]">开始你的旅程</h1>
          <p class="mb-6 text-[13px] text-muted">当前为本地演示模式(数据存浏览器);配置 Supabase 后将切换为正式登录/注册。</p>
          <label class="flabel">你的昵称</label>
          <input v-model="nickname" class="field mb-4" placeholder="例如:阿澈" maxlength="12" @keyup.enter="submit" />
          <BaseButton block icon="fa-right-to-bracket" @click="submit">进入兔兔同行</BaseButton>
        </template>

        <template v-else>
          <!-- 三种身份选择 -->
          <div class="mb-5 grid grid-cols-3 gap-2">
            <button
              v-for="e in ENTRIES"
              :key="e.key"
              type="button"
              class="flex flex-col items-center gap-1.5 rounded-[14px] border-2 px-2 py-3 transition-all duration-200 active:scale-95"
              :class="
                mode === e.key
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-line text-muted hover:border-primary/40 hover:text-ink-soft'
              "
              @click="mode = e.key"
            >
              <i :class="`fa-solid ${e.icon}`" class="text-[16px]" aria-hidden="true"></i>
              <span class="text-[12px] font-bold leading-none">{{ e.label }}</span>
              <span class="hidden text-[10px] font-normal opacity-75 sm:block">{{ e.desc }}</span>
            </button>
          </div>

          <!-- ============ 首次注册 / 管理员 注册向导 ============ -->
          <Transition name="fade" mode="out-in">
            <div v-if="mode !== 'login'" :key="mode" class="fade-up">
              <!-- 引导步骤 -->
              <ol class="mb-4 space-y-1.5">
                <li
                  v-for="(s, i) in stepsFor"
                  :key="i"
                  class="flex items-center gap-2.5 text-[12.5px]"
                  :class="i === 0 ? 'font-semibold text-ink' : 'text-ink-soft'"
                >
                  <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px]"
                    :class="i === 0 ? 'bg-primary text-white' : 'bg-surface-2 text-muted'"
                  >{{ i + 1 }}</span>
                  <i :class="`fa-solid ${s.icon} text-primary/70`" aria-hidden="true"></i>
                  {{ s.text }}
                </li>
              </ol>

              <div
                class="mb-4 rounded-[16px] border-2 p-3.5 transition-colors"
                :class="errorMsg && !code ? 'border-rose/60' : 'border-primary/25 focus-within:border-primary/60'"
              >
                <label class="flabel flex items-center gap-1.5" for="auth-code">
                  <i class="fa-solid fa-key text-primary" aria-hidden="true"></i>
                  {{ mode === 'admin' ? '管理员邀请码' : '注册邀请码' }}
                </label>
                <input
                  id="auth-code"
                  v-model="code"
                  class="w-full bg-transparent text-center font-mono text-[19px] font-bold uppercase tracking-[0.2em] text-ink outline-none"
                  :placeholder="mode === 'admin' ? 'ADMIN-XXXX-XXX' : 'TT-XXXX-XXX'"
                  maxlength="40"
                  spellcheck="false"
                  autocomplete="off"
                />
              </div>

              <label class="flabel" for="auth-name">昵称(也是以后的登录名)</label>
              <input id="auth-name" v-model="nickname" class="field mb-3" placeholder="例如:阿澈" maxlength="12" />

              <label class="flabel" for="auth-pwd">设置密码(至少 4 位)</label>
              <input
                id="auth-pwd"
                v-model="password"
                type="password"
                class="field mb-3"
                autocomplete="new-password"
                placeholder="以后登录就靠它"
                @keyup.enter="submit"
              />

              <p v-if="errorMsg" class="mb-3 rounded-[10px] bg-rose/10 px-3 py-2 text-[12.5px] text-rose">
                <i class="fa-solid fa-circle-exclamation mr-1" aria-hidden="true"></i>{{ errorMsg }}
              </p>
              <BaseButton
                block
                :icon="mode === 'admin' ? 'fa-shield-halved' : 'fa-user-plus'"
                :loading="busy"
                @click="submit"
              >
                {{ mode === 'admin' ? '注册为管理员并进入后台' : '注册并进入' }}
              </BaseButton>
              <p v-if="mode === 'admin'" class="muted mt-3 text-center text-[11.5px] leading-relaxed">
                管理员邀请码由后台发放并限制次数;<br />首次注册后,以后直接在「登录」页用 昵称+密码 进入后台。
              </p>
            </div>

            <!-- ============ 登录 ============ -->
            <div v-else :key="'login'" class="fade-up">
              <h2 class="mb-1 text-[17px] font-semibold text-ink">欢迎回来</h2>
              <p class="muted mb-4 text-[12.5px]">老用户直接登录,不需要邀请码。</p>

              <label class="flabel" for="login-name">昵称</label>
              <input id="login-name" v-model="nickname" class="field mb-3" placeholder="注册时使用的昵称" maxlength="12" />

              <label class="flabel" for="login-pwd">密码</label>
              <input
                id="login-pwd"
                v-model="password"
                type="password"
                class="field mb-3"
                autocomplete="current-password"
                placeholder="登录密码"
                @keyup.enter="submit"
              />

              <p v-if="errorMsg" class="mb-3 rounded-[10px] bg-rose/10 px-3 py-2 text-[12.5px] text-rose">
                <i class="fa-solid fa-circle-exclamation mr-1" aria-hidden="true"></i>{{ errorMsg }}
              </p>
              <BaseButton block icon="fa-right-to-bracket" :loading="busy" @click="submit">登 录</BaseButton>

              <p class="muted mt-4 text-center text-[12px]">
                还没有账号?
                <button class="font-semibold text-primary hover:underline" @click="mode = 'register'">去「首次注册」拿邀请码加入</button>
              </p>
            </div>
          </Transition>
        </template>
      </div>
    </div>
  </div>
</template>
