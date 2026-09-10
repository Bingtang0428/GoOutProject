// ============================================================
// 计划在线状态 + 逐模块「正在编辑」提示(Supabase Realtime Presence)
// 不可用时静默降级,不影响页面。
// ============================================================
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase, isSupabase } from '@/api/supabase'
import { useAuthStore } from '@/stores/auth'

export const usePresenceStore = defineStore('presence', () => {
  const users = ref([]) // [{ id, name, editing }]
  const editing = ref(null) // 我当前正在编辑的模块
  let channel = null

  function connect(planId) {
    disconnect()
    const auth = useAuthStore()
    if (!isSupabase || !supabase || !auth.user || !planId) return
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
              list.push({ id: p.id, name: p.name, editing: p.editing || null })
            }
          }
        }
        users.value = list
      }
      channel.on('presence', { event: 'sync' }, sync)
      channel.on('presence', { event: 'join' }, sync)
      channel.on('presence', { event: 'leave' }, sync)
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({ id: auth.user.id, name: auth.user.name, editing: editing.value })
          } catch {
            /* ignore */
          }
        }
      })
    } catch {
      channel = null
    }
  }

  function disconnect() {
    if (channel) {
      try {
        supabase.removeChannel(channel)
      } catch {
        /* ignore */
      }
    }
    channel = null
    users.value = []
    editing.value = null
  }

  /** 设置我当前正在编辑的模块(路由/食宿/分账/大交通…),null 表示退出编辑 */
  async function setEditing(section) {
    editing.value = section
    const auth = useAuthStore()
    if (channel && auth.user) {
      try {
        await channel.track({ id: auth.user.id, name: auth.user.name, editing: section })
      } catch {
        /* ignore */
      }
    }
  }

  /** 除我之外,正在编辑某模块的成员 */
  function editors(section) {
    const auth = useAuthStore()
    return users.value.filter((u) => u.editing === section && u.id !== auth.user?.id)
  }

  return { users, editing, connect, disconnect, setEditing, editors }
})
