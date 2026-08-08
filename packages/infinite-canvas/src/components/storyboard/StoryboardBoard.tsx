/**
 * StoryboardBoard.tsx — 全景分镜板视图（E-Konte 风格 grid）。
 *
 * 从 /api/v1/storyboard/:projectId/:episodesId 拉取 p10b 组装的分镜板 JSON，
 * 按场景分组渲染缩略图网格。只读展示（V1，不支持编辑）。
 *
 * 布局：
 *   - 顶部统计栏：总镜头数 / 总时长 / 总场景数 + 返回画布
 *   - 按场景折叠分组，每组 header（场景号 + 名称 + 镜数 + 时长）
 *   - 场景内 Grid（auto-fill, minmax(200px)）
 *   - 镜头卡片：16:9 缩略图 + 景别/运镜 + 时长/转场 + 对白摘要 + 角色 + 预览播放
 *   - hover 展开 action_note / emotion / framing / 完整对白
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { theme } from '../../theme/catppuccin'
import { UiIcon } from '../canvas/icons'
import {
  fetchStoryboardBoard,
  createCancelToken,
  type StoryboardBoard as Board,
  type StoryboardShot,
} from '../../services/canvasApi'

// ─── helpers ──────────────────────────────────────────────

/** Resolve a thumbnail/file path to a displayable URL. */
function toDisplayUrl(p: string | null | undefined): string {
  if (!p) return ''
  if (/^(https?:|data:|\/oss\/|blob:)/.test(p)) return p
  // Relative episode-asset path (e.g. "assets/S07/S01_front.png") — serve via
  // the canvas static-file route. Falls back to placeholder on load error.
  if (!p.startsWith('/')) return `/api/canvas/v2/file/image?path=${encodeURIComponent(p)}`
  return p
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return '—'
  return `${sec.toFixed(sec < 10 ? 1 : 0)}s`
}

const PLACEHOLDER = (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: theme.text.disabled,
      background: `linear-gradient(135deg, ${theme.bg.card}, ${theme.bg.cardHover})`,
    }}
  >
    <UiIcon kind="image" size={22} />
  </div>
)

// ─── shot card ────────────────────────────────────────────

