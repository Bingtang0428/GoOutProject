// ============================================================
// 本地演示模式存储层(localStorage)
// 仅在未配置 Supabase 环境变量时使用;键名与 Supabase 表一一对应,
// 使 stores/content.js 可以无感切换两种数据源。
// ============================================================
import { buildDemoBundle } from '@/utils/demoData'

const K = {
  plans: 'tx:plans',
  content: (planId, key) => `tx:content:${planId}:${key}`
}

export function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export const CONTENT_KEYS = ['days', 'stays', 'todos', 'guides', 'reminders', 'bills', 'comments', 'transits', 'vehicle', 'fuel']

export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.warn('[localDb] 写入失败', e)
  }
}

/** 读取计划集合;首次运行时写入整套演示数据(含各计划内容种子) */
export function loadPlans() {
  let plans = read(K.plans)
  if (!Array.isArray(plans)) {
    const { plans: bundle, content } = buildDemoBundle()
    plans = bundle
    write(K.plans, plans)
    for (const pid of Object.keys(content)) {
      const c = content[pid]
      for (const key of Object.keys(c)) write(K.content(pid, key), c[key])
    }
  }
  return plans
}

export function savePlans(plans) {
  write(K.plans, plans)
}

/** 读取某计划某集合的行;无记录时返回 fallback(默认空数组) */
export function loadContent(planId, key, fallback = []) {
  const rows = read(K.content(planId, key))
  return rows ?? fallback
}

export function saveContent(planId, key, rows) {
  write(K.content(planId, key), rows)
}

/** 删除某个计划的全部内容数据 */
export function dropPlan(planId) {
  for (const key of CONTENT_KEYS) {
    localStorage.removeItem(K.content(planId, key))
  }
}
