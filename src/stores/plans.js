// ============================================================
// 计划集合状态
// 负责 计划(plans)的增删改、成员/权限管理、当前计划记忆。
//
// ★ 权限模型(三个角色):
//   创建者 owner_id —— 唯一可编辑计划元信息/删除/管理权限
//   参与者 members  —— 可编辑计划内容(路线/食宿/待办/攻略/分账/评论)
//   围观者 viewers  —— 只读查看全部内容,界面隐藏所有编辑入口
//
//   - Supabase 模式:同步 public.plans 表(owner_id/members/viewers 三字段)
//   - 演示模式:同步 localStorage;演示计划与本人角色不匹配时,
//     页面会提供「以参与者身份加入」入口(joinAsParticipant)
// ============================================================
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { uid, makeUuid, isUuid } from '@/utils/misc'
import { supabase, isSupabase } from '@/api/supabase'
import * as localDb from '@/api/localDb'
import { useAuthStore } from '@/stores/auth'

const CURRENT_KEY = 'tx:current-plan'
const TRASH_KEY = 'tx:trash-plans' // 演示模式:回收站(计划快照,内容仍在各自 key 下)

/** 回收站条目:{ id, name, at, plan } */
function readTrash() {
  return localDb.read(TRASH_KEY) || []
}
function writeTrash(list) {
  localDb.write(TRASH_KEY, list)
}

