/**
 * portalApi.ts — 门户数据薄层（Phase 57-02 Task 3）。
 *
 * 纪律：fetch 逻辑零重写 —— 全部 re-export 自 @ic/services/canvasApi
 * （apiCall/重试/超时/CancelToken 同链，UI-SPEC U-07 monorepo alias 复用）。
 */
import type { ProjectInfo } from '@ic/services/canvasApi'

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
