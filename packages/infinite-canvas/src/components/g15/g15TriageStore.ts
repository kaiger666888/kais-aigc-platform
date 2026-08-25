/**
 * g15TriageStore.ts — G15 失败镜头分诊面板状态(Phase 53-07 / VAR-04,D-13)。
 *
 * 独立工作台开关态 + 行选择状态机 + 行处置态。数据源 = G15Source seam:
 * Wave A 用 fixture 装载器(内容对齐 53-01 take-log.json + failed-shots.json
 * 的形状与 verdict/error 分布);Wave B 换真实端点实现(loadRows →
 * GET 失败镜头/take-log 透传,契约见 53-01 candidateEnvelope)。
 *
 * 归因分类:包内手写 TS 等价映射(与 53-01 classifyG15Error 同特征表,
 * P8 不跨包 import root zod)。
 */
import { create } from 'zustand'

// ─── Types(手写 interface,P8)─────────────────────────────────────────────

export interface G15TakeEntry {
  take_n?: number
  shot_id: string
  changed_variable?: string
  seed?: number
  verdict?: string
  evidence?: string
  timestamp?: string
}

export interface G15Row {
  shotId: string
  phase: string
  category: G15Category
  reason: string
  takes?: G15TakeEntry[]
  rawError?: string
}

export type G15Category =
  | 'qc_vision_fail'
  | 'engine_render_error'
  | 'bgm_trigger'
  | 'delegate_timeout'
  | 'delegate_parse'
  | 'schema_validation'
  | 'needs_regenerate'
  | 'take_verdict_keep'
  | 'take_verdict_fix_in_post'
  | 'take_verdict_edit'
  | 'take_verdict_re_roll'
  | 'take_verdict_rewrite'
  | 'unknown'

/** Wave B seam:换真实端点实现即可,面板/组件零改动。 */
export interface G15Source {
  loadRows(): Promise<G15Row[]>
}

// ─── 归因映射(53-01 classifyG15Error 同特征表,TS 手写)───────────────────

export function classifyG15(raw: { error?: string; verdict?: string; needsRegenerate?: boolean }): G15Category {
  if (raw.verdict != null && /^keep|fix_in_post|edit|re_roll|rewrite$/.test(raw.verdict)) {
    return `take_verdict_${raw.verdict}` as G15Category
  }
  if (raw.needsRegenerate === true) return 'needs_regenerate'
  const e = (raw.error ?? '').toLowerCase()
  if (e.includes('timeout') || e.includes('timed out')) return 'delegate_timeout'
  if (e.includes('parse')) return 'delegate_parse'
  if (e.includes('schema') || e.includes('validation')) return 'schema_validation'
  if (e.includes('bgm') || e.includes('music') || e.includes('音乐')) return 'bgm_trigger'
  if (e.includes('render') || e.includes('cuda') || e.includes('oom') || e.includes('渲染') || e.includes('engine')) {
    return 'engine_render_error'
  }
  if (e.includes('vision') || e.includes('qc') || e.includes('构图') || e.includes('画面')) {
    return 'qc_vision_fail'
  }
  return 'unknown'
}

// ─── fixture 默认数据源(对齐 53-01 fixture 分布)───────────────────────────

