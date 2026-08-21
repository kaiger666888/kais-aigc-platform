/**
 * qcVerdict.ts — 眼/耳 verdict 派生 selector(Phase 56-01 / VIZ-01,D-13 单一真值链)。
 *
 * 审计节点(voice-audit/video-qc/preview-qc)raw 袋 → per-item 列表防御式解析 →
 * 按 shot_id join 资产节点 → Map<assetNodeId, QcVerdict[]>。识别失败 = 空 Map +
 * console.warn(每审计节点至多一条),绝不抛异常——fail-soft 是契约而非缺陷
 * (khs 同步形状漂移不炸画布)。资产 raw 袋自带 qc_verdict/verdict 直读优先
 * (shortcut 演进位,khs 未来直写无缝)。
 *
 * 纯模块零 React;消费侧 memo(useMemo),不在 store 持久化。
 */
import type { FlowGraphV3 } from '@kais/flowgraph-v3'

export interface QcVerdict {
  judge: 'eye' | 'ear';
  verdict: 'pass' | 'warn' | 'fail';
}

type RawBag = Record<string, unknown>

const AUDIT_VOCAB: ReadonlyArray<{ token: string; judge: 'eye' | 'ear' }> = [
  { token: 'voice-audit', judge: 'ear' },
  { token: 'voice_audit', judge: 'ear' },
  { token: 'video-qc', judge: 'eye' },
  { token: 'video_qc', judge: 'eye' },
  { token: 'preview-qc', judge: 'eye' },
  { token: 'preview_qc', judge: 'eye' },
]

/** per-item 列表探测键序(形状各异;识别不了返回 null)。 */
const LIST_KEYS = ['clips', 'per_shot', 'shots', 'items', 'variants'] as const

/** shortcut 直读键序(资产自带 verdict 时优先)。 */
const SHORTCUT_KEYS = ['qc_verdict', 'verdict'] as const

function isRecord(v: unknown): v is RawBag {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function normalizeVerdict(v: unknown): QcVerdict['verdict'] | null {
  const s = typeof v === 'string' ? v.toUpperCase() : ''
  if (s === 'PASS') return 'pass'
  if (s === 'WARN') return 'warn'
  if (s === 'FAIL') return 'fail'
  return null
}

function auditJudgeOf(nodeId: string, raw: RawBag): 'eye' | 'ear' | null {
  const haystack = `${nodeId} ${String(raw.phase ?? '')} ${String(raw.gate ?? '')} ${String(raw.assetType ?? '')}`
  for (const { token, judge } of AUDIT_VOCAB) {
    if (haystack.includes(token)) return judge
  }
  return null
}

/** 从 raw 袋探测 per-item 列表(item 需含 shot_id + verdict 才命中)。 */
function detectItems(raw: RawBag): Array<{ shotId: string; verdict: QcVerdict['verdict'] }> | null {
  for (const key of LIST_KEYS) {
    const list = raw[key]
    if (!Array.isArray(list)) continue
    const items: Array<{ shotId: string; verdict: QcVerdict['verdict'] }> = []
    for (const it of list) {
      if (!isRecord(it)) continue
      const shotId = typeof it.shot_id === 'string' ? it.shot_id : (typeof it.shotId === 'string' ? it.shotId : null)
      const verdict = normalizeVerdict(it.verdict)
      if (shotId == null || verdict == null) continue
      items.push({ shotId, verdict })
    }
    if (items.length > 0) return items
  }
  return null
}

/**
 * 派生:审计节点 × 资产节点(shot_id join)+ 资产 shortcut 直读。
 * graph/raw 为空 → 空 Map;永不 throw。
 */
export function deriveQcVerdicts(
  graph: FlowGraphV3 | null,
  raw: Map<string, RawBag> | null,
): Map<string, QcVerdict[]> {
  const out = new Map<string, QcVerdict[]>()
  if (graph == null) return out

  const push = (nodeId: string, v: QcVerdict) => {
    const arr = out.get(nodeId)
    if (arr == null) out.set(nodeId, [v])
    else arr.push(v)
  }

  // Pass 1:资产节点 shot_id 索引 + shortcut 直读
  const assetByShotId = new Map<string, string>()
  for (const n of graph.nodes) {
    if (n.kind !== 'asset') continue
    const d = raw?.get(n.id) ?? {}
    const shotId = typeof d.shot_id === 'string' ? d.shot_id : (typeof d.shotId === 'string' ? d.shotId : null)
    if (shotId != null) assetByShotId.set(shotId, n.id)
    for (const key of SHORTCUT_KEYS) {
      const verdict = normalizeVerdict(d[key])
      if (verdict != null) {
        // shortcut 无判官信息——按 key 前缀猜(ear 仅 voice 域;缺省 eye)
        push(n.id, { judge: key === 'qc_verdict' && String(d[key]).toLowerCase().includes('ear') ? 'ear' : 'eye', verdict })
        break
      }
    }
  }

  // Pass 2:审计节点 per-item 列表 → join
  for (const n of graph.nodes) {
    if (n.kind !== 'asset') continue
    const d = raw?.get(n.id) ?? {}
    const judge = auditJudgeOf(n.id, d)
    if (judge == null) continue
    const items = detectItems(d)
    if (items == null) {
      console.warn(`[qcVerdict] 审计节点 ${n.id} 无可识别 per-item 列表(键序 ${LIST_KEYS.join('/')}),跳过`)
      continue
    }
    for (const item of items) {
      const assetId = assetByShotId.get(item.shotId)
      if (assetId == null) continue
      push(assetId, { judge, verdict: item.verdict })
    }
  }

  return out
}
