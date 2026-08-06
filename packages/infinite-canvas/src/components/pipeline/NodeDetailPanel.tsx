/**
 * src/components/pipeline/NodeDetailPanel.tsx — DAG 节点详情抽屉（点击节点弹出）。
 *
 * 右侧 drawer（宽 340）：头部阶段码 + 中文名 + 状态；统计行（总数/完成/选定/待选）；
 * 依赖来源（inputs = DAG 父步骤）与输出去向（outputs = DAG 子步骤）；
 * 资产缩略图网格（三态角标 ★选定/○待选/✕淘汰，上限 30，超出 +N），点击 → 跳画布定位。
 */
import { useMemo } from 'react'
import type { DagNodeModel, DagAssetRef, AssetTriState } from './model'
import { DAG_STATE_META, dagStateLabel, DAG_NODES, dagParentsOf, dagChildrenOf } from './model'
import { theme, v3theme } from '../../theme/catppuccin'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import { UiIcon } from '../canvas/icons'

const ASSET_GRID_CAP = 30

const TRI_STATE_META: Record<AssetTriState, { glyph: string; color: string; label: string }> = {
  selected: { glyph: '★', color: '#56B89A', label: '选定' },
  candidate: { glyph: '○', color: '#E0B665', label: '待选' },
  eliminated: { glyph: '✕', color: '#DD6A82', label: '淘汰' },
}

interface NodeDetailPanelProps {
  model: DagNodeModel | null
  onClose: () => void
  onLocate: (nodeId: string) => void
}

export default function NodeDetailPanel({
  model,
  onClose,
  onLocate,
}: NodeDetailPanelProps): React.ReactElement | null {
  // 预算 DAG id → label（解析 inputs/outputs 文案）
  const labelById = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of DAG_NODES) m.set(d.id, d.label)
    return m
  }, [])

  if (!model) return null

  const { def, state, total, completed, selected, candidates, assets } = model
  const meta = DAG_STATE_META[state]
  const groupColor = v3theme.phaseGroup[def.group]
  const inputs = dagParentsOf(def.id)
  const outputs = dagChildrenOf(def.id)

  return (
    <>
      {/* 背景遮罩（点击关闭） */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          zIndex: 40,
        }}
      />
      {/* 抽屉 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 360,
          background: theme.bg.panel,
          borderLeft: `1px solid ${theme.border.default}`,
          boxShadow: 'var(--cv-shadow-pop, 0 12px 32px rgba(0,0,0,0.6))',
          zIndex: 41,
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${theme.border.subtle}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 40,
                height: 20,
                padding: '0 7px',
                borderRadius: 4,
                background: `${groupColor}1f`,
                color: groupColor,
                fontSize: 10.5,
                fontWeight: 700,
                fontFamily: 'var(--cv-font-mono, monospace)',
              }}
            >
              {def.phaseCode}
            </span>
            <span style={{ flex: '1 1 auto', color: theme.text.primary, fontSize: 14, fontWeight: 700 }}>
              {def.label}
            </span>
            <button
              onClick={onClose}
              title="关闭"
              style={{
                background: 'transparent',
                border: 'none',
                color: theme.text.tertiary,
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: 4,
              }}
            >
              ✕
            </button>
          </div>
          {/* 状态徽章 */}
          <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: meta.color, fontSize: 14, fontWeight: 700, fontFamily: 'var(--cv-font-mono, monospace)' }}>
              {meta.glyph}
            </span>
            <span style={{ color: meta.color, fontSize: 12, fontWeight: 600 }}>{dagStateLabel(state)}</span>
          </div>
        </div>

        {/* 滚动体 */}
        <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: '14px 16px 20px' }}>
          {/* 统计行 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <StatCell label="总数" value={total} color={theme.text.primary} />
            <StatCell label="完成" value={completed} color={v3theme.signal.approved} />
            <StatCell label="选定" value={selected} color={v3theme.signal.approved} />
            <StatCell label="待选" value={candidates} color={v3theme.signal.running} />
          </div>

          {/* 依赖来源 */}
          <Section title="依赖来源（上游步骤）" icon="in">
            {inputs.length === 0 ? (
              <Muted>无（管线起点）</Muted>
            ) : (
              <ChipRow ids={inputs} labelById={labelById} colors={inputs.map((id) => groupColorOf(id))} />
            )}
          </Section>

          {/* 输出去向 */}
          <Section title="输出去向（下游步骤）" icon="out">
            {outputs.length === 0 ? (
              <Muted>无（管线终点）</Muted>
            ) : (
              <ChipRow ids={outputs} labelById={labelById} colors={outputs.map((id) => groupColorOf(id))} />
            )}
          </Section>

          {/* 资产缩略图网格 */}
          <Section title={`资产（${assets.length}）`} icon="assets">
            {assets.length === 0 ? (
              <Muted>该步骤尚无产物（阶段未到达）</Muted>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {assets.slice(0, ASSET_GRID_CAP).map((a) => (
                  <AssetThumb key={a.nodeId} asset={a} onClick={() => onLocate(a.nodeId)} />
                ))}
                {assets.length > ASSET_GRID_CAP && (
                  <div
                    style={{
                      aspectRatio: '1 / 1',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 6,
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
            )}
          </Section>
        </div>
      </div>
    </>
  )
}

function groupColorOf(nodeId: string): string {
  const def = DAG_NODES.find((d) => d.id === nodeId)
  return def ? v3theme.phaseGroup[def.group] : '#9A9FA8'
}

function StatCell({ label, value, color }: { label: string; value: number; color: string }): React.ReactElement {
  return (
    <div style={{ padding: '7px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: `1px solid ${theme.border.subtle}`, textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color, fontFamily: 'var(--cv-font-mono, monospace)' }}>{value}</div>
      <div style={{ fontSize: 9.5, color: theme.text.tertiary, marginTop: 1 }}>{label}</div>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: 'in' | 'out' | 'assets'; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
        {icon === 'in' && <span style={{ color: v3theme.edge.neutral, fontSize: 11 }}>←</span>}
        {icon === 'out' && <span style={{ color: v3theme.edge.neutral, fontSize: 11 }}>→</span>}
        {icon === 'assets' && <span style={{ display: 'flex', color: theme.text.tertiary }}><UiIcon kind="assets" size={11} /></span>}
        <span style={{ fontSize: 10.5, color: theme.text.tertiary, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div style={{ color: theme.text.tertiary, fontSize: 11.5, padding: '2px 0' }}>{children}</div>
}

function ChipRow({ ids, labelById, colors }: { ids: string[]; labelById: Map<string, string>; colors: string[] }): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {ids.map((id, i) => (
        <span
          key={id}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 5,
            background: `${colors[i]}14`,
            border: `1px solid ${colors[i]}33`,
            color: theme.text.secondary,
            fontSize: 11,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 2, background: colors[i] }} />
          {labelById.get(id) ?? id}
        </span>
      ))}
    </div>
  )
}

function AssetThumb({ asset, onClick }: { asset: DagAssetRef; onClick: () => void }): React.ReactElement {
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
        borderRadius: 6,
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
          {asset.label.slice(0, 3)}
        </span>
      )}
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
