import { memo, useState, useRef, useCallback, useEffect } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { AudioNodeData, NodeState, RoutingDecision } from '../../types/canvas'
import { stateColors, getNodeBorderColor, getNodeContainerStyle } from '../../utils/styles'
import { theme } from '../../theme/catppuccin'
import { NODE_SIZES } from '../../constants'
import ScoreBadge from '../ScoreBadge'
import ReviewActionButtons from '../ReviewActionButtons'
import VariantBadge from '../VariantBadge'
import { useCanvasActions } from '../CanvasActionsContext'

type AudioNodeType = Node<AudioNodeData, 'audio'>

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const BAR_COUNT = 24

function AudioNodeComponent({ data, id }: NodeProps<AudioNodeType>) {
  const { approveNode, rejectNode } = useCanvasActions()
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(data.duration ?? 0)
  const audioRef = useRef<HTMLAudioElement>(null)

  const audioSrc = (data.filePath ?? data.thumbnailUrl) as string | null

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !audioSrc) return
    if (playing) {
      audioRef.current.pause()
      setPlaying(false)
    } else {
      audioRef.current.play()
      setPlaying(true)
    }
  }, [playing, audioSrc])

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime)
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) setDuration(audioRef.current.duration)
  }, [])

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audioRef.current.currentTime = ratio * duration
  }, [duration])

  useEffect(() => {
    if (!playing && audioRef.current) audioRef.current.pause()
  }, [playing])

  // Generate bar heights for waveform visualization
  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    const seed = ((data.audioId * 17 + i * 31) % 100) / 100
    return 0.2 + seed * 0.8
  })

  const progressRatio = duration ? currentTime / duration : 0

  return (
    <div style={{
      background: theme.bg.card,
      borderRadius: 8,
      border: `2px solid ${getNodeBorderColor(data)}`,
      padding: 12,
      width: NODE_SIZES.audio.width,
      color: theme.text.primary,
      fontSize: 12,
      position: 'relative',
      ...getNodeContainerStyle(data),
    }}>
      <VariantBadge
        variantIndex={data.variantIndex as number | undefined}
        isWinner={data.isWinner === true}
        isLoser={data.isWinner === false}
      />

      {data.isWinner === true && (
        <div style={{
          position: 'absolute', inset: -3, borderRadius: 10,
          border: `2px solid ${catppuccinGold}`, pointerEvents: 'none',
          boxShadow: `0 0 12px ${catppuccinGold}40`,
        }} />
      )}

      <Handle type="target" position={Position.Left} style={{ background: theme.handle.audio, width: 8, height: 8 }} />

      <ReviewActionButtons
        reviewStatus={data.reviewStatus}
        onApprove={() => approveNode(id)}
        onReject={() => rejectNode(id)}
      />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>🎵</span>
        <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.label as string}
        </span>
        {data.duration != null && (
          <span style={{ fontSize: 10, color: theme.text.secondary }}>{formatTime(data.duration as number)}</span>
        )}
        <StateBadge state={data.state} />
      </div>

      {/* Waveform visualization */}
      <div style={{
        width: '100%', height: 48, borderRadius: 4,
        background: theme.bg.panel, display: 'flex',
        alignItems: 'flex-end', justifyContent: 'center',
        gap: 2, padding: '4px 6px', marginBottom: 8,
        overflow: 'hidden',
      }}>
        {bars.map((h, i) => {
          const barProgress = i / BAR_COUNT
          const isPlayed = barProgress < progressRatio
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${h * 100}%`,
                minHeight: 3,
                borderRadius: 1,
                background: isPlayed ? theme.node.audio : theme.bg.surface,
                transition: 'background 0.1s',
                ...(playing ? { animation: `waveform-bar ${0.4 + h * 0.6}s ease-in-out ${i * 0.03}s infinite alternate` } : {}),
              }}
            />
          )
        })}
      </div>

      {/* Playback controls */}
      {audioSrc && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <button
            onClick={togglePlay}
            style={{
              width: 28, height: 28, borderRadius: 14,
              border: 'none', background: theme.node.audio,
              color: theme.text.onAccent, fontSize: 12,
              cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, padding: 0,
            }}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div
              onClick={handleSeek}
              style={{
                width: '100%', height: 4, background: theme.bg.surface,
                borderRadius: 2, cursor: 'pointer',
              }}
            >
              <div style={{
                width: `${progressRatio * 100}%`,
                height: '100%', background: theme.node.audio,
                borderRadius: 2, transition: 'width 0.1s linear',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 9, color: theme.text.secondary }}>{formatTime(currentTime)}</span>
              <span style={{ fontSize: 9, color: theme.text.secondary }}>{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      )}

      {!audioSrc && (
        <div style={{
          color: theme.text.disabled, fontSize: 10,
          textAlign: 'center', padding: '4px 0',
        }}>
          暂无音频文件
        </div>
      )}

      {/* Hidden audio element */}
      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={() => { setPlaying(false); setCurrentTime(0) }}
          preload="metadata"
        />
      )}

      <ScoreBadge score={data.aiScore?.overall as number | null | undefined} routingDecision={data.routingDecision as RoutingDecision | undefined} />

      <Handle type="source" position={Position.Right} style={{ background: theme.handle.audio, width: 8, height: 8 }} />

      <style>{`
        @keyframes waveform-bar {
          from { transform: scaleY(0.6); }
          to { transform: scaleY(1); }
        }
      `}</style>
    </div>
  )
}

const catppuccinGold = '#f9e2af'

function StateBadge({ state }: { state: NodeState }) {
  const labels: Record<NodeState, string> = { idle: '待处理', pending: '等待中', running: '生成中', success: '完成', error: '失败', cached: '已缓存' }
  return (
    <span style={{ marginLeft: 'auto', padding: '1px 6px', borderRadius: 4, fontSize: 10, background: stateColors[state], color: theme.text.onAccent, fontWeight: 600 }}>
      {labels[state]}
    </span>
  )
}

export default memo(AudioNodeComponent)
