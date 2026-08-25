/**
 * 文字资产阅读器 —— 文档型资产（Notion 导入 8 类 + 管线文本文档）的详情视图。
 *
 * 与 StoryboardReader（05125263 分镜板一等公民）同一先例：文档资产不走通用媒体
 * 布局（大 emoji + prompt 摘要——08-24 缺口①剧本正文零展示），而是拿到一个
 * 真正的阅读面。accent 沿用 --cv-mod-text（文本模态金）：这块面板就是 text
 * modality 的具象化。
 *
 * 结构签名：稿纸列 —— 单一 46em 阅读栏（中文剧本最优行宽），正文 1.95 行高；
 * meta 键序即阅读序（作者书写顺序天然保留）。meta 形状按值分类渲染：
 *   长文（content/doc/creative_brief/visual_prefix…）→ markdown-lite 正文
 *   短字段（场景/关键道具/基调…）→ 键值行（.am-sb-f 同语法）
 *   字符串数组（hook_checks/layers…）→ 列表
 *   对象数组（story_framework.episodes[20]…）→ 紧凑梗概卡
 *
 * 真值源诚实化：头部常驻 provenance（子类型 · 集数 · 来源 · 导入时间），
 * source='notion' 时提供「Notion 在线版 →」跳 Tab 4（在线真值）—— 注册表快照
 * 与 Notion 在线源两个家的关系在 UI 上可见，不再是隐形平行宇宙。
 *
 * 纯解析函数（parseDocumentMeta/parseProseLines/isDocumentAsset）导出供单测。
 */
import { useMemo } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import {
  SUBTYPE_EMOJI, SUBTYPE_LABEL,
  type AssetItem, type AssetSubtype,
} from './assetManagerData'

// ─── 纯解析层 ─────────────────────────────────────────────

/** meta 中不渲染的框架键（subtype 用于门控，source 折进 provenance 行）。 */
const META_SKIPPED_KEYS = new Set(['subtype', 'source'])

/** 短字段与长文的分界：超此长度或含换行 → 正文流（prose）。 */
const PROSE_MIN_CHARS = 80

/** 已知 meta 键 → 中文标签（缺省回退原键名）。 */
export const DOC_FIELD_LABELS: Record<string, string> = {
  episode: '集数', title: '标题', content: '正文', scene: '场景', key_props: '关键道具',
  expose_state: '暴露状态', hook_checks: '钩子检查', storyboard_detail: '分镜说明',
  total_episodes: '总集数', layers: '层级规划', episodes: '分集梗概',
  storyboard_appendix: '分镜附录', genre: '类型', tone: '基调', language: '语言',
  form_factor: '形式', visual_style: '视觉风格', creative_brief: '创作简报',
  scene_name: '场景名', episode_occurrence: '出场集数', layout: '布局',
  lighting: '灯光', props: '道具', ai_prefix: 'AI 前缀', character: '角色',
  costume: '服装', makeup: '妆造', doc: '正文', characters: '角色',
  visual_prefix: '视觉前缀', t0_known: 'T0 已知', costume_desc: '服装描述',
}

export type DocField =
  | { kind: 'field'; key: string; label: string; value: string }
  | { kind: 'prose'; key: string; label: string; text: string }
  | { kind: 'list'; key: string; label: string; items: string[] }
  | {
      kind: 'records'; key: string; label: string
      records: Array<Array<[string, string]>>
    }

