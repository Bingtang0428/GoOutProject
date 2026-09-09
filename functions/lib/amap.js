// ============================================================
// 高德 Web服务 共用工具(functions/* 服务端)
// - json():统一 JSON 响应(no-store,绝不缓存)
// - amapReason():把 info/infocode 拼进 reason 并附可自查提示
//   错误码表: https://lbs.amap.com/api/webservice/guide/tools/info
// ============================================================

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

export function amapReason(data, fallback) {
  const code = data && data.infocode
  const info = (data && data.info) || fallback
  return `${info}(${code || '0'})${code && AMAP_HINTS[code] ? ' · ' + AMAP_HINTS[code] : ''}`
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store' // 高德代理结果不做任何缓存(含边缘/浏览器/Service Worker)
    }
  })
}

/**
 * 折线抽稀:把上千个坐标点压到 ≤max 个,保留首尾点与整体形状
 * @param {Array<{lat:number,lng:number}>} pts
 */
export function downsample(pts, max = 200) {
  if (!Array.isArray(pts) || pts.length <= max) return pts
  const step = (pts.length - 1) / (max - 1)
  const out = []
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)])
  return out
}
