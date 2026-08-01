/**
 * 资产管理中心 —— 画布的第三种视图模式 (viewMode='assets')。
 *
 * 由 FlowCanvas 在主区域条件渲染（与 canvas / timeline 并列）。自身顶栏提供 4 个子视图 Tab：
 *   资产库 Library · 资产详情 Detail · 角色衣柜 Wardrobe · 场景管理 Scenes
 * 子视图切换状态 (assetView) 存于 canvasStore，使 Library 卡片点击能驱动 Detail。
 *
 * 数据：assetManagerData.ts mock 数据集（现网 assets-registry 缺细粒度类型与组合关系，
 * 见 /tmp/asset-manager-design.md）。视觉：复用 --cv-* token（冷中性壳 + 4 模态色），
 * 见 assetManager.css。
 */
import { useCanvasStore } from '../../store/canvasStore'
import { UiIcon } from '../canvas/icons'
import AssetLibrary from './AssetLibrary'
import AssetDetail from './AssetDetail'
import CharacterWardrobe from './CharacterWardrobe'
import SceneManager from './SceneManager'
import './assetManager.css'

type AssetView = 'library' | 'detail' | 'wardrobe' | 'scenes'

const TABS: Array<{ key: AssetView; label: string }> = [
  { key: 'library', label: '资产库' },
  { key: 'detail', label: '资产详情' },
  { key: 'wardrobe', label: '角色衣柜' },
  { key: 'scenes', label: '场景管理' },
]

export default function AssetManager() {
  const assetView = useCanvasStore((s) => s.assetView)
  const setAssetView = useCanvasStore((s) => s.setAssetView)

  return (
    <div className="am-root">
      {/* 子视图顶栏：标题 + 4 Tab */}
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

      {/* 子视图主体 */}
      <div className="am-body">
        {assetView === 'library' && <AssetLibrary />}
        {assetView === 'detail' && <AssetDetail />}
        {assetView === 'wardrobe' && <CharacterWardrobe />}
        {assetView === 'scenes' && <SceneManager />}
      </div>
    </div>
  )
}
