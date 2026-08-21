/**
 * BranchPanel.tsx — 分支与结局侧栏浮层(Phase 55-06 / NAV-06,UI-SPEC §5)。
 *
 * 多结局探索两段式:预览(非破坏——他支节点压暗 --cv-dim-opacity 0.25,再点
 * /Esc 复原,不落库)→ 升为主线(内联二次确认 3s → selectBranchAsMain
 * 乐观+REST PATCH+失败回滚)。消费 store.branches;旧版(7ec2e605 档案)
 * 的假删除(rejected 状态伪装)不复刻。
 *
 * 色彩限定(UI-SPEC Color):Accent 冷白只出现在主线徽章与主按钮;Destructive
 * 玫只出现在确认态文字;其余 token-only。
 */
import { useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { theme, v3theme } from '../theme/catppuccin'

interface BranchRow {
  id: string
  label: string
  parentLabel: string | null
  status: string
  nodeCount: number
}

export default function BranchPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const branches = useCanvasStore((s) => s.branches)
  const nodes = useCanvasStore((s) => s.nodes)
  const selectBranchAsMain = useCanvasStore((s) => s.selectBranchAsMain)
  const setSelectedNodeIds = useCanvasStore((s) => s.setSelectedNodeIds)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const confirmTimerRef = useRef<number | null>(null)

  // 确认态 3s 超时复原
  useEffect(() => {
    if (confirmingId == null) return
    confirmTimerRef.current = window.setTimeout(() => setConfirmingId(null), 3000)
    return () => { if (confirmTimerRef.current != null) window.clearTimeout(confirmTimerRef.current) }
  }, [confirmingId])

  // 预览压暗经 RF selection 通道:预览分支节点 = 选中集,其余压暗由既有
  // selection dim 样式承担(非破坏;复原 = 清空选择)。
  const togglePreview = (branchId: string) => {
    if (previewId === branchId) {
      setPreviewId(null)
      setSelectedNodeIds([])
      return
    }
    const ids = (nodes as Array<{ id: string; data?: { branchId?: string } }>)
      .filter((n) => n.data?.branchId === branchId)
      .map((n) => n.id)
    if (ids.length === 0) return
    setPreviewId(branchId)
    setSelectedNodeIds(ids)
  }

  // Esc:关闭面板 + 清预览
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedNodeIds([])
        setPreviewId(null)
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, setSelectedNodeIds])

  // 卸载清预览(压暗不留残留)
  useEffect(() => () => { setSelectedNodeIds([]) }, [setSelectedNodeIds])

  const labelOf = (id: string) => branches.find((b) => b.id === id)?.label ?? null
  const rows: BranchRow[] = branches.map((b) => ({
    id: b.id,
    label: b.label,
    parentLabel: b.parentId != null ? labelOf(b.parentId) : null,
    status: b.status,
    nodeCount: (nodes as Array<{ data?: { branchId?: string } }>).filter((n) => n.data?.branchId === b.id).length,
  }))

  const promote = async (branchId: string) => {
    setBusy(true)
    try {
      await selectBranchAsMain(branchId)
    } finally {
      setBusy(false)
      setConfirmingId(null)
    }
  }

  return (
    <div
      data-testid="branch-panel"
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: 'var(--cv-panel-w-min, 360px)',
        background: 'var(--cv-bg-panel)',
        backdropFilter: 'blur(6px)',
        borderLeft: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))',
        boxShadow: theme.shadow.pop,
        zIndex: 60,
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* 头部 */}
      <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderBottom: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))', flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: theme.text.primary }}>分支与结局</span>
        <button onClick={onClose} title="关闭 (Esc)" style={{ background: 'none', border: 'none', color: theme.text.secondary, cursor: 'pointer', fontSize: 14, padding: '4px 8px', borderRadius: 6 }}>✕</button>
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', maxHeight: '60vh' }}>
        {rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, marginBottom: 6 }}>暂无分支</div>
            <div style={{ fontSize: 11, color: theme.text.secondary, lineHeight: 1.7 }}>当前只有主线一条线路；管线产出多结局变体后可在此探索</div>
          </div>
        ) : (
          rows.map((r) => {
            const isMain = r.status === 'active'
            const confirming = confirmingId === r.id
            const previewing = previewId === r.id
            return (
              <div key={r.id} style={{ minHeight: 28, padding: '10px 16px', borderBottom: '1px solid var(--cv-line-panel, rgba(255,255,255,0.04))', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: theme.text.primary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                  {isMain && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: v3theme.surface.canvas, background: v3theme.signal.select, borderRadius: 4, padding: '1px 6px' }}>主线</span>
                  )}
                  <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 10, color: theme.text.tertiary }}>{r.nodeCount} 节点</span>
                </div>
                {r.parentLabel != null && (
                  <div style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 10, color: theme.text.tertiary }}>← {r.parentLabel}</div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  {!isMain && (
                    <>
                      <button
                        onClick={() => togglePreview(r.id)}
                        style={{ height: 26, padding: '0 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer', background: previewing ? 'rgba(237,238,241,0.10)' : 'none', border: `1px solid ${previewing ? theme.border.strong : theme.border.default}`, color: previewing ? theme.text.primary : theme.text.secondary }}
                      >
                        {previewing ? '取消预览' : '预览'}
                      </button>
                      {confirming ? (
                        <button
                          onClick={() => void promote(r.id)}
                          disabled={busy}
                          title="3 秒内再次点击确认"
                          style={{ height: 26, padding: '0 10px', fontSize: 11, borderRadius: 6, cursor: busy ? 'wait' : 'pointer', background: 'none', border: `1px solid ${v3theme.signal.rejected}`, color: v3theme.signal.rejected, fontWeight: 600 }}
                        >
                          {busy ? '切换中…' : '确认升为主线？当前主线将归档'}
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmingId(r.id)}
                          style={{ height: 26, padding: '0 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer', background: v3theme.signal.select, border: 'none', color: v3theme.surface.canvas, fontWeight: 600 }}
                        >
                          升为主线
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
