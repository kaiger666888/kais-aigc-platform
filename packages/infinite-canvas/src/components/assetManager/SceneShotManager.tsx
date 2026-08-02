/**
 * 视图D · 场景与分镜 —— 原「场景管理」+「首尾帧流水线」合并。
 *
 * 两级视图：
 *   层1：场景多视角设定图（type==='scene'，按 filePath/name 的 S0x 分组），
 *        左列场景列表 + 右侧变体网格，可选 2 个视角并排对比。（原 SceneManager）
 *   层2：该场景下分镜的首尾帧（type==='keyframe'，按 name 的 S0x[_B0x] 关联），
 *        每镜一行 [分镜号 | 场景角度 | 首帧 v1★ v2 v3 → 尾帧 v1★ v2 v3 | 🔗连续/✂断裂]。
 *        连续性判定复用 utils/continuity.ts 的 judgeContinuity（原 FramePipelineView）。
 *
 * 数据来源（与原两个视图同源）：
 *   - 设定图 / 首尾帧 → useRealAssets(projectId)，按 type 区分。
 *   - 连续性 → 画布 graph(FlowGraphV3) + rawDataByNodeId(P09 全字段) 构建的 ShotData[]。
 */
import { useCallback, useMemo, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import type { FlowGraphV3 } from '@kais/flowgraph-v3'
import { useRealAssets } from './useRealAssets'
import { assetDetailToItem, modalityWeakVar, type AssetItem } from './assetManagerData'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import {
  CONTINUITY_REASON_LABEL,
  extractSceneBase,
  extractSceneId,
  judgeContinuity,
  type ContinuityResult,
  type ShotData,
} from '../../utils/continuity'

// ─── 场景视角（原 SceneManager） ──────────────────────────

const ANGLE_ORDER = ['front', 'angle_left', 'angle_right', 'left', 'right', 'back', 'overview', 'wide', 'close']
const ANGLE_LABEL: Record<string, string> = {
  front: '正面', angle_left: '左视', angle_right: '右视',
  left: '左', right: '右', back: '背视',
  overview: '全景', wide: '广角', close: '特写',
}
const angleLabel = (a?: string | null): string => (a ? (ANGLE_LABEL[a] ?? a) : '视角')
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

// ─── 分镜首尾帧 name 解析 ─────────────────────────────────
// name 形如 S01_first_v1 / S01_last_v1 / S01_B01_first_v1（场景级或分镜级）。

interface KeyframeName {
  sceneId: string
  /** 完整分镜号（如 S01_B01）；场景级首尾帧为 null */
  shotId: string | null
  /** 展示用分镜号：S01_B01 或场景级的 S01 */
  shotLabel: string
  frameType: 'first' | 'last'
  version: string
}

/** 从 tail（如 "first_v1"）取版本号；无 v\d+ 时原样返回。 */
function extractVersion(tail: string): string {
  const m = tail.match(/(v\d+)/i)
  return m ? m[1] : tail
}

/** 把 "S1"/"S01" 统一补零为 "S01"，与场景组 id 对齐。 */
function padSceneId(token: string): string {
  const num = token.replace(/^s/i, '')
  return 'S' + num.padStart(2, '0')
}

function parseKeyframeName(raw: string): KeyframeName | null {
  const nm = (raw || '').trim()
  const lower = nm.toLowerCase()
  const firstIdx = lower.indexOf('_first')
  const lastIdx = lower.indexOf('_last')
  let frameType: 'first' | 'last' | null = null
  let splitIdx = -1
  if (firstIdx >= 0 && (lastIdx < 0 || firstIdx <= lastIdx)) {
    frameType = 'first'
    splitIdx = firstIdx
  } else if (lastIdx >= 0) {
    frameType = 'last'
    splitIdx = lastIdx
  }
  if (!frameType || splitIdx < 0) return null

  const prefix = nm.slice(0, splitIdx) // "S01" | "S01_B01"
  const tail = nm.slice(splitIdx)      // "first_v1" | "last_v1"
  const pm = prefix.match(/^(S\d+)(?:[_-](B\d+))?$/i)
  if (!pm) {
    const sm = prefix.match(/^(S\d+)/i)
    if (!sm) return null
    return { sceneId: padSceneId(sm[1]), shotId: null, shotLabel: prefix, frameType, version: extractVersion(tail) }
  }
  const sceneId = padSceneId(pm[1])
  const shotId = pm[2] ? `${sceneId}_${pm[2]}` : null
  const shotLabel = shotId ?? sceneId
  return { sceneId, shotId, shotLabel, frameType, version: extractVersion(tail) }
}

// ─── 从 V2 raw bag 投影 ShotData（原 FramePipelineView） ────

/** character_refs（{name, role}[]）→ 角色名数组；缺数据返回空数组。 */
function extractCharNames(raw: Record<string, unknown>): string[] {
  const refs = raw.character_refs
  if (!Array.isArray(refs)) return []
  return refs.flatMap((r) => {
    if (r != null && typeof r === 'object' && 'name' in r) {
      const name = (r as { name?: unknown }).name
      return typeof name === 'string' ? [name] : []
    }
    return []
  })
}

/** 单个 storyboard 节点的 raw → ShotData；缺 shot_id/scene_ref 视为无效。 */
function shotDataFromRaw(raw: Record<string, unknown>): ShotData | null {
  const shotId = typeof raw.shot_id === 'string' ? raw.shot_id : null
  const sceneRef = typeof raw.scene_ref === 'string' ? raw.scene_ref : ''
  if (!shotId || !sceneRef) return null
  return {
    shotId,
    sceneRef,
    characterNames: extractCharNames(raw),
    startFrameDesc: typeof raw.start_frame_description === 'string' ? raw.start_frame_description : '',
    dialogueNote: typeof raw.dialogue_note === 'string' ? raw.dialogue_note : undefined,
  }
}

/** shotId 自然排序键 [scene, block]：S01_B02 < S01_B10 < S02_B01。 */
function shotSortKey(id: string): [number, number] {
  const m = id.match(/^S(\d+)_B(\d+)/i)
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [Infinity, Infinity]
}

/**
 * 从画布 graph 抽取有序、去重的 ShotData[]。
 * - 过滤 storyboard 节点（与 StoryboardTimeline 同一判定）
 * - 同 shotId 多节点（a-shot_list / a-konte 等）去重，保留首个
 * - 按 scene → block 自然排序
 */
function buildShots(
  graph: FlowGraphV3 | null,
  rawDataByNodeId: Map<string, Record<string, unknown>> | null,
): ShotData[] {
  if (!graph || !rawDataByNodeId) return []
  const collected: ShotData[] = []
  for (const node of graph.nodes) {
    if (node.kind !== 'asset' || node.stage !== 'storyboard') continue
    const raw = rawDataByNodeId.get(node.id) ?? {}
    const sd = shotDataFromRaw(raw)
    if (sd) collected.push(sd)
  }
  const seen = new Set<string>()
  return collected
    .filter((s) => (seen.has(s.shotId) ? false : (seen.add(s.shotId), true)))
    .sort((a, b) => {
      const [as, ab] = shotSortKey(a.shotId)
      const [bs, bb] = shotSortKey(b.shotId)
      return as - bs || ab - bb
    })
}

// ─── 分镜首尾帧版本三态（来自 o_assets.state + isPrimaryView） ───

interface KeyframeVer {
  item: AssetItem
  version: string
  state: string | null
  /** 选定：isPrimaryView && 未淘汰（管线下游实际使用版本，★ + 高亮） */
  selected: boolean
  /** 淘汰：state==='eliminated'（半透明 + ✕） */
  eliminated: boolean
}

interface ShotRow {
  key: string
  shotId: string | null
  shotLabel: string
  firstFrames: KeyframeVer[]
  lastFrames: KeyframeVer[]
}

interface ShotRowView {
  row: ShotRow
  /** 场景角度（从连续性 sceneRef 提取）；无连续性数据时为 null */
  angle: string | null
  cont: ContinuityResult | null
}

/** 版本排序：选定优先，再按版本号升序。 */
function versionSort(a: KeyframeVer, b: KeyframeVer): number {
  if (a.selected !== b.selected) return a.selected ? -1 : 1
  const na = parseInt(a.version.replace(/\D/g, ''), 10) || 0
  const nb = parseInt(b.version.replace(/\D/g, ''), 10) || 0
  return na - nb
}

/** 同镜版本去重：按 version 取一条（优先选定，否则首个）。 */
function dedupVersions(vers: KeyframeVer[]): KeyframeVer[] {
  const map = new Map<string, KeyframeVer>()
  for (const v of vers) {
    const prev = map.get(v.version)
    if (!prev) map.set(v.version, v)
    else if (v.selected && !prev.selected) map.set(v.version, v)
  }
  return [...map.values()].sort(versionSort)
}

/** 行排序：场景级首尾帧（无 B）置顶，再按分镜号 B 升序。 */
function rowSortKey(shotId: string | null): number {
  if (!shotId) return -1
  const m = shotId.match(/_B(\d+)/i)
  return m ? parseInt(m[1], 10) : 999
}

// ─── 组件 ────────────────────────────────────────────────

export default function SceneShotManager() {
  const projectId = useCanvasStore((s) => s.projectId)
  const graph = useCanvasStore((s) => s.graph)
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)
  const rawOpenAssetDetail = useCanvasStore((s) => s.openAssetDetail)
  const { assets, loading, error, reload } = useRealAssets(projectId)

  // 点击首/尾帧 → 打开详情 drawer（导航交互，先拍历史快照）。
  const openAssetDetail = useCallback((uuid: string) => {
    useCanvasStore.getState().navPushCallback?.()
    rawOpenAssetDetail(uuid)
  }, [rawOpenAssetDetail])

  // ── 层1：场景设定图（type==='scene'，并合并 keyframe 所属场景保证层2可达）──
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
    // keyframe 所属场景若无设定图，补空组（层2仍可达）
    for (const d of assets) {
      if (d.type !== 'keyframe') continue
      const parsed = parseKeyframeName(d.name ?? '')
      if (parsed && !map.has(parsed.sceneId)) map.set(parsed.sceneId, [])
    }
    for (const arr of map.values()) arr.sort((a, b) => angleRank(a.viewAngle) - angleRank(b.viewAngle))
    return [...map.entries()]
      .map(([id, variants]) => ({ id, variants }))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  }, [assets])

  // ── 层2：分镜首尾帧（type==='keyframe'，按 sceneId 分组）──
  const shotsByScene = useMemo<Map<string, Map<string, ShotRow>>>(() => {
    const byScene = new Map<string, Map<string, ShotRow>>()
    for (const d of assets) {
      if (d.type !== 'keyframe') continue
      const parsed = parseKeyframeName(d.name ?? '')
      if (!parsed) continue
      const { sceneId, shotId, shotLabel, frameType } = parsed
      const item = assetDetailToItem(d)
      const eliminated = (d.state ?? 'active') === 'eliminated'
      const ver: KeyframeVer = {
        item,
        version: parsed.version,
        state: d.state,
        selected: !!d.isPrimaryView && !eliminated,
        eliminated,
      }
      let sceneMap = byScene.get(sceneId)
      if (!sceneMap) { sceneMap = new Map(); byScene.set(sceneId, sceneMap) }
      let row = sceneMap.get(shotLabel)
      if (!row) {
        row = { key: shotLabel, shotId, shotLabel, firstFrames: [], lastFrames: [] }
        sceneMap.set(shotLabel, row)
      }
      ;(frameType === 'first' ? row.firstFrames : row.lastFrames).push(ver)
    }
    for (const sceneMap of byScene.values()) {
      for (const row of sceneMap.values()) {
        row.firstFrames = dedupVersions(row.firstFrames)
        row.lastFrames = dedupVersions(row.lastFrames)
      }
    }
    return byScene
  }, [assets])

  // ── 连续性判定（逐镜：首镜 prev=null，其余 prev=前一镜；跨全片有序）──
  const continuityMap = useMemo<Map<string, { result: ContinuityResult; angle: string | null }>>(() => {
    const shots = buildShots(graph, rawDataByNodeId)
    const map = new Map<string, { result: ContinuityResult; angle: string | null }>()
    shots.forEach((shot, i) => {
      const result = judgeContinuity(i > 0 ? shots[i - 1] : null, shot)
      // 角度从 sceneRef 的「场景号 + 角度」复合标识剥离（token 去掉 base）
      const fullId = extractSceneId(shot.sceneRef)
      const baseId = extractSceneBase(shot.sceneRef)
      const angle = fullId !== baseId && fullId.startsWith(baseId + '_') ? fullId.slice(baseId.length + 1) : null
      map.set(shot.shotId, { result, angle })
    })
    return map
  }, [graph, rawDataByNodeId])

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

  // 选中场景的分镜首尾帧行（附带角度 + 连续性）
  const sceneShots = useMemo<ShotRowView[]>(() => {
    if (!scene) return []
    const sceneMap = shotsByScene.get(scene.id)
    if (!sceneMap) return []
    const views: ShotRowView[] = [...sceneMap.values()].map((row) => {
      const c = row.shotId ? continuityMap.get(row.shotId) : undefined
      return { row, angle: c?.angle ?? null, cont: c?.result ?? null }
    })
    return views.sort((a, b) => rowSortKey(a.row.shotId) - rowSortKey(b.row.shotId))
  }, [scene, shotsByScene, continuityMap])

  // 连续性统计（仅计当前场景中具备连续性数据的分镜）
  const reuseCount = sceneShots.filter((s) => s.cont?.reusePrevLastFrame).length
  const cutCount = sceneShots.filter((s) => s.cont && !s.cont.reusePrevLastFrame).length

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
        运行管线 P07（场景设计）/ P09+（首尾帧）后，多视角场景图与分镜首尾帧会自动注册到这里。
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

      {/* 场景主区：层1 设定图 + 层2 分镜首尾帧 */}
      <div className="am-scene__main">
        {scene && (
          <>
            {/* ── 层1：场景多视角设定图 ── */}
            <div className="am-scene__head">
              <h1>场景 {scene.id}</h1>
              <span className="am-det__sub" style={{ fontFamily: 'var(--cv-font-mono)' }}>{variants.length} 个视角</span>
            </div>
            <div className="am-scene__hint">
              多视角变体 · 点选最多 2 个视角进行并排对比
            </div>

            <div className="am-variants">
              {variants.length === 0 ? (
                <div className="am-empty" style={{ gridColumn: '1/-1' }}>该场景暂无设定图变体</div>
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

            {/* ── 层2：该场景的分镜首尾帧 + 连续性 ── */}
            <div className="am-shot-head">
              <span className="am-pipe__stat"><b>{sceneShots.length}</b> 分镜</span>
              <span className="am-pipe__stat am-pipe__stat--reuse"><b>{reuseCount}</b> 复用尾帧</span>
              <span className="am-pipe__stat am-pipe__stat--cut"><b>{cutCount}</b> 独立生成</span>
              <span className="am-pipe__legend">
                <span className="am-pipe__legend-item">
                  <i className="am-pipe__dot am-pipe__dot--cont" /> 连续·复用
                </span>
                <span className="am-pipe__legend-item">
                  <i className="am-pipe__dot am-pipe__dot--cut" /> 断裂·独立
                </span>
              </span>
            </div>

            <div className="am-shot-list">
              {sceneShots.length === 0 ? (
                <div className="am-empty">该场景暂无分镜首尾帧（type=keyframe 资产缺失）。</div>
              ) : sceneShots.map(({ row, angle, cont }) => (
                <div className="am-shot-row" key={row.key}>
                  <span className="am-shot-row__id" title={row.shotId ?? row.shotLabel}>{row.shotLabel}</span>
                  <span className="am-shot-row__angle">{angle ? angleLabel(angle) : '—'}</span>

                  <div className="am-shot-frames">
                    {/* 首帧 */}
                    <div className="am-shot-frames__group">
                      {row.firstFrames.length === 0 ? (
                        <span className="am-shot-frame am-shot-frame--empty" title="无首帧">首</span>
                      ) : row.firstFrames.map((v) => (
                        <ShotFrame key={`f-${v.item.uuid}`} ver={v} onClick={() => openAssetDetail(v.item.uuid)} />
                      ))}
                    </div>

                    <span className="am-shot-arrow" title="首帧 → 尾帧">→</span>

                    {/* 尾帧 */}
                    <div className="am-shot-frames__group">
                      {row.lastFrames.length === 0 ? (
                        <span className="am-shot-frame am-shot-frame--empty" title="无尾帧">尾</span>
                      ) : row.lastFrames.map((v) => (
                        <ShotFrame key={`l-${v.item.uuid}`} ver={v} onClick={() => openAssetDetail(v.item.uuid)} />
                      ))}
                    </div>
                  </div>

                  {cont ? (
                    <span
                      className={`am-shot-cont ${cont.type === 'continuous' ? 'am-shot-cont--cont' : 'am-shot-cont--cut'}`}
                      title={cont.reusePrevLastFrame ? `复用 ${cont.prevShotId ?? '前镜'} 尾帧` : CONTINUITY_REASON_LABEL[cont.reason]}
                    >
                      {cont.type === 'continuous' ? '🔗 连续' : '✂ 断裂'}
                    </span>
                  ) : (
                    <span className="am-shot-cont am-shot-cont--none" title="无连续性数据">—</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** 单个首/尾帧版本缩略图（三态：选定 ★ / 待选 / 淘汰 ✕）。 */
function ShotFrame({ ver, onClick }: { ver: KeyframeVer; onClick: () => void }) {
  const cls = ver.eliminated
    ? 'am-shot-frame--eliminated'
    : ver.selected
      ? 'am-shot-frame--selected'
      : ''
  return (
    <div
      className={`am-shot-frame ${cls}`}
      onClick={onClick}
      title={`${ver.version}${ver.selected ? ' · 选定' : ver.eliminated ? ' · 淘汰' : ' · 待选'}`}
    >
      {ver.selected && <span className="am-shot-frame__star">★</span>}
      {ver.eliminated && <span className="am-shot-frame__x">✕</span>}
      <Img item={ver.item} className="am-shot-frame__img" fallback="am-shot-frame__emoji" />
      <span className="am-shot-frame__ver">{ver.version}</span>
    </div>
  )
}
