// ============================================================
// 行程路段时长与真实路线估算
//  - 云端(部署于 Cloudflare Pages,配了 AMAP_KEY):调用本站
//    /api/driving(高德驾车路径规划 v3)——
//    返回真实路网折线(geometry)、时长、里程、过路费与途经道路分类;
//    高德失败时自动退回 OSRM/直线估算(仅时长与里程,无路网线)
//  - 本地/无代理:OSRM 公共路由估算;再不可用时直线距离兜底
// ============================================================
import { isSupabase } from '@/api/supabase'
import { gcj2wgs } from '@/api/geocode'

/** haversine 公里数 */
export function distKm(a, b) {
  const R = 6371
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const cache = new Map() // 'lat,lng|lat,lng' -> {min,km,geo,roads,tolls}|null

function legKey(a, b) {
  return `${Number(a.lat).toFixed(6)},${Number(a.lng).toFixed(6)}|${Number(b.lat).toFixed(6)},${Number(b.lng).toFixed(6)}`
}

/**
 * 高德驾车规划(经本站 /api/driving 代理,服务端持有 key)
 * 坐标入参为 WGS84;返回的高德 GCJ-02 折线逐点转回 WGS84 后返回
 */
async function amapLeg(a, b) {
  try {
    const u = new URL('/api/driving', window.location.origin)
    u.searchParams.set('from', `${a.lng},${a.lat}`)
    u.searchParams.set('to', `${b.lng},${b.lat}`)
    const res = await fetch(u.toString())
    const j = await res.json()
    if (!j?.ok) return null
    return {
      min: j.min,
      km: j.km,
      tolls: j.tolls ?? 0,
      tollKm: j.tollKm ?? 0,
      roads: Array.isArray(j.roads) ? j.roads : [],
      geometry: Array.isArray(j.geometry)
        ? j.geometry.map((g) => gcj2wgs(g.lat, g.lng)).slice(0, 200)
        : [],
      segs: Array.isArray(j.segs)
        ? j.segs
            .map((s) => ({
              kind: s.kind,
              km: s.km,
              name: s.name || '',
              pts: (s.pts || []).map((p) => gcj2wgs(p.lat, p.lng))
            }))
            .slice(0, 60)
        : []
    }
  } catch {
    return null
  }
}

/** OSRM 兜底(无高德可用时),仅时长与里程 */
async function osrmLeg(a, b) {
  let min = null
  let km = null
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false&steps=false`
    )
    if (res.ok) {
      const json = await res.json()
      const r = json?.routes?.[0]
      if (r) {
        if (typeof r.duration === 'number' && r.duration > 0) min = Math.ceil(r.duration / 60)
        if (typeof r.distance === 'number' && r.distance > 0) km = Math.round((r.distance / 1000) * 10) / 10
      }
    }
  } catch {
    /* fall through */
  }
  if (!min || !km) {
    // 直线距离兜底:距离 ×1.25 路网系数,均速 60km/h
    const straight = distKm(a, b)
    km = km ?? Math.round(straight * 1.25 * 10) / 10
    min = min ?? Math.max(1, Math.ceil((straight / 60) * 60))
  }
  return { min, km }
}

/**
 * 估算自驾段:返回 { min, km, tolls?, roads?, geometry? }
 * 云端优先走高德(含真实路网 geometry),不可用时退回 OSRM/直线(无 geometry)
 */
export async function drivingLeg(a, b, force = false) {
  if (!a || !b || !a.lat || !a.lng || !b.lat || !b.lng) return null
  const key = legKey(a, b)
  if (cache.has(key) && !force) return cache.get(key)

  let out = null
  if (isSupabase) {
    out = await amapLeg(a, b) // geometry 可能为空(路线失败时会整段放弃)
    if (out && out.km && out.min) {
      cache.set(key, out)
      return out
    }
    out = null
  }
  const leg = await osrmLeg(a, b)
  out = { min: leg.min, km: leg.km, tolls: 0, roads: [], segs: [], geometry: [] }
  cache.set(key, out)
  return out
}

/** 兼容旧调用:仅返回分钟 */
export async function drivingMinutes(a, b, force = false) {
  const leg = await drivingLeg(a, b, force)
  return leg ? leg.min : null
}

/** 公共交通(公交/地铁/轮渡)真实路径;失败返回 null(由调用方退回估算) */
export async function transitLeg(a, b, city = '') {
  if (!a || !b || !a.lat || !a.lng || !b.lat || !b.lng || !isSupabase) return null
  try {
    const u = new URL('/api/transit', window.location.origin)
    u.searchParams.set('from', `${a.lng},${a.lat}`)
    u.searchParams.set('to', `${b.lng},${b.lat}`)
    if (city) u.searchParams.set('city', city)
    const res = await fetch(u.toString())
    const j = await res.json()
    if (!j?.ok) return null
    return { min: j.min, km: j.km, cost: j.cost ?? 0, steps: Array.isArray(j.steps) ? j.steps : [] }
  } catch {
    return null
  }
}

/** 步行真实路径;失败返回 null(由调用方退回估算) */
export async function walkingLeg(a, b) {
  if (!a || !b || !a.lat || !a.lng || !b.lat || !b.lng || !isSupabase) return null
  try {
    const u = new URL('/api/walking', window.location.origin)
    u.searchParams.set('from', `${a.lng},${a.lat}`)
    u.searchParams.set('to', `${b.lng},${b.lat}`)
    const res = await fetch(u.toString())
    const j = await res.json()
    if (!j?.ok) return null
    return { min: j.min, km: j.km, steps: Array.isArray(j.steps) ? j.steps : [] }
  } catch {
    return null
  }
}

/** 步行估算(无代理时):按直线距离 1.3 倍、均速 5km/h */
export function walkEstimate(a, b) {
  const straight = distKm(a, b)
  const km = Math.round(straight * 1.3 * 100) / 100
  return { min: Math.max(1, Math.round((km / 5) * 60)), km }
}

/** 公共交通步骤 → 一句话摘要,如 “地铁10号线 → 步行 300m(约4分)” */
export function fmtTransitSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return ''
  return steps
    .map((s) => {
      if (s.mode === 'WALK') return `步行${s.walk_m || 0}米`
      const line = String(s.line || '公共交通').replace(/\(.*?\)/g, '').trim()
      const to = s.to ? `→${s.to}` : ''
      return `${line}${to}`
    })
    .join(' → ')
}


/** 公共交通时长估算(分钟):公交/高铁综合按“自驾×1.25+40 起步” */
export function transitMinutes(drivingMin) {
  if (!drivingMin || drivingMin <= 0) return null
  return Math.max(15, Math.round(drivingMin * 1.25 + 40))
}

/** 中段表述,如 “自驾约 1 小时 20 分” */
export function fmtMinute(min) {
  if (!min) return ''
  const m = Number(min)
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${m} 分钟`
  return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`
}

/**
 * 途经道路摘要文案,如 “高速/快速 386km · 国道 24km”
 * roads: [{ kind, km, via?: [路名] }]
 */
export function fmtRoadsText(roads) {
  const list = Array.isArray(roads) ? roads.filter((r) => r && r.km > 0) : []
  if (!list.length) return ''
  return list
    .slice(0, 4)
    .map((r) => `${r.kind} ${Math.round(r.km)}km`)
    .join(' · ')
}
