// Cloudflare Pages Function:高德分享链接解析
// 输入: /api/parse-share?url=https://surl.amap.com/xxxx
// 输出: { ok, source, name?, lat?, lng?, label? } —— 供 GeoPlacePicker 自动选点
// 说明:服务端跟随跳转(CORS 无限制),解析 uri.amap.com 长链中的坐标/名称;
//       若跳转到 www.amap.com/place/<id>,再用高德 place/detail 拿坐标(需 AMAP_KEY)

export async function onRequestGet(context) {
  const url = new URL(context.request.url)
  const share = url.searchParams.get('url') || ''
  const key = context.env.AMAP_KEY || ''

  if (!/^https?:\/\//i.test(share)) {
    return json({ ok: false, reason: 'invalid' })
  }

  try {
    const res = await fetch(share, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    })
    const finalUrl = res.url || share
    const final = new URL(finalUrl)

    // 1) uri.amap.com 长链:查询参数里直接带坐标与名称
    if (/amap\.com/i.test(final.hostname)) {
      const params = final.searchParams
      const pairKeys = ['position', 'to', 'dest', 'destination', 'location']
      const nameKeys = ['toName', 'name', 'destName', 'keyword', 'markername']
      for (const pk of pairKeys) {
        const v = params.get(pk)
        if (v && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(v.trim())) {
          const [lng, lat] = v.split(',').map(Number)
          let name = ''
          for (const nk of nameKeys) {
            const n = params.get(nk)
            if (n) {
              name = n
              break
            }
          }
          if (!name && final.pathname.includes('marker')) name = '分享位置'
          return json({
            ok: true,
            source: 'amap-url',
            name,
            lat,
            lng,
            label: `${name || '分享位置'} · 高德分享解析`
          })
        }
      }
    }

    // 2) POI 详情页: https://www.amap.com/place/<id> (需 key 查详情)
    const m = final.hostname.match(/amap\.com/i) && final.pathname.match(/^\/place\/([A-Za-z0-9]+)/)
    if (m && key) {
      const detailRes = await fetch(
        `https://restapi.amap.com/v3/place/detail?id=${encodeURIComponent(m[1])}&key=${encodeURIComponent(key)}`
      )
      const detail = await detailRes.json()
      const poi = detail.pois && detail.pois[0]
      if (detail.status === '1' && poi && poi.location) {
        const [lng, lat] = poi.location.split(',').map(Number)
        return json({
          ok: true,
          source: 'amap-place',
          name: poi.name,
          lat,
          lng,
          label: `${poi.name} · ${poi.cityname || ''}${poi.adname ? ' · ' + poi.adname : ''}`
        })
      }
      return json({ ok: false, reason: 'place_not_found' })
    }

    return json({ ok: false, reason: 'unsupported_share' })
  } catch (e) {
    return json({ ok: false, reason: String(e && e.message) || 'network_error' })
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}
