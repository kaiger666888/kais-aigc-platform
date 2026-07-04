import { useState, useEffect, useCallback } from 'react'
import { theme } from '../theme/catppuccin'

interface FileViewerProps {
  filePath: string | undefined
  apiBase?: string
}

interface FileData {
  filePath: string
  fileName: string
  size: number
  modified: string
  isJson: boolean
  content: string
  raw: unknown
}

/**
 * FileViewer — 读取并展示管线产出文件内容，支持编辑保存
 */
export default function FileViewer({ filePath, apiBase = '' }: FileViewerProps) {
  const [fileData, setFileData] = useState<FileData | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const loadFile = useCallback(async () => {
    if (!filePath) return
    // Skip binary files that can't be read as text
    const binaryExt = /\.(png|jpg|jpeg|webp|gif|bmp|svg|mp4|webm|mov|avi|wav|flac|mp3|aac|ogg)$/i
    if (binaryExt.test(filePath)) return
    // For /oss/ paths, fetch via the static URL and display content for text files
    const textExt = /\.(json|md|txt|yaml|yml)$/i
    let readPath = filePath
    if (filePath.startsWith('/oss/')) {
      if (!textExt.test(filePath)) return
      // Fetch the file content via the static /oss/ URL
      try {
        const resp = await fetch(`${apiBase}${filePath}`)
        const text = await resp.text()
        let parsed = null, isJson = false
        try { parsed = JSON.parse(text); isJson = true } catch {}
        setFileData({
          filePath,
          fileName: filePath.split('/').pop() || '',
          size: text.length,
          modified: new Date().toISOString(),
          isJson,
          content: isJson ? JSON.stringify(parsed, null, 2) : text,
          raw: parsed,
        })
        setEditContent(isJson ? JSON.stringify(parsed, null, 2) : text)
      } catch (err) {
        setError(err instanceof Error ? err.message : '网络错误')
      }
      return
    }
    setLoading(true)
    setError(null)
    setSaved(false)
    try {
      const resp = await fetch(`${apiBase}/api/canvas/v2/file/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      })
      const json = await resp.json()
      if (json.code === 200 && json.data) {
        setFileData(json.data)
        setEditContent(json.data.content)
      } else {
        setError(json.message || '读取失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setLoading(false)
    }
  }, [filePath, apiBase])

  useEffect(() => {
    if (filePath) {
      loadFile()
      setEditing(false)
    } else {
      setFileData(null)
    }
  }, [filePath, loadFile])

  const handleSave = async () => {
    if (!filePath) return
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(`${apiBase}/api/canvas/v2/file/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, content: editContent }),
      })
      const json = await resp.json()
      if (json.code === 200) {
        setSaved(true)
        setEditing(false)
        // Reload
        await loadFile()
      } else {
        setError(json.message || '保存失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setLoading(false)
    }
  }

  if (!filePath) return null

  return (
    <>
      {/* File content section */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={{
          fontSize: 12,
          fontWeight: 600,
          color: theme.text.secondary,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          📄 产出文件内容
        </span>
        {fileData && !editing && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setEditing(true)}
              style={{
                padding: '3px 10px',
                borderRadius: 4,
                border: `1px solid ${theme.border.subtle}`,
                background: theme.bg.surface,
                color: theme.text.primary,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              ✏️ 编辑
            </button>
            <button
              onClick={loadFile}
              style={{
                padding: '3px 10px',
                borderRadius: 4,
                border: `1px solid ${theme.border.subtle}`,
                background: theme.bg.surface,
                color: theme.text.primary,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              🔄 刷新
            </button>
          </div>
        )}
        {editing && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleSave}
              disabled={loading}
              style={{
                padding: '3px 10px',
                borderRadius: 4,
                border: `1px solid ${theme.state.success}`,
                background: theme.state.success,
                color: theme.text.onAccent,
                fontSize: 11,
                cursor: loading ? 'wait' : 'pointer',
                fontWeight: 600,
              }}
            >
              💾 保存
            </button>
            <button
              onClick={() => {
                setEditing(false)
                setEditContent(fileData?.content || '')
              }}
              style={{
                padding: '3px 10px',
                borderRadius: 4,
                border: `1px solid ${theme.border.subtle}`,
                background: theme.bg.surface,
                color: theme.text.primary,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              取消
            </button>
          </div>
        )}
      </div>

      {/* File meta */}
      {fileData && (
        <div style={{
          fontSize: 10,
          color: theme.text.disabled,
          marginBottom: 6,
        }}>
          {fileData.fileName} · {(fileData.size / 1024).toFixed(1)}KB · {fileData.isJson ? 'JSON' : 'Text'}
          {saved && <span style={{ color: theme.state.success, marginLeft: 8 }}>✅ 已保存</span>}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: 8,
          borderRadius: 6,
          background: theme.chrome.errorBar,
          color: theme.status.rejected,
          fontSize: 12,
          marginBottom: 8,
        }}>
          ❌ {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{
          padding: 16,
          textAlign: 'center',
          color: theme.text.secondary,
          fontSize: 12,
        }}>
          ⏳ 加载中...
        </div>
      )}

      {/* Content display */}
      {fileData && !loading && !editing && (
        <div style={{
          background: theme.bg.input,
          borderRadius: 8,
          padding: 12,
          maxHeight: '40vh',
          overflowY: 'auto',
          fontFamily: fileData.isJson ? 'monospace' : 'inherit',
          fontSize: 11,
          lineHeight: 1.6,
          color: theme.text.primary,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          border: `1px solid ${theme.border.default}`,
        }}>
          {/* Render JSON with structure */}
          {fileData.isJson && fileData.raw
            ? <JsonRenderer data={fileData.raw} />
            : fileData.content
          }
        </div>
      )}

      {/* Edit mode */}
      {editing && (
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          style={{
            width: '100%',
            minHeight: '30vh',
            background: theme.bg.input,
            borderRadius: 8,
            padding: 12,
            fontFamily: 'monospace',
            fontSize: 11,
            lineHeight: 1.6,
            color: theme.text.primary,
            border: `1px solid ${theme.border.subtle}`,
            resize: 'vertical',
            outline: 'none',
          }}
          spellCheck={false}
        />
      )}
    </>
  )
}

/**
 * JSON Renderer — 格式化展示 JSON 数据，支持折叠
 */
function JsonRenderer({ data }: { data: unknown }) {
  return <JsonNode name="" value={data} depth={0} defaultOpen={true} />
}

function JsonNode({ name, value, depth, defaultOpen = false }: { name: string; value: unknown; depth: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || depth < 2)

  if (value === null) {
    return <Line name={name} value="null" color={theme.text.disabled} depth={depth} />
  }
  if (typeof value === 'string') {
    return <Line name={name} value={`"${value}"`} color={theme.node.asset} depth={depth} />
  }
  if (typeof value === 'number') {
    return <Line name={name} value={String(value)} color={theme.node.storyboard} depth={depth} />
  }
  if (typeof value === 'boolean') {
    return <Line name={name} value={String(value)} color={theme.node.audio} depth={depth} />
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <Line name={name} value="[]" color={theme.text.secondary} depth={depth} />
    }
    return (
      <div>
        <div
          onClick={() => setOpen(!open)}
          style={{ cursor: 'pointer', paddingLeft: depth * 12 }}
        >
          <span style={{ color: theme.text.secondary, fontSize: 10 }}>
            {open ? '▼' : '▶'}
          </span>
          {' '}
          {name && <span style={{ color: theme.node.script }}>{name}: </span>}
          <span style={{ color: theme.text.secondary }}>[
            {open ? '' : ` ${value.length} items `}
          </span>
        </div>
        {open && (
          <>
            {value.map((item, i) => (
              <JsonNode key={i} name={`[${i}]`} value={item} depth={depth + 1} defaultOpen={depth < 1} />
            ))}
            <div style={{ paddingLeft: depth * 12, color: theme.text.secondary, fontSize: 11 }}>
              ]
            </div>
          </>
        )}
      </div>
    )
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    if (keys.length === 0) {
      return <Line name={name} value="{}" color={theme.text.secondary} depth={depth} />
    }
    return (
      <div>
        <div
          onClick={() => setOpen(!open)}
          style={{ cursor: 'pointer', paddingLeft: depth * 12 }}
        >
          <span style={{ color: theme.text.secondary, fontSize: 10 }}>
            {open ? '▼' : '▶'}
          </span>
          {' '}
          {name && <span style={{ color: theme.node.script }}>{name}: </span>}
          <span style={{ color: theme.text.secondary }}>{'{'}
            {open ? '' : ` ${keys.length} keys `}
          </span>
        </div>
        {open && (
          <>
            {keys.map((key) => (
              <JsonNode
                key={key}
                name={key}
                value={(value as Record<string, unknown>)[key]}
                depth={depth + 1}
                defaultOpen={depth < 1}
              />
            ))}
            <div style={{ paddingLeft: depth * 12, color: theme.text.secondary, fontSize: 11 }}>
              {'}'}
            </div>
          </>
        )}
      </div>
    )
  }

  return null
}

function Line({ name, value, color, depth }: { name: string; value: string; color: string; depth: number }) {
  return (
    <div style={{ paddingLeft: depth * 12, fontSize: 11, lineHeight: 1.6 }}>
      {name && <span style={{ color: theme.node.script }}>{name}: </span>}
      <span style={{ color }}>{value}</span>
    </div>
  )
}
