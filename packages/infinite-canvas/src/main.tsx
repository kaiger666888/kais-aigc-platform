import React from 'react'
import ReactDOM from 'react-dom/client'
import { io } from 'socket.io-client'
import FlowCanvas from './components/FlowCanvas'
import { getLiveViewport } from './components/FlowCanvas'
import { placeNewAsset } from './utils/placeNewAsset'
import { useCanvasStore } from './store/canvasStore'
import './theme/tokens.css' // Step 5 设计 tokens（--cv-* 全局变量）

// Test mode hook — 当 URL 含 ?testMode=1 时,挂载 store 控制接口到 window。
// 用于 Playwright 测试在不依赖 React Flow 复杂 selection 模型的前提下驱动状态。
// 仅在显式 testMode 下激活,production bundle 默认 noop。
function paneFlowCenter(v: { x: number; y: number; zoom: number }): { x: number; y: number } {
  // RF pane 中心(非 window 中心——顶栏偏移;与 FlowCanvas 的
  // screenToFlowPosition 同基准,桥内放置/断言必须一致)
  const pane = document.querySelector('.react-flow')
  const rect = pane?.getBoundingClientRect()
  const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
  const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
  return { x: (cx - v.x) / v.zoom, y: (cy - v.y) / v.zoom }
}

function getLiveViewportSafeCenter(): { x: number; y: number } {
  const v = getLiveViewport()
  if (v == null || !Number.isFinite(v.zoom) || v.zoom <= 0) return { x: 0, y: 0 }
  return paneFlowCenter(v)
}

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('testMode')) {
  ;(window as any).__kaisCanvas = {
    setSelectedNodeIds: (ids: string[]) => useCanvasStore.getState().setSelectedNodeIds(ids),
    getSelectedNodeIds: () => useCanvasStore.getState().selectedNodeIds,
    getOrchestration: () => useCanvasStore.getState().orchestration,
    getNodes: () => useCanvasStore.getState().nodes,
    getEdges: () => useCanvasStore.getState().edges,
    showToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') =>
      useCanvasStore.getState().showToast(msg, type),
    // 暴露本地 socket.io-client —— e2e 用它监听 WebSocket 事件，替代不可靠的
    // 浏览器侧 CDN dynamic import（沙箱环境浏览器常无法访问 cdn.socket.io）。
    io,
    // 55-07:canonical graph 只读桥(placement 断言读 graph 节点 position——
    // rfNodes 的 position 是布局缓存,经 layoutFlowGraph 重算,非放置决策)。
    getGraph: () => useCanvasStore.getState().graph,
    // 60-04 (D-09): 详情锚只读桥——e2e 面板保持/重锚断言读 store.detailNode 真值
    // (同 id 重锚 / 诚实收起的 id 级证据面,56-06 openG16 同型 seam;testMode 门内零运行时影响)。
    getDetailNode: () => useCanvasStore.getState().detailNode,
    // 60-04 (D-07): 选中锚只读桥——selectedNodeIds 是 RF 瞬态镜像(onSelectionChange
    // 在 setGraph 节点换血时被 RF 清空,FlowCanvas L621),对称断言须读 store.selectedNode
    // 真锚(setGraph L452 与 detailNode 相邻行同语义重锚;testMode 门内零运行时影响)。
    getSelectedNode: () => useCanvasStore.getState().selectedNode,
    // 61-01 (DEBT-01): drop 锚换算只读桥——e2e 有界断言面(60-04 getDetailNode 同型
    // seam)。与 paneFlowCenter 同基准:pane rect 原点 + live viewport transform
    // (顶栏 48px 偏移已含在 rect.top),即 screenToFlowPosition(p) 的等价换算。
    screenToFlow: (p: { x: number; y: number }): { x: number; y: number } | null => {
      const v = getLiveViewport()
      if (v == null || !Number.isFinite(v.zoom) || v.zoom <= 0) return null
      const pane = document.querySelector('.react-flow')
      const rect = pane?.getBoundingClientRect()
      return {
        x: (p.x - (rect?.left ?? 0) - v.x) / v.zoom,
        y: (p.y - (rect?.top ?? 0) - v.y) / v.zoom,
      }
    },
    // 56-06:scored 事件模拟(scored 死信修复链的 e2e 驱动面)
    emitScored: (nodeId: string, aiScore: unknown): void => {
      useCanvasStore.getState().applySocketScored(nodeId, aiScore)
    },
    // 56-06:G16 听审工作台直开(store seam;gate 行入口需 gate 快照,e2e 直驱)
    openG16: (): void => {
      // 模块级单例:dynamic import 与 FlowCanvas 挂载处同一模块实例
      void import('./components/g16/voiceAuditStore').then((m) => m.useVoiceAuditStore.getState().setOpen(true))
    },
    // 55-04 (W2 裁决):新资产落点 e2e 断言桥——55-07 消费。
    // getViewCenter 读 FlowCanvas live 视口 getter(非 store 镜像——镜像仅
    // setGraph 载入且逐平移写会触发全量重布,已被证伪);换算与
    // screenToFlowPosition(视口中心) 等价:flow = (screen − v.xy)/zoom。
    getViewCenter: (): { x: number; y: number } | null => {
      const v = getLiveViewport()
      if (v == null || !Number.isFinite(v.zoom) || v.zoom <= 0) return null
      // RF pane 中心(非 window 中心——顶栏 48px 偏移;screenToFlowPosition
      // 同样以 pane 为原点,桥与 placeNewAsset 必须同基准)
      return paneFlowCenter(v)
    },
    // 与 FlowCanvas onNewAsset 同一位置决策顺序与 canonical 写回防线
    // (addNodeFromSocket:zod 同源校验 + id 查重 + warn 早退),不绕过。
    addNodeForTest: (node: Record<string, unknown>): boolean => {
      const rawPos = node.position as { x?: unknown; y?: unknown } | undefined
      const position =
        rawPos != null && typeof rawPos.x === 'number' && typeof rawPos.y === 'number'
        && Number.isFinite(rawPos.x) && Number.isFinite(rawPos.y)
          ? { x: rawPos.x, y: rawPos.y }
          : placeNewAsset({
              sourcePosition: null,
              viewportCenter: getLiveViewportSafeCenter(),
              anchor: 'center',
            })
      return useCanvasStore.getState().addNodeFromSocket(node, position)
    },
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FlowCanvas />
  </React.StrictMode>,
)
