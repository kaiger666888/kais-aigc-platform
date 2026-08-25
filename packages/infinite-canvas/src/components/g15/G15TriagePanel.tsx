/**
 * G15TriagePanel.tsx — G15 失败镜头分诊工作台(Phase 53-07 / VAR-04)。
 *
 * 独立 dock 面板(D-13:接口预留 Phase 54 gate 中心嵌入位)。分诊工作台
 * 不是 dashboard:无图表无花哨,安静列表 + sticky 动作条。
 *
 * 行 = 勾选 + shot_id mono + phase 徽章 + 错误类别徽章(signal 分级)+ 原因
 * 截断;点击行展开 take_log 条目与原始 error。批量:乐观 rowState 变更 →
 * canvasApi.g15Ops → 失败回滚 + toast(AssetLibrary handleSelect 同构)。
 * 重渲二次确认 = 组件内 state(D-14;豁免轻操作免确认——planner 裁定)。
 */
import { useEffect, useState } from 'react'
import { v3theme, theme } from '../../theme/catppuccin'
import { useG15TriageStore, type G15Category, type G15Row } from './g15TriageStore'
import { useCanvasStore } from '../../store/canvasStore'
import { g15Ops } from '../../services/canvasApi'

/** 错误类别分级:错误类 = 玫;流程类 = 金;take_verdict_* = 弱底;unknown = 弱灰。 */
function categoryStyle(cat: G15Category): { bg: string; color: string } {
  const errorKinds: G15Category[] = ['qc_vision_fail', 'engine_render_error', 'bgm_trigger']
  const flowKinds: G15Category[] = ['delegate_timeout', 'delegate_parse', 'schema_validation', 'needs_regenerate']
  if (errorKinds.includes(cat)) return { bg: 'rgba(221,106,130,0.12)', color: v3theme.signal.rejected }
  if (flowKinds.includes(cat)) return { bg: 'rgba(240,165,46,0.12)', color: v3theme.signal.stale }
  if (cat.startsWith('take_verdict_')) return { bg: v3theme.modalityWeak.text, color: theme.text.secondary }
  return { bg: 'rgba(255,255,255,0.06)', color: theme.text.secondary }
}

const PHASE_COLOR: Record<string, string> = {
  research: v3theme.modality.text,
  story: v3theme.modality.image,
  production: v3theme.modality.video,
  post: v3theme.modality.audio,
}
function phaseOf(p: string): string {
  if (/^p0?1|^p02/.test(p)) return 'research'
  if (/^p0?3|^p04|^p035/.test(p)) return 'story'
  if (/^p0?[5-9]|^p1[01]/.test(p)) return 'production'
  return 'post'
}

