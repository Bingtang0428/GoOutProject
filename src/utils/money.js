// ============================================================
// 金额格式化(全站统一,避免各组件各自实现不一致)
// ============================================================

/** ¥1,234.56; maxFrac=0 时输出 ¥1,235 */
export function money(n, maxFrac = 2) {
  const v = Number(n || 0)
  const neg = v < 0
  const abs = Math.abs(v)
  const s = abs.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac
  })
  return (neg ? '-¥' : '¥') + s
}

/** 纯数字千分位(不带符号),用于统计卡 */
export function num(n, maxFrac = 0) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: maxFrac })
}
