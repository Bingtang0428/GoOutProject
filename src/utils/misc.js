// 通用小工具:ID 生成、柔和渐变配色、文本哈希

/**
 * 本地 id。
 * - 浏览器支持 crypto.randomUUID 时直接返回纯 UUID(后端 uuid 列必需,不能用前缀!)
 * - 老环境回退到随机字符串(可带 prefix 便于阅读)
 */
export function uid(prefix = '') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  const rnd = Math.random().toString(36).slice(2) + Date.now().toString(36)
  return prefix ? `${prefix}-${rnd}` : rnd
}

/** 纯 UUID(不依赖 crypto.randomUUID,老环境也能生成),用于数据库 uuid 列 */
export function makeUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  const t = (Date.now() + Math.random() * 1e12).toString(16)
  const s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
  return `${s.slice(0, 14)}${t.slice(-4)}${s.slice(18)}`
}

/** 是否为合法 UUID(供数据库写入前校验) */
export function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

/** 计划卡片柔和渐变(豆沙粉为主、奶油/薄荷/丁香点缀) */
export const PASTEL_GRADS = [
  ['#F7DFE7', '#F3CBD8'], // 豆沙粉
  ['#FBECE2', '#F9DCCA'], // 奶油杏
  ['#E9F3EE', '#DCEFE4'], // 薄荷
  ['#F9E9F0', '#F5D3E2'], // 蔷薇
  ['#EFE6F7', '#E6D7F3']  // 丁香
]

/** 头像渐变(饱和、双色,围绕豆沙粉同色系) */
export const AVATAR_GRADS = [
  ['#F0A9BD', '#B75973'],
  ['#F2A48E', '#EB7A5E'],
  ['#7FC8A9', '#3DA97C'],
  ['#C3A0EA', '#9B6BD9'],
  ['#F2C464', '#DFA124'],
  ['#F59FB4', '#E76F90']
]

function hash(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return h
}

/** 按名字取稳定的渐变配色 */
export function gradOf(name, grads = AVATAR_GRADS) {
  return grads[hash(name) % grads.length]
}

export function pastelOf(idx) {
  const list = PASTEL_GRADS
  return list[Math.abs(Number(idx) || 0) % list.length]
}

/** 名字 -> 头像首字符 */
export function initialOf(name = '') {
  const n = name.trim()
  if (!n) return '?'
  return n[0].toUpperCase()
}

/** URL 域名提取,如 bilibili.com */
export function hostOf(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
