/**
 * 视图B · 资产详情 —— 大图多视图轮播 + 元数据 + 组合关系图(SVG 径向) + 跨集出场。
 * 关系图节点可点击跳转详情。返回 → setAssetView('library')。
 */
import { useMemo, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import { useRealAssets } from './useRealAssets'
import AssetChainTrace from './AssetChainTrace'
import {
  ASSETS, COMPOSITIONS, APPEARS, EPISODES, TYPE_LABEL,
  assetByUuid, assetDetailToItem, modalityVar,
  type AssetItem,
} from './assetManagerData'

interface RelNode { node: AssetItem; label: string; slot?: string }

function cssVars(vars: Record<string, string>): React.CSSProperties {
  return vars as React.CSSProperties
}

const REL_LABEL: Record<string, string> = {
  wears: '穿着', holds: '手持', variant_of: '变体自', appears_in: '出现于', has_variant: '变体', appears: '有出场',
}

export default function AssetDetail() {
  const uuid = useCanvasStore((s) => s.selectedAssetUuid)
  const closeAssetDetail = useCanvasStore((s) => s.closeAssetDetail)
  const openAssetDetail = useCanvasStore((s) => s.openAssetDetail)
  const projectId = useCanvasStore((s) => s.projectId)
  const [view, setView] = useState('front')
  const { assets: realAssets } = useRealAssets(projectId)

  // 取数：真实资产优先（资产库进入），否则回退 mock（角色衣柜/场景管理进入）。
  const a = useMemo<AssetItem | undefined>(() => {
    if (!uuid) return undefined
    const real = realAssets.find((d) => (d.uuid || `id-${d.id}`) === uuid)
    if (real) return assetDetailToItem(real)
    return assetByUuid(uuid)
  }, [uuid, realAssets])

  // 生成链路需要同项目全部资产做跨资产关联推断。
  const allItems = useMemo<AssetItem[]>(() => realAssets.map(assetDetailToItem), [realAssets])

  const rels = useMemo<RelNode[]>(() => {
    if (!a) return []
    const out: RelNode[] = []
    // 谁穿戴/手持了它
    COMPOSITIONS.filter((r) => r.b === a.uuid && (r.rel === 'wears' || r.rel === 'holds')).forEach((r) => {
      const c = assetByUuid(r.a)
      if (c) out.push({ node: c, label: r.rel === 'wears' ? '穿戴于' : '手持于' })
    })
    // 它穿戴/手持什么（本资产是角色）
    if (a.type === 'character') {
      COMPOSITIONS.filter((r) => r.a === a.uuid).forEach((r) => {
        const it = assetByUuid(r.b)
        if (it) out.push({ node: it, label: REL_LABEL[r.rel] ?? r.rel, slot: r.slot })
      })
    }
    // 变体关系
    if (a.variantOf) {
      const p = assetByUuid(a.variantOf)
      if (p) out.push({ node: p, label: '变体自' })
    }
    ASSETS.filter((x) => x.variantOf === a.uuid).forEach((x) => out.push({ node: x, label: '变体' }))
    // 出现于场景
    COMPOSITIONS.filter((r) => r.a === a.uuid && r.rel === 'appears_in').forEach((r) => {
      const s = assetByUuid(r.b)
      if (s) out.push({ node: s, label: '出现于' })
    })
    if (a.type === 'scene') {
      COMPOSITIONS.filter((r) => r.b === a.uuid && r.rel === 'appears_in').forEach((r) => {
        const x = assetByUuid(r.a)
        if (x) out.push({ node: x, label: '有出场' })
      })
    }
    return out
  }, [a])

  if (!a) {
    return (
      <div className="am-empty" style={{ padding: 60 }}>
        请从资产库选择一个资产查看详情。
        <div style={{ marginTop: 14 }}>
          <button className="am-btn am-btn--ghost" onClick={closeAssetDetail}>返回资产库</button>
        </div>
      </div>
    )
  }

  const appears = APPEARS[a.uuid]
  const views = a.views ?? (a.type === 'scene' || a.type === 'scene_variant' ? ['overview', 'wide', 'close'] : ['front'])

  const rows: Array<[string, string]> = []
  if (a.prompt) {
    rows.push(['生成 Prompt', a.prompt])
  } else if (a.modality === 'image' || a.modality === 'video') {
    // 视觉生成资产（图/视频）理应携带生成 prompt —— 缺失则提示（Kai 准入原则）
    rows.push(['⚠️ Prompt', '缺失 — 该资产未携带生成 prompt'])
  }
  if (a.desc) rows.push(['描述', a.desc])
  if (a.model) rows.push(['模型', a.model])
  if (a.seed) rows.push(['种子', a.seed])
  if (a.voice) rows.push(['声纹', a.voice])
  if (a.slot) rows.push(['装备槽', a.slot])
  if (a.characterId) rows.push(['角色ID', a.characterId])
  if (a.viewAngle) rows.push(['视角', a.viewAngle])
  if (a.filePath) rows.push(['文件', a.filePath])
  if (a.diff) rows.push(['差异', Object.entries(a.diff).map(([k, v]) => `${k}:${v}`).join(' · ')])

  // 关系图径向坐标（固定 viewBox，免测量）
  const cx = 200, cy = 110, r = 76
  const nodes = rels.slice(0, 8)

  const imgUrl = a.filePath ? resolveMediaUrl(a.filePath) : null
  // 2026-08-19: 视频资产此前和图共用 <img>（必然 onError → emoji 占位，永远"看不了"）。
  // 双通道判视频：modality 或扩展名（后者兜住误标类型的资产，如成片被标 voice）。
  const isVideoMedia =
    a.modality === 'video' || /\.(mp4|webm|mov|m4v)$/i.test(a.filePath ?? '')

  return (
    <div className="am-det">
      <div className="am-det__left">
        <button className="am-det__back" onClick={closeAssetDetail}>‹ 返回资产库</button>
        <div className="am-det__stage">
          {imgUrl ? (
            isVideoMedia ? (
              <video
                className="am-det__big-img"
                src={imgUrl}
                controls
                preload="metadata"
                playsInline
              />
            ) : (
              <img className="am-det__big-img" src={imgUrl} alt={a.name} />
            )
          ) : (
            <div className="am-det__big" style={cssVars({ filter: `drop-shadow(0 18px 40px rgba(0,0,0,.5))` })}>{a.emoji}</div>
          )}
        </div>
        <div className="am-det__views">
          {views.map((v) => (
            <button key={v} className={`am-vtab ${view === v ? 'is-on' : ''}`} onClick={() => setView(v)}>{v}</button>
          ))}
        </div>
      </div>

      <div className="am-det__right">
        <div className="am-det__title">{a.name}</div>
        <div className="am-det__sub">{a.uuid} · {TYPE_LABEL[a.type]} · ${({ library: '全局库作用域', series: '系列作用域', project: '项目作用域' })[a.scope]}</div>
        <div className="am-det__pills">
          {(a.tags ?? []).map((t) => <span key={t} className="am-chip is-on">{t}</span>)}
          {a.reuses ? <span className="am-badge am-badge--reuse">复用 {a.reuses} 集</span> : null}
          {a.type === 'prop_key' ? <span className="am-badge am-badge--key">🔒 关键道具 · 贯穿剧情</span> : null}
        </div>

        {rows.length > 0 && (
          <>
            <div className="am-seclabel">元数据</div>
            {rows.map(([k, v]) => (
              <div className="am-meta-row" key={k}>
                <div className="am-meta-row__k">{k}</div>
                <div className={`am-meta-row__v ${/^(模型|种子|声纹|装备槽|差异)$/.test(k) ? '' : ''}`} style={{ fontFamily: /^(模型|种子|声纹|装备槽|差异)$/.test(k) ? 'var(--cv-font-mono)' : undefined, fontSize: /^(模型|种子|声纹|装备槽|差异)$/.test(k) ? 11.5 : 12 }}>{v}</div>
              </div>
            ))}
          </>
        )}

        <div className="am-seclabel">组合关系</div>
        <div className="am-cgraph">
          <svg viewBox="0 0 400 220">
            {nodes.length === 0 ? (
              <text x="200" y="115" textAnchor="middle" fill="var(--cv-text-disabled)" fontSize="11">无关系节点</text>
            ) : (
              <>
                {nodes.map((rel, i) => {
                  const ang = (-90 + (360 / nodes.length) * i) * Math.PI / 180
                  const x = cx + r * Math.cos(ang)
                  const y = cy + r * Math.sin(ang)
                  return (
                    <g key={i}>
                      <line className="am-cg-edge" x1={cx} y1={cy} x2={x} y2={y} />
                      <text className="am-cg-edge-label" x={(cx + x) / 2} y={(cy + y) / 2 - 3} textAnchor="middle">{rel.label}</text>
                      <g className="am-cg-node" onClick={() => openAssetDetail(rel.node.uuid)} transform={`translate(${x},${y})`}>
                        <circle r="19" />
                        <text>{rel.node.emoji}</text>
                        <text className="am-cg-name" y="32">{rel.node.name}</text>
                      </g>
                    </g>
                  )
                })}
                <g className="am-cg-node am-cg-center" transform={`translate(${cx},${cy})`}>
                  <circle r="23" />
                  <text y="1">{a.emoji}</text>
                </g>
              </>
            )}
          </svg>
        </div>
        {rels.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--cv-text-tertiary)', marginTop: 9, lineHeight: 1.7, fontFamily: 'var(--cv-font-mono)' }}>
            {rels.map((rel, i) => (
              <div key={i}>{rel.label} → {rel.node.emoji} {rel.node.name}{rel.slot ? ` (${rel.slot})` : ''}</div>
            ))}
          </div>
        )}

        {/* 生成链路（管线因果链：参考来源 + 被引用） */}
        {a && <AssetChainTrace item={a} all={allItems} />}

        {appears && (
          <>
            <div className="am-seclabel">跨剧集出场</div>
            {EPISODES.map((e) => {
              const on = appears.includes(e.code)
              return (
                <div className="am-app-item" key={e.code} style={{ opacity: on ? 1 : 0.45 }}>
                  <div className="am-app-item__ic">{on ? '🎬' : '○'}</div>
                  <div className="am-app-item__t">
                    <b>{e.code} · {e.t}</b>
                    <span>{on ? '出场 · 已引用' : '未出场'}</span>
                  </div>
                  <span className={`am-badge ${on ? 'am-badge--reuse' : ''}`}>{on ? '已锁定' : '—'}</span>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
