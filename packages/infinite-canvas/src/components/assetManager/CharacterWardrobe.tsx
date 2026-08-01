/**
 * 视图C · 角色衣柜 —— 角色造型展示（真实数据）。
 * 从 useRealAssets(projectId) 拉取 type==='character' 资产；
 * 左列角色列表（turnaround 缩略图 + 名字），右侧选中角色的大图 + 角色定位 / 元信息。
 * 后端尚无结构化的服装 / 道具 / 配饰资产，故"换装"暂退化为"造型展示"：
 * 大 turnaround 图 + 角色名 / 定位（从 name 中的括注解析，如"沈知意 (女主)"）+ 可用元数据。
 */
import { useMemo, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { useRealAssets } from './useRealAssets'
import { assetDetailToItem, TYPE_LABEL, type AssetItem } from './assetManagerData'
import { resolveMediaUrl } from '../../utils/mediaUrl'

/** "沈知意 (女主)" → { display:"沈知意", role:"女主" }；无括注则 role=null。 */
function parseCharName(raw: string): { display: string; role: string | null } {
  const m = raw.match(/\s*[（(]([^)）]+)[)）]\s*$/)
  if (!m || m.index === undefined) return { display: raw, role: null }
  return { display: raw.slice(0, m.index).trim(), role: m[1].trim() }
}

/** 带 emoji 兜底的图片：filePath 解析失败或 <img> 报错时回落到类型 emoji。 */
function Img({ item, className, fallback }: { item: AssetItem; className: string; fallback?: string }) {
  const [broken, setBroken] = useState(false)
  const url = item.filePath ? resolveMediaUrl(item.filePath) : null
  if (url && !broken) {
    return <img className={className} src={url} alt={item.name} loading="lazy" onError={() => setBroken(true)} />
  }
  return <span className={fallback ?? 'am-card__emoji'}>{item.emoji}</span>
}

export default function CharacterWardrobe() {
  const projectId = useCanvasStore((s) => s.projectId)
  const { assets, loading, error, reload } = useRealAssets(projectId)

  const characters = useMemo(
    () => assets.filter((a) => a.type === 'character').map(assetDetailToItem),
    [assets],
  )

  const [selectedUuid, setSelectedUuid] = useState<string | null>(null)
  const char = useMemo(
    () => characters.find((c) => c.uuid === selectedUuid) ?? characters[0],
    [characters, selectedUuid],
  )
  const { display, role } = char ? parseCharName(char.name) : { display: '', role: null }

  const rows: Array<[string, string]> = []
  if (char?.prompt) rows.push(['Prompt', char.prompt])
  if (char?.desc && char.desc !== char.name) rows.push(['描述', char.desc])
  if (char?.characterId) rows.push(['角色ID', char.characterId])
  if (char?.model) rows.push(['模型', char.model])
  if (char?.filePath) rows.push(['文件', char.filePath])

  if (loading) {
    return (
      <div className="am-loading">
        {[1, 2, 3, 4].map((i) => <div className="am-skeleton-card" key={i} />)}
        <div className="am-loading__label">正在加载角色资产…</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="am-empty">
        角色资产加载失败：{error}<br />
        <button className="am-btn am-btn--ghost" style={{ marginTop: 12 }} onClick={reload}>重试</button>
      </div>
    )
  }
  if (characters.length === 0) {
    return (
      <div className="am-empty">
        本项目暂无角色资产。<br />
        运行管线 P04（角色设计）后，turnaround 三视图会自动注册到这里。
      </div>
    )
  }

  return (
    <div className="am-scene">
      {/* 角色列表 */}
      <aside className="am-scene__list">
        <div className="am-head" style={{ padding: '0 4px 8px' }}>角色 · {characters.length}</div>
        {characters.map((c) => {
          const { display, role } = parseCharName(c.name)
          return (
            <div
              key={c.uuid}
              className={`am-scene-card ${char?.uuid === c.uuid ? 'is-on' : ''}`}
              onClick={() => setSelectedUuid(c.uuid)}
            >
              <div className="am-scene-card__ic"><Img item={c} className="am-card__img" /></div>
              <div>
                <b>{display}</b>
                <span>{role ?? (c.uuid.slice(-6))}</span>
              </div>
            </div>
          )
        })}
      </aside>

      {/* 角色造型展示 */}
      <div className="am-scene__main">
        {char && (
          <>
            <div className="am-scene__head">
              <h1>{display}</h1>
              {role && <span className="am-badge">{role}</span>}
              <span className="am-det__sub" style={{ fontFamily: 'var(--cv-font-mono)' }}>{char.uuid}</span>
            </div>
            <div className="am-scene__hint">
              {TYPE_LABEL.character} · 角色造型展示（turnaround 三视图）· 共 {characters.length} 个角色
            </div>

            <div className="am-det__stage" style={{ minHeight: 340, borderRadius: 10 }}>
              {/* key=uuid：切换角色时重置内部 broken 兜底状态 */}
              <Img key={char.uuid} item={char} className="am-det__big-img" fallback="am-det__big" />
            </div>

            {rows.length > 0 && (
              <>
                <div className="am-seclabel">元信息</div>
                {rows.map(([k, v]) => (
                  <div className="am-meta-row" key={k}>
                    <div className="am-meta-row__k">{k}</div>
                    <div className="am-meta-row__v">{v}</div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
