import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type JSX,
} from 'react'
import type { Node } from '@xyflow/react'
import { theme } from '../theme/catppuccin'
import { useCanvasStore } from '../store/canvasStore'
import { approveNode, rejectNode } from '../services/canvasApi'
import {
  detectVariantStyle,
  type VariantCandidate,
  type EpisodeInfo,
  type EpisodeScene,
  type VariantGroupNodeData,
  type VariantStyleTag,
  type VariantReviewLoadingState,
  type VariantGroupUIState,
} from '../types/canvas'

// ─── 小工具 ────────────────────────────────────────────────

/** memo 工厂 — 集中包 memo,免去每个组件重复 import { memo } */
function memoized<P extends object>(Component: (props: P) => JSX.Element) {
  return memo(Component) as (props: P) => JSX.Element
}

/** 把文本截断到指定长度并加上省略号 */
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

// ─── 颜色映射 ──────────────────────────────────────────────

const VARIANT_STYLE_COLOR: Record<VariantStyleTag, string> = {
  alpha: '#94e2d5',
  beta: '#cba6f7',
  gamma: '#fab387',
}

// ─── 本地 UI 状态机 ────────────────────────────────────────
//
// 替代 4 个 useState (selectedId, selectedForReview, confirmed, error + reviewLoading)。
// 用 reducer 的好处:状态间约束 (例如 SET_ERROR 一并把 reviewLoading 复位)
// 集中表达,而不是依赖每个调用点记得同时改两个 state。

type VariantGroupAction =
  | { type: 'TOGGLE_SELECT'; id: string }
  | { type: 'TOGGLE_REVIEW_SELECT'; id: string }
  | { type: 'CLEAR_REVIEW_SELECT' }
  | { type: 'SET_CONFIRMED'; value: boolean }
  | { type: 'SET_REVIEW_LOADING'; value: VariantReviewLoadingState }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'RESET' }

const INITIAL_UI_STATE: VariantGroupUIState = {
  selectedId: null,
  selectedForReview: null,
  confirmed: false,
  reviewLoading: 'idle',
  error: null,
}

function variantGroupReducer(
  state: VariantGroupUIState,
  action: VariantGroupAction,
): VariantGroupUIState {
  switch (action.type) {
    case 'TOGGLE_SELECT':
      return {
        ...state,
        selectedId: state.selectedId === action.id ? null : action.id,
        error: null,
      }
    case 'TOGGLE_REVIEW_SELECT':
      return {
        ...state,
        selectedForReview: state.selectedForReview === action.id ? null : action.id,
        error: null,
      }
    case 'CLEAR_REVIEW_SELECT':
      return { ...state, selectedForReview: null, error: null }
    case 'SET_CONFIRMED':
      return { ...state, confirmed: action.value, reviewLoading: 'idle' }
    case 'SET_REVIEW_LOADING':
      return { ...state, reviewLoading: action.value }
    case 'SET_ERROR':
      return { ...state, error: action.error, reviewLoading: 'idle' }
    case 'CLEAR_ERROR':
      return { ...state, error: null }
    case 'RESET':
      return INITIAL_UI_STATE
    default:
      return state
  }
}

// ─── 业务逻辑 hook ─────────────────────────────────────────
//
// 这里集中处理:候选解析、审核操作 (approve/reject/confirm)、错误展示。
// 之前用 `await import('../services/canvasApi')` 是过早优化,且每次操作都
// 多走一次模块解析 — 现在改为顶部静态 import。

