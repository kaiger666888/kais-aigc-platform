import { memo, useState, useRef, useCallback, useEffect } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { VideoNodeData, NodeState, RoutingDecision } from '../../types/canvas'
import { stateColors, getNodeBorderColor, getNodeContainerStyle } from '../../utils/styles'
import { theme } from '../../theme/catppuccin'
import { NODE_SIZES } from '../../constants'
import ScoreBadge from '../ScoreBadge'
import ReviewActionButtons from '../ReviewActionButtons'
import VariantBadge from '../VariantBadge'
import { useCanvasActions } from '../CanvasActionsContext'

type VideoNodeType = Node<VideoNodeData, 'video'>

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function VideoNodeComponent({ data, id }: NodeProps<VideoNodeType>) {
  const { approveNode, rejectNode } = useCanvasActions()
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const videoRef = useRef<HTMLVideoElement>(null)

  const videoSrc = (data.thumbnailUrl ?? data.filePath) as string | null

  const togglePlay = useCallback(() => {
    if (!videoRef.current || !videoSrc) return
    if (playing) {
      videoRef.current.pause()
      setPlaying(false)
    } else {
      videoRef.current.play()
      setPlaying(true)
    }
  }, [playing, videoSrc])

  const handleClose = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
    setPlaying(false)
    setCurrentTime(0)
  }, [])

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) setDuration(videoRef.current.duration)
  }, [])

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    videoRef.current.currentTime = ratio * duration
  }, [duration])

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    if (videoRef.current) videoRef.current.volume = v
  }, [])

  useEffect(() => {
    if (!playing && videoRef.current) {
      videoRef.current.pause()
    }
  }, [playing])

  return (
    <div style={{
      background: theme.bg.card,
      borderRadius: 8,
      border: `2px solid ${getNodeBorderColor(data)}`,
      padding: 12,
      width: NODE_SIZES.video.width,
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

      <Handle type="target" position={Position.Left} style={{ background: theme.handle.video, width: 8, height: 8 }} />

      <ReviewActionButtons
        reviewStatus={data.reviewStatus}
        onApprove={() => approveNode(id)}
        onReject={() => rejectNode(id)}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>🎥</span>
        <span style={{ fontWeight: 600 }}>视频</span>
        {data.duration != null && (
          <span style={{ fontSize: 10, color: theme.text.secondary }}>{data.duration as number}s</span>
        )}
        <StateBadge state={data.state} />
      </div>

      {/* 视频区域 */}
      <div style={{
        width: '100%', height: NODE_SIZES.video.thumbnailHeight,
        borderRadius: 4, overflow: 'hidden', background: theme.bg.panel,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', cursor: videoSrc && !playing ? 'pointer' : 'default',
      }}>
        {playing ? (
          <>
            <video
              ref={videoRef}
              src={videoSrc ?? undefined}
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={() => { setPlaying(false); setCurrentTime(0) }}
              autoPlay
            />
            {/* 关闭按钮 */}
            <button
              onClick={handleClose}
              style={{
                position: 'absolute', top: 4, right: 4, width: 22, height: 22,
                borderRadius: 11, border: 'none', background: 'rgba(0,0,0,0.6)',
                color: theme.text.primary, fontSize: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
              }}
            >
              ✕
            </button>
          </>
        ) : (
          <>
            {data.thumbnailUrl ? (
              <img src={data.thumbnailUrl as string} alt="video" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onClick={togglePlay} />
            ) : (
              <span style={{ color: theme.text.disabled, fontSize: 40 }}>▶</span>
            )}
            {videoSrc && (
              <div
                onClick={togglePlay}
                style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 20,
                  background: 'rgba(0,0,0,0.5)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none',
                }}>
                  <span style={{ color: '#fff', fontSize: 18, marginLeft: 2 }}>▶</span>
                </div>
              </div>
            )}
          </>
        )}
        {data.state === 'running' && !playing && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.chrome.videoOverlay }}>
            <div style={{ width: 36, height: 36, border: `3px solid ${theme.node.storyboard}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          </div>
        )}
      </div>

      {/* 播放控件 */}
      {playing && (
        <div style={{ marginTop: 6 }}>
          {/* 进度条 */}
          <div
            onClick={handleSeek}
            style={{
              width: '100%', height: 4, background: theme.bg.surface,
              borderRadius: 2, cursor: 'pointer', position: 'relative',
            }}
          >
            <div style={{
              width: duration ? `${(currentTime / duration) * 100}%` : '0%',
              height: '100%', background: theme.node.video,
              borderRadius: 2, transition: 'width 0.1s linear',
            }} />
          </div>
          {/* 时间 + 音量 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 10, color: theme.text.secondary }}>
              {formatTime(currentTime)} / {formatTime(duration || (data.duration as number) || 0)}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10 }}>{volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}</span>
              <input
                type="range" min={0} max={1} step={0.05}
                value={volume}
                onChange={handleVolumeChange}
                style={{ width: 40, height: 3, accentColor: theme.node.video }}
              />
            </div>
          </div>
        </div>
      )}

      <ScoreBadge score={data.aiScore?.overall as number | null | undefined} routingDecision={data.routingDecision as RoutingDecision | undefined} />

      <Handle type="source" position={Position.Right} style={{ background: theme.handle.video, width: 8, height: 8 }} />

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
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

export default memo(VideoNodeComponent)
