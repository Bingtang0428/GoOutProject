// ============================================================
// 本机浏览器通知(无需后端):用户授权后,可在「今天有提醒」时触达
// ============================================================

export function notifySupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notifyPermission() {
  return notifySupported() ? Notification.permission : 'denied'
}

export async function requestNotify() {
  if (!notifySupported()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

export function showNotify(title, body = '') {
  if (!notifySupported() || Notification.permission !== 'granted') return false
  try {
    new Notification(title, { body, icon: '/favicon.svg', tag: title })
    return true
  } catch {
    return false
  }
}
