/**
 * PipelineRibbon.tsx — 管线带（Phase 57 签名元素，UI-SPEC §Signature Element）。
 *
 * 两档同组件（props 切换）：
 *  - micro（57-02，门户集行内）：高 8px，整条 <a> 集级深链，段为 <span>。
 *  - full（57-05，交付页 hero 下）：高 24px = 12px 段条 + 段下方 10px gate
 *    四态点；段为可聚焦 <button>（PATTERNS P-5 裁定），点击 → zone 深链
 *    （ribbonHref 三参）；hover tooltip 追加 门名 · 四态词。
 *
 * 词汇/几何单源：段序与文案全来自 ribbonSegments（PHASE_REGISTRY 派生，本组件
 * 零内联 phase 表）；gate 词汇经 src/lib/gateCatalog（GATE_CATALOG 16 门快照
 * + GATE_DISPLAY_NAMES；platformInvisible 红线条目不加点——54 U-06）；四态
 * 色/词 = delivery.ts gateDisplayColor/GATE_STATE_LABEL（54 词表原样）。
 *
 * 降级（UI-SPEC §Signature 5）：counts 缺失/undefined → 整条不渲染（不占位）。
 */
import type { CSSProperties } from 'react'
import { ribbonSegments, ribbonHref, PHASE_REGISTRY } from '../lib/ribbon'
import type { PhaseGroup } from '@ic/constants/phaseRegistry'
import { v3theme } from '@ic/theme/catppuccin'
import { GATE_CATALOG, GATE_DISPLAY_NAMES } from '../../../../src/lib/gateCatalog'
import { GATE_STATE_LABEL, gateDisplayColor, type GateDisplay } from '../lib/delivery'

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

/** full 档段按钮（bar 区 + gate 点区；键盘焦点环走 token）。 */
const FULL_CSS = `
.cv-rib-btn {
  appearance: none; background: transparent; border: none; padding: 0; margin: 0;
  font: inherit; color: inherit; cursor: pointer;
  flex: 1; min-width: 1px; height: 24px;
  display: flex; flex-direction: column; gap: 2px;
}
.cv-rib-btn:focus-visible { outline: 2px solid var(--cv-select); outline-offset: 2px; border-radius: 2px; }
.cv-rib-barzone { height: 12px; display: flex; align-items: flex-end; }
.cv-rib-bar { transition: filter var(--cv-d-select) var(--cv-e-out); }
.cv-rib-btn:hover .cv-rib-bar { filter: brightness(1.15); }
.cv-rib-dot { height: 10px; width: 10px; align-self: center; border-radius: 999px; }
@media (prefers-reduced-motion: reduce) { .cv-rib-bar { transition: none; } }
`

/** gate-state gates[] 条目最小形状（@ic/store/gateStore GateStateGate 判定切片）。 */
export interface RibbonGate {
  gateId: string
  display: GateDisplay
}

/** 段级 gate 点（gateId → 显示名 → 四态；redline platformInvisible 不出点）。 */
export interface RibbonGateDot {
  gateId: string
  name: string
  display: GateDisplay
}

/**
 * gate-state gates[] → khsPrefix → 四态点映射（gateCatalog 派生：
 * catalog 条目的 phaseId 前缀 token = 注册表 khsPrefix；红线 platformInvisible
 * 条目跳过——54 U-06；快照无该 gateId 条目不加点）。
 */
export function gateDotsByPrefix(
  gates: ReadonlyArray<RibbonGate> | null | undefined,
): Map<string, RibbonGateDot> {
  const dots = new Map<string, RibbonGateDot>()
  if (!gates) return dots
  const byGateId = new Map(gates.map((g) => [g.gateId, g]))
  for (const c of GATE_CATALOG) {
    if (c.platformInvisible) continue
    const st = byGateId.get(c.derivedGateId)
    if (!st) continue
    dots.set(c.phaseId.split('_')[0], {
      gateId: c.derivedGateId,
      name: GATE_DISPLAY_NAMES[c.derivedGateId] ?? c.derivedGateId,
      display: st.display,
    })
  }
  return dots
}

