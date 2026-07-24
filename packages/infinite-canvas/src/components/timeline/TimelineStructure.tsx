/**
 * src/components/timeline/TimelineStructure.tsx — D 层 composite 专版时间线（设计重头戏 / 宪法 P6）。
 *
 * 数据：composite 资产的 asset.timeline: TimelineStructure（durationS / source / shots[]）。
 *  - 胶片带：每 shot 一格，cell 宽 = (endS-startS)*pxPerSec，下限 28px；触发下限的极短格标 `~`（非线性）。
 *    每格内「首帧 | 尾帧」对劈（shot.keyframes[0]/[last] 解析为资产缩略）；无帧则取 video 资产缩略。
 *  - 对白带：dialogueText 单行截断，hover 全文 title。
 *  - voice/foley/bgm 三轨波形行：per-shot 能量合成占位波形（shotEnergy × pseudoWaveform），
 *    该 shot 引用了对应轨资产才画；接口留 media.waveform（真实波形接入后替换 heights 来源）。
 *  - 16px 概览条 + 视口窗：随胶片带横向滚动同步移动。
 *  - 点 shot 格 → 按 shotId 在 graph 找 storyboard 资产 → setSelectedNode（P18 溯源随动）。
 */
import { useRef, useState } from 'react'
import type { AssetNodeV3, TimelineShot } from '@kais/flowgraph-v3'
import { v3theme, theme } from '../../theme/catppuccin'
import { useCanvasStore } from '../../store/canvasStore'
import { pseudoWaveform, shotEnergy } from '../../utils/waveform'

const PX_PER_SEC = 20
const MIN_CELL_W = 28
const ROW_H = 26

interface Cell {
  shot: TimelineShot
  w: number
  nonlinear: boolean
}

