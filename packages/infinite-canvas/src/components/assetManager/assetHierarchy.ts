/**
 * 62-04: UI-SPEC 共享 util 提取契约之 handler 家（含 store 副作用）；
 * 纯函数家在 groupCanvasLinkage.ts（零 React / 零 store）。
 *
 * 本模块收拢资产三态流转的三个 handler（selectGroupWinner / deselectAsset /
 * restoreAsset），资产库（AssetLibrary）与资产层级（AssetHierarchy）两视图同调用点
 * （HIER-04：单组行为两路径一致）。handler 经 ctx 注入 assets/patchLocal/reload/
 * showToast 等组件闭包依赖——模块本身不 import store / 不 import React，
 * 但会发起网络副作用（updateAsset / selectVariantWinner），故属 handler 家而非纯函数家。
 *
 * D-05 语义（62-CONTEXT 裁定）：
 *   - 主通道 = updateAsset 循环（winner 置 isPrimaryView+active、同组其余淘汰），
 *     o_assets 为资产中心真值源；失败回滚 reload（既有行为逐字）。
 *   - 增量通道 = 组映射画布且 winner 有节点时，fire-and-forget 调既有
 *     POST /api/canvas/v2/variant-groups/:groupId/select-winner（复用其事务 +
 *     D-07 反向同步 + review bridge + manifest writeback 闭环）。失败仅 toast
 *     「画布侧同步失败」+ console.warn，不回滚不阻断——与 select-winner 自身
 *     「canvas 为真值源不回滚」镜像对称：o_assets 为本域真值源。
 */
import {
  updateAsset,
  selectVariantWinner,
  type AssetDetail,
} from '../../services/canvasApi'
import {
  findVariantGroupForAsset,
  getGroupDisplayInfo,
  getGroupKey,
  resolveAssetNodeId,
} from './groupCanvasLinkage'
import type { FlowGraphV3 } from '@kais/flowgraph-v3'

