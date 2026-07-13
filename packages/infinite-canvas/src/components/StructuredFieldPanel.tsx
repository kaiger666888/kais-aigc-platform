/**
 * StructuredFieldPanel — 通用结构化字段展示+编辑面板
 * 
 * 根据 NODE_SCHEMA 配置自动渲染 enum/text/number/tags/bar 类型的字段。
 * 用于所有节点类型的右侧详情面板。
 */
import { useCanvasStore } from '../store/canvasStore'
import { theme } from '../theme/catppuccin'
import {
  NODE_SCHEMA,
  type StructuredField,
} from '../constants'

// ─── 子渲染器 ────────────────────────────────────────────

function EnumField({
  field, value, nodeId,
}: {
  field: StructuredField
  value: string | undefined
  nodeId: string
}) {
  const setNodes = useCanvasStore((s) => s.setNodes)
  const options = field.options || {}

  const setField = (val: string) => {
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, [field.key]: val || undefined } }
        : n,
    ))
  }

  // If the current value is not in the predefined options (e.g. Chinese text
  // like "大远景" from import-from-dir), add it as an extra option so the
  // select dropdown displays it instead of showing blank.
  const hasMatch = value != null && value !== '' && (value in options)
  const extraOption = (!hasMatch && value != null && value !== '') ? value : null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: theme.text.secondary, minWidth: 48, flexShrink: 0 }}>
        {field.label}
      </span>
      <select
        value={value ?? ''}
        onChange={(e) => setField(e.target.value)}
        style={{
          flex: 1,
          padding: '5px 8px',
          borderRadius: 6,
          background: theme.bg.input,
          border: `1px solid ${theme.border.subtle}`,
          color: theme.text.primary,
          fontSize: 12,
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        <option value="">— 未设置 —</option>
        {Object.entries(options).map(([val, label]) => (
          <option key={val} value={val}>{label}</option>
        ))}
        {extraOption && (
          <option value={extraOption}>{extraOption}</option>
        )}
      </select>
    </div>
  )
}

function TextField({
  field, value, nodeId,
}: {
  field: StructuredField
  value: string | undefined
  nodeId: string
}) {
  const setNodes = useCanvasStore((s) => s.setNodes)
  const setField = (val: string) => {
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, [field.key]: val || undefined } }
        : n,
    ))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: theme.text.secondary }}>
        {field.label}
      </span>
      <textarea
        value={value ?? ''}
        onChange={(e) => setField(e.target.value)}
        rows={2}
        style={{
          width: '100%',
          padding: '6px 8px',
          borderRadius: 6,
          background: theme.bg.input,
          border: `1px solid ${theme.border.subtle}`,
          color: theme.text.primary,
          fontSize: 12,
          fontFamily: 'inherit',
          resize: 'vertical' as const,
          outline: 'none',
          lineHeight: 1.5,
        }}
      />
    </div>
  )
}

function NumberField({
  field, value, nodeId,
}: {
  field: StructuredField
  value: number | undefined
  nodeId: string
}) {
  const setNodes = useCanvasStore((s) => s.setNodes)
  const setField = (val: number | undefined) => {
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, [field.key]: val } }
        : n,
    ))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: theme.text.secondary, minWidth: 48, flexShrink: 0 }}>
        {field.label}
      </span>
      <input
        type="number"
        value={value ?? ''}
        min={field.min}
        max={field.max}
        onChange={(e) => setField(e.target.value ? Number(e.target.value) : undefined)}
        style={{
          flex: 1,
          padding: '5px 8px',
          borderRadius: 6,
          background: theme.bg.input,
          border: `1px solid ${theme.border.subtle}`,
          color: theme.text.primary,
          fontSize: 12,
          outline: 'none',
        }}
      />
      {field.unit && (
        <span style={{ fontSize: 11, color: theme.text.disabled }}>{field.unit}</span>
      )}
    </div>
  )
}

