/**
 * TurnaroundView.tsx — 角色 turnaround 2×2 同步缩放(Phase 56-04 / VIZ-02,D-06)。
 *
 * 签名元素 = 同步缩放:四格共享 scale [1.0,4.0](wheel ±0.1 / 头栏 ＋－复位 /
 * 双击复位;hover 格 transformOrigin 跟光标,其余 50% 50%;wheel 无 transition
 * 跟手,按钮 120ms)。中央 chip 纯展示(参考图 48px + 角色名 + 套系 + 一致性分
 * 透传——D-16 不计算)。scale state 受控提在 GroupViewTheater。
 */
import { useRef, useState } from 'react'
import { theme, v3theme, getScoreColor } from '../../theme/catppuccin'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import { viewLabel } from '../../utils/scoreVocabulary'
import type { MemberAsset } from './groupMembership'

export const TURNAROUND_SCALE_MAX = 4
export const TURNAROUND_SCALE_MIN = 1

export default function TurnaroundView({ slots, center, scale, onScaleChange }: {
  slots: Array<MemberAsset | null>;
  center: { refUrl?: string; name: string; costumeName?: string; consistency?: number };
  scale: number;
  onScaleChange: (s: number) => void;
}): React.ReactElement {
  const [hoverCell, setHoverCell] = useState<{ idx: number; origin: string } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const clampScale = (s: number) => Math.min(TURNAROUND_SCALE_MAX, Math.max(TURNAROUND_SCALE_MIN, s))

  const onWheel = (e: React.WheelEvent) => {
    // 滚轮缩放步进 0.1(粗粒度天然节流;无 transition 跟手)
    onScaleChange(clampScale(scale + (e.deltaY < 0 ? 0.1 : -0.1)))
  }

  return (
    <div
      ref={gridRef}
      onWheel={onWheel}
      style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(280px, 1fr))', gap: 12, width: 'min(100%, 900px)', maxHeight: '100%' }}>
        {slots.map((m, i) => {
          const isHover = hoverCell?.idx === i
          const origin = isHover ? hoverCell!.origin : '50% 50%'
          const url = m != null
            ? resolveMediaUrl(
                m.views?.face_cu ?? m.views?.front ?? m.views?.side ?? m.views?.back
                ?? m.thumbnailUrl ?? m.filePath,
              )
            : null
          const angleKey = m?.viewAngle ?? (m?.views != null ? Object.keys(m.views)[0] : undefined)
          return (
            <div
              key={m?.nodeId ?? `empty-${i}`}
              onMouseEnter={() => setHoverCell({ idx: i, origin: '50% 50%' })}
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                const x = ((e.clientX - r.left) / r.width) * 100
                const y = ((e.clientY - r.top) / r.height) * 100
                setHoverCell({ idx: i, origin: `${x.toFixed(0)}% ${y.toFixed(0)}%` })
              }}
              onMouseLeave={() => setHoverCell(null)}
              onDoubleClick={() => onScaleChange(1)}
              style={{
                position: 'relative', aspectRatio: '4 / 3',
                background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 8,
                overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {url != null ? (
                <img
                  src={url}
                  alt={m?.label ?? ''}
                  draggable={false}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${scale})`, transformOrigin: origin, transition: isHover ? 'none' : 'transform 120ms var(--cv-d-select, 120ms) var(--cv-e-out, ease-out)' }}
                />
              ) : (
                <span style={{ fontSize: 28, opacity: 0.4 }}>🖼</span>
              )}
              {m != null && angleKey != null && (
                <span style={{ position: 'absolute', left: 8, bottom: 6, fontSize: 10, padding: '1px 6px', borderRadius: 4, background: v3theme.modalityWeak.image, color: theme.text.secondary }}>
                  {viewLabel(angleKey)}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* 中央 chip(纯展示——48px 参考图 + 名称 + 套系 + 一致性分透传) */}
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', pointerEvents: 'none' }}>
        <div style={{ background: theme.bg.panel, opacity: 0.9, borderRadius: 8, border: `1px solid ${theme.border.default}`, position: 'absolute', inset: 0 }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
          {center.refUrl != null && (
            <img src={resolveMediaUrl(center.refUrl) ?? undefined} alt={center.name} style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover' }} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>{center.name}</span>
            {center.costumeName != null && <span style={{ fontSize: 10, color: theme.text.secondary }}>{center.costumeName}</span>}
            {center.consistency != null && (
              <span
                title="turnaround-ssim 透传,平台不计算"
                style={{ fontSize: 10, fontFamily: 'var(--cv-font-mono, monospace)', color: getScoreColor(center.consistency) }}
              >
                一致性 {Math.round(center.consistency * 100)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
