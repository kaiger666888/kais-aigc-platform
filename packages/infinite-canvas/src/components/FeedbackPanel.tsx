import { useCallback, useEffect, useState } from 'react'
import { theme, catppuccin, getScoreColor } from '../theme/catppuccin'
import {
  createFeedback,
  getFeedback,
  getPropagation,
  updateFeedbackStatus,
  type FeedbackEntry,
  type PropagationResult,
} from '../services/canvasApi'
import { useCanvasStore } from '../store/canvasStore'

const verdictLabels: Record<string, string> = {
  approve: '通过',
  reject: '驳回',
  contest: '争议',
  note: '备注',
}

const verdictColor: Record<string, string> = {
  approve: catppuccin.green,
  reject: catppuccin.red,
  contest: catppuccin.yellow,
  note: catppuccin.blue,
}

const statusLabels: Record<string, string> = {
  open: '待处理',
  acknowledged: '已确认',
  resolved: '已解决',
  contested: '争议中',
}

const statusColor: Record<string, string> = {
  open: catppuccin.yellow,
  acknowledged: catppuccin.blue,
  resolved: catppuccin.green,
  contested: catppuccin.peach,
}

function formatTime(ts: number): string {
  try {
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

/**
 * Asset Feedback Layer — full timeline + submit form. Rendered inside
 * NodeDetailPanel when the user clicks the "💬 反馈" tab.
 */
export default function FeedbackPanel({ nodeId }: { nodeId: string }) {
  const projectId = useCanvasStore((s) => s.projectId)
  const nodes = useCanvasStore((s) => s.nodes)
  const showToast = useCanvasStore((s) => s.showToast)
  const setIterationPanelOpen = useCanvasStore((s) => s.setIterationPanelOpen)
  const nodeExistsInGraph = nodes.some((n) => n.id === nodeId)
  const [entries, setEntries] = useState<FeedbackEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [propagation, setPropagation] = useState<PropagationResult | null>(null)
  const [showAffected, setShowAffected] = useState<boolean>(false)

  const [score, setScore] = useState<number>(0.8)
  const [verdict, setVerdict] = useState<string>('note')
  const [content, setContent] = useState<string>('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await getFeedback(nodeId)
      setEntries(list)
    } finally {
      setLoading(false)
    }
  }, [nodeId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Fetch propagation (downstream/upstream) for the "受影响节点" section.
  // projectId is required by the backend to locate the canvas graph.
  useEffect(() => {
    if (!projectId) {
      setPropagation(null)
      return
    }
    let cancelled = false
    getPropagation(nodeId, projectId).then((p) => {
      if (!cancelled) setPropagation(p)
    })
    return () => {
      cancelled = true
    }
  }, [nodeId, projectId])

  const handleSubmit = async () => {
    if (!projectId) {
      alert('未选择项目，无法提交反馈')
      return
    }
    if (!nodeExistsInGraph) {
      alert('该节点尚未保存到画布图,请先点击"💾 保存"持久化节点后再提交反馈')
      return
    }
    setSubmitting(true)
    try {
      await createFeedback({
        assetId: nodeId,
        projectId,
        score,
        verdict,
        content,
        source: 'human',
        reviewer: 'Kai',
      })
      setContent('')
      await refresh()
      // D — 驳回反馈触发引导:迭代面板自动展开,让用户决定是否调
      // /v1/iteration/plan。不直接自动调用,因为 deprecated /plan 端点
      // 会 spawnSync LLM,在 token 失效时挂起 Express backend。
      if (verdict === 'reject') {
        showToast('已记录驳回反馈,迭代面板已展开,可触发修复诊断', 'warning')
        setIterationPanelOpen(true)
      } else {
        showToast(`已记录${verdictLabels[verdict] ?? verdict}反馈`, 'success')
      }
    } catch (err: any) {
      alert('提交失败: ' + (err?.message ?? String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await updateFeedbackStatus(id, status)
      await refresh()
    } catch (err: any) {
      alert('更新失败: ' + (err?.message ?? String(err)))
    }
  }

  const scored = entries.filter((e) => e.score != null)
  const avg = scored.length > 0 ? scored.reduce((s, e) => s + (e.score as number), 0) / scored.length : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 顶部统计条 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        background: theme.bg.surface,
        borderRadius: 8,
      }}>
        <span style={{ color: theme.text.secondary, fontSize: 12 }}>共 {entries.length} 条反馈</span>
        {avg != null && (
          <span style={{
            color: getScoreColor(avg),
            fontSize: 14,
            fontWeight: 700,
          }}>
            均分 {(avg * 100).toFixed(0)}
          </span>
        )}
      </div>

      {/* 反馈时间线 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '40vh', overflowY: 'auto' }}>
        {loading && entries.length === 0 && (
          <div style={{ color: theme.text.secondary, fontSize: 12, textAlign: 'center', padding: 16 }}>
            加载中…
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div style={{ color: theme.text.secondary, fontSize: 12, textAlign: 'center', padding: 16 }}>
            暂无反馈。在下方表单提交第一条。
          </div>
        )}
        {entries.map((e) => {
          const vColor = e.verdict ? verdictColor[e.verdict] ?? catppuccin.surface2 : catppuccin.surface2
          const sColor = e.status ? statusColor[e.status] ?? catppuccin.surface2 : catppuccin.surface2
          return (
            <div key={e.id} style={{
              background: theme.bg.input,
              borderRadius: 8,
              padding: 10,
              borderLeft: `3px solid ${vColor}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: theme.text.secondary }}>
                <span style={{ color: vColor, fontWeight: 600 }}>
                  {e.verdict ? verdictLabels[e.verdict] ?? e.verdict : '未评级'}
                </span>
                {e.score != null && (
                  <span style={{ color: getScoreColor(e.score), fontWeight: 600 }}>
                    {(e.score * 100).toFixed(0)}
                  </span>
                )}
                <span>·</span>
                <span>{e.reviewer || e.source}</span>
                <span>·</span>
                <span>{formatTime(e.createdAt)}</span>
                {e.status && e.status !== 'open' && (
                  <span style={{
                    color: theme.text.onAccent,
                    background: sColor,
                    padding: '1px 6px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                  }}>
                    {statusLabels[e.status] ?? e.status}
                  </span>
                )}
              </div>
              {e.content && (
                <div style={{
                  color: theme.text.primary,
                  fontSize: 12,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {e.content}
                </div>
              )}
              {Array.isArray(e.tags) && e.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {e.tags.map((t, i) => (
                    <span key={i} style={{
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: theme.bg.surface,
                      color: theme.text.secondary,
                      fontSize: 10,
                    }}>
                      #{t}
                    </span>
                  ))}
                </div>
              )}
              <select
                value={e.status ?? 'open'}
                onChange={(ev) => handleStatusChange(e.id, ev.target.value)}
                style={{
                  alignSelf: 'flex-start',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: theme.bg.surface,
                  border: `1px solid ${theme.border.subtle}`,
                  color: theme.text.secondary,
                  fontSize: 11,
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="open">待处理</option>
                <option value="acknowledged">已确认</option>
                <option value="resolved">已解决</option>
                <option value="contested">争议中</option>
              </select>
            </div>
          )
        })}
      </div>

      {/* 受影响节点 — 拓扑传播可视化 */}
      {propagation && (propagation.downstream.length > 0 || propagation.upstream.length > 0) && (
        <AffectedNodesSection
          propagation={propagation}
          collapsed={!showAffected}
          onToggle={() => setShowAffected((v) => !v)}
        />
      )}

      {/* 提交表单 */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        background: theme.bg.input,
        borderRadius: 8,
        border: `1px solid ${theme.border.subtle}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: theme.text.secondary, minWidth: 36 }}>评分</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={score}
            onChange={(e) => setScore(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 12, fontWeight: 700, color: getScoreColor(score), minWidth: 32, textAlign: 'right' }}>
            {(score * 100).toFixed(0)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: theme.text.secondary, minWidth: 36 }}>判定</span>
          <select
            value={verdict}
            onChange={(e) => setVerdict(e.target.value)}
            style={{
              flex: 1,
              padding: '4px 8px',
              borderRadius: 6,
              background: theme.bg.surface,
              border: `1px solid ${theme.border.subtle}`,
              color: theme.text.primary,
              fontSize: 12,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="approve">✓ 通过</option>
            <option value="reject">✗ 驳回</option>
            <option value="contest">⚠ 争议</option>
            <option value="note">💬 备注</option>
          </select>
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="反馈内容（可选）…"
          rows={3}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            background: theme.bg.surface,
            border: `1px solid ${theme.border.subtle}`,
            color: theme.text.primary,
            fontSize: 12,
            fontFamily: 'inherit',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        <button
          onClick={handleSubmit}
          disabled={submitting || !projectId || !nodeExistsInGraph}
          style={{
            alignSelf: 'flex-end',
            padding: '6px 16px',
            borderRadius: 6,
            background: submitting || !projectId || !nodeExistsInGraph ? theme.bg.surface : theme.button.primary,
            color: theme.text.onAccent,
            border: 'none',
            fontSize: 12,
            fontWeight: 600,
            cursor: submitting || !projectId || !nodeExistsInGraph ? 'not-allowed' : 'pointer',
            opacity: submitting || !projectId || !nodeExistsInGraph ? 0.6 : 1,
          }}
        >
          {submitting ? '提交中…' : '提交反馈'}
        </button>
        {!nodeExistsInGraph && (
          <div style={{
            fontSize: 11,
            color: catppuccin.peach,
            textAlign: 'right',
            marginTop: -4,
          }}>
            ⚠ 该节点尚未保存到画布,请先点"💾 保存"
          </div>
        )}
      </div>
    </div>
  )
}

// ─── AffectedNodesSection — 受影响节点 ─────────────────────

function AffectedNodesSection({
  propagation,
  collapsed,
  onToggle,
}: {
  propagation: PropagationResult
  collapsed: boolean
  onToggle: () => void
}) {
  // Build a lookup: assetId → feedback info
  const fbByAsset = new Map(propagation.affectedWithFeedback.map((f) => [f.assetId, f]))
  const downCount = propagation.downstream.length
  const upCount = propagation.upstream.length
  // Count reject feedbacks downstream (for red dot indicators)
  const downRejectCount = propagation.downstream.filter((id) => fbByAsset.get(id)?.latestVerdict === 'reject').length
  const upApproveCount = propagation.upstream.filter((id) => fbByAsset.get(id)?.latestVerdict === 'approve').length

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 12,
      background: theme.bg.input,
      borderRadius: 8,
      border: `1px solid ${theme.border.subtle}`,
    }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'none',
          border: 'none',
          color: theme.text.primary,
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <span>
          受影响节点
          <span style={{ marginLeft: 8, color: theme.text.secondary, fontWeight: 500 }}>
            下游 {downCount}{downRejectCount > 0 && (
              <span style={{ color: catppuccin.red }}>（{downRejectCount} 驳回）</span>
            )}
            <span style={{ margin: '0 6px', color: theme.border.subtle }}>·</span>
            上游 {upCount}{upApproveCount > 0 && (
              <span style={{ color: catppuccin.green }}>（{upApproveCount} 通过）</span>
            )}
          </span>
        </span>
        <span style={{ color: theme.text.secondary }}>{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <>
          {downCount > 0 && (
            <AffectedNodeList
              title="下游"
              ids={propagation.downstream}
              fbByAsset={fbByAsset}
              dotFor="reject"
            />
          )}
          {upCount > 0 && (
            <AffectedNodeList
              title="上游"
              ids={propagation.upstream}
              fbByAsset={fbByAsset}
              dotFor="approve"
            />
          )}
        </>
      )}
    </div>
  )
}

function AffectedNodeList({
  title,
  ids,
  fbByAsset,
  dotFor,
}: {
  title: string
  ids: string[]
  fbByAsset: Map<string, { assetId: string; latestVerdict: string | null; avgScore: number | null; count: number }>
  dotFor: 'reject' | 'approve'
}) {
  const dotColor = (verdict: string | null | undefined) => {
    if (verdict === dotFor) return dotFor === 'reject' ? catppuccin.red : catppuccin.green
    if (verdict === 'contest') return catppuccin.yellow
    if (verdict === 'note') return catppuccin.blue
    return catppuccin.surface2
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, color: theme.text.secondary, fontWeight: 600 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 160, overflowY: 'auto' }}>
        {ids.map((id) => {
          const fb = fbByAsset.get(id)
          const verdict = fb?.latestVerdict
          const color = dotColor(verdict)
          return (
            <div key={id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 6px',
              background: theme.bg.surface,
              borderRadius: 4,
              fontSize: 11,
            }}>
              <span style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: color,
                flexShrink: 0,
              }} />
              <span style={{
                color: theme.text.primary,
                fontFamily: 'monospace',
                fontSize: 10,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {id}
              </span>
              {verdict && (
                <span style={{
                  color: verdictColor[verdict] ?? catppuccin.surface2,
                  fontWeight: 600,
                  fontSize: 10,
                }}>
                  {verdictLabels[verdict] ?? verdict}
                </span>
              )}
              {fb?.avgScore != null && (
                <span style={{
                  color: getScoreColor(fb.avgScore),
                  fontWeight: 600,
                  fontSize: 10,
                }}>
                  {(fb.avgScore * 100).toFixed(0)}
                </span>
              )}
              {fb && fb.count > 0 && (
                <span style={{ color: theme.text.secondary, fontSize: 10 }}>×{fb.count}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
