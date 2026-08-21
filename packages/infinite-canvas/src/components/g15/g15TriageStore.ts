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

/** 默认 fixture 源(Wave B 换真实端点:G15 挂载点在 g15TriageStore.load)。 */
export const fixtureG15Source: G15Source = {
  async loadRows() {
    return fixtureRows.map((r) => ({ ...r, takes: r.takes?.map((t) => ({ ...t })) }))
  },
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
