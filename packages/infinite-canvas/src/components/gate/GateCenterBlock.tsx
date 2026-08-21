/**
 * GateCenterBlock.tsx — gate 中心工作台内容块(Phase 54-07, UI-SPEC C-3)。
 *
 * 16 门四态清单 + 阻塞门展开卡 + 三操作动作条(放行/驳回/豁免)+ 理由
 * 对话框(C-4 组件内二次确认,绝不用原生 confirm)+ 降级横幅。
 * **无 dock 外壳依赖**(D-13 seam):可独立内嵌(如 G15 工作台),宽度由
 * 容器决定;GateCenterPanel 是它的 420px dock 包装。
 *
 * 操作闭环:行级「处理中…」瞬时态 → await gateOps → applied:true 行乐观
 * 翻转;applied:false cause already-resolved → 幂等成功 toast + 行回快照
 * 实际态(P4);异常 → 回滚 + 错误 toast。文案逐字走 UI-SPEC Copywriting
 * 表(审片 vernacular:等你决策/放行/驳回/豁免/自动扫描)。
 */
import { useEffect, useState } from 'react'
import { useGateStore, type GateStateGate } from '../../store/gateStore'
import { useCanvasStore } from '../../store/canvasStore'
import { gateOps, fetchGateState } from '../../services/canvasApi'
import { v3theme, theme } from '../../theme/catppuccin'

type Display = GateStateGate['display']

const DISPLAY_LABEL: Record<Display, string> = {
  pending: '等你决策',
  approve: '放行',
  reject: '驳回',
  waive: '豁免',
  auto: '自动扫描',
}

/** 四态色(U-08):金只给阻塞行(U-07 非阻塞 pending 用灰)。 */
function displayColor(display: Display, isBlocking: boolean): string {
  if (display === 'pending') return isBlocking ? v3theme.signal.running : v3theme.signal.pending
  if (display === 'approve') return v3theme.signal.approved
  if (display === 'reject') return v3theme.signal.rejected
  if (display === 'waive') return v3theme.signal.locked
  return v3theme.laneLabel
}

