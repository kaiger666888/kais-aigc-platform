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
function getLiveViewportSafeCenter(): { x: number; y: number } {
  const v = getLiveViewport()
  if (v == null || !Number.isFinite(v.zoom) || v.zoom <= 0) return { x: 0, y: 0 }
  return { x: (window.innerWidth / 2 - v.x) / v.zoom, y: (window.innerHeight / 2 - v.y) / v.zoom }
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
    // 55-04 (W2 裁决):新资产落点 e2e 断言桥——55-07 消费。
    // getViewCenter 读 FlowCanvas live 视口 getter(非 store 镜像——镜像仅
    // setGraph 载入且逐平移写会触发全量重布,已被证伪);换算与
    // screenToFlowPosition(视口中心) 等价:flow = (screen − v.xy)/zoom。
    getViewCenter: (): { x: number; y: number } | null => {
      const v = getLiveViewport()
      if (v == null || !Number.isFinite(v.zoom) || v.zoom <= 0) return null
      return {
        x: (window.innerWidth / 2 - v.x) / v.zoom,
        y: (window.innerHeight / 2 - v.y) / v.zoom,
      }
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
