// Cloudflare Pages Function:步行路径规划代理(高德 Web服务 /v3/direction/walking)
// 输入: /api/walking?from=<lng,lat>&to=<lng,lat>
// 输出: { ok, min, km, steps:[{instruction,distance,min}] }
// 安全:AMAP_KEY 只保存在 Pages 环境变量;结果 no-store
import { json, amapReason } from '../lib/amap.js'

export async function onRequestGet(context) {
  const url = new URL(context.request.url)
  const from = (url.searchParams.get('from') || '').trim()
  const to = (url.searchParams.get('to') || '').trim()
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
      destination: `${p2.lng},${p2.lat}`
    })
    const res = await fetch(`https://restapi.amap.com/v3/direction/walking?${params.toString()}`)
    const data = await res.json()
    if (data.status !== '1') return json({ ok: false, reason: amapReason(data, 'no_walking') })
    const path = data.route?.paths?.[0]
    if (!path) return json({ ok: false, reason: 'no_route' })

    const steps = (path.steps || []).map((s) => ({
      instruction: s.instruction || '',
      distance: Number(s.distance) || 0,
      min: Math.max(1, Math.ceil((Number(s.duration) || 0) / 60))
    }))

    return json({
      ok: true,
      source: 'amap',
      min: Math.max(1, Math.ceil((Number(path.duration) || 0) / 60)),
      km: Math.round(((Number(path.distance) || 0) / 1000) * 100) / 100,
      steps: steps.slice(0, 20)
    })
  } catch (e) {
    return json({ ok: false, reason: String(e && e.message) || 'network_error' })
  }
}
