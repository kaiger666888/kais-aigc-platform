/**
 * G16VoiceWorkbench.tsx — G16 配音听审工作台(Phase 56-05 / VIZ-03,D-09/10/12)。
 *
 * TheaterShell 审核变体:左条目列表(勾选+shot_id mono+说话人+similarity+
 * verdict 徽章,28px 行) + 右双轨(波形 72px canvas × 转写分句等时近似
 * 对齐——共享光标贯穿两轨,签名元素) + 底部 sticky 动作条(已选 N/全选/
 * 清空/重听/连播 toggle/批量豁免)。批量豁免走 g15Ops(action:'waive',
 * gate:'p10c-gate')(D-11);乐观 markWaived → 失败回滚+toast(G15 文法)。
 *
 * 连播(D-12):首次须用户手势(toggle 点击/空格即手势;onended 链内后续
 * play 属手势链,autoplay 策略满足);光标 = onTimeUpdate(React 批处理节流,
 * 56-RESEARCH 终裁:不引 rAF 镜像)。键盘 空格/→/←/Esc(useVoiceKeyboard)。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVoiceAuditStore, graphVoiceAuditSource } from './voiceAuditStore'
import { useVoiceKeyboard } from './useVoiceKeyboard'
import TheaterShell, { theaterBtnStyle } from '../theater/TheaterShell'
import { useCanvasStore } from '../../store/canvasStore'
import { g15Ops } from '../../services/canvasApi'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import { resolvePeaks } from '../../utils/audioPeaks'
import { splitSentences, evenAlign, sentenceAt } from '../../utils/transcriptAlign'
import { verdictLabel } from '../../utils/scoreVocabulary'
import { theme, v3theme } from '../../theme/catppuccin'

const VERDICT_COLOR: Record<string, string> = {
  pass: v3theme.signal.approved,
  warn: v3theme.signal.running,
  fail: v3theme.signal.rejected,
}

export default function G16VoiceWorkbench(): React.ReactElement | null {
  const open = useVoiceAuditStore((s) => s.open)
  const rows = useVoiceAuditStore((s) => s.rows)
  const selected = useVoiceAuditStore((s) => s.selected)
  const rowState = useVoiceAuditStore((s) => s.rowState)
  const currentIndex = useVoiceAuditStore((s) => s.currentIndex)
  const autoPlay = useVoiceAuditStore((s) => s.autoPlay)
  const setOpen = useVoiceAuditStore((s) => s.setOpen)
  const setSource = useVoiceAuditStore((s) => s.setSource)
  const loaded = useVoiceAuditStore((s) => s.loaded)
  const graph = useCanvasStore((s) => s.graph)
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)
  const showToast = useCanvasStore((s) => s.showToast)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)

  // 真实源 seam:打开时按当前 graph/raw 注入(Wave A fixture 是缺省;画布有
  // voice-audit 节点则换真实源——零面板改动)。打开动作时序效应先于 open 效应:
  // openGate 封装「注源 → setOpen(true)」(store.setOpen 的 open-且-未加载懒
  // 触发必须在源就位后,否则 fixture 先行覆盖)。
  const openGate = () => {
    if (graph != null && rawDataByNodeId != null) {
      setSource(graphVoiceAuditSource(graph, rawDataByNodeId))
    }
    setOpen(true)
  }
  useEffect(() => {
    // 打开的瞬时时机:open 变 true 后源再注入仍为 fixture——source 注入必须
    // 在打开前。此 effect 只做「open 真 + 源仍 fixture 且有 graph」的补注
    // (用户经 GateCenterBlock p10c 行直开 store 的旁路)。
    if (!open) return
    const s = useVoiceAuditStore.getState()
    if (graph != null && rawDataByNodeId != null && s.rows.every((r) => r.id.startsWith('S01_') || r.id.startsWith('S02_') || r.id.startsWith('S03_'))) {
      // fixture 签名(S01/S02/S03 五样本)时换真实源
      const real = graphVoiceAuditSource(graph, rawDataByNodeId)
      setSource(real)
      void s.load()
    }
  }, [open, graph, rawDataByNodeId, setSource])

  const clip = rows[currentIndex] ?? null
  const url = clip != null && clip.path !== '' ? resolveMediaUrl(clip.path) : null

  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [peaks, setPeaks] = useState<{ kind: 'real' | 'pseudo'; peaks: number[] } | null>(null)

  const sentences = useMemo(() => splitSentences(clip?.transcript ?? ''), [clip?.transcript])
  const spans = useMemo(() => evenAlign(sentences, duration), [sentences, duration])
  const activeSentence = useMemo(() => sentenceAt(spans, currentTime), [spans, currentTime])

  // 波形懒解析(选中才解码)
  useEffect(() => {
    if (url == null) return
    let cancelled = false
    setPeaks(null)
    void resolvePeaks(url, { buckets: 96 }).then((r) => { if (!cancelled) setPeaks(r) })
    return () => { cancelled = true }
  }, [url])

  // 波形绘制(已播 approved 色全不透明/未播 0.35;1.5px 光标)
  useEffect(() => {
    const canvas = canvasRef.current
    const container = trackRef.current
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
    const frac = duration > 0 ? Math.min(1, currentTime / duration) : 0
    const barW = w / arr.length
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]!
      const barH = Math.max(1, v * (h - 8))
      ctx.fillStyle = v3theme.modality.audio
      ctx.globalAlpha = i / arr.length <= frac ? 1 : 0.35
      ctx.fillRect(i * barW, (h - barH) / 2, Math.max(1, barW - 1), barH)
    }
    ctx.globalAlpha = 1
    if (duration > 0) {
      ctx.fillStyle = v3theme.signal.select
      ctx.fillRect(frac * w, 0, 1.5, h)
    }
  }, [peaks, currentTime, duration])

  const playAt = (i: number, startSec = 0) => {
    const store = useVoiceAuditStore.getState()
    store.setCurrentIndex(i)
    setCurrentTime(startSec)
    window.setTimeout(() => {
      const a = audioRef.current
      if (a == null) return
      a.currentTime = startSec
      void a.play().catch(() => undefined)
    }, 0)
  }

  const togglePlay = () => {
    const a = audioRef.current
    if (a == null || clip == null) return
    if (a.paused) void a.play().catch(() => undefined)
    else a.pause()
  }

  const nextPending = useVoiceAuditStore((s) => s.nextPending)
  const playNext = () => {
    const i = nextPending(currentIndex)
    if (i != null) playAt(i)
  }
  const playPrev = () => {
    if (currentIndex > 0) playAt(currentIndex - 1)
  }

  const runWaive = async () => {
    const store = useVoiceAuditStore.getState()
    const ids = [...store.selected]
    if (ids.length === 0 || projectId == null || episodesId == null) return
    store.markWaived(ids)
    try {
      const shotIds = ids.map((id) => store.rows.find((r) => r.id === id)?.shotId ?? id)
      const r = await g15Ops(projectId, episodesId, 'waive', shotIds, undefined, 'p10c-gate')
      // WBX-03:delivered=false = 桥未送达(端点 404/超时),仅入重试队列——
      // 不是成功。回滚乐观标记,toast 如实告知;通道恢复前豁免不会生效。
      if (!r.delivered) {
        useVoiceAuditStore.getState().unmark(ids)
        showToast(
          r.queued > 0
            ? `未送达（已入重试队列）——豁免尚未生效，恢复后再试`
            : '豁免未送达且入队失败，请重试',
          'error',
        )
        return
      }
      showToast(`已豁免 ${ids.length} 条（p10c 配音听审）`, 'success')
    } catch {
      useVoiceAuditStore.getState().unmark(ids)
      showToast('豁免失败，已回滚——请重试', 'error')
    }
  }

  useVoiceKeyboard(open, {
    onTogglePlay: togglePlay,
    onNext: playNext,
    onPrev: playPrev,
    onClose: () => setOpen(false),
  })

  if (!open) return null

  const selectedCount = selected.size
  const waivedCount = [...rowState.values()].filter((v) => v === 'waived').length

  return (
    <TheaterShell
      title={`配音听审 · ${rows.length} 条`}
      icon="🎤"
      onClose={() => setOpen(false)}
      headerExtra={
        <button
          onClick={() => useVoiceAuditStore.getState().setAutoPlay(!autoPlay)}
          style={theaterBtnStyle(autoPlay)}
          title="连播:播完自动下一条(跳过已豁免)"
        >
          {autoPlay ? '⏸ 连播中' : '▶ 连播'}
        </button>
      }
    >
      <div style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* 左条目列表 */}
          <div style={{ width: 'min(380px, 30vw)', borderRight: `1px solid ${theme.border.default}`, overflowY: 'auto', flexShrink: 0 }}>
            {rows.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: theme.text.secondary, fontSize: 11 }}>
                {loaded ? '本集无配音听审条目' : '载入中…'}
              </div>
            )}
            {rows.map((r, i) => {
              const waived = rowState.get(r.id) === 'waived'
              const isCurrent = i === currentIndex
              return (
                <div
                  key={r.id}
                  onClick={() => playAt(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, minHeight: 28, padding: '6px 10px', cursor: 'pointer',
                    background: isCurrent ? 'rgba(237,238,241,0.08)' : 'none',
                    borderLeft: `2px solid ${isCurrent ? v3theme.signal.select : 'transparent'}`,
                    borderBottom: '1px solid var(--cv-line-panel, rgba(255,255,255,0.04))',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => useVoiceAuditStore.getState().toggle(r.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ flexShrink: 0 }}
                  />
                  <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 11, color: theme.text.primary }}>{r.shotId}</span>
                  <span style={{ fontSize: 10, color: theme.text.tertiary }}>{r.speaker ?? '—'}</span>
                  {r.similarity != null && (
                    <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 10, color: theme.text.tertiary, fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(r.similarity * 100)}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: VERDICT_COLOR[r.verdict] ?? theme.text.secondary }}>
                    {verdictLabel(r.verdict)}
                  </span>
                  {waived && <span style={{ fontSize: 10, color: theme.text.tertiary }}>已豁免</span>}
                </div>
              )
            })}
          </div>

          {/* 右双轨区 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 16, gap: 10 }}>
            {clip != null && url != null ? (
              <>
                <audio
                  ref={audioRef}
                  src={url}
                  preload="metadata"
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => {
                    setPlaying(false)
                    if (autoPlay) playNext()
                  }}
                />
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', right: 0, top: -2, fontSize: 10, color: theme.text.tertiary, zIndex: 2 }}>
                    分句按等时近似对齐
                  </span>
                  <div ref={trackRef} style={{ width: '100%', height: 72 }}>
                    <canvas ref={canvasRef} style={{ display: 'block' }} />
                    {peaks == null && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: theme.text.tertiary }}>波形加载中…</span>}
                    {peaks?.kind === 'pseudo' && <span style={{ position: 'absolute', left: 4, top: 2, fontSize: 10, color: theme.text.tertiary }}>伪波形</span>}
                  </div>
                </div>
                {/* 下轨:转写分句(点句按比例 seek) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {spans.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        const a = audioRef.current
                        if (a == null || duration <= 0) return
                        a.currentTime = s.start
                        setCurrentTime(s.start)
                        if (!playing) void a.play().catch(() => undefined)
                      }}
                      style={{
                        textAlign: 'left', padding: '4px 8px', cursor: 'pointer',
                        background: i === activeSentence ? 'rgba(237,238,241,0.08)' : 'none',
                        border: 'none', borderLeft: `2px solid ${i === activeSentence ? v3theme.signal.select : 'transparent'}`,
                        borderRadius: 4, fontSize: 11,
                        color: i === activeSentence ? theme.text.primary : theme.text.secondary,
                        fontFamily: 'inherit',
                      }}
                    >
                      {s.text}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.text.secondary, fontSize: 12 }}>
                选择左侧条目开始听审
              </div>
            )}
          </div>
        </div>

        {/* 底部动作条(sticky) */}
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--cv-bg-panel)', borderTop: `1px solid ${theme.border.default}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: theme.text.secondary }}>已选 {selectedCount}</span>
          <button style={theaterBtnStyle(false)} onClick={() => useVoiceAuditStore.getState().selectAll()}>全选</button>
          <button style={theaterBtnStyle(false)} onClick={() => useVoiceAuditStore.getState().clear()}>清空</button>
          <button
            style={theaterBtnStyle(false)}
            onClick={() => {
              const a = audioRef.current
              if (a == null) return
              a.currentTime = 0
              setCurrentTime(0)
              void a.play().catch(() => undefined)
            }}
            disabled={clip == null}
          >
            重听
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: theme.text.tertiary }}>已豁免 {waivedCount}</span>
          <button
            style={{ ...theaterBtnStyle(false), border: `1px solid ${v3theme.signal.locked}`, color: v3theme.signal.locked }}
            onClick={() => void runWaive()}
            disabled={selectedCount === 0}
            title="对选中条目批量豁免(写回 p10c-gate)"
          >
            批量豁免
          </button>
        </div>
      </div>
    </TheaterShell>
  )
}
