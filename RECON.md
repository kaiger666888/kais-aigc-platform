# RECON.md — kais-aigc-platform 画布侦察报告

> 侦察员产出 · 目标仓库 `kaiger666888/kais-aigc-platform`（私有，main 分支）
> 镜像位置：`/mnt/agents/output/kais-aigc-platform/packages/infinite-canvas/`
> 校验：**60/60 文件与 GitHub blob 逐字节一致**（git blob SHA1 + size 双对比）

---

## 0. 验收校验

| 项 | 结果 |
|---|---|
| GitHub 侧递归清单文件数 | **60** |
| 本地镜像文件数 | **60** |
| 逐字节一致（git blob sha1 全量比对） | **60/60 ✅** |
| package-lock.json | 115,860 B · sha `41a99133…` ✅ |
| yarn.lock | 54,450 B · sha `19e34773…` ✅ |

修复记录：canvasApi.ts / helpers.mjs 两个文件在 GitHub 上以**双换行结尾**，MCP 拉取时剥掉 1 个尾部 `\n`，已按 blob 哈希验证后补齐。

---

## 1. 文件树（大小 B / 行数）

```
packages/infinite-canvas/
├── .gitignore                          111 / 19
├── index.html                          495 / 13
├── package.json                        786 / 27
├── package-lock.json               115,860 / 2,376
├── playwright.config.mjs               969 / 29
├── tsconfig.json                       578 / 26
├── vite.config.ts                      652 / 21
├── yarn.lock                        54,450 / 1,346
├── docs/
│   └── canvas-node-schema.md         8,275 / 156
├── src/
│   ├── constants.ts                 10,963 / 236   ← NODE_SCHEMA 结构化字段契约
│   ├── main.tsx                      1,122 / 25    ← 单页入口,无路由
│   ├── components/
│   │   ├── FlowCanvas.tsx           27,437 / 690   ← 主画布编排组件
│   │   ├── NodeDetailPanel.tsx      33,229 / 833   ← 节点详情面板
│   │   ├── IterationPanel.tsx       25,116 / 607   ← 迭代引擎面板
│   │   ├── VariantGroupDetail.tsx   22,941 / 539   ← 变体组审核详情
│   │   ├── FeedbackPanel.tsx        18,339 / 435   ← 资产反馈面板
│   │   ├── CanvasContextMenu.tsx    15,347 / 375   ← 右键菜单(批量执行)
│   │   ├── FileViewer.tsx           12,160 / 290
│   │   ├── ReviewCard.tsx           10,073 / 248
│   │   ├── StructuredFieldPanel.tsx 10,108 / 244   ← NODE_SCHEMA 渲染器
│   │   ├── BranchPanel.tsx           7,029 / 180
│   │   ├── ReviewActionButtons.tsx   5,549 / 144
│   │   ├── LoadingOverlay.tsx        5,413 / 122
│   │   ├── FeedbackBadge.tsx         4,718 / 130
│   │   ├── ProjectSelector.tsx       4,570 / 120
│   │   ├── ErrorBoundary.tsx         3,405 / 88
│   │   ├── VariantBadge.tsx          3,267 / 94
│   │   ├── ScoreBadge.tsx            1,922 / 58
│   │   ├── ScoreMiniBar.tsx          1,966 / 57
│   │   ├── CanvasActionsContext.ts   1,479 / 41
│   │   ├── edges/CanvasEdge.tsx      3,924 / 108   ← 自定义边
│   │   └── nodes/
│   │       ├── VideoNode.tsx        11,425 / 289   ← 含内联播放器
│   │       ├── AssetNode.tsx         8,720 / 235
│   │       ├── AudioNode.tsx         8,347 / 217   ← 24 柱波形
│   │       ├── StoryboardNode.tsx    8,300 / 218   ← ref-output Handle
│   │       ├── ScriptNode.tsx        7,724 / 209   ← variant_group 候选组
│   │       ├── FallbackNode.tsx      2,302 / 67
│   │       └── ZoneNode.tsx          1,669 / 46    ← 泳道/分区背景
│   ├── hooks/
│   │   ├── useCanvasSocket.ts        7,060 / 209   ← socket.io 全部订阅
│   │   └── useToast.tsx              3,058 / 105
│   ├── services/
│   │   ├── canvasApi.ts             28,211 / 685   ← 全部 REST 客户端
│   │   └── scail2Api.ts              4,021 / 107
│   ├── store/
│   │   ├── canvasStore.ts           14,520 / 429   ← zustand 主 store
│   │   └── variantOps.ts             4,619 / 132   ← 变体组纯函数操作
│   ├── theme/
│   │   ├── catppuccin.ts             3,521 / 94    ← Catppuccin Mocha 主题
│   │   └── branchColors.ts           1,369 / 39    ← 分支配色
│   ├── types/
│   │   └── canvas.ts                12,952 / 436   ← 全部类型(持久化模型)
│   └── utils/
│       ├── flowDataMapper.ts        11,752 / 302   ← FlowGraph→ReactFlow 映射
│       ├── autoLayout.ts             4,254 / 130   ← dagre 布局
│       └── styles.ts                 2,857 / 87
└── test/e2e/
    ├── REPORT.md                     7,132 / 132   ← v1.7 测试报告 30/30
    ├── helpers.mjs                   2,121 / 79
    ├── mock-backend/server.mjs      15,071 / 401   ← Express5+socket.io mock
    └── tests/                                        (7 个 spec, 36 用例)
        ├── phase35-storyboard-metadata.mjs    5,057 / 143
        ├── phase36-orchestrator.mjs           4,489 / 111
        ├── phase37-batch-execution.mjs        4,848 / 121
        ├── phase38-storyboard-preview.mjs     3,327 / 92
        ├── phase40-review-gate-hardening.mjs  2,021 / 48
        ├── phase40-status-normalization.mjs   4,930 / 123
        └── phase41-pipeline-sync.mjs          2,726 / 64
```

