/**
 * portalApi.ts — 门户数据薄层（Phase 57-02 Task 3 / 57-05 Task 2 扩展）。
 *
 * 纪律：fetch 逻辑零重写 —— 全部 re-export 自 @ic/services/canvasApi
 * （apiCall/重试/超时/CancelToken 同链，UI-SPEC U-07 monorepo alias 复用）。
 */
import {
  fetchProjects,
  loadCanvasGraph,
  fetchGateState,
  type ProjectInfo,
  type ProjectEpisode,
  type GateStateSnapshot,
} from '@ic/services/canvasApi'
import type { FlowGraph } from '@ic/types/canvas'
import { resolveProjectId } from '../lib/delivery'

export { fetchProjects } from '@ic/services/canvasApi'
export type { ProjectInfo, ProjectEpisode } from '@ic/services/canvasApi'

/** 集行平铺视图（projectId 反查归属；交付页 /deliver/:ep 反查同用，Q5）。 */
export interface EpisodeRow {
  projectId: number
  projectName: string
  /** episodesId */
  ep: number
  nodeCount: number
  /** 每集 phase 直方图（additive；无数据时为空对象） */
  phases: Record<number, number>
}

/** projects → 集行平铺（管线带 micro 与交付页 projectId 反查的派生助手）。 */
export function episodesOf(projects: ProjectInfo[]): EpisodeRow[] {
  const rows: EpisodeRow[] = []
  for (const p of projects) {
    for (const ep of p.episodes ?? []) {
      rows.push({
        projectId: p.id,
        projectName: p.name,
        ep: ep.id,
        nodeCount: ep.nodeCount,
        phases: (ep as { phases?: Record<number, number> }).phases ?? {},
      })
    }
  }
  return rows
}

// ─── 交付页数据组装（57-05 Task 2；U-10 三个既有端点，零新建后端）────────

/** loadDelivery 产物：no-episode = projects 反查未命中（集不存在）。 */
export type DeliveryLoad =
  | { kind: 'no-episode' }
  | {
      kind: 'data'
      projectId: number
      projectName: string
      /** load-v2 全图；空集（无画布数据）为 null */
      graph: FlowGraph | null
      /** gate-state 快照；拉取失败为 null（fetchGateState 失败不抛，终审卡走降级态） */
      gateState: GateStateSnapshot | null
    }

/**
 * /deliver/:ep 数据面：fetchProjects → resolveProjectId 反查（Q5）→
 * loadCanvasGraph ∥ fetchGateState 并行（FlowCanvas 首拉同构；gate-state
 * 失败返回 null 不阻塞版面——终审卡降级横幅）。
 */
export async function loadDelivery(ep: number): Promise<DeliveryLoad> {
  const projects = await fetchProjects()
  const projectId = resolveProjectId(projects, ep)
  if (projectId == null) return { kind: 'no-episode' }
  const project = projects.find((p) => p.id === projectId)
  const [graph, gateState] = await Promise.all([
    loadCanvasGraph(projectId, ep),
    fetchGateState(projectId, ep),
  ])
  return {
    kind: 'data',
    projectId,
    projectName: project?.name ?? `项目 ${projectId}`,
    graph,
    gateState,
  }
}
