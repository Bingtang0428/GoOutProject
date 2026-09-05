// ============================================================
// 坐标地理编码服务
//  云端(Supabase/Pages):一律经本站 /api/geocode 服务端代理 → 高德(中文)
//  本地演示模式:仍用 Photon(OSM),便于无 Key 离线演示
// ============================================================
import { isSupabase } from '@/api/supabase'

const cache = new Map() // 候选词 -> {lat,lng} | null

const STOP_WORDS = ['取车', '入住', '觅食', '汇合', '集合', '返程', '停车', '打卡', '看日出', '午饭', '午餐', '回程', '出发']

/** 清理地点描述:去掉括号、备注与动作词,保留真正可搜索的地理名称 */
export function cleanQuery(raw) {
  let s = String(raw || '')
  s = s.replace(/[（(].*?[)）]/g, '').trim()
  // “黄山北站 · 取车” → 黄山北站;“返程 · 京台高速” → 京台高速
  const parts = s.split(/[·•|,，、]/).map((x) => x.trim()).filter(Boolean)
  const head = parts[0] || ''
  const isHeadAction = STOP_WORDS.some((w) => head === w || head.endsWith(w))
  let q = isHeadAction && parts.length > 1 ? parts.slice(1).join('') : head
  for (const w of STOP_WORDS) {
    if (q.endsWith(w) && q.length > w.length + 1) q = q.slice(0, -w.length).trim()
  }
  return q
}

/* 装饰性后缀,由长到短依次剥离生成候选词 */
const DECOR = ['风景名胜区', '风景区', '山水画廊', '景区', '游客中心', '换乘中心', '博物馆', '公园', '画廊', '停车场', '观景台', '驿站', '营地', '老街', '中心', '景区北门', '景区南门']

function candidatesOf(q, hint) {
  const set = []
  const push = (x) => {
    x = (x || '').trim().replace(/\s+/g, ' ')
    if (x && !set.includes(x)) set.push(x)
  }
  push(q)
  if (hint) push(`${hint} ${q}`)
  let cur = q
  for (const d of DECOR) {
    if (cur.length > d.length + 2 && cur.endsWith(d)) {
      cur = cur.slice(0, -d.length).trim()
      push(cur)
      if (hint) push(`${hint} ${cur}`)
    }
  }
  return set
}

async function photon(q) {
  const u = new URL('https://photon.komoot.io/api/')
  u.searchParams.set('q', q)
  u.searchParams.set('limit', '1')
  const res = await fetch(u.toString())
  if (!res.ok) throw new Error(String(res.status))
  const j = await res.json()
  const f = j?.features?.[0]
  if (!f?.geometry?.coordinates) return null
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }
}

async function nominatim(q) {
  const u = new URL('https://nominatim.openstreetmap.org/search')
  u.searchParams.set('format', 'json')
  u.searchParams.set('limit', '1')
  u.searchParams.set('q', q)
  const res = await fetch(u.toString(), { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(String(res.status))
  const rows = await res.json()
  return rows?.[0] ? { lat: parseFloat(rows[0].lat), lng: parseFloat(rows[0].lon) } : null
}

/**
 * @param {string} raw    目的地原始描述
 * @param {object}  [opts]
 * @param {string}  [opts.hint] 城市提示(计划集合城市),用于消歧
 */
export async function geocodePlace(raw, opts = {}) {
  const q = cleanQuery(raw)
  if (!q) return null
  const hint = (opts.hint || '').replace(/(市|省)$/, '')
  const key = hint ? `${hint}>${q}` : q
  if (cache.has(key)) return cache.get(key)

  // 云端:经本站代理走高德(中文),配置 AMAP_KEY 后不再依赖 OSM
  if (isSupabase) {
    try {
      const u = new URL('/api/geocode', window.location.origin)
      u.searchParams.set('type', 'geo')
      u.searchParams.set('q', q)
      if (hint) u.searchParams.set('city', opts.hint)
      const res = await fetch(u.toString())
      const j = await res.json()
      if (j?.ok && j.location?.lat != null && j.location?.lng != null) {
        const hit = { lat: j.location.lat, lng: j.location.lng }
        cache.set(key, hit)
        return hit
      }
    } catch {
      /* 进入兜底 */
    }
  }

  // 1) Photon 逐个候选尝试(本地演示 / 未配置高德 Key 时兜底)
  for (const c of candidatesOf(q, hint)) {
    try {
      const hit = await photon(c)
      if (hit) {
        cache.set(key, hit)
        return hit
      }
    } catch {
      /* 尝试下一个候选/源 */
    }
  }
  // 2) Nominatim 兜底(海外直连时更稳)
  try {
    const hit = await nominatim(hint ? `${hint} ${q}` : q)
    cache.set(key, hit)
    return hit
  } catch {
    cache.set(key, null)
    return null
  }
}

/** 让地图弹窗展示网页导航链接 —— 自动使用国内地图(高德,无 Key 直开) */
export function navUrl(place, wgs) {
  const name = encodeURIComponent(place || '')
  if (wgs && typeof wgs.lat === 'number' && typeof wgs.lng === 'number') {
    // WGS84 → GCJ-02(高德坐标系),偏差通常百米级,可直接驾车导航
    const g = wgs2gcj(wgs.lat, wgs.lng)
    return `https://uri.amap.com/navigation?to=${g.lng},${g.lat}&toName=${name}&mode=car`
  }
  // 无坐标:关键词搜索定位(在集合城市内更准)
  return `https://uri.amap.com/search?keyword=${name}`
}

/**
 * 精确选点:优先走本站服务端代理(高德中文 POI),失败回退 Photon(OSM)
 * hint=计划集合城市,用于消歧
 */
export async function searchPlaces(raw, hint = '') {
  const q = cleanQuery(raw)
  if (!q || q.length < 2) return []
  // 1) 高德(服务端代理,中文地名/地址,无 CORS 问题)
  try {
    const u = new URL('/api/geocode', window.location.origin)
    u.searchParams.set('q', q)
    if (hint) u.searchParams.set('city', hint)
    const res = await fetch(u.toString())
    if (res.ok) {
      const j = await res.json()
      if (j.ok && j.candidates?.length) {
        return j.candidates.slice(0, 8)
      }
    }
  } catch {
    /* fallback 下一源 */
  }

  // 2) Photon(OSM)兜底 —— 注意:Photon 不支持 lang 参数(传参会 400)
  const tries = [q]
  if (hint) tries.push(`${hint} ${q}`)
  const out = []
  const seen = new Set()
  for (const t of tries) {
    try {
      const u = new URL('https://photon.komoot.io/api/')
      u.searchParams.set('q', t)
      u.searchParams.set('limit', '6')
      const res = await fetch(u.toString())
      if (!res.ok) continue
      const j = await res.json()
      for (const f of j.features || []) {
        const p = f.properties || {}
        const g = f.geometry?.coordinates || []
        const name = p.name || p.osm_value || ''
        const region = [p.district, p.county, p.city, p.state].filter(Boolean).join(' · ')
        const label = region ? `${name} · ${region}` : name
        if (!name || seen.has(label)) continue
        seen.add(label)
        out.push({ name, label, lat: g[1], lng: g[0] })
      }
      if (out.length >= 4) break
    } catch {
      /* continue */
    }
  }
  // 中文优先:OSM 部分点位同时有中英文名时,优先展示含中文的名称
  const cjk = (s) => /[\u4e00-\u9fff]/.test(s)
  out.sort((a, b) => (cjk(b.name) ? 1 : 0) - (cjk(a.name) ? 1 : 0))
  return out.slice(0, 8)
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
