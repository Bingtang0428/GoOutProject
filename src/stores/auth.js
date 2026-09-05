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
   * 1) 校验 invite_codes:码存在、未撤销、未被使用
   * 2) 原子占用该码(写入 used_by/used_at)
   * 3) 建立本地会话;若码绑定计划,调用方负责把该人加入对应名单
   */
  async function loginWithInviteCode(nickname, code) {
    if (!isSupabase) {
      // 演示模式:任何昵称直达(码仅作占位体验)
      return { ...loginLocal(nickname), role: 'member' }
    }
    const raw = String(code || '').trim()
    if (!raw) throw new Error('请输入邀请码')
    const name = (nickname || '').trim() || '旅行伙伴'

    const { data: row, error } = await supabase
      .from('invite_codes')
      .select('id, code, role, plan_id, used_by, used_at, revoked')
      .eq('code', raw)
      .maybeSingle()
    if (error) throw new Error('校验邀请码失败,请稍后重试')
    if (!row) throw new Error('邀请码不存在,请联系管理员')
    if (row.revoked) throw new Error('该邀请码已被撤销')
    if (row.used_by) throw new Error('该邀请码已被使用,无法重复登录')

    const me = { id: makeUuid(), name }
    const { error: claimErr } = await supabase
      .from('invite_codes')
      .update({ used_by: me, used_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('used_by', null) // 防止并发重复占用
      .eq('revoked', false)
    if (claimErr) throw new Error('邀请码占用失败,请重试')
    if (!claimErr) {
      // 确认占用成功(update 影响行数无法直接读取,重新读一次)
      const { data: check } = await supabase
        .from('invite_codes')
        .select('used_by')
        .eq('id', row.id)
        .maybeSingle()
      if (!check?.used_by || check.used_by.id !== me.id) {
        throw new Error('邀请码使用冲突,请刷新后重试')
      }
    }

    const u = { ...me, role: row.role, invite_id: row.id, invite_plan_id: row.plan_id || null }
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
