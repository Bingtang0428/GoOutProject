// ============================================================
// 天气服务(Open-Meteo,免费无需 Key,支持 CORS)
// 按 经纬度+日期 取每日最高/最低温与天气码;演示与离线不可用时返回 null。
// ============================================================

const cache = new Map() // `${lat},${lng}|${date}` -> data | null

/** WMO 天气码 → 图标/文案 */
export function wxMeta(code) {
  const c = Number(code)
  const m = {
    0: ['fa-sun', '晴'],
    1: ['fa-sun', '晴间多云'],
    2: ['fa-cloud-sun', '多云'],
    3: ['fa-cloud', '阴'],
    45: ['fa-smog', '雾'],
    48: ['fa-smog', '雾凇'],
    51: ['fa-cloud-rain', '毛毛雨'],
    53: ['fa-cloud-rain', '毛毛雨'],
    55: ['fa-cloud-rain', '细雨'],
    61: ['fa-cloud-showers-heavy', '小雨'],
    63: ['fa-cloud-showers-heavy', '中雨'],
    65: ['fa-cloud-showers-heavy', '大雨'],
    71: ['fa-snowflake', '小雪'],
    73: ['fa-snowflake', '中雪'],
    75: ['fa-snowflake', '大雪'],
    77: ['fa-snowflake', '雪粒'],
    80: ['fa-cloud-rain', '阵雨'],
    81: ['fa-cloud-rain', '强阵雨'],
    82: ['fa-cloud-showers-heavy', '暴雨'],
    95: ['fa-cloud-bolt', '雷雨'],
    96: ['fa-cloud-bolt', '雷雨伴冰雹'],
    99: ['fa-cloud-bolt', '强雷暴']
  }
  const hit = m[c] || m[Number.isNaN(c) ? -1 : c] || ['fa-cloud', '未知']
  return { icon: hit[0], label: hit[1] }
}

export async function fetchDailyWeather(lat, lng, dateISO) {
  const key = `${lat}|${lng}|${dateISO}`
  if (cache.has(key)) return cache.get(key)
  try {
    const u = new URL('https://api.open-meteo.com/v1/forecast')
    u.searchParams.set('latitude', lat)
    u.searchParams.set('longitude', lng)
    u.searchParams.set('daily', 'weathercode,temperature_2m_max,temperature_2m_min')
    u.searchParams.set('timezone', 'auto')
    u.searchParams.set('start_date', dateISO)
    u.searchParams.set('end_date', dateISO)
    const res = await fetch(u.toString())
    if (!res.ok) throw new Error(String(res.status))
    const json = await res.json()
    const i = (json?.daily?.time || []).indexOf(dateISO)
    if (i === -1) throw new Error('no-forecast')
    const out = {
      max: json.daily.temperature_2m_max[i],
      min: json.daily.temperature_2m_min[i],
      code: json.daily.weathercode[i]
    }
    cache.set(key, out)
    return out
  } catch {
    cache.set(key, null)
    return null
  }
}

/** 温度友好文案,如 21°/30° */
export function wxTempText(d) {
  if (!d) return ''
  return `${Math.round(d.min)}°/${Math.round(d.max)}°`
}
