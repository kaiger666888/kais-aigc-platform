import { useState, useEffect } from 'react'
import { theme } from '../theme/catppuccin'

interface ReviewCardProps {
  filePath: string | undefined
  nodeId: string
  apiBase?: string
  onSelected?: (selection: string) => void
}

interface Episode {
  ep: string
  title: string
  logline: string
  emotion: string
  hook_ending?: string
}

interface ReviewOption {
  id: string
  label: string
  title: string
  logline: string
  emotion: string
  hook: string
  episodes: number
  beats: number
  episodeList: Episode[]
}

const variantColors: Record<string, string> = {
  alpha: '#94e2d5',
  beta: '#cba6f7',
  gamma: '#fab387',
}

const variantDescriptions: Record<string, string> = {
  alpha: '悬疑先行 — 像侦探片一样逐步揭露奶奶的激情人生，每一集都是一个谜题',
  beta: '均衡版 — 情感和悬疑平衡推进，温馨与反转交替，适合大众口味',
  gamma: '奇幻版 — 视觉诗意主导，空镜长镜头+氛围叙事，艺术电影质感',
}

/**
 * ReviewCard — 画布内审核选择卡片（完整版）
 */
export default function ReviewCard({ filePath, nodeId, apiBase = '', onSelected }: ReviewCardProps) {
  const [options, setOptions] = useState<ReviewOption[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    if (!filePath) return
    setLoading(true)
    setUnavailable(false)
    fetch(`${apiBase}/api/v2/canvas/review/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    })
      .then(r => {
        // 后端尚未实现 /api/v2/canvas/review/options —— 优雅 404 容错，不崩溃
        if (!r.ok) {
          console.warn('[ReviewCard] Review options API not implemented yet')
          setUnavailable(true)
          return null
        }
        return r.json()
      })
      .then(json => {
        if (!json) return
        if (json.code === 404) {
          console.warn('[ReviewCard] Review options API not implemented yet')
          setUnavailable(true)
          return
        }
        if (json.code === 200 && json.data?.options) {
          setOptions(json.data.options)
        }
      })
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false))
  }, [filePath, apiBase])

  const handleSubmit = (optionId: string) => {
    if (selected !== optionId) {
      setSelected(optionId)
      return
    }
    setSubmitting(true)
    fetch(`${apiBase}/api/v2/canvas/review/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 1, episodesId: 1, nodeId, selection: optionId }),
    })
      .then(r => {
        // 后端尚未实现 /api/v2/canvas/review/submit —— 优雅 404 容错，不崩溃
        if (!r.ok) {
          console.warn('[ReviewCard] Review submit API not implemented yet')
          return null
        }
        return r.json()
      })
      .then(json => {
        if (!json) return
        if (json.code === 404) {
          console.warn('[ReviewCard] Review submit API not implemented yet')
          return
        }
        if (json.code === 200) {
          setConfirmed(true)
          onSelected?.(optionId)
        }
      })
      .catch(() => {})
      .finally(() => setSubmitting(false))
  }

  if (!filePath) return null
  if (loading) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: theme.text.secondary, fontSize: 12 }}>
        ⏳ 加载审核选项...
      </div>
    )
  }
  if (options.length === 0) {
    if (unavailable) {
      return (
        <div style={{ padding: 16, textAlign: 'center', color: theme.text.disabled, fontSize: 11 }}>
          🔒 审核选项暂不可用
        </div>
      )
    }
    return null
  }

  return (
    <div style={{
      background: theme.bg.input,
      borderRadius: 10,
      padding: 12,
      border: `1px solid ${theme.border.default}`,
    }}>
      <div style={{
        fontSize: 13,
        fontWeight: 700,
        color: theme.status.awaiting,
        marginBottom: 4,
      }}>
        🔍 剧本审核 — 选择一个变体推进管线
      </div>
      <div style={{ fontSize: 10, color: theme.text.disabled, marginBottom: 12 }}>
        点击展开每集详情 → 选中变体 → 再次点击确认
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {options.map((opt) => {
          const accent = variantColors[opt.id] || theme.node.script
          const isSelected = selected === opt.id
          const isExpanded = expanded === opt.id
          const isConfirmed = confirmed && isSelected
          const desc = variantDescriptions[opt.id] || ''

          return (
            <div key={opt.id} style={{
              borderRadius: 10,
              overflow: 'hidden',
              background: isSelected
                ? `linear-gradient(135deg, ${accent}12, ${accent}03)`
                : theme.bg.panel,
              border: `2px solid ${isSelected ? accent : theme.border.subtle}`,
              opacity: confirmed && !isSelected ? 0.4 : 1,
              transition: 'all 0.2s',
            }}>
              {/* Header row — click to expand */}
              <div
                onClick={() => !confirmed && setExpanded(isExpanded ? null : opt.id)}
                style={{
                  cursor: confirmed ? 'default' : 'pointer',
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{
                    padding: '3px 12px',
                    borderRadius: 4,
                    background: accent,
                    color: theme.text.onAccent,
                    fontSize: 12,
                    fontWeight: 700,
                  }}>
                    {opt.label}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: theme.text.primary }}>
                    EP1: {opt.title}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: theme.text.disabled }}>
                    {isExpanded ? '▲ 收起' : '▼ 展开8集详情'}
                  </span>
                  {isConfirmed && (
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: theme.state.success,
                      color: theme.text.onAccent,
                      fontSize: 10,
                      fontWeight: 700,
                    }}>
                      ✅ 已选定
                    </span>
                  )}
                </div>

                {/* Style description */}
                <div style={{
                  fontSize: 11,
                  color: accent,
                  marginBottom: 6,
                  fontStyle: 'italic',
                }}>
                  {desc}
                </div>

                {/* Meta */}
                <div style={{ display: 'flex', gap: 12, fontSize: 10, color: theme.text.disabled, flexWrap: 'wrap' }}>
                  <span>🎭 {opt.emotion}</span>
                  <span>📊 {opt.episodes}集 / {opt.beats}节拍</span>
                  <span>🪝 {opt.hook.slice(0, 60)}...</span>
                </div>
              </div>

              {/* Expanded episode list */}
              {isExpanded && opt.episodeList.length > 0 && (
                <div style={{
                  padding: '0 12px 12px',
                  borderTop: `1px solid ${theme.border.default}`,
                }}>
                  {opt.episodeList.map((ep, i) => (
                    <div key={i} style={{
                      padding: '8px 0',
                      borderBottom: i < opt.episodeList.length - 1 ? `1px solid ${theme.border.dim}` : 'none',
                    }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: accent,
                          minWidth: 28,
                        }}>
                          {ep.ep || `EP${i+1}`}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: theme.text.primary }}>
                          {ep.title}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: theme.text.secondary,
                        lineHeight: 1.5,
                        marginTop: 2,
                        paddingLeft: 34,
                      }}>
                        {ep.logline}
                      </div>
                      {ep.hook_ending && (
                        <div style={{
                          fontSize: 10,
                          color: theme.text.disabled,
                          paddingLeft: 34,
                          marginTop: 2,
                          fontStyle: 'italic',
                        }}>
                          🪝 {ep.hook_ending.slice(0, 100)}
                          {ep.hook_ending.length > 100 ? '...' : ''}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Select button */}
              {!confirmed && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderTop: `1px solid ${theme.border.default}`,
                    cursor: 'pointer',
                    textAlign: 'center',
                    fontSize: 12,
                    fontWeight: isSelected ? 700 : 500,
                    color: isSelected ? theme.text.onAccent : accent,
                    background: isSelected ? accent : 'transparent',
                    transition: 'all 0.15s',
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSubmit(opt.id)
                  }}
                >
                  {submitting && isSelected ? '⏳ 提交中...' :
                   isSelected ? `✅ 再次点击确认选择「${opt.label}」` :
                   `选择 ${opt.label}`}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {confirmed && (
        <div style={{
          marginTop: 10,
          padding: '10px 12px',
          borderRadius: 6,
          background: `${theme.state.success}15`,
          color: theme.state.success,
          fontSize: 12,
          textAlign: 'center',
        }}>
          ✅ 审核完成 — 已选择「{options.find(o => o.id === selected)?.label}」，管线将继续推进
        </div>
      )}
    </div>
  )
}
