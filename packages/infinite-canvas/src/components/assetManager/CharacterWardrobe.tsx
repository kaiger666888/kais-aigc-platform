/**
 * 视图C · 角色衣柜 —— 角色造型展示（真实数据）。
 *
 * 两层分离：
 *   1. 角色图（character identity）—— 定义角色长相/气质，用于一致性锁
 *   2. Turnaround 四宫格 —— 分镜镜头参考（面部特写/正面全身/侧面全身/背面全身）
 *
 * Turnaround 四宫格布局：
 *   ┌──────────────┬──────────────┐
 *   │  近身面部细节  │  前视全身     │
 *   │  (CU 参考)    │  (正面参考)   │
 *   ├──────────────┼──────────────┤
 *   │  侧身全身     │  背后全身     │
 *   │  (侧面参考)   │  (背影参考)   │
 *   └──────────────┴──────────────┘
 *
 * 数据模型：type='character' + viewAngle 区分：
 *   - viewAngle=null → 角色图（身份定义）
 *   - viewAngle=face_cu/front/side/back → turnaround 拆分视角
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

/**
 * Turnaround 四宫格布局定义。
 * viewAngle → 格子位置 + 显示标签。
 * 当前磁盘文件视角 front/back/side/three_quarter 映射到四宫格：
 *   - three_quarter 作为 face_cu（面部特写）的占位（暂无真实面部特写图）
 *   - 如果有 face_cu 则优先用 face_cu
 */
const TURNAROUND_LAYOUT: Array<{ viewAngle: string; label: string; cell: string; placeholder?: boolean }> = [
  { viewAngle: 'face_cu',       label: '近身面部', cell: '1 / 1', placeholder: true },
  { viewAngle: 'three_quarter', label: '近身面部', cell: '1 / 1', placeholder: false },
  { viewAngle: 'front',         label: '前视全身', cell: '1 / 2' },
  { viewAngle: 'side',          label: '侧身全身', cell: '2 / 1' },
  { viewAngle: 'back',          label: '背后全身', cell: '2 / 2' },
]

/** 四宫格布局样式 */
const GRID_2x2: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gridTemplateRows: 'auto auto',
  gap: 6,
}

export default function CharacterWardrobe() {
  const projectId = useCanvasStore((s) => s.projectId)
  const { assets, loading, error, reload } = useRealAssets(projectId)

  // Separate character assets into identity (角色图) and turnaround (拆分视角)
  const { identityChars, turnaroundByChar } = useMemo(() => {
    const charAssets = assets.filter(
      (a) => a.type === 'character' && !!a.isPrimaryView && (a.state ?? 'active') !== 'eliminated',
    )
    // 角色图：无 viewAngle（turnaround 整图或角色设计稿）
    const identity = charAssets
      .filter((a) => !a.viewAngle)
      .map(assetDetailToItem)
    // Turnaround：有 viewAngle（front/back/side/three_quarter/face_cu）
    const turnaround: Record<string, AssetItem[]> = {}
    for (const a of charAssets) {
      if (a.viewAngle && a.characterId) {
        if (!turnaround[a.characterId]) turnaround[a.characterId] = []
        turnaround[a.characterId].push(assetDetailToItem(a))
      }
    }
    return { identityChars: identity, turnaroundByChar: turnaround }
  }, [assets])

  const characters = identityChars

  const [selectedUuid, setSelectedUuid] = useState<string | null>(null)
  const char = useMemo(
    () => characters.find((c) => c.uuid === selectedUuid) ?? characters[0],
    [characters, selectedUuid],
  )
  const { display, role } = char ? parseCharName(char.name) : { display: '', role: null }

  // Get turnaround views for the selected character, organized as 2x2 grid
  const turnaroundGrid = useMemo(() => {
    if (!char?.characterId) return []
    const items = turnaroundByChar[char.characterId] ?? []
    const byAngle = new Map(items.map((it) => [it.viewAngle, it]))

    const cells: Array<{ item?: AssetItem; label: string; cell: string }> = []
    const usedAngles = new Set<string>()

    for (const slot of TURNAROUND_LAYOUT) {
      // Skip placeholder slots (face_cu) if a real one already filled this cell
      if (usedAngles.has(slot.cell)) continue
      const item = byAngle.get(slot.viewAngle)
      if (item) {
        cells.push({ item, label: slot.label, cell: slot.cell })
        usedAngles.add(slot.cell)
      } else if (slot.placeholder === false) {
        // Non-placeholder slot with no image → empty cell
        cells.push({ item: undefined, label: slot.label, cell: slot.cell })
        usedAngles.add(slot.cell)
      }
    }
    return cells
  }, [char, turnaroundByChar])

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
            {/* === 层 1：角色身份 === */}
            <div className="am-scene__head">
              <h1>{display}</h1>
              {role && <span className="am-badge">{role}</span>}
              <span className="am-det__sub" style={{ fontFamily: 'var(--cv-font-mono)' }}>{char.uuid}</span>
            </div>
            <div className="am-scene__hint">
              {TYPE_LABEL.character} · 共 {characters.length} 个角色
            </div>

            <div className="am-det__stage" style={{ minHeight: 340, borderRadius: 10 }}>
              <Img key={char.uuid} item={char} className="am-det__big-img" fallback="am-det__big" />
            </div>

            {/* === 层 2：Turnaround 四宫格（镜头参考） === */}
            {turnaroundGrid.length > 0 && (
              <>
                <div className="am-seclabel" style={{ marginTop: 16 }}>
                  Turnaround · 镜头参考
                </div>
                <div style={GRID_2x2}>
                  {turnaroundGrid.map((cell, idx) => (
                    <div key={`${cell.cell}-${idx}`} style={{
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: '1px solid var(--cv-border)',
                      background: 'var(--cv-bg-2)',
                      aspectRatio: '9 / 16',
                      position: 'relative',
                    }}>
                      {cell.item ? (
                        <Img item={cell.item} className="am-card__img" />
                      ) : (
                        <div style={{
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--cv-text-3)',
                          fontSize: 28,
                        }}>
                          ◌
                        </div>
                      )}
                      {/* 角标 */}
                      <div style={{
                        position: 'absolute',
                        bottom: 0, left: 0, right: 0,
                        padding: '4px 8px',
                        fontSize: 11,
                        textAlign: 'center',
                        color: 'var(--cv-text-2)',
                        background: 'rgba(0,0,0,0.5)',
                        backdropFilter: 'blur(4px)',
                      }}>
                        {cell.label}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--cv-text-3)',
                  marginTop: 6,
                  lineHeight: 1.5,
                }}>
                  四宫格按镜头用途排列：面部特写参考 · 正面全身 · 侧面全身 · 背影全身。
                  Turnaround 作为分镜首尾帧参考时，按镜头角度选择对应视角。
                </div>
              </>
            )}

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
