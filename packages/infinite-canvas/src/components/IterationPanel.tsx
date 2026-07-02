import { useCallback, useEffect, useMemo, useState } from 'react'
import { theme, catppuccin, getScoreColor } from '../theme/catppuccin'
import { useCanvasStore } from '../store/canvasStore'
import {
  approveAdjustment,
  confirmIteration,
  createIterationPlan,
  discardIteration,
  executeIteration,
  getIterationStatus,
  listIterationPlans,
  type IterationAction,
  type IterationPlan,
  type IterationResult,
} from '../services/canvasApi'

interface Props {
  /** Optional filter — when set, only show plans whose actions touch this nodeId. */
  filterNodeId?: string
  /** Compact mode (used inside NodeDetailPanel tab). */
  compact?: boolean
}

const diagnosisConfig = {
  reroll: {
    label: '抽卡问题',
    color: catppuccin.green,
    icon: '🎲',
    desc: '随机性失败,重跑即可,管线无需调整',
  },
  pipeline_adjust: {
    label: '系统性缺陷',
    color: catppuccin.peach,
    icon: '🔧',
    desc: '管线参数或 prompt 存在缺陷,需要调整后重生成',
  },
  upstream_fix: {
    label: '上游污染',
    color: catppuccin.red,
    icon: '⬆️',
    desc: '根因在上游节点,需回退重生成后再级联刷新',
  },
} as const

function formatConfidence(c: number): string {
  return `${Math.round(c * 100)}%`
}

/**
 * Iteration Engine panel — diagnosis card, action list, pipeline adjustment
 * confirmation, execution progress, and result review. Rendered both as a
 * toolbar-triggered overlay (compact=false) and as a NodeDetailPanel tab
 * (compact=true, filterNodeId set).
 */
