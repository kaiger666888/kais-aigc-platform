/**
 * src/components/panel/MetaRenderer.tsx — V3 资产 meta 按 stage 判别联合渲染（SPEC D.1 / 宪法 §8）。
 *
 * 资产权威载荷 asset.meta 是按 stage 判别的联合（types.ts AssetStageMeta）。本组件按 asset.stage
 * 分派，只读字段以 chip/键值行呈现；storyboard 额外内嵌「镜头意图」下拉编辑器（4 select，
 * 写侧经 store.updateAssetMeta 回写 canonical asset.meta，读侧直读 meta[field]——Phase 51-02
 * WRITE-03 canonical 回写契约）。
 */
import type { Node } from '@xyflow/react'
import type { AssetNodeV3, PromptFacets } from '@kais/flowgraph-v3'
import { METADATA_LABELS, METADATA_FIELD_ORDER } from '../../constants'
import { theme } from '../../theme/catppuccin'
import { useCanvasStore } from '../../store/canvasStore'

export default function MetaRenderer({ asset, node }: { asset: AssetNodeV3; node: Node }): React.ReactElement | null {
  const meta = asset.meta
  switch (meta.stage) {
    case 'script':
      return <FieldStack fields={[
        ['钩子类型', meta.hookType],
        ['钩子强度', meta.hookIntensity],
        ['前提', meta.premise],
        ['情绪值', meta.emotion],
      ]} />

    case 'storyboard':
      return (
        <>
          <FieldStack fields={[
            ['镜头 ID', meta.shotId],
            ['镜头类型', meta.shotType],
            ['时长', typeof meta.durationS === 'number' ? `${meta.durationS}s` : undefined],
          ]} />
          {meta.promptMeta && <PromptFacetsView facets={meta.promptMeta} />}
          {/* 镜头意图下拉编辑器（Phase 51-02：写 updateAssetMeta 回写 canonical，读 meta[field]）。
              标题唯一占「镜头意图」——ShotIntentSection 改用「创作意图」避免重复。 */}
          <SectionLabel>镜头意图</SectionLabel>
          <MetadataEditor nodeId={node.id} meta={meta as Record<string, unknown>} />
        </>
      )

    case 'keyframe':
      return <FieldStack fields={[['镜头 ID', meta.shotId]]} />

    case 'video':
      return <FieldStack fields={[
        ['镜头 ID', meta.shotId],
        ['终态观测', meta.observedEndState],
        ['Murch 评级', meta.murchGrade],
      ]} />

    case 'voice':
    case 'foley':
    case 'bgm':
      return <FieldStack fields={[
        ['镜头 ID', meta.shotId],
        ['情绪', meta.emotion],
        ['说话人', meta.speaker],
      ]} />

    case 'global':
      return <FieldStack fields={[
        ['资产类型', meta.assetType],
        ['原型', meta.archetype],
        ['视角', meta.viewAngle],
      ]} />

    case 'mix':
      return null // 空载荷

    case 'composite':
      return <FieldStack fields={[['EDL 引用', meta.edlRef]]} />

    default:
      return null
  }
}

// ─── 子组件 ─────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      color: theme.text.secondary, fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
      letterSpacing: '0.05em', marginBottom: 8, marginTop: 16,
    }}>{children}</div>
  )
}

/** 键值行栈（跳过 undefined/null/空）。 */
function FieldStack({ fields }: { fields: Array<[string, unknown]> }) {
  const rows = fields.filter(([, v]) => v != null && v !== '')
  if (rows.length === 0) return null
  return (
    <>
      <SectionLabel>元数据</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
            <span style={{ color: theme.text.secondary }}>{k}</span>
            <span style={{ color: theme.text.primary, fontFamily: 'var(--cv-font-mono, monospace)', textAlign: 'right', wordBreak: 'break-all' }}>{String(v)}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function PromptFacetsView({ facets }: { facets: PromptFacets }) {
  const entries: Array<[string, string]> = [
    ['主体', facets.subject], ['动作', facets.action], ['运镜', facets.camera],
    ['场景', facets.scene], ['光照', facets.lighting], ['风格', facets.style], ['文字', facets.text],
  ].filter(([, v]) => v) as Array<[string, string]>
  if (entries.length === 0) return null
  return (
    <>
      <SectionLabel>画面要素（7-facet）</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ fontSize: 11, color: theme.text.primary, lineHeight: 1.5 }}>
            <span style={{ color: theme.text.secondary }}>{k}：</span>{v}
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * 镜头意图下拉编辑器（Phase 51-02 WRITE-03 canonical 回写契约）。
 * 读：meta[field]（asset.meta 权威值，经 graphToViewModel 注入 data.meta）；空显示「未设置」。
 * 写：store.updateAssetMeta(nodeId, { [field]: value })——canonical 字段级 patch，
 * 空值由 action 删字段；派生 RF 缓存只由 graphToViewModel 重建，编辑经 transform 后存活。
 */
const FIELD_LABELS: Record<typeof METADATA_FIELD_ORDER[number], string> = {
  cameraMovement: '运镜', framing: '景别', composition: '构图', pacing: '节奏',
}

function MetadataEditor({ nodeId, meta }: { nodeId: string; meta: Record<string, unknown> }) {
  const updateAssetMeta = useCanvasStore((s) => s.updateAssetMeta)

  const setField = (field: typeof METADATA_FIELD_ORDER[number], value: string) => {
    updateAssetMeta(nodeId, { [field]: value })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {METADATA_FIELD_ORDER.map((field) => {
        const labels = METADATA_LABELS[field]
        const currentValue = meta[field] as string | undefined
        const hasMatch = currentValue != null && currentValue !== '' && currentValue in labels
        const extraOption = !hasMatch && currentValue != null && currentValue !== '' ? currentValue : null
        return (
          <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: theme.text.secondary, minWidth: 36 }}>{FIELD_LABELS[field]}</span>
            <select
              value={currentValue ?? ''}
              onChange={(e) => setField(field, e.target.value)}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: 6, background: theme.bg.input,
                border: `1px solid ${theme.border.subtle}`, color: theme.text.primary, fontSize: 12, cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="">— 未设置 —</option>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
              {extraOption && <option value={extraOption}>{extraOption}</option>}
            </select>
          </div>
        )
      })}
    </div>
  )
}
