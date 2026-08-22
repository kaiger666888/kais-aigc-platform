/**
 * PortalHome.tsx — 门户首页（/portal，Phase 57-02 Task 3）。
 *
 * PORTAL-01 成功标准 1 后半：项目入口 + 集行 + 管线带 micro + 深链发码。
 * 数据 = fetchProjects（@ic/services/canvasApi 复用，零重写）；状态机 =
 * 加载骨架（3 行 quiet 脉冲）/ 数据 / 空态 / 失败（重试）—— copy 逐字用
 * UI-SPEC Copywriting Contract。冷白 accent 只出现在 navbar 当前项与键盘焦点环
 * （本页无填充主按钮，行内动作全 ghost —— §Color reserved / U-09）。
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { fetchProjects, episodesOf, type ProjectInfo } from '../services/portalApi'
import PipelineRibbon from '../components/PipelineRibbon'

const SKELETON_CSS = `
@keyframes cv-portal-pulse { 0%, 100% { opacity: 0.35 } 50% { opacity: 0.7 } }
.cv-portal-skel { animation: cv-portal-pulse calc(var(--cv-d-running-spin) * 2) var(--cv-e-inout) infinite; }
@media (prefers-reduced-motion: reduce) { .cv-portal-skel { animation: none; opacity: 0.5; } }
`

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

const sectionTitleStyle: CSSProperties = {
  ...headingStyle,
  marginTop: 32,
}

const metaStyle: CSSProperties = {
  marginTop: 4,
  fontSize: 'var(--cv-fs-t3)',
  color: 'var(--cv-text-tertiary)',
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 28,
  padding: '4px 0',
  borderTop: '1px solid var(--cv-line-panel)',
}

const epStyle: CSSProperties = {
  flex: 'none',
  width: 52,
  fontFamily: 'var(--cv-font-mono)',
  fontSize: 'var(--cv-fs-t3)',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--cv-text-primary)',
}

const countStyle: CSSProperties = {
  flex: 'none',
  width: 64,
  fontFamily: 'var(--cv-font-mono)',
  fontSize: 'var(--cv-fs-t4)',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--cv-text-tertiary)',
}

const ghostStyle: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  height: 28,
  padding: '0 10px',
  borderRadius: 6,
  border: '1px solid var(--cv-line-panel)',
  color: 'var(--cv-text-secondary)',
  textDecoration: 'none',
  fontSize: 'var(--cv-fs-t2)',
  transition: 'color var(--cv-d-select) var(--cv-e-out), border-color var(--cv-d-select) var(--cv-e-out)',
}

const emptyTitleStyle: CSSProperties = { ...headingStyle, marginTop: 32 }
const emptyBodyStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 'var(--cv-fs-t2)',
  lineHeight: 1.6,
  color: 'var(--cv-text-secondary)',
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'data'; projects: ProjectInfo[] }
  | { kind: 'error'; message: string }

export default function PortalHome() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = () => {
    setState({ kind: 'loading' })
    fetchProjects()
      .then((projects) => setState({ kind: 'data', projects }))
      .catch((err: { message?: string }) =>
        setState({ kind: 'error', message: err?.message ?? '加载失败' }),
      )
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <main style={pageStyle}>
      <style>{SKELETON_CSS}</style>
      <h1 style={headingStyle}>项目</h1>

      {state.kind === 'loading' && (
        <div aria-busy="true" style={{ marginTop: 16 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="cv-portal-skel"
              style={{ height: 28, marginTop: 8, borderRadius: 6, background: 'var(--cv-bg-card)' }}
            />
          ))}
        </div>
      )}

      {state.kind === 'error' && (
        <div style={{ marginTop: 32 }}>
          <p style={emptyTitleStyle}>项目列表加载失败 —— 稍后重试，或直接进入画布。</p>
          <p style={emptyBodyStyle}>
            <a href="/canvas" style={{ color: 'var(--cv-text-primary)' }}>
              进画布
            </a>
            <button
              onClick={load}
              style={{
                ...ghostStyle,
                marginLeft: 12,
                background: 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              重试
            </button>
          </p>
        </div>
      )}

      {state.kind === 'data' && state.projects.length === 0 && (
        <div style={{ marginTop: 32 }}>
          <p style={emptyTitleStyle}>暂无项目</p>
          <p style={emptyBodyStyle}>项目在画布或 Toonflow 里创建后，会出现在这里</p>
        </div>
      )}

      {state.kind === 'data' && state.projects.length > 0 && (
        <>
          <p style={metaStyle}>
            <span style={{ fontFamily: 'var(--cv-font-mono)' }}>{state.projects.length}</span> 个项目
          </p>
          {state.projects.map((p) => {
            const rows = episodesOf([p])
            const assetTotal = p.assetCount + p.storyboardCount + p.videoCount
            return (
              <section key={p.id} aria-label={p.name}>
                <h2 style={sectionTitleStyle}>{p.name}</h2>
                <p style={metaStyle}>
                  <span style={{ fontFamily: 'var(--cv-font-mono)' }}>{rows.length}</span> 集 ·{' '}
                  <span style={{ fontFamily: 'var(--cv-font-mono)' }}>{assetTotal}</span> 资产
                </p>
                <div style={{ marginTop: 12, borderTop: 'none' }}>
                  {rows.map((r) => (
                    <div key={`${p.id}-${r.ep}`} style={rowStyle}>
                      <span style={epStyle}>EP {r.ep}</span>
                      <span style={countStyle}>{r.nodeCount} 节点</span>
                      <PipelineRibbon projectId={p.id} ep={r.ep} counts={r.phases} />
                      <a href={`/canvas?project=${p.id}&ep=${r.ep}`} style={ghostStyle}>
                        画布
                      </a>
                      <a href={`/deliver/${r.ep}`} style={ghostStyle}>
                        交付
                      </a>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </>
      )}
    </main>
  )
}
