// ============================================================
// 计划在线状态(Supabase Realtime Presence)
// 显示当前正在查看同一计划的成员;不可用时静默降级。
// ============================================================
import { supabase, isSupabase } from '@/api/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * @param {string} planId
 * @param {(list:Array<{id,name}>)=>void} onChange
 * @returns {{ dispose: () => void }}
 */
export function createPresence(planId, onChange) {
  const auth = useAuthStore()
  if (!isSupabase || !supabase || !auth.user) return { dispose() {} }
  let channel
  try {
    channel = supabase.channel(`presence-plan-${planId}`, {
      config: { presence: { key: auth.user.id } }
    })
    const sync = () => {
      let state = {}
      try {
        state = channel.presenceState()
      } catch {
        return
      }
      const seen = new Set()
      const list = []
      for (const k of Object.keys(state)) {
        for (const p of state[k]) {
          if (p && p.id && !seen.has(p.id)) {
            seen.add(p.id)
            list.push({ id: p.id, name: p.name })
          }
        }
      }
      onChange(list)
    }
    channel.on('presence', { event: 'sync' }, sync)
    channel.on('presence', { event: 'join' }, sync)
    channel.on('presence', { event: 'leave' }, sync)
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await channel.track({ id: auth.user.id, name: auth.user.name })
        } catch {
          /* ignore */
        }
      }
    })
  } catch {
    return { dispose() {} }
  }
  return {
    dispose() {
      try {
        supabase.removeChannel(channel)
      } catch {
        /* ignore */
      }
    }
  }
}
