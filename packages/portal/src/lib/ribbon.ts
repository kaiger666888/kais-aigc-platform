/**
 * ribbon.ts — 管线带纯派生函数（Phase 57-02 Task 3，签名元素的数据半边）。
 *
 * phase 词汇单源：PHASE_REGISTRY（@ic alias → 55-D04 单一注册表，禁止内联表）。
 * vitest 直测本模块（__tests__/ribbon.test.ts）；PipelineRibbon.tsx 只做渲染。
 */
import { PHASE_REGISTRY, type PipelinePhaseDef, type PhaseGroup } from '@ic/constants/phaseRegistry'

export interface RibbonSegment {
  /** 阶段码 P01 / P09b …（mono 标注与 tooltip 前缀） */
  code: string
  /** 中文名（tooltip） */
  name: string
  /** 分组（段填充色编码） */
  group: PhaseGroup
  /** 子阶段段（60% 高度、底对齐渲染） */
  sub: boolean
  /** khs 契约键（深链 zone 词汇） */
  khsPrefix: string
  /** 图数据整数 phaseIndex（直方图键） */
  phaseIndex: number
  /** 全局排序键（输出按其升序） */
  sortKey: number
  /** 直方图计数（tooltip `· {N} 节点`） */
  count: number
  /** count > 0 */
  filled: boolean
}

/**
 * 注册表 + 每集 phase 直方图 → 管线带段序（sortKey 升序）。
 * counts 为 projects.ts episodes[].phases（Record<phaseIndex, count>，
 * count>0 才有键）；缺失键按 0 处理（空段）。注册表外 phaseIndex 不出段
 * （门户只呈现注册表内制程 —— UI-SPEC §Signature 4）。
 */
export function ribbonSegments(
  registry: readonly PipelinePhaseDef[],
  counts: Record<number, number>,
): RibbonSegment[] {
  return [...registry]
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((p) => {
      const count = counts[p.phaseIndex] ?? 0
      return {
        code: p.code,
        name: p.name,
        group: p.group,
        sub: p.sub === true,
        khsPrefix: p.khsPrefix,
        phaseIndex: p.phaseIndex,
        sortKey: p.sortKey,
        count,
        filled: count > 0,
      }
    })
}

/**
 * D-05 深链发码（门户是唯一发码方之一）：/canvas?project={id}&ep={ep}[&zone={khsPrefix}]。
 * zone 缺省 = 集级深链（micro 档整条点击）；有 zone = 段级泳道深链（full 档）。
 * 参数键用 /canvas 白名单词汇（服务端 302 翻译成 projectId/episodesId）。
 */
export function ribbonHref(projectId: number, ep: number, zone?: string): string {
  const qs = new URLSearchParams()
  qs.set('project', String(projectId))
  qs.set('ep', String(ep))
  if (zone !== undefined && zone !== '') qs.set('zone', zone)
  return `/canvas?${qs.toString()}`
}

/** 便捷再导出（消费方免双 import）。 */
export { PHASE_REGISTRY }
