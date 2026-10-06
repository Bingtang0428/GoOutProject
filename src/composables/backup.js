// ============================================================
// 计划数据备份:导出/导入整份计划(计划信息 + 全部内容行)
// ============================================================
import { useContentStore } from '@/stores/content'
import { usePlansStore } from '@/stores/plans'

export function useBackup() {
  const content = useContentStore()
  const plans = usePlansStore()

  /** 下载某计划为 JSON 备份 */
  function downloadPlan(planId) {
    const plan = plans.plans.find((p) => p.id === planId)
    if (!plan) return
    const data = {
      type: 'tongxing-plan',
      version: 1,
      exportedAt: new Date().toISOString(),
      plan,
      content: content.exportRows(planId)
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(plan.name || '计划').replace(/[\\/:*?"<>|]/g, '_')}.json`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 1000)
  }

  /**
   * 从备份文件导入为一份新计划。
   * @param {File} file
   */
  async function importFromFile(file) {
    const text = await file.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error('不是有效的 JSON 文件')
    }
    if (data?.type !== 'tongxing-plan' || !data.plan) throw new Error('文件格式不正确(不是本应用导出的备份)')
    const raw = data.plan
    if (!raw.start_date || !raw.end_date) throw new Error('备份缺少行程日期')
    const p = await plans.createPlan({
      name: (raw.name || '导入的计划') + '(导入)',
      destination: raw.destination || '',
      start_city: raw.start_city || '',
      start_date: raw.start_date,
      end_date: raw.end_date,
      gradient: raw.gradient ?? 0,
      budget: raw.budget ?? null,
      currency: raw.currency || 'CNY',
      members: raw.members || []
    })
    for (const [key, list] of Object.entries(data.content || {})) {
      await content.importRows(p.id, key, list)
    }
    return p
  }

  return { downloadPlan, importFromFile }
}