export function useVariantGroup(node: Node) {
  const data = node.data as VariantGroupNodeData
  const allNodes = useCanvasStore((s) => s.nodes)
  const showToast = useCanvasStore((s) => s.showToast)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)
  const [state, dispatch] = useReducer(variantGroupReducer, INITIAL_UI_STATE)

  const candidates = useMemo<VariantCandidate[]>(() => {
    const direct = data.candidates
    if (direct && direct.length > 0) return direct
    const vgIds = data.variantNodeIds
    if (vgIds && vgIds.length > 0) {
      const idSet = new Set(vgIds)
      return allNodes
        .filter((n) => idSet.has(n.id))
        .map((n) => ({ id: n.id, ...(n.data as Record<string, unknown>) }) as VariantCandidate)
    }
    return []
  }, [data.candidates, data.variantNodeIds, allNodes])

  const selectedReviewCandidate = useMemo(
    () =>
      state.selectedForReview
        ? (candidates.find((c) => c.id === state.selectedForReview) ?? null)
        : null,
    [state.selectedForReview, candidates],
  )

  const handleApprove = useCallback(async () => {
    if (!selectedReviewCandidate || !projectId || !episodesId) return
    dispatch({ type: 'SET_REVIEW_LOADING', value: 'approving' })
    try {
      await approveNode(projectId, episodesId, node.id, selectedReviewCandidate.id)
      dispatch({ type: 'CLEAR_REVIEW_SELECT' })
      showToast(`✅ 审核通过: ${selectedReviewCandidate.label ?? '候选'}`, 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '审核失败'
      dispatch({ type: 'SET_ERROR', error: msg })
      showToast(msg, 'error')
    }
  }, [selectedReviewCandidate, projectId, episodesId, node.id, showToast])

  const handleReject = useCallback(async () => {
    if (!selectedReviewCandidate || !projectId || !episodesId) return
    dispatch({ type: 'SET_REVIEW_LOADING', value: 'rejecting' })
    try {
      await rejectNode(projectId, episodesId, node.id, '需要重新选择方案')
      dispatch({ type: 'CLEAR_REVIEW_SELECT' })
      showToast(`❌ 已驳回: ${selectedReviewCandidate.label ?? '候选'}`, 'warning')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '驳回失败'
      dispatch({ type: 'SET_ERROR', error: msg })
      showToast(msg, 'error')
    }
  }, [selectedReviewCandidate, projectId, episodesId, node.id, showToast])

  const handleConfirm = useCallback(async () => {
    if (!state.selectedId || !projectId || !episodesId || state.confirmed) return
    dispatch({ type: 'SET_REVIEW_LOADING', value: 'confirming' })
    try {
      await approveNode(projectId, episodesId, node.id, state.selectedId)
      dispatch({ type: 'SET_CONFIRMED', value: true })
      showToast(`已确认选择: ${state.selectedId}`, 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '确认失败'
      dispatch({ type: 'SET_ERROR', error: msg })
      showToast(msg, 'error')
    }
  }, [state.selectedId, state.confirmed, projectId, episodesId, node.id, showToast])

  return {
    data,
    candidates,
    selectedReviewCandidate,
    state,
    dispatch,
    handleApprove,
    handleReject,
    handleConfirm,
  }
}

// ─── 子组件 ────────────────────────────────────────────────

/** 区块标题 — 与 NodeDetailPanel 风格一致 */
const SectionLabel = memoized(function SectionLabel({
  children,
}: {
  children: React.ReactNode
}): JSX.Element {
  return (
    <div
      style={{
        color: theme.text.secondary,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 8,
        marginTop: 16,
      }}
    >
      {children}
    </div>
  )
})

/** 场景列表 (展开后完整显示所有场景,单个场景超过 100 字仍截断) */
const SceneList = memoized(function SceneList({
  scenes,
}: {
  scenes: EpisodeScene[] | string[]
}): JSX.Element {
  return (
    <div style={{ marginTop: 4 }}>
      <strong style={{ color: theme.text.primary }}>🎬 场景 ({scenes.length}):</strong>
      {scenes.map((sc, si) => {
        const text = typeof sc === 'string' ? sc : (sc.content ?? '')
        return (
          <div
            key={si}
            style={{
              marginTop: 2,
              paddingLeft: 8,
              borderLeft: `2px solid ${theme.border.dim}`,
              color: theme.text.secondary,
              fontSize: 10,
              lineHeight: 1.5,
            }}
          >
            {text}
          </div>
        )
      })}
    </div>
  )
})

/** 剧集预览列表 */
const EpisodePreview = memoized(function EpisodePreview({
  episodes,
}: {
  episodes: EpisodeInfo[]
}): JSX.Element {
  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${theme.border.dim}`, paddingTop: 8 }}>
      <strong style={{ color: theme.text.primary }}>📖 剧集预览 ({episodes.length}集)</strong>
      {episodes.map((ep, ei) => {
        const epLabel = ep.ep ?? `EP${ei + 1}`
        const scenes = Array.isArray(ep.scenes) ? ep.scenes : []
        return (
          <div
            key={ei}
            style={{
              marginTop: 8,
              padding: 8,
              background: theme.bg.surface,
              borderRadius: 6,
              border: `1px solid ${theme.border.dim}`,
            }}
          >
            <div style={{ fontWeight: 600, color: theme.text.primary, fontSize: 12 }}>
              {epLabel}: {ep.title}
            </div>
            {ep.logline && <div style={{ marginTop: 2, color: theme.text.secondary }}>{ep.logline}</div>}
            {ep.fantasy && (
              <div style={{ marginTop: 4, color: theme.text.secondary }}>
                <strong style={{ color: theme.text.primary }}>✨ 奇幻:</strong> {ep.fantasy}
              </div>
            )}
            {ep.signature_shot && (
              <div style={{ marginTop: 2, color: theme.text.secondary }}>
                <strong style={{ color: theme.text.primary }}>🎬 定格:</strong> {ep.signature_shot}
              </div>
            )}
            {ep.hook_ending && (
              <div style={{ marginTop: 2, color: theme.text.secondary }}>
                <strong style={{ color: theme.text.primary }}>🪝 钩子:</strong> {ep.hook_ending}
              </div>
            )}
            {ep.plot_twist && (
              <div style={{ marginTop: 2, color: theme.text.secondary }}>
                <strong style={{ color: theme.text.primary }}>🔄 反转:</strong> {ep.plot_twist}
              </div>
            )}
            {scenes.length > 0 && <SceneList scenes={scenes} />}
          </div>
        )
      })}
    </div>
  )
})

/** 候选展开后的详情块 (核心命题、亮点、剧集预览等) */
const ExpandedCandidateDetail = memoized(function ExpandedCandidateDetail({
  candidate,
}: {
  candidate: VariantCandidate
}): JSX.Element {
  const episodes = Array.isArray(candidate.episodes) ? candidate.episodes : []
  return (
    <div
      style={{
        marginLeft: 32,
        marginTop: 8,
        padding: 10,
        background: theme.bg.panel,
        borderRadius: 6,
        fontSize: 11,
        lineHeight: 1.6,
        color: theme.text.secondary,
      }}
    >
      {candidate.topic_kernel && (
        <div><strong style={{ color: theme.text.primary }}>核心命题:</strong>{candidate.topic_kernel}</div>
      )}
      {candidate.highlight && (
        <div style={{ marginTop: 4 }}><strong style={{ color: theme.text.primary }}>亮点:</strong>{candidate.highlight}</div>
      )}
      {candidate.emotional_resonance && (
        <div style={{ marginTop: 4 }}><strong style={{ color: theme.text.primary }}>情绪维度:</strong>{candidate.emotional_resonance}</div>
      )}
      {candidate.safety_score != null && (
        <div style={{ marginTop: 4 }}><strong style={{ color: theme.text.primary }}>安全分:</strong>{candidate.safety_score}/10</div>
      )}
      {candidate.genre_tag && (
        <div style={{ marginTop: 4 }}><strong style={{ color: theme.text.primary }}>类型:</strong>{candidate.genre_tag}</div>
      )}
      {episodes.length > 0 && <EpisodePreview episodes={episodes} />}
    </div>
  )
})

interface CandidateCardProps {
  candidate: VariantCandidate
  index: number
  isSelected: boolean
  isForReview: boolean
  variantStyle: VariantStyleTag | null
  onSelect: () => void
  onReviewSelect: () => void
}

/** 单个候选卡片 — 支持键盘操作和 ARIA */
const CandidateCard = memoized(function CandidateCard({
  candidate,
  index,
  isSelected,
  isForReview,
  variantStyle,
  onSelect,
  onReviewSelect,
}: CandidateCardProps): JSX.Element {
  const score = candidate.score
  const label = candidate.label ?? `候选 ${index + 1}`

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) onReviewSelect()
      else onSelect()
    } else if (e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`候选 ${index + 1}: ${label}。回车或空格选择,Shift+回车进入审核。`}
      onClick={onSelect}
      onDoubleClick={onReviewSelect}
      onKeyDown={handleKeyDown}
      style={{
        background: isSelected ? theme.bg.card : theme.bg.surface,
        border: `2px solid ${isSelected ? theme.node.script : isForReview ? '#94e2d5' : 'transparent'}`,
        borderRadius: 8,
        padding: 12,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        outline: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: theme.text.disabled, minWidth: 24 }}>
          #{index + 1}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, flex: 1 }}>
          {label}
        </span>
        {score != null && (
          <span
            aria-label={`评分 ${score} / 10`}
            style={{
              padding: '1px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 700,
              background:
                score >= 9 ? theme.state.success : score >= 7 ? theme.state.pending : theme.state.error,
              color: theme.text.onAccent,
            }}
          >
            ⭐ {score}
          </span>
        )}
        {isForReview && (
          <span
            style={{
              padding: '1px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 700,
              background: '#94e2d5',
              color: theme.text.onAccent,
            }}
          >
            ✓ 已选择审核
          </span>
        )}
        {variantStyle && (
          <span
            style={{
              padding: '1px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 700,
              background: VARIANT_STYLE_COLOR[variantStyle],
              color: theme.text.onAccent,
            }}
          >
            {variantStyle.toUpperCase()}
          </span>
        )}
      </div>

      {candidate.description && (
        <div
          style={{
            fontSize: 11,
            color: theme.text.secondary,
            lineHeight: 1.5,
            marginLeft: 32,
            maxHeight: isSelected ? 'none' : 40,
            overflow: 'hidden',
          }}
        >
          {candidate.description}
        </div>
      )}

      {Array.isArray(candidate.tags) && candidate.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginLeft: 32, marginTop: 6 }}>
          {candidate.tags.map((tag, ti) => (
            <span
              key={ti}
              style={{
                padding: '1px 6px',
                borderRadius: 3,
                fontSize: 10,
                background: theme.bg.panel,
                color: theme.node.script,
                fontWeight: 500,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {isSelected && <ExpandedCandidateDetail candidate={candidate} />}
    </div>
  )
})

interface ReviewBlockProps {
  candidate: VariantCandidate | null
  isApproving: boolean
  isRejecting: boolean
  onApprove: () => void
  onReject: () => void
  onCancel: () => void
}

/** 审核操作块 — 通过 / 驳回 / 取消 */
const ReviewBlock = memoized(function ReviewBlock({
  candidate,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
  onCancel,
}: ReviewBlockProps): JSX.Element {
  const label = candidate?.label
  const disabled = !candidate || isApproving || isRejecting

  return (
    <div
      role="region"
      aria-label="候选审核操作"
      style={{
        marginTop: 16,
        padding: 12,
        background: theme.bg.surface,
        borderRadius: 8,
        border: `1px solid ${theme.border.default}`,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: theme.status.awaiting,
          marginBottom: 8,
          textAlign: 'center',
        }}
      >
        {label ? `已选择「${label}」进行审核` : '选择候选进行审核'}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          disabled={disabled}
          aria-busy={isApproving}
          onClick={onApprove}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: theme.state.success,
            color: theme.text.onAccent,
            flex: 1,
            opacity: disabled ? 0.6 : 1,
          }}
        >
          {isApproving ? '⏳ 审核中...' : '✅ 审核通过'}
        </button>

        <button
          type="button"
          disabled={disabled}
          aria-busy={isRejecting}
          onClick={onReject}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: theme.state.rejected,
            color: theme.text.onAccent,
            flex: 1,
            opacity: disabled ? 0.6 : 1,
          }}
        >
          {isRejecting ? '⏳ 驳回中...' : '❌ 驳回'}
        </button>
      </div>

      {candidate && (
        <button
          type="button"
          onClick={onCancel}
          disabled={isApproving || isRejecting}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 500,
            border: `1px solid ${theme.border.dim}`,
            background: theme.bg.surface,
            color: theme.text.secondary,
            cursor: 'pointer',
            marginTop: 8,
          }}
        >
          取消审核选择
        </button>
      )}
    </div>
  )
})

// ─── 入口组件 ──────────────────────────────────────────────

export interface VariantGroupDetailProps {
  node: Node
}

export default function VariantGroupDetail({
  node,
}: VariantGroupDetailProps): JSX.Element {
  const {
    data,
    candidates,
    selectedReviewCandidate,
    state,
    dispatch,
    handleApprove,
    handleReject,
    handleConfirm,
  } = useVariantGroup(node)

  // 节点切换时复位 UI 状态 — 防止上次的 selectedId 残留
  useEffect(() => {
    dispatch({ type: 'RESET' })
  }, [node.id])

  const groupLabel = data.label || '候选列表'
  const showReviewBlock =
    !!selectedReviewCandidate || (data.reviewStatus === 'pending' && !state.confirmed)
  const isApproving = state.reviewLoading === 'approving'
  const isRejecting = state.reviewLoading === 'rejecting'
  const isConfirming = state.reviewLoading === 'confirming'
  const confirmDisabled = !state.selectedId || isConfirming || state.confirmed

  return (
    <>
      <SectionLabel>{groupLabel}</SectionLabel>
      <div style={{ fontSize: 12, color: theme.text.secondary, marginBottom: 12 }}>
        共 {candidates.length} 个候选,点击选择最佳方案
      </div>

      {state.error && (
        <div
          role="alert"
          style={{
            padding: 8,
            marginBottom: 8,
            borderRadius: 6,
            background: theme.state.error,
            color: theme.text.onAccent,
            fontSize: 12,
          }}
        >
          ⚠️ {state.error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {candidates.map((c, i) => (
          <CandidateCard
            key={c.id || i}
            candidate={c}
            index={i}
            isSelected={state.selectedId === c.id}
            isForReview={state.selectedForReview === c.id}
            variantStyle={detectVariantStyle(c.label)}
            onSelect={() => dispatch({ type: 'TOGGLE_SELECT', id: c.id })}
            onReviewSelect={() => dispatch({ type: 'TOGGLE_REVIEW_SELECT', id: c.id })}
          />
        ))}
      </div>

      {showReviewBlock && (
        <ReviewBlock
          candidate={selectedReviewCandidate}
          isApproving={isApproving}
          isRejecting={isRejecting}
          onApprove={handleApprove}
          onReject={handleReject}
          onCancel={() => dispatch({ type: 'CLEAR_REVIEW_SELECT' })}
        />
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: state.confirmed ? 16 : 8 }}>
        <button
          type="button"
          disabled={confirmDisabled}
          aria-busy={isConfirming}
          onClick={handleConfirm}
          style={{
            padding: '8px 20px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            cursor: !confirmDisabled ? 'pointer' : 'not-allowed',
            background:
              state.confirmed || state.selectedId ? theme.state.success : theme.bg.surface,
            color: state.selectedId ? theme.text.onAccent : theme.text.disabled,
            opacity: state.selectedId ? 1 : 0.5,
          }}
        >
          {isConfirming ? '⏳ 确认中...' : state.confirmed ? '✅ 已确认' : '✅ 确认选择'}
        </button>
        <button
          type="button"
          style={{
            padding: '8px 20px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            background: theme.bg.surface,
            color: theme.text.secondary,
          }}
        >
          🔄 重做
        </button>
      </div>
    </>
  )
}
