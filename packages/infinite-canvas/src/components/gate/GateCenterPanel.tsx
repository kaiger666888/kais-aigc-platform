/**
 * GateCenterPanel.tsx — Gate 中心 420px 右 dock(Phase 54-07, UI-SPEC C-3)。
 *
 * GateCenterBlock 的 dock 包装:右侧 420px(min 360,--cv-panel-w-min 族)、
 * --cv-bg-panel 底、theme.shadow.pop 浮起、头部 40px「Gate 中心」+ ✕、
 * Esc 关闭、开合动效 --cv-d-panel(240ms)。Block 无 dock 依赖(D-13 seam:
 * 可被 G15 工作台内嵌,本面板只是它的独立入口)。
 */
import { useEffect } from 'react'
import GateCenterBlock from './GateCenterBlock'
import { useGateStore } from '../../store/gateStore'
import { theme } from '../../theme/catppuccin'

export default function GateCenterPanel(): React.ReactElement {
  const setOpen = useGateStore((s) => s.setOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  return (
    <div
      data-testid="gate-center-panel"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        minWidth: 360,
        background: 'var(--cv-bg-panel, #111317)',
        boxShadow: theme.shadow.pop,
        borderLeft: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 60,
        animation: 'cv-gate-panel-in var(--cv-d-panel, 240ms) var(--cv-e-out, ease-out)',
      }}
    >
      <style>{`
        @keyframes cv-gate-panel-in { from { transform: translateX(16px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
        @media (prefers-reduced-motion: reduce) { .gate-center-panel-host { animation: none; } }
      `}</style>
      {/* 头部 40px */}
      <div
        className="gate-center-panel-host"
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: theme.text.primary }}>Gate 中心</span>
        <button
          onClick={() => setOpen(false)}
          title="关闭 (Esc)"
          style={{ background: 'none', border: 'none', color: theme.text.secondary, cursor: 'pointer', fontSize: 14, padding: '4px 8px', borderRadius: 6 }}
        >
          ✕
        </button>
      </div>
      {/* 内容块(D-13 seam:无 dock 依赖,可独立内嵌) */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <GateCenterBlock />
      </div>
    </div>
  )
}
