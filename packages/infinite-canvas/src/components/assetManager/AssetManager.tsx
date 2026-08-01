/**
 * 资产管理中心 —— 画布的第三种视图模式 (viewMode='assets')。
 *
 * 子视图 Tab：资产库 Library · 角色衣柜 Wardrobe · 场景管理 Scenes
 * 资产详情改为右侧 drawer（selectedAssetUuid != null 时弹出），
 * 不再独占整个视图。双击资产库卡片弹出，点击资产库空白区域关闭。
 */
import { useCanvasStore } from '../../store/canvasStore'
import { UiIcon } from '../canvas/icons'
import AssetLibrary from './AssetLibrary'
import AssetDetail from './AssetDetail'
import CharacterWardrobe from './CharacterWardrobe'
import SceneManager from './SceneManager'
import './assetManager.css'

type AssetView = 'library' | 'wardrobe' | 'scenes'

const TABS: Array<{ key: AssetView; label: string }> = [
  { key: 'library', label: '资产库' },
  { key: 'wardrobe', label: '角色衣柜' },
  { key: 'scenes', label: '场景管理' },
]

export default function AssetManager() {
  const assetView = useCanvasStore((s) => s.assetView)
  const setAssetView = useCanvasStore((s) => s.setAssetView)
  const selectedAssetUuid = useCanvasStore((s) => s.selectedAssetUuid)
  const closeAssetDetail = useCanvasStore((s) => s.closeAssetDetail)

  return (
    <div className="am-root">
      {/* 子视图顶栏：标题 + Tab */}
      <div className="am-topbar">
        <div className="am-title">
          <span style={{ display: 'flex', color: 'var(--cv-mod-image)' }}>
            <UiIcon kind="assets" size={15} />
          </span>
          资产管理中心
          <span className="am-title__sub">ASSET MANAGER</span>
        </div>
        <nav className="am-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`am-tab ${assetView === t.key ? 'is-on' : ''}`}
              onClick={() => setAssetView(t.key)}
            >
              {t.key === 'library' && <span className="am-dot" />}
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* 子视图主体 + 详情 drawer */}
      <div className="am-body">
        {assetView === 'library' && <AssetLibrary />}
        {assetView === 'wardrobe' && <CharacterWardrobe />}
        {assetView === 'scenes' && <SceneManager />}
      </div>

      {/* 右侧详情 drawer — selectedAssetUuid 不为空时弹出 */}
      {selectedAssetUuid && (
        <>
          {/* 半透明遮罩，点击关闭 */}
          <div className="am-drawer-overlay" onClick={closeAssetDetail} />
          <div className="am-drawer">
            <button className="am-drawer__close" onClick={closeAssetDetail}>✕</button>
            <AssetDetail />
          </div>
        </>
      )}
    </div>
  )
}