function relativeTime(fetchedAt: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000))
  return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒前`
}

export default function GateCenterBlock(): React.ReactElement | null {
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)
  const showToast = useCanvasStore((s) => s.showToast)
  const snapshot = useGateStore((s) => s.snapshot)
  const degrade = useGateStore((s) => s.degrade)

  /** 乐观翻转(applied:true 时;键 = gateId)。 */
  const [overrides, setOverrides] = useState<Record<string, Display>>({})
  /** 行级处理中(键 = gateId);禁全屏 loading。 */
  const [pendingGate, setPendingGate] = useState<string | null>(null)
  /** C-4 理由对话框:'reject' | 'waive' | null。 */
  const [confirming, setConfirming] = useState<'reject' | 'waive' | null>(null)
  const [reason, setReason] = useState('')

  const blocking = snapshot?.blocking ?? null
  const gates = snapshot?.gates ?? []

  useEffect(() => {
    if (confirming == null) setReason('')
  }, [confirming])

  if (snapshot == null) {
    return (
      <div style={{ padding: 24, color: theme.text.secondary, fontSize: 12, textAlign: 'center' }}>
        正在获取 gate 状态…
      </div>
    )
  }

  const runOp = async (action: 'approve' | 'reject' | 'waive', reasonText?: string) => {
    if (blocking == null || projectId == null || episodesId == null) return
    const gateId = blocking.gateId
    setPendingGate(gateId)
    try {
      const res = await gateOps(projectId, episodesId, blocking.reviewId, action, reasonText != null ? { reason: reasonText } : undefined)
      if (res.applied) {
        const flipped: Display = action === 'approve' ? 'approve' : action === 'reject' ? 'reject' : 'waive'
        setOverrides((prev) => ({ ...prev, [gateId]: flipped }))
        showToast(`「${blocking.label}」已${DISPLAY_LABEL[flipped]}`, 'success')
      } else {
        // P4 幂等成功:409 已被服务端映射为此形状——刷新快照回实际态。
        void fetchGateState(projectId, episodesId)
          .then((p) => { if (p) useGateStore.getState().apply(p) })
          .catch(() => {})
        showToast('该门已在别处处理（如 telegram），状态已刷新。', 'info')
      }
    } catch {
      setOverrides((prev) => {
        const next = { ...prev }
        delete next[gateId]
        return next
      })
      showToast('操作失败,已恢复原状态,请重试。', 'error')
    } finally {
      setPendingGate(null)
    }
  }

  const rowDisplay = (g: GateStateGate): Display =>
    pendingGate === g.gateId ? g.display : (overrides[g.gateId] ?? g.display)
  const rowWorking = (g: GateStateGate): boolean => pendingGate === g.gateId
  const isBlockingRow = (g: GateStateGate): boolean => blocking != null && g.gateId === blocking.gateId
  const hasPendingWork = gates.some((g) => g.display === 'pending' && g.reviewId != null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {/* 阻塞行呼吸点(与 chip/列描边同源同拍 2.4s;reduced-motion 常亮) */}
      <style>{`
        @keyframes cv-gate-row-breathe-kf { 0%, 100% { opacity: 0.5 } 50% { opacity: 1 } }
        .cv-gate-row-breathe { animation: cv-gate-row-breathe-kf calc(var(--cv-d-running-spin) * 2) var(--cv-e-inout) infinite; }
        @media (prefers-reduced-motion: reduce) { .cv-gate-row-breathe { animation: none; opacity: 1; } }
      `}</style>
      {/* 降级横幅(fail-closed:如实呈现,绝不误判为已放行) */}
      {degrade && (
        <div
          data-testid="gate-degrade-banner"
          style={{
            background: theme.chrome.errorBar,
            borderBottom: `1px solid ${v3theme.signal.rejected}66`,
            padding: '10px 16px',
            fontSize: 11,
            lineHeight: 1.6,
            color: theme.text.primary,
          }}
        >
          状态源不可达 —— 无法连接审核状态源，正在显示 {relativeTime(snapshot.fetchedAt)} 的快照，不会误判为已放行。{' '}
          <button
            onClick={() => {
              if (projectId == null || episodesId == null) return
              void fetchGateState(projectId, episodesId)
                .then((p) => { if (p) useGateStore.getState().apply(p) })
                .catch(() => {})
            }}
            style={{ background: 'none', border: `1px solid ${theme.border.strong}`, borderRadius: 6, color: theme.text.primary, padding: '2px 10px', cursor: 'pointer', fontSize: 11 }}
          >
            重试
          </button>
        </div>
      )}

      {/* 快照行 */}
      <div style={{ padding: '8px 16px', fontSize: 10, fontFamily: 'var(--cv-font-mono, monospace)', color: theme.text.tertiary, fontVariantNumeric: 'tabular-nums' }}>
        快照 {new Date(snapshot.fetchedAt).toLocaleTimeString()} · review 标注见各行
      </div>

      {/* 16 门清单 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {gates.map((g) => {
          const disp = rowDisplay(g)
          const isBlock = isBlockingRow(g)
          const terminal = disp !== 'pending' && disp !== 'auto'
          const color = displayColor(disp, isBlock)
          return (
            <div key={g.gateId}>
              <div
                data-testid={`gate-row-${g.gateId}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  height: 36,
                  padding: '8px 16px',
                  borderBottom: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))',
                  position: 'relative',
                  ...(isBlock ? { boxShadow: `inset 2px 0 0 ${v3theme.signal.running}` } : {}),
                  ...(terminal ? { color: theme.text.secondary } : {}),
                }}
              >
                <span
                  className={isBlock && disp === 'pending' ? 'cv-gate-row-breathe' : undefined}
                  style={{
                    width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 12, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {g.label}
                </span>
                <span data-testid={`gate-state-${g.gateId}`} style={{ fontSize: 11, fontWeight: 600, color, flexShrink: 0 }}>
                  {rowWorking(g) ? '处理中…' : DISPLAY_LABEL[disp]}
                </span>
                <span style={{ fontSize: 10, fontFamily: 'var(--cv-font-mono, monospace)', color: theme.text.tertiary, flexShrink: 0 }}>
                  {g.reviewId != null ? `#${g.reviewId}` : g.phaseId.replace(/_/g, '').slice(0, 10)}
                </span>
              </div>

              {/* 阻塞门展开卡 */}
              {isBlock && disp === 'pending' && g.note != null && (
                <div style={{ background: 'var(--cv-bg-card, #16181D)', borderRadius: 8, padding: 16, margin: '6px 16px', fontSize: 11, color: theme.text.secondary, lineHeight: 1.6 }}>
                  <div style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 10, color: theme.text.tertiary }}>note</div>
                  <div title={g.note}>{g.note}</div>
                </div>
              )}
            </div>
          )
        })}
        <div style={{ padding: '10px 16px', fontSize: 10, color: theme.text.tertiary, fontFamily: 'var(--cv-font-mono, monospace)' }}>
          p13 红线子门为本地自动扫描，不进入人工决策。
        </div>
      </div>

      {/* 空态(无阻塞且全终态) */}
      {!hasPendingWork && blocking == null && (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, marginBottom: 6 }}>管线畅通</div>
          <div style={{ fontSize: 11, color: theme.text.secondary, lineHeight: 1.6 }}>
            16 道门都无待决策项。管线停在门上时，顶部会亮出「等你决策」。
          </div>
        </div>
      )}

      {/* 动作条(sticky 底部) */}
      {blocking != null && (
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--cv-bg-panel, #111317)', padding: 16, display: 'flex', gap: 8, borderTop: '1px solid var(--cv-line-panel, rgba(255,255,255,0.06))' }}>
          <button
            onClick={() => void runOp('approve')}
            disabled={pendingGate != null}
            style={{ flex: 1, height: 32, borderRadius: 6, border: 'none', cursor: 'pointer', background: theme.button.primary, color: '#0A0B0E', fontSize: 12, fontWeight: 600 }}
          >
            放行
          </button>
          <button
            onClick={() => setConfirming('reject')}
            disabled={pendingGate != null}
            style={{ flex: 1, height: 32, borderRadius: 6, cursor: 'pointer', background: theme.button.danger, border: 'none', color: '#0A0B0E', fontSize: 12, fontWeight: 600 }}
          >
            驳回
          </button>
          <button
            onClick={() => setConfirming('waive')}
            disabled={pendingGate != null}
            style={{ flex: 1, height: 32, borderRadius: 6, cursor: 'pointer', background: theme.button.ghost, border: `1px solid ${v3theme.signal.locked}`, color: v3theme.signal.locked, fontSize: 12, fontWeight: 600 }}
          >
            豁免
          </button>
        </div>
      )}

      {/* C-4 理由对话框(驳回/豁免共用;Esc 取消) */}
      {confirming != null && (
        <div
          data-testid="gate-reason-dialog"
          role="dialog"
          onKeyDown={(e) => { if (e.key === 'Escape') setConfirming(null) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(10,11,14,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            zIndex: 1000,
          }}
        >
          <div style={{ background: 'var(--cv-bg-panel, #111317)', borderRadius: 10, padding: 20, width: '100%', maxWidth: 360, boxShadow: theme.shadow.pop, border: '1px solid var(--cv-line-panel, rgba(255,255,255,0.08))' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              {confirming === 'reject'
                ? `驳回后管线将回滚到 ${blocking?.label ?? ''} 重跑（重试预算 3 次）。确认驳回？`
                : '豁免表示跳过本门质量要求继续推进，决策理由将留档可查。确认豁免？'}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                confirming === 'reject'
                  ? '驳回理由（必填）：告诉管线哪里不过——将随决策存档。'
                  : '豁免理由（必填）：说明为何放这一条通过——将随决策存档。'
              }
              maxLength={500}
              autoFocus
              style={{ width: '100%', minHeight: 80, borderRadius: 6, background: 'var(--cv-bg-card, #16181D)', border: '1px solid var(--cv-line-panel, rgba(255,255,255,0.08))', color: theme.text.primary, fontSize: 12, padding: 10, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirming(null)}
                style={{ height: 30, padding: '0 14px', borderRadius: 6, cursor: 'pointer', background: 'none', border: `1px solid ${theme.border.default}`, color: theme.text.secondary, fontSize: 12 }}
              >
                取消
              </button>
              <button
                onClick={() => {
                  const r = reason.trim()
                  if (r.length === 0 || confirming == null) return
                  const action = confirming
                  setConfirming(null)
                  void runOp(action, r)
                }}
                disabled={reason.trim().length === 0}
                style={confirming === 'reject'
                  ? { height: 30, padding: '0 14px', borderRadius: 6, cursor: 'pointer', background: theme.button.danger, border: 'none', color: '#0A0B0E', fontSize: 12, fontWeight: 600 }
                  : { height: 30, padding: '0 14px', borderRadius: 6, cursor: 'pointer', background: 'none', border: `1px solid ${v3theme.signal.locked}`, color: v3theme.signal.locked, fontSize: 12, fontWeight: 600 }}
              >
                {confirming === 'reject' ? '确认驳回' : '确认豁免'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
