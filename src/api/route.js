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

const cache = new Map() // 'lat,lng|lat,lng' -> minutes

/** 估算自驾分钟(OSRM duration,秒 → 分钟,向上取整) */
export async function drivingMinutes(a, b, force = false) {
  if (!a || !b || !a.lat || !a.lng || !b.lat || !b.lng) return null
  const key = `${a.lat},${a.lng}|${b.lat},${b.lng}`
  if (cache.has(key) && !force) return cache.get(key)
  let minutes = null
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false&steps=false`
    )
    if (res.ok) {
      const json = await res.json()
      const dur = json?.routes?.[0]?.duration
      if (typeof dur === 'number' && dur > 0) minutes = Math.ceil(dur / 60)
    }
  } catch {
    /* fall through */
  }
  if (!minutes) {
    // 直线距离按平均 60km/h 兜底
    minutes = Math.max(1, Math.ceil((distKm(a, b) / 60) * 60))
  }
  cache.set(key, minutes)
  return minutes
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
