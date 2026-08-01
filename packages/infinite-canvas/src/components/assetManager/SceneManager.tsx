/**
 * 视图D · 场景管理 —— 真实数据。
 * 从 useRealAssets(projectId) 拉取 type==='scene' 资产；
 * 按 filePath 中的场景 ID（S01 / S02 …）分组，组内不同角度（front / angle_left / angle_right）
 * 即同一场景的多视角变体。左列场景列表，右侧变体网格，可选 2 个视角做并排对比。
 */
import { useMemo, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { useRealAssets } from './useRealAssets'
import { assetDetailToItem, modalityWeakVar, type AssetItem } from './assetManagerData'
import { resolveMediaUrl } from '../../utils/mediaUrl'

const ANGLE_ORDER = ['front', 'angle_left', 'angle_right', 'left', 'right', 'back', 'overview', 'wide', 'close']
const ANGLE_LABEL: Record<string, string> = {
  front: '正面', angle_left: '左视', angle_right: '右视',
  left: '左', right: '右', back: '背视',
  overview: '全景', wide: '广角', close: '特写',
}
const angleLabel = (a?: string): string => (a ? (ANGLE_LABEL[a] ?? a) : '视角')
const angleRank = (a?: string): number => {
  const i = a ? ANGLE_ORDER.indexOf(a) : -1
  return i < 0 ? 999 : i
}

/** 从 filePath（或 name）提取 {sceneId, angle}，如 .../S01_angle_left.png → S01 / angle_left。 */
function parseScene(text?: string): { sceneId: string; angle: string } | null {
  const fn = (text ?? '').split('/').pop() ?? ''
  const m = fn.match(/S(\d+)[_\s-]+([A-Za-z_]+)\./i)
  if (!m) return null
  return { sceneId: `S${m[1].padStart(2, '0')}`, angle: m[2].toLowerCase() }
}

function cssVars(vars: Record<string, string>): React.CSSProperties {
  return vars as React.CSSProperties
}

/** 带 emoji 兜底的图片。 */
function Img({ item, className, fallback }: { item: AssetItem; className: string; fallback?: string }) {
  const [broken, setBroken] = useState(false)
  const url = item.filePath ? resolveMediaUrl(item.filePath) : null
  if (url && !broken) {
    return <img className={className} src={url} alt={item.name} loading="lazy" onError={() => setBroken(true)} />
  }
  return <span className={fallback ?? 'am-card__emoji'}>{item.emoji}</span>
}

interface SceneGroup { id: string; variants: AssetItem[] }

export default function SceneManager() {
  const projectId = useCanvasStore((s) => s.projectId)
  const { assets, loading, error, reload } = useRealAssets(projectId)

  const groups = useMemo<SceneGroup[]>(() => {
    const map = new Map<string, AssetItem[]>()
    for (const d of assets) {
      if (d.type !== 'scene') continue
      const item = assetDetailToItem(d)
      const parsed = parseScene(item.filePath) ?? parseScene(item.name)
      const sceneId = parsed?.sceneId ?? (d.name?.trim() || `场景-${d.id}`)
      const angle = parsed?.angle ?? (item.viewAngle ?? 'main')
      if (!item.viewAngle) item.viewAngle = angle
      if (!map.has(sceneId)) map.set(sceneId, [])
      map.get(sceneId)!.push(item)
    }
    for (const arr of map.values()) arr.sort((a, b) => angleRank(a.viewAngle) - angleRank(b.viewAngle))
    return [...map.entries()]
      .map(([id, variants]) => ({ id, variants }))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  }, [assets])

  const [sceneId, setSceneId] = useState<string | null>(null)
  const [picks, setPicks] = useState<string[]>([])

  const scene = groups.find((g) => g.id === sceneId) ?? groups[0]
  const variants = scene?.variants ?? []
  const frontOf = (g: SceneGroup): AssetItem | undefined =>
    g.variants.find((v) => v.viewAngle === 'front') ?? g.variants[0]

  const togglePick = (uuid: string) => {
    setPicks((prev) => {
      const i = prev.indexOf(uuid)
      if (i >= 0) return prev.filter((u) => u !== uuid)
      const next = [...prev, uuid]
      return next.length > 2 ? next.slice(1) : next
    })
  }
  const picked = variants.filter((v) => picks.includes(v.uuid))

  if (loading) {
    return (
      <div className="am-loading">
        {[1, 2, 3, 4, 5, 6].map((i) => <div className="am-skeleton-card" key={i} />)}
        <div className="am-loading__label">正在加载场景资产…</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="am-empty">
        场景资产加载失败：{error}<br />
        <button className="am-btn am-btn--ghost" style={{ marginTop: 12 }} onClick={reload}>重试</button>
      </div>
    )
  }
  if (groups.length === 0) {
    return (
      <div className="am-empty">
        本项目暂无场景资产。<br />
        运行管线 P07（场景设计）后，多视角场景图会自动注册到这里。
      </div>
    )
  }

  return (
    <div className="am-scene">
      {/* 场景列表 */}
      <aside className="am-scene__list">
        <div className="am-head" style={{ padding: '0 4px 8px' }}>场景 · {groups.length}</div>
        {groups.map((g) => {
          const fr = frontOf(g)
          return (
            <div
              key={g.id}
              className={`am-scene-card ${scene?.id === g.id ? 'is-on' : ''}`}
              onClick={() => { setSceneId(g.id); setPicks([]) }}
            >
              <div className="am-scene-card__ic">{fr ? <Img item={fr} className="am-card__img" /> : '🎬'}</div>
              <div>
                <b>场景 {g.id}</b>
                <span>{g.variants.length} 视角</span>
              </div>
            </div>
          )
        })}
      </aside>

      {/* 变体网格 */}
      <div className="am-scene__main">
        {scene && (
          <>
            <div className="am-scene__head">
              <h1>场景 {scene.id}</h1>
              <span className="am-det__sub" style={{ fontFamily: 'var(--cv-font-mono)' }}>{variants.length} 个视角</span>
            </div>
            <div className="am-scene__hint">
              多视角变体 · 点选最多 2 个视角进行并排对比
            </div>

            <div className="am-variants">
              {variants.length === 0 ? (
                <div className="am-empty" style={{ gridColumn: '1/-1' }}>该场景暂无变体</div>
              ) : variants.map((v) => (
                <div
                  key={v.uuid}
                  className={`am-variant ${picks.includes(v.uuid) ? 'is-pick' : ''}`}
                  style={cssVars({ '--vw': `var(${modalityWeakVar(v.modality)})` })}
                  onClick={() => togglePick(v.uuid)}
                >
                  <span className="am-variant__pickflag">✓</span>
                  <div className="am-variant__thumb" style={{ background: `var(${modalityWeakVar(v.modality)})` }}>
                    <Img item={v} className="am-card__img" />
                    <span className="am-variant__time">{angleLabel(v.viewAngle)}</span>
                  </div>
                  <div className="am-variant__body">
                    <div className="am-variant__name">{angleLabel(v.viewAngle)}</div>
                    <div className="am-variant__meta">{v.filePath?.split('/').pop() ?? v.name}</div>
                  </div>
                </div>
              ))}
            </div>

            {picked.length === 2 && (
              <>
                <div className="am-cmp-head">
                  视角对比 · {angleLabel(picked[0].viewAngle)} ⟷ {angleLabel(picked[1].viewAngle)}
                </div>
                <div className="am-cmp-grid">
                  {picked.map((x) => (
                    <div className="am-cmp-pane" key={x.uuid}>
                      <div className="am-cmp-pane__thumb" style={{ background: `var(${modalityWeakVar(x.modality)})` }}>
                        <Img item={x} className="am-card__img" />
                      </div>
                      <div className="am-cmp-pane__body">
                        <div className="am-cmp-pane__name">{angleLabel(x.viewAngle)}</div>
                        <div style={{ marginTop: 8 }}>
                          <div className="am-diff-row"><div className="am-diff-row__k">视角</div><div className="am-diff-row__v">{angleLabel(x.viewAngle)}</div></div>
                          <div className="am-diff-row"><div className="am-diff-row__k">场景</div><div className="am-diff-row__v">{scene.id}</div></div>
                          <div className="am-diff-row"><div className="am-diff-row__k">文件</div><div className="am-diff-row__v">{x.filePath?.split('/').pop() ?? '—'}</div></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
