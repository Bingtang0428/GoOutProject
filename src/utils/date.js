// ============================================================
// 日期工具 —— 全部基于本地时区的 YYYY-MM-DD 字符串,
// 避免 new Date('YYYY-MM-DD') 按 UTC 解析导致的时区偏移。
// ============================================================

function pad(n) {
  return String(n).padStart(2, '0')
}

/** Date -> 'YYYY-MM-DD' (本地时区) */
export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 'YYYY-MM-DD' -> 当日 00:00 的 Date (本地时区解析) */
export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 今天(ISO) / 指定天数偏移后的 ISO 日期 */
export const todayISO = () => toISO(new Date())
export function isoPlus(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/** 起止日期(含)之间所有日期的 ISO 数组 */
export function eachDayISO(startISO, endISO) {
  const out = []
  let cur = parseISO(startISO)
  const end = parseISO(endISO)
  while (cur <= end) {
    out.push(toISO(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

/** 'YYYY-MM-DD' -> 中文友好显示,如 '9月19日 周六';跨年份时补年份 */
export function fmtDay(iso, withWeek = true) {
  const d = parseISO(iso)
  const base = `${d.getMonth() + 1}月${d.getDate()}日`
  const weekday = d.toLocaleDateString('zh-CN', { weekday: 'short' })
  const yearPart = d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}年` : ''
  return withWeek ? `${yearPart}${base} ${weekday}` : `${yearPart}${base}`
}

/** 计划日期区间展示,如 '9月19日 — 9月22日' */
export function fmtRange(startISO, endISO) {
  const s = parseISO(startISO)
  const e = parseISO(endISO)
  const sameYear = s.getFullYear() === e.getFullYear()
  const a = `${sameYear ? '' : s.getFullYear() + '年'}${s.getMonth() + 1}月${s.getDate()}日`
  const b = `${sameYear ? e.getFullYear() + '年' : ''}${e.getMonth() + 1}月${e.getDate()}日`
  return startISO === endISO ? a : `${a} — ${b}`
}

/** 行程总天数 */
export function planDays(startISO, endISO) {
  return eachDayISO(startISO, endISO).length
}

/** ISO 日期相对今天的分类键:'today' | 'tomorrow' | 'earlier' | 'later' */
export function relKey(iso) {
  const today = todayISO()
  const diff = Math.round((parseISO(iso) - parseISO(today)) / 86400000)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff < 0) return 'earlier'
  return 'later'
}

/** 提醒按日期分组:今天 / 明天 / 后续安排 / 已过期 */
export function groupReminders(rows) {
  const groups = { today: [], tomorrow: [], earlier: [], later: [] }
  const sorted = [...rows].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  for (const r of sorted) groups[relKey(r.date)].push(r)
  return [
    { key: 'today', label: '今天', rows: groups.today },
    { key: 'tomorrow', label: '明天', rows: groups.tomorrow },
    { key: 'later', label: '后续安排', rows: groups.later },
    { key: 'earlier', label: '已过期', rows: groups.earlier }
  ].filter((g) => g.rows.length)
}

/** 收藏时间展示:今天只显示时刻,否则显示日期 */
export function fmtSavedAt(isoDateTime) {
  if (!isoDateTime) return ''
  const d = new Date(isoDateTime)
  const sameDay = toISO(d) === todayISO()
  return sameDay
    ? `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : fmtDay(toISO(d), false)
}

/** 倒计时展示:返回第几天,如 出发日='D1' */
export function dayIndex(startISO, dayISO) {
  return Math.round((parseISO(dayISO) - parseISO(startISO)) / 86400000) + 1
}
