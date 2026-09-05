// 兔兔同行 · 简易 Service Worker(应用外壳离线缓存)
// 注意:跨域请求(地图瓦片/天气/定位等)不做缓存处理
const VERSION = 'rabbit-v2'
const PRECACHE = ['/', '/index.html', '/favicon.svg']

function htmlFallback() {
  return new Response(
    '<!doctype html><html><head><meta charset="utf-8"><title>兔兔同行</title><meta http-equiv="refresh" content="0;url=/"></head><body></body></html>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  )
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // 不缓存跨域资源

  // 页面导航:网络优先,失败回退到缓存的应用外壳;两者皆无时给最小 HTML
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(() =>
          caches
            .match('/index.html')
            .then((hit) => hit || caches.match('/'))
            .then((hit) => hit || htmlFallback())
        )
    )
    return
  }

  // 静态资源(带 hash 的 js/css/字体):缓存优先,同时后台更新
  e.respondWith(
    caches.match(req).then((hit) => {
      const fetchAndCache = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(VERSION).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => hit)
        .then((res) => res || new Response(null, { status: 404 }))
      return hit || fetchAndCache
    })
  )
})
