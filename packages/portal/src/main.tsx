import React from 'react'
import ReactDOM from 'react-dom/client'
// KapNavbar custom element 注册（单源三宿主——本包 React 宿主经 bundler 副作用
// 注册，静态站宿主吃 /assets/kap-nav.js 产物，同一份源；define 有幂等守卫）。
import './nav/kap-nav'
import PortalHome from './pages/PortalHome'
import DeliveryPage from './pages/DeliveryPage'

/**
 * 2 条路由手写 pathname switch（UI-SPEC Registry Safety：零 router 库）。
 * /portal → PortalHome；/deliver/:ep → DeliveryPage（ep = 数字段）；
 * 未匹配兜底 /portal。（/toonflow 嵌入页 2026-08-23 下线，旧链路由服务端 302 回门户。）
 */
function routeFor(pathname: string): React.ReactElement {
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
