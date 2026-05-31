import { useState, useEffect, useCallback } from 'react'
import {
  fetchProjects, fetchProjectScripts,
  type ProjectInfo, type ScriptInfo,
} from '../services/canvasApi'
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
  const [scripts, setScripts] = useState<ScriptInfo[]>([])
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
    if (!selectedProjectId) { setScripts([]); return }
    let cancelled = false
    async function load() {
      try {
        const data = await fetchProjectScripts(selectedProjectId!)
        if (!cancelled) setScripts(data)
      } catch { /* ignore */ }
    }
    load()
    return () => { cancelled = true }
  }, [selectedProjectId])

  useEffect(() => {
    if (initialProjectId && initialEpisodesId) {
      onSelect(initialProjectId, initialEpisodesId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleProjectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value ? Number(e.target.value) : null
    setSelectedProjectId(id)
    setSelectedEpisodesId(null)
  }, [])

  const handleScriptChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value ? Number(e.target.value) : null
    setSelectedEpisodesId(id)
  }, [])

  const handleConfirm = useCallback(() => {
    if (selectedProjectId && selectedEpisodesId) {
      onSelect(selectedProjectId, selectedEpisodesId)
    }
  }, [selectedProjectId, selectedEpisodesId, onSelect])

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
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.scriptCount} 剧本, {p.assetCount} 资产)
          </option>
        ))}
      </select>

      <select
        value={selectedEpisodesId ?? ''}
        onChange={handleScriptChange}
        style={selectStyle}
        disabled={!selectedProjectId || scripts.length === 0}
      >
        <option value="">-- 选择剧本 --</option>
        {scripts.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name || `剧本 #${s.id}`} ({s.assetCount} 资产, {s.storyboardCount} 分镜)
          </option>
        ))}
      </select>

      <button
        onClick={handleConfirm}
        disabled={!selectedProjectId || !selectedEpisodesId}
        style={{
          ...buttonStyle,
          opacity: (!selectedProjectId || !selectedEpisodesId) ? 0.5 : 1,
          cursor: (!selectedProjectId || !selectedEpisodesId) ? 'not-allowed' : 'pointer',
        }}
      >
        加载画布
      </button>

      {error && <span style={{ color: theme.status.rejected, fontSize: 11 }}>{error}</span>}
    </div>
  )
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
