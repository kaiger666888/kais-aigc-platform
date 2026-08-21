/**
 * SceneShotBrowser.tsx — 场景→镜头两级浏览(Phase 55-02 / NAV-02,UI-SPEC §2)。
 *
 * 93 镜规模下单级平铺不可用:场景节头(3px 场景色带 + 计数 + MM:SS)折叠分组
 * → 镜头卡网格(minmax(200px,1fr))。镜头卡一级常显(16:9 缩略降级链/shot_id/
 * 时长 chip/景别·运镜 chip/左缘场景色带),hover 二级(画面提示 2 行截断 +
 * 引用角色/场景 24px 缩略图横排)。单击卡跳画布聚焦(focusAssetNodeId)。
 *
 * 数据全部 graph 派生(extractShots;弃用 p10b board JSON——Pitfall 6),
 * 零请求。场景口径 sceneNumOf/sceneColorOf/formatTotalDuration 走共享 util
 * (binding constraint 4)。token-only:色值仅 SCENE_COLORS 派生,间距/字号
 * 走 --cv-*;全卡 <button> 保键盘焦点(Do-Not-Regress 5)。
 */
import { useMemo, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { extractShots, type StoryboardShot } from './StoryboardTimeline'
import { sceneNumOf, sceneColorOf, formatTotalDuration, SCENE_COLORS } from '../utils/sceneGrouping'
import { METADATA_LABELS } from '../constants'
import { resolveMediaUrl } from '../utils/mediaUrl'
import { theme } from '../theme/catppuccin'

interface SceneGroup {
  sceneNum: number
  shots: StoryboardShot[]
  totalSec: number
}

function fmtDuration(sec: number): string {
  return `${sec}s`
}

export default function SceneShotBrowser(): React.ReactElement {
  const graph = useCanvasStore((s) => s.graph)
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)
  const setFocusAssetNodeId = useCanvasStore((s) => s.setFocusAssetNodeId)
  const setViewMode = useCanvasStore((s) => s.setViewMode)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const groups = useMemo<SceneGroup[]>(() => {
    const shots = extractShots(graph, rawDataByNodeId)
    const map = new Map<number, SceneGroup>()
    for (const shot of shots) {
      const n = sceneNumOf(shot.shotId)
      let g = map.get(n)
      if (g == null) {
        g = { sceneNum: n, shots: [], totalSec: 0 }
        map.set(n, g)
      }
      g.shots.push(shot)
      g.totalSec += shot.durationS ?? 0
    }
    return [...map.values()].sort((a, b) => a.sceneNum - b.sceneNum)
  }, [graph, rawDataByNodeId])

  if (groups.length === 0) {
    return (
      <div data-testid="scene-shot-browser" style={{ padding: 48, textAlign: 'center', height: '100%' }}>
        <div style={{ fontSize: 'var(--cv-fs-t1, 14px)', fontWeight: 600, color: theme.text.primary, marginBottom: 8 }}>
          本集无分镜数据
        </div>
        <div style={{ fontSize: 'var(--cv-fs-t3, 11px)', color: theme.text.secondary, lineHeight: 1.7 }}>
          运行 P09 分镜拆解后，这里会按场景展示全部镜头
        </div>
      </div>
    )
  }

  const toggle = (sceneNum: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(sceneNum)) next.delete(sceneNum)
      else next.add(sceneNum)
      return next
    })
  }

  const focusShot = (nodeId: string) => {
    setFocusAssetNodeId(nodeId)
    setViewMode('canvas')
  }

  return (
    <div data-testid="scene-shot-browser" style={{ height: '100%', overflowY: 'auto', padding: 'var(--cv-panel-pad, 16px)' }}>
      {groups.map((g, gi) => {
        const color = sceneColorOf(g.sceneNum)
        const isCollapsed = collapsed.has(g.sceneNum)
        return (
          <section key={g.sceneNum} style={{ marginBottom: 'var(--cv-panel-section-gap, 24px)' }}>
            {/* 场景节头:3px 场景色带 + 计数 + 累计时长;折叠态保留计数与时长 */}
            <button
              data-testid={`scene-header-${g.sceneNum}`}
              onClick={() => toggle(g.sceneNum)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '8px 12px', cursor: 'pointer',
                background: 'none', border: 'none', textAlign: 'left',
                boxShadow: `inset 3px 0 0 ${color}`,
              }}
            >
              <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 'var(--cv-fs-t3, 11px)', fontWeight: 600, color }}>
                {g.sceneNum > 0 ? `场景 ${g.sceneNum}` : '未编号'}
              </span>
              <span style={{ fontSize: 'var(--cv-fs-t3, 11px)', color: 'var(--cv-lane-label)' }}>
                · {g.shots.length} 镜 · {formatTotalDuration(g.totalSec)}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 'var(--cv-fs-t3, 11px)', color: theme.text.tertiary }}>
                {isCollapsed ? '▸' : '▾'}
              </span>
            </button>

            {!isCollapsed && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--cv-gap-md, 12px)', padding: '8px 12px' }}>
                {g.shots.map((shot) => (
                  <ShotCard key={shot.node.id} shot={shot} color={color} onClick={() => focusShot(shot.node.id)} defaultOpen={false} />
                ))}
              </div>
            )}
            {gi === groups.length - 1 && null /* 尾组无额外间距 */}
          </section>
        )
      })}
    </div>
  )
}

