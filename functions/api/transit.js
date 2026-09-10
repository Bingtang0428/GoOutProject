// Cloudflare Pages Function:公共交通路径规划代理(高德 Web服务 /v3/direction/transit/integrated)
// 输入: /api/transit?from=<lng,lat>&to=<lng,lat>&city=<城市名或adcode>
// 输出: { ok, min, km, cost, steps:[{mode,line,from,to,walk_m,walk_min,min,instruction}] }
// 覆盖:公交/地铁/轮渡/步行接驳等多种公共交通方式
// 安全:AMAP_KEY 只保存在 Pages 环境变量;结果 no-store
import { json, amapReason } from '../lib/amap.js'

const MODE_TEXT = {
  WALK: '步行',
  BUS: '公交',
  SUBWAY: '地铁',
  RAILWAY: '铁路',
  TAXI: '打车',
  FERRY: '轮渡',
  CABLEWAY: '索道',
  AIRPLANE: '飞机'
}

function lineLabel(seg) {
  if (seg.walking) return '步行'
  const bus = seg.bus?.buslines?.[0]
  if (bus) {
    const type = MODE_TEXT[bus.type] || '公交'
    return bus.name || type
  }
  if (seg.railway) return seg.railway.name || '铁路'
  if (seg.taxi) return '打车'
  return '公共交通'
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url)
  const from = (url.searchParams.get('from') || '').trim()
  const to = (url.searchParams.get('to') || '').trim()
  const city = (url.searchParams.get('city') || '').trim()
  const key = context.env.AMAP_KEY

  if (!key) return json({ ok: false, reason: 'no_key' })

  const pt = (s) => {
    const m = /^(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)$/.exec(s)
    if (!m) return null
    return { lng: Number(m[1]), lat: Number(m[3]) }
  }
  const p1 = pt(from)
  const p2 = pt(to)
  if (!p1 || !p2) return json({ ok: false, reason: 'invalid_coords' })

  try {
    const params = new URLSearchParams({
      key,
      origin: `${p1.lng},${p1.lat}`,
      destination: `${p2.lng},${p2.lat}`,
      city: city || '',
      cityd: city || '',
      strategy: '0',
      extensions: 'all'
    })
    const res = await fetch(`https://restapi.amap.com/v3/direction/transit/integrated?${params.toString()}`)
    const data = await res.json()
    if (data.status !== '1') return json({ ok: false, reason: amapReason(data, 'no_transit') })
    const route = data.route
    const transits = route?.transits || []
    if (!transits.length) return json({ ok: false, reason: 'no_route' })

    const best = transits[0]
    const steps = []
    for (const seg of best.segments || []) {
      if (seg.walking) {
        const dist = Number(seg.walking.distance) || 0
        steps.push({
          mode: 'WALK',
          line: '步行',
          walk_m: Math.round(dist),
          walk_min: Math.max(1, Math.ceil(dist / 80)),
          instruction: (seg.walking.steps || []).map((s) => s.instruction).filter(Boolean).join(';').slice(0, 80)
        })
        continue
      }
      const bus = seg.bus?.buslines?.[0]
      if (bus) {
        const type = MODE_TEXT[bus.type] || '公交'
        steps.push({
          mode: bus.type || 'BUS',
          line: bus.name || type,
          from: bus.departure_stop?.name || '',
          to: bus.arrival_stop?.name || '',
          via_stops: Number(bus.via_num) || 0,
          min: Math.max(1, Math.ceil((Number(bus.duration) || 0) / 60))
        })
        continue
      }
      if (seg.railway) {
        steps.push({
          mode: 'RAILWAY',
          line: seg.railway.name || '铁路',
          from: seg.railway.departure_stop?.name || '',
          to: seg.railway.arrival_stop?.name || '',
          min: Math.max(1, Math.ceil((Number(seg.railway.time) || 0) / 60))
        })
        continue
      }
      if (seg.taxi) {
        steps.push({ mode: 'TAXI', line: '打车', min: Math.max(1, Math.ceil((Number(seg.taxi.duration) || 0) / 60)) })
        continue
      }
      steps.push({ mode: 'OTHER', line: lineLabel(seg) })
    }

    return json({
      ok: true,
      source: 'amap',
      min: Math.max(1, Math.ceil((Number(route.duration) || 0) / 60)),
      km: Math.round(((Number(route.distance) || 0) / 1000) * 10) / 10,
      cost: Number(route.transits?.[0]?.cost) || 0,
      steps: steps.slice(0, 20)
    })
  } catch (e) {
    return json({ ok: false, reason: String(e && e.message) || 'network_error' })
  }
}