export default function TimelineStructure({ asset }: { asset: AssetNodeV3 }): React.ReactElement | null {
  const timeline = asset.timeline
  const graph = useCanvasStore((s) => s.graph)
  const nodes = useCanvasStore((s) => s.nodes)
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode)
  const showToast = useCanvasStore((s) => s.showToast)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scroll, setScroll] = useState({ left: 0, width: 0 })

  if (!timeline || timeline.shots.length === 0) return null

  const cells: Cell[] = timeline.shots.map((shot) => {
    const dur = Math.max(0, shot.endS - shot.startS)
    const linear = dur * PX_PER_SEC
    return { shot, w: Math.max(MIN_CELL_W, Math.round(linear)), nonlinear: linear < MIN_CELL_W }
  })
  const totalW = cells.reduce((a, c) => a + c.w, 0)

  // 资产缩略解析（首/尾帧、video、波形 URL）
  const assetOf = (id: string | undefined) => {
    if (!id) return undefined
    return graph?.nodes.find((n) => n.id === id && n.kind === 'asset')
  }
  const thumbOf = (id: string | undefined): string | null => {
    const n = assetOf(id)
    return n && n.kind === 'asset' ? (n.media.thumbnail ?? n.media.original) : null
  }

  // 点 shot → 联动选中对应 storyboard 资产（按 shotId 匹配）
  const handleShotClick = (shot: TimelineShot) => {
    const sb = graph?.nodes.find(
      (n) => n.kind === 'asset' && n.stage === 'storyboard' && n.meta.stage === 'storyboard' && (n.meta as { shotId: string }).shotId === shot.shotId,
    )
    if (!sb) {
      showToast(`未找到 shot ${shot.shotId} 对应的分镜资产`, 'info')
      return
    }
    const rf = nodes.find((n) => n.id === sb.id)
    if (rf) setSelectedNode(rf)
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (el) setScroll({ left: el.scrollLeft, width: el.clientWidth })
  }

  // 概览条视口窗比例
  const viewportPct = totalW > 0 ? scroll.width / totalW : 1
  const thumbW = Math.max(0.06, Math.min(1, viewportPct)) * 100
  const thumbLeft = totalW > 0 ? (scroll.left / totalW) * 100 : 0

  return (
    <div data-testid="timeline-structure" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={labelStyle}>胶片时间线</span>
        <span style={{ fontSize: 10, color: theme.text.secondary, fontFamily: 'var(--cv-font-mono, monospace)' }}>
          {timeline.source === 'decompose' ? '逆向解构' : '正向合成'} · {timeline.shots.length} shot · {timeline.durationS.toFixed(1)}s
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ overflowX: 'auto', overflowY: 'hidden', borderRadius: 6, border: `1px solid ${theme.border.default}`, background: theme.bg.image }}
      >
        <div style={{ width: totalW, minWidth: '100%' }}>
          {/* 胶片带：首帧|尾帧对劈 */}
          <FilmstripRow cells={cells} thumbOf={thumbOf} onShotClick={handleShotClick} />
          {/* 对白带 */}
          <DialogueRow cells={cells} />
          {/* 三轨波形 */}
          <WaveformRow cells={cells} track="voice" label="voice" color={v3theme.modality.audio} assetOf={assetOf} />
          <WaveformRow cells={cells} track="foley" label="foley" color={v3theme.modality.audio} assetOf={assetOf} />
          <WaveformRow cells={cells} track="bgm" label="bgm" color={v3theme.modality.audio} assetOf={assetOf} />
        </div>
      </div>

      {/* 16px 概览条 + 视口窗 */}
      <div style={{ position: 'relative', height: 16, borderRadius: 4, background: theme.bg.surface, border: `1px solid ${theme.border.subtle}`, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {cells.map((c, i) => (
            <div key={i} style={{ width: c.w, borderRight: '1px solid var(--cv-bg-canvas, #100E0A)', background: i % 2 === 0 ? 'rgba(157,180,142,0.10)' : 'transparent' }} />
          ))}
        </div>
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${thumbLeft}%`, width: `${thumbW}%`,
          background: 'rgba(242,233,216,0.18)', border: `1px solid ${v3theme.signal.select}`, borderRadius: 3,
          pointerEvents: 'none',
        }} />
      </div>
    </div>
  )
}

// ─── 胶片带行 ───────────────────────────────────────────────

function FilmstripRow({ cells, thumbOf, onShotClick }: {
  cells: Cell[]
  thumbOf: (id: string | undefined) => string | null
  onShotClick: (shot: TimelineShot) => void
}) {
  return (
    <div style={{ display: 'flex', height: 64, borderBottom: `1px solid ${theme.border.subtle}` }}>
      {cells.map(({ shot, w, nonlinear }) => {
        const first = thumbOf(shot.keyframes?.[0])
        const last = thumbOf(shot.keyframes?.[(shot.keyframes?.length ?? 0) - 1])
        const videoThumb = thumbOf(shot.video)
        return (
          <div
            key={shot.shotId}
            data-shot-id={shot.shotId}
            onClick={() => onShotClick(shot)}
            title={`shot ${shot.shotId}${nonlinear ? '  (~ 非线性宽)' : ''} · ${(shot.endS - shot.startS).toFixed(1)}s · 点击选中分镜`}
            style={{ width: w, minWidth: MIN_CELL_W, flex: '0 0 auto', display: 'flex', cursor: 'pointer', borderRight: '1px solid var(--cv-bg-canvas, #100E0A)', position: 'relative' }}
          >
            {/* 首帧|尾帧对劈 */}
            <div style={{ flex: 1, overflow: 'hidden', background: v3theme.modalityWeak.video }}>
              {first ? <img src={first} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : videoThumb ? <img src={videoThumb} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ margin: 'auto', fontSize: 10, color: theme.text.disabled }}>#{shot.index + 1}</span>}
            </div>
            {(last && last !== first) && (
              <div style={{ flex: 1, overflow: 'hidden', borderLeft: '1px solid var(--cv-bg-canvas, #100E0A)', background: v3theme.modalityWeak.video }}>
                <img src={last} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
            <span style={{ position: 'absolute', left: 2, top: 1, fontSize: 9, fontFamily: 'var(--cv-font-mono, monospace)', color: '#F2E9D8', textShadow: '0 1px 2px #000' }}>
              {nonlinear ? '~' : ''}{shot.index + 1}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── 对白带 ─────────────────────────────────────────────────

function DialogueRow({ cells }: { cells: Cell[] }) {
  return (
    <div style={{ display: 'flex', height: 20, borderBottom: `1px solid ${theme.border.subtle}`, background: 'rgba(198,183,148,0.05)' }}>
      {cells.map(({ shot, w }) => (
        <div
          key={shot.shotId}
          title={shot.dialogueText ?? ''}
          style={{
            width: w, minWidth: MIN_CELL_W, flex: '0 0 auto', borderRight: '1px solid var(--cv-bg-canvas, #100E0A)',
            padding: '0 4px', fontSize: 10, lineHeight: '20px', color: v3theme.modalityDim.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {shot.dialogueText ?? ''}
        </div>
      ))}
    </div>
  )
}

// ─── 波形行（voice/foley/bgm 三轨） ──────────────────────────

function WaveformRow({ cells, track, label, color, assetOf }: {
  cells: Cell[]
  track: 'voice' | 'foley' | 'bgm'
  label: string
  color: string
  assetOf: (id: string | undefined) => unknown
}) {
  return (
    <div style={{ display: 'flex', height: ROW_H, borderBottom: `1px solid ${theme.border.subtle}`, alignItems: 'center' }}>
      {cells.map(({ shot, w }) => {
        const refId = shot[track]
        const present = !!refId && !!assetOf(refId)
        const heights = pseudoWaveform(`${shot.shotId}-${track}`, Math.max(8, Math.floor(w / 3)))
        const energy = shotEnergy(`${shot.shotId}-${track}`)
        return (
          <div key={shot.shotId} style={{ width: w, minWidth: MIN_CELL_W, flex: '0 0 auto', height: '100%', display: 'flex', alignItems: 'center', gap: 1, padding: '0 2px', borderRight: '1px solid var(--cv-bg-canvas, #100E0A)' }} title={`${label} · ${shot.shotId}${present ? '' : '（无轨资产）'}`}>
            {present ? heights.map((h, i) => (
              <div key={i} style={{ flex: 1, height: `${Math.round(h * energy * 100)}%`, maxWidth: 3, background: color, opacity: 0.75, borderRadius: 1 }} />
            )) : <span style={{ fontSize: 8, color: theme.text.disabled, margin: 'auto' }}>—</span>}
          </div>
        )
      })}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  color: theme.text.secondary, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
}