function labelOf(key: string): string {
  return DOC_FIELD_LABELS[key] ?? key
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * meta JSON → 有序文档字段列表。键序即阅读序（JSON.parse 保字符串键插入序，
 * 即作者书写序）。无可展示字段（null/非对象/只剩框架键）返回 null —— 调用方
 * 回退通用详情布局。
 */
export function parseDocumentMeta(meta: string | null | undefined): DocField[] | null {
  if (!meta) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(meta)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null

  const fields: DocField[] = []
  for (const [key, raw] of Object.entries(parsed)) {
    if (META_SKIPPED_KEYS.has(key)) continue

    if (typeof raw === 'number' || typeof raw === 'boolean') {
      fields.push({ kind: 'field', key, label: labelOf(key), value: String(raw) })
      continue
    }
    if (typeof raw === 'string') {
      const t = raw.trim()
      if (!t) continue
      if (t.length > PROSE_MIN_CHARS || t.includes('\n')) {
        fields.push({ kind: 'prose', key, label: labelOf(key), text: t })
      } else {
        fields.push({ kind: 'field', key, label: labelOf(key), value: t })
      }
      continue
    }
    if (Array.isArray(raw)) {
      // 字符串数组 → 列表；对象数组 → 梗概卡（值取字符串化的第一层键值）。
      const strs = raw.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((s) => s.trim())
      if (raw.length > 0 && strs.length === raw.length) {
        fields.push({ kind: 'list', key, label: labelOf(key), items: strs })
        continue
      }
      const records = raw.filter(isPlainObject).map((o) =>
        Object.entries(o)
          .filter(([, v]) => v != null && (typeof v !== 'string' || v.trim()))
          .map(([k, v]) => [labelOf(k), typeof v === 'object' ? JSON.stringify(v) : String(v)] as [string, string]),
      )
      if (records.length > 0) fields.push({ kind: 'records', key, label: labelOf(key), records })
      continue
    }
    // 嵌套对象（现网文档无此形状）：平铺为单条梗概卡，不丢信息。
    if (isPlainObject(raw)) {
      const rec = Object.entries(raw)
        .filter(([, v]) => v != null && (typeof v !== 'string' || v.trim()))
        .map(([k, v]) => [labelOf(k), typeof v === 'object' ? JSON.stringify(v) : String(v)] as [string, string])
      if (rec.length > 0) fields.push({ kind: 'records', key, label: labelOf(key), records: [rec] })
    }
  }
  return fields.length > 0 ? fields : null
}

/** markdown-lite 行类型（###/•/--- 三件套覆盖现网剧本文档全部排版）。 */
export type ProseLine =
  | { t: 'h'; level: 1 | 2 | 3; text: string }
  | { t: 'p'; text: string }
  | { t: 'li'; text: string }
  | { t: 'hr' }

/** 长文 → 排版行序列（# 标题 / •·- 列表 / --- 分隔 / 其余段落；空行折叠）。 */
export function parseProseLines(text: string): ProseLine[] {
  const out: ProseLine[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      out.push({ t: 'h', level: Math.min(h[1].length, 3) as 1 | 2 | 3, text: h[2].trim() })
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      out.push({ t: 'hr' })
      continue
    }
    const li = line.match(/^([-•*·▪]|–)\s+(.*)$/)
    if (li) {
      out.push({ t: 'li', text: li[2].trim() })
      continue
    }
    out.push({ t: 'p', text: line })
  }
  return out
}

