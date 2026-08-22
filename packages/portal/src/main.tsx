import React from 'react'
import ReactDOM from 'react-dom/client'
import PortalHome from './pages/PortalHome'
import DeliveryPage from './pages/DeliveryPage'
import ToonflowEmbed from './pages/ToonflowEmbed'

/**
 * 3 条路由手写 pathname switch（UI-SPEC Registry Safety：零 router 库）。
 * /portal → PortalHome；/deliver/:ep → DeliveryPage（ep = 数字段）；
 * /toonflow → ToonflowEmbed；未匹配兜底 /portal。
 */
function routeFor(pathname: string): React.ReactElement {
  if (pathname === '/toonflow' || pathname.startsWith('/toonflow/')) {
    return <ToonflowEmbed />
  }
  // /deliver、/deliver/123、/deliver/123/（无数字段兜底 ep=1，与画布默认集一致）
  const deliver = pathname.match(/^\/deliver(?:\/(\d+))?\/?$/)
  if (deliver) {
    return <DeliveryPage ep={Number(deliver[1] ?? 1)} />
  }
  return <PortalHome />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{routeFor(location.pathname)}</React.StrictMode>,
)
