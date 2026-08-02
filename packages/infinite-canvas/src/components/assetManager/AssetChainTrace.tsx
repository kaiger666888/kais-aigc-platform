/**
 * 生成链路 —— 资产详情底部的因果链视图。
 *
 * 纯前端推断（computeGenerationChain），复现 Kai 管线：
 *   ①设定图 → ②灰底Turnaround → ③场景设定 → ⑥场景角度图
 *   → ⑦人物定妆Turnaround → ⑧首帧 → ⑨尾帧
 *
 * 分两组：
 *   参考来源（up，←）：本资产由哪些上游生成
 *   被引用（down，→）：本资产被哪些下游消费
 *
 * 有 uuid 的节点可点击跳转详情；prompt / pipeline_note 为说明节点，不可点击。
 * 无任何链路时返回 null（不渲染区块）。
 */
import { useMemo } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { computeGenerationChain, type AssetItem, type ChainLink } from './assetManagerData'

interface Props {
  /** 当前资产（AssetItem） */
  item: AssetItem
  /** 同项目全部资产（用于跨资产关联推断） */
  all: AssetItem[]
}

export default function AssetChainTrace({ item, all }: Props) {
  const openAssetDetail = useCanvasStore((s) => s.openAssetDetail)

  const { up, down } = useMemo(() => {
    const links = computeGenerationChain(item, all)
    return {
      up: links.filter((l) => l.direction === 'up'),
      down: links.filter((l) => l.direction === 'down'),
    }
  }, [item, all])

  if (up.length === 0 && down.length === 0) return null

  const renderLink = (l: ChainLink) => {
    const clickable = !!l.uuid
    return (
      <button
        type="button"
        key={`${l.direction}-${l.label}-${l.uuid ?? l.detail ?? ''}`}
        className={`am-chain-link ${clickable ? 'is-clickable' : 'is-note'}`}
        onClick={clickable ? () => openAssetDetail(l.uuid!) : undefined}
        disabled={!clickable}
      >
        <span className="am-chain-link__arrow">{l.direction === 'up' ? '←' : '→'}</span>
        <span className="am-chain-link__ic">{l.emoji}</span>
        <span className="am-chain-link__body">
          <span className="am-chain-link__label">{l.label}</span>
          {l.detail ? <span className="am-chain-link__detail">{l.detail}</span> : null}
        </span>
      </button>
    )
  }

  return (
    <>
      <div className="am-seclabel">生成链路</div>
      <div className="am-chain">
        {up.length > 0 && (
          <div className="am-chain__group">
            <div className="am-chain__title">参考来源</div>
            {up.map(renderLink)}
          </div>
        )}
        {down.length > 0 && (
          <div className="am-chain__group">
            <div className="am-chain__title">被引用</div>
            {down.map(renderLink)}
          </div>
        )}
      </div>
    </>
  )
}
