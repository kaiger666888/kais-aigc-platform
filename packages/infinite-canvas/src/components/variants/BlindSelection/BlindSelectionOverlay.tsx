/**
 * BlindSelectionOverlay.tsx — 盲选会话 overlay(盲选批 M2,spec §4 A 轨)。
 *
 * 防剧透纪律(spec §6「盲选被剧透」):voting 阶段在 DOM 层不渲染任何来源
 * 标签/AI 分/winner 标记/seed——独立 overlay 渲染裸候选(不复用带「✓已选」
 * 标签的组卡组件),候选命名只用「候选 A/B」位号。
 *
 * 流程:点选候选 → select-winner(带 blind 元数据,wasBlind:true)→ 揭晓页
 * (来源标签 + score 对照,有分才显示)→ 维持/改选另一侧(wasBlind:false
 * 第二笔)/跳过 → 下一组。失败由 canvasStore 回滚 + toast,本组件原地保留
 * 当前组状态允许重试。
 *
 * 移动端(Tailscale 直开画布):触控目标 ≥44px,内容区 overflow-y 滚动。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
// 注:本目录新文件用 @ 别名引 theme/store(tsc 相对路径解析在 harness 新写
// 文件上环境性失效,别名路径稳定——tsconfig paths 既有配置)。
import { theme, v3theme, getScoreColor } from '@/theme/catppuccin'
import { useCanvasStore } from '../../../store/canvasStore'
import { frameSlotOfGroup } from '../../../store/variantOps'
import { resolveMediaUrl } from '../../../utils/mediaUrl'
import { useBlindSelectionStore } from './blindSelectionStore'
import { buildBlindQueue } from './blindOrder'
import TextCandidateCard, { type FieldRow } from '../TextCandidateCard'
import type { AssetNodeV3 } from '@kais/flowgraph-v3'

// ─── View-model ───────────────────────────────────────────────────────────

interface BlindCandidate {
  nodeId: string
  modality: 'text' | 'image' | 'audio' | 'video'
  /** 文字候选正文(无 field_rows 时兜底展示)。 */
  content: string | null
  fieldRows: FieldRow[]
  thumbnailUrl: string | null
  filePath: string | null
  /** 揭晓页专用(voting 阶段绝不渲染)。 */
  aiScore?: { overall: number; dimensions?: Record<string, number> }
  sourceLabel: string
}

const MONO = 'var(--cv-font-mono, monospace)'

/** field_rows 提取:信封 extras 经 rawData sidecar 落在 RF data(双形态容忍)。 */
function extractFieldRows(d: Record<string, unknown>): FieldRow[] {
  const extras =
    d.extras != null && typeof d.extras === 'object' && !Array.isArray(d.extras)
      ? (d.extras as Record<string, unknown>)
      : null
  const candidate: unknown = Array.isArray(d.field_rows)
    ? d.field_rows
    : extras != null && Array.isArray(extras.field_rows)
      ? extras.field_rows
      : null
  if (!Array.isArray(candidate)) return []
  const rows: FieldRow[] = []
  for (const r of candidate) {
    if (r == null || typeof r !== 'object') continue
    const { field, a, b, delta } = r as Record<string, unknown>
    if (typeof field !== 'string' || typeof a !== 'string' || typeof b !== 'string') continue
    rows.push(
      typeof delta === 'string' ? { field, a, b, delta } : { field, a, b },
    )
  }
  return rows
}

/** 揭示页来源标签(展示用 best-effort 推断;不写库不作为决策依据)。 */
function inferSourceLabel(nodeId: string, stage: string | undefined, d: Record<string, unknown>): string {
  if (typeof d.source === 'string' && d.source.length > 0) return d.source
  if (nodeId.startsWith('c-')) return 'p01_hook'
  if (nodeId.startsWith('a-flf')) return 'p11a0_flf'
  if (stage === 'script') return 'p03_script'
  if (stage === 'storyboard') return 'p09_shotlist'
  return stage ?? 'unknown'
}

// ─── 主组件 ─────────────────────────────────────────────────────────────────

