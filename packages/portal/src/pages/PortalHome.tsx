import type { CSSProperties } from 'react'

/** 内容列（UI-SPEC §Spacing：1080px 居中，xl 32px 左右留白）。 */
const pageStyle: CSSProperties = {
  maxWidth: 1080,
  margin: '0 auto',
  padding: '24px 32px',
}

const headingStyle: CSSProperties = {
  fontSize: 'var(--cv-fs-t1)',
  fontWeight: 600,
  lineHeight: 1.2,
  color: 'var(--cv-text-primary)',
}

/**
 * 门户首页（/portal）——Phase 57-02 Task 1 壳：页头「项目」+ 数据区占位。
 * 项目分节 / 集行 / 管线带 micro / 深链发码在 Task 3 填充。
 */
export default function PortalHome() {
  return (
    <main style={pageStyle}>
      <h1 style={headingStyle}>项目</h1>
      <p style={{ marginTop: 8, fontSize: 'var(--cv-fs-t2)', color: 'var(--cv-text-tertiary)' }}>
        项目列表加载中…
      </p>
    </main>
  )
}
