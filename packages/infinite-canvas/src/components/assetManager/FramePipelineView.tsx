/**
 * 视图E · 首尾帧生成流水线 —— 分镜级连续性判定可视化。
 *
 * 把 utils/continuity.ts 的 judgeContinuity 结果画成一条纵向分镜链：
 *   - 🔗 连续（同场景·同角度·同角色·无转场）→ 复用上一镜尾帧（teal 实线相连）
 *   - ✂ 断裂（场景/角度切换 · 硬转场 · 角色无交集 · 首镜）→ 首帧独立生成（rose 断开）
 *
 * 数据：与 StoryboardTimeline 同源 —— 直接消费 useCanvasStore.graph（FlowGraphV3）
 *   + rawDataByNodeId（V2 穿透，保留 P09 params 全字段：shot_id / scene_ref /
 *   character_refs / start_frame_description / dialogue_note）。画布在项目加载时
 *   即填充 store（不依赖 viewMode），故资产视图内可直接读取，无需额外 API。
 *
 * 详见 docs/frame-generation-pipeline.md（连续性判定规则 + 15 镜结果表）。
 */
import { useMemo } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import type { FlowGraphV3 } from '@kais/flowgraph-v3'
import {
  CONTINUITY_REASON_LABEL,
  extractSceneId,
  judgeContinuity,
  type ContinuityReason,
  type ShotData,
} from '../../utils/continuity'

// ─── 从 V2 raw bag 投影 ShotData ───────────────────────────

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

// ─── 断裂原因补充说明（卡片第二行） ─────────────────────────

const REASON_DETAIL: Record<ContinuityReason, string> = {
  same_scene_same_chars: '',
  scene_change: '场景或摄影角度变化',
  transition: '前镜含硬转场 / 时间跳跃信号',
  first_shot: '全片首镜，无前序可复用',
  character_change: '出场角色集合无交集',
}

// ─── 组件 ────────────────────────────────────────────────

export default function FramePipelineView() {
  const graph = useCanvasStore((s) => s.graph)
  const rawDataByNodeId = useCanvasStore((s) => s.rawDataByNodeId)

  const shots = useMemo(() => buildShots(graph, rawDataByNodeId), [graph, rawDataByNodeId])

  // 逐镜判定：首镜 prev=null，其余 prev=前一镜
  const rows = useMemo(
    () =>
      shots.map((shot, i) => ({
        shot,
        continuity: judgeContinuity(i > 0 ? shots[i - 1] : null, shot),
      })),
    [shots],
  )

  const reuseCount = rows.filter((r) => r.continuity.reusePrevLastFrame).length
  const cutCount = rows.length - reuseCount

  if (!graph) {
    return <div className="am-empty">画布未加载，请先打开项目。</div>
  }
  if (shots.length === 0) {
    return <div className="am-empty">未找到 P09 分镜数据（shot_id / scene_ref 缺失）。</div>
  }

  return (
    <div className="am-pipe">
      {/* 统计 + 图例 */}
      <div className="am-pipe__head">
        <span className="am-pipe__stat">
          <b>{shots.length}</b> 分镜
        </span>
        <span className="am-pipe__stat am-pipe__stat--reuse">
          <b>{reuseCount}</b> 复用尾帧
        </span>
        <span className="am-pipe__stat am-pipe__stat--cut">
          <b>{cutCount}</b> 独立生成
        </span>
        <span className="am-pipe__legend">
          <span className="am-pipe__legend-item">
            <i className="am-pipe__dot am-pipe__dot--cont" /> 连续·复用
          </span>
          <span className="am-pipe__legend-item">
            <i className="am-pipe__dot am-pipe__dot--cut" /> 断裂·独立
          </span>
        </span>
      </div>

      {/* 纵向分镜链 */}
      <div className="am-pipe__list">
        {rows.map(({ shot, continuity }, i) => {
          const isCont = continuity.type === 'continuous'
          const isStart = continuity.reason === 'first_shot'
          // 与「下一镜」的连线态：下一镜连续则实线，否则断开
          const nextCont = i < rows.length - 1 ? rows[i + 1].continuity.type === 'continuous' : false
          return (
            <div className={`am-pipe__item ${isCont ? 'is-cont' : 'is-cut'}`} key={shot.shotId}>
              {/* 左侧轨道：节点圆点 + 连接线 */}
              <div className="am-pipe__rail">
                <span
                  className={`am-pipe__node ${
                    isCont ? 'am-pipe__node--cont' : isStart ? 'am-pipe__node--start' : 'am-pipe__node--cut'
                  }`}
                />
                {i < rows.length - 1 && (
                  <span className={`am-pipe__line ${nextCont ? 'is-cont' : 'is-cut'}`} />
                )}
              </div>

              {/* 分镜卡片 */}
              <div className="am-pipe__card">
                <div className="am-pipe__row">
                  <span className="am-pipe__id">{shot.shotId}</span>
                  <span className={`am-pipe__verdict ${isCont ? 'am-pipe__verdict--cont' : 'am-pipe__verdict--cut'}`}>
                    {isCont ? '🔗 连续' : '✂ 断裂'}
                  </span>
                  <span className="am-pipe__reason">{CONTINUITY_REASON_LABEL[continuity.reason]}</span>
                  <span className="am-pipe__scene" title={shot.sceneRef}>
                    {extractSceneId(shot.sceneRef)}
                  </span>
                  <span className="am-pipe__chars">
                    {shot.characterNames.length ? shot.characterNames.join(' · ') : '—'}
                  </span>
                </div>
                <div className="am-pipe__detail">
                  {isCont ? (
                    <span className="am-pipe__reuse">
                      复用 <b>{continuity.prevShotId}</b> 尾帧作为首帧
                    </span>
                  ) : (
                    <span className="am-pipe__gen">
                      首帧独立生成
                      {REASON_DETAIL[continuity.reason] && <em>（{REASON_DETAIL[continuity.reason]}）</em>}
                      {continuity.prevShotId && <span className="am-pipe__prev">← 前镜 {continuity.prevShotId}</span>}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