export default function BlindSelectionOverlay(): React.ReactElement | null {
  const open = useBlindSelectionStore((s) => s.open)
  const sessionId = useBlindSelectionStore((s) => s.sessionId)
  const queue = useBlindSelectionStore((s) => s.queue)
  const cursor = useBlindSelectionStore((s) => s.cursor)
  const phase = useBlindSelectionStore((s) => s.phase)
  const pickedNodeId = useBlindSelectionStore((s) => s.pickedNodeId)
  const orders = useBlindSelectionStore((s) => s.orders)
  const decided = useBlindSelectionStore((s) => s.decided)
  const includeDecided = useBlindSelectionStore((s) => s.includeDecided)
  const reveal = useBlindSelectionStore((s) => s.reveal)
  const markDecided = useBlindSelectionStore((s) => s.markDecided)
  const close = useBlindSelectionStore((s) => s.close)
  const openSession = useBlindSelectionStore((s) => s.openSession)

  const graph = useCanvasStore((s) => s.graph)
  const rfNodes = useCanvasStore((s) => s.nodes)
  const selectWinner = useCanvasStore((s) => s.selectWinner)
  const [busy, setBusy] = useState(false)

  // Esc 关会话(与画布其他 overlay 一致)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const groupId = cursor < queue.length ? (queue[cursor] ?? null) : null
  const group = useMemo(
    () => (graph && groupId != null ? graph.variantGroups.find((g) => g.id === groupId) ?? null : null),
    [graph, groupId],
  )

  const candidates = useMemo<BlindCandidate[]>(() => {
    if (!graph || !group) return []
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const rfById = new Map(rfNodes.map((n) => [n.id, n]))
    const ordered = orders[group.id] ?? group.variantNodeIds
    return ordered
      .map((id): BlindCandidate | null => {
        const v3 = byId.get(id)
        if (!v3 || v3.kind !== 'asset') return null
        const a = v3 as AssetNodeV3
        const d = (rfById.get(id)?.data ?? {}) as Record<string, unknown>
        const str = (v: unknown): string | null =>
          typeof v === 'string' && v.length > 0 ? v : null
        return {
          nodeId: id,
          modality: a.modality,
          content: str(a.content) ?? str(d.generation_prompt) ?? str(d.prompt) ?? str(d.description),
          fieldRows: extractFieldRows(d),
          thumbnailUrl: str(d.thumbnailUrl) ?? a.media.thumbnail,
          filePath: str(d.filePath) ?? a.media.original,
          aiScore: a.aiScore ? { overall: a.aiScore.overall, dimensions: a.aiScore.dimensions } : undefined,
          sourceLabel: inferSourceLabel(id, a.stage, d),
        }
      })
      .filter((c): c is BlindCandidate => c != null)
  }, [graph, group, orders, rfNodes])

  /** 翻案重开:队列含已选定组(会话 id/seed 重生成)。 */
  const reopenAll = useCallback(() => {
    if (!graph) return
    openSession(
      buildBlindQueue(graph.variantGroups, { includeDecided: true }).map((g) => ({
        id: g.id,
        variantNodeIds: g.variantNodeIds,
      })),
      { includeDecided: true },
    )
  }, [graph, openSession])

  // ── 提交动作(全部经 canvasStore.selectWinner:乐观更新+回滚+toast 复用)──
  const submit = useCallback(
    async (nodeId: string, wasBlind: boolean): Promise<boolean> => {
      if (groupId == null) return false
      setBusy(true)
      try {
        return await selectWinner(nodeId, {
          frameSlot: frameSlotOfGroup(groupId),
          blind: { sessionId, track: 'human_blind', wasBlind },
        })
      } finally {
        setBusy(false)
      }
    },
    [groupId, selectWinner, sessionId],
  )

  /** voting 点选 = 盲投(wasBlind:true);成功进揭晓,失败原地重试。 */
  const handlePick = useCallback(
    async (nodeId: string) => {
      if (busy) return
      const ok = await submit(nodeId, true)
      if (ok) reveal(nodeId)
    },
    [busy, submit, reveal],
  )

  /** 揭晓后改选另一侧 = 第二笔 wasBlind:false。 */
  const handleSwitch = useCallback(
    async (nodeId: string) => {
      if (busy || groupId == null) return
      const ok = await submit(nodeId, false)
      if (ok) markDecided(groupId, 'switched')
    },
    [busy, groupId, submit, markDecided],
  )

  if (!open) return null

  // ── 会话小结(队列走完)──
  if (groupId == null) {
    const tally = Object.values(decided)
    const kept = tally.filter((t) => t === 'kept').length
    const switched = tally.filter((t) => t === 'switched').length
    const skipped = tally.filter((t) => t === 'skipped').length
    return (
      <div data-testid="blind-selection-overlay" style={overlayStyle}>
        <div style={sheetStyle}>
          <div style={{ fontSize: 15, fontWeight: 700, color: theme.text.primary }}>🔮 盲选会话完成</div>
          <div style={{ ...monoNote, margin: '6px 0 14px' }}>{sessionId}</div>
          <div style={{ display: 'flex', gap: 10, fontSize: 12, color: theme.text.secondary, marginBottom: 16 }}>
            <span>维持 {kept}</span>
            <span>改选 {switched}</span>
            <span>跳过 {skipped}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={reopenAll} style={secondaryBtn}>翻案模式重开(含已选定组)</button>
            <button onClick={close} style={primaryBtn}>完成</button>
          </div>
        </div>
      </div>
    )
  }

  // ── 空组快照(成员被删/图变了)──
  if (group == null || candidates.length < 2) {
    return (
      <div data-testid="blind-selection-overlay" style={overlayStyle}>
        <div style={sheetStyle}>
          <div style={{ fontSize: 14, color: theme.text.primary, marginBottom: 12 }}>
            本组不可盲选(成员不足或组已不存在)
          </div>
          <div style={{ ...monoNote, marginBottom: 14 }}>{groupId}</div>
          <button onClick={() => markDecided(groupId, 'skipped')} style={primaryBtn}>跳过此组</button>
        </div>
      </div>
    )
  }

  const revealed = phase === 'revealed'
  const other = candidates.find((c) => c.nodeId !== pickedNodeId)

  return (
    <div
      data-testid="blind-selection-overlay"
      data-blind-phase={phase}
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
      style={overlayStyle}
    >
      {/* ── 头栏 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        padding: '10px 16px', background: theme.bg.panel,
        borderBottom: `1px solid ${theme.border.default}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 15 }}>🔮</span>
          <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: 13 }}>盲选</span>
          <span style={{ ...monoNote }}>{Math.min(cursor + 1, queue.length)}/{queue.length}</span>
          <span style={{ ...monoNote }}>{sessionId}</span>
          {includeDecided && (
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: theme.bg.surface, color: theme.text.secondary }}>
              翻案模式
            </span>
          )}
        </div>
        <button onClick={close} data-testid="blind-close" style={closeBtnStyle}>✕</button>
      </div>

      {/* ── 候选区(overflow-y 滚动:小屏/长文本)── */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex',
        flexDirection: 'column', padding: '14px 16px', gap: 12,
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 12, flex: 1, minHeight: 0,
        }}>
          {candidates.map((c, i) => {
            const isPicked = revealed && c.nodeId === pickedNodeId
            return (
              <div
                key={c.nodeId}
                data-testid="blind-candidate"
                data-blind-position={i + 1}
                onClick={() => { if (!revealed) void handlePick(c.nodeId) }}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
                  background: theme.bg.card,
                  border: `1.5px solid ${isPicked ? v3theme.signal.select : theme.border.default}`,
                  borderRadius: 10, padding: 10,
                  cursor: revealed ? 'default' : 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {/* Fix-3 (FIX-2):候选位号统一 A/B/C/D…（旧三元链第三候选起输出数字） */}
                  <span data-testid="blind-candidate-label" style={{ fontSize: 12, fontWeight: 700, color: theme.text.secondary }}>
                    {revealed ? (isPicked ? '✓ 你的盲选' : '另一侧') : `候选 ${String.fromCharCode(65 + i)}`}
                  </span>
                  {/* 揭晓页才渲染来源标签(voting 阶段 DOM 无此节点) */}
                  {revealed && (
                    <span data-testid="blind-source" style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 4,
                      background: theme.bg.surface, color: theme.text.secondary, fontFamily: MONO,
                    }}>
                      {c.sourceLabel}
                    </span>
                  )}
                </div>
                <CandidateBody c={c} />
                {/* 揭晓页才渲染 score(有分才显示,没有不造假) */}
                {revealed && c.aiScore && (
                  <div data-testid="blind-score" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span style={{ color: theme.text.secondary }}>AI 分</span>
                    <span style={{
                      color: '#0A0B0E', background: getScoreColor(c.aiScore.overall),
                      fontWeight: 700, fontSize: 10, padding: '1px 5px', borderRadius: 4,
                    }}>
                      {Math.round(c.aiScore.overall * 100)}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 底部动作条(触控目标 ≥44px)── */}
      <div style={{
        display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap',
        padding: '10px 16px', background: theme.bg.panel,
        borderTop: `1px solid ${theme.border.default}`,
      }}>
        {!revealed ? (
          <>
            <span style={{ alignSelf: 'center', fontSize: 11, color: theme.text.secondary }}>
              点选一侧投票(来源与 AI 分投票后才揭晓)
            </span>
            <button
              onClick={() => markDecided(groupId, 'skipped')}
              data-testid="blind-skip"
              style={secondaryBtn}
            >
              跳过此组
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => markDecided(groupId, 'kept')}
              data-testid="blind-keep"
              style={primaryBtn}
            >
              维持
            </button>
            <button
              onClick={() => other && void handleSwitch(other.nodeId)}
              disabled={busy || other == null}
              data-testid="blind-switch"
              style={secondaryBtn}
            >
              改选另一侧
            </button>
            <button
              onClick={() => markDecided(groupId, 'skipped')}
              data-testid="blind-skip"
              style={ghostBtn}
            >
              跳过
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── 候选体(裸渲染:voting/揭晓同一渲染,无来源无分数)────────────────────

function CandidateBody({ c }: { c: BlindCandidate }): React.ReactElement {
  if (c.modality === 'text') {
    if (c.fieldRows.length > 0) {
      return <TextCandidateCard fieldRows={c.fieldRows} />
    }
    return (
      <div style={{
        fontSize: 12, color: theme.text.primary, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        maxHeight: 320, overflowY: 'auto', background: theme.bg.surface,
        borderRadius: 8, padding: 10,
      }}>
        {c.content ?? '(无文本内容)'}
      </div>
    )
  }
  const src = resolveMediaUrl(c.thumbnailUrl ?? c.filePath)
  if (c.modality === 'video' && c.filePath != null) {
    const vsrc = resolveMediaUrl(c.filePath)
    if (vsrc) {
      return (
        <video src={vsrc} controls muted playsInline
          style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 8, background: '#000' }} />
      )
    }
  }
  if (src) {
    return (
      <img src={src} alt=""
        style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 8 }} />
    )
  }
  return (
    <div style={{
      height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: theme.bg.surface, borderRadius: 8, fontSize: 26, opacity: 0.5,
    }}>
      {c.modality === 'audio' ? '🎵' : c.modality === 'video' ? '🎬' : '🖼'}
    </div>
  )
}

// ─── 样式 ─────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 45,
  background: theme.chrome.lightboxOverlay, backdropFilter: 'blur(2px)',
  display: 'flex', flexDirection: 'column',
}

const sheetStyle: React.CSSProperties = {
  margin: 'auto', background: theme.bg.panel, borderRadius: 12,
  border: `1px solid ${theme.border.default}`, padding: 20, maxWidth: 420,
  display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '80vh', overflowY: 'auto',
}

const monoNote: React.CSSProperties = {
  fontSize: 10, color: theme.text.tertiary, fontFamily: MONO,
}

/** 移动端触控目标 ≥44px(Tailscale 场景)。 */
const primaryBtn: React.CSSProperties = {
  minHeight: 44, minWidth: 88, padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
  background: v3theme.signal.select, color: '#0A0B0E', border: 'none',
  fontWeight: 700, fontSize: 13,
}

const secondaryBtn: React.CSSProperties = {
  minHeight: 44, minWidth: 88, padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
  background: theme.bg.card, color: theme.text.primary,
  border: `1px solid ${theme.border.default}`, fontSize: 13,
}

const ghostBtn: React.CSSProperties = {
  minHeight: 44, minWidth: 72, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
  background: 'transparent', color: theme.text.secondary, border: 'none', fontSize: 13,
}

const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: theme.text.secondary, fontSize: 16,
  cursor: 'pointer', padding: '2px 6px', lineHeight: 1, borderRadius: 4,
}
