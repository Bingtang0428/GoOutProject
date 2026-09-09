// Cloudflare Pages Function:地点检索服务端代理(高德 Web 服务)
// 用途:GeoPlacePicker 调 /api/geocode?q=xxx&city=xxx
// 安全:AMAP_KEY 只保存在 Pages 环境变量,不暴露给浏览器
// 注意:本文件不参与本地 Vite 构建,由 Cloudflare 自动部署为 /api/geocode

export async function onRequestGet(context) {
  const url = new URL(context.request.url)
  const type = url.searchParams.get('type') || 'place'
  const q = url.searchParams.get('q') || ''
  const city = url.searchParams.get('city') || ''
  const key = context.env.AMAP_KEY

  if (!q) return json({ ok: false, reason: 'empty' })
  if (!key) return json({ ok: false, reason: 'no_key', candidates: [], location: null })

  // 坐标解析(自动定位/天气/地图补点):高德 /v3/geocode/geo
  if (type === 'geo') {
    try {
      const params = new URLSearchParams({ key, address: q })
      if (city) params.set('city', city)
      const res = await fetch(`https://restapi.amap.com/v3/geocode/geo?${params.toString()}`)
      const data = await res.json()
      const first = data.geocodes && data.geocodes[0]
      if (data.status === '1' && first) {
        const [lng, lat] = String(first.location).split(',').map(Number)
        return json({ ok: true, source: 'amap', location: { lat, lng }, label: first.formatted_address || '' })
      }
      return json({ ok: false, reason: amapReason(data, 'no_result'), location: null })
    } catch (e) {
      return json({ ok: false, reason: String(e && e.message), location: null })
    }
  }

  // POI 检索(选点器):高德 /v3/place/text
  const params = new URLSearchParams({
    key,
    keywords: q,
    types: '风景名胜,商务住宅,餐饮服务,道路附属设施,地名地址信息,交通设施服务',
    offset: '8',
    page: '1',
    extensions: 'base'
  })
  if (city) params.set('city', city)

  try {
    const res = await fetch(`https://restapi.amap.com/v3/place/text?${params.toString()}`)
    const data = await res.json()
    if (data.status !== '1') return json({ ok: false, reason: amapReason(data, 'amap_error'), candidates: [] })

    const candidates = (data.pois || []).map((p) => {
      const [lng, lat] = String(p.location || '0,0').split(',').map(Number)
      const region = [p.pname, p.cityname && p.cityname !== p.pname ? p.cityname : '', p.adname]
        .filter(Boolean)
        .join(' · ')
      return {
        name: p.name,
        label: `${p.name} · ${region}${p.address ? ` · ${p.address}` : ''}`,
        address: p.address || '',
        lat,
        lng
      }
    })
    return json({ ok: true, source: 'amap', candidates })
  } catch (e) {
    return json({ ok: false, reason: String(e && e.message), candidates: [] })
  }
}

/**
 * 把高德返回的 info/infocode 拼进 reason 并附可自查提示
 * (错误码表:https://lbs.amap.com/api/webservice/guide/tools/info)
 * 例: reason = "INVALID_USER_KEY(10001) · key 不正确或过期"
 */
const AMAP_HINTS = {
  10001: 'key 不正确或过期',
  10005: '服务器出口 IP 未在高德控制台设置的 IP 白名单内(Cloudflare 出口 IP 会变动)',
  10007: '该 key 开启了数字签名,请求需带 sig 参数',
  10009: '请求 key 与绑定平台不符,需使用「Web服务」类型的 key',
  10003: '今日配额已用尽,明日 0 点自动解封',
  10004: '单位时间内请求过频,已被临时限流',
  10010: '未设置 IP 白名单,单 IP 请求超限(需提工单解封)',
  10013: 'key 已被删除',
  10044: '账号维度日调用量超出限制'
}
function amapReason(data, fallback) {
  const code = data && data.infocode
  const info = (data && data.info) || fallback
  return `${info}(${code || '0'})${code && AMAP_HINTS[code] ? ' · ' + AMAP_HINTS[code] : ''}`
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store' // 高德代理结果不做任何缓存(含 Service Worker 之外的边缘/浏览器缓存)
    }
  })
}
