/**
 * VariantWall.tsx — 全屏审片剧场(Phase 53-02 / VAR-02,D-05..D-08 + D-20)。
 *
 * 结构(CONTEXT <specifics> 用户选定版式):
 *   头栏:{组名} 选片 · {shotId} + [同播 ▶/⏸] + [下一镜 →](53-05 接通,本 plan 禁用)+ ✕
 *   上部 N-up 墙:grid auto-fit minmax(320px,1fr);每格 video + 该 take playhead;
 *   N-up 下方一条共享主 playhead 可拖 —— 签名元素(跨变体同步走带),其余视觉安静;
 *   底部胶片条:160px 卡(缩略/占位 + aiScore 徽章 + seed mono + prompt 单行截断)
 *   + 检视详情行(完整 prompt + seed + 维度 chips)。
 *
 * 交互:点卡/格 = 检视(展开详情 + 设 solo 声);「选定」按钮显式提交(D-08)——
 * 走既有 canvasStore.selectWinner v3 optimistic 路径 + triggerStaleCascade;
 * 键盘 D-20(1-9 检视/Enter 选定/←→ 切组[占位]/空格 同播/Esc 关)。
 *
 * 媒体 URL 一律 resolveMediaUrl(P5);缩略 404 三段自愈(healThumb,DR-3)。
 * 入口:牌堆 onStackToggle → variantPickerStore.open(协议保留,墙取代 Picker
 * 主体)/ openWallByGroup(53-05+)。P10:墙零 socket 订阅——选定 echo 由 graph
 * store 既有 variant:selected 守卫吸收,渲染随 graph 数据流自然更新。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Modality } from '../../theme/catppuccin'
import { v3theme, theme, getScoreColor } from '../../theme/cattpuccin'
import { useVariantPickerStore } from './variantPickerStore'
import { useCanvasStore } from '../../store/canvasStore'
import { triggerStaleCascade } from '../../hooks/useStale'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import { createMasterTransport, type MasterTransport } from './wallTransport'
import { useWallKeyboard } from './useWallKeyboard'
import { createThumbHealer } from './healThumb'
import type { AssetNodeV3 } from '@kais/flowgraph-v3'

// ─── View-model(手写 interface,包内不 import root schema — P8)──────────────

interface WallCandidate {
  nodeId: string
  label: string
  modality: Modality
  /** curation==='selected' 或组 winnerNodeId === 本节点 */
  selected: boolean
  score?: { overall: number; dimensions?: Record<string, number> }
  durationSec?: number
  prompt?: string
  seed?: number
  thumbnailUrl?: string
  filePath?: string
  verdict?: string
}

const MODALITY_ORDER: Modality[] = ['video', 'image', 'audio', 'text']

