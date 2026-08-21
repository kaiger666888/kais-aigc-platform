/**
 * GroupViewTheater.tsx — 组视图剧场容器(Phase 56-04 / VIZ-02,D-05)。
 *
 * useTheaterStore 开态 → deriveGroupMembers(空态卡)→ 按 kind 分发
 * TurnaroundView(2×2 同步缩放,scale state 在此受控)/SceneGallery/
 * VoiceProfileBoard。头栏「节点详情」按钮开右面板不关剧场;zIndex 剧场 40,
 * NodeDetailPanel 原值在其上层则并存(实测其 zIndex 更高,零改)。
 *
 * 手动冒烟:npm run dev → 打开画布 → 双击 character 类资产节点 → 剧场;
 * 滚轮缩放四格同步;Esc/背板/✕ 关闭;「节点详情」开右面板并存。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTheaterStore } from './theaterStore'
import { deriveGroupMembers, turnaroundSlots } from './groupMembership'
import TheaterShell, { theaterBtnStyle } from './TheaterShell'
import TurnaroundView, { TURNAROUND_SCALE_MAX, TURNAROUND_SCALE_MIN } from './TurnaroundView'
import SceneGallery from './SceneGallery'
import VoiceProfileBoard from './VoiceProfileBoard'
import { useCanvasStore } from '../../store/canvasStore'
import { theme } from '../../theme/catppuccin'

export default function GroupViewTheater(): React.ReactElement | null {
  const target = useTheaterStore((s) => s.group)
  const close = useTheaterStore((s) => s.close)
  const graph = useCanvasStore((s) => s.graph)
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)
  const setDetailNode = useCanvasStore((s) => s.setDetailNode)
  const nodes = useCanvasStore((s) => s.nodes)
  const [scale, setScale] = useState(1)

  useEffect(() => { setScale(1) }, [target?.anchorId])

  // Esc 关闭(开态门控 + cleanup)
  useEffect(() => {
    if (target == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, close])

  const members = useMemo(
    () => (target != null ? deriveGroupMembers(target.kind, target.anchorId, graph, rawDataByNodeId) : []),
    [target, graph, rawDataByNodeId],
  )

  if (target == null) return null

  const clampScale = (s: number) => Math.min(TURNAROUND_SCALE_MAX, Math.max(TURNAROUND_SCALE_MIN, s))
  const openDetail = () => {
    const rf = (nodes as Array<{ id: string }>).find((n) => n.id === target.anchorId)
    if (rf != null) setDetailNode(rf as never)
  }

  const kindLabel = target.kind === 'turnaround' ? '组视图' : target.kind === 'scene' ? '组视图' : '音色试听'
  const anchorLabel = members[0]?.label ?? target.anchorId
  const title = target.kind === 'voice'
    ? `${anchorLabel} · 音色试听 · ${members.length} 条声纹`
    : `${anchorLabel} · ${kindLabel} · ${members.length} 视图`

  const headerExtra = (
    <>
      {target.kind === 'turnaround' && (
        <>
          <button style={theaterBtnStyle(false)} onClick={() => setScale(clampScale(scale + 0.5))} title="同步缩放 ＋">＋</button>
          <button style={theaterBtnStyle(false)} onClick={() => setScale(clampScale(scale - 0.5))} title="同步缩放 －">－</button>
          <button style={theaterBtnStyle(false)} onClick={() => setScale(1)} title="复位">复位</button>
          <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 11, color: theme.text.secondary, width: 36, textAlign: 'right' }}>{scale.toFixed(1)}×</span>
        </>
      )}
      <button style={theaterBtnStyle(false)} onClick={openDetail} title="打开节点详情面板(剧场保持)">节点详情</button>
    </>
  )

  return (
    <TheaterShell
      title={title}
      icon={target.kind === 'voice' ? '🎤' : '🎞'}
      onClose={close}
      headerExtra={headerExtra}
    >
      {members.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--cv-bg-panel)', border: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))', borderRadius: 10, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, marginBottom: 6 }}>未找到同族资产</div>
            <div style={{ fontSize: 11, color: theme.text.secondary, lineHeight: 1.7 }}>该节点没有可同屏对比的视图/声纹</div>
          </div>
        </div>
      ) : target.kind === 'turnaround' ? (
        <TurnaroundView
          slots={turnaroundSlots(members)}
          center={{
            refUrl: members[0]?.thumbnailUrl ?? members[0]?.filePath,
            name: anchorLabel,
            consistency: undefined,
          }}
          scale={scale}
          onScaleChange={setScale}
        />
      ) : target.kind === 'scene' ? (
        (() => {
          const views = members.flatMap((m) =>
            Object.entries(m.views ?? {}).map(([key, url]) => ({ key, url })),
          )
          const fallback = members
            .filter((m) => m.filePath != null || m.thumbnailUrl != null)
            .map((m) => ({ key: m.viewAngle ?? 'reference', url: (m.filePath ?? m.thumbnailUrl)! }))
          const all = views.length > 0 ? views : fallback
          return <SceneGallery views={all} name={anchorLabel} />
        })()
      ) : (
        <VoiceProfileBoard profiles={members} />
      )}
    </TheaterShell>
  )
}