const fixtureRows: G15Row[] = [
  {
    shotId: 'shot_031',
    phase: 'p11b',
    category: classifyG15({ error: 'delegate timeout after 900s — p11b render exceeded budget' }),
    reason: 'delegate timeout after 900s — p11b render exceeded budget',
    takes: [
      { take_n: 3, shot_id: 'shot_031', changed_variable: 'camera', seed: 5152, verdict: 'edit', evidence: '节奏拖沓,剪辑可救', timestamp: '2026-08-21T10:10:00Z' },
      { take_n: 4, shot_id: 'shot_031', changed_variable: 'prompt', seed: 5153, verdict: 're_roll', evidence: '物理不合理,手部穿模', timestamp: '2026-08-21T10:15:00Z' },
    ],
    rawError: 'delegate timeout after 900s — p11b render exceeded budget\nrunner: retry budget exhausted (3/3 per-resume)',
  },
  {
    shotId: 'shot_036',
    phase: 'p11b',
    category: classifyG15({ error: 'schema validation failed: missing duration field in output manifest' }),
    reason: 'schema validation failed: missing duration field in output manifest',
    rawError: 'schema validation failed: missing duration field in output manifest\nmanifest: p11b_final_render output manifest missing duration_sec',
  },
  {
    shotId: 'shot_049',
    phase: 'p11b',
    category: classifyG15({ error: 'render crashed: CUDA error at frame 218/362' }),
    reason: 'render crashed: CUDA error at frame 218/362',
    takes: [
      { take_n: 5, shot_id: 'shot_044', changed_variable: 'structure', seed: 5154, verdict: 'rewrite', evidence: '叙事断层,需回改分镜', timestamp: '2026-08-21T10:20:00Z' },
    ],
    rawError: 'render crashed: CUDA error at frame 218/362\nengine: comfyui worker stderr tail …',
  },
  {
    shotId: 'shot_052',
    phase: 'p11a',
    category: classifyG15({ error: 'qc vision: 构图越轴' }),
    reason: 'qc vision: 构图越轴',
    rawError: 'qc vision: 构图越轴,axis_ok=false',
  },
]

/** 默认 fixture 源(69-02 (WBI-02) 起降级为显式测试/开发模式:画布无
 * take-log/failed-shots 数据时的兜底;面板 open 时若 graph 在场,注入
 * graphG15Source 真实源——fixture 不再冒充生产数据)。 */
export const fixtureG15Source: G15Source = {
  async loadRows() {
    return fixtureRows.map((r) => ({ ...r, takes: r.takes?.map((t) => ({ ...t })) }))
  },
}

// ─── 69-02 (v3.2 WBI-02/F35):真实数据源 — graph raw 袋派生 ────────────────

type RawBag = Record<string, unknown>
type GraphLike = { nodes: Array<{ id: string; kind?: string }> }

