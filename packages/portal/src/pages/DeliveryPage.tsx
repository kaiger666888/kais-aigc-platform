import type { CSSProperties } from 'react'

const pageStyle: CSSProperties = {
  maxWidth: 1080,
  margin: '0 auto',
  padding: '24px 32px',
}

const epStyle: CSSProperties = {
  fontFamily: 'var(--cv-font-mono)',
  fontSize: 'var(--cv-fs-t3)',
  color: 'var(--cv-text-secondary)',
}

const headingStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 'var(--cv-fs-t1)',
  fontWeight: 600,
  lineHeight: 1.2,
  color: 'var(--cv-text-primary)',
}

const bodyStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 'var(--cv-fs-t2)',
  lineHeight: 1.6,
  color: 'var(--cv-text-secondary)',
}

/** ghost 行内动作（28px 档；冷白 accent 不进填充——UI-SPEC §Color reserved） */
const actionStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 28,
  marginTop: 16,
  padding: '0 12px',
  borderRadius: 6,
  border: '1px solid var(--cv-line-panel)',
  color: 'var(--cv-text-secondary)',
  textDecoration: 'none',
  fontSize: 'var(--cv-fs-t2)',
  transition: 'color var(--cv-d-select) var(--cv-e-out), border-color var(--cv-d-select) var(--cv-e-out)',
}

/**
 * 交付页壳（/deliver/:ep）——Phase 57-02 Task 1：navbar（文档壳）+ 无成片空态。
 * 数据面（master.mp4 hero / 交付清单 / 管线带 full / G8 终审）在 57-05/06 落地。
 * copy 逐字用 UI-SPEC Copywriting Contract（无成片空态两行 + 去画布看 P13）。
 */
export default function DeliveryPage({ ep }: { ep: number }) {
  return (
    <main style={pageStyle}>
      <p style={epStyle}>EP {ep}</p>
      <h1 style={headingStyle}>本集尚未产出成片</h1>
      <p style={bodyStyle}>P13 交付阶段完成后，这里会播放 master.mp4 并给出交付清单。</p>
      <a href={`/canvas?ep=${ep}&zone=p13`} style={actionStyle}>
        去画布看 P13
      </a>
    </main>
  )
}
