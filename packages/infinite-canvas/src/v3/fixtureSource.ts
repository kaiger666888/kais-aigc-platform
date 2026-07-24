/**
 * src/v3/fixtureSource.ts — fixture 模式数据源（SPEC-step5 A.3）。
 *
 *  - `?fixture=decompose|valid`：直接加载 packages/flowgraph-v3/fixtures 对应样本（import JSON），
 *    绕过 socket/REST——供静态预览 / 冒烟 / 离线开发。
 *  - 后端不可达：自动 fallback 到 decompose fixture，由调用方（store action）toast 提示。
 *    P17：视口恢复由画布层负责（meta.viewport 随图返回，不在本模块处理）。
 *
 * 本模块不碰 store、不弹 toast——纯数据解析，副作用（toast/socket 绕过）由 store/FlowCanvas 接线。
 */
import { validateFlowGraphV3, type FlowGraphV3 } from '@kais/flowgraph-v3'
import { adaptV2Graph } from './adapter'
import decomposeFixture from '../../../flowgraph-v3/fixtures/v3-decompose-import.sample.json'
import validFixture from '../../../flowgraph-v3/fixtures/v3-valid.sample.json'

export type FixtureMode = 'decompose' | 'valid'

export type GraphSource = 'fixture' | 'backend' | 'fixture-fallback'

export interface LoadedGraph {
  graph: FlowGraphV3
  warnings: string[]
  source: GraphSource
  /** true = 后端不可达触发的自动降级（调用方应 toast）。 */
  fallbackUsed: boolean
}

export const BACKEND_FALLBACK_MESSAGE =
  '画布后端不可达，已加载离线示例数据（decompose fixture）'

const FIXTURES: Record<FixtureMode, unknown> = {
  decompose: decomposeFixture,
  valid: validFixture,
}

/**
 * 解析 ?fixture= 参数。显式传 search 便于测试；缺省读 window.location.search。
 * 非法值 → null + console.warn（不崩）。
 */
export function getFixtureMode(search?: string): FixtureMode | null {
  let s = search
  if (s == null) {
    if (typeof window === 'undefined') return null
    s = window.location.search
  }
  const v = new URLSearchParams(s).get('fixture')
  if (v == null) return null
  if (v === 'decompose' || v === 'valid') return v
  console.warn(`[fixtureSource] 未知 fixture 模式 "${v}"，忽略`)
  return null
}

/** 加载指定 fixture 并过包内 zod（fixture 是 SSOT 样本，理应 0 warning）。 */
export function loadFixtureGraph(mode: FixtureMode): LoadedGraph {
  const raw = FIXTURES[mode]
  const result = validateFlowGraphV3(raw)
  if (result.ok) {
    return { graph: result.data, warnings: [], source: 'fixture', fallbackUsed: false }
  }
  // fixture 自身损坏 = 工程事故：仍走消费端宽松修复（adaptV2Graph 的 V3 直通修复环），
  // 不 throw，把 zod 错误透传进 warnings 让 UI/测试可见。
  const adapted = adaptV2Graph(raw)
  return {
    graph: adapted.graph,
    warnings: [`fixture ${mode} 未过 zod，已按 P22 修复:`, ...result.errors, ...adapted.warnings],
    source: 'fixture',
    fallbackUsed: false,
  }
}

/**
 * 初始图数据源解析（SPEC A.3 的完整决策树）：
 *  1. ?fixture=decompose|valid → fixture（绕过 socket/REST）；
 *  2. 否则走调用方给的 loadBackend（REST 全量）→ adaptV2Graph；
 *  3. loadBackend 抛错（含后端不可达）→ 自动 fallback decompose fixture + fallbackUsed:true
 *     （toast 由调用方发，文案见 BACKEND_FALLBACK_MESSAGE）。
 */
export async function resolveInitialGraph(opts: {
  fixtureMode?: FixtureMode | null
  loadBackend?: () => Promise<unknown>
}): Promise<LoadedGraph> {
  const mode = opts.fixtureMode !== undefined ? opts.fixtureMode : getFixtureMode()
  if (mode) return loadFixtureGraph(mode)

  if (opts.loadBackend) {
    try {
      const raw = await opts.loadBackend()
      const adapted = adaptV2Graph(raw)
      return { graph: adapted.graph, warnings: adapted.warnings, source: 'backend', fallbackUsed: false }
    } catch (err) {
      const fallback = loadFixtureGraph('decompose')
      return {
        graph: fallback.graph,
        warnings: [
          `后端加载失败（${(err as Error)?.message ?? String(err)}），自动 fallback decompose fixture`,
          ...fallback.warnings,
        ],
        source: 'fixture-fallback',
        fallbackUsed: true,
      }
    }
  }

  // 无后端通道（纯静态部署）→ 直接给 decompose fixture
  const fallback = loadFixtureGraph('decompose')
  return { ...fallback, source: 'fixture-fallback', fallbackUsed: true }
}

/** 后端探活（默认打画布后端 health；2s 超时视为不可达）。 */
export async function probeBackend(
  url = '/api/canvas/v2/health',
  timeoutMs = 2000,
): Promise<boolean> {
  if (typeof fetch !== 'function') return false
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
