/**
 * qcVerdict.ts — 眼/耳 verdict 派生 selector(Phase 56-01 / VIZ-01,D-13 单一真值链)。
 *
 * 审计节点(voice-audit/video-qc/preview-qc)raw 袋 → per-item 列表防御式解析 →
 * 按 shot_id join 资产节点 → Map<assetNodeId, QcVerdict[]>。识别失败 = 空 Map +
 * console.warn(每审计节点至多一条),绝不抛异常——fail-soft 是契约而非缺陷
 * (khs 同步形状漂移不炸画布)。资产 raw 袋自带 qc_verdict/verdict 直读优先
 * (shortcut 演进位,khs 未来直写无缝)。
 *
 * 72-01/72-05 (v3.2 F26/F32) 修真——原三断点:
 *  a) per_shot 真形是 dict(p11c_video_qc.py per_shot:{sid:rec})非 array,
 *     LIST_KEYS 只认 array → 眼审恒零命中;clips 嵌在 fidelity_check 下
 *     (p10c_voice_audit.py audit.fidelity_check.clips)非顶层 → 耳审恒零命中。
 *     现两者都识别(rec 自带 shot_id 键)。
 *  b) verdict 三值闭集把 SKIPPED/ERROR/MUST_FIX 静默丢掉(生产库 11 skipped/
 *     2 error 真实存在)→ 扩到五值+must_fix,normalizeVerdict 不再吞。
 *  c) AUDIT_VOCAB 闭集 → registerAuditToken() 可注册(khs 新增审计 phase
 *     无需改 kap 源码,QVR-06 扩展契约)。
 *
 * 纯模块零 React;消费侧 memo(useMemo),不在 store 持久化。
 */
import type { FlowGraphV3 } from '@kais/flowgraph-v3'

export interface QcVerdict {
  judge: 'eye' | 'ear';
  /** 五值+必修(72-05 F32):skipped=未评,error=审计异常,must_fix=必修。 */
  verdict: 'pass' | 'warn' | 'fail' | 'error' | 'skipped' | 'must_fix';
}

type RawBag = Record<string, unknown>

const AUDIT_VOCAB: Array<{ token: string; judge: 'eye' | 'ear' }> = [
  { token: 'voice-audit', judge: 'ear' },
  { token: 'voice_audit', judge: 'ear' },
  { token: 'video-qc', judge: 'eye' },
  { token: 'video_qc', judge: 'eye' },
  { token: 'preview-qc', judge: 'eye' },
  { token: 'preview_qc', judge: 'eye' },
]

/**
 * QVR-06 (F31) 扩展契约:注册新的审计节点识别 token(khs 新增审计 phase 时
 * 由调用方注册,如 registerAuditToken('storyboard-qc', 'eye'))。幂等。
 */
export function registerAuditToken(token: string, judge: 'eye' | 'ear'): void {
  if (typeof token !== 'string' || token.length === 0) return
  if (AUDIT_VOCAB.some((e) => e.token === token)) return
  AUDIT_VOCAB.push({ token, judge })
}

/** per-item 列表探测键序(array 形;dict 形 per_shot 单独处理)。 */
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
  // 72-05 F32:p10c/p11c 真实五值(ERROR/SKIPPED)+画布 QC 槽 must_fix——
  // 旧三值闭集在此返回 null 把整个 item 静默丢弃。
  if (s === 'ERROR') return 'error'
  if (s === 'SKIPPED') return 'skipped'
  if (s === 'MUST_FIX') return 'must_fix'
  return null
}

function auditJudgeOf(nodeId: string, raw: RawBag): 'eye' | 'ear' | null {
  const haystack = `${nodeId} ${String(raw.phase ?? '')} ${String(raw.gate ?? '')} ${String(raw.assetType ?? '')}`
  for (const { token, judge } of AUDIT_VOCAB) {
    if (haystack.includes(token)) return judge
  }
  return null
}

/** 单条 per-item 记录 → {shotId, verdict}(需两者齐备,否则 null)。 */
function itemOf(it: unknown): { shotId: string; verdict: QcVerdict['verdict'] } | null {
  if (!isRecord(it)) return null
  const shotId = typeof it.shot_id === 'string' ? it.shot_id : (typeof it.shotId === 'string' ? it.shotId : null)
  const verdict = normalizeVerdict(it.verdict)
  if (shotId == null || verdict == null) return null
  return { shotId, verdict }
}

/** 从 raw 袋探测 per-item 列表(72-01 F26 修真:array/dict/嵌套三形)。 */
function detectItems(raw: RawBag): Array<{ shotId: string; verdict: QcVerdict['verdict'] }> | null {
  const found: Array<{ shotId: string; verdict: QcVerdict['verdict'] }> = []
  // 形 1:顶层 array(clips/shots/items/variants…)
  for (const key of LIST_KEYS) {
    const list = raw[key]
    if (!Array.isArray(list)) continue
    for (const it of list) {
      const rec = itemOf(it)
      if (rec != null) found.push(rec)
    }
    if (found.length > 0) return found
  }
  // 形 2:p11c per_shot 为 dict {sid: rec}——rec 自带 shot_id;缺失时回退
  // dict 键作 shot_id(旧实现只认 array,眼审 join 因此恒零命中)。
  const perShot = raw.per_shot
  if (isRecord(perShot)) {
    for (const [sid, it] of Object.entries(perShot)) {
      const verdict = isRecord(it) ? normalizeVerdict(it.verdict) : null
      const recShotId = isRecord(it) && typeof it.shot_id === 'string' ? it.shot_id : null
      if (verdict != null && (recShotId != null || sid.length > 0)) {
        found.push({ shotId: recShotId ?? sid, verdict })
      }
    }
    if (found.length > 0) return found
  }
  // 形 3:p10c fidelity_check.clips 嵌套层(clips 挂在 fidelity_check 下,
  // 非顶层)——旧实现耳审 join 因此恒零命中。
  const fid = raw.fidelity_check
  if (isRecord(fid) && Array.isArray(fid.clips)) {
    for (const it of fid.clips) {
      const rec = itemOf(it)
      if (rec != null) found.push(rec)
    }
    if (found.length > 0) return found
  }
  return found.length > 0 ? found : null
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
      console.warn(`[qcVerdict] 审计节点 ${n.id} 无可识别 per-item 列表(键序 ${LIST_KEYS.join('/')}/per_shot dict/fidelity_check.clips),跳过`)
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
