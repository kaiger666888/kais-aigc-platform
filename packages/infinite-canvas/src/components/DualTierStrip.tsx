/**
 * src/components/DualTierStrip.tsx — 同轴双层时间轴总览带（预演 ⇄ 成品）。
 *
 * 挂在分镜时间轴视图统计栏下方。回答「预演版和成品版在同一时间轴里的关系」：
 *  - **镜列是唯一共享骨架**：两层按镜对齐，不按绝对时刻（H3 帧规则 n%17==5
 *    使终渲时长普遍 ≠ 分镜时长 —— 两层根本不同刻度，假装同刻度是错的）。
 *  - **共用预演秒比例尺**：成品层按预演比例尺画，比预演长多少 = 累计漂移的
 *    物理长度（下标尺终点越过上标尺终点）。
 *  - **镜界拉杆**：倾斜 = 该镜漂移（琥珀 = ≥0.3s 显著）；Δ 徽章 hover 出帧数。
 *  - 权威状态：预演层常带「权威 · 审片」；p12a 落 EDL 前成品层标「待终渲」。
 *
 * 数据全部派生自 TimedShot（分镜时长 durationS + 终渲时长 finalDurationS），
 * 无新 API。finalDurationS 缺失 = 该镜未终渲 → 成品层该镜垫入斜纹占位、无拉杆。
 * 纯函数 computeTierLayout 导出供单测（漂移/累计/坐标几何）。
 */

import { memo, useMemo, useRef, useState } from 'react'
import { theme, v3theme } from '../theme/catppuccin'
import type { StoryboardShot, TimedShot } from './StoryboardTimeline'

// ─── 纯布局计算（导出供单测） ─────────────────────────────

export interface TierShotLayout {
  shotId: string
  nodeId: string
  /** 预演（分镜）时长与起点（秒，全片累计）。 */
  previewDur: number
  previewStart: number
  /** 终渲实测时长（秒）——undefined = 未终渲。 */
  finalDur?: number
  /** 成品层带内位置：实测优先，未渲镜以预演时长**预估**占位（连续时间轴，两套坐标不打架）。 */
  bandDur: number
  bandStart: number
  /** 已终渲 = true（斜纹占位 / 拉杆 / Δ 徽章的区分依据）。 */
  rendered: boolean
  /** 漂移（终渲 - 分镜）——undefined = 未终渲/分镜时长缺失。 */
  delta?: number
}

export interface TierLayout {
  shots: TierShotLayout[]
  totalPreview: number
  /** 成品层带总长 = 已渲实测 + 未渲预估（预估=预演时长，贡献 0 漂移）。 */
  totalFinal: number
  /** 有终渲时长的镜数。 */
  finalCount: number
  /** |Δ|≥0.3s 的镜数。 */
  driftBig: number
  /** 累计漂移（秒）= Σ(实测终渲 - 分镜)，预估段恒贡献 0。 */
  totalDrift: number
  thumbnails: (string | null)[]
}

const DRIFT_BIG_SEC = 0.3

export function computeTierLayout(shots: readonly TimedShot[]): TierLayout {
  let cumP = 0
  let cumF = 0
  const out: TierShotLayout[] = []
  const thumbnails: (string | null)[] = []
  let finalCount = 0
  let driftBig = 0
  let totalDrift = 0
  for (const s of shots) {
    const previewDur = s.layoutDur > 0 ? s.layoutDur : 0
    const raw = (s as StoryboardShot & { finalDurationS?: number }).finalDurationS
    const finalDur = typeof raw === 'number' && isFinite(raw) && raw > 0 ? raw : undefined
    const rendered = finalDur != null
    // 成品层带：实测优先；未渲镜以预演时长预估占位（保证层带连续、坐标自洽）
    const bandDur = finalDur ?? previewDur
    const delta = finalDur != null && previewDur > 0 ? finalDur - previewDur : undefined
    out.push({
      shotId: s.shotId,
      nodeId: s.node.id,
      previewDur,
      previewStart: cumP,
      finalDur,
      bandDur,
      bandStart: cumF,
      rendered,
      delta,
    })
    thumbnails.push(s.firstFrame ?? s.thumbnail ?? null)
    cumP += previewDur
    cumF += bandDur
    if (rendered) {
      finalCount++
      totalDrift += finalDur! - previewDur
      if (delta != null && Math.abs(delta) >= DRIFT_BIG_SEC) driftBig++
    }
  }
  return {
    shots: out,
    totalPreview: cumP,
    totalFinal: cumF,
    finalCount,
    driftBig,
    totalDrift,
    thumbnails,
  }
}

