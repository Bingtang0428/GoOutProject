// ============================================================
// 用户状态
//  - Supabase 模式:由 api/auth 走 supabase.auth(email/password)
//  - 演示模式:直接写入本地用户(昵称即可体验)
// 统一产物为 { id, name, email? }
// ============================================================
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase, isSupabase } from '@/api/supabase'

const LS_KEY = 'tx:user'

function readLocalUser() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(readLocalUser())

  const isLoggedIn = computed(() => Boolean(user.value))

  /** 本地(演示)登录 */
  function loginLocal(nickname) {
    const name = (nickname || '').trim()
    const u = {
      id: 'u-' + Math.random().toString(36).slice(2, 8),
      name: name || '自驾队员',
      email: ''
    }
    user.value = u
    localStorage.setItem(LS_KEY, JSON.stringify(u))
    return u
  }

  /** Supabase 邮箱登录;成功后同步本地 user 便于持久会话 */
  async function loginWithSupabase(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    const meta = data.user?.user_metadata || {}
    const u = {
      id: data.user.id,
      name: meta.name || email.split('@')[0],
      email
    }
    user.value = u
    localStorage.setItem(LS_KEY, JSON.stringify(u))
    return u
  }

  /** 注册新账号(供 Supabase 模式使用) */
  async function signupWithSupabase(name, email, password) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } }
    })
    if (error) throw error
    return data
  }

  function logout() {
    user.value = null
    localStorage.removeItem(LS_KEY)
    if (supabase) supabase.auth.signOut().catch(() => {})
  }

  return { user, isLoggedIn, isSupabase, loginLocal, loginWithSupabase, signupWithSupabase, logout }
})