function ShotCard({ shot }: { shot: StoryboardShot }) {
  const [imgOk, setImgOk] = useState(true)
  const [hover, setHover] = useState(false)
  const [playing, setPlaying] = useState(false)
  const thumbUrl = toDisplayUrl(shot.thumbnail)
  const hasPreview = !!shot.preview_clip

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${theme.border.subtle}`,
        borderRadius: 10,
        overflow: 'hidden',
        transition: 'background 140ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1)), border-color 140ms var(--cv-e-out, cubic-bezier(0.2,0.8,0.2,1))',
        boxShadow: hover ? theme.shadow.cardHi : theme.shadow.card,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 16:9 thumbnail + preview play */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: theme.bg.dim }}>
        {playing && hasPreview ? (
          <video
            src={toDisplayUrl(shot.preview_clip)}
            controls
            autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }}
          />
        ) : thumbUrl && imgOk ? (
          <img
            src={thumbUrl}
            alt={shot.shot_id}
            onError={() => setImgOk(false)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, display: 'block' }}
          />
        ) : (
          PLACEHOLDER
        )}
        {hasPreview && !playing && (
          <button
            onClick={() => setPlaying(true)}
            title="播放快速预览"
            style={{
              position: 'absolute',
              right: 8,
              bottom: 8,
              width: 30,
              height: 30,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(0,0,0,0.6)',
              color: theme.text.primary,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(4px)',
            }}
          >
            <span style={{ fontSize: 12 }}>▶</span>
          </button>
        )}
        {/* shot id badge over thumbnail */}
        <span
          style={{
            position: 'absolute',
            left: 8,
            top: 8,
            padding: '2px 7px',
            borderRadius: 5,
            background: 'rgba(0,0,0,0.65)',
            color: theme.text.primary,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}
        >
          {shot.shot_id || '—'}
        </span>
      </div>

      {/* body */}
      <div style={{ padding: '9px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* scale + camera */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {shot.shot_scale && <Chip label={shot.shot_scale} tone="accent" />}
          {shot.camera_motion && <Chip label={shot.camera_motion} />}
          {shot.framing && <Chip label={shot.framing} />}
        </div>
        {/* duration + transitions */}
        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: theme.text.tertiary }}>
          <span>⏱ {fmtDuration(shot.duration_sec)}</span>
          {shot.transition_from && <span>← {shot.transition_from}</span>}
          {shot.transition_to && <span>→ {shot.transition_to}</span>}
        </div>
        {/* dialogue summary */}
        {shot.dialogue_summary && (
          <div
            style={{
              fontSize: 11.5,
              color: theme.text.secondary,
              lineHeight: 1.4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {shot.dialogue_summary}
          </div>
        )}
        {/* characters */}
        {shot.characters.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {shot.characters.map((c) => (
              <span
                key={c}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 10.5,
                  color: theme.text.secondary,
                  background: theme.bg.dim,
                  padding: '1px 6px',
                  borderRadius: 4,
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: theme.node.script, display: 'inline-block' }} />
                {c}
              </span>
            ))}
          </div>
        )}
        {/* hover expand: action_note / emotion / framing / full dialogue */}
        {hover && (shot.action_note || shot.emotion) && (
          <div
            style={{
              marginTop: 2,
              paddingTop: 7,
              borderTop: `1px solid ${theme.border.dim}`,
              fontSize: 11,
              color: theme.text.tertiary,
              lineHeight: 1.45,
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}
          >
            {shot.emotion && <div><b style={{ color: theme.text.secondary }}>情绪</b> · {shot.emotion}</div>}
            {shot.action_note && (
              <div style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                <b style={{ color: theme.text.secondary }}>动作</b> · {shot.action_note}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Chip({ label, tone }: { label: string; tone?: 'accent' }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: 4,
        color: tone === 'accent' ? theme.text.primary : theme.text.secondary,
        background: tone === 'accent' ? 'rgba(224,182,101,0.16)' : theme.bg.dim,
      }}
    >
      {label}
    </span>
  )
}

// ─── scene section ────────────────────────────────────────

function SceneSection({
  scene,
  defaultOpen,
}: {
  scene: Board['scenes'][number]
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const dur = useMemo(
    () => scene.shots.reduce((s, sh) => s + (sh.duration_sec ?? 0), 0),
    [scene.shots],
  )
  return (
    <section style={{ marginBottom: 18 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 10px',
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid ${theme.border.subtle}`,
          borderRadius: 8,
          cursor: 'pointer',
          color: theme.text.primary,
          marginBottom: open ? 10 : 0,
        }}
      >
        <span style={{ fontSize: 11, color: theme.text.tertiary, width: 12, display: 'inline-block' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{scene.scene_id}</span>
        <span style={{ color: theme.text.secondary, fontSize: 12 }}>· {scene.scene_title}</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: theme.text.tertiary, fontSize: 11 }}>
          {scene.shots.length} 镜 · {fmtDuration(dur)}
        </span>
      </button>
      {open && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          {scene.shots.map((sh) => (
            <ShotCard key={sh.shot_id || Math.random()} shot={sh} />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── main ─────────────────────────────────────────────────

export default function StoryboardBoard() {
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)
  const setViewMode = useCanvasStore((s) => s.setViewMode)

  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (projectId == null || episodesId == null) return
    setLoading(true)
    setError(null)
    const cancel = createCancelToken()
    try {
      const b = await fetchStoryboardBoard(projectId, episodesId, cancel)
      setBoard(b)
    } catch (e: any) {
      setError(e?.message ?? '加载失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, episodesId])

  useEffect(() => {
    load()
  }, [load])

  const stats = board?.stats ?? { total_shots: 0, total_duration_sec: 0, total_scenes: 0 }
  const scenes = board?.scenes ?? []

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: theme.bg.canvas,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* stats bar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '10px 18px',
          background: theme.bg.panel,
          borderBottom: `1px solid ${theme.border.default}`,
          boxShadow: theme.shadow.card,
        }}
      >
        <button
          onClick={() => setViewMode('canvas')}
          style={backBtnStyle}
          title="返回画布"
        >
          ‹ 画布
        </button>
        <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: 14 }}>分镜板</span>
        <span style={{ width: 1, height: 16, background: theme.border.default }} />
        <Stat label="场景" value={stats.total_scenes} />
        <Stat label="镜头" value={stats.total_shots} />
        <Stat label="时长" value={fmtDuration(stats.total_duration_sec)} />
        <span style={{ flex: 1 }} />
        <button onClick={load} style={backBtnStyle} title="刷新">
          <UiIcon kind="iterate" size={13} />刷新
        </button>
      </div>

      {/* body */}
      <div style={{ padding: '16px 18px 32px', maxWidth: 1600, width: '100%', margin: '0 auto' }}>
        {loading ? (
          <Empty text="加载分镜板…" />
        ) : error ? (
          <Empty text={`加载失败：${error}`} />
        ) : scenes.length === 0 ? (
          <Empty text="暂无分镜板数据（等待 P10b 快速预览产出）" />
        ) : (
          scenes.map((sc, i) => (
            <SceneSection key={sc.scene_id || i} scene={sc} defaultOpen={i === 0} />
          ))
        )}
      </div>
    </div>
  )
}

const backBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  background: theme.bg.card,
  color: theme.text.secondary,
  border: `1px solid ${theme.border.default}`,
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: theme.text.primary }}>{value}</span>
      <span style={{ fontSize: 11, color: theme.text.tertiary }}>{label}</span>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '64px 0',
        textAlign: 'center',
        color: theme.text.tertiary,
        fontSize: 13,
      }}
    >
      {text}
    </div>
  )
}
