import React from 'react'
import ReactDOM from 'react-dom/client'
import { io } from 'socket.io-client'
import FlowCanvas from './components/FlowCanvas'
import { useCanvasStore } from './store/canvasStore'
import './theme/tokens.css' // Step 5 设计 tokens（--cv-* 全局变量）

// Test mode hook — 当 URL 含 ?testMode=1 时,挂载 store 控制接口到 window。
// 用于 Playwright 测试在不依赖 React Flow 复杂 selection 模型的前提下驱动状态。
// 仅在显式 testMode 下激活,production bundle 默认 noop。
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('testMode')) {
  ;(window as any).__kaisCanvas = {
    setSelectedNodeIds: (ids: string[]) => useCanvasStore.getState().setSelectedNodeIds(ids),
    getSelectedNodeIds: () => useCanvasStore.getState().selectedNodeIds,
    getOrchestration: () => useCanvasStore.getState().orchestration,
    getNodes: () => useCanvasStore.getState().nodes,
    showToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') =>
      useCanvasStore.getState().showToast(msg, type),
    // 暴露本地 socket.io-client —— e2e 用它监听 WebSocket 事件，替代不可靠的
    // 浏览器侧 CDN dynamic import（沙箱环境浏览器常无法访问 cdn.socket.io）。
    io,
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FlowCanvas />
  </React.StrictMode>,
)
