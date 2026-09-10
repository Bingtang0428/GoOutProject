// Cloudflare Pages Function:公共交通路径规划代理(高德 Web服务 /v3/direction/transit/integrated)
// 输入: /api/transit?from=<lng,lat>&to=<lng,lat>[&city=<城市名或adcode>]
// 输出: { ok, min, km, cost, steps:[{mode,line,from,to,via_stops,walk_m,walk_min,min,instruction}] }
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
  if (bus) return bus.name || MODE_TEXT[bus.type] || '公交'
  if (seg.railway) return seg.railway.name || '铁路'
  if (seg.taxi) return '打车'
  return '公共交通'
}

function pt(s) {
  const m = /^(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)$/.exec(s)
  if (!m) return null
  return { lng: Number(m[1]), lat: Number(m[3]) }
}

/** 逆地理编码取城市名(origin 无城市参数时用) */
async function regeoCity(lng, lat, key) {
  try {
    const res = await fetch(
      `https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${key}&extensions=base`
    )
    const data = await res.json()
    if (data.status !== '1') return ''
    const ac = data.regeocode?.addressComponent
    if (!ac) return ''
    const city = typeof ac.city === 'string' && ac.city ? ac.city : ''
    return city || ac.province || ''
  } catch {
    return ''
  }
}

async function callTransit(key, p1, p2, city, cityd) {
  const params = new URLSearchParams({
    key,
    origin: `${p1.lng},${p1.lat}`,
    destination: `${p2.lng},${p2.lat}`,
    city: city || '',
    cityd: cityd || city || '',
    strategy: '0',
    extensions: 'all'
  })
  const res = await fetch(`https://restapi.amap.com/v3/direction/transit/integrated?${params.toString()}`)
  return res.json()
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url)
  const from = (url.searchParams.get('from') || '').trim()
  const to = (url.searchParams.get('to') || '').trim()
  let city = (url.searchParams.get('city') || '').trim()
  const key = context.env.AMAP_KEY

  if (!key) return json({ ok: false, reason: 'no_key' })
  const p1 = pt(from)
  const p2 = pt(to)
  if (!p1 || !p2) return json({ ok: false, reason: 'invalid_coords' })

  try {
    let data = await callTransit(key, p1, p2, city, city)
    // 首次失败/无方案:用逆地理取到起终点城市再试一次(支持跨城)
    if (data.status !== '1' || !data.route?.transits?.length) {
      const [c1, c2] = await Promise.all([regeoCity(p1.lng, p1.lat, key), regeoCity(p2.lng, p2.lat, key)])
      if (c1) {
        data = await callTransit(key, p1, p2, c1, c2 || c1)
        city = c1
      }
    }

    if (data.status !== '1') return json({ ok: false, reason: amapReason(data, 'no_transit') })
    const route = data.route
    const transits = route?.transits || []
    if (!transits.length) return json({ ok: false, reason: 'no_route' })

    const best = transits[0]
    // ★ 高德公交规划的总时长/距离在「方案(transits[i])」上,而非 route 上
    const durationSec = Number(best.duration) || Number(route.duration) || 0
    const distanceM = Number(best.distance) || Number(route.distance) || 0
    if (!durationSec) return json({ ok: false, reason: 'no_duration' })
    const steps = []

    for (const seg of best.segments || []) {
      if (seg.walking) {
        const dist = Number(seg.walking.distance) || 0
        const wmin = Math.max(1, Math.ceil(dist / 80))
        const instr = (seg.walking.steps || [])
          .map((s) => s.instruction)
          .filter(Boolean)
          .join(';')
          .slice(0, 80)
        steps.push({ mode: 'WALK', line: '步行', walk_m: Math.round(dist), walk_min: wmin, instruction: instr })
        continue
      }
      const bus = seg.bus?.buslines?.[0]
      if (bus) {
        const type = MODE_TEXT[bus.type] || (bus.type ? bus.type : '公交')
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
      city,
      min: Math.max(1, Math.round(durationSec / 60)),
      km: Math.round((distanceM / 1000) * 10) / 10,
      cost: Number(best.cost) || 0,
      walking_m: Number(best.walking_distance) || 0,
      steps: steps.slice(0, 24)
    })
  } catch (e) {
    return json({ ok: false, reason: String(e && e.message) || 'network_error' })
  }
}
