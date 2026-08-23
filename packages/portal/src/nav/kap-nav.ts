/**
 * kap-nav.ts — KapNavbar 共享导航（Phase 57-02 / D-06·U-02：vanilla custom
 * element，单源三宿主）。
 *
 * 宿主形态：
 *  ① portal React 宿主：main.tsx `import './nav/kap-nav'`（bundler 副作用注册）；
 *  ② 画布 topbar 内嵌（57-03）：同源 import + compact 属性；
 *  ③ 静态站注入（57-04）：esbuild IIFE 产物 /assets/kap-nav.js（build-kap-nav.mjs）。
 *
 * 纪律：
 *  - light DOM 不用 shadow —— `--cv-*` token 自然级联（样式全在 kap-nav.css，
 *    构建期与 tokens.css concat，token 零复制）；
 *  - 自包含零 import —— 可被任意 bundler/宿主直接引用；
 *  - define 幂等守卫 —— React bundle 与静态产物同页加载不会双注册抛错。
 *  - 项为 <a href>（键盘可达；focus-visible 走 kap-nav.css 的 token 焦点环）。
 */

interface NavItem {
  id: string
  label: string
  href: string
}

/** 项常量单处（UI-SPEC P-1 词表：门户/画布/剧核/3D导演台——Toonflow 项 2026-08-23 下线）。 */
const NAV_ITEMS: readonly NavItem[] = [
  { id: 'portal', label: '门户', href: '/portal' },
  { id: 'canvas', label: '画布', href: '/canvas' },
  { id: 'story-map', label: '剧核', href: '/story-map/' },
  { id: 'director-desk', label: '3D导演台', href: '/director-desk/' },
]

/** pathname 前缀 → 当前项（data-active 属性缺省时的自判）。 */
const ACTIVE_PATH_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['/portal', 'portal'],
  ['/deliver', 'portal'],
  ['/infinite-canvas', 'canvas'],
  ['/canvas', 'canvas'],
  ['/story-map', 'story-map'],
  ['/director-desk', 'director-desk'],
]

function activeFromPathname(pathname: string): string {
  for (const pair of ACTIVE_PATH_PREFIXES) {
    const prefix = pair[0]
    const id = pair[1]
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return id
  }
  return 'portal'
}

class KapNavbar extends HTMLElement {
  static observedAttributes = ['data-active', 'compact']

  connectedCallback(): void {
    this.render()
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.render()
  }

  private render(): void {
    // data-active 显式指定优先；缺省按 location.pathname 前缀自判（注入档由宿主指定）
    const explicit = this.getAttribute('data-active')
    const active = explicit ?? activeFromPathname(location.pathname)

    const brand = document.createElement('a')
    brand.className = 'kap-nav-brand'
    brand.href = '/portal'
    brand.textContent = 'KAP'

    const list = document.createElement('nav')
    list.className = 'kap-nav-items'
    list.setAttribute('aria-label', '全局导航')
    for (const item of NAV_ITEMS) {
      const a = document.createElement('a')
      a.className = 'kap-nav-item'
      a.href = item.href
      a.textContent = item.label
      a.dataset.id = item.id
      if (item.id === active) a.setAttribute('aria-current', 'page')
      list.appendChild(a)
    }

    this.replaceChildren(brand, list)
  }
}

if (typeof window !== 'undefined' && !customElements.get('kap-navbar')) {
  customElements.define('kap-navbar', KapNavbar)
}
