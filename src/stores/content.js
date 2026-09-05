// ============================================================
// 计划内容状态(路线/食宿/TODO/攻略/提醒)
//
// ★ 与 Supabase 的交互说明(关键部分均有注释)
//   - 每个计划打开时 ensureLoaded():首次拉取 5 张表数据,
//     并创建一条 postgres_changes 实时通道(按 plan_id 过滤);
//     其它协作者的写入会通过 subscribeRows 的 payload 自动
//     合并进本地响应式缓存(幂等:按 id 增改删)。
//   - 所有写操作采用「本地先更新 + 远端同步」:
//       演示模式 → localStorage 直写,立即生效
//       Supabase → 先乐观更新本地缓存,再 await 远端;
//       远端事件回流时因按 id 幂等合并,不会重复。
//   - 离开计划视图时 detachRemote(planId) 释放通道。
// ============================================================
import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { uid, makeUuid, isUuid } from '@/utils/misc'
import { supabase, isSupabase } from '@/api/supabase'
import * as localDb from '@/api/localDb'
import { eachDayISO } from '@/utils/date'

/** 实体 key ↔ Supabase 表名 映射 */
const TABLES = {
  days: 'route_days',
  stays: 'stays',
  todos: 'todos',
  guides: 'guides',
  reminders: 'reminders',
  bills: 'bills', // 分账
  comments: 'comments', // 行程建议评论
  transits: 'transits', // 大交通企划
  vehicle: 'vehicles', // 车辆(每计划一行)
  fuel: 'fuel_logs' // 加油里程记录
}

const CONTENT_KEYS = Object.keys(TABLES)

const EMPTY = () => ({
  days: [],
  stays: [],
  todos: [],
  guides: [],
  reminders: [],
  bills: [],
  comments: [],
  transits: [],
  vehicle: [],
  fuel: []
})

