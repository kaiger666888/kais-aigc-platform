import { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchProjects, type ProjectInfo } from '../services/canvasApi'
import { theme } from '../theme/catppuccin'

interface ProjectSelectorProps {
  initialProjectId?: number | null
  initialEpisodesId?: number | null
  onSelect: (projectId: number, episodesId: number) => void
}

export default function ProjectSelector({
  initialProjectId, initialEpisodesId, onSelect,
}: ProjectSelectorProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(initialProjectId ?? null)
  const [selectedEpisodesId, setSelectedEpisodesId] = useState<number | null>(initialEpisodesId ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchProjects()
        if (!cancelled) setProjects(data)
      } catch (err: any) {
        if (!cancelled) setError(err.message || '加载项目失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (initialProjectId && initialEpisodesId) {
      onSelect(initialProjectId, initialEpisodesId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 最新项目在最上：createTime 降序；缺失 createTime 的沉底。
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => (b.createTime ?? -Infinity) - (a.createTime ?? -Infinity)),
    [projects],
  )

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )
  // 集选择器仅多集项目显示；单集/无数据项目直接默认加载第一集，省一次点击。
  const episodes = selectedProject?.episodes ?? []
  const showEpisodeSelector = episodes.length > 1

  const handleProjectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value ? Number(e.target.value) : null
    setSelectedProjectId(id)
    // 默认选第一集（按集号升序）；无画布数据则保持 null，确认时回退 episodesId=1
    const proj = projects.find((p) => p.id === id)
    setSelectedEpisodesId(proj?.episodes?.[0]?.id ?? null)
  }, [projects])

  const handleEpisodeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value ? Number(e.target.value) : null
    setSelectedEpisodesId(id)
  }, [])

  const handleConfirm = useCallback(() => {
    if (selectedProjectId) {
      // episodesId：多集用所选集，单集用唯一集，无数据默认 1（画布按 project+episodes 存储）
      onSelect(selectedProjectId, selectedEpisodesId ?? episodes[0]?.id ?? 1)
    }
  }, [selectedProjectId, selectedEpisodesId, episodes, onSelect])

  return (
    <div style={{
      display: 'flex',
      gap: 10,
      alignItems: 'center',
      flexWrap: 'wrap',
    }}>
      <select
        value={selectedProjectId ?? ''}
        onChange={handleProjectChange}
        style={selectStyle}
        disabled={loading}
      >
        <option value="">-- 选择项目 --</option>
        {sortedProjects.map((p) => (
          <option key={p.id} value={p.id}>
            [{p.id}] {p.name} ({formatCounts(p)})
          </option>
        ))}
      </select>

      {showEpisodeSelector && (
        <select
          value={selectedEpisodesId ?? ''}
          onChange={handleEpisodeChange}
          style={selectStyle}
        >
          {episodes.map((ep) => (
            <option key={ep.id} value={ep.id}>
              第{ep.id}集 ({ep.nodeCount}项)
            </option>
          ))}
        </select>
      )}

      <button
        onClick={handleConfirm}
        disabled={!selectedProjectId}
        style={{
          ...buttonStyle,
          opacity: !selectedProjectId ? 0.5 : 1,
          cursor: !selectedProjectId ? 'not-allowed' : 'pointer',
        }}
      >
        加载画布
      </button>

      {error && <span style={{ color: theme.status.rejected, fontSize: 11 }}>{error}</span>}
    </div>
  )
}

/** 括号内容：只列非 0 分项（资产·分镜·视频），全 0 显示「空」。
 *  数据来自 canvas_nodes 实时聚合，反映画布真实内容——不再用旧 o_script/o_assets 表
 *  那些长期为 0 的 count。 */
function formatCounts(p: ProjectInfo): string {
  const parts: string[] = []
  if (p.assetCount > 0) parts.push(`${p.assetCount}资产`)
  if (p.storyboardCount > 0) parts.push(`${p.storyboardCount}分镜`)
  if (p.videoCount > 0) parts.push(`${p.videoCount}视频`)
  return parts.length > 0 ? parts.join(' · ') : '空'
}

const selectStyle: React.CSSProperties = {
  background: theme.bg.panel,
  color: theme.text.primary,
  border: `1px solid ${theme.border.default}`,
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 12,
  minWidth: 180,
  outline: 'none',
}

const buttonStyle: React.CSSProperties = {
  background: theme.button.primary,
  color: theme.text.onAccent,
  border: 'none',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}
