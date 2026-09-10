// Cloudflare Pages Function:链接元信息抓取(分享链接 → 标题/封面/摘要)
// 输入: /api/link-meta?url=<encoded>
// 输出: { ok, title, image, description, finalUrl }
// 说明:服务端以桌面浏览器 UA 跟随跳转抓取 HTML,解析 og:title/og:image/og:description;
//       小红书等需带 xsec_token 的分享链接在服务端抓取可拿到 og 标签。
import { json } from '../lib/amap.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function metaContent(html, prop) {
  const p = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i')
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, 'i')
  const m = html.match(re1) || html.match(re2)
  return m ? decode(m[1]) : ''
}

function metaContents(html, prop) {
  const p = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const out = []
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, 'gi')
  let m
  while ((m = re.exec(html))) out.push(decode(m[1]))
  return out
}

function toHttps(u) {
  if (!u) return ''
  if (u.startsWith('//')) return 'https:' + u
  if (u.startsWith('http://')) return 'https://' + u.slice(7)
  return u
}

function isPrivateHost(host) {
  const h = (host || '').toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') return true
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  if (h === '::1' || h.endsWith('.local')) return true
  return false
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url)
  const target = url.searchParams.get('url') || ''
  if (!/^https?:\/\//i.test(target)) return json({ ok: false, reason: 'invalid' })
  let u
  try {
    u = new URL(target)
  } catch {
    return json({ ok: false, reason: 'invalid' })
  }
  if (isPrivateHost(u.hostname)) return json({ ok: false, reason: 'blocked' })

  try {
    const res = await fetch(target, {
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
        Referer: u.origin + '/'
      }
    })
    const html = (await res.text()).slice(0, 800000)

    let title =
      metaContent(html, 'og:title') ||
      metaContent(html, 'twitter:title') ||
      (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)[1]) : '')
    title = title.replace(/\s*[-|–—]\s*小红书\s*$/i, '').trim()

    const imgs = metaContents(html, 'og:image').concat(metaContents(html, 'twitter:image'))
    // 跳过小红书平台默认 logo,优先笔记图片
    const real = imgs.find((x) => x && !/picasso-static\.xiaohongshu\.com\/fe-platform/i.test(x))
    const image = toHttps(real || imgs[0] || '')

    const description = metaContent(html, 'og:description') || metaContent(html, 'description')

    return json({ ok: Boolean(title || image), title: title || '', image, description: description || '', finalUrl: res.url })
  } catch (e) {
    return json({ ok: false, reason: String(e && e.message) || 'network_error' })
  }
}