export default function IterationPanel({ filterNodeId, compact = false }: Props) {
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)
  const iteration = useCanvasStore((s) => s.iteration)
  const setIterationPlan = useCanvasStore((s) => s.setIterationPlan)
  const updateIterationProgress = useCanvasStore((s) => s.updateIterationProgress)
  const setIterationError = useCanvasStore((s) => s.setIterationError)
  const setAdjustmentApproved = useCanvasStore((s) => s.setAdjustmentApproved)
  const setIterationPanelOpen = useCanvasStore((s) => s.setIterationPanelOpen)
  const pushIterationHistory = useCanvasStore((s) => s.pushIterationHistory)
  const setIterationHistory = useCanvasStore((s) => s.setIterationHistory)
  const resetIteration = useCanvasStore((s) => s.resetIteration)
  const showToast = useCanvasStore((s) => s.showToast)

  const [workdir, setWorkdir] = useState<string>('/data/workspace/default')
  const [polling, setPolling] = useState(false)

  // Load historical plans for the current project on mount (used by tab view).
  useEffect(() => {
    if (!projectId || !workdir) return
    let cancelled = false
    listIterationPlans(workdir, projectId, episodesId ?? undefined).then((plans) => {
      if (!cancelled) setIterationHistory(plans)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, episodesId, workdir, setIterationHistory])

  // Poll status while executing.
  useEffect(() => {
    if (iteration.status !== 'executing' || !iteration.plan) return
    setPolling(true)
    let cancelled = false
    const poll = async () => {
      while (!cancelled && iteration.plan) {
        try {
          const s = await getIterationStatus(workdir, iteration.plan.id)
          if (cancelled) return
          if (s.progress != null) {
            updateIterationProgress({})
          }
          if (s.status === 'done' || s.status === 'completed') {
            updateIterationProgress({ status: 'done' })
            showToast('迭代执行完成', 'success')
            return
          }
          if (s.status === 'failed' || s.status === 'error') {
            updateIterationProgress({ status: 'error', error: s.status })
            showToast('迭代执行失败', 'error')
            return
          }
        } catch {
          return
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
    poll().finally(() => setPolling(false))
    return () => {
      cancelled = true
    }
  }, [iteration.status, iteration.plan, workdir, updateIterationProgress, showToast])

  const handleDiagnose = useCallback(async () => {
    if (!projectId || !episodesId) {
      showToast('请先选择项目和剧本', 'warning')
      return
    }
    updateIterationProgress({ status: 'planning', error: null, panelOpen: true })
    try {
      const plan = await createIterationPlan(projectId, episodesId, workdir)
      setIterationPlan(plan)
      pushIterationHistory(plan)
      showToast(`诊断完成: ${plan.diagnosis.type}`, 'success')
    } catch (err: any) {
      setIterationError(err?.message ?? '诊断失败')
      showToast(`诊断失败: ${err?.message ?? '未知错误'}`, 'error')
    }
  }, [projectId, episodesId, workdir, updateIterationProgress, setIterationPlan, pushIterationHistory, setIterationError, showToast])

  const handleApproveAdjustment = useCallback(async () => {
    if (!iteration.plan) return
    try {
      await approveAdjustment(workdir, iteration.plan.id)
      setAdjustmentApproved(true)
      showToast('管线调整已批准', 'success')
    } catch (err: any) {
      showToast(`批准失败: ${err?.message ?? '未知错误'}`, 'error')
    }
  }, [iteration.plan, workdir, setAdjustmentApproved, showToast])

  const handleExecute = useCallback(async () => {
    if (!projectId || !episodesId || !iteration.plan) return
    if (iteration.plan.requiresApproval && !iteration.adjustmentApproved) {
      showToast('请先批准管线调整', 'warning')
      return
    }
    updateIterationProgress({ status: 'executing', error: null })
    try {
      const result = await executeIteration(projectId, episodesId, workdir, iteration.plan.id)
      updateIterationProgress({ status: 'done', result })
      const ok = result.regeneratedNodes.filter((n) => n.status === 'success').length
      const fail = result.regeneratedNodes.filter((n) => n.status === 'failed').length
      showToast(`迭代完成 (${ok} 成功${fail > 0 ? `,${fail} 失败` : ''})`, fail > 0 ? 'warning' : 'success')
    } catch (err: any) {
      updateIterationProgress({ status: 'error', error: err?.message ?? '执行失败' })
      showToast(`执行失败: ${err?.message ?? '未知错误'}`, 'error')
    }
  }, [projectId, episodesId, workdir, iteration.plan, iteration.adjustmentApproved, updateIterationProgress, showToast])

  const handleConfirm = useCallback(async () => {
    if (!projectId || !episodesId || !iteration.result) return
    try {
      await confirmIteration(projectId, episodesId, workdir, iteration.result.branchId)
      showToast('已确认保留迭代版本', 'success')
      resetIteration()
    } catch (err: any) {
      showToast(`确认失败: ${err?.message ?? '未知错误'}`, 'error')
    }
  }, [projectId, episodesId, workdir, iteration.result, resetIteration, showToast])

  const handleDiscard = useCallback(async () => {
    if (!projectId || !episodesId || !iteration.result) return
    try {
      await discardIteration(projectId, episodesId, workdir, iteration.result.branchId, '用户丢弃迭代版本')
      showToast('已丢弃迭代版本', 'info')
      resetIteration()
    } catch (err: any) {
      showToast(`丢弃失败: ${err?.message ?? '未知错误'}`, 'error')
    }
  }, [projectId, episodesId, workdir, iteration.result, resetIteration, showToast])

  const visiblePlans = useMemo(() => {
    if (!filterNodeId) return iteration.history
    return iteration.history.filter((p) => p.actions.some((a) => a.nodeId === filterNodeId))
  }, [iteration.history, filterNodeId])

  const containerStyle: React.CSSProperties = compact
    ? { display: 'flex', flexDirection: 'column', gap: 12 }
    : {
        position: 'absolute',
        top: 60,
        right: 16,
        width: 480,
        maxHeight: 'calc(100vh - 100px)',
        background: theme.bg.panel,
        border: `1px solid ${theme.border.default}`,
        borderRadius: 12,
        boxShadow: `0 8px 32px ${theme.chrome.shadow}`,
        zIndex: 15,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: compact ? '0 0 8px' : '12px 16px',
        borderBottom: compact ? 'none' : `1px solid ${theme.border.default}`,
        background: theme.bg.card,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🔄</span>
          <span style={{ color: theme.text.primary, fontWeight: 700, fontSize: 14 }}>
            迭代引擎
          </span>
          <StatusPill status={iteration.status} />
        </div>
        {!compact && (
          <button
            onClick={() => setIterationPanelOpen(false)}
            style={{
              background: 'none',
              border: 'none',
              color: theme.text.secondary,
              fontSize: 16,
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: compact ? 0 : 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        {/* Workdir input */}
        <WorkdirInput value={workdir} onChange={setWorkdir} disabled={iteration.status === 'executing' || iteration.status === 'planning'} />

        {/* Action row — diagnose / execute / confirm */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {iteration.status === 'idle' && (
            <ActionButton onClick={handleDiagnose} accent>
              🩺 开始诊断
            </ActionButton>
          )}
          {iteration.status === 'planning' && (
            <ActionButton disabled>
              <Spinner /> 诊断中…
            </ActionButton>
          )}
          {iteration.status === 'plan_ready' && iteration.plan && (
            <ActionButton
              onClick={handleExecute}
              disabled={iteration.plan.requiresApproval && !iteration.adjustmentApproved}
              accent
            >
              ▶️ 执行迭代 ({iteration.plan.actions.length} 个节点)
            </ActionButton>
          )}
          {iteration.status === 'executing' && (
            <ActionButton disabled>
              <Spinner /> 执行中… {polling ? '(轮询)' : ''}
            </ActionButton>
          )}
          {iteration.status === 'done' && iteration.result && (
            <>
              <ActionButton onClick={handleConfirm} accent>
                ✓ 确认保留
              </ActionButton>
              <ActionButton onClick={handleDiscard} danger>
                ✗ 丢弃
              </ActionButton>
            </>
          )}
          {iteration.status === 'error' && (
            <ActionButton onClick={handleDiagnose} accent>
              🩺 重新诊断
            </ActionButton>
          )}
          {(iteration.status !== 'idle' && iteration.status !== 'executing' && iteration.status !== 'planning') && (
            <ActionButton onClick={resetIteration}>
              ↺ 重置
            </ActionButton>
          )}
        </div>

        {/* Error banner */}
        {iteration.error && (
          <div style={{
            padding: '8px 12px',
            background: 'rgba(243,139,168,0.1)',
            border: `1px solid ${catppuccin.red}`,
            borderRadius: 8,
            color: catppuccin.red,
            fontSize: 12,
            lineHeight: 1.5,
          }}>
            ⚠️ {iteration.error}
          </div>
        )}

        {/* Diagnosis card */}
        {iteration.plan && (
          <DiagnosisCard plan={iteration.plan} />
        )}

        {/* Pipeline adjustment approval gate */}
        {iteration.plan?.requiresApproval && !iteration.adjustmentApproved && (
          <ApprovalGate plan={iteration.plan} onApprove={handleApproveAdjustment} />
        )}

        {/* Result review */}
        {iteration.result && (
          <ResultReview result={iteration.result} />
        )}

        {/* History (always visible in tab mode) */}
        {visiblePlans.length > 0 && (
          <HistoryList plans={visiblePlans} filterNodeId={filterNodeId} />
        )}

        {/* Empty state */}
        {iteration.status === 'idle' && visiblePlans.length === 0 && (
          <div style={{
            padding: 24,
            textAlign: 'center',
            color: theme.text.secondary,
            fontSize: 12,
            lineHeight: 1.6,
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔄</div>
            迭代引擎会根据反馈数据自动诊断失败模式 (抽卡 / 系统性缺陷 / 上游污染),
            <br />
            生成重生成计划,并在你确认后执行拓扑序重跑。
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string }> = {
    idle: { label: '空闲', color: catppuccin.surface2 },
    planning: { label: '诊断中', color: catppuccin.yellow },
    plan_ready: { label: '计划就绪', color: catppuccin.blue },
    executing: { label: '执行中', color: catppuccin.blue },
    done: { label: '完成', color: catppuccin.green },
    error: { label: '错误', color: catppuccin.red },
  }
  const c = config[status] ?? config.idle
  return (
    <span style={{
      padding: '1px 8px',
      borderRadius: 4,
      background: c.color,
      color: theme.text.onAccent,
      fontSize: 10,
      fontWeight: 700,
    }}>
      {c.label}
    </span>
  )
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block',
      width: 10,
      height: 10,
      borderRadius: '50%',
      border: `2px solid ${theme.border.default}`,
      borderTopColor: theme.text.primary,
      animation: 'spin 0.8s linear infinite',
      marginRight: 4,
      verticalAlign: 'middle',
    }} />
  )
}

function WorkdirInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: theme.text.secondary, fontWeight: 600 }}>
        工作目录 (workdir)
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="/data/workspace/<project>"
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          background: theme.bg.input,
          border: `1px solid ${theme.border.subtle}`,
          color: theme.text.primary,
          fontSize: 12,
          fontFamily: 'monospace',
          outline: 'none',
        }}
      />
    </div>
  )
}

function ActionButton({
  onClick,
  children,
  disabled,
  accent,
  danger,
}: {
  onClick?: () => void
  children: React.ReactNode
  disabled?: boolean
  accent?: boolean
  danger?: boolean
}) {
  const bg = disabled
    ? theme.bg.surface
    : danger
      ? theme.button.danger
      : accent
        ? theme.button.primary
        : theme.bg.card
  const color = disabled
    ? theme.text.disabled
    : (accent || danger)
      ? theme.text.onAccent
      : theme.text.primary
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 12px',
        borderRadius: 6,
        background: bg,
        color,
        border: `1px solid ${(accent || danger) && !disabled ? bg : theme.border.default}`,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  )
}

function DiagnosisCard({ plan }: { plan: IterationPlan }) {
  const d = plan.diagnosis
  const cfg = diagnosisConfig[d.type] ?? diagnosisConfig.reroll
  return (
    <div style={{
      background: theme.bg.input,
      borderRadius: 8,
      padding: 12,
      borderLeft: `4px solid ${cfg.color}`,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{cfg.icon}</span>
        <span style={{ color: cfg.color, fontWeight: 700, fontSize: 13 }}>
          {cfg.label}
        </span>
        <span style={{
          marginLeft: 'auto',
          color: getScoreColor(d.confidence),
          fontWeight: 700,
          fontSize: 12,
        }}>
          置信度 {formatConfidence(d.confidence)}
        </span>
      </div>
      <div style={{ color: theme.text.secondary, fontSize: 11, fontStyle: 'italic' }}>
        {cfg.desc}
      </div>
      <div style={{
        color: theme.text.primary,
        fontSize: 12,
        lineHeight: 1.5,
        padding: '6px 8px',
        background: theme.bg.surface,
        borderRadius: 4,
      }}>
        {d.rootCause}
      </div>
      {d.evidence.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, color: theme.text.secondary, fontWeight: 600 }}>
            证据
          </span>
          {d.evidence.map((e, i) => (
            <div key={i} style={{
              fontSize: 11,
              color: theme.text.primary,
              padding: '2px 0 2px 12px',
              borderLeft: `2px solid ${cfg.color}`,
              opacity: 0.5 + 0.5 * Math.max(0, 1 - i * 0.3),
            }}>
              • {e}
            </div>
          ))}
        </div>
      )}
      {plan.summary && (
        <div style={{
          fontSize: 11,
          color: theme.text.secondary,
          fontStyle: 'italic',
          marginTop: 4,
        }}>
          {plan.summary}
        </div>
      )}
    </div>
  )
}

function ApprovalGate({ plan, onApprove }: { plan: IterationPlan; onApprove: () => void }) {
  const adjustments = plan.actions
    .map((a) => a.pipelineAdjustment)
    .filter((adj): adj is NonNullable<IterationAction['pipelineAdjustment']> => adj != null)

  if (adjustments.length === 0) return null

  return (
    <div style={{
      background: 'rgba(250,179,135,0.08)',
      borderRadius: 8,
      padding: 12,
      border: `1px solid ${catppuccin.peach}`,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: catppuccin.peach, fontWeight: 700, fontSize: 12 }}>
          🔧 管线调整确认
        </span>
      </div>
      <div style={{ fontSize: 11, color: theme.text.secondary }}>
        本计划需要修改管线参数。请审阅后批准:
      </div>
      {adjustments.map((adj, i) => (
        <div key={i} style={{
          background: theme.bg.input,
          borderRadius: 6,
          padding: 8,
          fontSize: 11,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ color: theme.text.secondary }}>类型:</span>
            <span style={{ color: theme.text.primary, fontWeight: 600 }}>{adj.type}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ color: theme.text.secondary }}>目标:</span>
            <span style={{ color: theme.text.primary, fontFamily: 'monospace' }}>{adj.target}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ color: theme.text.secondary }}>变更:</span>
            <span style={{ color: theme.text.primary }}>{adj.change}</span>
          </div>
        </div>
      ))}
      <ActionButton onClick={onApprove} accent>
        ✓ 批准调整
      </ActionButton>
    </div>
  )
}

