// ============================================================
// 地图坐标服务(OpenStreetMap Nominatim,免费无 Key)
// 演示/离线场景不可用时静默失败,路线列表仍可正常使用。
// ============================================================

const cache = new Map() // 查询串 -> {lat,lng} | null(null=已尝试失败)

export async function geocodePlace(query) {
  const q = String(query || '').trim()
  if (!q) return null
  if (cache.has(q)) return cache.get(q)
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cn&q=${encodeURIComponent(q)}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) throw new Error(res.status)
    const rows = await res.json()
    const hit = rows[0]
    const out = hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : null
    cache.set(q, out)
    return out
  } catch {
    cache.set(q, null)
    return null
  }
}

/** 让地图弹窗展示 高德/谷歌 均可的网页导航链接 */
export function navUrl(place) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`
}