function isRecord(v: unknown): v is RawBag {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 真实源:画布 take-log / failed-shots / video-qc slot 节点的 raw 袋派生
 * (khs canvas_sync 落库,契约见 53-01 candidateEnvelope + 72-01 透传)。
 * 行 = failed-shots 未豁免失败镜(per_shot fail 兜底);takes 按 shot 归并
 * 为展开证据(take-log 的 shot_id 缺失时按 shot_index 组装 shot_{N})。
 * 空数据返回空数组(面板空态 = 真没失败镜,而非假 fixture 行)。
 */
export function graphG15Source(graph: GraphLike | null, raw: Map<string, RawBag> | null): G15Source {
  return {
    async loadRows() {
      const rows = new Map<string, G15Row>()
      const takesByShot = new Map<string, G15TakeEntry[]>()
      const rowOf = (shotId: string, phase: string): G15Row => {
        let r = rows.get(shotId)
        if (r == null) {
          r = { shotId, phase, category: 'unknown', reason: '' }
          rows.set(shotId, r)
        }
        return r
      }
      for (const n of graph?.nodes ?? []) {
        const d = raw?.get(n.id)
        if (!isRecord(d)) continue
        // failed-shots slot:{failures: [{shot_id, error, waived}]}
        if (Array.isArray(d.failures)) {
          for (const f of d.failures) {
            if (!isRecord(f) || typeof f.shot_id !== 'string') continue
            if (f.waived === true) continue // operator 已豁免——不再分诊
            const error = typeof f.error === 'string' ? f.error : ''
            const r = rowOf(f.shot_id, 'p11c')
            r.category = classifyG15({ error })
            r.reason = error
            r.rawError = error
          }
        }
        // video-qc slot:per_shot dict {sid: {verdict, reasons}} —fail 兜底
        // (failed-shots 之外的 qwen fail;waived_shot_ids 已豁免的跳过)
        const perShot = d.per_shot
        if (isRecord(perShot)) {
          const waived = new Set(Array.isArray(d.waived_shot_ids) ? d.waived_shot_ids.map(String) : [])
          for (const [sid, rec] of Object.entries(perShot)) {
            if (!isRecord(rec)) continue
            const shotId = typeof rec.shot_id === 'string' ? rec.shot_id : sid
            if (String(rec.verdict).toLowerCase() !== 'fail' || waived.has(shotId)) continue
            if (rows.has(shotId)) continue // failed-shots 行已覆盖
            const reason = typeof rec.reasons === 'string' ? rec.reasons : 'qwen-eye fail'
            const r = rowOf(shotId, 'p11c')
            r.category = 'qc_vision_fail'
            r.reason = reason
            r.rawError = reason
          }
        }
        // take-log slot:{takes: [...], render_variants: [...]} —证据层
        if (Array.isArray(d.takes)) {
          for (const t of d.takes) {
            if (!isRecord(t)) continue
            const shotId =
              typeof t.shot_id === 'string' && t.shot_id.length > 0
                ? t.shot_id
                : typeof t.shot_index === 'number' ? `shot_${t.shot_index}` : null
            if (shotId == null) continue
            const arr = takesByShot.get(shotId) ?? []
            arr.push({
              take_n: typeof t.take_n === 'number' ? t.take_n : undefined,
              shot_id: shotId,
              changed_variable: typeof t.changed_variable === 'string' ? t.changed_variable : undefined,
              seed: typeof t.seed === 'number' ? t.seed : undefined,
              verdict: typeof t.verdict === 'string' ? t.verdict : undefined,
              evidence: typeof t.evidence === 'string' ? t.evidence : undefined,
              timestamp: typeof t.timestamp === 'string' ? t.timestamp : undefined,
            })
            takesByShot.set(shotId, arr)
          }
        }
      }
      const out = [...rows.values()]
      for (const r of out) {
        const takes = takesByShot.get(r.shotId)
        if (takes != null && takes.length > 0) r.takes = takes
      }
      return out
    },
  }
}

// ─── Store(开关态 + 选择状态机 + 处置态)───────────────────────────────────

interface G15TriageState {
  open: boolean
  rows: G15Row[]
  selected: Set<string>
  expanded: string | null
  rowState: Record<string, 'waived' | 'requeued'>
  source: G15Source
  setOpen: (v: boolean) => void
  setSource: (s: G15Source) => void
  load: () => Promise<void>
  toggle: (shotId: string) => void
  selectAll: () => void
  clear: () => void
  setExpanded: (shotId: string | null) => void
  markRows: (shotIds: string[], state: 'waived' | 'requeued') => void
  unmarkRows: (shotIds: string[]) => void
}

export const useG15TriageStore = create<G15TriageState>((set, get) => ({
  open: false,
  rows: [],
  selected: new Set<string>(),
  expanded: null,
  rowState: {},
  source: fixtureG15Source,
  setOpen: (v) => {
    set({ open: v })
    if (v && get().rows.length === 0) void get().load()
  },
  setSource: (s) => set({ source: s }),
  load: async () => {
    const rows = await get().source.loadRows()
    set({ rows })
  },
  toggle: (shotId) => {
    const selected = new Set(get().selected)
    if (selected.has(shotId)) selected.delete(shotId)
    else selected.add(shotId)
    set({ selected })
  },
  selectAll: () => set({ selected: new Set(get().rows.map((r) => r.shotId)) }),
  clear: () => set({ selected: new Set<string>() }),
  setExpanded: (shotId) => set({ expanded: shotId === get().expanded ? null : shotId }),
  markRows: (shotIds, state) => {
    const rowState = { ...get().rowState }
    for (const id of shotIds) rowState[id] = state
    const selected = new Set(get().selected)
    for (const id of shotIds) selected.delete(id)
    set({ rowState, selected })
  },
  unmarkRows: (shotIds) => {
    const rowState = { ...get().rowState }
    for (const id of shotIds) delete rowState[id]
    set({ rowState })
  },
}))
