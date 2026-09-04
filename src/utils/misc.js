// 通用小工具:ID 生成、柔和渐变配色、文本哈希

/** 本地 id(Supabase 模式优先使用 uuid) */
export function uid(prefix = '') {
  const rnd =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return prefix ? `${prefix}-${rnd}` : rnd
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