export interface PipelineRibbonProps {
  projectId: number
  /** episodesId（集号，深链 ep 参数） */
  ep: number
  /** 每集 phase 直方图（micro = projects.ts episodes[].phases；full = phaseCountsOf(load-v2 图)）；undefined → 整条不渲染 */
  counts: Record<number, number> | undefined | null
  /** micro（8px）/ full（24px + gate 四态点 + 段级 zone 深链） */
  variant?: 'micro' | 'full'
  /** full 档：gate-state gates[]（null/缺条目 → 该段无点） */
  gates?: ReadonlyArray<RibbonGate> | null
  /** full 档：阻塞门 gateId（阻塞 pending 点走金——54 displayColor 同拍） */
  blockingGateId?: string | null
}

/** 段条样式（micro/full 同规则：sub 60% 高底对齐；filled = weak 填充 + 顶边线，空段发丝线描边——57-02 行为原样）。 */
function segBarStyle(group: PhaseGroup, filled: boolean, sub: boolean, heightPct: string): CSSProperties {
  const full = v3theme.phaseGroup[group]
  return {
    flex: 1,
    minWidth: 1,
    height: heightPct,
    background: filled ? v3theme.modalityWeak[GROUP_MODALITY[group]] : 'transparent',
    borderTop: `1px solid ${filled ? full : 'var(--cv-line-panel)'}`,
    ...(filled
      ? {}
      : {
          borderLeft: '1px solid var(--cv-line-panel)',
          borderRight: '1px solid var(--cv-line-panel)',
          borderBottom: '1px solid var(--cv-line-panel)',
        }),
  }
}

export default function PipelineRibbon({
  projectId,
  ep,
  counts,
  variant = 'micro',
  gates = null,
  blockingGateId = null,
}: PipelineRibbonProps) {
  if (counts == null) return null

  const segments = ribbonSegments(PHASE_REGISTRY, counts)
  const filledCount = segments.filter((s) => s.filled).length
  const ariaBase = `管线带 · EP ${ep} · ${filledCount}/22 段`

  // ─── full 档（交付页：24px + gate 点 + 段级 zone 深链）────────────────
  if (variant === 'full') {
    const dots = gateDotsByPrefix(gates)
    return (
      <div
        className="cv-ribbon"
        data-variant="full"
        role="navigation"
        aria-label={ariaBase}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 2, height: 24, width: '100%' }}
      >
        <style>{TOOLTIP_CSS}</style>
        <style>{FULL_CSS}</style>
        {segments.map((s) => {
          const dot = dots.get(s.khsPrefix)
          const isBlocking = dot != null && dot.gateId === blockingGateId
          const tip =
            `${s.code} ${s.name} · ${s.count} 节点` +
            (dot ? ` · ${dot.name} · ${GATE_STATE_LABEL[dot.display]}` : '')
          return (
            <button
              key={s.code}
              type="button"
              className="cv-rib-btn"
              onClick={() => {
                window.location.assign(ribbonHref(projectId, ep, s.khsPrefix))
              }}
              aria-label={`${tip} · 打开画布 ${s.code} 泳道`}
            >
              <span className="cv-rib-barzone">
                <span
                  className="cv-rib-seg cv-rib-bar"
                  data-tip={tip}
                  style={segBarStyle(s.group, s.filled, s.sub, s.sub ? '60%' : '100%')}
                />
              </span>
              {dot ? (
                <span
                  className="cv-rib-dot"
                  style={{ background: gateDisplayColor(dot.display, isBlocking) }}
                  aria-hidden="true"
                />
              ) : (
                <span className="cv-rib-dot" style={{ background: 'transparent' }} aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>
    )
  }

  // ─── micro 档（门户集行：8px，整条集级深链——57-02 行为零改动）────────
  return (
    <a
      className="cv-ribbon"
      data-variant="micro"
      href={ribbonHref(projectId, ep)}
      style={{ display: 'flex', alignItems: 'flex-end', flex: 1, minWidth: 0, height: 8, gap: 2, textDecoration: 'none' }}
      aria-label={ariaBase}
    >
      <style>{TOOLTIP_CSS}</style>
      {segments.map((s) => (
        <span
          key={s.code}
          className="cv-rib-seg"
          data-tip={`${s.code} ${s.name} · ${s.count} 节点`}
          style={segBarStyle(s.group, s.filled, s.sub, s.sub ? '60%' : '100%')}
        />
      ))}
    </a>
  )
}