export default function G15TriagePanel(): React.ReactElement | null {
  const open = useG15TriageStore((s) => s.open)
  const rows = useG15TriageStore((s) => s.rows)
  const selected = useG15TriageStore((s) => s.selected)
  const expanded = useG15TriageStore((s) => s.expanded)
  const rowState = useG15TriageStore((s) => s.rowState)
  const setOpen = useG15TriageStore((s) => s.setOpen)
  const toggle = useG15TriageStore((s) => s.toggle)
  const selectAll = useG15TriageStore((s) => s.selectAll)
  const clearSelection = useG15TriageStore((s) => s.clear)
  const setExpanded = useG15TriageStore((s) => s.setExpanded)
  const markRows = useG15TriageStore((s) => s.markRows)
  const unmarkRows = useG15TriageStore((s) => s.unmarkRows)
  const projectId = useCanvasStore((s) => s.projectId) ?? 0
  const episodesId = useCanvasStore((s) => s.episodesId) ?? 0
  const showToast = useCanvasStore((s) => s.showToast)

  const [confirming, setConfirming] = useState<'requeue' | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const selectedIds = [...selected]
  const pending = rows.filter((r) => rowState[r.shotId] == null).length

  const runBatch = async (action: 'waive' | 'requeue'): Promise<void> => {
    if (selectedIds.length === 0) return
    if (selectedIds.length > 200) {
      showToast(`已选 ${selectedIds.length} 条超过单批上限 200,请分批操作`, 'warning')
      return
    }
    markRows(selectedIds, action === 'waive' ? 'waived' : 'requeued') // 乐观
    try {
      const r = await g15Ops(projectId, episodesId, action, selectedIds)
      // WBX-03:delivered=false = 桥未送达(端点 404/超时),仅入重试队列——
      // 不是成功。回滚乐观标记,toast 如实告知。
      if (!r.delivered) {
        unmarkRows(selectedIds)
        showToast(
          r.queued > 0
            ? `未送达（已入重试队列）——${action === 'waive' ? '豁免' : '重渲'}尚未生效`
            : `未送达且入队失败: ${(action === 'waive' ? '豁免' : '重渲')}请重试`,
          'error',
        )
        return
      }
      showToast(`已${action === 'waive' ? '豁免' : '下发重渲'} ${selectedIds.length} 个镜头`, 'success')
    } catch (err) {
      unmarkRows(selectedIds) // 回滚
      showToast(`${action === 'waive' ? '豁免' : '重渲'}失败已回滚: ${(err as Error).message}`, 'error')
    }
  }

  return (
    <div
      data-testid="g15-triage-panel"
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, maxWidth: '90vw',
        background: theme.bg.panel, borderLeft: `1px solid ${theme.border.default}`,
        display: 'flex', flexDirection: 'column', zIndex: 35,
        boxShadow: '-8px 0 24px rgba(0,0,0,0.35)',
      }}
    >
      {/* 头部 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${theme.border.default}`, background: theme.bg.card,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🩹</span>
          <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: 13 }}>G15 失败镜头分诊</span>
          <span style={{ color: theme.text.secondary, fontSize: 11 }}>待处置 {pending}</span>
        </div>
        <button onClick={() => setOpen(false)} style={closeBtnStyle}>✕</button>
      </div>

      {/* 行列表 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {rows.map((r) => (
          <Row
            key={r.shotId}
            row={r}
            checked={selected.has(r.shotId)}
            expanded={expanded === r.shotId}
            state={rowState[r.shotId]}
            onToggle={() => toggle(r.shotId)}
            onExpand={() => setExpanded(r.shotId)}
          />
        ))}
        {rows.length === 0 && (
          <div style={{ padding: 24, color: theme.text.secondary, fontSize: 12, textAlign: 'center' }}>
            当前没有失败镜头 —— 管线跑完即空。
          </div>
        )}
      </div>

      {/* sticky 动作条(含重渲二次确认层) */}
      <div style={{ borderTop: `1px solid ${theme.border.default}`, background: theme.bg.card, padding: '10px 14px' }}>
        {confirming === 'requeue' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ color: v3theme.signal.stale, fontSize: 12 }}>
              确认对 {selectedIds.length} 个镜头下发重渲?(GPU 串行贵操作)
            </span>
            <button
              data-testid="g15-confirm-requeue"
              onClick={() => { setConfirming(null); void runBatch('requeue') }}
              style={{ ...btnStyle, borderColor: v3theme.signal.stale, color: v3theme.signal.stale }}
            >
              确认重渲
            </button>
            <button onClick={() => setConfirming(null)} style={btnStyle}>取消</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: theme.text.secondary, fontSize: 12, flex: 1 }}>
              已选 {selectedIds.length}
            </span>
            <button onClick={selectAll} style={btnStyle}>全选</button>
            <button onClick={clearSelection} style={btnStyle}>清空</button>
            <button
              data-testid="g15-batch-waive"
              disabled={selectedIds.length === 0}
              onClick={() => void runBatch('waive')}
              style={{ ...btnStyle, opacity: selectedIds.length === 0 ? 0.45 : 1 }}
            >
              批量豁免
            </button>
            <button
              data-testid="g15-batch-requeue"
              disabled={selectedIds.length === 0}
              onClick={() => setConfirming('requeue')}
              style={{ ...btnStyle, opacity: selectedIds.length === 0 ? 0.45 : 1, borderColor: v3theme.signal.stale }}
            >
              批量重渲
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ row, checked, expanded, state, onToggle, onExpand }: {
  row: G15Row
  checked: boolean
  expanded: boolean
  state?: 'waived' | 'requeued'
  onToggle: () => void
  onExpand: () => void
}): React.ReactElement {
  const cat = categoryStyle(row.category)
  return (
    <div style={{ borderBottom: `1px solid ${theme.border.default}`, background: theme.bg.card }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
        <input type="checkbox" checked={checked} onChange={onToggle} data-testid={`g15-check-${row.shotId}`} />
        <span
          onClick={onExpand}
          style={{ flex: 1, minWidth: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <span style={{ fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 12, color: theme.text.primary }}>
            {row.shotId}
          </span>
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4,
            background: v3theme.modalityWeak.video, color: PHASE_COLOR[phaseOf(row.phase)] ?? theme.text.secondary,
          }}>
            {row.phase}
          </span>
          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: cat.bg, color: cat.color }}>
            {row.category}
          </span>
          <span style={{
            fontSize: 11, color: theme.text.secondary,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
          }}>
            {row.reason}
          </span>
          {state && (
            <span style={{ fontSize: 10, color: state === 'waived' ? v3theme.signal.approved : v3theme.signal.stale }}>
              {state === 'waived' ? '已豁免' : '重渲中'}
            </span>
          )}
        </span>
      </div>
      {expanded && (
        <div style={{ padding: '6px 12px 10px 32px' }}>
          {row.takes && row.takes.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {row.takes.map((t, i) => (
                <div key={i} style={{ fontSize: 11, color: theme.text.secondary, lineHeight: 1.7 }}>
                  take {t.take_n ?? '?'} · {t.changed_variable ?? '-'} · seed {t.seed ?? '-'} · {t.verdict ?? '-'} — {t.evidence ?? ''}
                </div>
              ))}
            </div>
          )}
          {row.rawError && (
            <pre style={{
              margin: 0, padding: 8, background: 'var(--cv-bg-overlay, #1E2128)',
              border: `1px solid ${theme.border.default}`, borderRadius: 6,
              fontFamily: 'var(--cv-font-mono, monospace)', fontSize: 10.5,
              color: theme.text.secondary, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto',
            }}>
              {row.rawError}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: theme.bg.card, color: theme.text.primary,
  border: `1px solid ${theme.border.default}`, borderRadius: 6,
  fontSize: 12, padding: '4px 10px', cursor: 'pointer',
}

const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: theme.text.secondary, fontSize: 16,
  cursor: 'pointer', padding: '2px 6px', lineHeight: 1, borderRadius: 4,
}
