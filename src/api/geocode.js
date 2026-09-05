// ============================================================
// 地点服务 —— 仅高德(不再使用 Photon/OSM 兜底)
// 云端:一律经本站 /api/geocode(Cloudflare Pages Function)服务端代理高德
// 本地 npm run dev 未部署 Function 时返回 null,由界面提示配置/手动处理
// ============================================================
import { isSupabase } from '@/api/supabase'

const cache = new Map() // key -> {lat,lng} | null

const STOP_WORDS = ['取车', '入住', '觅食', '汇合', '集合', '返程', '停车', '打卡', '看日出', '午饭', '午餐', '回程', '出发']

/** 清理地点描述:去掉括号、备注与动作词,保留可搜索地理名称 */
export function cleanQuery(raw) {
  let s = String(raw || '')
  s = s.replace(/[（(].*?[)）]/g, '').trim()
  const parts = s.split(/[·•|,，、]/).map((x) => x.trim()).filter(Boolean)
  const head = parts[0] || ''
  const isHeadAction = STOP_WORDS.some((w) => head === w || head.endsWith(w))
  let q = isHeadAction && parts.length > 1 ? parts.slice(1).join('') : head
  for (const w of STOP_WORDS) {
    if (q.endsWith(w) && q.length > w.length + 1) q = q.slice(0, -w.length).trim()
  }
  return q
}

function proxyUrl(type, q, hint) {
  const u = new URL('/api/geocode', window.location.origin)
  u.searchParams.set('type', type)
  u.searchParams.set('q', q)
  if (hint) u.searchParams.set('city', hint)
  return u.toString()
}

/**
 * 精确选点(高德 POI):返回候选列表,失败返回 []
 * @param {string} raw
 * @param {string} hint 计划集合城市(消歧)
 */
export async function searchPlaces(raw, hint = '') {
  const q = cleanQuery(raw)
  if (!q || q.length < 2) return []
  if (!isSupabase) return [] // 本地演示:无高德代理,不猜测
  try {
    const res = await fetch(proxyUrl('place', q, hint))
    const j = await res.json()
    return j?.ok && Array.isArray(j.candidates) ? j.candidates.slice(0, 8) : []
  } catch {
    return []
  }
}

/**
 * 坐标解析(高德 geocode):成功返回 {lat,lng};失败返回 null(不猜测)
 * @param {string} raw
 * @param {object} [opts]  { hint }
 */
export async function geocodePlace(raw, opts = {}) {
  const q = cleanQuery(raw)
  if (!q) return null
  const hint = (opts.hint || '').replace(/(市|省)$/, '')
  const key = hint ? `${hint}>${q}` : q
  if (cache.has(key)) return cache.get(key)
  if (!isSupabase) return null
  try {
    const res = await fetch(proxyUrl('geo', q, opts.hint || ''))
    const j = await res.json()
    if (j?.ok && j.location?.lat != null && j.location?.lng != null) {
      const hit = { lat: j.location.lat, lng: j.location.lng }
      cache.set(key, hit)
      return hit
    }
    cache.set(key, null)
    return null
  } catch {
    return null
  }
}

/** 让地图弹窗展示网页导航链接 —— 高德 */
export function navUrl(place, wgs) {
  const name = encodeURIComponent(place || '')
  if (wgs && typeof wgs.lat === 'number' && typeof wgs.lng === 'number') {
    const g = wgs2gcj(wgs.lat, wgs.lng)
    return `https://uri.amap.com/navigation?to=${g.lng},${g.lat}&toName=${name}&mode=car`
  }
  return `https://uri.amap.com/search?keyword=${name}`
}

/* ---------------- WGS84 → GCJ-02(火星坐标) ---------------- */
const PI = Math.PI
const A = 6378245.0
const EE = 0.00669342162296594323
function tx(x, y) {
  let r =
    300.1 +
    x -
    100 * Math.sin((12 * x * PI) / 180) * Math.cos((6 * x * PI) / 180) -
    50 * Math.cos((x * PI) / 180) * Math.sin((x * PI) / 180)
  r +=
    20 * Math.sin((6 * x * PI) / 180) * Math.cos((6 * x * PI) / 180) +
    10 * Math.sin((5 * x * PI) / 180) * Math.cos((3 * x * PI) / 180)
  r -= 15 * Math.sin((40 * x * PI) / 180) * Math.cos((40 * x * PI) / 180)
  return r
}
function ty(x, y) {
  let r =
    300.1 -
    x -
    100 * Math.sin((6 * x * PI) / 180) * Math.cos((12 * x * PI) / 180) -
    50 * Math.cos((x * PI) / 180) * Math.sin((x * PI) / 180)
  r +=
    20 * Math.sin((12 * x * PI) / 180) * Math.cos((6 * x * PI) / 180) +
    10 * Math.sin((3 * x * PI) / 180) * Math.cos((15 * x * PI) / 180)
  r -= 15 * Math.sin((60 * x * PI) / 180) * Math.cos((30 * x * PI) / 180)
  return r
}
function wgs2gcj(lat, lng) {
  let dLat = tx(lng - 105.0, lat - 35.0)
  let dLng = ty(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180) * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * PI)
  return { lat: lat + dLat, lng: lng + dLng }
}