export default function VariantWall(): React.ReactElement | null {
  const open = useVariantPickerStore((s) => s.open)
  const wall = useVariantPickerStore((s) => s.wall)
  const close = useVariantPickerStore((s) => s.close)
  const graph = useCanvasStore((s) => s.graph)
  const rfNodes = useCanvasStore((s) => s.nodes)
  const selectWinner = useCanvasStore((s) => s.selectWinner)

  const active = open != null || wall != null

  // ── 组解析:open.nodeId 反查所属组;wall.groupId 直取 ──
  const group = useMemo(() => {
    if (!graph) return null
    if (wall) return graph.variantGroups.find((g) => g.id === wall.groupId) ?? null
    if (open) {
      const id = open.nodeId
      return (
        graph.variantGroups.find(
          (g) => g.winnerNodeId === id || g.variantNodeIds.includes(id),
        ) ?? null
      )
    }
    return null
  }, [graph, open, wall])

  // ── 成员映射(V3 节点为主,RF data 补 prompt/seed/variant)──
  const candidates = useMemo<WallCandidate[]>(() => {
    if (!graph || !group) return []
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const rfById = new Map(rfNodes.map((n) => [n.id, n]))
    const ordered = group.variantNodeIds.length > 0
      ? group.variantNodeIds
      : group.winnerNodeId
        ? [group.winnerNodeId]
        : []
    return ordered
      .map((id): WallCandidate | null => {
        const v3 = byId.get(id)
        if (!v3 || v3.kind !== 'asset') return null
        const a = v3 as AssetNodeV3
        const rf = rfById.get(id)
        const d = (rf?.data ?? {}) as Record<string, unknown>
        const num = (v: unknown): number | undefined =>
          typeof v === 'number' && Number.isFinite(v) ? v : undefined
        const str = (v: unknown): string | undefined =>
          typeof v === 'string' && v.length > 0 ? v : undefined
        const modality: Modality = MODALITY_ORDER.includes(a.modality as Modality)
          ? (a.modality as Modality)
          : 'image'
        return {
          nodeId: id,
          label: str(d.label) ?? id.slice(-12),
          modality,
          selected: a.curation === 'selected' || group.winnerNodeId === id,
          score: a.aiScore
            ? { overall: a.aiScore.overall, dimensions: a.aiScore.dimensions }
            : undefined,
          durationSec: num(d.duration_sec) ?? a.media.durationS,
          prompt:
            str(d.generation_prompt) ?? str(d.prompt) ?? str(d.description),
          seed: num(d.seed),
          thumbnailUrl: str(d.thumbnailUrl) ?? a.media.thumbnail ?? undefined,
          filePath: str(d.filePath) ?? a.media.original ?? undefined,
          verdict: str(d.state),
        }
      })
      .filter((c): c is WallCandidate => c != null)
  }, [graph, group, rfNodes])

  // ── transport(每开一次墙重建;关闭即 dispose)──
  const transportRef = useRef<MasterTransport | null>(null)
  const [inspectIdx, setInspectIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0) // UI 镜像(节流)
  const [healedUrls, setHealedUrls] = useState<Record<string, string>>({})
  const [placeholders, setPlaceholders] = useState<Set<string>>(new Set())
  const healerRef = useRef(createThumbHealer())

  if (active && transportRef.current == null) {
    transportRef.current = createMasterTransport([])
  }

  useEffect(() => {
    return () => {
      transportRef.current?.dispose()
      transportRef.current = null
    }
  }, [])

  // 墙开/换组时重置检视与播放态
  useEffect(() => {
    if (!active) return
    setInspectIdx(0)
    setPlaying(false)
    setPlayhead(0)
    transportRef.current?.setSolo(null)
  }, [active, group?.id])

  // playhead UI 镜像:播放期间 rAF 节流刷新(~15fps 足够人眼平滑)
  useEffect(() => {
    if (!active || !playing) return
    if (typeof requestAnimationFrame === 'undefined') return
    let raf = 0
    let lastUi = 0
    const loop = (now: number): void => {
      if (now - lastUi > 66) {
        lastUi = now
        const t = transportRef.current?.masterTime ?? 0
        setPlayhead(t)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active, playing])

  const videoRef = useCallback(
    (nodeId: string) => (el: HTMLVideoElement | null) => {
      const t = transportRef.current
      if (!t) return
      if (el) t.attach(el)
      // el===null 时元素已卸载,transport 内部 WeakMap 监听随元素回收;
      // detach 需要原元素引用——React 卸载时 el 为 null,旧引用经闭包不可得,
      // 故 attach 时同步登记(见下 map),卸载在组重渲时由 dispose 兜底。
      void nodeId
    },
    [],
  )

  const inspect = (index: number): void => {
    const i = Math.max(0, Math.min(index, candidates.length - 1))
    setInspectIdx(i)
    transportRef.current?.setSolo(i) // 检视 = 展开 + solo 声(D-08/D-06)
  }

  const togglePlay = (): void => {
    const t = transportRef.current
    if (!t) return
    if (playing) {
      t.pause()
      setPlaying(false)
    } else {
      t.play()
      setPlaying(true)
    }
  }

  const confirmSelection = useCallback(
    async (nodeId: string) => {
      await selectWinner(nodeId)
      triggerStaleCascade([nodeId]) // store 路径不自带级联(53-02 interfaces)
    },
    [selectWinner],
  )

  useWallKeyboard(
    active,
    {
      onInspect: inspect,
      onConfirmSelection: () => {
        const c = candidates[inspectIdx]
        if (c) void confirmSelection(c.nodeId)
      },
      onNextGroup: () => { /* 53-05 接通串行下一镜(D-17/D-18) */ },
      onPrevGroup: () => { /* 53-05 */ },
      onTogglePlay: togglePlay,
      onClose: close,
    },
    { maxTakes: Math.max(1, candidates.length) },
  )

  // Esc 处理已由 useWallKeyboard onClose 承担;此处不重复挂。
  if (!active) return null

  const spanSec = (() => {
    let min: number | null = null
    for (const c of candidates) {
      if (c.durationSec != null && c.durationSec > 0) {
        if (min == null || c.durationSec < min) min = c.durationSec
      }
    }
    return min ?? 0
  })()
  const headLabel = group
    ? `${candidates[0]?.label?.split(/\s+v\d*$/)[0] ?? '变体'} 选片`
    : '变体选片'
  const inspected = candidates[inspectIdx]

  const onThumbError = (c: WallCandidate): void => {
    if (placeholders.has(c.nodeId)) return
    void healerRef.current.heal(c).then((r) => {
      if (r.kind === 'healed') {
        setHealedUrls((m) => ({ ...m, [c.nodeId]: r.url }))
      } else {
        setPlaceholders((s) => new Set(s).add(c.nodeId))
      }
    })
  }

  const thumbSrc = (c: WallCandidate): string | null => {
    const healed = healedUrls[c.nodeId]
    if (healed) return resolveMediaUrl(healed)
    if (placeholders.has(c.nodeId)) return null
    return resolveMediaUrl(c.thumbnailUrl ?? c.filePath)
  }

  return (
    <div
      data-testid="variant-wall"
      data-wall-group-id={group?.id}
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 40,
        background: theme.chrome.lightboxOverlay, backdropFilter: 'blur(2px)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* ── 头栏 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: theme.bg.panel,
        borderBottom: `1px solid ${theme.border.default}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: v3theme.signal.select, fontSize: 15 }}>🎞</span>
          <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: 13 }}>
            {headLabel}
          </span>
          <span style={{ color: theme.text.secondary, fontSize: 11, fontFamily: 'var(--cv-font-mono, monospace)' }}>
            {candidates.length} takes{spanSec > 0 ? ` · ${spanSec.toFixed(1)}s` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={togglePlay} data-testid="wall-sync-play" style={btnStyle(playing)}>
            {playing ? '⏸ 同播' : '▶ 同播'}
          </button>
          <button disabled title="53-05 接通串行下一镜" style={{ ...btnStyle(false), opacity: 0.45, cursor: 'not-allowed' }}>
            下一镜 →
          </button>
          <button onClick={close} style={closeBtnStyle}>✕</button>
        </div>
      </div>

      {/* ── N-up 墙 + 共享主 playhead(签名元素)── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 10 }}>
        <div style={{
          flex: 1, minHeight: 0, display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12,
        }}>
          {candidates.map((c, i) => {
            const isInspected = i === inspectIdx
            const progress = spanSec > 0 ? (playhead % spanSec) / spanSec : 0
            const videoSrc = resolveMediaUrl(c.filePath)
            return (
              <div key={c.nodeId} data-wall-take={c.nodeId}
                onClick={() => inspect(i)}
                style={{
                  position: 'relative', display: 'flex', flexDirection: 'column',
                  background: theme.bg.card, border: `1.5px solid ${isInspected ? v3theme.signal.select : theme.border.default}`,
                  borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
                }}>
                <div style={{ flex: 1, minHeight: 0, background: 'var(--cv-bg-overlay, #1E2128)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {c.modality === 'video' && videoSrc
                    ? (
                      <video
                        ref={videoRef(c.nodeId)}
                        src={videoSrc}
                        muted
                        loop
                        playsInline
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    )
                    : (
                      <ThumbOrPlaceholder c={c} src={thumbSrc(c)} onError={() => onThumbError(c)} />
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', fontSize: 11, fontFamily: 'var(--cv-font-mono, monospace)', color: theme.text.secondary }}>
                  <span>{c.label}</span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {c.durationSec != null && <span>{c.durationSec.toFixed(1)}s</span>}
                    {c.selected && <span style={{ color: v3theme.signal.select }}>已选定</span>}
                  </span>
                </div>
                {/* 该 take 的 playhead 镜像 */}
                <div style={{ height: 3, background: v3theme.edge.inactive }}>
                  <div style={{ width: `${progress * 100}%`, height: '100%', background: v3theme.signal.select }} />
                </div>
              </div>
            )
          })}
        </div>
        {/* 共享主 playhead(可拖 = seek) */}
        <input
          type="range" min={0} max={Math.max(spanSec, 0.1)} step={0.01}
          value={Math.min(playhead % (spanSec || 1), spanSec || 0.1)}
          onChange={(e) => {
            const t = Number(e.target.value)
            transportRef.current?.seek(t)
            setPlayhead(t)
          }}
          data-testid="wall-master-playhead"
          style={{ width: '100%', accentColor: v3theme.signal.select }}
        />
      </div>

      {/* ── 胶片条 + 检视详情行 ── */}
      <div style={{ background: theme.bg.panel, borderTop: `1px solid ${theme.border.default}` }}>
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '10px 16px' }}>
          {candidates.map((c, i) => {
            const isInspected = i === inspectIdx
            return (
              <button key={c.nodeId} data-testid="wall-film-card" data-node-id={c.nodeId}
                onClick={() => inspect(i)}
                style={{
                  flex: '0 0 auto', width: 160, padding: 0, cursor: 'pointer', textAlign: 'left',
                  background: theme.bg.card, border: `1.5px solid ${isInspected ? v3theme.signal.select : theme.border.default}`,
                  borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                }}>
                <div style={{ height: 72, background: v3theme.modalityWeak[c.modality], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ThumbOrPlaceholder c={c} src={thumbSrc(c)} onError={() => onThumbError(c)} />
                </div>
                <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                    <span style={{ color: theme.text.primary, fontFamily: 'var(--cv-font-mono, monospace)' }}>
                      {c.seed != null ? `seed ${c.seed}` : c.label.slice(-8)}
                    </span>
                    {c.score
                      ? (
                        <span style={{
                          color: '#0A0B0E', background: getScoreColor(c.score.overall),
                          fontWeight: 700, fontSize: 10, padding: '1px 5px', borderRadius: 4,
                        }}>
                          {Math.round(c.score.overall * 100)}
                        </span>
                      )
                      : (
                        <span style={{ color: theme.text.secondary, fontSize: 10 }}>
                          {c.verdict ?? '—'}
                        </span>
                      )}
                  </div>
                  {c.prompt && (
                    <div style={{ fontSize: 10, color: theme.text.secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.prompt}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        {/* 检视详情行 */}
        {inspected && (
          <div style={{
            padding: '8px 16px 12px', borderTop: `1px solid ${theme.border.default}`,
            display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: theme.text.secondary, marginBottom: 4 }}>
                检视 take {inspectIdx + 1} · {inspected.label}
                {inspected.seed != null && (
                  <span style={{ fontFamily: 'var(--cv-font-mono, monospace)' }}> · seed {inspected.seed}</span>
                )}
                {inspected.durationSec != null && <> · {inspected.durationSec.toFixed(1)}s</>}
              </div>
              <div style={{ fontSize: 12, color: theme.text.primary, whiteSpace: 'pre-wrap', maxHeight: 60, overflowY: 'auto' }}>
                {inspected.prompt ?? '(无 prompt)'}
              </div>
              {inspected.score?.dimensions && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {Object.entries(inspected.score.dimensions).map(([dim, v]) => (
                    <span key={dim} style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 4,
                      background: v3theme.modalityWeak[inspected.modality], color: theme.text.secondary,
                    }}>
                      {dim} {(v * 100).toFixed(0)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => void confirmSelection(inspected.nodeId)}
              data-testid="wall-confirm-select"
              style={{
                ...btnStyle(false),
                borderColor: v3theme.signal.select,
                color: inspected.selected ? v3theme.signal.select : theme.text.primary,
                background: inspected.selected ? 'transparent' : v3theme.signal.select,
                fontWeight: 700, padding: '6px 14px',
              }}
            >
              {inspected.selected ? '✓ 已选定' : '选定'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 缩略或模态 emoji 占位(DR-3 第三段,VariantPicker L108-111 范式)。 */
function ThumbOrPlaceholder({ c, src, onError }: {
  c: WallCandidate
  src: string | null
  onError: () => void
}): React.ReactElement {
  if (src) {
    return (
      <img src={src} alt="" onError={onError}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    )
  }
  return (
    <span style={{ fontSize: 22, opacity: 0.4 }}>
      {c.modality === 'video' ? '🎬' : c.modality === 'audio' ? '🎵' : '🖼'}
    </span>
  )
}

function btnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? v3theme.signal.select : theme.bg.card,
    color: active ? '#0A0B0E' : theme.text.primary,
    border: `1px solid ${theme.border.default}`,
    borderRadius: 6, fontSize: 12, padding: '4px 10px', cursor: 'pointer',
  }
}

const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: theme.text.secondary, fontSize: 16,
  cursor: 'pointer', padding: '2px 6px', lineHeight: 1, borderRadius: 4,
}
