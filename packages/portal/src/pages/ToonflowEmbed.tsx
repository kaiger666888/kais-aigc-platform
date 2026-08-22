import { useState, type CSSProperties } from 'react'

/** 嵌入页容器：navbar 壳 40px 之下占满余高（iframe flex-1 填充）。 */
const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: 'calc(100vh - 40px)',
}

const noteStyle: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 28,
  padding: '0 16px',
  fontSize: 'var(--cv-fs-t3)',
  color: 'var(--cv-text-tertiary)',
  background: 'var(--cv-bg-panel)',
  borderBottom: '1px solid var(--cv-line-panel)',
}

const fallbackStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  fontSize: 'var(--cv-fs-t2)',
  color: 'var(--cv-text-secondary)',
}

const linkStyle: CSSProperties = {
  color: 'var(--cv-text-primary)',
}

/**
 * Toonflow 嵌入页（/toonflow）——D-01 共存形态：旧版经 iframe 进门户壳，
 * 根路径 `/`（26MB bundle 原位）行为零改动。加载失败降级注释行 + [直开旧版]。
 * 共存期刻意不做 postMessage 通信协议（UI-SPEC P-4）。
 */
export default function ToonflowEmbed() {
  const [failed, setFailed] = useState(false)

  return (
    <div style={wrapStyle}>
      <div style={noteStyle}>旧版工作台（共存期）——新工作请从门户与画布进入</div>
      {failed ? (
        <div style={fallbackStyle}>
          <span>Toonflow 加载失败。</span>
          <a href="/" style={linkStyle}>
            直开旧版
          </a>
        </div>
      ) : (
        <iframe
          src="/"
          title="Toonflow 旧版工作台"
          onError={() => setFailed(true)}
          style={{ flex: 1, minHeight: 0, width: '100%', border: 0, display: 'block' }}
        />
      )}
    </div>
  )
}
