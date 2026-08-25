/**
 * voiceAuditStore.ts — G16 配音听审工作台状态(Phase 56-05 / VIZ-03,D-11/D-12)。
 *
 * g15TriageStore 同构:独立开关态 + 行选择 + 行处置态(waived)乐观回滚 +
 * currentIndex 连播游标。数据源 = VoiceAuditSource seam(fixture 对齐 p10c
 * 真实 clips 形状;真实源 = graph 内 voice-audit 节点 raw 袋防御式派生,
 * 键序 clips/findings,识别不了空数组 + warn 一次,不 throw——A-1 兜底)。
 * G16 只有豁免语义(无重渲 action)。
 */
import { create } from 'zustand'
import type { FlowGraphV3 } from '@kais/flowgraph-v3'

// ─── Types(p10c_voice_audit.py clips 形状手写镜像,P8) ───────────────────

export interface VoiceClip {
  id: string
  shotId: string
  path: string
  transcript: string
  /** 72-05 (F32):三值 → 五值(ERROR/SKIPPED 不再整行静默丢弃)。 */
  verdict: 'pass' | 'warn' | 'fail' | 'error' | 'skipped'
  similarity?: number
  reason?: string
  speaker?: string
  dims?: Record<string, unknown>
}

export interface VoiceAuditSource {
  loadClips(): Promise<VoiceClip[]>
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function toVerdict(v: unknown): VoiceClip['verdict'] | null {
  const s = typeof v === 'string' ? v.toUpperCase() : ''
  if (s === 'PASS') return 'pass'
  if (s === 'WARN') return 'warn'
  if (s === 'FAIL') return 'fail'
  if (s === 'ERROR') return 'error'
  if (s === 'SKIPPED') return 'skipped'
  return null
}

/** raw 袋 → VoiceClip[](防御式:键序 clips/findings + fidelity_check.clips
 * 嵌套层;域外 verdict 过滤)。72-01 (v3.2 F25):khs p10c 真实形状 clips 挂在
 * fidelity_check 下(audit.fidelity_check.clips),旧顶层读法恒空——工作台
 * 听审列表因此对真实数据零行。 */
export function deriveClips(raw: Record<string, unknown>): VoiceClip[] {
  // 72-01 F25:p10c_voice_audit.py 真实槽形——fidelity_check{clips: []}
  const fid = raw.fidelity_check
  const candidates = [
    raw.clips,
    raw.findings,
    fid != null && typeof fid === 'object' && !Array.isArray(fid)
      ? (fid as Record<string, unknown>).clips
      : undefined,
  ]
  for (const c of candidates) {
    if (!Array.isArray(c)) continue
    const out: VoiceClip[] = []
    for (const it of c) {
      if (it == null || typeof it !== 'object' || Array.isArray(it)) continue
      const bag = it as Record<string, unknown>
      const shotId = str(bag.shot_id) ?? str(bag.shotId)
      const verdict = toVerdict(bag.verdict)
      if (shotId == null || verdict == null) continue
      out.push({
        id: str(bag.id) ?? `${shotId}`,
        shotId,
        path: str(bag.path) ?? '',
        transcript: str(bag.transcript) ?? '',
        verdict,
        similarity: num(bag.similarity),
        reason: str(bag.reason),
        speaker: str(bag.speaker),
        dims: bag.dims != null && typeof bag.dims === 'object' ? (bag.dims as Record<string, unknown>) : undefined,
      })
    }
    if (out.length > 0) return out
  }
  return []
}

/** 真实源 seam:graph 内 voice-audit 节点 raw 袋防御式派生。 */
export function graphVoiceAuditSource(
  graph: FlowGraphV3 | null,
  raw: Map<string, Record<string, unknown>> | null,
): VoiceAuditSource {
  return {
    async loadClips(): Promise<VoiceClip[]> {
      if (graph == null) return []
      for (const n of graph.nodes) {
        if (n.kind !== 'asset') continue
        const d = raw?.get(n.id) ?? {}
        const haystack = `${n.id} ${String(d.phase ?? '')} ${String(d.assetType ?? '')} ${String(n.phaseName ?? '')}`
        if (!haystack.includes('voice-audit') && !haystack.includes('voice_audit')) continue
        const clips = deriveClips(d)
        if (clips.length === 0) {
          console.warn(`[voiceAudit] 审计节点 ${n.id} 无可识别 clips(键序 clips/findings)`, )
        }
        return clips
      }
      return []
    },
  }
}

// ─── fixture(对齐 p10c 真实形状;含 verdict 三态 + 缺 transcript 样本) ───

export function fixtureVoiceAuditSource(): VoiceAuditSource {
  const rows: VoiceClip[] = [
    { id: 'S01_001', shotId: 'S01_001', path: '/oss/pipeline/7052cea6/voice/S01_001.wav', transcript: '他推开门，雨声灌进来。', verdict: 'pass', similarity: 0.93, speaker: '林晚' },
    { id: 'S01_002', shotId: 'S01_002', path: '/oss/pipeline/7052cea6/voice/S01_002.wav', transcript: '又是这扇门。', verdict: 'warn', similarity: 0.61, speaker: '林晚', reason: '情绪偏平' },
    { id: 'S02_001', shotId: 'S02_001', path: '/oss/pipeline/7052cea6/voice/S02_001.wav', transcript: '你别过来！', verdict: 'fail', similarity: 0.32, speaker: '周野', reason: '音高漂移' },
    { id: 'S02_002', shotId: 'S02_002', path: '/oss/pipeline/7052cea6/voice/S02_002.wav', transcript: '', verdict: 'pass', similarity: 0.88, speaker: '周野' },
    { id: 'S03_001', shotId: 'S03_001', path: '/oss/pipeline/7052cea6/voice/S03_001.wav', transcript: '这次，换我先开口。', verdict: 'pass', similarity: 0.90, speaker: '林晚' },
  ]
  return { loadClips: async () => rows }
}

// ─── Store ───────────────────────────────────────────────────────────────

type RowState = 'pending' | 'waived'

interface VoiceAuditState {
  open: boolean
  rows: VoiceClip[]
  loaded: boolean
  selected: Set<string>
  rowState: Map<string, RowState>
  currentIndex: number
  autoPlay: boolean
  source: VoiceAuditSource
  setSource: (s: VoiceAuditSource) => void
  setOpen: (open: boolean) => void
  load: () => Promise<void>
  toggle: (id: string) => void
  selectAll: () => void
  clear: () => void
  markWaived: (ids: string[]) => void
  unmark: (ids: string[]) => void
  setCurrentIndex: (i: number) => void
  setAutoPlay: (v: boolean) => void
  /** 连播推进:跳过已豁免,指向下一条 pending;无可审 → null(连播终止)。 */
  nextPending: (from: number) => number | null
}

export const useVoiceAuditStore = create<VoiceAuditState>((set, get) => ({
  open: false,
  rows: [],
  loaded: false,
  selected: new Set<string>(),
  rowState: new Map<string, RowState>(),
  currentIndex: 0,
  autoPlay: false,
  source: fixtureVoiceAuditSource(),
  setSource: (s) => set({ source: s, loaded: false }),
  setOpen: (open) => {
    set({ open })
    if (open && !get().loaded) void get().load()
  },
  load: async () => {
    const rows = await get().source.loadClips()
    set({ rows, loaded: true, rowState: new Map(rows.map((r) => [r.id, 'pending'] as const)), currentIndex: 0, selected: new Set() })
  },
  toggle: (id) => set((s) => {
    const next = new Set(s.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return { selected: next }
  }),
  selectAll: () => set((s) => ({ selected: new Set(s.rows.map((r) => r.id)) })),
  clear: () => set({ selected: new Set<string>() }),
  markWaived: (ids) => set((s) => {
    const next = new Map(s.rowState)
    for (const id of ids) next.set(id, 'waived')
    return { rowState: next }
  }),
  unmark: (ids) => set((s) => {
    const next = new Map(s.rowState)
    for (const id of ids) next.set(id, 'pending')
    return { rowState: next }
  }),
  setCurrentIndex: (i) => set({ currentIndex: i }),
  setAutoPlay: (v) => set({ autoPlay: v }),
  nextPending: (from) => {
    const { rows, rowState } = get()
    for (let i = from + 1; i < rows.length; i++) {
      if (rowState.get(rows[i]!.id) !== 'waived') return i
    }
    return null
  },
}))
