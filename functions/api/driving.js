// Cloudflare Pages Function:驾车路线规划代理(高德 Web服务 /v3/direction/driving)
// 输入: /api/driving?from=<lng,lat>&to=<lng,lat>[&strategy=10]
// 输出: { ok, km, min, tolls, roads, geometry }
//   - geometry 为高德 GCJ-02 折线 [{lat,lng},…](≤200 点),客户端统一转 WGS84 后入库
//   - roads 为途经道路分类汇总 [{kind,km,via:[代表路名]}],kind ∈ 高速/国道/省道/县道/城市道路
// 安全:AMAP_KEY 只保存在 Pages 环境变量;结果 no-store
import { json, amapReason, downsample } from '../lib/amap.js'

/** 道路分类:按道路/指令文字识别途经道路类型 */
function roadKindOf(text) {
  const t = String(text || '')
  if (/高速|快速路|快速通道|绕城/.test(t)) return '高速/快速'
  if (/国道|(^|[^\d])G\d/.test(t)) return '国道'
  if (/省道|(^|[^\d])S\d/.test(t)) return '省道'
  if (/县道|乡道|(^|[^\d])[XY]\d/.test(t)) return '县道'
  return '城市道路'
}

/** 清洗路名,去掉编号前后空白并保留中文名称(如 "G50沪渝高速") */
function cleanRoadName(t) {
  return String(t || '').replace(/[（(].*?[)）]/g, '').trim().slice(0, 20) || ''
}

/**
 * 汇总沿途道路:按分类累加里程,每类记录前几个代表路名
 * steps: 高德 v3 返回的导航步骤(带 road/polyline/distance)
 */
function summarizeRoads(steps) {
  const agg = new Map() // kind -> { kind, km, names:Map(name->km) }
  let unnamed = 0
  for (const st of steps || []) {
    const km = (Number(st.distance) || 0) / 1000
    if (km <= 0) continue
    const raw = st.road || st.instruction || ''
    const name = cleanRoadName(raw)
    const kind = name ? roadKindOf(raw) : '城市道路'
    if (!agg.has(kind)) agg.set(kind, { kind, km: 0, names: new Map() })
    const g = agg.get(kind)
    g.km += km
    if (name) g.names.set(name, (g.names.get(name) || 0) + km)
    else unnamed += km
  }
  const roads = [...agg.values()]
    .map((g) => {
      const top = [...g.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n)
      return { kind: g.kind, km: Math.round(g.km * 10) / 10, via: top }
    })
    .filter((r) => r.km >= 0.1)
    .sort((a, b) => b.km - a.km)
  return { roads, unnamed }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url)
  const from = (url.searchParams.get('from') || '').trim()
  const to = (url.searchParams.get('to') || '').trim()
  const strategy = url.searchParams.get('strategy') || '10'
  const key = context.env.AMAP_KEY

  if (!key) return json({ ok: false, reason: 'no_key' })

  // 起点/终点都必须形如 "lng,lat"
  const pt = (s) => {
    const m = /^(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)$/.exec(s)
    if (!m) return null
    const lng = Number(m[1])
    const lat = Number(m[3])
    if (Math.abs(lat) > 85 || Math.abs(lng) > 180) return null
    return { lng, lat }
  }
  const p1 = pt(from)
  const p2 = pt(to)
  if (!p1 || !p2) return json({ ok: false, reason: 'invalid_coords' })

  try {
    const params = new URLSearchParams({
      key,
      origin: `${p1.lng},${p1.lat}`,
      destination: `${p2.lng},${p2.lat}`,
      strategy,
      extensions: 'all'
    })
    const res = await fetch(`https://restapi.amap.com/v3/direction/driving?${params.toString()}`)
    const data = await res.json()
    const path = data.route?.paths?.[0]
    if (data.status !== '1' || !path) {
      return json({ ok: false, reason: amapReason(data, 'no_route') })
    }

    // 拼接各步骤折线(GCJ-02)
    const raw = []
    for (const st of path.steps || []) {
      if (!st.polyline) continue
      for (const seg of String(st.polyline).split(';')) {
        const [lng, lat] = seg.split(',')
        const ln = Number(lng)
        const la = Number(lat)
        if (Number.isFinite(ln) && Number.isFinite(la)) raw.push({ lat: la, lng: ln })
      }
    }

    const { roads, unnamed } = summarizeRoads(path.steps)
    const tolls = Number(path.tolls) || 0
    const tollKm = Number(path.toll_distance) || 0

    return json({
      ok: true,
      source: 'amap',
      km: Math.round((Number(path.distance) || 0) / 1000 * 10) / 10,
      min: Math.max(1, Math.ceil((Number(path.duration) || 0) / 60)),
      tolls: Number.isFinite(tolls) && tolls > 0 ? Math.round(tolls * 100) / 100 : 0,
      tollKm: Number.isFinite(tollKm) && tollKm > 0 ? Math.round(tollKm / 1000) : 0,
      roads,
      unnamedKm: Math.round(unnamed * 10) / 10,
      geometry: downsample(raw, 200)
    })
  } catch (e) {
    return json({ ok: false, reason: String(e && e.message) || 'network_error' })
  }
}
