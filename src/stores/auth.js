// ============================================================
// 用户状态
// 登录方式:
//  - Supabase 模式 → 「昵称 + 一次性邀请码」(由管理员在后台生成)
//  - 演示模式     → 昵称直达(纯本地)
// 产物: { id, name, role?: 'admin'|'member'|'viewer', email? }
// ============================================================
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { makeUuid } from '@/utils/misc'
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
  const isAdmin = computed(() => user.value?.role === 'admin')

  function persist(u) {
    user.value = u
    localStorage.setItem(LS_KEY, JSON.stringify(u))
  }

  /** 本地(演示)登录 */
  function loginLocal(nickname) {
    const name = (nickname || '').trim()
    const u = {
      id: 'u-' + Math.random().toString(36).slice(2, 8),
      name: name || '旅行伙伴',
      email: '',
      role: 'member'
    }
    persist(u)
    return u
  }

  /**
   * ★ 邀请码登录(Supabase 模式)
   * 通过数据库函数 claim_invite 原子占用(支持使用次数 1-100)
   */
  async function loginWithInviteCode(nickname, code) {
    if (!isSupabase) {
      // 演示模式:任何昵称直达(码仅作占位体验)
      return { ...loginLocal(nickname), role: 'member' }
    }
    const raw = String(code || '').trim().toUpperCase()
    if (!raw) throw new Error('请输入邀请码')
    const name = (nickname || '').trim() || '旅行伙伴'
    const me = { id: makeUuid(), name }

    const { data, error } = await supabase.rpc('claim_invite', { p_code: raw, p_user: me })
    if (error) throw new Error('校验邀请码失败,请稍后重试')
    if (!data?.ok) {
      const reason = {
        invite_not_found: '邀请码不存在,请联系管理员',
        invite_revoked: '该邀请码已被撤销',
        invite_exhausted: '该邀请码使用次数已用完'
      }[data?.reason] || '邀请码不可用'
      throw new Error(reason)
    }

    const u = {
      ...me,
      role: data.role,
      invite_id: data.id || null,
      invite_plan_id: data.plan_id || null,
      invite_remaining: data.remaining ?? 0
    }
    persist(u)
    return u
  }

  function logout() {
    user.value = null
    localStorage.removeItem(LS_KEY)
    if (supabase) supabase.auth.signOut().catch(() => {})
  }

  return { user, isLoggedIn, isAdmin, loginLocal, loginWithInviteCode, logout }
})