function BarField({
  field, value, nodeId,
}: {
  field: StructuredField
  value: number | undefined
  nodeId: string
}) {
  const setNodes = useCanvasStore((s) => s.setNodes)
  const v = value ?? 0
  const min = field.min ?? 0
  const max = field.max ?? 1
  const pct = Math.round(((v - min) / (max - min)) * 100)

  const setField = (val: number) => {
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, [field.key]: val } }
        : n,
    ))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: theme.text.secondary }}>{field.label}</span>
        <span style={{ fontSize: 11, color: theme.text.primary, fontWeight: 600 }}>
          {v.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={v}
        onChange={(e) => setField(Number(e.target.value))}
        style={{ width: '100%', accentColor: theme.button.primary }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: theme.text.disabled }}>{field.min}</span>
        <div style={{
          height: 6, flex: 1, margin: '0 8px', borderRadius: 3,
          background: theme.bg.input, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${pct}%`, borderRadius: 3,
            background: theme.button.primary, transition: 'width 0.2s',
          }} />
        </div>
        <span style={{ fontSize: 10, color: theme.text.disabled }}>{field.max}</span>
      </div>
    </div>
  )
}

function TagsField({
  field, value, nodeId,
}: {
  field: StructuredField
  value: string[] | undefined
  nodeId: string
}) {
  if (!value || value.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: theme.text.secondary }}>{field.label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {value.map((tag, i) => (
          <span key={i} style={{
            padding: '2px 8px',
            borderRadius: 4,
            background: theme.bg.surface,
            color: theme.text.primary,
            fontSize: 11,
            border: `1px solid ${theme.border.subtle}`,
          }}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── 主面板 ──────────────────────────────────────────────

export default function StructuredFieldPanel({
  nodeId,
  nodeType,
  data,
  filterKeys,
}: {
  nodeId: string
  nodeType: string
  data: Record<string, unknown>
  /** Only render fields whose key is in this list (optional, for sub-type filtering) */
  filterKeys?: string[]
}) {
  const schema = NODE_SCHEMA[nodeType]
  if (!schema) return null

  const fields = filterKeys
    ? schema.filter((f) => filterKeys.includes(f.key))
    : schema

  // Only render fields that have a value OR are enum type (show dropdown)
  const visibleFields = fields.filter((f) => {
    const val = data[f.key]
    // Only render fields that have a non-empty value.
    // Previously enum/bar types were always shown even when empty,
    // causing noise (e.g. mcmahonArc on P01 nodes that don't have it).
    return val != null && val !== '' && val !== 0
  })

  if (visibleFields.length === 0) return null

  return (
    <>
      <div style={{
        fontSize: 12,
        fontWeight: 600,
        color: theme.text.secondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 8,
        marginTop: 12,
      }}>
        ⚙️ 结构化参数
      </div>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        marginBottom: 12,
        padding: 12,
        borderRadius: 8,
        background: theme.bg.surface,
        border: `1px solid ${theme.border.subtle}`,
      }}>
        {visibleFields.map((field) => {
          const value = data[field.key] as string | number | string[] | undefined
          const key = `${nodeId}-${field.key}`

          switch (field.type) {
            case 'enum':
              return <EnumField key={key} field={field} value={value as string} nodeId={nodeId} />
            case 'text':
              return <TextField key={key} field={field} value={value as string} nodeId={nodeId} />
            case 'number':
              return <NumberField key={key} field={field} value={value as number} nodeId={nodeId} />
            case 'bar':
              return <BarField key={key} field={field} value={value as number} nodeId={nodeId} />
            case 'tags':
              return <TagsField key={key} field={field} value={value as string[]} nodeId={nodeId} />
            default:
              return null
          }
        })}
      </div>
    </>
  )
}

// ─── 便捷预设 ────────────────────────────────────────────

/** 角色节点专用：只渲染角色相关字段 */
export const CHARACTER_FIELDS = ['archetype', 'ageRange', 'clipITarget']

/** 风格节点专用：只渲染5D风格维度 */
export const STYLE_FIELDS = ['style_composition', 'style_color', 'style_rhythm', 'style_light', 'style_sound']
