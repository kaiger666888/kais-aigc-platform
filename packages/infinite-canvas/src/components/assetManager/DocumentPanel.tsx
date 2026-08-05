/**
 * 创作文档面板 —— Notion 设计文档嵌入视图 (AssetManager 第 4 个 Tab)
 *
 * 左栏: 文档树侧栏 (主页面下的 7 个 Notion 子页面目录)
 * 右栏: 文档内容渲染区 (Markdown 风格渲染 Notion block)
 * 顶部: 刷新按钮 + "在 Notion 中编辑" 外链
 *
 * Notion CSP 不允许 iframe 嵌入 → 必须用 API 读取内容后渲染。
 * 通过后端代理 /api/notion/page/:pageId + /api/notion/pages 访问。
 */
import { useCallback, useEffect, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'

// ─── 类型 ────────────────────────────────────────────────

interface DocPage {
  id: string
  title: string
  icon: string
}

interface NotionBlock {
  id: string
  type: string
  has_children: boolean
  [k: string]: any
}

interface DocContent {
  pageId: string
  title: string
  blocks: NotionBlock[]
}

// ─── 工具函数 ────────────────────────────────────────────

/** 从 Notion rich_text 数组提取纯文本。 */
function richTextToText(rt: any[] | undefined): string {
  if (!Array.isArray(rt)) return ''
  return rt.map((t) => t?.plain_text || '').join('')
}

/** 调用后端代理拉取页面目录树。 */
async function fetchPages(projectId: number): Promise<{ mainPageId: string; title: string; pages: DocPage[] }> {
  const resp = await fetch(`/api/notion/pages?projectId=${projectId}`)
  const json = await resp.json()
  if (!resp.ok || json.code !== 200) throw new Error(json.message || `HTTP ${resp.status}`)
  return json.data
}

/** 调用后端代理拉取页面 block 树。 */
async function fetchPageContent(pageId: string, forceRefresh = false): Promise<DocContent> {
  const url = `/api/notion/page/${pageId}${forceRefresh ? '?forceRefresh=1' : ''}`
  const resp = await fetch(url, { method: 'POST' })
  const json = await resp.json()
  if (!resp.ok || json.code !== 200) throw new Error(json.message || `HTTP ${resp.status}`)
  return json.data
}

// ─── Block 渲染 ──────────────────────────────────────────

/** 渲染单个 Notion block 为 React 节点。 */
function renderBlock(block: NotionBlock, keyPrefix: string, onSelectChildPage: (pageId: string, title: string) => void): React.ReactNode {
  const t = block.type
  const k = `${keyPrefix}:${block.id}`

  // 文本类 block 通用提取
  const paraText = (field: string = t) => richTextToText(block[field]?.rich_text)

  switch (t) {
    case 'heading_1':
      return <h1 key={k} className="am-doc-h1">{paraText()}</h1>
    case 'heading_2':
      return <h2 key={k} className="am-doc-h2">{paraText()}</h2>
    case 'heading_3':
      return <h3 key={k} className="am-doc-h3">{paraText()}</h3>
    case 'paragraph':
      return <p key={k} className="am-doc-p">{paraText()}</p>
    case 'bulleted_list_item':
      return <li key={k} className="am-doc-li">{paraText()}</li>
    case 'numbered_list_item':
      return <li key={k} className="am-doc-li am-doc-li--num">{paraText()}</li>
    case 'to_do': {
      const checked = !!block.to_do?.checked
      return (
        <label key={k} className="am-doc-todo">
          <input type="checkbox" defaultChecked={checked} disabled />
          <span>{paraText('to_do')}</span>
        </label>
      )
    }
    case 'code': {
      const lang = block.code?.language || ''
      const code = richTextToText(block.code?.rich_text)
      return (
        <pre key={k} className="am-doc-code">
          <code data-lang={lang}>{code}</code>
        </pre>
      )
    }
    case 'quote':
      return <blockquote key={k} className="am-doc-quote">{paraText('quote')}</blockquote>
    case 'callout': {
      const icon = block.callout?.icon?.emoji || '💡'
      const text = richTextToText(block.callout?.rich_text)
      return (
        <div key={k} className="am-doc-callout">
          <span className="am-doc-callout__ic">{icon}</span>
          <div className="am-doc-callout__txt">{text}</div>
        </div>
      )
    }
    case 'divider':
      return <hr key={k} className="am-doc-hr" />
    case 'child_page': {
      const title = block.child_page?.title || '(未命名)'
      return (
        <button
          key={k}
          className="am-doc-childpage"
          onClick={() => onSelectChildPage(block.id, title)}
        >
          <span className="am-doc-childpage__ic">📄</span>
          <span>{title}</span>
          <span className="am-doc-childpage__arrow">→</span>
        </button>
      )
    }
    case 'table': {
      const children: NotionBlock[] = (block as any)._children || []
      return (
        <table key={k} className="am-doc-table">
          <tbody>
            {children
              .filter((c) => c.type === 'table_row')
              .map((row, ri) => {
                const cells: any[] = row.table_row?.cells || []
                return (
                  <tr key={`${k}:${ri}`}>
                    {cells.map((cell, ci) => {
                      const text = richTextToText(cell)
                      return <td key={`${k}:${ri}:${ci}`}>{text}</td>
                    })}
                  </tr>
                )
              })}
          </tbody>
        </table>
      )
    }
    case 'image': {
      const url = block.image?.file?.url || block.image?.external?.url || ''
      if (!url) return null
      return <img key={k} className="am-doc-img" src={url} alt="" loading="lazy" />
    }
    default:
      // 兜底: 尝试从常见字段提取文本
      return null
  }
}

/**
 * 把 block 列表渲染为分组结构。
 * 连续的 bulleted_list_item → <ul>, numbered_list_item → <ol>, 其它各自独立。
 * _children 中的子 block 递归渲染在父 block 之后。
 */
function renderBlockList(blocks: NotionBlock[], keyPrefix: string, onSelectChildPage: (id: string, title: string) => void): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let i = 0
  while (i < blocks.length) {
    const b = blocks[i]

    // 聚合连续的 bulleted_list_item
    if (b.type === 'bulleted_list_item') {
      const group: NotionBlock[] = []
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        group.push(blocks[i])
        i++
      }
      out.push(
        <ul key={`${keyPrefix}:ul:${group[0].id}`} className="am-doc-ul">
          {group.map((g) => renderBlock(g, keyPrefix, onSelectChildPage))}
          {group.map((g) => renderChildren(g, keyPrefix, onSelectChildPage))}
        </ul>,
      )
      continue
    }
    // 聚合连续的 numbered_list_item
    if (b.type === 'numbered_list_item') {
      const group: NotionBlock[] = []
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        group.push(blocks[i])
        i++
      }
      out.push(
        <ol key={`${keyPrefix}:ol:${group[0].id}`} className="am-doc-ol">
          {group.map((g) => renderBlock(g, keyPrefix, onSelectChildPage))}
          {group.map((g) => renderChildren(g, keyPrefix, onSelectChildPage))}
        </ol>,
      )
      continue
    }

    out.push(renderBlock(b, keyPrefix, onSelectChildPage))
    out.push(renderChildren(b, keyPrefix, onSelectChildPage))
    i++
  }
  return out
}