function ResultReview({ result }: { result: IterationResult }) {
  const success = result.regeneratedNodes.filter((n) => n.status === 'success')
  const failed = result.regeneratedNodes.filter((n) => n.status === 'failed')
  const pending = result.regeneratedNodes.filter((n) => n.status === 'pending')

  return (
    <div style={{
      background: theme.bg.input,
      borderRadius: 8,
      padding: 12,
      border: `1px solid ${theme.border.subtle}`,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span style={{ color: theme.text.primary, fontWeight: 700 }}>迭代结果</span>
        <span style={{ color: catppuccin.green, fontWeight: 600 }}>✓ {success.length}</span>
        <span style={{ color: catppuccin.red, fontWeight: 600 }}>✗ {failed.length}</span>
        {pending.length > 0 && (
          <span style={{ color: catppuccin.yellow, fontWeight: 600 }}>⏳ {pending.length}</span>
        )}
        <span style={{ color: theme.text.secondary, marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10 }}>
          分支: {result.branchId.slice(0, 12)}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
        {result.regeneratedNodes.map((n) => {
          const color = n.status === 'success'
            ? catppuccin.green
            : n.status === 'failed'
              ? catppuccin.red
              : catppuccin.yellow
          return (
            <div key={n.nodeId} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              background: theme.bg.surface,
              borderRadius: 4,
              fontSize: 11,
            }}>
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: color,
                flexShrink: 0,
              }} />
              <span style={{ fontFamily: 'monospace', color: theme.text.primary, flex: 1 }}>
                {n.nodeId}
              </span>
              {n.newNodeId && (
                <span style={{ color: theme.text.secondary, fontFamily: 'monospace' }}>
                  → {n.newNodeId.slice(0, 16)}
                </span>
              )}
              <span style={{
                color: n.status === 'success' ? catppuccin.green : n.status === 'failed' ? catppuccin.red : catppuccin.yellow,
                fontWeight: 600,
                fontSize: 10,
              }}>
                {n.status}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HistoryList({ plans, filterNodeId }: { plans: IterationPlan[]; filterNodeId?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: theme.text.secondary, fontWeight: 600 }}>
        {filterNodeId ? '该节点的迭代历史' : '迭代历史'} ({plans.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
        {plans.map((p) => {
          const cfg = diagnosisConfig[p.diagnosis.type] ?? diagnosisConfig.reroll
          const touchesThisNode = filterNodeId
            ? p.actions.some((a) => a.nodeId === filterNodeId)
            : true
          return (
            <div key={p.id} style={{
              padding: 8,
              borderRadius: 6,
              background: theme.bg.input,
              borderLeft: `3px solid ${cfg.color}`,
              fontSize: 11,
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              opacity: touchesThisNode ? 1 : 0.6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: cfg.color, fontWeight: 600 }}>
                  {cfg.icon} {cfg.label}
                </span>
                <span style={{
                  marginLeft: 'auto',
                  color: theme.text.secondary,
                  fontFamily: 'monospace',
                  fontSize: 10,
                }}>
                  {p.id.slice(0, 12)}
                </span>
              </div>
              <div style={{ color: theme.text.primary, lineHeight: 1.4 }}>
                {p.diagnosis.rootCause}
              </div>
              <div style={{ color: theme.text.secondary, fontSize: 10 }}>
                {p.actions.length} 个动作 · 置信度 {formatConfidence(p.diagnosis.confidence)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
