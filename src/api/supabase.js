// ============================================================
// Supabase 客户端
// 未配置环境变量时 isSupabase = false,项目整体降级为
// 「本地演示模式」:数据存 localStorage,无实时订阅。
// ============================================================
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabase = Boolean(url && anonKey)

export const supabase = isSupabase ? createClient(url, anonKey) : null

export function storageUrl(path) {
  // 攻略封面等公开资源:通过 public 桶拼接完整 URL
  if (!path || path.startsWith('http') || path.startsWith('data:')) return path
  return `${url}/storage/v1/object/public/covers/${path}`
}

export async function uploadCover(file, planId) {
  // 上传攻略封面到 storage 桶 covers,路径按 计划id/随机名 组织。
  // 仅在 Supabase 模式下生效;演示模式由调用方转为 base64(dataURL)。
  if (!supabase) return ''
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${planId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('covers').upload(path, file, {
    cacheControl: '3600',
    upsert: false
  })
  if (error) throw error
  return path
}
