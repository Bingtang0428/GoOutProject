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

/** 逆地理编码取城市名与 adcode(无城市参数时用) */
async function regeoInfo(lng, lat, key) {
  try {
    const res = await fetch(
      `https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${key}&extensions=base`
    )
    const data = await res.json()
    if (data.status !== '1') return null
    const ac = data.regeocode?.addressComponent
    if (!ac) return null
    const city = typeof ac.city === 'string' && ac.city ? ac.city : ''
    return { name: city || ac.province || '', adcode: ac.adcode || '' }
  } catch {
    return null
  }
}

async function callTransit(key, p1, p2, city, cityd, strategy = '0') {
  const params = new URLSearchParams({
    key,
    origin: `${p1.lng},${p1.lat}`,
    destination: `${p2.lng},${p2.lat}`,
    city: city || '',
    cityd: cityd || city || '',
    strategy,
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
    const failed = () => data.status !== '1' || !data.route?.transits?.length

    // 首次失败/无方案:用逆地理取起终点城市,并轮换城市名/adcode 与策略重试(支持跨城)
    if (failed()) {
      const [i1, i2] = await Promise.all([regeoInfo(p1.lng, p1.lat, key), regeoInfo(p2.lng, p2.lat, key)])
      const tries = []
      if (i1?.name) tries.push([i1.name, i2?.name || i1.name])
      if (i1?.adcode) tries.push([i1.adcode, i2?.adcode || i1.adcode])
      if (city) tries.push([city, city])
      if (!tries.length) return json({ ok: false, reason: 'no_city' })
      outer: for (const [c, cd] of tries) {
        for (const st of ['0', '1', '2']) {
          data = await callTransit(key, p1, p2, c, cd, st)
          city = c
          if (!failed()) break outer
        }
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
    const segs = best.segments || []

    for (const seg of segs) {
      const bus = seg.bus?.buslines?.[0]
      const rail = seg.railway
      const taxi = seg.taxi
      const walk = seg.walking
      // ★ 高德每段同时带全部键,未用到的为空对象 {};必须判断「非空」而非「存在」
      const hasBus = bus && (bus.name || bus.id)
      const hasRail = rail && (rail.name || rail.id || rail.departure_stop)
      const hasTaxi = taxi && (Number(taxi.duration) > 0 || Number(taxi.distance) > 0)
      const walkDist = Number(walk?.distance) || 0
      const hasWalk = walk && (walkDist > 0 || (Array.isArray(walk.steps) && walk.steps.length))

      if (hasBus) {
        const typeStr = String(bus.type || '')
        const nameStr = String(bus.name || '')
        const mode = /地铁/.test(typeStr + nameStr) ? 'SUBWAY' : /轮渡|船/.test(typeStr + nameStr) ? 'FERRY' : 'BUS'
        steps.push({
          mode,
          line: bus.name || MODE_TEXT[mode] || '公交',
          from: bus.departure_stop?.name || '',
          to: bus.arrival_stop?.name || '',
          via_stops: Number(bus.via_num) || 0,
          min: Math.max(1, Math.ceil((Number(bus.duration) || 0) / 60))
        })
        continue
      }
      if (hasRail) {
        steps.push({
          mode: 'RAILWAY',
          line: rail.name || '铁路',
          from: rail.departure_stop?.name || '',
          to: rail.arrival_stop?.name || '',
          min: Math.max(1, Math.ceil((Number(rail.time) || 0) / 60))
        })
        continue
      }
      if (hasTaxi) {
        steps.push({ mode: 'TAXI', line: '打车', min: Math.max(1, Math.ceil((Number(taxi.duration) || 0) / 60)) })
        continue
      }
      if (hasWalk) {
        const wmin = Math.max(1, Math.ceil(walkDist / 80))
        const instr = (walk.steps || [])
          .map((s) => s.instruction)
          .filter(Boolean)
          .join(';')
          .slice(0, 80)
        steps.push({ mode: 'WALK', line: '步行', walk_m: Math.round(walkDist), walk_min: wmin, instruction: instr })
        continue
      }
      // 进/出站等辅助段,忽略不计入乘车
    }

    return json({
      ok: true,
      source: 'amap',
      city,
      min: Math.max(1, Math.round(durationSec / 60)),
      km: Math.round((distanceM / 1000) * 10) / 10,
      cost: Number(best.cost) || 0,
      walking_m: Number(best.walking_distance) || 0,
      segCount: segs.length,
      segKinds: segs.map((s) => Object.keys(s || {}).join('+')).slice(0, 12),
      steps: steps.slice(0, 24)
    })
  } catch (e) {
    return json({ ok: false, reason: String(e && e.message) || 'network_error' })
  }
}