// ─── 组件 ─────────────────────────────────────────────

type TierMode = 'dual' | 'preview' | 'final'

export interface DualTierStripProps {
  shots: TimedShot[]
  /** 当前选中镜（分镜列表/播放器联动）。 */
  selectedNodeId: string | null
  onSelectShot: (shot: StoryboardShot) => void
}

const TIER_H = 58          // 每层段高
const RULER_H = 18         // 标尺高
const SPINE_H = 34         // 脊柱（拉杆 + Δ 徽章）高
const STRIP_PAD = 24       // 右侧呼吸（末段 hover 徽章不裁）
const fmtc = (t: number) => {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function DualTierStripImpl({ shots, selectedNodeId, onSelectShot }: DualTierStripProps): React.ReactElement | null {
  const layout = useMemo(() => computeTierLayout(shots), [shots])
  const [mode, setMode] = useState<TierMode>('dual')
  const scrollRef = useRef<HTMLDivElement>(null)

  if (layout.shots.length === 0 || layout.totalPreview <= 0) return null

  // 共用预演秒比例尺：成品层（已渲镜）按同比例尺画 → 累计漂移 = 物理溢出
  const pxPerSec = Math.max(4.5, ((scrollRef.current?.clientWidth ?? 1200) - STRIP_PAD) / layout.totalPreview)
  const stripW = Math.max(layout.totalPreview, layout.totalFinal) * pxPerSec + STRIP_PAD
  const yRulerP = 0
  const yTierP = RULER_H
  const ySpine = yTierP + TIER_H
  const yTierF = ySpine + SPINE_H
  const yRulerF = yTierF + TIER_H
  const totalH = yRulerF + RULER_H

  const dimP = mode === 'final'
  const dimF = mode === 'preview'

  // 双标尺刻度（每 5s 短 / 30s 标数）
  const rulerTicks = (total: number, color: string, y: number, top: boolean) => {
    if (total <= 0) return null
    const ticks: React.ReactNode[] = []
    const labels: React.ReactNode[] = []
    for (let t = 0; t <= total; t += 5) {
      const x = t * pxPerSec
      const maj = t % 30 === 0
      ticks.push(
        <span key={`t${y}-${t}`} style={{
          position: 'absolute', left: x, [top ? 'top' : 'bottom']: 0,
          width: 1, height: maj ? 8 : 4, background: color, opacity: 0.55,
        }} />,
      )
      if (maj && t < total - 10) {
        labels.push(
          <span key={`l${y}-${t}`} style={{
            position: 'absolute', left: x, transform: 'translateX(-50%)',
            [top ? 'top' : 'bottom']: 0,
            fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 9,
            letterSpacing: '0.08em', color, opacity: 0.8, whiteSpace: 'nowrap',
          }}>{fmtc(t)}</span>,
        )
      }
    }
    return <>{ticks}{labels}</>
  }

  return (
    <div style={{
      flex: 'none', borderBottom: `1px solid ${theme.border.default}`,
      background: v3theme.surface.canvas,
    }} data-testid="dual-tier-strip">
      {/* 头：标题 + 层显 + 漂移账 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '6px 16px 2px',
        fontSize: 11, color: theme.text.tertiary, whiteSpace: 'nowrap', overflow: 'hidden',
      }}>
        <span style={{ color: theme.text.secondary, fontWeight: 600, letterSpacing: '0.05em' }}>
          双层时间轴
        </span>
        <span>上 预演 {fmtc(layout.totalPreview)}</span>
        <span style={{ color: v3theme.modality.video }}>
          下 成品 {layout.finalCount > 0
            ? `${fmtc(layout.totalFinal)}（已渲 ${layout.finalCount}/${layout.shots.length}）`
            : '待终渲'}
        </span>
        <span style={{ display: 'inline-flex', gap: 2, padding: 1, borderRadius: 6, background: v3theme.surface.card }}>
          {([['preview', '预演'], ['dual', '双层'], ['final', '成片']] as const).map(([m, lab]) => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '1px 10px', borderRadius: 5, fontSize: 11,
              color: mode === m ? theme.text.primary : theme.text.tertiary,
              background: mode === m ? v3theme.surface.elevated : 'transparent',
              fontWeight: mode === m ? 600 : 400,
            }}>{lab}</button>
          ))}
        </span>
        {layout.finalCount > 0 && (
          <span>
            漂移{' '}
            <b style={{ color: v3theme.signal.stale, fontFamily: 'var(--cv-font-mono, monospace)', fontWeight: 500 }}>
              {layout.driftBig}/{layout.finalCount} 镜 ≥{DRIFT_BIG_SEC}s
            </b>
            {layout.totalDrift !== 0 && (
              <>
                {' · 累计 '}
                <b style={{ color: v3theme.signal.stale, fontFamily: 'var(--cv-font-mono, monospace)', fontWeight: 500 }}>
                  {layout.totalDrift > 0 ? '+' : ''}{layout.totalDrift.toFixed(1)}s
                </b>
              </>
            )}
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: theme.text.disabled }}>
          镜列对齐 · 拉杆倾斜 = 漂移 · 点镜选中
        </span>
      </div>

      {/* 片条本体 */}
      <div
        ref={scrollRef}
        style={{ overflowX: 'auto', overscrollBehaviorX: 'contain', cursor: 'pointer' }}
        role="listbox" aria-label="双层时间轴"
      >
        <div style={{ position: 'relative', width: stripW, height: totalH, margin: '0 12px' }}>
          {/* 上标尺（预演 · 青）*/}
          <div style={{ position: 'absolute', left: 0, right: 0, top: yRulerP, height: RULER_H, borderBottom: `1px solid ${theme.border.default}` }}>
            {rulerTicks(layout.totalPreview, v3theme.modality.image, yRulerP, true)}
          </div>
          {/* 下标尺（成品 · 玫）——无终渲时给空态说明而非空刻度 */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: yRulerF, height: RULER_H, borderTop: `1px solid ${theme.border.default}` }}>
            {layout.finalCount > 0
              ? rulerTicks(layout.totalFinal, v3theme.modality.video, yRulerF, false)
              : (
                <span style={{
                  position: 'absolute', left: 8, top: 2,
                  fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 9,
                  letterSpacing: '0.1em', color: theme.text.disabled,
                }}>成品刻度待 p11b 终渲</span>
              )}
          </div>

          {/* 脊柱中线 */}
          <div style={{
            position: 'absolute', left: 0, right: 0, top: ySpine + SPINE_H / 2,
            borderTop: `1px dashed rgba(255,255,255,0.08)`,
          }} />

          {layout.shots.map((s, i) => {
            const thumb = layout.thumbnails[i]
            const wp = Math.max(s.previewDur * pxPerSec - 2, 7)
            // 成品层带连续时间轴：已渲实测宽 / 未渲预估宽（=预演宽，斜纹）
            const wf = Math.max(s.bandDur * pxPerSec - 2, 7)
            const xf = s.bandStart * pxPerSec
            const xp = s.previewStart * pxPerSec
            const selected = s.nodeId === selectedNodeId
            const shot = shots[i]
            return (
              <div key={s.nodeId}>
                {/* 预演层段 */}
                <button
                  role="option" aria-selected={selected}
                  onClick={() => onSelectShot(shot)}
                  title={`${s.shotId} · 预演 ${s.previewDur.toFixed(1)}s`}
                  style={{
                    position: 'absolute', left: xp, top: yTierP, width: wp, height: TIER_H,
                    borderRadius: 4, overflow: 'hidden', padding: 0, cursor: 'pointer',
                    background: thumb ? undefined : v3theme.surface.card,
                    backgroundImage: thumb ? `url(${thumb})` : undefined,
                    backgroundSize: 'cover', backgroundPosition: 'center',
                    opacity: dimP ? 0.16 : 1,
                    filter: dimP ? 'saturate(0.3)' : undefined,
                    boxShadow: selected
                      ? '0 0 0 1.5px rgba(237,238,241,0.9), 0 0 10px rgba(237,238,241,0.2)'
                      : '0 0 0 1px rgba(255,255,255,0.05) inset',
                    border: 'none', textAlign: 'left',
                  }}
                >
                  {/* 审核判定下缘：rejected=玫 / approved=青 / 待审=弱灰（同统计栏词汇） */}
                  <span style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0, height: 3,
                    background: shot.node.reviewStatus === 'rejected'
                      ? v3theme.signal.rejected
                      : shot.node.reviewStatus === 'approved'
                        ? v3theme.signal.approved
                        : 'rgba(255,255,255,0.25)',
                    opacity: shot.node.reviewStatus ? 1 : 0.6,
                  }} />
                </button>

                {/* 成品层段：已渲 = 首帧+玫调；未渲 = 斜纹占位（宽度=预演宽，无漂移语义） */}
                <button
                  role="option" aria-selected={selected}
                  onClick={() => onSelectShot(shot)}
                  title={s.rendered
                    ? `${s.shotId} · 成品 ${s.finalDur?.toFixed(3)}s（Δ${(s.delta ?? 0) >= 0 ? '+' : ''}${(s.delta ?? 0).toFixed(2)}s）`
                    : `${s.shotId} · 待终渲（预估占位）`}
                  style={{
                    position: 'absolute', left: xf, top: yTierF, width: wf, height: TIER_H,
                    borderRadius: 4, overflow: 'hidden', padding: 0, cursor: 'pointer',
                    opacity: dimF ? 0.16 : 1,
                    filter: dimF ? 'saturate(0.3)' : undefined,
                    boxShadow: selected
                      ? '0 0 0 1.5px rgba(237,238,241,0.9), 0 0 10px rgba(237,238,241,0.2)'
                      : '0 0 0 1px rgba(255,255,255,0.05) inset',
                    border: 'none', textAlign: 'left',
                    ...(s.rendered
                      ? {
                          background: thumb ? undefined : v3theme.surface.card,
                          backgroundImage: thumb
                            ? `linear-gradient(180deg, rgba(221,106,130,0.12), rgba(221,106,130,0.02)), url(${thumb})`
                            : undefined,
                          backgroundSize: 'cover', backgroundPosition: 'center',
                        }
                      : {
                          background:
                            'repeating-linear-gradient(-45deg, #14161c 0 6px, #1a1d24 6px 12px)',
                        }),
                  }}
                />

                {/* 镜界拉杆：预演右缘 → 成品右缘（共用比例尺，倾斜=漂移） */}
                {s.rendered && Math.abs(s.delta ?? 0) < 60 && (() => {
                  const x1 = xp + wp
                  const x2 = xf + wf
                  const dx = x2 - x1
                  const len = Math.sqrt(dx * dx + SPINE_H * SPINE_H)
                  const ang = (Math.atan2(dx, SPINE_H) * 180) / Math.PI
                  const big = Math.abs(s.delta ?? 0) >= DRIFT_BIG_SEC
                  return (
                    <span style={{
                      position: 'absolute', left: x1, top: ySpine,
                      width: big ? 2 : 1.5, height: len,
                      transformOrigin: 'top left', transform: `rotate(${ang}deg)`,
                      background: big
                        ? v3theme.signal.stale
                        : `linear-gradient(180deg, ${v3theme.modality.image}, ${v3theme.modality.video})`,
                      opacity: big ? 0.8 : 0.55, pointerEvents: 'none',
                    }} />
                  )
                })()}

                {/* Δ 徽章（显著漂移或隔镜抽样） */}
                {s.rendered && s.delta != null && (Math.abs(s.delta) >= DRIFT_BIG_SEC || i % 4 === 0) && (
                  <span
                    title={`${s.shotId} 预演 ${s.previewDur.toFixed(1)}s → 成品 ${s.finalDur?.toFixed(3)}s`}
                    style={{
                      position: 'absolute',
                      left: (xp + wp + xf + wf) / 2,
                      top: ySpine + SPINE_H / 2 - 6,
                      transform: 'translateX(-50%)',
                      fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 9,
                      color: Math.abs(s.delta) >= DRIFT_BIG_SEC ? v3theme.signal.stale : theme.text.tertiary,
                      background: 'rgba(10,11,14,0.85)', borderRadius: 3, padding: '0 4px',
                      pointerEvents: 'auto', cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                    onClick={() => onSelectShot(shot)}
                  >
                    {(s.delta >= 0 ? '+' : '') + s.delta.toFixed(2)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const DualTierStrip = memo(DualTierStripImpl)
export default DualTierStrip
