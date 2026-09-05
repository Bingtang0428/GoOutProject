// ============================================================
// 行程路段时长自动估算
//  - 自驾:OSRM 公共路由(免费无 Key,不可用时退回直线距离估算)
//  - 公共交通:无 Key 无法获取班次时刻,按「自驾时长 × 系数 + 等待」
//    做保守估算,并明确标注为「约」,建议由领队手动校准
// ============================================================

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

const cache = new Map() // 'lat,lng|lat,lng' -> {min, km}

/** 估算自驾(OSRM):返回 { min: 分钟, km: 公里 } */
export async function drivingLeg(a, b, force = false) {
  if (!a || !b || !a.lat || !a.lng || !b.lat || !b.lng) return null
  const key = `${a.lat},${a.lng}|${b.lat},${b.lng}`
  if (cache.has(key) && !force) return cache.get(key)
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
  const out = { min, km }
  cache.set(key, out)
  return out
}

/** 兼容旧调用:仅返回分钟 */
export async function drivingMinutes(a, b, force = false) {
  const leg = await drivingLeg(a, b, force)
  return leg ? leg.min : null
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
