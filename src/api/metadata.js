// ============================================================
// 链接自动识别(分享链接 → 标题/封面)
// 多源尝试,任一失败即返回 null,不影响用户手动填写
// ============================================================

async function viaMicrolink(url) {
  const r = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`)
  if (!r.ok) throw new Error(String(r.status))
  const j = await r.json()
  const d = j?.data || {}
  return {
    title: (d.title || '').trim() || null,
    image: (d.image?.url || d.image || '').trim() || null
  }
}

async function viaJina(url) {
  // Jina Reader:把网页转 markdown,头部带 Title / Image 字段
  const r = await fetch(`https://r.jina.ai/${url}`)
  if (!r.ok) throw new Error(String(r.status))
  const text = await r.text()
  const title = text.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || null
  const image = text.match(/^Image:\s*(\S+)$/m)?.[1] || null
  return { title, image }
}

const SOURCES = [viaMicrolink, viaJina]

/** 自动识别分享链接元信息;失败返回 null */
export async function fetchLinkMeta(url) {
  const raw = String(url || '').trim()
  if (!/^https?:\/\//i.test(raw)) return null
  for (const src of SOURCES) {
    try {
      const meta = await src(raw)
      if (meta?.title) return meta
    } catch {
      /* 尝试下一源 */
    }
  }
  return null
}
