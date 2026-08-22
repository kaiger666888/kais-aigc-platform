/**
 * src/hooks/useStaleRerun.ts — REGEN-03(52-05):stale 下游一键重跑统一处理器。
 *
 * 双出口共用(StaleSection「🔄 重跑下游」按钮 + NodeBadges stale 角标点击):
 *  1. 守卫:graph 空 / projectId·episodesId 缺失(fixture 模式,地雷 #13)/
 *     orchestration.status==='running'(handleOrchestrate 范式)→ toast 早退。
 *  2. getDownstreamIds(graph, nodeId) + 自身 → 过滤 kind==='asset' && stale!=null
 *     → 空则 toast「无 stale 下游」早退。
 *  3. 保存:saveCanvasGraph(serializeGraphToV2)——此刻 data.stale 已上 wire(52-02),
 *     服务端 orchestrate 可见 stale 语义(stale success 不跳过)。
 *  4. orchestrateCanvas(pid, eid, nodeIds 子集)——批量执行走既有通道。
 *
 * 进度反馈复用既有 orchestrate:* socket 链(useCanvasSocket → FlowCanvas),本 hook
 * 不订阅 socket;stale 清除交给 node:state → applySocketNodeState(52-01 running/success
 * 自动清)——重跑完成后角标/StaleSection 自动消失,本 hook 不手动清 stale。
 */
import { useCallback } from 'react'
import { getDownstreamIds } from '@kais/flowgraph-v3'
import { useCanvasStore } from '../store/canvasStore'
import { saveCanvasGraph, orchestrateCanvas } from '../services/canvasApi'
import { serializeGraphToV2 } from '../v3/serialize'

export function useStaleRerun(): { rerunStaleChain: (nodeId: string) => Promise<void> } {
  const showToast = useCanvasStore((s) => s.showToast)

  const rerunStaleChain = useCallback(
    async (nodeId: string) => {
      const { graph, rawDataByNodeId, viewport, projectId, episodesId, orchestration } =
        useCanvasStore.getState()
      if (!graph) {
        showToast('画布尚未加载完成,无法重跑', 'warning')
        return
      }
      // fixture 模式等无项目上下文 → 孤儿请求早退(deleteNode 范式,地雷 #13)
      if (!projectId || !episodesId) {
        showToast('缺少项目上下文', 'warning')
        return
      }
      // 编排进行中 → 不并发(handleOrchestrate 同款守卫)
      if (orchestration.status === 'running') {
        showToast('编排进行中,请稍后再试', 'warning')
        return
      }
      // 收集 stale 链:下游 + 自身,过滤出带 stale 标记的资产节点
      const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
      const chainIds = [nodeId, ...getDownstreamIds(graph, nodeId)]
      const staleNodeIds = chainIds.filter((id) => {
        const n = nodeById.get(id)
        return n?.kind === 'asset' && n.stale != null
      })
      if (staleNodeIds.length === 0) {
        showToast('无 stale 下游可重跑', 'info')
        return
      }
      try {
        // 先保存(同一 serializeGraphToV2 入口,WRITE-01):data.stale 上 wire,
        // 服务端 orchestrate 的 stale-success 不跳过谓词(52-02)才有信息源
        const wire = serializeGraphToV2(graph, rawDataByNodeId, viewport ?? undefined)
        await saveCanvasGraph(projectId, episodesId, wire)
        // nodeIds 子集批量执行:进度走既有 orchestrate:* socket 链
        const res = await orchestrateCanvas(projectId, episodesId, staleNodeIds)
        showToast(`已提交重跑下游(${res.total ?? staleNodeIds.length} 个节点)`, 'success')
      } catch (err) {
        showToast(`重跑下游失败: ${(err as Error).message}`, 'error')
      }
    },
    [showToast],
  )

  return { rerunStaleChain }
}