技术栈：React 19.2 · @xyflow/react 12.10 · zustand 5（业务）/ 4.5.7（xyflow 内部）· socket.io-client 4.8 · @dagrejs/dagre 3 · Vite 6 · TS 5.9 · Playwright 1.61 + Express 5 mock。

---

## 2. src 逐文件职责（一句话）

| 文件 | 职责 |
|---|---|
| constants.ts | 节点尺寸/布局常量 + `NODE_SCHEMA`（每节点类型的结构化字段 enum/bar/text 契约，对接 expert SKILL.md 输出） |
| main.tsx | 单页入口直接渲染 `<FlowCanvas/>`；`?testMode=1` 时挂 `window.__kaisCanvas` 测试钩子 |
| components/FlowCanvas.tsx | 主画布：加载/保存 FlowGraph、ReactFlow 装配、socket 回调接线、自动保存、编排进度、健康轮询 |
| components/NodeDetailPanel.tsx | 右侧节点详情：结构化字段编辑、反馈、迭代、变体组入口 |
| components/IterationPanel.tsx | 迭代引擎 UI：诊断→计划→执行→确认/丢弃全流程（接 /v1/iteration/*） |
| components/VariantGroupDetail.tsx | 变体组候选对比审核（多候选 score 展示、选胜、驳回） |
| components/FeedbackPanel.tsx | 资产反馈列表/创建/传播视图（/v1/feedback/*） |
| components/CanvasContextMenu.tsx | 右键菜单：添加节点、执行节点、批量执行（selectedNodeIds>1 时） |
| components/FileViewer.tsx | 图片/视频/音频/文本文件预览弹层 |
| components/ReviewCard.tsx | 审核卡片（reviewStatus + AI Score + 通过/驳回操作） |
| components/StructuredFieldPanel.tsx | 按 NODE_SCHEMA 渲染 enum 下拉/number/tags/bar 字段编辑器 |
| components/BranchPanel.tsx | 分支列表、升主线、归档 |
| components/ReviewActionButtons.tsx | 节点上的快捷审核按钮（approveNode/rejectNode） |
| components/LoadingOverlay.tsx | 加载骨架动画 |
| components/FeedbackBadge.tsx | 节点角标：反馈数/verdict/下游影响数（getFeedbackStats+getPropagation） |
| components/ProjectSelector.tsx | 项目/剧本选择器（fetchProjects/fetchProjectScripts） |
| components/ErrorBoundary.tsx | React 错误边界 |
| components/VariantBadge.tsx | V1/V2/V3 + ✦BEST 徽标（status 显式优先于 boolean 推导） |
| components/ScoreBadge.tsx | AI Score 总角标 |
| components/ScoreMiniBar.tsx | 5 维评分迷你条 |
| components/CanvasActionsContext.ts | 跨组件动作 context（避免 prop drilling） |
| components/edges/CanvasEdge.tsx | 自定义边渲染：ref 虚线 / sequence 蓝实线+箭头 / parallel 绿虚线 / isInactive 淘汰 / isExplore / dataType 着色 |
| components/nodes/ScriptNode.tsx | 剧本节点；`category==='variant_group'` 时渲染候选组 |
| components/nodes/AssetNode.tsx | 资产节点：缩略图自适应、VariantBadge、ReviewActionButtons、ScoreBadge |
| components/nodes/StoryboardNode.tsx | 分镜节点：元数据 chips + 预览构图按钮 + 第二 source Handle `ref-output` |
| components/nodes/VideoNode.tsx | 视频节点：内联播放器（播放/进度/音量/关闭）+ target Handle `ref-input` |
| components/nodes/AudioNode.tsx | 音频节点：24 柱波形 + 播放控制 |
| components/nodes/ZoneNode.tsx | zone 泳道背景节点（相位分组底色框） |
| components/nodes/FallbackNode.tsx | 未知类型兜底渲染 |
| hooks/useCanvasSocket.ts | socket.io 连接与全部事件订阅（见 §5） |
| hooks/useToast.tsx | toast 通知 hook |
| services/canvasApi.ts | 全部 REST 客户端：项目/图存取/执行/编排/审核/反馈/迭代/v2 节点分支/健康探活；含 CancelToken、超时、重试 |
| services/scail2Api.ts | scail2 引擎相关 API（小封装） |
| store/canvasStore.ts | zustand 主 store（见 §4） |
| store/variantOps.ts | 变体组纯函数：applyWinnerSelection/rollbackWinnerSelection/syncWinnerToGroups |
| theme/catppuccin.ts | Catppuccin Mocha 调色板 + edgeTypeColors |
| theme/branchColors.ts | 分支 id→颜色映射（getBranchColor） |
| types/canvas.ts | 全部类型：节点数据、FlowGraph/FlowGraphV2 持久化模型、Legacy 模型、VariantGroup、品牌 ID |
| utils/flowDataMapper.ts | FlowGraph(持久化)↔ReactFlow nodes/edges 双向映射；旧值 `awaiting_audit`→`pending` 归一化在此边界 |
| utils/autoLayout.ts | dagre 自动布局（见 §6） |
| utils/styles.ts | 样式工具（节点/边样式合成） |

---

## 3. 数据模型对照：前端 types/canvas.ts vs 后端 FlowGraph V2（src/types/flowgraph-v2.ts + zod schema）

前端有**两套**持久化模型：`FlowGraph`（v1，nodes/links/groups/variantGroups?/viewport?）与 `FlowGraphV2`（v2，meta+branches）。后端（任务 2 拉取的 `_recon/flowgraph-v2.ts`）仅一套 `FlowGraphV2`。**未在扫描目录发现任何 flowgraph-v3 文件**（/src、/schema、/specs、/docs、/workflows、/context 两层内无 v3 命名）。

| 维度 | 前端 FlowGraphV2 (types/canvas.ts) | 后端 FlowGraphV2 (src/types/flowgraph-v2.ts) | 差异/改造点 |
|---|---|---|---|
| meta | version:'2', projectId, episodesId, createdAt, updatedAt, viewport? | +pipelineId?, +lastEventId? | 后端多 pipelineId / lastEventId（事件溯源游标） |
| meta 时间戳 | **string (ISO)** | **number (ms)** | ⚠️ 类型不一致 |
| NodeState | `idle\|pending\|running\|success\|error\|cached` | `idle\|pending\|running\|success\|error\|skipped` | ⚠️ **cached vs skipped 不对齐**（ORCHESTRATE-04 测试里 mock 用 cached 语义跳过） |
| NodeType | 6 种：script/asset/storyboard/video/audio/zone | 13 种：+3d/variant/reference/upscale/face_restore/suggestion/phase | 后端超集；前端 FallbackNode 兜住未知类型 |
| 节点字段 | id,type,position,size,data,state + progress?/groupId?/routingDecision?/variantIndex?/reviewStatus?/aiScore?/isWinner?/suggestion?/variantOf?/variantGroupId?/branchId?/phaseIndex?/phaseName? | branchId/phaseIndex/phaseName **必填**；+rejectReason?；无 progress/groupId/routingDecision/variantIndex | 后端更严格（branch/phase 必填）；前端运行期字段（progress/routingDecision/variantIndex）在后端模型缺失 |
| AIScore | 前端结构化 5 维+overall+source（aesthetics/consistency/compliance/technicalQuality/audioMatch） | `aiScore?: any` | 后端无结构约束 |
| Link | id,source,sourceHandle?,target,targetHandle?,dataType(5枚举),isInactive?,branchId?,isExplore?,linkType?(4语义),refType? | id,source,target,branchId(必填),dataType:**string**,isExplore?,isInactive? | 前端多 handle/linkType/refType（ref 引用通道是前端概念）；后端 dataType 无枚举约束 |
| LinkDataType | text/image/video/audio/data | string（树算法 spec 用 "output"） | ⚠️ 后端实际数据出现 "output" 等值，前端枚举不含 |
| Branch | FlowBranch: id,label,parentId,parentNodeId,status,forkReason,createdAt,updatedAt (string) | +metadata?；时间戳 number | status 枚举一致（draft/active/paused/completed/archived/rejected） |
| VariantGroup | {groupId, parentNodeId, variantNodeIds, winnerNodeId?, createdAt} | {id, phaseIndex, branchId, variantNodeIds, winnerNodeId?, selectMode:'single'\|'multi'} | ⚠️ 结构差异大：前端按父节点分组，后端按 phaseIndex+branchId 分组且有 selectMode |
| ReviewStatus | pending/approved/rejected（旧 awaiting_audit 在 mapper 归一化） | 同 | ✅ 已对齐（Phase 40） |

**canvas_sync 字段映射**（`_recon/canvas_sync_mappings.py` + `pipeline-field-map.yaml`，AUTO-GENERATED 单一事实源）：
- 14 个相位 p01–p14 → canvas_type/asset_type 映射（p09=storyboard、p10=audio、p11=video…）
- python_key → canvas_key 命名映射（snake→camel：`camera_movement`→`cameraMovement`、`mcmahon_arc`→`mcmahonArc`、`hook_strength`→`hookIntensity`…）
- 中文→英文枚举映射（"固定"→static、"三分法"→rule_of_thirds…）+ 每枚举 default
- ⚠️ **timeline 枚举不一致**：canvas_sync 用 `day/night/dusk/dawn/indoor/outdoor`（时间/空间），而前端 `SHOT_METADATA_LABELS.timeline` 用 `1975/2000/2025/dream/flashback`（叙事时间线）——接入 FlowGraphV3 时必须裁决
- 5D 风格向量 python 侧为嵌套 `style_vector.composition` → 前端拍平 `style_composition`（transform coerce_float_0_1）
- murch_grade 有 `murch_numeric_to_string` 变换（数值→excellent/pass/weak/fail）

---

## 4. zustand store（store/canvasStore.ts）字段清单

```
projectId, episodesId                     项目上下文
activeSkillId ('movie-v1'), declaredNodeTypes: SkillNodeTypeDecl[]   Phase 32 技能注册表
nodes: Node[], edges: Edge[]              ReactFlow 状态（applyNodeChanges/applyEdgeChanges）
branches: FlowBranch[]
variantGroups: VariantGroup[]             持久化层,与 FlowGraphV2.variantGroups 同步
loading, loadError, hasData, saving       加载/保存状态
selectedNode, menuPos, selectedNodeIds    UI 选择态（Phase 37 多选）
toasts: ToastItem[]                       3s 自动消失
orchestration: OrchestrationState         {status: idle|running|done|error, runId, mode: full|batch,
                                           completed, total, failed, currentNodeId, failedNodes}
iteration: IterationState                 {status: idle|planning|plan_ready|executing|done|error,
                                           plan, result, error, adjustmentApproved, panelOpen, history[]}
actions: setProject / setNodes / setEdges / onNodesChange / onEdgesChange / setBranches /
  addBranch / updateBranch / setVariantGroups / upsertVariantGroup / approveNode (乐观更新+回滚) /
  rejectNode (同) / selectWinner (本地即时,不直接调 API,靠手动保存持久化) /
  selectBranchAsMain / archiveBranch / showToast / dismissToast /
  startOrchestration / updateOrchestrationProgress / finishOrchestration / resetOrchestration /
  setIterationPlan / updateIterationProgress / setIterationError / setAdjustmentApproved /
  setIterationPanelOpen / pushIterationHistory / setIterationHistory / resetIteration
```

---

## 5. Socket 协议清单（hooks/useCanvasSocket.ts）

- **连接**：namespace `/ws/projects`，握手 query `projectId`，transports `['websocket','polling']`；无自定义 path（用 socket.io 默认 `/socket.io`）
- **客户端发出**：仅 `subscribe { projectId, episodesId, since? }`（且仅在 `VITE_CANVAS_EVENT_REPLAY==='1'` 时）
- **服务端→客户端订阅**（12 个）：

| 事件 | payload | 说明 |
|---|---|---|
| `node:state` | {nodeId, state, progress?} | 节点执行状态 |
| `node:preview` | {nodeId, thumbnailUrl} | 预览图更新 |
| `node:created` | {nodeId, data} | 新资产完成 |
| `execution:progress` | {nodeId, state, progress} | 执行进度（并入 onNodeStateChange） |
| `orchestrate:start` | {runId, total, mode} | 编排开始 |
| `orchestrate:progress` | {runId, completed, total, failed, currentNodeId, mode} | 编排进度 |
| `orchestrate:done` | {runId, completed, total, failed, failedNodes[], mode} | 编排完成 |
| `branch:created` / `branch:updated` | FlowBranch | 均走 onBranchCreated 回调 |
| `review:approved` / `review:rejected` | {nodeId, reason?} | 审核结果 |
| `graph:saved` | {projectId, episodesId, timestamp} | pipeline save-v2 后广播 → 前端 reload + toast |
| `canvas:event` ⚑ | {eventId, type(9种), nodeId?, payload, projectId, episodesId, createdAt} | Phase 41 增量事件流，feature flag 门控 |
| `canvas:reset` ⚑ | {lastEventId} | 落后 >500 事件时要求全量 load-v2 |

后端 v2 完整事件契约见 `_recon/canvas-v2-socket-events.md`（含 `node:updated/deleted`、`branch:deleted`、`node:preview`、`execution:progress` 与 9 种 CanvasEventType：node_upsert/node_delete/link_upsert/link_delete/branch_upsert/branch_delete/variant_group_upsert/review_status/bootstrap）。

## 6. Hooks / dagre / 路由

**Hooks**：仅 2 个 —— `useCanvasSocket`（连接+12 事件+emit，回调用 ref 持有避免重连）、`useToast`。

**dagre 布局**（utils/autoLayout.ts）：
- 入口 `getLayoutedElements(nodes, edges, direction='LR')`，由 FlowCanvas 工具栏「整理布局」按钮触发
- 配置：`rankdir: LR`，`nodesep: 50`，`ranksep: 120`，`marginx/y: 40`，`ranker: 'network-simplex'`
- 节点尺寸优先 `node.measured`，fallback 260×180
- **zone 节点不参与布局**：布局后按 `data.phase` 找子节点包围盒重定位（padding 左/上 60/50）
- dagre 返回中心坐标 → 转 ReactFlow 左上坐标；按方向设置 targetPosition/sourcePosition
- 另有 constants.ts `LAYOUT` 手工网格常量（SCRIPT/ASSET/SB/VIDEO/AUDIO 分区坐标）用于 convert/新建节点摆放；后端 9999 项目树算法用 laneIndex*1300 车道布局（见 `_recon/canvas-tree-algorithm-spec.md` §4）

**路由**：**无路由库**。main.tsx 直接渲染 FlowCanvas 单页；项目/集次经 URL query（`?projectId=&episodesId=&testMode=`）。无 `/canvas`、`/script` 等多路由，无 react-router 依赖。前端通过 vite proxy 把 `/api`、`/socket.io` 转发到画布后端 :10588（vite.config.ts）。

## 7. Playwright 测试现状

- 配置：playwright.config.mjs，webServer 起 mock backend（Express5+socket.io，PORT 9876）服务 vite build 产物
- 用例：7 个 spec **36 个测试**（phase35×7、phase36×9、phase37×8、phase38×6、phase40-gate×~2、phase40-norm×~3、phase41×~1）
- REPORT.md（v1.7, 2026-06-18）：**30/30 passed, 59.6s**（当时仅 phase35–38）；phase40/41 三个 spec 晚于该报告，无更新后总报告
- 架构要点：`?testMode=1` 挂 `window.__kaisCanvas` 绕开 ReactFlow 多选；`/__mock/reset|config|calls|state|emit` 控制面；mock 默认 6 节点 5 边，拓扑 TOPOLOGY=[script,asset,storyboard,video,audio]
- 已知约束：headless 下多选 UI 路径不可靠（已绕过）；Phase 38 真实 IMAGE_DRAW 引擎未集成；ORCHESTRATE-03 依赖 CDN 加载 socket.io.esm（离线需预下载）

## 8. docs/canvas-node-schema.md 核心结论

三层对齐契约：**Expert SKILL.md output schema → canvas node data → StructuredFieldPanel**，配置源 = constants.ts `NODE_SCHEMA`。要点：
- storyboard 9 字段（cameraMovement/framing/composition/pacing/timeline/axisLine/emotion/audioCue/ltxPrompt）
- script 6 字段（mcmahonArc 7 叙事弧/hookType 5 钩/hookIntensity 1-5/genre/format/totalDuration）
- asset：角色 archetype 9 原型 + ageRange + clipITarget；风格 5D bar（style_composition/color/rhythm/light/sound 0.0-1.0）
- video 5 字段（engine 8 引擎/resolution/clipModel/duration/murchGrade 4 档）
- audio 5 字段（audioType/engine 8 引擎/emotion Ekman 7+扩展/speaker/duration）
- **未映射待实现**：emotion_curve 折线、hooks/payoffs/cliffhangers timeline、5D Style Radar、CxSxZ、E-Konte 5-layer、AI Score 5 维评分卡、Variant Group 候选对比

## 9. 变体组 / 事件实体 / 泳道 / TimelineStructure 痕迹

| 概念 | 现状 |
|---|---|
| **变体组** | ✅ 已有完整实现：VariantGroup 类型 + variantOps 纯函数 + VariantBadge/VariantGroupDetail + store.variantGroups + ScriptNode category='variant_group' 候选组 + 后端 variantGroups (selectMode) + 事件 variant_group_upsert。前后端 VariantGroup 结构不一致（见 §3） |
| **事件实体（event sourcing）** | ✅ 后端已有：event store、`canvas:event` 9 类事件、eventId 游标、`canvas:reset` 重放、health 端点 eventCount。前端仅 feature-flag 门控订阅（`VITE_CANVAS_EVENT_REPLAY`），默认仍走全量 reload；`FlowGraphV2.meta.lastEventId` 在前端 meta 中缺失 |
| **泳道** | ✅ zone 节点即泳道：ZoneNode 背景框 + autoLayout 按 data.phase 包围盒重排 + 后端树算法 `laneIndex*1300` 车道布局（ZONE_X_STEP） |
| **TimelineStructure** | ⚠️ 仅痕迹：canvas-node-schema.md「未映射」列出 hooks/payoffs/cliffhangers timeline 待实现；树算法 SKIP_KEYS 中 `timeline_structure` 被显式跳过（不生成 artifact 节点）；前端 SHOT_METADATA_LABELS.timeline 是叙事时间线枚举（1975/2000/2025/dream/flashback），与 canvas_sync 的 day/night/… 枚举冲突。**无 TimelineStructure 组件/类型实现** |

## 10. 任务 2 — 仓库级粗扫结果（/src /schema /specs /docs /workflows /context 前两层）

**已下载到 `_recon/`（6 个，FlowGraph schema / 画布 SPEC 直接命中）：**

| 文件 | 来源 | 大小 | 内容 |
|---|---|---|---|
| `_recon/flowgraph-v2.ts` | src/types/flowgraph-v2.ts | 3,071 | FlowGraph V2 TS 类型（NodeState/BranchStatus/ReviewStatus/NodeType/Suggestion/FlowNodeV2/FlowLinkV2/FlowBranchV2/VariantGroupV2/FlowMetaV2/FlowGraphV2） |
| `_recon/flowgraph-v2-schema.ts` | src/types/flowgraph-v2-schema.ts | 3,679 | 上述的 zod schema 版本 |
| `_recon/canvas_sync_mappings.py` | schema/generated/canvas_sync_mappings.py | 14,469 | AUTO-GENERATED：中文→英文枚举映射、p01–p14 相位→canvas/asset 类型、python_key→canvas_key 字段映射 |
| `_recon/pipeline-field-map.yaml` | schema/pipeline-field-map.yaml | 10,676 | canvas_sync_mappings.py 的源 YAML（单一事实源，禁手改生成物） |
| `_recon/canvas-tree-algorithm-spec.md` | docs/canvas-tree-algorithm-spec.md | 7,764 | 画布树构建算法 SPEC：Zone→Summary→Artifact 三层、ID/连线模式、布局常量、artifact 提取算法、SKIP_KEYS、文件→相位映射 |
| `_recon/canvas-v2-socket-events.md` | docs/canvas-v2-socket-events.md | 6,820 | 画布 v2 socket 事件契约（给外部编排器） |

**只列名未下载的相关文件（按主题）：**

- **画布后端 :10588 路由**（`src/routes/canvas/`，13 文件+3 子目录）：execute.ts、orchestrate.ts、storyboardPreview.ts、convert.ts、load.ts、save.ts、projects.ts、projectData.ts、_shared.ts、_simulate.ts、index.ts 等；子目录 `v2/`（events.ts、nodes.ts、branches.ts、health.ts、save-v2 等）、`review/`（approve.ts、reject.ts、score.ts）
- **画布后端领域库**（`src/lib/`）：canvasAssetSchema.ts、canvasEventStore.ts、canvasEventTypes.ts、canvasReducer.ts、canvasRelationalStore.ts ← **事件溯源核心，改造必读**
- **运行时**：`src/runtime/canvas-client.mjs`（+ iteration engine 在 src/runtime/）
- **socket**：`src/socket/index.ts`、`src/socket/routes/pipelineProgress.ts`
- **canvas_sync**：`src/routes/v1/sync/`（子目录，canvas_sync 同步路由）
- **分镜/镜头**：`src/routes/v1/shots/`、`src/routes/v1/director-desk/`、`src/routes/v1/pipeline/`
- **画布文档**：`docs/canvas-import-from-dir.md`、`docs/canvas-next-steps.md`、`docs/canvas-review-integration.md`、`docs/websocket-hooks.md`
- **API spec**：`specs/core-backend.openapi.yaml`（全核心后端 OpenAPI，非画布专属）
- **skills**：`src/skills/`（contract.ts 等，NodeTypeDecl 注册表）
- 未发现：任何 `flowgraph-v3*` 命名文件（扫描范围内）；`/context`、`/workflows` 下无画布直接相关文件（workflows 主要为 ltx/openclaw 工作流）

---

## 11. 给 lead 的开放问题

1. **FlowGraphV3 在哪？** 扫描范围内未发现 v3 schema 文件。FlowGraphV3 数据层是新写（swarm 任务）还是另有仓库/分支/目录（如 packages/ 下其他包）？
2. **NodeState 对齐**：前端 `cached` vs 后端 `skipped`——接入 V3 时统一为哪个？是否保留双枚举+映射？
3. **timeline 枚举冲突**：叙事时间线（1975/2000/2025/dream/flashback，前端已用）vs 自然时间（day/night/dusk/dawn，canvas_sync 已用）——建议拆成两个字段（如 `timeline` 叙事 + `timeOfDay` 自然），需裁决。
4. **VariantGroup 结构**：前端 parentNodeId 分组 vs 后端 phaseIndex+branchId+selectMode 分组——V3 以哪个为准？
5. **canvas:event 增量订阅**：feature flag `VITE_CANVAS_EVENT_REPLAY` 默认关。V3 改造是否直接切换为事件流为主通道（替代 graph:saved 全量 reload）？
6. **meta 时间戳类型**：前端 ISO string vs 后端 number ms，序列化边界需统一。
7. **Link.dataType**：后端实际值含 "output"（枚举外），前端 LinkDataType 5 枚举需要扩展还是后端收敛？
