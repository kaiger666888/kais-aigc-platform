/**
 * 资产管理中心 —— 画布的第三种视图模式 (viewMode='assets')。
 *
 * 子视图 Tab（按工作流而非资产类型分组）：
 *   资产库 Library（生产导向，平铺所有资产三态）
 *   角色管理 Character · 场景管理 SceneShot（管理导向，仅展示已选定资产的关系链）
 * 「场景管理」合并了原「场景管理」(多视角设定图) 与「首尾帧流水线」(分镜级首尾帧 + 连续性判定)。
 * 资产详情改为右侧 drawer（selectedAssetUuid != null 时弹出），不再独占整个视图。
 * 双击资产库卡片弹出，点击资产库空白区域关闭。
 *
 * Tab 命名（2026-08-25 命名收口）：
 *   - 第 4 Tab 「Notion 文档」——按真值源命名（直连 Notion API，非注册表快照）；
 *     注册表侧的文字阅读在资产库详情 TextReader（稿纸列），两家的关系在阅读器
 *     provenance + 「Notion 在线版 →」互链，不再是隐形平行宇宙。
 *   - 第 5 Tab 「选片决策」——按职能命名（候选组三态流转/批量决策/冗余配置），
 *     不再与资产库左树（「资产层级」筛选器）共用同名造成「两棵重复的树」误读。
 */
import { useCallback } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { UiIcon } from '../canvas/icons'
import AssetLibrary from './AssetLibrary'
import AssetHierarchy from './AssetHierarchy'
import AssetDetail from './AssetDetail'
import CharacterWardrobe from './CharacterWardrobe'
import SceneShotManager from './SceneShotManager'
import DocumentPanel from './DocumentPanel'
import './assetManager.css'

type AssetView = 'library' | 'character' | 'scene_shot' | 'documents' | 'hierarchy'

const TABS: Array<{ key: AssetView; label: string }> = [
  { key: 'library', label: '资产库' },
  { key: 'character', label: '角色管理' },
  { key: 'scene_shot', label: '场景管理' },
  { key: 'documents', label: 'Notion 文档' },
  // 62-04：第 5 Tab（原标签「资产层级」，08-25 改「选片决策」）——三域折叠树 + 组卡 + 单件桶（HIER-04：默认视图仍 library）
  { key: 'hierarchy', label: '选片决策' },
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
        {assetView === 'documents' && <DocumentPanel />}
        {assetView === 'hierarchy' && <AssetHierarchy />}
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
