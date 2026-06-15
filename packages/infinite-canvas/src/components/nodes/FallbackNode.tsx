import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { theme } from '../../theme/catppuccin'
import { NODE_SIZES } from '../../constants'

/**
 * FallbackNode — the platform's safety-net renderer for node types not present
 * in any registered skill manifest (or a typo). The canvas does not crash, does
 * not render blank, and surfaces a visible "unknown node type" indicator.
 *
 * Phase 32 (CANVAS-03). Mounted as the ReactFlow `default` node type, so any
 * `node.type` value that is not in the platform's built-in renderer map
 * (`script` / `asset` / `storyboard` / `video` / `audio`) lands here.
 */
export interface FallbackNodeData {
  label?: string
  type?: string
  [key: string]: unknown
}

export type FallbackNodeType = Node<FallbackNodeData, string>

const containerStyle: React.CSSProperties = {
  width: NODE_SIZES.defaultPersistSize.width,
  minHeight: NODE_SIZES.defaultPersistSize.height,
  padding: 12,
  borderRadius: 10,
  background: theme.bg.card,
  border: `2px dashed ${theme.status.rejected}`,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'system-ui, sans-serif',
  color: theme.text.primary,
}

function FallbackNodeComponent({ data, id, type }: NodeProps<FallbackNodeType>) {
  const declaredType = data?.type ?? type ?? '(unknown)'
  const label = (data?.label as string | undefined) ?? `未知节点 ${id}`

  return (
    <div style={containerStyle}>
      <Handle type="target" position={Position.Left} />
      <div style={{ fontSize: 24, lineHeight: 1 }}>⚠️</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.status.rejected }}>
        未知节点类型
      </div>
      <div style={{ fontSize: 11, color: theme.text.secondary, textAlign: 'center' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 10,
          color: theme.text.disabled,
          fontFamily: 'monospace',
          background: theme.bg.canvas,
          padding: '2px 6px',
          borderRadius: 4,
          marginTop: 2,
        }}
      >
        {declaredType}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export default memo(FallbackNodeComponent)
