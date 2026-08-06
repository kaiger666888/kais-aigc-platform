/**
 * src/components/pipeline/PhaseNode.tsx — 单个阶段卡片节点（BlueOcean 风格）。
 *
 * 头部：P0X 序号（分组色 mono）+ 中文名 + 状态图标（✓/⟳/⏳/✕/○）。
 * 折叠态：资产/选定计数摘要 + 待决策 ⚠️ 提示。
 * 展开态：SlotSummary + Depends on 依赖链面包屑 + 资产缩略图网格（三态角标）。
 * hover 高亮依赖链（上游高亮 / 下游虚化）由父级经 highlightState 驱动。
 */
import { memo } from 'react'
import type { PhaseModel, AssetTriState } from './model'
import { EXEC_STATE_META, execStateLabel } from './model'
import { theme, v3theme } from '../../theme/catppuccin'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import SlotSummary from './SlotSummary'

export type HighlightState = 'normal' | 'highlighted' | 'dimmed'

interface PhaseNodeProps {
  model: PhaseModel
  expanded: boolean
  onToggle: () => void
  onAssetClick: (nodeId: string) => void
  onHover: (sortKey: number | null) => void
  dependencyChain: string[]
  highlightState: HighlightState
}

const TRI_STATE_META: Record<AssetTriState, { glyph: string; color: string; label: string }> = {
  selected: { glyph: '★', color: '#56B89A', label: '选定' },
  candidate: { glyph: '○', color: '#E0B665', label: '待选' },
  eliminated: { glyph: '✕', color: '#DD6A82', label: '淘汰' },
}

/** 展开态资产缩略图上限（超出显示 +N，避免重阶段渲染数百张图）。 */
const ASSET_GRID_CAP = 24

