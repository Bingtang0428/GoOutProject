// ============================================================
// 金额格式化(全站统一,支持多币种)
// 通过 setCurrency(plan.currency) 切换当前币种符号。
// ============================================================

const SYMBOLS = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  HKD: 'HK$',
  TWD: 'NT$',
  MOP: 'MOP$',
  THB: '฿',
  KRW: '₩',
  SGD: 'S$',
  MYR: 'RM',
  AUD: 'A$'
}

/** 可选币种(创建计划时选择) */
export const CURRENCIES = [
  { code: 'CNY', label: '人民币 ¥' },
  { code: 'USD', label: '美元 $' },
  { code: 'EUR', label: '欧元 €' },
  { code: 'GBP', label: '英镑 £' },
  { code: 'JPY', label: '日元 ¥' },
  { code: 'HKD', label: '港币 HK$' },
  { code: 'TWD', label: '新台币 NT$' },
  { code: 'THB', label: '泰铢 ฿' },
  { code: 'KRW', label: '韩元 ₩' },
  { code: 'SGD', label: '新加坡元 S$' },
  { code: 'MYR', label: '马来西亚林吉特 RM' },
  { code: 'AUD', label: '澳元 A$' }
]

let current = 'CNY'

/** 切换当前币种(由当前计划决定) */
export function setCurrency(code) {
  current = SYMBOLS[code] ? code : 'CNY'
}
export function currentCurrency() {
  return current
}
export function currencySymbol() {
  return SYMBOLS[current] || '¥'
}

/** ¥1,234.56; maxFrac=0 时输出 ¥1,235 */
export function money(n, maxFrac = 2) {
  const v = Number(n || 0)
  const neg = v < 0
  const abs = Math.abs(v)
  const s = abs.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac
  })
  const sym = currencySymbol()
  return (neg ? '-' : '') + sym + s
}

/** 纯数字千分位(不带符号),用于统计卡 */
export function num(n, maxFrac = 0) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: maxFrac })
}