/** toast 通道（形状对齐 canvasStore.showToast；本模块不 import store，经 ctx 注入）。 */
export type HierarchyToast = (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void

/** D-05 画布 best-effort 同步参数（组映射画布且 winner 有节点时触发 select-winner）。 */
export interface CanvasSyncCtx {
  projectId: number
  episodesId: number
  graph: FlowGraphV3 | null
}

/** 三态流转共享 handler 的上下文（组件闭包显式化注入；两视图各自构造）。 */
export interface SelectionCtx {
  assets: AssetDetail[]
  patchLocal: (assetId: number, patch: Partial<AssetDetail>) => void
  reload: () => void
  showToast: HierarchyToast
  /** 缺省（store 尚未选定项目/分集）时不触发画布侧同步。 */
  syncCanvas?: CanvasSyncCtx
}

/**
 * 待选→选定：新选资产置 selected，同组其余所有变体自动淘汰（三态流转）。
 * 全程乐观更新——绝不 reload（避免列表闪烁/跳顶），仅在后端失败时回滚。
 * （handleSelect :849-872 全语义逐字搬运；D-05 增量 = 成功 toast 后的
 * fire-and-forget select-winner，见函数尾注释。）
 */
export async function selectGroupWinner(
  assetId: number,
  groupKey: string,
  ctx: SelectionCtx,
): Promise<void> {
  const { assets, patchLocal, reload, showToast } = ctx
  const sameGroup = assets.filter((d) => getGroupKey(d) === groupKey)
  // 同组中除新选资产外的所有其他变体（旧选定 + 待选）全部淘汰
  const others = sameGroup.filter((d) => d.id !== assetId)

  // 1. 乐观更新 UI：其余变体 → 淘汰；新选 → 选定。
  for (const d of others) {
    patchLocal(d.id, { isPrimaryView: false, state: 'eliminated' })
  }
  patchLocal(assetId, { isPrimaryView: true, state: 'active' })

  // 2. 后端同步（不 reload；失败时整体回滚到真实状态）。
  try {
    for (const d of others) {
      try { await updateAsset(d.id, { isPrimaryView: false, state: 'eliminated' }) } catch { /* 忽略单项失败 */ }
    }
    await updateAsset(assetId, { isPrimaryView: true, state: 'active' })
    const groupInfo = getGroupDisplayInfo(assets.find((d) => d.id === assetId)!)
    showToast(`已设为选定资产 · ${groupInfo.title}（${others.length} 个变体已自动淘汰）`, 'success')
  } catch (err) {
    showToast('设置失败: ' + (err as Error).message, 'error')
    await reload()
    return
  }

  // 3. D-05 增量（成功 toast 后）：组映射画布且 winner 有节点 → fire-and-forget
  //    select-winner。不 await 不回滚不阻断。
  //
  // 幂等断言纪律 pin（RESEARCH C 双通道事实，62-07 e2e 必须按此写断言）：
  //   PATCH isPrimaryView=true 服务端已自动触发 applyRegistrySelectionToCanvas
  //   （selectWinnerInGroup 不经 HTTP）——常见路径下本客户端 POST 是幂等 no-op，
  //   属预期行为；UI 不因响应 applied:false 报错，toast「画布侧同步失败」仅挂
  //   客户端 POST 的非 2xx（ApiError），服务端 linkage 失败静默是既有行为。
  const sync = ctx.syncCanvas
  if (!sync) return
  const vg = findVariantGroupForAsset(sync.graph, assetId)
  if (!vg) return
  const nodeId = resolveAssetNodeId(sync.graph, assetId)
  if (!nodeId) return
  void selectVariantWinner(sync.projectId, sync.episodesId, vg.groupId, nodeId)
    .catch(() => {
      ctx.showToast('画布侧同步失败', 'warning')
      console.warn('[assetHierarchy] select-winner 画布侧同步失败（资产态已持久化，不回滚）', {
        groupId: vg.groupId,
        winnerNodeId: nodeId,
        assetId,
      })
    })
}

/**
 * 选定→待选：该资产退回待选，同组被淘汰的兄弟变体（不含自身）一并恢复待选。
 * （renderCard 内联取消选定 handler 体提取具名化；乐观更新 + 后端同步 + toast
 * 文案逐字保留。）
 */
export async function deselectAsset(d: AssetDetail, ctx: SelectionCtx): Promise<void> {
  const { assets, patchLocal, reload, showToast } = ctx
  const groupKey = getGroupKey(d)
  // 同组被淘汰的兄弟变体（不含自身）将随取消选定一并恢复为待选。
  const eliminated = assets.filter(
    (dd) => getGroupKey(dd) === groupKey && dd.id !== d.id && dd.state === 'eliminated',
  )
  // 乐观更新 UI：该资产 → 待选；同组淘汰 → 恢复待选。
  patchLocal(d.id, { isPrimaryView: false, state: 'active' })
  for (const dd of eliminated) patchLocal(dd.id, { state: 'active' })
  // 后端同步（不 reload；失败时回滚）。
  try {
    await updateAsset(d.id, { isPrimaryView: false, state: 'active' })
    for (const dd of eliminated) {
      try { await updateAsset(dd.id, { state: 'active' }) } catch { /* 忽略单项失败 */ }
    }
    showToast(`已退回待选 · ${getGroupDisplayInfo(d).title}（${eliminated.length} 个淘汰变体已恢复）`, 'success')
  } catch (err) {
    showToast('操作失败: ' + (err as Error).message, 'error')
    await reload()
  }
}

/**
 * 淘汰→待选：手动恢复。（renderCard 内联恢复 handler 体提取具名化；文案逐字保留。）
 */
export async function restoreAsset(d: AssetDetail, ctx: SelectionCtx): Promise<void> {
  const { patchLocal, reload, showToast } = ctx
  // 乐观更新 UI：淘汰 → 待选。
  patchLocal(d.id, { state: 'active', isPrimaryView: false })
  try {
    await updateAsset(d.id, { state: 'active' })
    showToast('已恢复到待选', 'success')
  } catch (err) {
    showToast('恢复失败: ' + (err as Error).message, 'error')
    await reload()
  }
}
