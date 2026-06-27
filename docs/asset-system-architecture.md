# 无限画布资产管理系统 — 架构设计

> **日期**: 2026-06-27
> **状态**: 设计 + 实现
> **基于**: Unreal Engine Asset Manager / Unity Addressables / tldraw TLAssetStore / Blender Asset Browser / OpenUSD 的共同模式

---

## 1. 调研结论：5 个系统的共同设计

| 系统 | 资产身份 | 画布引用 | 核心原则 |
|------|---------|---------|---------|
| Unreal | PrimaryAssetId (Type:Name) | 软引用 TSoftObjectPtr | 区分 Primary/Secondary，按需加载 |
| Unity | Addressable Name | AssetReference (不加载到内存) | 全局地址 + 分组打包 |
| tldraw | assetId (store record) | Shape.props.assetId | 资产记录独立于画布形状 |
| Blender | UUID + .blend 文件 | Link(引用) / Append(拷贝) | 文件即容器，Catalog 是独立组织层 |
| OpenUSD | prim path (层路径) | reference / payload arc | 非破坏性合成，延迟加载 |

**共同模式**：
1. 资产有全局唯一身份（不靠文件路径）
2. 画布/场景只存引用，不存资产本体
3. 一个资产可被多处引用
4. 元数据（类型/尺寸/状态）和文件指针分离

## 2. kais-aigc-platform 的约束

### 现有数据

```
o_assets (4 行): 小橘/小月/城市街道/小月家客厅
  → o_image (4 行): 1/asset_cat.png, 1/asset_girl.png, 1/scene_street.png, 1/scene_home.png
  → o_scriptAssets: scriptId=1 → assetId 1,2,3,4
  → o_assets2Storyboard: 7 条关联
o_video (1 行): 1/video_test_0.mp4
o_agentWorkData: 12 行 (画布快照)
```

### 现有调用链

```
agent-sync.js → POST /api/assets/addAssets (写 o_assets + o_image)
              → POST /api/canvas/save (写 o_agentWorkData)

convert.ts   → 读 o_script + o_assets + o_image + o_storyboard
              → 构造 FlowGraphV2 节点 (data.filePath = /oss/{image.filePath})
              → 节点同时塞入 assetId + filePath + prompt + thumbnailUrl

画布前端     → 读 FlowGraphV2，节点 data.filePath 直接用于渲染图片
```

### 核心问题

1. **filePath 硬编码在画布节点 data 里** — 文件位置变了，所有节点引用断裂
2. **o_assets 绑死 projectId** — 无法跨项目复用角色
3. **无全局资产身份** — convert.ts 用 `asset-{id}` 作为节点 ID，但 `id` 是 o_assets 的自增主键，不可跨项目寻址
4. **元数据散落** — prompt 在 o_assets、filePath 在 o_image、reviewStatus 在 o_agentWorkData JSON

## 3. 架构设计

### 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 资产身份 | UUID (全局唯一) | 跨项目寻址。参照 Blender UUID + Unity Addressable Name |
| 画布引用 | assetId (UUID) | 参照 tldraw Shape.props.assetId。节点只存引用，不存文件路径 |
| 文件存储 | 现有 o_image 表 (不动) | 文件指针已在此表中，不迁移物理文件 |
| 元数据 | 提升到 o_assets 表 | prompt/type/characterId/viewAngle 从画布节点 data 移到资产表 |
| 保留 o_assets | 是 (增强) | 已有 4 条数据 + agent-sync.js 依赖。不重建表，只加字段 |
| 资产间关系 | characterId 分组 | 参照 Unreal Primary/Secondary：角色 = Primary，角色的多张图 = Secondary |

### 数据模型

