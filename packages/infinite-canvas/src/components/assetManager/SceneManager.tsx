/**
 * 视图D · 场景管理 —— 场景列表 + 变体网格(日/夜/雨色调 veil) + 变体差异对比。
 * 点选最多 2 个变体 → 底部并排差异对比（光照/色温/氛围 diff，对应 scene_variant.diff）。
 * 变体关系 = o_asset_composition variant_of（这里由 assetManagerData.variantOf 表达）。
 */
import { useMemo, useState } from 'react'
import {
  ASSETS, assetByUuid, modalityWeakVar,
  type AssetItem,
} from './assetManagerData'

function cssVars(vars: Record<string, string>): React.CSSProperties {
  return vars as React.CSSProperties
}

/** 由变体名推断光照色罩（日=暖、夜=蓝、雨=冷蓝），零额外渲染成本。 */
function veilOf(v: AssetItem): string {
  const n = v.name
  if (n.includes('日')) return 'rgba(255,220,120,0.10)'
  if (n.includes('夜')) return 'rgba(40,60,140,0.32)'
  if (n.includes('雨')) return 'rgba(80,120,180,0.30)'
  return 'transparent'
}

export default function SceneManager() {
  const [sceneId, setSceneId] = useState<string>('scn-street')
  const [picks, setPicks] = useState<string[]>([])

  const scenes = useMemo(() => ASSETS.filter((a) => a.type === 'scene'), [])
  const scene = assetByUuid(sceneId)!
  const variants = useMemo(() => ASSETS.filter((v) => v.variantOf === sceneId), [sceneId])

  const togglePick = (uuid: string) => {
    setPicks((prev) => {
      const i = prev.indexOf(uuid)
      if (i >= 0) return prev.filter((u) => u !== uuid)
      const next = [...prev, uuid]
      return next.length > 2 ? next.slice(1) : next
    })
  }

  const picked = picks.map((u) => assetByUuid(u)).filter(Boolean) as AssetItem[]
  const diffKeys = picked.length === 2
    ? [...new Set([...Object.keys(picked[0].diff ?? {}), ...Object.keys(picked[1].diff ?? {})])]
    : []

  return (
    <div className="am-scene">
      <aside className="am-scene__list">
        <div className="am-head" style={{ padding: '0 4px 8px' }}>场景</div>
        {scenes.map((s) => {
          const vc = ASSETS.filter((v) => v.variantOf === s.uuid).length
          return (
            <div
              key={s.uuid}
              className={`am-scene-card ${sceneId === s.uuid ? 'is-on' : ''}`}
              onClick={() => { setSceneId(s.uuid); setPicks([]) }}
            >
              <div className="am-scene-card__ic">{s.emoji}</div>
              <div><b>{s.name}</b><span>{s.uuid} · {vc} 变体</span></div>
            </div>
          )
        })}
      </aside>

      <div className="am-scene__main">
        <div className="am-scene__head">
          <h1>{scene.emoji} {scene.name}</h1>
          <span className="am-det__sub" style={{ fontFamily: 'var(--cv-font-mono)' }}>{scene.uuid}</span>
        </div>
        <div className="am-scene__hint">{scene.desc} · 共 {variants.length} 个变体 · 点选 2 个变体进行差异对比</div>

        <div className="am-variants">
          {variants.length === 0 ? (
            <div className="am-empty" style={{ gridColumn: '1/-1' }}>该场景暂无变体</div>
          ) : variants.map((v) => (
            <div
              key={v.uuid}
              className={`am-variant ${picks.includes(v.uuid) ? 'is-pick' : ''}`}
              style={cssVars({ '--vw': `var(${modalityWeakVar(v.modality)})` })}
              onClick={() => togglePick(v.uuid)}
            >
              <span className="am-variant__pickflag">✓</span>
              <div className="am-variant__thumb" style={{ background: `var(${modalityWeakVar(v.modality)})` }}>
                <div className="am-variant__veil" style={{ background: veilOf(v) }} />
                <span style={{ position: 'relative', zIndex: 2 }}>{v.emoji}</span>
                <span className="am-variant__time">{(v.name.split('·')[1] ?? '').trim()}</span>
              </div>
              <div className="am-variant__body">
                <div className="am-variant__name">{v.name}</div>
                <div className="am-variant__meta">{v.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {picked.length === 2 && (
          <>
            <div className="am-cmp-head">差异对比 · {picked[0].name} ⟷ {picked[1].name}</div>
            <div className="am-cmp-grid">
              {picked.map((x) => (
                <div className="am-cmp-pane" key={x.uuid}>
                  <div className="am-cmp-pane__thumb" style={{ background: `var(${modalityWeakVar(x.modality)})` }}>
                    <div className="am-variant__veil" style={{ background: veilOf(x) }} />
                    <span style={{ position: 'relative', zIndex: 2 }}>{x.emoji}</span>
                  </div>
                  <div className="am-cmp-pane__body">
                    <div className="am-cmp-pane__name">{x.name}</div>
                    <div style={{ marginTop: 8 }}>
                      {diffKeys.map((k) => (
                        <div className="am-diff-row" key={k}>
                          <div className="am-diff-row__k">{k}</div>
                          <div className="am-diff-row__v">{(x.diff ?? {})[k] ?? '—'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
