// Cloudflare Pages Function:地点检索服务端代理(高德 Web 服务)
// 用途:GeoPlacePicker 调 /api/geocode?q=xxx&city=xxx
// 安全:AMAP_KEY 只保存在 Pages 环境变量,不暴露给浏览器
// 注意:本文件不参与本地 Vite 构建,由 Cloudflare 自动部署为 /api/geocode

export async function onRequestGet(context) {
  const url = new URL(context.request.url)
  const q = url.searchParams.get('q') || ''
  const city = url.searchParams.get('city') || ''
  const key = context.env.AMAP_KEY

  if (!q) return json({ ok: false, reason: 'empty' })
  if (!key) return json({ ok: false, reason: 'no_key', candidates: [] })

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
    if (data.status !== '1') return json({ ok: false, reason: data.info || 'amap_error', candidates: [] })

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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}
