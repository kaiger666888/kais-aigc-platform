/**
 * styleLibraryApi.ts — Krea 风格库 API 客户端(wt/style-library, 2026-09-06)。
 *
 * 服务端: /api/canvas/v2/style-library (src/routes/canvas/v2/style-library.ts)。
 * GET 全走裸 fetch 先例(canvasApi.ts listStandards 同款语义):超时 abort +
 * 失败返回 null 不抛——风格面板是辅助工具,任何失败都降级为空态,不许打断画布。
 * probe_verdict 契约: 'pass' | 'fix' | 'reject' | null(未探针);服务端 list
 * 缺省隐藏 reject,前端「显示已否决」开关显式传 includeRejected=true。
 */

const API_BASE = '/api'
const TIMEOUT_MS = 15_000

export type StyleProbeVerdict = 'pass' | 'fix' | 'reject' | null

export interface StyleCategoryRow {
  category_en: string
  category_cn: string
  /** 一级分类(服务端按 category_en/category_cn 首段拆出),前端一级 tab 聚合键 */
  group_en: string
  group_cn: string
  count: number
}

export interface StyleListItem {
  id: string
  name: string
  name_cn: string
  category_en: string
  category_cn: string
  /** 相对 URL(同源 <img> 直接可用),id 段已 encodeURIComponent */
  thumbUrl: string
  /** prompt 模板,恒以 "Subject:{prompt}" 结尾({prompt} 为 subject 占位符) */
  prompt: string
  probe_verdict: StyleProbeVerdict
}

export interface StyleListResult {
  total: number
  page: number
  pageSize: number
  items: StyleListItem[]
}

export interface StyleItemDetail extends StyleListItem {
  negative_prompt: string
  thumbUrl: string
  usage: {
    promptTemplate: string
    placeholder: string
    placeholderSemantics: string
  }
}

export interface StyleListQuery {
  category?: string
  group?: string
  search?: string
  page?: number
  pageSize?: number
  includeRejected?: boolean
}

/** GET 裸 fetch 收口:超时 abort;非 200/网络失败返回 null 不抛。 */
async function getStyleData<T>(path: string): Promise<T | null> {
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE}/canvas/v2/style-library${path}`, { signal: timeoutController.signal })
    if (!res.ok) return null
    const json = await res.json()
    if (json?.code !== 200 && json?.code !== 0) return null
    return (json.data ?? null) as T | null
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

/** GET /categories — 41 个二级分类计数(count 降序;缺省含 reject,合计=3548)。 */
export async function fetchStyleCategories(): Promise<StyleCategoryRow[] | null> {
  const data = await getStyleData<{ categories: StyleCategoryRow[] }>('/categories')
  return data?.categories ?? null
}

/** GET /list — 分页列表(服务端缺省隐藏 probe_verdict==='reject')。 */
export async function fetchStyleList(q: StyleListQuery = {}): Promise<StyleListResult | null> {
  const params = new URLSearchParams()
  if (q.category) params.set('category', q.category)
  if (q.group) params.set('group', q.group)
  if (q.search?.trim()) params.set('search', q.search.trim())
  params.set('page', String(q.page ?? 1))
  params.set('pageSize', String(q.pageSize ?? 60))
  if (q.includeRejected) params.set('includeRejected', 'true')
  return getStyleData<StyleListResult>(`/list?${params.toString()}`)
}

/** GET /item?id= — 单条完整定义(含 prompt 模板占位符语义说明);不存在 → null。 */
export async function fetchStyleItem(id: string): Promise<StyleItemDetail | null> {
  return getStyleData<StyleItemDetail>(`/item?id=${encodeURIComponent(id)}`)
}

/**
 * 组装最终 prompt:模板恒以 "Subject:{prompt}" 结尾(服务端全量校验过)。
 * subject 空 → 只用风格词(剥掉 "Subject:{prompt}" 尾巴);非空 → 全量替换占位符。
 */
export function composeStylePrompt(template: string, subject: string): string {
  const s = subject.trim()
  if (!s) return template.replace(/\s*Subject:\s*\{prompt\}\s*$/i, '').trim()
  return template.replace(/\{prompt\}/g, s)
}

/** 剪贴板兜底:http 非安全源(经 IP 访问 :10588)无 navigator.clipboard。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
