/**
 * SceneGallery.tsx — 场景多视角画廊(Phase 56-04 / VIZ-02,D-07)。
 *
 * 主图 contain 大图 + 当前视角 chip + 底部 64px 缩略行(88×64 卡,选中
 * select 描边,120ms 淡切)。视角集数据驱动(p07 views dict 有啥列啥,
 * viewLabel 中文回退)——不硬编码四视角。单视图时缩略行不渲染。
 */
import { useState } from 'react'
import { theme, v3theme } from '../../theme/catppuccin'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import { viewLabel } from '../../utils/scoreVocabulary'

export interface SceneView {
  key: string;
  url: string;
}

export default function SceneGallery({ views, name }: { views: SceneView[]; name: string }): React.ReactElement {
  const [active, setActive] = useState(0)
  const [fading, setFading] = useState(false)
  if (views.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.text.secondary, fontSize: 12 }}>
        未找到同族资产
      </div>
    )
  }
  const current = views[Math.min(active, views.length - 1)]!
  const switchTo = (i: number) => {
    if (i === active) return
    setFading(true)
    window.setTimeout(() => { setActive(i); setFading(false) }, 120)
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 16, gap: 10 }}>
      {/* 主图区 */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: fading ? 0.35 : 1, transition: 'opacity 120ms var(--cv-d-select, 120ms) var(--cv-e-out, ease-out)' }}>
        <img src={resolveMediaUrl(current.url) ?? undefined} alt={`${name} ${current.key}`} draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        <span style={{ position: 'absolute', right: 10, top: 8, fontSize: 10, padding: '2px 8px', borderRadius: 4, background: v3theme.modalityWeak.image, color: theme.text.secondary }}>
          {viewLabel(current.key)}
        </span>
      </div>
      {/* 缩略行(单视图不渲染) */}
      {views.length > 1 && (
        <div style={{ display: 'flex', gap: 8, height: 64, overflowX: 'auto', flexShrink: 0 }}>
          {views.map((v, i) => (
            <button
              key={v.key}
              onClick={() => switchTo(i)}
              title={viewLabel(v.key)}
              style={{
                position: 'relative', width: 88, height: 64, flexShrink: 0, padding: 0, cursor: 'pointer',
                background: theme.bg.card, borderRadius: 6, overflow: 'hidden',
                border: `1.5px solid ${i === active ? v3theme.signal.select : theme.border.default}`,
              }}
            >
              <img src={resolveMediaUrl(v.url) ?? undefined} alt={v.key} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <span style={{ position: 'absolute', left: 4, bottom: 2, fontSize: 9, color: theme.text.secondary, background: 'rgba(10,11,14,0.55)', padding: '0 4px', borderRadius: 3 }}>
                {viewLabel(v.key)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
