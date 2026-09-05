// ============================================================
// 账号体系
//  - Supabase 模式:
//      注册(首次)= 昵称 + 密码 + 邀请码(验证码),由数据库函数
//        register_account 原子完成:校验邀请码→扣次数→建账号→
//        自动加入邀请码绑定的计划名单。
//      登录(之后)= 昵称 + 密码,不再需要邀请码。
//  - 演示模式:昵称直达(纯本地)
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
      role: 'member'
    }
    persist(u)
    return u
  }

  /** ★ 注册:昵称 + 密码 + 邀请码(数据库端原子处理) */
  async function registerWithCode(nickname, password, code) {
    if (!isSupabase) return { ...loginLocal(nickname), role: 'member' }
    const name = (nickname || '').trim()
    const pwd = password || ''
    const raw = String(code || '').trim().toUpperCase()
    if (!name) throw new Error('请输入昵称')
    if (pwd.length < 4) throw new Error('密码至少 4 位')
    if (!raw) throw new Error('请输入邀请码')

    const { data, error } = await supabase.rpc('register_account', {
      p_name: name,
      p_password: pwd,
      p_code: raw
    })
    if (error) throw new Error('注册服务暂不可用,请稍后重试')
    if (!data?.ok) {
      const reason = {
        name_taken: '该昵称已被注册,换一个或直接登录',
        invite_not_found: '邀请码不存在,请联系管理员',
        invite_revoked: '该邀请码已被撤销',
        invite_exhausted: '该邀请码次数已用完'
      }[data?.reason] || '注册失败'
      throw new Error(reason)
    }
    const u = { id: data.id, name: data.name || name, role: data.role, invite_plan_id: data.plan_id || null }
    persist(u)
    return u
  }

  /** ★ 登录:昵称 + 密码(不需要邀请码) */
  async function loginWithPassword(nickname, password) {
    if (!isSupabase) return { ...loginLocal(nickname), role: 'member' }
    const name = (nickname || '').trim()
    if (!name) throw new Error('请输入昵称')
    if (!password) throw new Error('请输入密码')

    const { data, error } = await supabase.rpc('login_account', {
      p_name: name,
      p_password: password
    })
    if (error) throw new Error('登录服务暂不可用,请稍后重试')
    if (!data?.ok) {
      const reason = {
        account_not_found: '账号不存在,请先用邀请码注册',
        wrong_password: '昵称或密码不正确',
        account_disabled: '该账号已被管理员停用,请联系管理员'
      }[data?.reason] || '登录失败'
      throw new Error(reason)
    }
    const u = { id: data.id, name: data.name || name, role: data.role }
    persist(u)
    return u
  }

  function logout() {
    user.value = null
    localStorage.removeItem(LS_KEY)
    if (supabase) supabase.auth.signOut().catch(() => {})
  }

  return { user, isLoggedIn, isAdmin, loginLocal, registerWithCode, loginWithPassword, logout }
})