export const usePlansStore = defineStore('plans', () => {
  const auth = useAuthStore()

  // —— 本地兜底:演示模式会话内缓存
  let localCache = null

  const plans = ref([])
  const currentId = ref(localStorage.getItem(CURRENT_KEY) || null)
  const loaded = ref(false)

  const currentPlan = computed(() => plans.value.find((p) => p.id === currentId.value) || null)

  /** 参与者 + 围观者 全体人员(用于分账、头像等) */
  const peopleOf = (plan) => [
    ...(plan?.members || []),
    ...(plan?.viewers || [])
  ]

  /** 兼容旧数据:补齐 owner_id/members/viewers 字段 */
  function normalize(p) {
    if (!p.members || !Array.isArray(p.members)) p.members = []
    if (!p.viewers || !Array.isArray(p.viewers)) p.viewers = []
    if (!p.owner_id) {
      // 旧数据无创建者:以第一位参与者作为创建者
      p.owner_id = p.members[0]?.id || null
    }
    return p
  }

  function ensureLocal() {
    if (!localCache) localCache = localDb.loadPlans().map(normalize)
    return localCache
  }

  /** 应用启动时调用一次:载入计划列表 */
  async function init() {
    if (loaded.value) return
    if (!isSupabase) {
      plans.value = ensureLocal()
    } else {
      // Supabase:订阅 plans 表实时变更 + 首次拉取
      const { data, error } = await supabase.from('plans').select('*').order('created_at', { ascending: false })
      if (!error) plans.value = (data || []).map(normalize)
      const ch = supabase
        .channel('plans-list')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'plans' }, (payload) => applyRemote(payload))
        .subscribe()
      window.addEventListener('beforeunload', () => supabase.removeChannel(ch))
    }
    loaded.value = true
    if (!currentId.value && plans.value.length) currentId.value = plans.value[0].id
  }

  function setCurrent(id) {
    currentId.value = id
    localStorage.setItem(CURRENT_KEY, id || '')
  }

  async function applyRemote({ eventType, old, new: row }) {
    normalize(row)
    const idx = plans.value.findIndex((p) => p.id === row.id)
    if (eventType === 'INSERT') {
      if (idx === -1) plans.value.unshift(row)
    } else if (eventType === 'UPDATE') {
      if (idx !== -1) plans.value[idx] = { ...plans.value[idx], ...row }
    } else if (eventType === 'DELETE') {
      plans.value = plans.value.filter((p) => p.id !== old.id)
      if (currentId.value === old.id) setCurrent(plans.value[0]?.id || null)
    }
  }

  // ------------------------------------------------------------
  // 权限计算(按 id 优先,演示模式附名字兜底匹配)
  // ------------------------------------------------------------
  function myRole(plan) {
    const me = auth.user
    if (!me || !plan) return null
    const eq = (m) => m && (m.id === me.id || m.name === me.name)
    // 创建者:owner_id 命中 id;演示种子无该 id 时按该创建者名字匹配
    const ownerName = plan.members?.find((m) => m.id === plan.owner_id)?.name
    if (me.id === plan.owner_id || (ownerName && me.name === ownerName)) return 'owner'
    if (plan.members?.some(eq)) return 'member'
    if (plan.viewers?.some(eq)) return 'viewer'
    return null // 未加入(可申请成为参与者)
  }

  const isManager = (plan) => myRole(plan) === 'owner'
  const canEditContent = (plan) => {
    const r = myRole(plan)
    return r === 'owner' || r === 'member'
  }

  // ------------------------------------------------------------
  // 计划 CRUD
  // ------------------------------------------------------------
  async function createPlan(payload) {
    const me = auth.user
    const self = me ? { id: me.id, name: me.name } : { id: uid('m'), name: '我' }
    const members = payload.members?.length
      ? payload.members
      : [self]
    // 创建者必须在参与者名单中
    if (!members.some((m) => m.id === self.id)) members.unshift(self)
    const planId = isSupabase ? makeUuid() : uid()
    const row = {
      id: planId,
      name: payload.name,
      destination: payload.destination || '',
      start_city: payload.start_city || '',
      start_date: payload.start_date,
      end_date: payload.end_date,
      gradient: payload.gradient ?? 0,
      budget: payload.budget ?? null,
      owner_id: self.id,
      members,
      viewers: []
    }
    if (!isSupabase) {
      const list = ensureLocal()
      list.unshift(row)
      localDb.savePlans(list)
      plans.value = list.slice()
    } else {
      const { data, error } = await supabase.from('plans').insert(row).select().single()
      if (error) {
        console.warn('[plans] 创建失败', error.message)
        throw error
      }
      row.id = data.id // 与订阅事件保持幂等
    }
    setCurrent(row.id)
    return row
  }

  async function updatePlan(id, payload) {
    const idx = plans.value.findIndex((p) => p.id === id)
    if (!isSupabase) {
      const list = ensureLocal()
      const target = list.find((p) => p.id === id)
      if (target) Object.assign(target, payload)
      localDb.savePlans(list)
      if (idx !== -1) plans.value[idx] = { ...plans.value[idx], ...payload }
    } else {
      // ★ 乐观更新:界面立即生效;失败回滚
      const before = idx !== -1 ? { ...plans.value[idx] } : null
      if (idx !== -1) plans.value[idx] = { ...plans.value[idx], ...payload }
      const { error } = await supabase.from('plans').update(payload).eq('id', id)
      if (error) {
        if (idx !== -1 && before) plans.value[idx] = before
        console.warn('[plans] 更新失败', error.message)
        throw error
      }
    }
  }

  async function removePlan(id) {
    if (!isSupabase) {
      const list = ensureLocal()
      const target = list.find((p) => p.id === id)
      // 演示模式:进回收站(可恢复),内容数据保留在原键上
      if (target) {
        const trashList = readTrash().filter((t) => t.id !== id)
        trashList.push({ id, name: target.name, at: Date.now(), plan: target })
        writeTrash(trashList)
        trash.value = trashList
      }
      const kept = list.filter((p) => p.id !== id)
      localCache = kept
      localDb.savePlans(kept)
      plans.value = kept.slice()
    } else {
      await supabase.from('plans').delete().eq('id', id) // 级联删除全部子表
    }
    if (currentId.value === id) setCurrent(plans.value[0]?.id || null)
  }

  // ------------------------------------------------------------
  // 回收站(仅本地演示模式;远端为硬删除,请谨慎)
  // ------------------------------------------------------------
  const trash = ref(readTrash())

  /** 从回收站恢复一份计划(内容数据仍在原 key,直接归位) */
  async function restorePlan(id) {
    const entry = trash.value.find((t) => t.id === id)
    if (!entry) return
    if (!isSupabase) {
      const list = ensureLocal()
      if (!list.some((p) => p.id === id)) {
        normalize(entry.plan)
        list.unshift(entry.plan)
        localDb.savePlans(list)
        plans.value = list.slice()
      }
      trash.value = trash.value.filter((t) => t.id !== id)
      writeTrash(trash.value)
      setCurrent(id)
    }
  }

  /** 永久删除(同时清掉其内容数据) */
  function purgePlan(id) {
    trash.value = trash.value.filter((t) => t.id !== id)
    writeTrash(trash.value)
    if (!isSupabase) localDb.dropPlan(id)
  }

  function clearTrash() {
    for (const t of trash.value) localDb.dropPlan(t.id)
    trash.value = []
    writeTrash(trash.value)
  }

  // ------------------------------------------------------------
  // 人员 / 权限管理(仅创建者可操作;前台已做入口控制)
  // ------------------------------------------------------------
  function roleLists(plan) {
    return {
      members: [...(plan.members || [])],
      viewers: [...(plan.viewers || [])]
    }
  }

  async function applyRoleChange(planId, lists) {
    await updatePlan(planId, { members: lists.members, viewers: lists.viewers })
    return lists
  }

  /** 邀请某人成为参与者(在围观者中则自动晋升) */
  async function inviteParticipant(planId, nameOrUser) {
    const plan = plans.value.find((p) => p.id === planId)
    const name = typeof nameOrUser === 'string' ? nameOrUser.trim() : nameOrUser?.name
    if (!plan || !name) return
    const lists = roleLists(plan)
    if (lists.members.some((m) => m.name === name)) return
    // 从围观者名单中移除同人(晋升)
    lists.viewers = lists.viewers.filter((v) => v.name !== name)
    lists.members.push(typeof nameOrUser === 'string' ? { id: uid('m'), name } : nameOrUser)
    await applyRoleChange(planId, lists)
  }

  /** 邀请某人成为围观者 */
  async function inviteViewer(planId, nameOrUser) {
    const plan = plans.value.find((p) => p.id === planId)
    const name = typeof nameOrUser === 'string' ? nameOrUser.trim() : nameOrUser?.name
    if (!plan || !name) return
    const lists = roleLists(plan)
    if (lists.viewers.some((v) => v.name === name)) return
    lists.members = lists.members.filter((m) => m.name !== name)
    lists.viewers.push(typeof nameOrUser === 'string' ? { id: uid('v'), name } : nameOrUser)
    await applyRoleChange(planId, lists)
  }

  /** 调整某人角色:participant(参与者)/ viewer(围观者) */
  async function setPersonRole(planId, personId, toRole) {
    const plan = plans.value.find((p) => p.id === planId)
    if (!plan || personId === plan.owner_id) return // 创建者不可降级
    const lists = roleLists(plan)
    const fromBoth = (from) => from.filter((x) => x.id !== personId)
    const person = [...lists.members, ...lists.viewers].find((x) => x.id === personId)
    if (!person) return
    if (toRole === 'participant') {
      lists.members = [...lists.members, person]
      lists.viewers = fromBoth(lists.viewers)
    } else {
      lists.viewers = [...lists.viewers, person]
      lists.members = fromBoth(lists.members)
    }
    await applyRoleChange(planId, lists)
  }

  /** 移出计划 */
  async function removePerson(planId, personId) {
    const plan = plans.value.find((p) => p.id === planId)
    if (!plan || personId === plan.owner_id) return
    const lists = roleLists(plan)
    lists.members = lists.members.filter((x) => x.id !== personId)
    lists.viewers = lists.viewers.filter((x) => x.id !== personId)
    await applyRoleChange(planId, lists)
  }

  /** 本人以参与者身份加入(未匹配到角色的访客使用) */
  async function joinAsParticipant(planId) {
    const me = auth.user
    if (!me) return
    await inviteParticipant(planId, { id: me.id, name: me.name })
  }

  return {
    plans,
    currentId,
    currentPlan,
    loaded,
    init,
    setCurrent,
    createPlan,
    updatePlan,
    removePlan,
    myRole,
    isManager,
    canEditContent,
    peopleOf,
    inviteParticipant,
    inviteViewer,
    setPersonRole,
    removePerson,
    joinAsParticipant,
    trash,
    restorePlan,
    purgePlan,
    clearTrash
  }
})
