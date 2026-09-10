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
import { useAuthStore } from '@/stores/auth'
import * as localDb from '@/api/localDb'
import { eachDayISO } from '@/utils/date'
import { toast } from '@/composables/toast'

/** 实体 key ↔ Supabase 表名 映射 */
const TABLES = {
  days: 'route_days',
  drive: 'drive_days',
  stays: 'stays',
  todos: 'todos',
  guides: 'guides',
  reminders: 'reminders',
  bills: 'bills', // 分账
  comments: 'comments', // 行程建议评论
  transits: 'transits', // 大交通企划
  vehicle: 'vehicles', // 车辆(每计划一行)
  fuel: 'fuel_logs', // 加油里程记录
  memories: 'memories', // 旅行相册
  gcomments: 'guide_comments' // 攻略评论
}

const CONTENT_KEYS = Object.keys(TABLES)

const EMPTY = () => ({
  days: [],
  drive: [],
  stays: [],
  todos: [],
  guides: [],
  reminders: [],
  bills: [],
  comments: [],
  transits: [],
  vehicle: [],
  fuel: [],
  memories: [],
  gcomments: []
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
    await maybeLog(planId, key, '新增', labelOf(key, data))
    return data
  }

  /** 合并数组:以本地为准,把服务端独有的项追加到末尾(保住他人同时新增) */
  function mergeArraysById(serverArr, localArr) {
    const keyOf = (x) => String((x && (x.id ?? x.name ?? x.key)) ?? JSON.stringify(x))
    const localKeys = new Set(localArr.map(keyOf))
    const extra = serverArr.filter((x) => !localKeys.has(keyOf(x)))
    return [...localArr, ...extra]
  }

  /** 冲突时把本地 patch 合并到服务端最新行上 */
  function mergePatch(latest, patch) {
    const out = {}
    for (const [k, v] of Object.entries(patch)) {
      if (Array.isArray(v) && Array.isArray(latest[k])) out[k] = mergeArraysById(latest[k], v)
      else out[k] = v
    }
    return out
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
    const detail = diffDetail(key, before, patch)
    Object.assign(row, patch)

    const expected = before.updated_at
    let query = supabase.from(table).update(patch).eq('id', id)
    if (expected) query = query.eq('updated_at', expected)
    const { data, error } = await query.select()

    if (error) {
      Object.assign(row, before)
      console.warn(`[content] 更新 ${table} 失败:`, error.message)
      toast('保存失败,请稍后重试', 'error')
      return
    }

    // ★ 乐观锁命中 0 行 = 他人已在你编辑期间改过 → 取最新行做合并后重试
    if (expected && (!data || data.length === 0)) {
      const { data: latestArr } = await supabase.from(table).select('*').eq('id', id).limit(1)
      const latest = latestArr?.[0]
      if (!latest) {
        // 已被他人删除
        rows[planId][key] = rows[planId][key].filter((r) => r.id !== id)
        toast('该内容已被他人删除', 'info', 3200)
        return
      }
      const merged = mergePatch(latest, patch)
      const { data: d2, error: e2 } = await supabase
        .from(table)
        .update(merged)
        .eq('id', id)
        .eq('updated_at', latest.updated_at)
        .select()
      if (e2 || !d2 || d2.length === 0) {
        // 二次冲突:以服务端最新为准并提示
        applyById(planId, key, latest)
        toast('该内容正被他人修改,已为你刷新为最新版本', 'info', 3400)
        return
      }
      applyById(planId, key, d2[0])
      toast('检测到他人同时修改,已自动合并', 'info', 3000)
      await maybeLog(planId, key, '更新', labelOf(key, merged), detail)
      return
    }

    if (data?.[0]) applyById(planId, key, data[0])
    else applyById(planId, key, row)
    await maybeLog(planId, key, '更新', labelOf(key, row), detail)
  }

  /** 生成「字段:旧 → 新」的人类可读差异 */
  function diffDetail(key, oldRow, patch) {
    const LABELS = {
      title: '标题', name: '名称', task: '任务', done: '完成状态', due: '截止日期', day: '归属日',
      assignee: '负责人', amount: '金额', category: '分类', booked: '预订状态', tags: '标签',
      phone: '电话', address: '地址', type: '类型', read: '已读', status: '状态', plan_b: 'Plan B',
      date: '日期', time: '时间', mode: '方式', from_city: '出发地', to_city: '到达地',
      ref_no: '班次/航班', note: '备注', liters: '加油量', odometer: '里程', kind: '类型',
      paid_by: '付款人', involves: '分摊人', link: '关联', image: '图片', driver: '司机', filename: '文件'
    }
    const parts = []
    for (const k of Object.keys(patch || {})) {
      const oldV = oldRow?.[k]
      const newV = patch[k]
      const fmt = (v) => {
        if (v === null || v === undefined || v === '') return '空'
        if (k === 'assignee' || k === 'driver' || k === 'paid_by') return v.name || JSON.stringify(v)
        if (k === 'amount' || k === 'budget') return `¥${Number(v)}`
        if (k === 'done' || k === 'read' || k === 'booked') return v ? '是' : '否'
        if (Array.isArray(v)) return v.length ? v.join('、') : '空'
        if (k === 'status') return { open: '待采纳', accepted: '已采纳', done: '已闭环' }[v] || v
        if (k === 'day') return v ? `第${v}天` : '未定'
        return typeof v === 'object' ? JSON.stringify(v) : String(v)
      }
      const label = LABELS[k] || k
      const oldS = oldV !== undefined ? fmt(oldV) : null
      const newS = fmt(newV)
      parts.push(oldS === null ? `${label}设为${newS}` : `${label} ${oldS} → ${newS}`)
    }
    return parts.join(',')
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
    if (error) {
      console.warn(`[content] 删除 ${table} 失败:`, error.message)
    } else if (row) {
      await maybeLog(planId, key, '删除', labelOf(key, row))
    }
  }

  // ------------------------------------------------------------
  // 行程变更日志(轻量留痕,尽力而为;失败不影响主流程)
  // 路线日(days)的结构化内容(坐标/标题/地点)会高频变更,不写日志
  // ------------------------------------------------------------
  async function maybeLog(planId, key, verb, label, detail = '') {
    if (!isSupabase || key === 'days' || key === 'drive' || !planId || !label) return
    try {
      const auth = useAuthStore()
      const actor = auth.user ? { id: auth.user.id, name: auth.user.name } : null
      const text =
        verb === '删除'
          ? `删除了「${label}」` + (detail ? `(${detail})` : '')
          : verb === '更新'
            ? `更新了「${label}」` + (detail ? `:${detail}` : '')
            : `新增了「${label}」`
      await supabase.from('plan_logs').insert({ id: makeUuid(), plan_id: planId, actor, action: text })
    } catch {
      /* 日志失败不影响业务 */
    }
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
  // 实时通道:单计划多表订阅;本会话首次失败后停用实时,改纯轮询
  // ------------------------------------------------------------
  let realtimeDisabled = false
  let warnedOnce = false

  function startPoll(planId) {
    if (pollTimers[planId]) return
    pollTimers[planId] = setInterval(() => pollRemote(planId), 20000)
  }

  function subscribeRemote(planId) {
    if (!isSupabase || channels[planId] || channels[planId] === 'poll') return
    if (realtimeDisabled) {
      channels[planId] = 'poll'
      startPoll(planId)
      return
    }
    const ch = supabase.channel(`plan-content-${planId}`)
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
      if (status === 'SUBSCRIBED') {
        realtimeDisabled = false
        if (pollTimers[planId]) {
          clearInterval(pollTimers[planId])
          delete pollTimers[planId]
        }
        return
      }
      // 连接失败/超时/关闭:本会话不再重连,全部计划直接纯轮询
      realtimeDisabled = true
      supabase.removeChannel(ch).catch(() => {})
      channels[planId] = 'poll'
      startPoll(planId)
      if (!warnedOnce) {
        warnedOnce = true
        console.warn('[content] 实时订阅不可用 → 本会话已切换为 20s 轮询同步')
      }
    })
    channels[planId] = ch
  }

  /** 离开计划时释放通道/轮询 */
  function detachRemote(planId) {
    const ch = channels[planId]
    if (ch && ch !== 'poll' && supabase) {
      supabase.removeChannel(ch).catch(() => {})
    }
    delete channels[planId]
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
      // 纯轮询同步模式(不创建 WebSocket 通道,避免网络噪音)
      channels[planId] = 'poll'
      startPoll(planId)
    }
    await ensureDayRows(plan)
    rows[planId]._loading = false
  }

  /**
   * 云端创建/补全某天的路线行 —— 幂等且不覆盖:
   * 若服务端当天已存在(含内容),直接取回服务端行
   */
  async function upsertDayRow(planId, date) {
    if (!isSupabase) return null
    const { data, error } = await supabase
      .from('route_days')
      .upsert(
        { id: makeUuid(), plan_id: planId, date, title: '', destinations: [] },
        { onConflict: 'plan_id,date', ignoreDuplicates: true }
      )
      .select()
      .single()
    if (error) {
      console.warn('[content] 补全路线日失败:', error.message)
      return null
    }
    ensureBucket(planId)
    applyById(planId, 'days', data) // 以服务端行为准(已存在则保留其内容)
    return data
  }

  /**
   * 依据计划日期范围补全缺失的每日占位行。
   * ★ 云端场景:先拉取服务端已有行(保留既有内容),只补真正缺失的日期,
   *   绝不因本地缓存为空而覆盖已有路线内容。
   */
  async function ensureDayRows(plan) {
    if (!plan || !plan.start_date || !plan.end_date) return
    const bucket = ensureBucket(plan.id)
    if (isSupabase) {
      // 服务端是唯一事实来源:按日期合并,缺失的保留本地(可能刚新增)
      const { data, error } = await supabase
        .from('route_days')
        .select('id, plan_id, date, title, destinations')
        .eq('plan_id', plan.id)
        .order('date', { ascending: true })
      if (!error && data) {
        const serverMap = new Map(data.map((d) => [d.date, d]))
        const merged = []
        const seen = new Set()
        for (const row of data) {
          merged.push(row)
          seen.add(row.date)
        }
        for (const local of bucket.days) {
          if (!seen.has(local.date)) merged.push(local)
        }
        bucket.days = merged
      }
    }
    const have = new Set(bucket.days.map((d) => d.date))
    const missing = eachDayISO(plan.start_date, plan.end_date).filter((d) => !have.has(d))
    for (const date of missing) {
      if (isSupabase) {
        await upsertDayRow(plan.id, date)
      } else {
        await remoteWrite(plan.id, 'route_days', 'days', {
          id: uid('day'), plan_id: plan.id, date, title: '', destinations: []
        })
      }
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

  /** 当天新增一个目的地(dest: {place,note,time});酒店为终点时插到终点之前 */
  async function addDestination(planId, date, dest) {
    await ensureDay(planId, date)
    const day = findDay(planId, date)
    const list = [...(day.destinations || [])]
    const item = { id: uid('x'), ...dest }
    const endIdx = list.findIndex((d) => d.stay_role === 'end')
    if (endIdx >= 0) list.splice(endIdx, 0, item)
    else list.push(item)
    await writeDayRow(planId, date, { destinations: list })
  }

  async function ensureDay(planId, date) {
    if (!findDay(planId, date)) {
      if (isSupabase) {
        await upsertDayRow(planId, date)
      } else {
        await remoteWrite(planId, 'route_days', 'days', {
          id: uid('day'), plan_id: planId, date, title: '', destinations: []
        })
      }
    }
  }

  async function removeDestination(planId, date, destId) {
    const day = findDay(planId, date)
    if (!day) return
    const destinations = (day.destinations || []).filter((d) => d.id !== destId)
    await writeDayRow(planId, date, { destinations })
  }

  async function updateDayTitle(planId, date, title) {
    await writeDayRow(planId, date, { title })
  }

  /** 更新某个目的地的局部字段(坐标 lat/lng、备注等) */
  async function updateDestinationFields(planId, date, destId, patch) {
    const day = findDay(planId, date)
    if (!day) return
    const destinations = (day.destinations || []).map((d) =>
      d.id === destId ? { ...d, ...patch } : d
    )
    await writeDayRow(planId, date, { destinations })
  }

  /** 调整某天目的地的顺序(dir: -1 上移 / 1 下移);酒店起终点固定不参与 */
  async function moveDestination(planId, date, destId, dir) {
    const day = findDay(planId, date)
    if (!day) return
    const list = [...(day.destinations || [])]
    const i = list.findIndex((d) => d.id === destId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    if (list[i].stay_role || list[j].stay_role) return
    ;[list[i], list[j]] = [list[j], list[i]]
    await writeDayRow(planId, date, { destinations: list })
  }

  // ------------------------------------------------------------
  // 食宿 / TODO / 攻略 / 提醒 —— 均为薄封装,走通用原语
  // ------------------------------------------------------------
  /** 某条食宿归属的多个 Day 序号(兼容旧的单个 day 字段) */
  function stayDays(s) {
    if (Array.isArray(s?.days) && s.days.length) return s.days
    return s?.day ? [s.day] : []
  }

  function addStay(planId, payload) {
    return remoteWrite(planId, 'stays', 'stays', {
      id: uid('stay'), plan_id: planId, type: 'stay',
      name: '', address: '', phone: '', tags: [], booked: false, day: null, days: [],
      link: '', assignee: null, votes: [], chosen: false, chosen_by: null, ...payload
    })
  }

  /** 更新食宿;若该店已选定,同步刷新其在路线中的起终点信息 */
  async function updateStay(planId, id, patch) {
    await remoteUpdate(planId, 'stays', 'stays', id, patch)
    const row = (rows[planId]?.stays || []).find((s) => s.id === id)
    if (row?.chosen && typeof row.latitude === 'number' && typeof row.longitude === 'number') {
      await syncStayToRoute(planId, row)
    }
  }

  async function removeStay(planId, id) {
    const row = (rows[planId]?.stays || []).find((s) => s.id === id)
    if (row?.chosen) {
      for (const n of stayDays(row)) {
        const date = dayDateByNum(planId, n)
        if (date) await removeSyncedDest(planId, date, (d) => d.stay_link === id)
      }
    }
    await remoteDelete(planId, 'stays', 'stays', id)
  }

  /** day 序号(1=第1天)→ 该天日期;无归属返回 null */
  function dayDateByNum(planId, n) {
    if (!n || n < 1) return null
    const list = (rows[planId]?.days || []).slice().sort((a, b) => a.date.localeCompare(b.date))
    return list[n - 1]?.date || null
  }

  /** 从某天的路线 destinations 中移除满足 finder 的条目,并清理其悬空评论;返回移除数 */
  async function removeSyncedDest(planId, date, finder) {
    const day = findDay(planId, date)
    if (!day) return 0
    const dests = day.destinations || []
    const gone = dests.filter(finder)
    if (!gone.length) return 0
    const keep = dests.filter((d) => !finder(d))
    await writeDayRow(planId, date, { destinations: keep })
    await dropDestComments(planId, date, gone.map((d) => d.id))
    return gone.length
  }

  /** 删除某日某批目的地下挂的建议评论(避免残留幽灵建议) */
  async function dropDestComments(planId, date, destIds) {
    if (!destIds.length) return
    const list = rows[planId]?.comments
    if (!list) return
    if (!isSupabase) {
      await persistLocal(planId, 'comments', (l) =>
        l.splice(0, l.length, ...l.filter((c) => !(c.day_date === date && destIds.includes(c.dest_id))))
      )
      return
    }
    const doomed = list.filter((c) => c.day_date === date && destIds.includes(c.dest_id))
    if (!doomed.length) return
    rows[planId].comments = list.filter((c) => !doomed.includes(c))
    await supabase
      .from('comments')
      .delete()
      .eq('plan_id', planId)
      .in('id', doomed.map((c) => c.id))
  }

  /**
   * 食宿投票:每人可给候选投 1 票 / 取消自己的票(voter: {id?, name})
   */
  async function voteStay(planId, id, voter, on) {
    const row = (rows[planId]?.stays || []).find((s) => s.id === id)
    if (!row || !voter?.name) return
    let votes = [...(row.votes || [])]
    const mine = votes.findIndex((v) => (voter.id && v.id === voter.id) || (!voter.id && v.name === voter.name))
    if (on && mine === -1) votes.push({ id: voter.id || null, name: voter.name })
    else if (!on && mine !== -1) votes.splice(mine, 1)
    else return
    await remoteUpdate(planId, 'stays', 'stays', id, { votes })
  }

  /** 带乐观锁的路线日写入:冲突时拉取最新行合并后重试 */
  async function writeDayRow(planId, date, patch) {
    if (!isSupabase) {
      await persistLocal(planId, 'days', (l) => {
        const t = l.find((d) => d.date === date)
        if (t) Object.assign(t, patch)
      })
      return
    }
    const day = findDay(planId, date)
    if (!day) return
    const expected = day.updated_at
    Object.assign(day, patch) // 乐观
    let q = supabase.from('route_days').update(patch).eq('plan_id', planId).eq('date', date)
    if (expected) q = q.eq('updated_at', expected)
    const { data, error } = await q.select()
    if (error) {
      console.warn('[content] 更新路线日失败:', error.message)
      return
    }
    if (expected && (!data || !data.length)) {
      const { data: latestArr } = await supabase.from('route_days').select('*').eq('plan_id', planId).eq('date', date).limit(1)
      const latest = latestArr?.[0]
      if (!latest) return
      const merged = mergePatch(latest, patch)
      const { data: d2 } = await supabase
        .from('route_days')
        .update(merged)
        .eq('plan_id', planId)
        .eq('date', date)
        .eq('updated_at', latest.updated_at)
        .select()
      if (d2?.[0]) {
        applyById(planId, 'days', d2[0])
        toast('检测到他人同时修改,已自动合并', 'info', 3000)
      } else {
        applyById(planId, 'days', latest)
        toast('该日行程正被他人修改,已刷新为最新', 'info', 3400)
      }
      return
    }
    if (data?.[0]) applyById(planId, 'days', data[0])
  }

  /** 持久化某天的 destinations(本地直写 / 云端乐观锁) */
  async function persistDayDests(planId, date, dests) {
    await writeDayRow(planId, date, { destinations: dests })
  }

  /**
   * 把选定的酒店写入某天路线:
   *  - 入住当天(首日):只作「终点」,不作起点
   *  - 退房当天(末日):只作「起点」,不作终点
   *  - 中间几天:既是起点也是终点
   * 餐厅则只插入一次(不设起终点)。已存在的同店条目先清除,避免重复。
   */
  async function applyStayToDay(planId, date, row, { asStart = false, asEnd = false } = {}) {
    const day = findDay(planId, date)
    if (!day) return
    const others = (day.destinations || []).filter((d) => d.stay_link !== row.id)
    const meta = {
      place: row.name,
      lat: row.latitude,
      lng: row.longitude,
      note: `已选定${row.type === 'food' ? '餐厅' : '住宿'}:${row.booked ? '已预订' : '待预订'}`,
      stay_link: row.id
    }
    let dests
    if (row.type === 'stay') {
      if (!others.length) {
        // 当天只有这一家酒店:单条展示(按退房/入住语义标终点或起点)
        const role = asEnd ? 'end' : asStart ? 'start' : null
        dests = [{ id: uid('dst'), time: '', ...meta, ...(role ? { stay_role: role } : {}) }]
      } else {
        const list = [...others]
        if (asEnd) list.push({ id: uid('dst'), time: '', ...meta, stay_role: 'end' })
        if (asStart) list.unshift({ id: uid('dst'), time: '', ...meta, stay_role: 'start' })
        dests = list
      }
    } else {
      dests = [...others, { id: uid('dst'), time: '', ...meta }]
    }
    await persistDayDests(planId, date, dests)
  }

  /**
   * 把某家已选定的酒店按起终点规则同步进它所有的日期,并清理不在日期范围内的旧同步。
   */
  async function syncStayToRoute(planId, row) {
    const dayNums = stayDays(row)
    const dates = new Set()
    for (let i = 0; i < dayNums.length; i++) {
      const date = dayDateByNum(planId, dayNums[i])
      if (!date) continue
      dates.add(date)
      const asStart = i > 0
      const asEnd = i < dayNums.length - 1 || dayNums.length === 1
      await applyStayToDay(planId, date, row, { asStart, asEnd })
    }
    for (const anyDay of rows[planId]?.days || []) {
      if (dates.has(anyDay.date)) continue
      const gone = (anyDay.destinations || []).filter((d) => d.stay_link === row.id)
      if (gone.length) {
        await persistDayDests(planId, anyDay.date, (anyDay.destinations || []).filter((d) => d.stay_link !== row.id))
        await dropDestComments(planId, anyDay.date, gone.map((d) => d.id))
      }
    }
  }

  /**
   * 食宿选定/取消选定 —— 选定时把地点同步进路线规划:
   * 住宿作为所选每一天的「起点 + 终点」;同类型同天只保留一个选定。
   * 返回 { ok, reason? } ;reason: no_day / no_coord
   */
  async function chooseStay(planId, id, actor, chosen) {
    const row = (rows[planId]?.stays || []).find((s) => s.id === id)
    if (!row) return { ok: false, reason: 'gone' }
    const dayNums = stayDays(row)
    if (chosen) {
      if (!dayNums.length) return { ok: false, reason: 'no_day' }
      if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') {
        return { ok: false, reason: 'no_coord' }
      }
      // 取消同类型、有日期交集的其它选定,并移除其已同步地点
      for (const o of rows[planId]?.stays || []) {
        const overlap = stayDays(o).some((n) => dayNums.includes(n))
        if (o.type === row.type && overlap && o.chosen && o.id !== id) {
          for (const on of stayDays(o)) {
            const od = dayDateByNum(planId, on)
            if (od) await removeSyncedDest(planId, od, (d) => d.stay_link === o.id)
          }
          await remoteUpdate(planId, 'stays', 'stays', o.id, { chosen: false, chosen_by: null })
        }
      }
      await remoteUpdate(planId, 'stays', 'stays', id, { chosen: true, chosen_by: actor || null })
      // 按入住/退房规则写入所选每一天(酒店=起点/终点)
      await syncStayToRoute(planId, row)
      return { ok: true }
    }
    // 取消选定:从所有日期移除
    await remoteUpdate(planId, 'stays', 'stays', id, { chosen: false, chosen_by: null })
    for (const anyDay of rows[planId]?.days || []) {
      if ((anyDay.destinations || []).some((d) => d.stay_link === id)) {
        await removeSyncedDest(planId, anyDay.date, (d) => d.stay_link === id)
      }
    }
    return { ok: true }
  }

  function addTodo(planId, payload) {
    return remoteWrite(planId, 'todos', 'todos', {
      id: uid('todo'), plan_id: planId, title: '', done: false, due: null,
      day: null, assignee: null, ...payload
    })
  }

  function setTodoDone(planId, id, done) {
    return remoteUpdate(planId, 'todos', 'todos', id, { done })
  }

  function setTodoDue(planId, id, due) {
    return remoteUpdate(planId, 'todos', 'todos', id, { due })
  }

  /** 指派负责人(分工):p = {id,name} | null 清除 */
  function setTodoAssignee(planId, id, p) {
    return remoteUpdate(planId, 'todos', 'todos', id, { assignee: p })
  }

  /** 设置/清除某天的待办归属(day: 1..N | null) */
  function setTodoDay(planId, id, day) {
    return remoteUpdate(planId, 'todos', 'todos', id, { day })
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
      id: uid('rm'), plan_id: planId, title: '', date: '', time: '09:00',
      read: false, targets: [], reads: [], ...payload
    })
  }

  function setReminderRead(planId, id, read) {
    return remoteUpdate(planId, 'reminders', 'reminders', id, { read })
  }

  /** 某成员标记已读/取消已读:记入 reads;所有指定成员都读过(或无指定成员)时整条关闭 */
  async function readReminderBy(planId, id, person, on = true) {
    const row = (rows[planId]?.reminders || []).find((r) => r.id === id)
    if (!row || !person?.name) return
    const reads = [...(row.reads || [])]
    const idx = reads.findIndex((r) => (person.id && r.id === person.id) || (!person.id && r.name === person.name))
    if (on && idx === -1) reads.push({ id: person.id || null, name: person.name, at: new Date().toISOString() })
    else if (!on && idx !== -1) reads.splice(idx, 1)
    else return
    const targets = row.targets || []
    const allRead = targets.length
      ? targets.every((t) => reads.some((r) => (t.id && r.id === t.id) || r.name === t.name))
      : on
    await remoteUpdate(planId, 'reminders', 'reminders', id, { reads, read: allRead })
  }

  /** 该成员是否已读 */
  function reminderReadBy(row, person) {
    if (!row || !person?.name) return false
    return (row.reads || []).some((r) => (person.id && r.id === person.id) || (!person.id && r.name === person.name))
  }

  /** 整条提醒是否已关闭:指定多人时需全部已读;否则任意已读即关闭 */
  function reminderClosed(row) {
    if (!row) return false
    if (row.read) return true
    const targets = row.targets || []
    if (!targets.length) return false
    const reads = row.reads || []
    return targets.every((t) => reads.some((x) => (t.id && x.id === t.id) || x.name === t.name))
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
      date: new Date().toISOString().slice(0, 10),
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
          if (!reminderClosed(r) && r.date >= today) out.push({ ...r, plan_name: p.name })
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
    const list = (data || []).filter((r) => !reminderClosed(r)).slice(0, max)
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
  // 车辆 & 里程(fuel) —— 支持多辆车,车辆可区分 燃油/混动/纯电
  // ------------------------------------------------------------
  function currentVehicle(planId) {
    return rows[planId]?.vehicle?.[0] || null
  }

  /** 保存车辆(row.id 存在=更新,否则新增);每计划可有多辆 */
  async function saveVehicle(planId, row) {
    const list = rows[planId]?.vehicle || []
    if (row?.id && list.some((v) => v.id === row.id)) {
      await remoteUpdate(planId, 'vehicles', 'vehicle', row.id, row)
      return row
    }
    await remoteWrite(planId, 'vehicles', 'vehicle', {
      id: makeUuid(), plan_id: planId, name: '', plate: '',
      power: 'gas', capacity_l: null, cons_l100: null, battery_kwh: null, kwh_100: null,
      ...row, created_at: new Date().toISOString()
    })
    return row
  }

  /** 删除车辆(其加油记录保留,仅展示归属) */
  function removeVehicle(planId, id) {
    return remoteDelete(planId, 'vehicles', 'vehicle', id)
  }

  function addFuel(planId, payload) {
    return remoteWrite(planId, 'fuel_logs', 'fuel', {
      id: uid('fl'), plan_id: planId, date: '', odometer: null, liters: null,
      amount: null, paid_by: null, bill_id: null, note: '',
      ...payload, created_at: new Date().toISOString()
    })
  }

  /** 旅行相册:打卡照片记录 */
  function addMemory(planId, payload) {
    return remoteWrite(planId, 'memories', 'memories', {
      id: uid('mem'), plan_id: planId, day_date: '', image: '', note: '',
      author: null, ...payload, created_at: new Date().toISOString()
    })
  }

  function removeMemory(planId, id) {
    return remoteDelete(planId, 'memories', 'memories', id)
  }

  /** 攻略评论 */
  function addGuideComment(planId, payload) {
    return remoteWrite(planId, TABLES.gcomments, 'gcomments', {
      id: uid('gc'), plan_id: planId, guide_id: null, text: '', author: null,
      ...payload, created_at: new Date().toISOString()
    })
  }

  function removeGuideComment(planId, id) {
    return remoteDelete(planId, TABLES.gcomments, 'gcomments', id)
  }

  /** 攻略评论点赞/取消点赞 */
  async function toggleGuideCommentLike(planId, id, person) {
    const row = (rows[planId]?.gcomments || []).find((c) => c.id === id)
    if (!row || !person?.name) return
    const likes = [...(row.likes || [])]
    const i = likes.findIndex((x) => (person.id && x.id === person.id) || (!person.id && x.name === person.name))
    if (i === -1) likes.push({ id: person.id || null, name: person.name })
    else likes.splice(i, 1)
    await remoteUpdate(planId, TABLES.gcomments, 'gcomments', id, { likes })
  }

  /** 当天 Plan B 预案(雨天/备选路线等) */
  async function updateDayPlanB(planId, date, text) {
    await writeDayRow(planId, date, { plan_b: text })
  }

  function updateFuel(planId, id, patch) {
    return remoteUpdate(planId, 'fuel_logs', 'fuel', id, patch)
  }

  // ------------------------------------------------------------
  // 自驾规划(drive_days) —— 每天一行,legs 为当天驾驶段数组(结构同 route_days)
  // legs: [{ id, from:{name,lat,lng}, to:{name,lat,lng}, drive_min, km,
  //          tolls, roads:[{kind,km,via}], geometry:[[lat,lng]…], time, note }]
  // ------------------------------------------------------------
  function findDriveDay(planId, date) {
    return (rows[planId]?.drive || []).find((d) => d.date === date)
  }

  /** 云端补全某天的自驾行(幂等,保留已有 legs) */
  async function upsertDriveDayRow(planId, date) {
    if (!isSupabase) return null
    const { data, error } = await supabase
      .from('drive_days')
      .upsert(
        { id: makeUuid(), plan_id: planId, date, title: '', legs: [] },
        { onConflict: 'plan_id,date', ignoreDuplicates: true }
      )
      .select()
      .single()
    if (error) {
      console.warn('[content] 补全自驾日失败:', error.message)
      return null
    }
    ensureBucket(planId)
    applyById(planId, 'drive', data)
    return data
  }

  /** 依据计划日期范围补全缺失的自驾占位行 */
  async function ensureDriveDayRows(plan) {
    if (!plan || !plan.start_date || !plan.end_date) return
    const bucket = ensureBucket(plan.id)
    if (isSupabase) {
      const { data, error } = await supabase
        .from('drive_days')
        .select('*')
        .eq('plan_id', plan.id)
        .order('date', { ascending: true })
      if (!error && data) {
        const seen = new Set()
        const merged = []
        for (const row of data) {
          merged.push(row)
          seen.add(row.date)
        }
        for (const local of bucket.drive) {
          if (!seen.has(local.date)) merged.push(local)
        }
        bucket.drive = merged
      }
    }
    const have = new Set(bucket.drive.map((d) => d.date))
    for (const date of eachDayISO(plan.start_date, plan.end_date)) {
      if (have.has(date)) continue
      if (isSupabase) {
        await upsertDriveDayRow(plan.id, date)
      } else {
        await remoteWrite(plan.id, 'drive_days', 'drive', {
          id: uid('ddr'), plan_id: plan.id, date, title: '', legs: []
        })
      }
    }
  }

  /** 保证某天自驾行存在并返回 */
  async function ensureDriveDay(planId, date) {
    if (!findDriveDay(planId, date)) {
      if (isSupabase) {
        await upsertDriveDayRow(planId, date)
      } else {
        await remoteWrite(planId, 'drive_days', 'drive', {
          id: uid('ddr'), plan_id: planId, date, title: '', legs: []
        })
      }
    }
  }

  /** 带乐观锁的自驾日写入 */
  async function writeDriveDayRow(planId, date, patch) {
    if (!isSupabase) {
      await persistLocal(planId, 'drive', (l) => {
        const t = l.find((d) => d.date === date)
        if (t) Object.assign(t, patch)
      })
      return
    }
    const row = findDriveDay(planId, date)
    if (!row) return
    const expected = row.updated_at
    Object.assign(row, patch)
    let q = supabase.from('drive_days').update(patch).eq('plan_id', planId).eq('date', date)
    if (expected) q = q.eq('updated_at', expected)
    const { data, error } = await q.select()
    if (error) {
      console.warn('[content] 更新自驾日失败:', error.message)
      return
    }
    if (expected && (!data || !data.length)) {
      const { data: latestArr } = await supabase.from('drive_days').select('*').eq('plan_id', planId).eq('date', date).limit(1)
      const latest = latestArr?.[0]
      if (!latest) return
      const merged = mergePatch(latest, patch)
      const { data: d2 } = await supabase
        .from('drive_days')
        .update(merged)
        .eq('plan_id', planId)
        .eq('date', date)
        .eq('updated_at', latest.updated_at)
        .select()
      if (d2?.[0]) {
        applyById(planId, 'drive', d2[0])
        toast('检测到他人同时修改,已自动合并', 'info', 3000)
      } else {
        applyById(planId, 'drive', latest)
        toast('该日自驾正被他人修改,已刷新为最新', 'info', 3400)
      }
      return
    }
    if (data?.[0]) applyById(planId, 'drive', data[0])
  }

  /** 整日 legs 落库(本地直写 / 云端乐观锁) */
  async function setDriveLegs(planId, date, legs) {
    await writeDriveDayRow(planId, date, { legs })
  }

  async function addDriveLeg(planId, date, leg) {
    await ensureDriveDay(planId, date)
    const row = findDriveDay(planId, date)
    if (!row) return
    await setDriveLegs(planId, date, [...(row.legs || []), { id: uid('dlg'), ...leg }])
  }

  async function updateDriveLeg(planId, date, legId, patch) {
    const row = findDriveDay(planId, date)
    if (!row) return
    await setDriveLegs(
      planId,
      date,
      (row.legs || []).map((l) => (l.id === legId ? { ...l, ...patch } : l))
    )
  }

  async function removeDriveLeg(planId, date, legId) {
    const row = findDriveDay(planId, date)
    if (!row) return 0
    await setDriveLegs(
      planId,
      date,
      (row.legs || []).filter((l) => l.id !== legId)
    )
    // 该段若曾同步进路线,删段时顺带清理其目的地(连同悬空评论)
    return pruneDriveMarkers(planId, date)
  }

  /**
   * 清理某天路线上「已不存在的驾驶段」留下的同步目的地(drv_leg 标记失效即移除)
   * 返回清理条数
   */
  async function pruneDriveMarkers(planId, date) {
    const set = new Set()
    for (const dr of rows[planId]?.drive || []) {
      for (const lg of dr.legs || []) set.add(lg.id)
    }
    const day = findDay(planId, date)
    if (!day) return 0
    return removeSyncedDest(planId, date, (d) => Boolean(d.drv_leg) && !set.has(d.drv_leg))
  }

  async function updateDriveDayTitle(planId, date, title) {
    await writeDriveDayRow(planId, date, { title })
  }

  /**
   * 自驾规划 → 路线规划 一键同步:
   * ① 先清理失效残留(删过/改过的驾驶段在路线里的旧目的地,drv_leg 标记找不到即移除)
   * ② 再把各段终点按序并入当天路线 destinations:
   *    - 已同步过的(带 drv_leg 标记)原地更新驾驶字段,不重复插入
   *    - 新段追加到当天末尾(作为停留点,地点名/坐标随段)
   *    - 不覆盖用户在该地点手工编辑的 time/note
   * 返回 { days, added, updated, removed }
   */
  async function syncDrivesToRoute(planId) {
    const drives = (rows[planId]?.drive || []).slice().sort((a, b) => a.date.localeCompare(b.date))
    let removed = 0
    for (const dd of drives) removed += await pruneDriveMarkers(planId, dd.date)
    let days = 0
    let added = 0
    let updated = 0
    for (const dd of drives) {
      const legs = dd.legs || []
      if (!legs.length) continue
      const day = findDay(planId, dd.date)
      if (!day) continue
      let dests = [...(day.destinations || [])]
      let touchedDay = false
      let dAdded = 0
      let dUpdated = 0
      for (const lg of legs) {
        const t = lg.to || {}
        if (!t.name) continue
        const i = dests.findIndex((d) => d.drv_leg === lg.id)
        const base = {
          place: t.name,
          lat: t.lat ?? null,
          lng: t.lng ?? null,
          drive_min: lg.drive_min ?? null,
          distance_km: lg.km ?? null,
          drive_tolls: lg.tolls ?? null,
          drive_roads: Array.isArray(lg.roads) ? lg.roads : [],
          drive_geo: Array.isArray(lg.geometry) && lg.geometry.length > 1 ? lg.geometry : [],
          drive_segs: Array.isArray(lg.segs) && lg.segs.length ? lg.segs : []
        }
        if (i === -1) {
          dests.push({ id: uid('dst'), time: lg.time || '', note: lg.note || '', ...base, drv_leg: lg.id })
          dAdded++
          touchedDay = true
          continue
        }
        const d = dests[i]
        let dirty = false
        for (const k of ['place', 'lat', 'lng', 'drive_min', 'distance_km', 'drive_tolls', 'drive_roads', 'drive_geo', 'drive_segs']) {
          const v = base[k]
          if (JSON.stringify(d[k]) !== JSON.stringify(v)) {
            d[k] = v
            dirty = true
          }
        }
        if (d.drv_leg !== lg.id) {
          d.drv_leg = lg.id
          dirty = true
        }
        if (!d.note && lg.note) {
          d.note = lg.note
          dirty = true
        }
        if (dirty) {
          dUpdated++
          touchedDay = true
        }
      }
      if (!touchedDay) continue
      // 保持酒店起/终点固定在当天首尾(自驾同步可能把新段追加到末尾)
      const starts = dests.filter((d) => d.stay_role === 'start')
      const ends = dests.filter((d) => d.stay_role === 'end')
      if (starts.length || ends.length) {
        dests = [...starts, ...dests.filter((d) => !d.stay_role), ...ends]
      }
      days++
      added += dAdded
      updated += dUpdated
      await writeDayRow(planId, dd.date, { destinations: dests })
    }
    return { days, added, updated, removed }
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
    moveDestination,
    ensureDriveDayRows,
    addDriveLeg,
    updateDriveLeg,
    removeDriveLeg,
    pruneDriveMarkers,
    updateDriveDayTitle,
    syncDrivesToRoute,
    addStay,
    updateStay,
    removeStay,
    voteStay,
    chooseStay,
    addTodo,
    setTodoDone,
    setTodoDue,
    setTodoAssignee,
    setTodoDay,
    removeTodo,
    addGuide,
    removeGuide,
    addReminder,
    setReminderRead,
    readReminderBy,
    reminderReadBy,
    reminderClosed,
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
    removeVehicle,
    currentVehicle,
    addFuel,
    updateFuel,
    removeFuel,
    addMemory,
    removeMemory,
    addGuideComment,
    removeGuideComment,
    toggleGuideCommentLike,
    updateDayPlanB,
    lastDeleted,
    undoLast,
    clearUndo,
    fetchUpcoming,
    loadProgress
  }
})
