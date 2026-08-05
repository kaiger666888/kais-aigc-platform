/**
 * 视图C · 角色管理（角色衣柜）—— 角色造型 + 服装变体（Costume Variants）展示（真实数据）。
 *
 * 【管理导向】本视图仅展示「已选定」资产（isPrimaryView=true && state≠eliminated），
 *   对选定角色做 关系链 管理。资产库（左侧栏）才是生产导向、平铺所有三态资产的地方。
 *
 * 关系链：角色 → 服装套系（costume_set）→ 适用场景（scene_refs）→ 分镜镜头
 *
 * 三层分离：
 *   1. 角色身份（左栏）—— groupCharacterIdentities：每角色一张代表图（概念图①）
 *   2. 服装套系（右栏切换器）—— groupCharacterCostumes：同一角色多套服装（宴会基线/
 *      日常基线/闪回），按 o_assets.meta.costume_set 分组。>1 套时显示 pill 切换器。
 *   3. Turnaround 四宫格 —— 当前套系的拆分视角（近身面部/正面/侧面/背面全身）
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
 * 数据模型：服装信息存 o_assets.meta JSON（不新建表）：
 *   { costume_set, costume_label, costume_desc, scene_refs }
 * 详见 assetManagerData.ts §服装变体。
 */
import { useCallback, useMemo, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { useRealAssets } from './useRealAssets'
import {
  groupCharacterIdentities,
  groupCharacterCostumes,
  getCharacterGreyBase,
  parseTurnaroundSheetSize,
  TYPE_LABEL,
  validateTurnaroundSheet,
  type AssetItem,
} from './assetManagerData'
import { resolveMediaUrl } from '../../utils/mediaUrl'

/** "沈知意 v1 (女主)" → { display:"沈知意", role:"女主" }；去掉版本后缀，无括注则 role=null。 */
function parseCharName(raw: string): { display: string; role: string | null } {
  // 去掉版本后缀（概念图名形如「沈知意 v1」→「沈知意」）
  const cleaned = raw.replace(/\s*v\d+\s*$/i, '').trim()
  const m = cleaned.match(/\s*[（(]([^)）]+)[)）]\s*$/)
  if (!m || m.index === undefined) return { display: cleaned, role: null }
  return { display: cleaned.slice(0, m.index).trim(), role: m[1].trim() }
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

/**
 * 把一套服装的拆分视角（front/side/back/face_cu/three_quarter）排进 2×2 四宫格。
 *
 * 按 TURNAROUND_LAYOUT 定义的格位 + 标签映射；face_cu 与 three_quarter 共占 (1/1) 格，
 * face_cu 优先。空格子（无可用视角）会返回 item=undefined 的占位条目（仅非占位槽位）。
 */
function buildTurnaroundGrid(views: AssetItem[]): Array<{ item?: AssetItem; label: string; cell: string }> {
  const byAngle = new Map(views.map((it) => [it.viewAngle, it]))
  const cells: Array<{ item?: AssetItem; label: string; cell: string }> = []
  const usedCells = new Set<string>()
  for (const slot of TURNAROUND_LAYOUT) {
    if (usedCells.has(slot.cell)) continue
    const item = byAngle.get(slot.viewAngle)
    if (item) {
      cells.push({ item, label: slot.label, cell: slot.cell })
      usedCells.add(slot.cell)
    } else if (slot.placeholder === false) {
      // 非占位槽位无图 → 空格子（前端渲染 ◌ 占位）
      cells.push({ item: undefined, label: slot.label, cell: slot.cell })
      usedCells.add(slot.cell)
    }
  }
  return cells
}

/**
 * Turnaround 整图方向达标徽章。
 *
 * 显示在「Turnaround · 镜头参考」标题旁，直观反馈整图方向是否符合竖屏短剧（9:16）要求：
 *   ✅ 竖屏达标（portrait, 1440×2560 附近）
 *   ⚠️ 横屏不达标（landscape, 应为竖屏）
 *   ❓ 未知（meta 缺 sheetWidth/sheetHeight，无法判定）
 *
 * 复用 .am-badge 基础样式 + 方向修饰类，颜色全走 --cv-* CSS 变量（不硬编码）。
 */
function TurnaroundOrientationBadge({
  validation,
}: {
  validation: ReturnType<typeof validateTurnaroundSheet>
}) {
  const { orientation, width, height } = validation
  const sizeLabel = width && height ? `${width}×${height}` : ''

  if (orientation === 'portrait') {
    return (
      <span
        className="am-badge am-badge--ok"
        title={`竖屏达标 · ${sizeLabel || '尺寸未知'}`}
      >
        ✅ 竖屏达标{sizeLabel && ` · ${sizeLabel}`}
      </span>
    )
  }
  if (orientation === 'landscape') {
    return (
      <span
        className="am-badge am-badge--warn"
        title={`横屏不达标 · 应为竖屏（9:16）${sizeLabel ? ` · ${sizeLabel}` : ''}`}
      >
        ⚠️ 横屏不达标{sizeLabel && ` · ${sizeLabel}`}
      </span>
    )
  }
  return (
    <span className="am-badge" title="未检测到整图尺寸（meta 缺 sheetWidth/sheetHeight）">
      ❓ 方向未知
    </span>
  )
}

export default function CharacterWardrobe() {
  const projectId = useCanvasStore((s) => s.projectId)
  const { assets, loading, error, reload } = useRealAssets(projectId)

  // 【管理视图】仅展示选定资产（isPrimaryView=true && 未淘汰）。
  // isPrimaryView 从 SQLite 返回 0|1 整数 → !! 转布尔；state 可能为 null → ?? 'active' 兜底。
  // 后续 groupCharacterIdentities / groupCharacterCostumes 都基于 selectedAssets，而非全量 assets。
  const selectedAssets = useMemo(
    () => assets.filter((d) => !!d.isPrimaryView && (d.state ?? 'active') !== 'eliminated'),
    [assets],
  )

  // 左栏：每角色一张身份代表图（概念图①优先，灰底整图兜底）—— groupCharacterIdentities
  // 修复旧逻辑把概念图 + 灰底整图都当独立角色、左栏重复的问题。
  const identities = useMemo(() => groupCharacterIdentities(selectedAssets), [selectedAssets])

  const [selectedCharId, setSelectedCharId] = useState<string | null>(null)
  const identity = useMemo(
    () => identities.find((c) => c.characterId === selectedCharId) ?? identities[0],
    [identities, selectedCharId],
  )

  // 选中角色的服装套系（按 meta.costume_set 分组的 turnaround 资产）
  const costumes = useMemo(
    () => (identity ? groupCharacterCostumes(selectedAssets, identity.characterId) : []),
    [selectedAssets, identity],
  )

  // 当前选中套系：>1 套时由 pill 切换，默认选第一个（默认套系在最前）
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const currentSet = useMemo(() => {
    if (costumes.length === 0) return null
    return costumes.find((s) => s.setId === selectedSetId) ?? costumes[0]
  }, [costumes, selectedSetId])

  const { display, role } = identity ? parseCharName(identity.item.name) : { display: '', role: null }

  // 当前套系的四宫格（基于该套系的拆分视角）
  const turnaroundGrid = useMemo(
    () => buildTurnaroundGrid(currentSet?.views ?? []),
    [currentSet],
  )
  const hasRealView = turnaroundGrid.some((c) => c.item)

  // 当前套系整图方向检测（portrait/landscape）—— 仅针对灰底整图 sheet
  const sheetValidation = useMemo(() => {
    if (!currentSet?.sheet) return null
    const [w, h] = parseTurnaroundSheetSize(currentSet.sheet.meta)
    return validateTurnaroundSheet(w, h)
  }, [currentSet])

  // 跳转「场景与分镜」tab（服装→场景关系链的下游入口）
  // 深度选中具体场景待 SceneShotManager 支持外部选中后接入（见任务 §3）。
  const goToScenes = () => {
    useCanvasStore.getState().navPushCallback?.()
    useCanvasStore.getState().setAssetView('scene_shot')
  }

  // 双击服装 / 灰底缩略图 → 打开资产详情 drawer（导航交互，先拍历史快照）。
  const rawOpenAssetDetail = useCanvasStore((s) => s.openAssetDetail)
  const openAssetDetail = useCallback((uuid: string) => {
    useCanvasStore.getState().navPushCallback?.()
    rawOpenAssetDetail(uuid)
  }, [rawOpenAssetDetail])

  // 灰底 Turnaround 基础参考（人物一致性锚点，独立于服装套系，单独展示为「基础/灰底」区域）。
  const greyBase = useMemo(
    () => (identity ? getCharacterGreyBase(selectedAssets, identity.characterId) : null),
    [selectedAssets, identity],
  )
  // 灰底整图方向检测（portrait/landscape）—— 竖屏短剧需 portrait。
  const greyBaseValidation = useMemo(() => {
    if (!greyBase?.meta) return null
    const [w, h] = parseTurnaroundSheetSize(greyBase.meta)
    return validateTurnaroundSheet(w, h)
  }, [greyBase])

  // Hero / 元信息：当前套系整图 → 回退灰底基础参考 → 回退角色身份图。
  // 灰底 turnaround 现在是独立基础参考，服装套系无整图时用它做 hero。
  const heroItem: AssetItem | undefined = currentSet?.sheet ?? greyBase ?? identity?.item
  const metaItem = currentSet?.sheet ?? greyBase ?? identity?.item

  // —— Prompt 准入强化（Kai：一切应携带 prompt 的资产都要在详情中展示）——
  // 换装 turnaround 的生成 prompt 常落在 costume_turnaround(=sheet) 或拆分视角(=views) 上，
  // 灰底整图(sheet=turnaround_sheet)反而经常 prompt=null。旧逻辑只读 metaItem(=sheet) 会漏掉
  // 换装 prompt。这里收集当前套系全部资产的 prompt（去重）逐条展示；套系内都没有时给缺失提示。
  // 无 turnaround 套系（仅概念图①的角色）才回退到角色身份图的 prompt。
  const promptItems: AssetItem[] = []
  const seenPrompts = new Set<string>()
  const pushPrompt = (it: AssetItem | null | undefined) => {
    if (it?.prompt && !seenPrompts.has(it.prompt)) {
      seenPrompts.add(it.prompt)
      promptItems.push(it)
    }
  }
  if (currentSet) {
    pushPrompt(currentSet.sheet)            // 代表图（灰底 / costume_turnaround）
    currentSet.views.forEach(pushPrompt)    // 拆分视角 / 换装兄弟资产
  } else {
    pushPrompt(greyBase)                    // 无套系 → 灰底基础参考
    pushPrompt(identity?.item)              // 再 → 角色身份图（概念图①）
  }

  const rows: Array<[string, string]> = []
  if (promptItems.length > 0) {
    promptItems.forEach((it, i) => {
      const k = promptItems.length > 1 ? `生成 Prompt ${i + 1}` : '生成 Prompt'
      rows.push([k, it.prompt!])
    })
  } else {
    rows.push(['⚠️ Prompt', '缺失 — 该资产未携带生成 prompt'])
  }
  if (metaItem?.desc && metaItem.desc !== metaItem.name) rows.push(['描述', metaItem.desc])
  if (identity?.characterId) rows.push(['角色ID', identity.characterId])
  if (currentSet && !currentSet.isDefault) rows.push(['服装套系', currentSet.setId])
  // 模型回退链：metaItem.model → 同角色概念图 model → 同套系 views 的 model
  const modelSource =
    metaItem?.model ??
    identity?.item?.model ??
    currentSet?.views.find((v) => v.model)?.model
  if (modelSource) rows.push(['模型', modelSource])
  if (metaItem?.filePath) rows.push(['文件', metaItem.filePath])

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
  if (identities.length === 0) {
    return (
      <div className="am-empty">
        本项目暂无角色资产。<br />
        运行管线 P04（角色设计）后，turnaround 三视图会自动注册到这里。
      </div>
    )
  }

  return (
    <div className="am-scene">
      {/* 角色列表（每角色一条） */}
      <aside className="am-scene__list">
        <div className="am-head" style={{ padding: '0 4px 8px' }}>角色 · {identities.length}</div>
        {identities.map((c) => {
          const { display, role } = parseCharName(c.item.name)
          return (
            <div
              key={c.characterId}
              className={`am-scene-card ${identity?.characterId === c.characterId ? 'is-on' : ''}`}
              onClick={() => setSelectedCharId(c.characterId)}
            >
              <div className="am-scene-card__ic"><Img item={c.item} className="am-card__img" /></div>
              <div>
                <b>{display}</b>
                <span>{role ?? c.characterId}</span>
              </div>
            </div>
          )
        })}
      </aside>

      {/* 角色造型 + 服装变体展示 */}
      <div className="am-scene__main">
        {identity && (
          <>
            {/* === 层 1：角色身份（头部） === */}
            <div className="am-scene__head">
              <h1>{display}</h1>
              {role && <span className="am-badge">{role}</span>}
              <span className="am-det__sub" style={{ fontFamily: 'var(--cv-font-mono)' }}>{identity.characterId}</span>
            </div>
            <div className="am-scene__hint">
              {TYPE_LABEL.character} · 共 {identities.length} 个角色
              {costumes.length > 1 && ` · ${costumes.length} 套服装`}
              {greyBase && ` · 灰底基础参考已就位`}
            </div>

            {/* === Hero 区：左右分栏（服装套系 pills 放 Hero 上方，左大图 + 右元信息） === */}
            <div className="am-cw-hero">
              {/* 服装套系 pill 切换器（紧贴 Hero 上方，不单独成节；仅 >1 套才显示） */}
              {costumes.length > 1 && (
                <div className="am-costume-tabs am-cw-hero__pills">
                  {costumes.map((s) => (
                    <button
                      key={s.setId}
                      className={`am-costume-tab ${currentSet?.setId === s.setId ? 'is-on' : ''}`}
                      onClick={() => setSelectedSetId(s.setId)}
                      onDoubleClick={(e) => { if (s.sheet) { e.stopPropagation(); openAssetDetail(s.sheet.uuid) } }}
                      title={s.sheet ? '单击切换套系 · 双击查看资产详情' : (s.desc ?? s.setId)}
                    >
                      {s.label}
                      {s.sceneRefs.length > 0 && (
                        <span className="am-costume-tab__count">{s.sceneRefs.length}场</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <div className="am-cw-hero__body">
                {/* 左：Hero 大图（当前套系整图，无则灰底，再无则角色身份图） */}
                {heroItem ? (
                  <div className="am-det__stage am-cw-hero__img" style={{ borderRadius: 10 }}>
                    <Img
                      key={heroItem.uuid}
                      item={heroItem}
                      className="am-det__big-img am-dblclick-asset"
                      fallback="am-det__big"
                    />
                    <button
                      className="am-dblclick-hint"
                      title="双击查看资产详情"
                      onDoubleClick={(e) => { e.stopPropagation(); openAssetDetail(heroItem.uuid) }}
                    >ℹ 双击查看详情</button>
                  </div>
                ) : (
                  <div className="am-det__stage am-cw-hero__img" style={{ borderRadius: 10 }}>
                    <span style={{ color: 'var(--cv-text-3)', fontSize: 13 }}>暂无 Hero 图</span>
                  </div>
                )}

                {/* 右：元信息 / prompt / 适用场景（不再堆底部，与 Hero 并排） */}
                <div className="am-cw-hero__meta">
                  {currentSet?.desc && (
                    <div className="am-costume-desc">{currentSet.desc}</div>
                  )}

                  {rows.length > 0 && (
                    <div className="am-cw-meta-block">
                      <div className="am-seclabel am-seclabel--inline">元信息</div>
                      {rows.map(([k, v]) => (
                        <div className="am-meta-row" key={k}>
                          <div className="am-meta-row__k">{k}</div>
                          <div className="am-meta-row__v">{v}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 适用场景（服装→场景关系链，meta.scene_refs） */}
                  {currentSet && currentSet.sceneRefs.length > 0 && (
                    <div className="am-costume-scenes am-cw-hero__scenes">
                      <span className="am-costume-scenes__label">📋 适用场景</span>
                      <div className="am-costume-scenes__list">
                        {currentSet.sceneRefs.map((sc) => (
                          <span
                            key={sc}
                            className="am-chip"
                            title="点击跳转「场景与分镜」"
                            onClick={goToScenes}
                          >
                            {sc}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* === 层 2：Turnaround 四宫格（镜头参考，标题清晰化） === */}
            {currentSet && (
              <>
                <div className="am-seclabel am-cw-quad-title">
                  <span>🎞 Turnaround · 四宫格镜头参考</span>
                  {sheetValidation && (
                    <TurnaroundOrientationBadge validation={sheetValidation} />
                  )}
                </div>
                {hasRealView ? (
                  <>
                    <div style={GRID_2x2}>
                      {turnaroundGrid.map((cell, idx) => (
                        <div
                          key={`${cell.cell}-${idx}`}
                          style={{
                            borderRadius: 8,
                            overflow: 'hidden',
                            border: '1px solid var(--cv-border)',
                            background: 'var(--cv-bg-2)',
                            aspectRatio: '9 / 16',
                            position: 'relative',
                            cursor: cell.item ? 'zoom-in' : 'default',
                          }}
                          title={cell.item ? '双击查看资产详情' : undefined}
                          onDoubleClick={cell.item ? (e) => { e.stopPropagation(); openAssetDetail(cell.item!.uuid) } : undefined}
                        >
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
                      {!currentSet.isDefault && <> 当前服装：{currentSet.label}。</>}
                      {sheetValidation && (
                        <> 方向徽章基于灰底整图（a-turnaround-*）的 sheetWidth/sheetHeight 自动检测。</>
                      )}
                    </div>
                  </>
                ) : currentSet.sheet ? (
                  <div style={{ fontSize: 11, color: 'var(--cv-text-3)', lineHeight: 1.6 }}>
                    整图已就位（上方 Hero 大图）· 拆分视角（近身面部 / 正面 / 侧面 / 背面全身）将在管线裁切后填充四宫格。
                    {!currentSet.isDefault && <> 当前服装：{currentSet.label}。</>}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--cv-text-3)', lineHeight: 1.6 }}>
                    暂无 Turnaround 资产。运行管线 P04（角色设计）后，灰底整图与拆分视角会自动注册到这里。
                  </div>
                )}
              </>
            )}

            {/* === 基础/灰底 Turnaround：精简为紧凑缩略图条（底部，中间态不占主视觉） === */}
            {greyBase && (
              <div
                className="am-grey-strip"
                title="双击查看资产详情"
                onDoubleClick={(e) => { e.stopPropagation(); openAssetDetail(greyBase.uuid) }}
              >
                <div className="am-grey-strip__thumb">
                  <Img item={greyBase} className="am-grey-strip__img" fallback="am-card__emoji" />
                </div>
                <div className="am-grey-strip__meta">
                  <div className="am-grey-strip__title">
                    👕 基础 · 灰底 Turnaround
                    {greyBaseValidation && (
                      <TurnaroundOrientationBadge validation={greyBaseValidation} />
                    )}
                  </div>
                  <div className="am-grey-strip__hint">
                    全剧级身份锚点（人物一致性）· 管线中间态，不参与生产场景
                    {greyBase.filePath && (
                      <span className="am-grey-strip__file">
                        {' · '}{greyBase.filePath.split('/').pop()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