function PhaseNodeImpl({
  model,
  expanded,
  onToggle,
  onAssetClick,
  onHover,
  dependencyChain,
  highlightState,
}: PhaseNodeProps): React.ReactElement {
  const { def, execState, assetCount, assets, pendingDecisionCount, present } = model
  const meta = EXEC_STATE_META[execState]
  const groupColor = v3theme.phaseGroup[def.group]
  const selectedCount = assets.filter((a) => a.triState === 'selected').length

  const dim = highlightState === 'dimmed'
  const hi = highlightState === 'highlighted'
  const cardBg = hi ? theme.bg.cardHover : theme.bg.card

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => onHover(def.sortKey)}
      onMouseLeave={() => onHover(null)}
      style={{
        width: 220,
        flex: '0 0 auto',
        background: cardBg,
        border: `1px solid ${hi ? groupColor : theme.border.default}`,
        borderRadius: 9,
        padding: 0,
        cursor: 'pointer',
        opacity: dim ? 0.42 : 1,
        transition: 'opacity 140ms ease, border-color 140ms ease, background 140ms ease',
        boxShadow: hi ? `0 0 0 1px ${groupColor}40, 0 4px 14px rgba(0,0,0,0.4)` : 'var(--cv-shadow-card, 0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset)',
        overflow: 'hidden',
      }}
    >
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px 7px' }}>
        <span
          style={{
            flex: '0 0 auto',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 38,
            height: 20,
            padding: '0 6px',
            borderRadius: 4,
            background: `${groupColor}1f`,
            color: groupColor,
            fontSize: 10.5,
            fontWeight: 700,
            fontFamily: 'var(--cv-font-mono, monospace)',
            letterSpacing: '0.02em',
          }}
        >
          {def.code}
        </span>
        <span style={{ flex: '1 1 auto', color: theme.text.primary, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {def.name}
        </span>
        <span
          title={execStateLabel(execState)}
          style={{
            flex: '0 0 auto',
            color: meta.color,
            fontSize: 15,
            fontWeight: 700,
            fontFamily: 'var(--cv-font-mono, monospace)',
            animation: meta.spin ? 'cv-pipe-spin 0.9s linear infinite' : undefined,
          }}
        >
          {present ? meta.glyph : '○'}
        </span>
      </div>

      {/* 折叠摘要 */}
      {!expanded && (
        <div style={{ padding: '0 10px 9px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {present ? (
            <>
              <span style={{ fontSize: 10.5, color: theme.text.tertiary, fontFamily: 'var(--cv-font-mono, monospace)' }}>
                {assetCount} 资产 · {selectedCount} 选定
              </span>
              {pendingDecisionCount > 0 && (
                <span style={{ fontSize: 10.5, color: v3theme.signal.running, fontWeight: 600 }}>
                  ⚠ {pendingDecisionCount} 待决策
                </span>
              )}
            </>
          ) : (
            <span style={{ fontSize: 10.5, color: theme.text.tertiary }}>未到达</span>
          )}
        </div>
      )}

      {/* 展开详情 */}
      {expanded && (
        <div
          style={{ padding: '4px 10px 10px', borderTop: `1px solid ${theme.border.subtle}`, marginTop: 2 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 10, color: theme.text.tertiary, margin: '6px 0 4px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            产物槽位
          </div>
          <SlotSummary slots={model.slots} />

          {/* 依赖链 */}
          <div style={{ fontSize: 10, color: theme.text.tertiary, margin: '9px 0 3px' }}>
            依赖链：
            <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', color: theme.text.secondary, marginLeft: 4 }}>
              {dependencyChain.join(' ← ')}
            </span>
          </div>

          {/* 待决策提示 */}
          {pendingDecisionCount > 0 && (
            <div style={{
              margin: '8px 0 4px',
              padding: '5px 8px',
              borderRadius: 5,
              background: 'rgba(224,182,101,0.10)',
              border: `1px solid rgba(224,182,101,0.25)`,
              color: v3theme.signal.running,
              fontSize: 10.5,
            }}>
              ⚠ {pendingDecisionCount} 个待选资产需人工决策
            </div>
          )}

          {/* 资产缩略图网格（摘要：上限 24 张，超出显示 +N） */}
          {assets.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: theme.text.tertiary, margin: '9px 0 5px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                资产（{assets.length}）
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
                {assets.slice(0, ASSET_GRID_CAP).map((a) => (
                  <AssetThumb key={a.nodeId} asset={a} onClick={() => onAssetClick(a.nodeId)} />
                ))}
                {assets.length > ASSET_GRID_CAP && (
                  <div
                    style={{
                      aspectRatio: '1 / 1',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 5,
                      background: 'rgba(255,255,255,0.03)',
                      border: `1px dashed ${theme.border.subtle}`,
                      color: theme.text.tertiary,
                      fontSize: 11,
                      fontFamily: 'var(--cv-font-mono, monospace)',
                    }}
                  >
                    +{assets.length - ASSET_GRID_CAP}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function AssetThumb({
  asset,
  onClick,
}: {
  asset: PhaseModel['assets'][number]
  onClick: () => void
}): React.ReactElement {
  const ts = TRI_STATE_META[asset.triState]
  const url = resolveMediaUrl(asset.thumbnail)
  const eliminated = asset.triState === 'eliminated'
  return (
    <button
      onClick={onClick}
      title={`${asset.label} · ${ts.label}`}
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        padding: 0,
        border: `1px solid ${theme.border.subtle}`,
        borderRadius: 5,
        overflow: 'hidden',
        background: v3theme.modalityWeak[asset.modality as 'text' | 'image' | 'audio' | 'video'] ?? 'rgba(255,255,255,0.03)',
        cursor: 'pointer',
      }}
    >
      {url ? (
        <img
          src={url}
          alt={asset.label}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: eliminated ? 0.4 : 1,
            filter: eliminated ? 'grayscale(0.7)' : undefined,
          }}
        />
      ) : (
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.text.tertiary, fontSize: 9 }}>
          {asset.stage.slice(0, 2)}
        </span>
      )}
      {/* 三态角标 */}
      <span
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 14,
          height: 14,
          borderRadius: 3,
          background: 'rgba(10,11,14,0.78)',
          color: ts.color,
          fontSize: 10,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {ts.glyph}
      </span>
    </button>
  )
}

const PhaseNode = memo(PhaseNodeImpl)
export default PhaseNode
