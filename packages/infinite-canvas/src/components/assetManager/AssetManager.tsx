/**
 * 资产管理中心 —— 画布的第三种视图模式 (viewMode='assets')。
 *
 * 子视图 Tab（按工作流而非资产类型分组）：
 *   资产库 Library（生产导向，平铺所有资产三态）
 *   角色管理 Character · 场景管理 SceneShot（管理导向，仅展示已选定资产的关系链）
 * 「场景管理」合并了原「场景管理」(多视角设定图) 与「首尾帧流水线」(分镜级首尾帧 + 连续性判定)。
 * 资产详情改为右侧 drawer（selectedAssetUuid != null 时弹出），不再独占整个视图。
 * 双击资产库卡片弹出，点击资产库空白区域关闭。
 */
import { useCallback } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { UiIcon } from '../canvas/icons'
import AssetLibrary from './AssetLibrary'
import AssetDetail from './AssetDetail'
import CharacterWardrobe from './CharacterWardrobe'
import SceneShotManager from './SceneShotManager'
import DialoguePanel from './DialoguePanel'
import DocumentPanel from './DocumentPanel'
import './assetManager.css'

type AssetView = 'library' | 'character' | 'scene_shot' | 'dialogue' | 'documents'

const TABS: Array<{ key: AssetView; label: string }> = [
  { key: 'library', label: '资产库' },
  { key: 'character', label: '角色管理' },
  { key: 'scene_shot', label: '场景管理' },
  { key: 'dialogue', label: '对白管理' },
  { key: 'documents', label: '创作文档' },
]

export default function AssetManager() {
  const assetView = useCanvasStore((s) => s.assetView)
  const rawSetAssetView = useCanvasStore((s) => s.setAssetView)
  const selectedAssetUuid = useCanvasStore((s) => s.selectedAssetUuid)
  const rawCloseAssetDetail = useCanvasStore((s) => s.closeAssetDetail)

  // 子视图切换 / 详情关闭都是导航交互 → 先拍快照进应用历史栈（navPushCallback 由 FlowCanvas 注入）。
  const setAssetView = useCallback((v: AssetView) => {
    useCanvasStore.getState().navPushCallback?.()
    rawSetAssetView(v)
  }, [rawSetAssetView])
  const closeAssetDetail = useCallback(() => {
    useCanvasStore.getState().navPushCallback?.()
    rawCloseAssetDetail()
  }, [rawCloseAssetDetail])

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
        {assetView === 'character' && <CharacterWardrobe />}
        {assetView === 'scene_shot' && <SceneShotManager />}
        {assetView === 'dialogue' && <DialoguePanel />}
        {assetView === 'documents' && <DocumentPanel />}
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
