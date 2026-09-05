// ============================================================
// 全局轻提示(Toast)
// 用法:import { toast } from '@/composables/toast'
//       toast('已保存', 'success') / toast('删除失败', 'error')
//       toast('已复制', 'info')
// ============================================================
import { reactive } from 'vue'

export const toasts = reactive([])
let seed = 0

export function toast(message, type = 'success', ms = 2600) {
  const id = ++seed
  toasts.push({ id, message, type })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i !== -1) toasts.splice(i, 1)
  }, ms)
}
