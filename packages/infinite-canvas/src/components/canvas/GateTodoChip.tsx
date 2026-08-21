/**
 * GateTodoChip.tsx — topbar 待办 chip(Phase 54-06 / GATE-02,UI-SPEC C-1)。
 *
 * 管线被人工门阻塞时的唯一入口:「等你决策 · {门名}」+ 10px 金色呼吸点
 * (与阻塞列描边同源同拍 2.4s——全画布恒一处发光的签名元素)。
 * blocking == null 时整个 chip 不渲染(空态不占顶栏,绝不显示 0 徽章空壳)。
 *
 * 点击:三级解析代表节点(g-{gateId} → n-{phaseId} → phaseName token 等值)
 * → 命中则跳焦(setFocusAssetNodeId)+ 非画布视图先切回 → 打开 gate 面板;
 * 三级皆无 → 只开面板不跳焦不报错。
 */
import { useGateStore, resolveRepresentativeNodeId } from '../../store/gateStore'
import { useCanvasStore } from '../../store/canvasStore'
import { v3theme, theme } from '../../theme/catppuccin'

export default function GateTodoChip(): React.ReactElement | null {
  const blocking = useGateStore((s) => s.snapshot?.blocking ?? null)
  if (blocking == null) return null

  const handleClick = () => {
    const canvas = useCanvasStore.getState()
    // 非画布视图(时间轴等)先切回,让跳焦可见
    if (canvas.viewMode !== 'canvas') canvas.setViewMode('canvas')
    const nodes = (canvas.graph?.nodes ?? []) as Array<{ id: string; phaseName?: string }>
    const representative = resolveRepresentativeNodeId(
      blocking,
      nodes.map((n) => ({ id: n.id, phaseName: n.phaseName })),
    )
    if (representative != null) canvas.setFocusAssetNodeId(representative)
    useGateStore.getState().setOpen(true)
  }

  const gold = v3theme.signal.running
  return (
    <>
      <style>{`
        @keyframes cv-gate-chip-breathe { 0%, 100% { opacity: 0.5 } 50% { opacity: 1 } }
        .cv-gate-chip-dot { animation: cv-gate-chip-breathe calc(var(--cv-d-running-spin) * 2) var(--cv-e-inout) infinite; }
        @media (prefers-reduced-motion: reduce) { .cv-gate-chip-dot { animation: none; opacity: 1; } }
      `}</style>
      <button
        data-testid="gate-todo-chip"
        onClick={handleClick}
        title={`管线停在「${blocking.label}」——点击定位并处理`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          height: 26,
          padding: '4px 12px',
          borderRadius: 7,
          background: 'var(--cv-bg-overlay)',
          border: `1px solid ${gold}55`,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span
          className="cv-gate-chip-dot"
          style={{ width: 10, height: 10, borderRadius: '50%', background: gold, flexShrink: 0 }}
        />
        <span style={{ fontSize: 'var(--cv-fs-t2, 12px)', fontWeight: 400, whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 600, color: gold }}>等你决策</span>
          <span style={{ color: theme.text.secondary }}> · {blocking.label}</span>
        </span>
      </button>
    </>
  )
}