export const useContentStore = defineStore('content', () => {
  // planId -> { days[], stays[], todos[], guides[], reminders[] }
  const rows = reactive({})
  const channels = {}
  const pollTimers = {} // 实时通道不可用时的兜底轮询

  async function pollRemote(planId) {
    // 网络不允许 WebSocket(实时通道 CLOSED)时,退化为周期性拉取,
    // 保证「他人改动 / 本机刷新」能自愈同步
    for (const [key, table] of Object.entries(TABLES)) {
      const { data, error } = await supabase.from(table).select('*').eq('plan_id', planId)
      if (!error && data && rows[planId]) rows[planId][key] = data
    }
  }

  function ensureBucket(planId) {
    if (!rows[planId]) rows[planId] = EMPTY()
    return rows[planId]
  }

  /** 读取响应式缓存;未加载时返回空数组 */
  function rowsOf(planId, key) {
    return rows[planId]?.[key] || []
  }

  // ------------------------------------------------------------
  // 底层持久化原语
  // ------------------------------------------------------------

  function applyById(planId, key, row) {
    // 远端事件/乐观更新共用:按 id 幂等合并
    const list = rows[planId][key]
    const idx = list.findIndex((r) => r.id === row.id)
    if (idx === -1) list.unshift(row)
    else list[idx] = { ...list[idx], ...row }
  }

  async function persistLocal(planId, key, fn) {
    const list = localDb.loadContent(planId, key).slice()
    fn(list)
    localDb.saveContent(planId, key, list)
    rows[planId][key] = list // 替换引用触发响应式更新
    return list
  }

  /** 写远端(超表):以本地先行,远端结果再回流合并;返回写入行 */
  async function remoteWrite(planId, table, key, row) {
    if (isSupabase && !isUuid(row.id)) {
      // ★ 数据库 uuid 列只接受纯 UUID;演示前缀 id(day-…/bill-…)在云端自动替换
      row = { ...row, id: makeUuid() }
    }
    if (!isSupabase) {
      await persistLocal(planId, key, (l) => l.unshift(row))
      return row
    }
    // ★ 先乐观写入本地(界面立即出现,不等网络/实时通道),失败再回退
    const bucket = ensureBucket(planId)
    const optimisticId = row.id
    applyById(planId, key, row)
    const { data, error } = await supabase.from(table).insert(row).select().single()
    if (error) {
      bucket[key] = bucket[key].filter((r) => r.id !== optimisticId) // 回滚乐观行
      console.warn(`[content] 写入 ${table} 失败:`, error.message)
      throw error
    }
    applyById(planId, key, data) // 以服务端行(含默认值)为准
    return data
  }

  async function remoteUpdate(planId, table, key, id, patch) {
    const list = rows[planId][key]
    const row = list.find((r) => r.id === id)
    if (!row) return
    if (!isSupabase) {
      return persistLocal(planId, key, (l) => {
        const t = l.find((r) => r.id === id)
        if (t) Object.assign(t, patch)
      })
    }
    // 乐观更新,失败时回滚并告警
    const before = { ...row }
    Object.assign(row, patch)
    const { error } = await supabase.from(table).update(patch).eq('id', id)
    if (error) {
      Object.assign(row, before)
      console.warn(`[content] 更新 ${table} 失败:`, error.message)
    }
  }

  // ------------------------------------------------------------
  // 「撤销」缓冲:任何 remoteDelete 都会留下一份快照,
  // 界面浮层可调用 undoLast() 原样恢复(保留原 id/时间)
  // ------------------------------------------------------------
  const lastDeleted = ref(null)

  function labelOf(key, row) {
    if (row?.title) return row.title
    if (row?.name) return row.name
    const t = { todo: '任务', stay: '食宿', bills: '分账', guide: '攻略' }
    return (t[key] || '条目') + '记录'
  }

  async function remoteDelete(planId, table, key, id) {
    const list = rows[planId][key]
    const row = list.find((r) => r.id === id)
    if (row) {
      // 仅对「可恢复内容」记录撤销快照(路线日期等结构体不在此列)
      lastDeleted.value = { planId, key, row: { ...row }, at: Date.now(), label: labelOf(key, row) }
    }
    if (!isSupabase) {
      return persistLocal(planId, key, (l) => {
        const i = l.findIndex((r) => r.id === id)
        if (i !== -1) l.splice(i, 1)
      })
    }
    rows[planId][key] = rows[planId][key].filter((r) => r.id !== id) // 乐观删除
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) console.warn(`[content] 删除 ${table} 失败:`, error.message)
  }

  /** 恢复最近一次删除 */
  async function undoLast() {
    const d = lastDeleted.value
    if (!d) return false
    await remoteWrite(d.planId, TABLES[d.key], d.key, d.row)
    lastDeleted.value = null
    return true
  }

  function clearUndo() {
    lastDeleted.value = null
  }

  // ------------------------------------------------------------
  // 实时通道:单计划多表订阅
  // ------------------------------------------------------------
  function subscribeRemote(planId) {
    if (!isSupabase || channels[planId]) return
    const ch = supabase
      .channel(`plan-content-${planId}`)
    for (const [key, table] of Object.entries(TABLES)) {
      ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `plan_id=eq.${planId}` },
        (payload) => {
          const { eventType, old, new: row } = payload
          ensureBucket(planId)
          if (eventType === 'INSERT') applyById(planId, key, row)
          else if (eventType === 'UPDATE') applyById(planId, key, row)
          else if (eventType === 'DELETE') {
            rows[planId][key] = rows[planId][key].filter((r) => r.id !== old.id)
          }
        }
      )
    }
    ch.subscribe((status) => {
      if (status !== 'SUBSCRIBED') {
        console.warn('[content] 实时订阅未连接:', status, '→ 已启用 20s 轮询兜底')
        if (!pollTimers[planId]) {
          pollTimers[planId] = setInterval(() => pollRemote(planId), 20000)
        }
      } else if (pollTimers[planId]) {
        clearInterval(pollTimers[planId])
        delete pollTimers[planId]
      }
    })
    channels[planId] = ch
  }

  /** 离开计划时释放通道(避免多计划通道堆积) */
  function detachRemote(planId) {
    const ch = channels[planId]
    if (ch && supabase) {
      supabase.removeChannel(ch)
      delete channels[planId]
    }
    if (pollTimers[planId]) {
      clearInterval(pollTimers[planId])
      delete pollTimers[planId]
    }
  }

  // ------------------------------------------------------------
  // 加载与每日占位行
  // ------------------------------------------------------------
  async function ensureLoaded(plan) {
    if (!plan) return
    const planId = plan.id
    ensureBucket(planId)
    if (rows[planId].days.length || rows[planId]._loading) return
    rows[planId]._loading = true
    if (!isSupabase) {
      // 演示模式:直接读 localStorage
      for (const key of CONTENT_KEYS) {
        rows[planId][key] = localDb.loadContent(planId, key)
      }
    } else {
      // Supabase:并发拉取各表(按创建时间正序,保证展示稳定)
      const selects = Object.entries(TABLES).map(async ([key, table]) => {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .eq('plan_id', planId)
          .order('created_at', { ascending: true })
        if (!error && data) rows[planId][key] = data
        else console.warn(`[content] 拉取 ${table} 失败:`, error?.message)
      })
      await Promise.all(selects)
      subscribeRemote(planId)
    }
    await ensureDayRows(plan)
    rows[planId]._loading = false
  }

  /** 依据计划日期范围补全缺失的每日占位行(演示/新计划初始都是空) */
  async function ensureDayRows(plan) {
    if (!plan || !plan.start_date || !plan.end_date) return
    const bucket = ensureBucket(plan.id)
    const have = new Set(bucket.days.map((d) => d.date))
    const missing = eachDayISO(plan.start_date, plan.end_date).filter((d) => !have.has(d))
    for (const date of missing) {
      const row = { id: uid('day'), plan_id: plan.id, date, title: '', destinations: [] }
      await remoteWrite(plan.id, 'route_days', 'days', row)
    }
  }

  /** 卸载某个计划的全部数据(删除计划时调用) */
  function dropPlan(planId) {
    detachRemote(planId)
    delete rows[planId]
    if (!isSupabase) localDb.dropPlan(planId)
  }

  // ------------------------------------------------------------
  // 路线
  // ------------------------------------------------------------
  function findDay(planId, date) {
    return rows[planId].days.find((d) => d.date === date)
  }

  /** 当天新增一个目的地(dest: {place,note,time}) */
  async function addDestination(planId, date, dest) {
    await ensureDay(planId, date)
    const day = findDay(planId, date)
    const destinations = [...(day.destinations || []), { id: uid('x'), ...dest }]
    if (!isSupabase) {
      await persistLocal(planId, 'days', (l) => {
        const t = l.find((d) => d.date === date)
        if (t) t.destinations = destinations
      })
    } else {
      day.destinations = destinations // 乐观
      const { error } = await supabase
        .from('route_days')
        .update({ destinations })
        .eq('plan_id', planId)
        .eq('date', date)
      if (error) console.warn('[content] 追加目的地失败:', error.message)
    }
  }

  async function ensureDay(planId, date) {
    if (!findDay(planId, date)) {
      await remoteWrite(planId, 'route_days', 'days', {
        id: uid('day'), plan_id: planId, date, title: '', destinations: []
      })
    }
  }

  async function removeDestination(planId, date, destId) {
    const day = findDay(planId, date)
    if (!day) return
    const destinations = (day.destinations || []).filter((d) => d.id !== destId)
    if (!isSupabase) {
      await persistLocal(planId, 'days', (l) => {
        const t = l.find((d) => d.date === date)
        if (t) t.destinations = destinations
      })
    } else {
      day.destinations = destinations
      await supabase.from('route_days').update({ destinations }).eq('plan_id', planId).eq('date', date)
    }
  }

  async function updateDayTitle(planId, date, title) {
    if (!isSupabase) {
      await persistLocal(planId, 'days', (l) => {
        const t = l.find((d) => d.date === date)
        if (t) t.title = title
      })
    } else {
      const { error } = await supabase.from('route_days').update({ title }).eq('plan_id', planId).eq('date', date)
      if (error) console.warn('[content] 更新标题失败:', error.message)
    }
  }

  /** 更新某个目的地的局部字段(坐标 lat/lng、备注等) */
  async function updateDestinationFields(planId, date, destId, patch) {
    const day = findDay(planId, date)
    if (!day) return
    const destinations = (day.destinations || []).map((d) =>
      d.id === destId ? { ...d, ...patch } : d
    )
    if (!isSupabase) {
      await persistLocal(planId, 'days', (l) => {
        const t = l.find((d) => d.date === date)
        if (t) t.destinations = destinations
      })
    } else {
      day.destinations = destinations
      const { error } = await supabase
        .from('route_days')
        .update({ destinations })
        .eq('plan_id', planId)
        .eq('date', date)
      if (error) console.warn('[content] 更新目的地失败:', error.message)
    }
  }

  // ------------------------------------------------------------
  // 食宿 / TODO / 攻略 / 提醒 —— 均为薄封装,走通用原语
  // ------------------------------------------------------------
  function addStay(planId, payload) {
    return remoteWrite(planId, 'stays', 'stays', {
      id: uid('stay'), plan_id: planId, type: 'stay',
      name: '', address: '', phone: '', tags: [], booked: false, ...payload
    })
  }

  function updateStay(planId, id, patch) {
    return remoteUpdate(planId, 'stays', 'stays', id, patch)
  }

  function removeStay(planId, id) {
    return remoteDelete(planId, 'stays', 'stays', id)
  }

  function addTodo(planId, payload) {
    return remoteWrite(planId, 'todos', 'todos', {
      id: uid('todo'), plan_id: planId, title: '', done: false, due: null, ...payload
    })
  }

  function setTodoDone(planId, id, done) {
    return remoteUpdate(planId, 'todos', 'todos', id, { done })
  }

  function setTodoDue(planId, id, due) {
    return remoteUpdate(planId, 'todos', 'todos', id, { due })
  }

  function removeTodo(planId, id) {
    return remoteDelete(planId, 'todos', 'todos', id)
  }

  function addGuide(planId, payload) {
    return remoteWrite(planId, 'guides', 'guides', {
      id: uid('guide'), plan_id: planId, title: '', url: '', image: '', ...payload
    })
  }

  function removeGuide(planId, id) {
    return remoteDelete(planId, 'guides', 'guides', id)
  }

  function addReminder(planId, payload) {
    return remoteWrite(planId, 'reminders', 'reminders', {
      id: uid('rm'), plan_id: planId, title: '', date: '', time: '09:00', read: false, ...payload
    })
  }

  function setReminderRead(planId, id, read) {
    return remoteUpdate(planId, 'reminders', 'reminders', id, { read })
  }

  function removeReminder(planId, id) {
    return remoteDelete(planId, 'reminders', 'reminders', id)
  }

  // ------------------------------------------------------------
  // 分账(bills) —— 明细快照支付人与分摊人,避免成员变动后显示悬空
  // ------------------------------------------------------------
  function addBill(planId, payload) {
    return remoteWrite(planId, 'bills', 'bills', {
      id: uid('bill'), plan_id: planId, name: '', amount: 0,
      category: 'other', paid_by: null, involves: [], link: null, note: '',
      ...payload, created_at: new Date().toISOString()
    })
  }

  function updateBill(planId, id, patch) {
    return remoteUpdate(planId, 'bills', 'bills', id, patch)
  }

  function removeBill(planId, id) {
    return remoteDelete(planId, 'bills', 'bills', id)
  }

  // ------------------------------------------------------------
  // 行程建议评论 —— 采纳闭环
  //   open(建议中) → accepted(已采纳,记录采纳人/时间) → done(已落实,闭环)
  // ------------------------------------------------------------
  function addComment(planId, payload) {
    return remoteWrite(planId, 'comments', 'comments', {
      id: uid('cm'), plan_id: planId, day_date: '', dest_id: '',
      text: '', author: null, status: 'open',
      ...payload, created_at: new Date().toISOString()
    })
  }

  function adoptComment(planId, id, actor) {
    // 采纳:记下由谁采纳、何时采纳,形成可追踪闭环的第一环
    return remoteUpdate(planId, 'comments', 'comments', id, {
      status: 'accepted',
      accepted_by: actor,
      accepted_at: new Date().toISOString()
    })
  }

  function completeComment(planId, id) {
    // 落实完成:闭环
    return remoteUpdate(planId, 'comments', 'comments', id, {
      status: 'done',
      done_at: new Date().toISOString()
    })
  }

  function reopenComment(planId, id) {
    return remoteUpdate(planId, 'comments', 'comments', id, {
      status: 'open', accepted_by: null, accepted_at: null, done_at: null
    })
  }

  function removeComment(planId, id) {
    return remoteDelete(planId, 'comments', 'comments', id)
  }

  // ------------------------------------------------------------
  // 首页「今日提醒」摘要:跨全部计划取未来最近未读提醒
  // ------------------------------------------------------------
  async function fetchUpcoming(plansArr, max = 3) {
    const today = new Date().toISOString().slice(0, 10)
    const nameOf = (pid) => plansArr.find((p) => p.id === pid)?.name || ''
    if (!isSupabase) {
      const out = []
      for (const p of plansArr) {
        for (const r of localDb.loadContent(p.id, 'reminders')) {
          if (!r.read && r.date >= today) out.push({ ...r, plan_name: p.name })
        }
      }
      return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, max)
    }
    // Supabase:一次跨表查询最近 30 条再过滤
    const { data, error } = await supabase
      .from('reminders')
      .select('*')
      .gte('date', today)
      .order('date', { ascending: true })
      .order('time', { ascending: true })
      .limit(30)
    if (error) return []
    const list = (data || []).filter((r) => !r.read).slice(0, max)
    return list.map((r) => ({ ...r, plan_name: nameOf(r.plan_id) }))
  }

  /** 计划完成度:{planId: {done,total,pct}} —— 首页计划卡片展示 */
  async function loadProgress(plansArr) {
    const map = {}
    for (const p of plansArr) map[p.id] = { done: 0, total: 0, pct: 0 }
    if (!isSupabase) {
      for (const p of plansArr) {
        const todos = localDb.loadContent(p.id, 'todos')
        const done = todos.filter((t) => t.done).length
        map[p.id] = doneLabel(todos.length, done)
      }
    } else {
      const { data, error } = await supabase.from('todos').select('plan_id, done')
      if (!error) {
        for (const row of data || []) {
          if (!map[row.plan_id]) continue
          map[row.plan_id].total++
          if (row.done) map[row.plan_id].done++
        }
        for (const pid of Object.keys(map)) map[pid] = doneLabel(map[pid].total, map[pid].done)
      }
    }
    return map

    function doneLabel(total, done) {
      return { done, total, pct: total ? (done / total) * 100 : 0 }
    }
  }

  // ------------------------------------------------------------
  // 大交通企划(transits):每人到达 / 离开 段
  // ------------------------------------------------------------
  function addTransit(planId, payload) {
    return remoteWrite(planId, 'transits', 'transits', {
      id: uid('tr'), plan_id: planId, person: null, direction: 'in',
      mode: 'train', from_city: '', to_city: '', leg_date: '', time: '',
      ref_no: '', note: '',
      ...payload, created_at: new Date().toISOString()
    })
  }

  function updateTransit(planId, id, patch) {
    return remoteUpdate(planId, 'transits', 'transits', id, patch)
  }

  function removeTransit(planId, id) {
    return remoteDelete(planId, 'transits', 'transits', id)
  }

  // ------------------------------------------------------------
  // 车辆 & 里程(fuel)
  // ------------------------------------------------------------
  function currentVehicle(planId) {
    return rows[planId]?.vehicle?.[0] || null
  }

  /** 保存车辆信息(每计划一行) */
  async function saveVehicle(planId, data) {
    const cur = currentVehicle(planId)
    if (cur) {
      await remoteUpdate(planId, 'vehicles', 'vehicle', cur.id, data)
    } else {
      await remoteWrite(planId, 'vehicles', 'vehicle', {
        id: uid('veh'), plan_id: planId, ...data, created_at: new Date().toISOString()
      })
    }
  }

  function addFuel(planId, payload) {
    return remoteWrite(planId, 'fuel_logs', 'fuel', {
      id: uid('fl'), plan_id: planId, date: '', odometer: null, liters: null,
      amount: null, paid_by: null, bill_id: null, note: '',
      ...payload, created_at: new Date().toISOString()
    })
  }

  function updateFuel(planId, id, patch) {
    return remoteUpdate(planId, 'fuel_logs', 'fuel', id, patch)
  }

  /** 删除加油记录;若已同步进分账,连带删除对应账单。
   *  顺序:先删账单(其快照会被覆盖),最后删加油记录——
   *  保证撤销浮层恢复的是「加油记录」本身 */
  async function removeFuel(planId, id) {
    const row = rows[planId]?.fuel?.find((f) => f.id === id)
    if (row?.bill_id && rows[planId].bills.some((b) => b.id === row.bill_id)) {
      await remoteDelete(planId, 'bills', 'bills', row.bill_id)
    }
    await remoteDelete(planId, 'fuel_logs', 'fuel', id)
  }

  return {
    rowsOf,
    ensureLoaded,
    ensureDayRows,
    detachRemote,
    dropPlan,
    addDestination,
    removeDestination,
    updateDayTitle,
    updateDestinationFields,
    addStay,
    updateStay,
    removeStay,
    addTodo,
    setTodoDone,
    setTodoDue,
    removeTodo,
    addGuide,
    removeGuide,
    addReminder,
    setReminderRead,
    removeReminder,
    addBill,
    updateBill,
    removeBill,
    addComment,
    adoptComment,
    completeComment,
    reopenComment,
    removeComment,
    addTransit,
    updateTransit,
    removeTransit,
    saveVehicle,
    currentVehicle,
    addFuel,
    updateFuel,
    removeFuel,
    lastDeleted,
    undoLast,
    clearUndo,
    fetchUpcoming,
    loadProgress
  }
})