/** 如果 block 有 _children (递归读取的子 block), 渲染一个嵌套容器。 */
function renderChildren(block: NotionBlock, keyPrefix: string, onSelectChildPage: (id: string, title: string) => void): React.ReactNode {
  const children: NotionBlock[] | undefined = (block as any)._children
  if (!children || children.length === 0) return null
  return (
    <div key={`${keyPrefix}:${block.id}:children`} className="am-doc-children">
      {renderBlockList(children, `${keyPrefix}:${block.id}`, onSelectChildPage)}
    </div>
  )
}

// ─── 主组件 ──────────────────────────────────────────────

export default function DocumentPanel() {
  const projectId = useCanvasStore((s) => s.projectId)

  const [docList, setDocList] = useState<DocPage[]>([])
  const [mainTitle, setMainTitle] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedTitle, setSelectedTitle] = useState<string>('')

  const [loadingList, setLoadingList] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)
  const [content, setContent] = useState<DocContent | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 加载文档目录树
  const loadDocList = useCallback(async () => {
    if (!projectId) {
      setError('未选择项目, 无法加载创作文档')
      return
    }
    setLoadingList(true)
    setError(null)
    try {
      const data = await fetchPages(projectId)
      setDocList(data.pages || [])
      setMainTitle(data.title || '')
      // 默认选中第一个子页面
      if (data.pages?.length > 0 && !selectedId) {
        const first = data.pages[0]
        setSelectedId(first.id)
        setSelectedTitle(first.title)
      }
    } catch (e: any) {
      setError(e?.message || String(e))
      setDocList([])
    } finally {
      setLoadingList(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // 加载选中页面内容
  const loadContent = useCallback(
    async (pageId: string, forceRefresh = false) => {
      setLoadingContent(true)
      setError(null)
      try {
        const data = await fetchPageContent(pageId, forceRefresh)
        setContent(data)
      } catch (e: any) {
        setError(e?.message || String(e))
        setContent(null)
      } finally {
        setLoadingContent(false)
      }
    },
    [],
  )

  // 切换选中页面时加载内容
  useEffect(() => {
    loadDocList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (selectedId) loadContent(selectedId)
    else setContent(null)
  }, [selectedId, loadContent])

  const handleSelectDoc = (pageId: string, title: string) => {
    setSelectedId(pageId)
    setSelectedTitle(title)
  }

  const handleRefresh = () => {
    if (selectedId) loadContent(selectedId, true)
    else loadDocList()
  }

  const notionEditUrl = selectedId ? `https://www.notion.so/${selectedId.replace(/-/g, '')}` : null

  return (
    <div className="am-doc">
      {/* 左栏: 文档树侧栏 */}
      <aside className="am-doc__sidebar">
        <div className="am-doc__sidebar-h">
          <span>创作文档</span>
          {mainTitle && <span className="am-doc__sidebar-sub">{mainTitle}</span>}
        </div>
        {loadingList && <div className="am-doc__loading">加载文档目录…</div>}
        {!loadingList && docList.length === 0 && (
          <div className="am-doc__empty">{error || '暂无创作文档'}</div>
        )}
        <div className="am-doc__tree">
          {docList.map((d) => (
            <button
              key={d.id}
              className={`am-doc__node ${selectedId === d.id ? 'is-on' : ''}`}
              onClick={() => handleSelectDoc(d.id, d.title)}
            >
              <span className="am-doc__node-ic">{d.icon || '📄'}</span>
              <span className="am-doc__node-t">{d.title}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* 右栏: 内容渲染区 */}
      <main className="am-doc__main">
        <div className="am-doc__toolbar">
          <div className="am-doc__crumb">
            {selectedTitle || '请选择左侧文档'}
          </div>
          <div className="am-doc__actions">
            <button
              className="am-btn am-btn--ghost"
              onClick={handleRefresh}
              disabled={loadingContent || !selectedId}
              title="强制刷新 (跳过缓存)"
            >
              {loadingContent ? '加载中…' : '🔄 刷新'}
            </button>
            {notionEditUrl && (
              <a
                className="am-btn am-btn--primary am-doc__edit-link"
                href={notionEditUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                ↗ 在 Notion 中编辑
              </a>
            )}
          </div>
        </div>

        <div className="am-doc__scroll">
          {error && <div className="am-doc__error">⚠️ {error}</div>}
          {!error && loadingContent && (
            <div className="am-doc__loading am-doc__loading--big">读取 Notion 内容中…</div>
          )}
          {!error && !loadingContent && !selectedId && (
            <div className="am-doc__empty">← 从左侧选择一篇文档开始阅读</div>
          )}
          {!error && !loadingContent && content && (
            <article className="am-doc__article">
              {content.title && <h1 className="am-doc__title">{content.title}</h1>}
              {content.blocks.length === 0 ? (
                <div className="am-doc__empty">该页面暂无内容</div>
              ) : (
                renderBlockList(content.blocks, 'root', handleSelectDoc)
              )}
            </article>
          )}
        </div>
      </main>
    </div>
  )
}
