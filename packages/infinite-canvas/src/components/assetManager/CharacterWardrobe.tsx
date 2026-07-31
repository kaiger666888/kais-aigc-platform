/**
 * 视图C · 角色衣柜 —— paper-doll 装备面板（签名交互）。
 * 选角色 → 中央角色立于聚光灯 + 浮动装备徽标；4 装备槽可拖拽/点击装备；
 * 物品抽屉拖到角色或槽位均可；同槽自动替换；可命名保存搭配（写回 COMPOSITIONS mock）。
 * 组合关系数据走 assetManagerData（TODO 待后端 GET /characters/:uuid/wardrobe）。
 */
import { useMemo, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import {
  ASSETS, COMPOSITIONS, DEFAULT_LOADOUTS, SLOT_LABEL, TYPE_LABEL,
  assetByUuid,
  type AssetItem, type EquipSlot,
} from './assetManagerData'

interface SlotDef { key: EquipSlot; label: string; ic: string }
const SLOTS: SlotDef[] = [
  { key: 'head', label: '头饰 / 帽子', ic: '🎩' },
  { key: 'body', label: '服装', ic: '👘' },
  { key: 'accessory', label: '配饰', ic: '💍' },
  { key: 'hand', label: '手持道具', ic: '✋' },
]

// 浮动装备徽标的固定位置（相对角色容器）
const BADGE_POS: Record<EquipSlot, React.CSSProperties> = {
  head: { top: '6%', left: '50%', transform: 'translateX(-50%)' },
  body: { bottom: '28%', right: '-6px' },
  accessory: { top: '44%', left: '-6px' },
  hand: { bottom: '6%', right: '4%' },
  feet: { bottom: '2%', left: '50%', transform: 'translateX(-50%)' },
}

export default function CharacterWardrobe() {
  const showToast = useCanvasStore((s) => s.showToast)

  const [charId, setCharId] = useState<string>('chr-xiaoju')
  const [loadout, setLoadout] = useState<string>('默认造型')
  // 每个角色的当前装备：charId → slot → assetUuid（本地状态；保存时写回 COMPOSITIONS）
  const [equippedMap, setEquippedMap] = useState<Record<string, Partial<Record<EquipSlot, string>>>>(() => {
    const init: Record<string, Partial<Record<EquipSlot, string>>> = {}
    for (const c of ['chr-xiaoju', 'chr-xiaoyue']) {
      init[c] = {}
      COMPOSITIONS.filter((r) => r.a === c && r.loadout === '默认造型').forEach((r) => {
        if (r.slot) init[c][r.slot] = r.b
      })
    }
    return init
  })
  const [invFilter, setInvFilter] = useState<'all' | string>('all')
  const [loadoutName, setLoadoutName] = useState('默认造型')

  const char = assetByUuid(charId)!
  const equipped = equippedMap[charId] ?? {}

  const characters = useMemo(() => ASSETS.filter((a) => a.type === 'character'), [])

  const availableItems = useMemo(() => {
    return ASSETS
      .filter((a) => ['costume', 'accessory', 'prop', 'prop_key', 'prop_consumable'].includes(a.type))
      .filter((a) => !a.forChar || a.forChar === charId)
  }, [charId])

  const invItems = invFilter === 'all' ? availableItems : availableItems.filter((i) => i.type === invFilter)
  const equippedUuids = Object.values(equipped)

  const syncFromLoadout = (cId: string, lot: string) => {
    const def = COMPOSITIONS.filter((r) => r.a === cId && r.loadout === lot)
    if (!def.length) return // 无该搭配定义 → 保留当前
    const next: Partial<Record<EquipSlot, string>> = {}
    def.forEach((r) => { if (r.slot) next[r.slot] = r.b })
    setEquippedMap((m) => ({ ...m, [cId]: next }))
  }

  const equip = (uuid: string) => {
    const a = assetByUuid(uuid)
    if (!a) return
    const slot: EquipSlot = a.slot ?? (a.type === 'accessory' ? 'accessory' : a.type.includes('prop') ? 'hand' : 'body')
    setEquippedMap((m) => ({ ...m, [charId]: { ...(m[charId] ?? {}), [slot]: uuid } }))
    showToast(`已装备 ${a.name} → ${SLOT_LABEL[slot]}`, 'success')
  }

  const unequip = (slot: EquipSlot) => {
    setEquippedMap((m) => {
      const next = { ...(m[charId] ?? {}) }
      delete next[slot]
      return { ...m, [charId]: next }
    })
  }

  const handleSlotDrop = (slot: EquipSlot, uuid: string) => {
    const a = assetByUuid(uuid)
    if (!a) return
    setEquippedMap((m) => ({ ...m, [charId]: { ...(m[charId] ?? {}), [slot]: uuid } }))
    showToast(`已装备 ${a.name} → ${SLOTS.find((s) => s.key === slot)?.label}`, 'success')
  }

  const [dragging, setDragging] = useState<string | null>(null)

  const saveLoadout = () => {
    const name = loadoutName.trim() || '未命名搭配'
    setLoadout(name)
    showToast(`已保存搭配 ${name}（${Object.keys(equipped).length} 件）`, 'success')
    // TODO(backend): POST /api/v1/loadouts { characterUuid, name, items[] } → 写 o_loadout + o_asset_composition
  }

  return (
    <div className="am-ward">
      {/* 角色选择 */}
      <aside className="am-charpick">
        <div className="am-head" style={{ padding: '0 4px 4px' }}>选择角色</div>
        {characters.map((c) => (
          <div
            key={c.uuid}
            className={`am-charpick__card ${charId === c.uuid ? 'is-on' : ''}`}
            data-uuid={c.uuid}
            onClick={() => { setCharId(c.uuid); setLoadout('默认造型'); setLoadoutName('默认造型'); syncFromLoadout(c.uuid, '默认造型') }}
          >
            <div className="am-charpick__ava">{c.emoji}</div>
            <div><b>{c.name}</b><span>{c.uuid}</span></div>
          </div>
        ))}
      </aside>

      {/* paper-doll */}
      <div className="am-doll">
        <div className="am-doll__stage">
          <div
            className="am-doll__fig"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const u = e.dataTransfer.getData('text/plain'); if (u) equip(u) }}
          >
            <div className="am-doll__spot" />
            <div className="am-doll__charwrap">
              <div className="am-gearbadges">
                {SLOTS.map((sl) => {
                  const uid = equipped[sl.key]
                  if (!uid) return null
                  const it = assetByUuid(uid)!
                  return (
                    <div className="am-gearbadge" key={sl.key} style={BADGE_POS[sl.key]}>
                      <span className="e">{it.emoji}</span>{it.name}
                    </div>
                  )
                })}
              </div>
              <div className={`am-doll__char ${Object.keys(equipped).length > 0 ? 'is-geared' : ''}`}>{char.emoji}</div>
              <div className="am-doll__nameplate">
                <b>{char.name}</b>
                <span>{char.uuid} · {char.desc}</span>
              </div>
            </div>
          </div>

          {/* 装备槽 */}
          <div className="am-slots">
            <div className="am-head">装备槽 · 拖拽物品到角色或槽位</div>
            {SLOTS.map((sl) => {
              const uid = equipped[sl.key]
              const it = uid ? assetByUuid(uid) : undefined
              return (
                <div
                  key={sl.key}
                  className={`am-slot ${it ? 'is-equipped' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('is-over') }}
                  onDragLeave={(e) => e.currentTarget.classList.remove('is-over')}
                  onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('is-over'); const u = e.dataTransfer.getData('text/plain'); if (u) handleSlotDrop(sl.key, u) }}
                >
                  <div className="am-slot__ic">{it ? it.emoji : sl.ic}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="am-slot__label">{sl.label}</div>
                    {it ? <div className="am-slot__item">{it.name}</div> : <div className="am-slot__empty">空 · 拖入{sl.label}</div>}
                  </div>
                  {it ? (
                    <button className="am-slot__rm" onClick={() => unequip(sl.key)}>卸下</button>
                  ) : (
                    <span className="am-slot__add">＋</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 搭配保存 */}
        <div className="am-doll__footer">
          <input className="am-loadout-name" value={loadoutName} onChange={(e) => setLoadoutName(e.target.value)} placeholder="搭配名称…" />
          <button className="am-btn am-btn--primary" onClick={saveLoadout}>保存搭配</button>
          <div className="am-loadout-list">
            {DEFAULT_LOADOUTS.map((l) => (
              <button
                key={l}
                className={`am-loadout-chip ${loadout === l ? 'is-on' : ''}`}
                onClick={() => { setLoadout(l); setLoadoutName(l); syncFromLoadout(charId, l) }}
              >{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* 物品抽屉 */}
      <aside className="am-inv">
        <div className="am-inv__h"><span className="am-head">可用物品 · 拖到装备槽或角色</span></div>
        <div className="am-inv__filter">
          <button className={invFilter === 'all' ? 'is-on' : ''} onClick={() => setInvFilter('all')}>全部</button>
          {[...new Set(availableItems.map((i) => i.type))].map((t) => (
            <button key={t} className={invFilter === t ? 'is-on' : ''} onClick={() => setInvFilter(t)}>{TYPE_LABEL[t as AssetItem['type']]}</button>
          ))}
        </div>
        <div className="am-inv__grid">
          {invItems.length === 0 ? (
            <div className="am-empty" style={{ gridColumn: '1/-1', padding: '24px 8px' }}>该角色暂无可装备物品</div>
          ) : invItems.map((it) => {
            const isEq = equippedUuids.includes(it.uuid)
            return (
              <div
                key={it.uuid}
                className={`am-inv-item ${isEq ? 'is-equipped' : ''} ${dragging === it.uuid ? 'is-dragging' : ''}`}
                data-uuid={it.uuid}
                draggable={!isEq}
                onDragStart={(e) => { setDragging(it.uuid); e.dataTransfer.setData('text/plain', it.uuid); e.dataTransfer.effectAllowed = 'copy' }}
                onDragEnd={() => setDragging(null)}
                onClick={() => { if (!isEq) equip(it.uuid) }}
                title={isEq ? '已装备' : `${it.name}（点击或拖拽装备）`}
              >
                <div className="e">{it.emoji}</div>
                <div className="n">{it.name}</div>
                <div className="t">{TYPE_LABEL[it.type]}{it.slot ? `/${it.slot}` : ''}</div>
              </div>
            )
          })}
        </div>
      </aside>
    </div>
  )
}
