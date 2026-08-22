/**
 * PipelineRibbon.tsx — 管线带（Phase 57 签名元素，UI-SPEC §Signature Element）。
 *
 * 本 task 落 micro 档（门户集行内，高 8px，flex-1 占满行宽）；full 档 props
 * 预留（交付页 57-05：24px 高 + gate 四态点 + 段级 zone 深链）。
 *
 * 词汇/几何单源：段序与文案全来自 ribbonSegments（PHASE_REGISTRY 派生，本组件
 * 零内联 phase 表）；颜色 = v3theme.phaseGroup 弱填充 + 同色顶边线（两维度纪律：
 * 只出现 phaseGroup 维度色，场景维度色不进门户）。
 *
 * 降级（UI-SPEC §Signature 5）：counts 缺失/undefined → 整条不渲染（不占位）。
 */
import type { CSSProperties } from 'react'
import { ribbonSegments, ribbonHref, PHASE_REGISTRY } from '../lib/ribbon'
import type { PhaseGroup } from '@ic/constants/phaseRegistry'
import { v3theme } from '@ic/theme/catppuccin'

/** phaseGroup → 模态通道（weak 底填充复用既有 *Weak 先例，同式 alpha 0.12）。 */
const GROUP_MODALITY: Record<PhaseGroup, 'text' | 'image' | 'video' | 'audio'> = {
  research: 'text',
  story: 'image',
  production: 'video',
  post: 'audio',
}

/** 段 hover tooltip（mono t4；一次注入，全部 token）。 */
const TOOLTIP_CSS = `
.cv-rib-seg { position: relative; }
.cv-rib-seg::after {
  content: attr(data-tip);
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: calc(100% + 6px);
  padding: 4px 8px;
  background: var(--cv-bg-elevated);
  border: 1px solid var(--cv-line-panel);
  border-radius: 6px;
  color: var(--cv-text-primary);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-fs-t4);
  line-height: 1.4;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--cv-d-select) var(--cv-e-out);
  z-index: 20;
}
.cv-rib-seg:hover::after { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .cv-rib-seg::after { transition: none; }
}
`

export interface PipelineRibbonProps {
  projectId: number
  /** episodesId（集号，深链 ep 参数） */
  ep: number
  /** 每集 phase 直方图（projects.ts episodes[].phases）；undefined → 整条不渲染 */
  counts: Record<number, number> | undefined | null
  /** micro（本 task，8px）/ full（57-05，24px + gate 点 + 段级深链） */
  variant?: 'micro' | 'full'
}

export default function PipelineRibbon({ projectId, ep, counts, variant = 'micro' }: PipelineRibbonProps) {
  if (counts == null) return null

  const segments = ribbonSegments(PHASE_REGISTRY, counts)
  const height = variant === 'micro' ? 8 : 24

  const barStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-end',
    flex: 1,
    minWidth: 0,
    height,
    gap: 2,
    textDecoration: 'none',
  }

  return (
    <a
      className="cv-ribbon"
      data-variant={variant}
      href={ribbonHref(projectId, ep)}
      style={barStyle}
      aria-label={`管线带 · EP ${ep} · ${segments.filter((s) => s.filled).length}/22 段`}
    >
      <style>{TOOLTIP_CSS}</style>
      {segments.map((s) => {
        const full = v3theme.phaseGroup[s.group]
        const segStyle: CSSProperties = {
          flex: 1,
          minWidth: 1,
          // sub 段 60% 高、底对齐（容器 align-items:flex-end）
          height: s.sub ? '60%' : '100%',
          background: s.filled ? v3theme.modalityWeak[GROUP_MODALITY[s.group]] : 'transparent',
          // filled：1px 顶边线全饱和；空段：发丝线描边
          borderTop: `1px solid ${s.filled ? full : 'var(--cv-line-panel)'}`,
          ...(s.filled ? {} : { borderLeft: '1px solid var(--cv-line-panel)', borderRight: '1px solid var(--cv-line-panel)', borderBottom: '1px solid var(--cv-line-panel)' }),
        }
        return (
          <span key={s.code} className="cv-rib-seg" data-tip={`${s.code} ${s.name} · ${s.count} 节点`} style={segStyle} />
        )
      })}
    </a>
  )
}