```
┌─────────────────────────────────────────────────────────┐
│                    画布 FlowGraphV2                       │
│                                                         │
│  AssetNode                                               │
│  data: {                                                │
│    assetId: 3,          ← 引用 o_assets.id (已有!)       │
│    assetType: "character"                                │
│    // 不再存: filePath, prompt, thumbnailUrl             │
│    // 这些从 o_assets JOIN o_image 查                    │
│  }                                                      │
└──────────────────────┬──────────────────────────────────┘
                       │ JOIN
┌──────────────────────▼──────────────────────────────────┐
│  o_assets (增强) — 全局资产注册表                          │
│                                                         │
│  id (PK)          ← 已有                                │
│  uuid             ← 新增: 全局唯一身份                    │
│  name             ← 已有                                │
│  type             ← 已有: character | scene | prop | clip│
│  prompt           ← 已有: 生成 prompt                    │
│  describe         ← 已有: 描述                           │
│  projectId        ← 已有 (NULL = 全局资产库)              │
│  imageId (FK)     ← 已有: → o_image                      │
│  ──────────────────── 新增字段 ────────────────────────  │
│  characterId      ← 新增: 同角色多视图分组                 │
│  viewAngle        ← 新增: front|side|back|3quarter|full  │
│  isPrimaryView    ← 新增: 角色主视图                      │
│  model            ← 新增: 生成模型 (jimeng-5.0/seedance)  │
│  tags             ← 新增: 标签 (逗号分隔)                  │
│  state            ← 新增: active|archived                 │
│  meta             ← 新增: JSON (seed/lora/params)        │
│  createdAt        ← 新增: 创建时间                        │
│  createdBy        ← 新增: pipeline|manual|agent-sync     │
│                                                         │
│  📌 o_assets.assetsId 字段 (父资产引用) 保留              │
│     → 用于表达 Primary→Secondary 资产依赖                │
│     → 例: 角色"小橘"(id=1) 是 Primary                    │
│        角色的 L1 锚点图 assetsId=1 引用角色              │
└──────────────────────┬──────────────────────────────────┘
                       │ imageId
┌──────────────────────▼──────────────────────────────────┐
│  o_image (不动) — 文件指针层                              │
│                                                         │
│  id (PK)                                                │
│  filePath         ← 实际文件路径                          │
│  model            ← 生成模型                              │
│  resolution       ← 分辨率                                │
│  state            ← 已完成|生成中|生成失败                 │
└─────────────────────────────────────────────────────────┘
```

### Primary / Secondary 资产模型

借鉴 Unreal Engine 的分层（已有 o_assets.assetsId 字段天然支持）：

```
Primary Asset (角色/场景的"定义"):
  o_assets WHERE assetsId IS NULL
  → 小橘 (id=1, type=character)
  → 城市街道 (id=3, type=scene)

Secondary Asset (Primary 的"视图/变体"):
  o_assets WHERE assetsId = {primary_id}
  → 小橘-L1正面 (id=10, assetsId=1, viewAngle=front, isPrimaryView=true)
  → 小橘-L2侧面 (id=11, assetsId=1, viewAngle=side)
  → 小橘-L2正面-变体B (id=12, assetsId=1, viewAngle=front)

画布上的 Asset 节点:
  → 可以引用 Primary (角色本身)
  → 也可以引用 Secondary (具体某张图)
  → 通过 JOIN o_assets → o_image 拿到 filePath
```

### 画布节点引用模式

```
Before (现在):
  节点 data = {
    assetId: 1,
    assetType: "character",
    prompt: "一只橘色猫咪...",      ← 冗余: o_assets 也有
    filePath: "/oss/1/asset_cat.png", ← 冗余: o_image 也有
    thumbnailUrl: "...",              ← 冗余: 从 filePath 派生
    characterId: "xiaojv",            ← 画布独有的引用分组
    viewAngle: "front",               ← 应该在资产表
  }

After (目标):
  节点 data = {
    assetId: 1,                       ← 唯一引用
    assetType: "character",           ← 冗余但必要: 渲染图标用
    // filePath / prompt / thumbnailUrl 运行时从 API 查
    // 或 convert.ts 一次性 JOIN 填充 (过渡期)
  }
```

### API 设计 (最小集)

| 路由 | 方法 | 用途 | 对标 |
|------|------|------|------|
| `/api/v1/assets` | POST | 注册资产 (管线产出时) | Unity Addressables.add |
| `/api/v1/assets/search` | POST | 搜索资产 (跨项目) | Unreal AssetManager.ScanPaths |
| `/api/v1/assets/:id` | GET | 获取单个资产 (含 filePath) | tldraw resolve |
| `/api/v1/assets/:id` | PATCH | 更新元数据 | Blender edit asset metadata |
| `/api/v1/assets/project/:projectId` | GET | 列出项目所有资产 | Shotgrid project assets |
| `/api/v1/assets/:id/variants` | GET | 列出资产的变体 | Unreal Asset Bundles |

## 4. 迁移策略

渐进式三步，每步独立可交付：

### Step 1: DB Schema 增强 + 资产 API

- ALTER TABLE o_assets ADD COLUMN uuid/characterId/viewAngle/isPrimaryView/model/tags/state/meta/createdAt/createdBy
- UPDATE 现有 4 条数据: 生成 uuid
- 实现 6 个 Asset API 路由
- 不动 convert.ts，不动画布前端

### Step 2: convert.ts 读资产表

- convert.ts 节点的 data 从 JOIN o_assets + o_image 填充
- 画布前端不需要改 (data 结构不变，只是来源变了)
- agent-sync.js 新增 asset-type=character_image 时同时写 characterId/viewAngle

### Step 3: 画布引用纯化

- AssetNodeData 精简为 { assetId, assetType }
- 新增 `/api/v1/assets/:id` 被画布前端在节点渲染时调用
- filePath/thumbnailUrl 不再存画布节点，改为实时查询