function ShotCard({ shot, color, onClick }: { shot: StoryboardShot; color: string; onClick: () => void; defaultOpen?: boolean }): React.ReactElement {
  const [hover, setHover] = useState(false)
  const thumb = resolveMediaUrl(shot.firstFrame ?? shot.thumbnail)
  const framingLabel = shot.framing != null ? METADATA_LABELS.framing[shot.framing as keyof typeof METADATA_LABELS.framing] : null
  const cameraLabel = shot.cameraMovement != null ? METADATA_LABELS.cameraMovement[shot.cameraMovement as keyof typeof METADATA_LABELS.cameraMovement] : null
  const hint = shot.videoPrompt ?? shot.promptText ?? null
  const refs = shot.referencedAssets

  return (
    <button
      data-testid={`shot-card-${shot.shotId}`}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', cursor: 'pointer',
        background: 'var(--cv-bg-card)', borderRadius: 8,
        boxShadow: `inset 3px 0 0 ${color}`,
        padding: 0, border: 'none', textAlign: 'left', fontFamily: 'inherit',
        transition: 'background var(--cv-d-select, 120ms) var(--cv-e-out, ease-out)',
      }}
    >
      {/* 16:9 缩略图降级链:首帧 → 缩略图 → 场景色底 */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', borderRadius: '8px 8px 0 0', background: `${color}33` }}>
        {thumb != null && <img src={thumb} alt={shot.shotId} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        <span style={{ position: 'absolute', left: 6, bottom: 4, fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 'var(--cv-fs-t4, 10px)', color: 'var(--cv-text-primary)', background: 'rgba(10,11,14,0.55)', padding: '1px 5px', borderRadius: 4 }}>
          {shot.shotId}
        </span>
      </div>

      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--cv-fs-t4, 10px)', color: theme.text.tertiary, background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '1px 6px' }}>
            {fmtDuration(shot.durationS ?? 0)}
          </span>
          {framingLabel != null && (
            <span style={{ fontSize: 'var(--cv-fs-t4, 10px)', color: theme.text.secondary, background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '1px 6px' }}>{framingLabel}</span>
          )}
          {cameraLabel != null && (
            <span style={{ fontSize: 'var(--cv-fs-t4, 10px)', color: theme.text.secondary, background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '1px 6px' }}>{cameraLabel}</span>
          )}
        </div>

        {/* hover 二级:画面提示(2 行截断)+ 引用行 */}
        {hover && (hint != null || refs != null) && (
          <div style={{ borderTop: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {hint != null && (
              <div>
                <div style={{ fontSize: 'var(--cv-fs-t4, 10px)', color: theme.text.tertiary, marginBottom: 2 }}>画面提示</div>
                <div title={hint} style={{ fontSize: 'var(--cv-fs-t3, 11px)', color: theme.text.secondary, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {hint}
                </div>
              </div>
            )}
            {refs != null && (
              <div>
                <div style={{ fontSize: 'var(--cv-fs-t4, 10px)', color: theme.text.tertiary, marginBottom: 3 }}>引用</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {refs.characters.map((c) => (
                    <RefThumb key={`c-${c.name}`} name={c.name} thumbnail={c.thumbnail} color={SCENE_COLORS[0]} />
                  ))}
                  {refs.scenes.map((s) => (
                    <RefThumb key={`s-${s.name}`} name={s.name} thumbnail={s.thumbnail} color={SCENE_COLORS[1]} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  )
}

function RefThumb({ name, thumbnail, color }: { name: string; thumbnail: string | null; color: string }): React.ReactElement {
  const url = resolveMediaUrl(thumbnail)
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3, maxWidth: 60 }} title={name}>
      {url != null ? (
        <img src={url} alt={name} loading="lazy" style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover', display: 'block' }} />
      ) : (
        <span style={{ width: 24, height: 24, borderRadius: 6, background: `${color}33`, border: `1px solid ${color}55`, display: 'block' }} />
      )}
      <span style={{ fontSize: 'var(--cv-fs-t4, 10px)', color: theme.text.secondary, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    </span>
  )
}
