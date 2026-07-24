/**
 * src/components/variants/VariantPicker.tsx — P12 变体候选列表（设计 §4.8 / 宪法 P12）。
 *
 * 牌堆 ×N 章（AssetCardNode）→ onStackToggle → variantPickerStore.open → 本组件显隐。
 * 候选网格（缩略 + seed + 状态）；点候选 = store.selectWinner（包内 selectVariant 纯函数）
 * + triggerStaleCascade（补 selectVariant 不级联的 stale 缺口）+ 关闭。
 * selectMode!=='single'（locked 解构集 / multi）整组禁选 + tooltip（selectVariant 本身亦 throw）。
 * 持久化走既有「💾 保存」流（selectWinner 本地即时，不直连后端）。
 */
import { useEffect } from 'react'
import type { Modality } from '../../theme/catppuccin'
import { v3theme, theme } from '../../theme/catppuccin'
import { useVariantPickerStore } from './variantPickerStore'
import { useCanvasStore } from '../../store/canvasStore'
import { triggerStaleCascade } from '../../hooks/useStale'

export default function VariantPicker(): React.ReactElement | null {
  const open = useVariantPickerStore((s) => s.open)
  const close = useVariantPickerStore((s) => s.close)
  const selectWinner = useCanvasStore((s) => s.selectWinner)
  const showToast = useCanvasStore((s) => s.showToast)
  const graph = useCanvasStore((s) => s.graph)

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null
  const { stack } = open
  const selectable = stack.selectMode === 'single'

  const modalityOf = (id: string): Modality => {
    const n = graph?.nodes.find((x) => x.id === id)
    return n && n.kind === 'asset' ? n.modality : 'image'
  }

  const handlePick = (candidateId: string) => {
    if (!selectable) {
      showToast(stack.selectMode === 'locked' ? '解构集整组锁定，不可改选' : '该变体组为多选模式，暂不支持改选', 'warning')
      return
    }
    selectWinner(candidateId)
    // selectVariant 不级联 stale——选定新 winner 后下游需重算（P13）。
    triggerStaleCascade([candidateId])
    close()
  }

  return (
    <div
      data-testid="variant-picker"
      data-stack-group-id={stack.groupId}
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 40,
        background: 'rgba(16,14,10,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        width: 460, maxWidth: '90vw', maxHeight: '80vh',
        background: theme.bg.panel, border: `1px solid ${theme.border.default}`, borderRadius: 12,
        boxShadow: `0 12px 40px ${theme.chrome.shadow}`, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'cv-stack-fan var(--cv-d-stack-open, 240ms) var(--cv-e-spring, cubic-bezier(0.34,1.3,0.4,1))',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: `1px solid ${theme.border.default}`, background: theme.bg.card,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: v3theme.signal.select, fontSize: 14 }}>🎴</span>
            <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: 13 }}>
              变体候选（{stack.count}）
            </span>
            {!selectable && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 4,
                background: v3theme.signal.lockedWeak, color: v3theme.signal.locked, fontWeight: 600,
              }} title={stack.selectMode === 'locked' ? '解构集锁定' : '多选组'}>
                {stack.selectMode === 'locked' ? '🔒 锁定' : 'multi'}
              </span>
            )}
          </div>
          <button onClick={close} style={closeBtnStyle}>✕</button>
        </div>

        <div style={{ padding: 14, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {stack.candidates.map((c) => {
            const isWinner = c.id === stack.winnerNodeId
            const mod = modalityOf(c.id)
            return (
              <button
                key={c.id}
                data-candidate-id={c.id}
                data-candidate-winner={isWinner ? '1' : '0'}
                onClick={() => handlePick(c.id)}
                disabled={!selectable}
                title={selectable ? (isWinner ? '当前优胜' : '选为优胜') : '该组不可改选'}
                style={{
                  position: 'relative', padding: 0, cursor: selectable ? 'pointer' : 'not-allowed',
                  borderRadius: 8, overflow: 'hidden', border: `1.5px solid ${isWinner ? v3theme.signal.select : theme.border.default}`,
                  background: theme.bg.card, opacity: c.curation === 'deprecated' ? 0.7 : 1,
                }}
              >
                <div style={{ width: '100%', height: 84, background: v3theme.modalityWeak[mod], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {c.thumbnail
                    ? <img src={c.thumbnail} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 22, opacity: 0.4 }}>{mod === 'video' ? '🎬' : mod === 'audio' ? '🎵' : '🖼'}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 10, color: theme.text.secondary }}>
                  <span>{c.seed != null ? `seed ${c.seed}` : c.id.slice(-6)}</span>
                  <span style={{ color: c.state === 'failed' ? v3theme.signal.rejected : c.state === 'running' ? v3theme.signal.running : v3theme.signal.approved }}>
                    {c.state === 'failed' ? '✕' : c.state === 'running' ? '…' : '✓'}
                  </span>
                </div>
                {isWinner && (
                  <span style={{ position: 'absolute', top: 4, right: 4, color: v3theme.signal.select, fontSize: 13, textShadow: '0 1px 2px #000' }}>✓</span>
                )}
              </button>
            )
          })}
        </div>

        <div style={{ padding: '8px 14px', borderTop: `1px solid ${theme.border.default}`, fontSize: 11, color: theme.text.secondary, background: theme.bg.card }}>
          {selectable ? '点候选即选为优胜，下游将标 stale 待重算（💾 保存后持久化）。' : '该组不可改选（解构集锁定 / 多选模式）。'}
        </div>
      </div>
    </div>
  )
}

const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: theme.text.secondary, fontSize: 16, cursor: 'pointer', padding: '2px 6px', lineHeight: 1, borderRadius: 4,
}
