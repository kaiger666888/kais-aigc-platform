/**
 * VoiceProfileBoard.tsx — 音色试听两级(Phase 56-04 / VIZ-02,D-08)。
 *
 * 左列声纹卡 mini ▶(点即播再点停,模块级单 audio——新卡先停旧卡);
 * 右侧完整播放器(audioPeaks 波形 canvas 72px + 时长 + 播放/暂停 + 可拖
 * 光标;DialoguePanel 同构)。伪波形角落注记。
 */
import { useEffect, useRef, useState } from 'react'
import { theme, v3theme } from '../../theme/catppuccin'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import { resolvePeaks } from '../../utils/audioPeaks'

/** 模块级单 audio:同时至多一条在播(T-56-04-04)。 */
let sharedMiniAudio: HTMLAudioElement | null = null

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function stopMini(): void {
  if (sharedMiniAudio != null) {
    sharedMiniAudio.pause()
    sharedMiniAudio = null
  }
}

export default function VoiceProfileBoard({ profiles }: {
  profiles: Array<{ nodeId: string; label: string; characterId?: string; filePath?: string; thumbnailUrl?: string }>;
}): React.ReactElement {
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>(profiles[0]?.nodeId ?? '')
  const selected = profiles.find((p) => p.nodeId === selectedId) ?? profiles[0]
  const selectedUrl = selected != null ? resolveMediaUrl(selected.filePath ?? selected.thumbnailUrl) : null

  // ── mini ▶(左列) ──
  const toggleMini = (p: { nodeId: string; filePath?: string; thumbnailUrl?: string }) => {
    const url = resolveMediaUrl(p.filePath ?? p.thumbnailUrl)
    if (url == null) return
    if (playingId === p.nodeId) {
      stopMini()
      setPlayingId(null)
      return
    }
    stopMini()
    const a = new Audio(url)
    a.onended = () => setPlayingId(null)
    void a.play().catch(() => setPlayingId(null))
    sharedMiniAudio = a
    setPlayingId(p.nodeId)
  }

  // ── 完整播放器(右侧) ──
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [peaks, setPeaks] = useState<{ kind: 'real' | 'pseudo'; peaks: number[] } | null>(null)

  useEffect(() => {
    if (selectedUrl == null) return
    let cancelled = false
    setPeaks(null)
    setCurrentTime(0)
    setPlaying(false)
    void resolvePeaks(selectedUrl, { buckets: 96 }).then((r) => { if (!cancelled) setPeaks(r) })
    return () => { cancelled = true }
  }, [selectedUrl])

  // 波形绘制(已播 audio 橙全不透明/未播 0.35;光标 1.5px)
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (canvas == null || container == null) return
    const dpr = window.devicePixelRatio || 1
    const w = container.clientWidth
    const h = 72
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (ctx == null) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const arr = peaks?.peaks
    if (arr == null || arr.length === 0) return
    const playedFrac = duration > 0 ? Math.min(1, currentTime / duration) : 0
    const barW = w / arr.length
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]!
      const barH = Math.max(1, v * (h - 8))
      ctx.fillStyle = v3theme.modality.audio
      ctx.globalAlpha = i / arr.length <= playedFrac ? 1 : 0.35
      ctx.fillRect(i * barW, (h - barH) / 2, Math.max(1, barW - 1), barH)
    }
    ctx.globalAlpha = 1
    if (duration > 0) {
      ctx.fillStyle = v3theme.signal.select
      ctx.fillRect(playedFrac * w, 0, 1.5, h)
    }
  }, [peaks, currentTime, duration])

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current
    const container = containerRef.current
    if (a == null || container == null || duration <= 0) return
    const r = container.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    a.currentTime = ratio * duration
    setCurrentTime(a.currentTime)
  }

  if (profiles.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.text.secondary, fontSize: 12 }}>
        未找到同族资产
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, padding: 16 }}>
      {/* 左列:声纹卡 */}
      <div style={{ width: 'min(320px, 26vw)', display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
        {profiles.map((p) => {
          const url = resolveMediaUrl(p.filePath ?? p.thumbnailUrl)
          const isSelected = p.nodeId === selectedId
          return (
            <div
              key={p.nodeId}
              onClick={() => setSelectedId(p.nodeId)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer',
                background: theme.bg.card, borderRadius: 8,
                border: `1px solid ${isSelected ? v3theme.signal.select : theme.border.default}`,
              }}
            >
              <button
                onClick={(e) => { e.stopPropagation(); toggleMini(p) }}
                disabled={url == null}
                title={playingId === p.nodeId ? '停止试听' : '试听'}
                style={{ width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', background: playingId === p.nodeId ? v3theme.signal.select : theme.bg.panel, color: playingId === p.nodeId ? v3theme.surface.canvas : theme.text.primary, fontSize: 11, flexShrink: 0 }}
              >
                {playingId === p.nodeId ? '⏸' : '▶'}
              </button>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, color: theme.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</div>
                {p.characterId != null && <div style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 10, color: theme.text.tertiary }}>声纹 {p.characterId}</div>}
              </div>
            </div>
          )
        })}
      </div>

      {/* 右侧:完整播放器 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
        {selectedUrl != null ? (
          <>
            <audio
              ref={audioRef}
              src={selectedUrl}
              preload="metadata"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onEnded={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => {
                  const a = audioRef.current
                  if (a == null) return
                  if (a.paused) void a.play().catch(() => undefined)
                  else a.pause()
                }}
                style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer', background: v3theme.signal.select, color: v3theme.surface.canvas, fontSize: 13 }}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 11, color: theme.text.secondary, fontVariantNumeric: 'tabular-nums' }}>
                {fmt(currentTime)} / {fmt(duration)}
              </span>
            </div>
            <div ref={containerRef} onClick={onSeek} style={{ position: 'relative', width: '100%', height: 72, cursor: 'pointer' }}>
              <canvas ref={canvasRef} style={{ display: 'block' }} />
              {peaks == null && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: theme.text.tertiary }}>波形加载中…</span>}
              {peaks?.kind === 'pseudo' && (
                <span style={{ position: 'absolute', right: 4, top: 2, fontSize: 10, color: theme.text.tertiary }}>伪波形</span>
              )}
            </div>
          </>
        ) : (
          <div style={{ color: theme.text.secondary, fontSize: 12 }}>该条目无音频 URL</div>
        )}
      </div>
    </div>
  )
}