/** createdAt（秒/毫秒两态防御）→ 「08-20 导入」短日期；缺失返回 null。 */
function formatImportDate(createdAt?: number | null): string | null {
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt <= 0) return null
  const ms = createdAt < 1e12 ? createdAt * 1000 : createdAt
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 导入`
}

// ─── 渲染层 ───────────────────────────────────────────────

function Prose({ text }: { text: string }) {
  const lines = useMemo(() => parseProseLines(text), [text])
  return (
    <div className="am-rd-prose">
      {lines.map((ln, i) => {
        if (ln.t === 'hr') return <hr className="am-rd-hr" key={i} />
        if (ln.t === 'h') return <h4 className={`am-rd-h am-rd-h--${ln.level}`} key={i}>{ln.text}</h4>
        if (ln.t === 'li') return <p className="am-rd-li" key={i}>{ln.text}</p>
        return <p className="am-rd-p" key={i}>{ln.text}</p>
      })}
    </div>
  )
}

/** 梗概卡（story_framework.episodes[20] 等）：首行徽标 + 键值行。 */
function RecordCard({ rows }: { rows: Array<[string, string]> }) {
  const [head, ...rest] = rows
  return (
    <div className="am-rd-rec">
      {head && (
        <div className="am-rd-rec__h">
          <span className="am-rd-rec__chip">{head[1]}</span>
          {head[0] !== '标题' && <span className="am-rd-rec__t">{head[0]} {head[1]}</span>}
        </div>
      )}
      {rest.map(([k, v]) => (
        <div className="am-rd-f" key={k + v}>
          <span className="am-rd-f__k">{k}</span>
          <span className="am-rd-f__v">{v}</span>
        </div>
      ))}
    </div>
  )
}

export default function TextReader({
  item, detail, onBack,
}: {
  item: AssetItem
  /** 命中的真实 AssetDetail（provenance 取 createdAt；mock 路径可传 undefined）。 */
  detail?: { createdAt?: number | null }
  onBack: () => void
}) {
  const fields = useMemo(() => parseDocumentMeta(item.meta), [item.meta])
  // meta 一次解析共用：subtype（头部 emoji/标签）+ source（provenance）。
  const metaObj = useMemo(() => {
    if (!item.meta) return null
    try {
      const o: unknown = JSON.parse(item.meta)
      return o && typeof o === 'object' ? (o as Record<string, unknown>) : null
    } catch {
      return null
    }
  }, [item.meta])

  if (!fields) return null

  const sub = typeof metaObj?.subtype === 'string' ? metaObj.subtype : null
  const source = metaObj?.source === 'notion' ? 'Notion' : '注册表'
  const episodeField = fields.find((f) => f.key === 'episode' && f.kind === 'field')
  const importDate = formatImportDate(detail?.createdAt)
  const label = sub && sub in SUBTYPE_LABEL ? SUBTYPE_LABEL[sub as AssetSubtype] : null
  const emoji = sub && sub in SUBTYPE_EMOJI ? SUBTYPE_EMOJI[sub as AssetSubtype] : '📝'

  const openNotionTab = () => {
    const store = useCanvasStore.getState()
    store.navPushCallback?.()
    store.closeAssetDetail()
    store.setAssetView('documents')
  }

  return (
    <div className="am-rd" data-testid="text-reader">
      <div className="am-rd-head">
        <button className="am-det__back" onClick={onBack}>‹ 返回资产库</button>
        <div className="am-rd-head__t">
          <span className="am-rd-head__emoji">{emoji}</span>
          <b>{item.name}</b>
        </div>
        <div className="am-rd-head__prov">
          {label && <span className="am-rd-chip">{label}</span>}
          {episodeField && episodeField.kind === 'field' && <span>Ep{episodeField.value}</span>}
          <span>来源 {source}</span>
          {importDate && <span>{importDate}</span>}
          {source === 'Notion' && (
            <button className="am-rd-head__link" onClick={openNotionTab} title="在 Notion 在线源中查看最新版">
              Notion 在线版 →
            </button>
          )}
        </div>
      </div>

      <div className="am-rd-col">
        {fields.map((f) => {
          if (f.kind === 'prose') return <Prose key={f.key} text={f.text} />
          if (f.kind === 'field') {
            return (
              <div className="am-rd-f" key={f.key}>
                <span className="am-rd-f__k">{f.label}</span>
                <span className="am-rd-f__v">{f.value}</span>
              </div>
            )
          }
          if (f.kind === 'list') {
            return (
              <section key={f.key}>
                <div className="am-seclabel">{f.label}</div>
                <ul className="am-rd-list">
                  {f.items.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </section>
            )
          }
          return (
            <section key={f.key}>
              <div className="am-seclabel">{f.label} · {f.records.length} 条</div>
              <div className="am-rd-recs">
                {f.records.map((rows, i) => <RecordCard key={i} rows={rows} />)}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
