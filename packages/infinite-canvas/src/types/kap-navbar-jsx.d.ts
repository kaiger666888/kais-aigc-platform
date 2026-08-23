import type * as React from 'react'

/**
 * kap-navbar-jsx.d.ts — <kap-navbar> custom element 的 JSX 类型面(57-03)。
 *
 * 元素本体单源在 packages/portal/src/nav/kap-nav.ts(vanilla custom element,
 * React 19 属性直传);57-02 的 portal 宿主走 index.html 静态壳绕开了 TSX,画布
 * topbar 宿主直接在 TSX 里渲染,须augment IntrinsicElements(jsx-runtime 的
 * IntrinsicElements extends React.JSX.IntrinsicElements,增强基接口即生效)。
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'kap-navbar': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        /** 当前项 id(portal/canvas/story-map/director-desk;缺省按 pathname 自判) */
        'data-active'?: string
        /** compact 档标记(画布 topbar 内嵌,26px;presence-driven,任意非空值) */
        compact?: string
      }
    }
  }
}
