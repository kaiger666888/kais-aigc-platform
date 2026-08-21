# Phase 55: 画布导航与规模 (Navigation & Scale) - Research

**Researched:** 2026-08-21
**Revised:** 2026-08-21（checker revision W3：Open Questions / Assumptions Log 补 RESOLVED 指针——全部决议落在 55-01..55-07 plans）
**Domain:** React Flow 画布导航/注册表对齐/LOD/分支 UI（packages/infinite-canvas 前端 + 少量 kap 后端 zone 表）
**Confidence:** HIGH（纯代码库研究——所有关键结论均直接读源码/跑脚本验证，无外部库引入）

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** 真相源对齐 = 镜像 + 契约测试——PIPELINE_PHASES 扩到 22 phase,以 khs `canvas_sync._PHASE_INDEX_MAP` 为唯一真相源,kap 侧固化镜像 + contract test(khs 改映射时测试变红);v2.0 / 53-D02 / 54-D02 同模式第三次复刻,零漂移史
- **D-02:** 泳道分组 = 创作阶段分组——沿用既有 `PHASE_GROUPS` 框架(research/story/production/post),新 phase 按创作语义归组(p035→story、p09b/p09c/p10c/p11*→production、p12*/p14/p15→post 之类),具体归组 planner 可调;与 Phase 54 泳道阻塞高亮同坐标系
- **D-03:** 未知 phase 兜底 = fallback zone + 断言——未知 phaseIndex 节点落入「未映射」zone + console.warn,fail-loud 但不崩;成功标准 1 的断言 = 全量 episode 导入后未映射区为空
- **D-04:** 词汇统一 = 单一注册表——zone 表(扩展后的 22-phase 注册表)作为前端 phase 词汇的唯一来源;Phase 54 泳道阻塞高亮、Phase 57 PORTAL-04 taxonomy 对齐都消费它,避免两套 phase 词汇漂移(ROADMAP 57 依赖注明的风险)

### Claude's Discretion
- **分镜层级浏览(NAV-02 未深讨)**——候选形态:StoryboardTimeline(3028 行,已有 `sceneNumOf`/场景色带地基)扩展 vs 画布内 zone 折叠组 vs 独立面板;镜头卡信息密度(shot_id/景别/运镜/时长/video_prompt/引用角色&场景缩略图——素材字段已由 v1.7 storyboard metadata 铺好);依 frontend-design 纪律先出 token 层设计(两级浏览的信息架构:场景行→镜头卡的展开/折叠语义)
- **LOD 默认可读(NAV-05)取舍**——keyFields 可读需 L2(≥0.6)但超大图(34160px)天然 fit-zoom ~0.05,现有 FITVIEW_MIN_ZOOM=0.4 保 L1;候选:提下限(超大图更只见局部)/每泳道缩放记忆/混合(默认 L1+一键放大到泳道 L2);**不可回归** LOD 体系既有修法(LodProvider+Context 跨阈值才算、迟滞 0.03、FITVIEW_MIN_ZOOM 下限——2026-08 月盲区修复的成果)
- **新资产落点(NAV-04)优先级**——视口中心 vs 事件源旁,何者优先/何时用哪个(有事件源时源旁、无时视口中心是最可能组合,planner 定;断言=坐标与视口/源距离有界)
- **搜索导航器(NAV-03)**——语义已清晰(结果列表+focusAssetNodeId 聚焦跳转+`/` 快捷键+不再隐藏非命中);索引范围(节点名/shot_id/prompt 摘要)与结果列表形态 planner 定
- **分支 UI(NAV-06)**——BranchPanel 已被 51-WRITE-04 删除,`selectBranchAsMain` 仍活在 canvasStore;重写形态(侧栏 vs 顶栏切换器)、多结局探索交互(预览分支 vs 直接切主线)planner 定;持久化语义沿用既有 store

### Deferred Ideas (OUT OF SCOPE)
None — 讨论未超出 phase 范围。(分镜层级/LOD+落点/分支 UI 三区未深讨,已列 Claude's Discretion,非新能力。)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NAV-01 | zone 表对齐 22 phase（补 p035/p09b/p09c/p10c/p11a*/p12a/p12b/p14/p15 映射与泳道分组；当前 13-phase 旧结构） | khs 真相源全量提取（§NAV-01 Truth Source）；kap 三张表现状+delta；contract test 先例 verify-schema-drift.ts 全文模式 |
| NAV-02 | 分镜层级浏览——场景→镜头两级；镜头卡呈现 shot_id/景别/运镜/时长/video_prompt/引用角色&场景缩略图 | extractShots 数据模型、StoryboardBoard 两级先例、ShotTree 导航树、字段缺口清单（§NAV-02） |
| NAV-03 | 搜索升级为导航器——结果列表 + 点击聚焦跳转（复用 focusAssetNodeId）+ `/` 快捷键；不再隐藏非命中节点 | 现搜索实现（隐藏式过滤）、focusAssetNodeId effect 全文、setCenter 机制、可索引字段清单（§NAV-03） |
| NAV-04 | 新资产节点落点修正——落在当前视口中心或事件源旁，不再随机坐标 | 随机散布唯一源头（onNewAsset handler）、socket payload 形状错配、事件源可得性（regen 调用点）、viewport API（§NAV-04） |
| NAV-05 | LOD 默认可读——fitView 后默认档提升到 keyFields 可读，或记忆每泳道缩放 | useLod 全文、keyFields L2-only 渲染、持久化 localStorage patch 语义、PhaseColumns pointer-events:none 现状（§NAV-05） |
| NAV-06 | 分支 UI 接通——复活/重写 BranchPanel 消费既有 branches store 与 selectBranchAsMain | 旧 BranchPanel git 档案、store/REST/V3 lossy shim 全链路、持久化缺口（§NAV-06） |

</phase_requirements>

## Summary

Phase 55 是纯 kap 侧（packages/infinite-canvas + 少量 src/routes/canvas 后端 zone 表）的画布导航升级，无新依赖、无 khs 修改（除 contract test 读文件对照）。研究覆盖了六个 NAV 需求的全部落点，最重要的五个发现：

1. **「zone 表」实际是三张表 + 一条数据链**，且存在系统性错位：khs 真相源 `_PHASE_INDEX_MAP` + `ZONE_PHASES`（22 活跃 phase，已用 Python 实跑验证）；kap 后端 `import-from-dir.ts` 的 `PHASE_DEFS` 是 13-phase 旧结构且 `phaseIndex = laneIndex+1`（p10 以后与 khs 编号系统性错一位以上）；前端 `PIPELINE_PHASES` 已是 W6 对齐的 19 条（缺 p09c/p12a/p12b 独立项）。**开发库现存全部图数据都是 pre-W6 编号**（实测 db2.sqlite：最大图 109 节点全在 phaseIndex 13=旧 p13，新编号下 13=p10b 已注销）——D-03 的 fallback zone 会真实承接大量存量节点，这是设计断言时必须正视的数据现实。
2. **NAV-02/03 的地基比预期厚**：`extractShots()` 已导出富 StoryboardShot 模型（shotId/景别/运镜/时长/prompt facets/首尾帧）；`StoryboardBoard.tsx` 已是场景→镜头两级网格（但数据源是已注销 p10b 的 JSON，陈旧风险）；`ShotTree.tsx` 已是挂载中的「集→场景→镜头」左树且带 setCenter 跳转与折叠。两级浏览大概率是**整合既有三处**而非新建。
3. **NAV-04 的随机散布源头唯一且小**：`FlowCanvas.tsx:217-224` 的 `onNewAsset` socket handler（`LAYOUT.NEW_NODE_X_MIN + Math.random()`），且它同时有 (a) 服务端 payload 形状错配（server 广播 `{node}`，client 解构 `{nodeId,data}`）、(b) 违反 WRITE-03 canonical 写回模式（直写派生缓存）两个既存问题——重写时一并收敛。khs 写回路径走 `graph:saved`→全量 reload→确定性布局引擎，不随机。
4. **NAV-05 的候选可行性清晰**：keyFields 仅 L2 渲染（`!isL1` 门）；`useCanvasPersistence` 的 localStorage patch 语义（`kais:canvas:v1:p{pid}:e{eid}`）可直接扩展存「泳道→zoom」记忆；PhaseColumns 叠加层目前 `pointerEvents:'none'` 纯装饰，做「聚焦本阶段」需要新增交互 affordance。任何方案都不得动 LOD 阈值/迟滞/FITVIEW_MIN_ZOOM 本体。
5. **NAV-06 有两个真缺口**：`selectBranchAsMain` 是 store-only **无持久化**（REST PATCH 端点已存在但没接）；V3 `graph.branches` 是有损 shim（只有 id/name/parentBranchId/createdAt，`toLegacyBranches` 把 status 硬编码 'active'）——重写 BranchPanel 前须先决定 status 真相落在哪。

**Primary recommendation:** 以「单一 22-phase 注册表模块（新文件，PIPELINE_PHASES/PHASE_GROUPS/import-from-dir PHASE_DEFS 全部改为消费它）+ verify-schema-drift 式契约测试」为 NAV-01 骨架；NAV-02 用 graph 派生（extractShots）数据 + StoryboardBoard 的两级视觉模式整合进 ShotTree/独立面板；NAV-03 重写搜索为结果列表导航器并删除 hidden 过滤；NAV-04 重写 onNewAsset 为 canonical 写回 + 源旁/视口中心落点；NAV-05 走「默认 L1 不变 + 每泳道 zoom 记忆 + 列聚焦」混合方案；NAV-06 重写 BranchPanel 并补 selectBranchAsMain 的 REST 持久化。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 22-phase 注册表 + 契约测试 | 前端共享层（constants/新 registry 模块） | kap 后端（import-from-dir 消费同一词汇） | 词汇单源是 D-04；渲染/布局/54 高亮/57 taxonomy 全消费 |
| zone/泳道数据写入 | kap 后端路由（import-from-dir） | khs canvas_sync（真管线数据，不改） | 图数据的 phaseIndex 由写入方落；本期只修 kap 侧 13-phase 旧表 |
| 分镜两级浏览 UI | 浏览器（infinite-canvas 组件） | — | 纯前端派生（graph + rawData），无新后端 |
| 搜索导航器 | 浏览器（FlowCanvas + store） | — | 客户端过滤 + fitView 跳转，复用 focusAssetNodeId |
| 新资产落点 | 浏览器（FlowCanvas socket handler） | kap 后端（node:created payload 形状） | 位置策略是客户端职责；事件源 id 已在 regen 调用点可得 |
| LOD 默认可读 | 浏览器（useLod 消费侧 + 持久化） | — | 不动 useLod 阈值本体；泳道记忆是持久化层扩展 |
| 分支 UI + 持久化 | 浏览器（新 BranchPanel） | kap 后端（branches PATCH REST 已存在） | store 语义已有；缺 REST 接线 |
| 契约测试执行 | kap 仓库 scripts（verify-phase-55） | khs 仓库（只读文件） | verify:* 先例全是 npx tsx 根脚本 |

## Standard Stack

### Core（全部既有，零新增安装）
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @xyflow/react | ^12.6.0 | 画布/viewport/fitView/setCenter/MiniMap | 全仓画布基座；focusAssetNodeId 与 ShotTree 跳转都靠它 |
| zustand | ^5.0.14 | canvasStore（focusAssetNodeId/branches/selectBranchAsMain） | 唯一 store 方案 |
| @kais/flowgraph-v3 | file:../flowgraph-v3 | V3 canonical 图 + 布局引擎 + zod | canonical = graph（WRITE-03 铁律） |
| react | ^19.1.0 | UI | 既有 |
| vitest | ^2.1.9 | 单测（纯函数：laneGeometry/registry/契约） | 既有 `npm test` |
| @playwright/test | ^1.61.0 | e2e + headless 探针 | 既有 test/e2e/tests/*.mjs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3（dev 探查） | node_modules 既有 | 直接读 db2.sqlite 验证图数据 phaseIndex 分布 | 验证脚本/断言「未映射区为空」的 fixture 导出 |
| dagre | ^3.0.0 | 「整理布局」按钮 | 已有 autoLayout.ts，本期不动 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|-----------|
| 自建结果列表导航器 | cmdk 等命令面板库 | 引入新依赖违反最小化；93 镜规模自建简单列表足够（catppuccin 主题内联样式是仓库惯例） |
| localStorage 泳道 zoom 记忆 | graph.meta（服务端持久化） | localStorage 已有 P17 语义且 key 按集隔离，零后端改动；meta 方案跨设备但动 save-v2 契约，超范围 |

**Installation:** 无——本期零新增依赖。

**Version verification:** 版本号直接读自 `packages/infinite-canvas/package.json`（本会话验证），无需 registry 查询。

## Package Legitimacy Audit

本期**不安装任何外部包**（纯既有依赖上的前端/后端改造）——无需 slopcheck 审计。若 planner 后续引入新包，须回补本节。

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─ khs 真相源（只读）─────────────────────────┐
                        │ canvas_sync.py::_PHASE_INDEX_MAP (24 keys)  │
                        │ canvas_graph.py::ZONE_PHASES (25 有序 zone)  │
                        │ pipeline/phases/__init__.py (22 活跃 phase)  │
                        └──────┬───────────────────────────────────────┘
                               │ 被读取（regex 解析，脆弱即信号）
                               ▼
        ┌─ kap 契约层 ──────────────────────────────────────────────┐
        │ scripts/verify-phase-55.ts（或 canvas/verify-phase-map.ts）│
        │  断言: kap 22-phase 镜像 ≡ khs _PHASE_INDEX_MAP            │
        └──────┬────────────────────────────────────────────────────┘
               │ 守护
               ▼
┌─ kap 前端注册表（D-04 单源）──────────────────────────────────────┐
│ 新 registry 模块（22 phase：code/sortKey/phaseIndex/group/sub）     │
│  ├─ PIPELINE_PHASES（pipeline/model.ts 改为消费/重导出）            │
│  ├─ PHASE_GROUPS（constants.ts 改为从注册表派生或对齐）             │
│  ├─ import-from-dir.ts PHASE_DEFS（后端 13→22，index 用 khs 编号） │
│  └─ 下游: PhaseColumns 叠加层 / PipelineStateMachine 泳道 /        │
│          computePhaseGridPlan / (54 泳道阻塞高亮 / 57 taxonomy)    │
└──────────────────────────────────────────────────────────────────┘

图数据流（画布导航消费）:
 khs canvas_sync ─save-v2→ graph:saved socket ─→ loadCanvas 全量 reload
 kap import-from-dir ─POST→（zone+summary+artifact 树, phaseIndex）
        └──── 都落 o_agentWorkData.canvasGraph ─→ load-v2 (REST)
                        │
                        ▼
        adapter (V2→V3) ─→ store.graph (canonical)
          ├─ buildPhaseCatalog（zone 节点 phaseIndex→name，zone 胜）
          ├─ rawDataByNodeId（白名单外富字段穿透）
          └─ useLayout ─→ 布局引擎（phase grid x + 模态泳道 y）
                ├─ laneGeometry.computePhaseColumns（竖向阶段列，PHASE_GROUPS 配色）
                ├─ LodProvider（唯一 viewport 订阅者 → LOD 0/1/2）
                └─ FlowCanvas 渲染 + MiniMap + ShotTree 左树

交互流（本期新增）:
 `/` 键 → 搜索导航器面板 → 结果列表（按场景分组）→ 点击
        → setFocusAssetNodeId(id) → FlowCanvas effect
        → fitView({nodes:[{id}], maxZoom:1.5}) + 高亮 1.5s
 node:created socket →（重写）canonical 写回 + 事件源旁/视口中心落点
 PhaseColumn 点击（新 affordance）→ fitView 该阶段节点 + 恢复记忆 zoom
 BranchPanel（重写）→ selectBranchAsMain →（补）PATCH /v2/branches 持久化
```

### Recommended Project Structure
```
packages/infinite-canvas/src/
├── components/
│   ├── pipeline/model.ts          # NAV-01: 注册表改从新模块消费
│   ├── canvas/ShotTree.tsx        # NAV-02/03: 已有左树（集→场景→镜头）
│   ├── canvas/PhaseColumns.tsx    # NAV-05: 加交互 affordance（现 pointer-events:none）
│   ├── storyboard/StoryboardBoard.tsx  # NAV-02: 两级视觉先例（数据源有陈旧风险）
│   ├── BranchPanel.tsx            # NAV-06: 重写（51-04 已删，git 档案 7ec2e605）
│   ├── FlowCanvas.tsx             # NAV-03/04: 搜索 + onNewAsset 重写落点
│   └── __tests__/                 # vitest
├── constants.ts                   # NAV-01: PHASE_GROUPS 对齐（1-18 已覆盖，分组核对）
├── hooks/
│   ├── useLod.ts                  # NAV-05: 不可回归本体；消费侧扩展另做
│   └── useCanvasPersistence.ts    # NAV-05: PersistedCanvasState 扩展泳道 zoom 记忆
├── v3/adapter.ts                  # NAV-01: buildPhaseCatalog（zone→目录）
└── store/canvasStore.ts           # NAV-03/06: focusAssetNodeId / branches / selectBranchAsMain
src/routes/canvas/v2/
├── import-from-dir.ts             # NAV-01: PHASE_DEFS 13→22（后端 zone 表）
└── branches.ts                    # NAV-06: PATCH 已存在，前端接线即可
scripts/
└── verify-phase-55.ts             # NAV-01: 契约测试（verify-schema-drift 模式）
```

### Pattern 1: 镜像 + 契约测试（第三次复刻，D-01）
**What:** kap 侧固化 22-phase 镜像；测试用针对性正则读 khs Python 源码解析 dict，与镜像逐项 diff。
**When to use:** khs 改 `_PHASE_INDEX_MAP`（拆 phase/改编号）时测试变红。
**Example:**
```typescript
// Source: scripts/canvas/verify-schema-drift.ts（既有先例，Phase 46 VERIFY-04）
const SIBLING_ROOT = process.env.KAIS_HERMES_SKILLS_PATH ?? "/data/workspace/kais-hermes-skills";
const PYTHON_SCHEMA_PATH = path.join(SIBLING_ROOT, "skills/kais-movie-pipeline/pipeline/phases/_manifest.py");
// ⚠️ 正则解析的脆弱性是有意的契约漂移信号：解析到 0 个条目即 FAIL——
// 不要「修复」为更健壮的解析器，脆弱性即契约信号（plan.md §5）。
function parsePythonSchema(source: string): Map<string, string[]> { /* depth-count + regex */ }
```
NAV-01 版本：解析 `plugins/kais_aigc/canvas_sync.py` 的 `_PHASE_INDEX_MAP`（条目形如 `"p09b": 10,`）+ `canvas_graph.py` 的 `ZONE_PHASES`（`(prefix, label, group)` 三元组，给归组与 lane 内顺序），与 kap 注册表比对。khs 侧已有同向测试 `test_phase_registry_canvas_map_consistency.py`（PHASE_REGISTRY ↔ 三张 map），kap 侧测试与之互补而非重复。

### Pattern 2: canonical 写回（WRITE-03，NAV-04 必须遵守）
**What:** socket/事件写入一律走 store canonical action（applyGraphTransform/updateAssetMeta），派生 RF 缓存只由 graphToViewModel 重建。
**When to use:** 重写 `onNewAsset` 时——现状直写 `setNodes` 派生缓存是 51 之前的旧模式。

### Pattern 3: fail-loud 不崩（D-03）
**What:** 未知 phaseIndex → 「未映射」zone + console.warn，不 throw。先例：adapter 的 zod 修复环（丢弃坏项、保留图、发 warning）；`derivePipelineModels` 的 extras 追加（注册表外 phaseIndex 追加为兜底阶段，防数据丢失）。
**When to use:** NAV-01 的 fallback zone 直接扩展 derivePipelineModels 的 extras 机制即可。

### Anti-Patterns to Avoid
- **两套 phase 词汇**：新建注册表又不删旧表（PIPELINE_PHASES 内联 19 条 + import-from-dir 13 条并存）= D-04 明令禁止的漂移源。改完必须让所有消费方走单源。
- **动 LOD 阈值/迟滞/FITVIEW_MIN_ZOOM 本体**：08 月盲区修复成果；NAV-05 只能在消费侧与持久化层做。
- **搜索继续 hidden 过滤**：93 镜下隐藏式搜索让画布「闪空」；NAV-03 明确要求删除该行为（FlowCanvas:608-626 的 useEffect 整段重写）。
- **onNewAsset 直写派生缓存 + 忽略服务端位置**：见 Pitfall 3。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 聚焦跳转 | 自写 viewport 动画/居中数学 | `reactFlow.fitView({nodes:[{id}], maxZoom, duration})` 或 `setCenter(cx,cy,{zoom})` | focusAssetNodeId effect（FlowCanvas:700-721）与 ShotTree:137 已验证两条路径 |
| 视口持久化 | 自写 storage 序列化 | `useCanvasPersistence` 的 `saveCanvasState` patch 语义 + `canvasStateKey(pid,eid)` | P17 既有，损坏 JSON 容错、集间隔离 |
| 阶段列几何 | 自写 x 带计算 | `computePhaseColumns`（laneGeometry.ts） | median-x 抗散点、PHASE_GROUPS 配色、已有单测 |
| 分镜数据派生 | 自写 graph 遍历 | `extractShots(graph, rawDataByNodeId)`（StoryboardTimeline.tsx:302，已导出已测） | shotKey 去重（storyboardTypeRank）、P11 video/I-frame 反查、音轨映射全铺好 |
| 契约测试 harness | 自写 assert/汇总 | `scripts/canvas/lib/verify-harness.ts` 的 `createHarness()` | Phase 46 收敛过的结果收集/退出码模式 |

**Key insight:** 本期几乎所有「新能力」都有 70% 完成度的既有积木（ShotTree/extractShots/StoryboardBoard/focusAssetNodeId/branches REST）——planner 的主要工作是**整合与补缺**，不是新建。

## Runtime State Inventory

> 本期非 rename/refactor phase，但 NAV-01 涉及 phaseIndex 语义变更（13-phase 旧编号 → 22-phase 新编号），存量运行态数据受影响，故填本表。

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `data/db2.sqlite` `o_agentWorkData`（key='canvasGraph'）现存 ~18 个图；**实测全部为 pre-W6 编号**（如最大图 109 节点全 phaseIndex 13=旧 p13；新编号 13=p10b 已注销；1782917851431 等图有 10-13 档旧编号节点） | 代码编辑（fallback zone 承接）或数据迁移（backfill 重映射 10→11/11→14/12→15/13→16）——**planner 必须显式裁决**（见 Open Questions Q1） |
| Live service config | dev server 9876 + 10588 均运行中（内存态图缓存无需迁移；重载即新逻辑） | 无 |
| OS-registered state | 无 | 无 |
| Secrets/env vars | `KAIS_HERMES_SKILLS_PATH`（契约测试 env，默认值即可） | 无 |
| Build artifacts | 无（纯 TS/前端，tsc -b 即时编译） | 无 |

## Common Pitfalls

### Pitfall 1: 存量图 pre-W6 编号 vs 新注册表的「未映射」误报
**What goes wrong:** 22-phase 注册表上线后，所有旧图的 phaseIndex 10-13 节点（旧 p10-p13）落「未映射」zone——因为新编号 10=p09b/p09c、11=p10、12=p10c、13=p10b(注销)、14=p11、15=p12、16=p13。
**Why it happens:** kap import-from-dir 历史写入 `phaseIndex=laneIndex+1`（13-phase 序），khs W6 重编号后从未回填 canvas graph。
**How to avoid:** D-03 fallback zone 必须真实建成（不只是 console.warn）；成功标准 1 的断言口径限定「**导入**全量 episode 数据后」（新写入数据），存量图走 fallback 不算失败。若要治本需 Phase-50 式 backfill（不建议本期做，除非用户明确要求）。
**Warning signs:** 打开旧项目（如 1782745975908）看到大片「未映射」zone。

### Pitfall 2: `p11a0` 前缀折叠
**What goes wrong:** 22 个活跃 phase 中 `p11a0_iframe_qc` 与 `p11a_preview_clips` 经 `_PHASE_PREFIX_RE = ^(p\d+[a-z]?)` 都折叠为前缀 `p11a`（phaseIndex 14）——注册表若按「phase id」逐条建 22 项会出现两个 p11a 撞 lane。
**Why it happens:** 前缀正则只吃一位字母后缀。
**How to avoid:** 镜像按**前缀**建（21 个去重前缀）或按 22 个 phase id 建但共享 lane + sub 标记（PIPELINE_PHASES 既有 `sub: true` 模式，如 P09b/P10c/P11c 先例）；p11a0 是 advisory micro-gate（条件帧自动审核，任何失败 passthrough），语义上适合 sub=true。
**Warning signs:** 契约测试对不上 khs 条目数（24 keys vs 22 registry vs 21 前缀）。

### Pitfall 3: node:created payload 形状错配（NAV-04 落点重写时必踩）
**What goes wrong:** 服务端 `broadcastToProject(projectId, "node:created", { node })`（nodes.ts:90/151），客户端 `socket.on('node:created', (payload: { nodeId, data }) => ...)`（useCanvasSocket:153）解构出 undefined。
**Why it happens:** 两侧从未对齐过（该路径低频）。
**How to avoid:** NAV-04 重写 handler 时统一 payload（建议 server 形状 `{node}` 或双发），并借机走 canonical 写回 + 用 payload 里的位置（服务端 upsert 时节点带 position）。
**Warning signs:** 新节点 id=undefined 或随机位置。

### Pitfall 4: V3 branches 有损 shim 吃掉 status
**What goes wrong:** 重写 BranchPanel 消费 `store.branches` 时发现所有分支 status 都是 'active'——`toLegacyBranches`（canvasStore:281-292）硬编码。
**Why it happens:** FlowGraphV3.branches schema 只有 id/name/parentBranchId/createdAt；status 活在 V2 事件存储但 migrate 不带。
**How to avoid:** NAV-06 先决定 status 真相源：(a) V3 schema 扩展（动 flowgraph-v3 包）或 (b) REST 拉取 V2 branches 合并进 store（`graph.branches.length > 0 ? toLegacyBranches : state.branches` 的注释显示 REST 路径已预留——canvasStore:431-432）。(b) 改动最小。
**Warning signs:** 升主线后刷新回弹。

### Pitfall 5: selectBranchAsMain 无持久化
**What goes wrong:** 点击「升主线」toast 成功，刷新后丢失。
**Why it happens:** store 实现只调 updateBranch（store 内），未调 `updateBranch` REST（canvasApi:594 已存在，PATCH /api/canvas/v2/branches）。
**How to avoid:** 成功标准 5 明确「可切换主线**并持久化**」——接线 REST + 失败回滚 toast（selectWinner 的乐观更新+回滚是仓库范式）。

### Pitfall 6: StoryboardBoard 数据源是已注销 phase
**What goes wrong:** NAV-02 若直接复用 `GET /api/v1/storyboard`（StoryboardBoard 现数据源），新项目拿不到板——该 JSON 由 **p10b** 组装，而 p10b 已从 22-phase 注册表注销。
**Why it happens:** 路由 tier 链（o_assets.meta → canvas_nodes.data → 文件 → 空）依赖历史产物。
**How to avoid:** 两级浏览数据走 graph 派生（extractShots）为主；board JSON 只作兜底/对照。

### Pitfall 7: 搜索框与 `/` 快捷键的焦点抢占
**What goes wrong:** 全局 keydown 监听 `/` 时，用户在输入框里打字含 `/` 会误触导航器。
**How to avoid:** 监听里排除 `e.target` 为 input/textarea/contentEditable（Escape handler FlowCanvas:726-735 的守卫写法先例）；`/` 打开导航器并自动 focus 搜索框，Esc 关闭。

## Code Examples

### NAV-01 真相源全量（本会话 Python 实跑验证）
```python
# /data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/__init__.py
PHASE_REGISTRY  # 恰好 22 个活跃 phase（实测输出）：
# ['p01_hook_topic','p02_outline','p03_script_audit','p035_dramatic_polish',
#  'p04_character_design','p06_spatio_temporal_script','p07_scene_generation',
#  'p08_scene_selection','p09_shot_breakdown','p09b_shot_audit','p09c_storyboard_board',
#  'p10_voice','p10c_voice_audit','p11a0_iframe_qc','p11a_preview_clips',
#  'p11b_final_render','p11c_video_qc','p12a_timeline_composition',
#  'p12b_audio_composition','p13_delivery','p14_quality_audit','p15_feedback']
# 注意：无 p05/p10b/p11/p12（单体）——已注销/合并
```

```python
# canvas_sync.py:2321 _PHASE_INDEX_MAP（唯一真相源，24 keys 含已注销）
{"p01":1,"p02":2,"p03":3,"p04":4,"p05":5,"p06":6,"p07":7,"p08":8,"p09":9,
 "p035":3,                     # P03.5 戏剧事件打磨（共享 p03 lane）
 "p09b":10,"p09c":10,          # 镜头审计 / 分镜故事板（共享 10）
 "p10":11,"p10c":12,"p10b":13, # p10b 快速预览（已注销但保留编号）
 "p11":14,"p11a":14,"p11b":14,"p11c":14,
 "p12":15,"p12a":15,"p12b":15, # p12 拆 p12a 时间线 + p12b 音频
 "p13":16,"p14":17,"p15":18}
```

```python
# canvas_graph.py:741 ZONE_PHASES（有序，lane 内顺序权威）——25 条含已注销：
[("p01","P01 · 选题+钩子","research"),("p02","P02 · 大纲","research"),
 ("p03","P03 · 剧本+审计","story"),("p035","P03.5 · 戏剧事件打磨","story"),
 ("p04","P04 · 角色设计","story"),("p05","P05 · 痛点发现","story"),
 ("p06","P06 · 运镜+终审","production"),("p07","P07 · 视觉+风格化","production"),
 ("p08","P08 · 场景选择","production"),("p09","P09 · 分镜拆解","production"),
 ("p09b","P09b · 分镜审计","production"),("p09c","P09c · 分镜故事板","production"),
 ("p10","P10 · 语音","post"),("p10c","P10c · 语音审计","post"),
 ("p10b","P10b · 快速预览","post"),("p11","P11 · 视频渲染","post"),
 ("p11a","P11a · 预览片段","post"),("p11b","P11b · 最终渲染","post"),
 ("p11c","P11c · 视频质检","post"),("p12","P12 · 合成","post"),
 ("p12a","P12a · 时间线合成","post"),("p12b","P12b · 音频合成","post"),
 ("p13","P13 · 交付","post"),("p14","P14 · 质量审计","post"),("p15","P15 · 跨集反思","post")]
```

**kap 侧 delta（22 活跃 phase 口径）：**
| 表 | 现状 | 目标 delta |
|----|------|-----------|
| 前端 `PIPELINE_PHASES`（pipeline/model.ts:46，19 条，index 已 W6 对齐） | 缺 3 项 | +P09c（production, idx10, storyboard 类型）/ +P12a / +P12b（post, idx15）；p11a0 以 sub 并入 P11a lane 或单列 sub 条目；顺带把注释「17 阶段」改准 |
| 后端 `PHASE_DEFS`（import-from-dir.ts:88，13 条，`phaseIndex=laneIndex+1` 错位） | 缺 9 项 + index 全错 | 22 条 + index 换 khs 编号 + `FILE_TO_PHASE`/`ASSET_DIR_TO_PHASE` 增补 p09b/p09c/p12a/p12b/p14/p15 目录词 |
| `PHASE_GROUPS`（constants.ts:324，1-18 全覆盖） | 已覆盖 | 仅核对分组语义（p05→story 保留无害；10 已标 production） |

### NAV-02 数据模型（extractShots 既有产出，StoryboardTimeline.tsx:100-357）
```typescript
// 已有字段（graph + rawData 派生，可直接喂两级浏览）：
interface StoryboardShot {
  node: AssetNodeV3; shotId: string; durationS: number; thumbnail: string | null
  cameraMovement?: string; framing?: string; composition?: string; pacing?: string   // 景别/运镜
  promptText?: string; promptFacets?: { subject?, action?, camera?, scene?, lighting?, style? }
  videoUrl?: string | null; firstFrame?: string | null; lastFrame?: string | null
  startFrameDesc?: string; endFrameDesc?: string          // P09 文字首尾帧
  shotKey: string                                          // 去重键（S01_B01 式）
}
// 场景分组既有手法：
function sceneNumOf(shotId: string): number {   // StoryboardTimeline.tsx:1770
  const m = shotId.match(/s?0*(\d+)/i); return m ? Number(m[1]) : 0
}
// ShotTree.tsx:40 的场景前缀法（分隔符 [.\-_/] 前段）是另一套——两种口径 planner 统一
```
镜头卡缺口字段：`video_prompt`（raw.video_prompt / raw.ltx_prompt，RAW_FIELD_LABELS:357 已有标签映射）与「引用角色&场景缩略图」（characters[] 是 string 名单；缩略图须回查 scope='global' 的 character/scene 节点，ShotTree「全局资产」栏同源）。

### NAV-03 focusAssetNodeId effect（FlowCanvas:700-721，复用勿改语义）
```typescript
useEffect(() => {
  if (!focusAssetNodeId) return
  const target = (nodes as any[]).find((n) => n.id === focusAssetNodeId)
  if (!target) { showToast('该资产尚未放置在画布上', 'info'); /* 清空 */ return }
  setSelectedNode(target); setDetailNode(target)          // 定位即聚焦+开详情
  const tFit = setTimeout(() => {
    reactFlow.fitView({ nodes: [{ id: focusAssetNodeId }], duration: 600, maxZoom: 1.5 })
  }, 50)
  const tClear = setTimeout(() => setFocusAssetNodeId(null), 1500)
  return () => { clearTimeout(tFit); clearTimeout(tClear) }
}, [focusAssetNodeId, /* ... */])
```
现搜索（要删除的隐藏式过滤，FlowCanvas:608-626）：debounce 200ms → `setNodes(nds => nds.map(n => ({...n, hidden: !matches})))`，匹配 label/description/prompt。

### NAV-04 随机落点现状（FlowCanvas:217-224，重写目标）
```typescript
onNewAsset: (nodeId, data) => {
  setNodes((nds) => [...(nds as any[]), {
    id: nodeId, type: 'asset',
    position: { x: LAYOUT.NEW_NODE_X_MIN + Math.random() * LAYOUT.NEW_NODE_X_RANGE,
                y: LAYOUT.NEW_NODE_Y_MIN + Math.random() * LAYOUT.NEW_NODE_Y_RANGE },
    data,
  }])
}
// 事件源可得性：regen 调用点 NodeDetailPanel:675 — executeNode(projectId, episodesId, asset.id, ...)
// 视口中心：reactFlow.screenToFlowPosition({x: window.innerWidth/2, y: window.innerHeight/2})
//          或 viewport 直接换算（navHistory 的 getViewport 先例，FlowCanvas:349-355）
```

### NAV-05 持久化扩展点（useCanvasPersistence.ts 既有 patch 语义）
```typescript
export interface PersistedCanvasState {
  viewport?: Viewport; selectedNodeId?: string | null
  expandedStacks?: string[]; expandedTexts?: string[]
  // NAV-05 候选扩展：laneZoom?: Record<number, number>   // phaseIndex → 记忆 zoom
}
export function canvasStateKey(projectId, episodesId) {
  return `kais:canvas:v1:p${projectId}:e${episodesId}`     // P17 集间隔离
}
```
LOD 消费现状（不可回归本体，useLod.ts 全文已读）：`LOD_L0_MAX=0.22 / LOD_L1_MAX=0.6 / LOD_HYSTERESIS=0.03 / FITVIEW_MIN_ZOOM=0.4`；LodProvider 是唯一 viewport 订阅者（跨阈值才 setLevel）；keyFields 渲染门在 AssetCardNode:638+（`!isL1` 才渲染，即仅 L2）。

### NAV-06 selectBranchAsMain 现状（canvasStore:975-991，缺持久化）
```typescript
selectBranchAsMain: (branchId) => {
  const { branches, updateBranch, showToast } = get()
  const target = branches.find((b) => b.id === branchId)
  if (!target) { showToast('分支不存在', 'error'); return }
  branches.forEach((b) => {           // ⚠️ 只改 store，无 REST 调用
    if (b.id === branchId) updateBranch(b.id, { status: 'active' })
    else if (b.status === 'active') updateBranch(b.id, { status: 'archived' })
  })
  showToast(`已升主线: ${target.label}`, 'success')
}
// REST 已备：PATCH /api/canvas/v2/branches（branches.ts:81）+ canvasApi.updateBranch（:594）
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 13-phase zone 表（import-from-dir laneIndex+1） | khs W6 唯一 phaseIndex（22 活跃 phase） | khs W6 commit 8445666（2026-08-06）；前端 model.ts 2026-08-16 P0-2 已对齐 | 后端 zone 表是最后一块错位；本期收敛 |
| 搜索=隐藏非命中 | 导航器=结果列表+聚焦跳转 | 本期 NAV-03 | 93 镜规模下隐藏式不可用 |
| BranchPanel（7ec2e605 引入） | 51-WRITE-04 删除（372625cb，2026-08，-3,317 行 12 文件） | 51-04 | NAV-06 在干净地基重写；git 历史即档案 |
| zone 节点承载分区 | V3 泳道带（LaneBands）+ 竖向 PhaseColumns 叠加层；adapter 丢弃 zone 实体仅取目录 | P8/step5 | 「zone 表」≠画布上画 zone 框——是注册表词汇 + PhaseColumns 渲染 |
| dagre 全图布局（「整理」按钮） | phase-grid 布局引擎（useLayout + flowgraph-v3） | P7/P8/P9/P11 | 新节点 reload 后由引擎确定性落位（phase 列 + 模态泳道行） |

**Deprecated/outdated:**
- `model.ts` 头注释「17 阶段」与实际 19 条不符（历史注释漂移，扩表时顺手修正）
- `StoryboardBoard` 数据源 p10b JSON（phase 已注销）
- `placeAssetOnCanvas`（canvasApi:1073-1080）TODO 空壳——资产中心「放置」非真实流，NAV-04 不必覆盖

## Assumptions Log (A1–A5 RESOLVED 2026-08-21)

| # | Claim | Section | Risk if Wrong | Resolution |
|---|-------|---------|---------------|------------|
| A1 | 「93 镜/34160px」真实项目图在生产库而非 dev db2（dev 库实测最大 storyboard 数 40，无 post-W6 编号图） | Summary/NAV-01 | 断言 fixture 须从生产/运行中服务导出；若 dev 库即全部数据，「全量导入」断言需先造数据 | (RESOLVED) → 55-03 Task 3 以合成 22-phaseIndex fixture 作自动化镜像（零依赖生产库）；生产全量导入的「未映射区为空」断言归 55-VALIDATION Manual-Only 表（UAT 领取） |
| A2 | p11a0 建议以 sub=true 并入 P11a lane 展示（而非独立 23rd 条目）——依据是其 advisory micro-gate 语义与 P09b/P11c 先例，非用户明示 | NAV-01/Pitfall 2 | 若用户想单列，注册表条目数与展示形态变化（低风险） | (RESOLVED) → 55-01 phaseRegistry 以 sub:true 折叠 p11a0 入 P11a lane（55-03 后端 PHASE_DEF_MAP 消费同语义）——落地如建议 |
| A3 | 存量 pre-W6 图不做 backfill、靠 fallback zone 承接（成功标准口径=「导入后」）——依据 D-03 措辞推断，用户未明示 | NAV-01/Pitfall 1 | 若用户预期旧图也全对齐，需追加 Phase-50 式迁移计划（工作量 +1 plan） | (RESOLVED) → 不 backfill（ROADMAP orchestrator ruling，见 Open Questions Q1）；55-03 Task 3 反向对照用例（phaseIndex 99 → 1 未映射）锁定兜底承接 + 断言口径限定「导入后」 |
| A4 | 搜索索引范围建议 label/shot_id/prompt 摘要 + raw 关键字段（CONTEXT 列为 planner 定） | NAV-03 | 索引过宽拖慢 93 镜过滤（客户端 300+ 节点遍历仍 <10ms，低风险） | (RESOLVED) → 55-04 Task 1 deriveSearchResults 落地：data.label/shot_id/prompt/description + raw.video_prompt/ltx_prompt 穿透 + 200 条截断保护 |
| A5 | NAV-06 status 真相建议走 REST 合并（V2 事件存储）而非扩 V3 schema——最小改动推断 | NAV-06/Pitfall 4 | 若选 V3 扩展则动 flowgraph-v3 包 + zod 契约（范围扩大） | (RESOLVED) → 55-06 走 V2 事件流：PATCH branch_upsert → branch:updated 回放 applyBranchUpsert 合并 status，不动 flowgraph-v3 schema |

## Open Questions (RESOLVED 2026-08-21)

> 全部四个开放问题已在 plan 期裁决并落到具体 plan/task；以下保留原研究记录 + 逐条 RESOLVED 指针。

1. **存量 pre-W6 图是否 backfill？**
   - What we know: dev db2 全部图是旧编号；新注册表下其 10-13 档节点落「未映射」。
   - What's unclear: 用户预期「旧项目打开也对」还是「新导入对即可」。
   - Recommendation: 默认不 backfill（D-03 fallback 承接 + 断言限定新导入）；在 plan 里留一个显式 checkpoint 让用户裁决（A3）。
   - **(RESOLVED) → 55-03（A3）**：不 backfill——ROADMAP orchestrator ruling 确认；存量图走 D-03 fallback zone 承接，断言口径限定「导入后」。落地于 55-03 Task 3（合成 22-phase fixture 零未映射 + 反向对照 99→1 未映射）；无需用户 checkpoint。
2. **NAV-02 两级浏览的宿主形态**（CONTEXT 列为 discretion）
   - What we know: 三处既有积木（StoryboardTimeline 3028 行重 / StoryboardBoard 两级但数据源陈旧 / ShotTree 轻树无卡片）。
   - What's unclear: 用户想要的「镜头卡信息密度」落在哪里（画布内 vs 独立面板 vs 增强左树）。
   - Recommendation: graph 派生数据 + ShotTree 增强为「树+镜头卡预览」或独立 SceneShotPanel；StoryboardBoard 视觉模式复用、数据源弃用（Pitfall 6）。前端设计纪律要求先出信息架构设计步。
   - **(RESOLVED) → 55-02**：独立面板 SceneShotBrowser——graph 派生（extractShots 增强 videoPrompt/referencedAssets）+ ViewModeButton viewMode='scene_shots' 进入；场景口径统一 sceneNumOf；StoryboardBoard 视觉模式复用、数据源弃用（Pitfall 6 遵守）。
3. **NAV-05 混合方案的具体交互**
   - What we know: 纯提下限不可行（0.6 下 34160px 图只见 ~2% 宽度）；泳道记忆 + 列聚焦可行（PhaseColumns 需加交互）。
   - What's unclear: 「聚焦本阶段」affordance 放哪（列头点击 vs 左树 vs 工具栏）。
   - Recommendation: PhaseColumns 列头可点击（zoom 记忆恢复）+ ShotTree 场景行聚焦作为并列入口；默认 fitView 行为完全不动。
   - **(RESOLVED) → 55-05**：PhaseColumns 列头可点「聚焦本阶段」（laneZoom 记忆恢复，下限 0.6）+ ShotTree 场景行聚焦并列入口；默认 fitView 行为与 FITVIEW_MIN_ZOOM=0.4 完全不动（LOD 红线测试钉死）。
4. **`node:created` payload 统一方向**（server `{node}` vs client `{nodeId,data}`）
   - What we know: 现状错配；该事件只在 POST /nodes 与 /nodes/batch 新增时广播。
   - Recommendation: client 适配 server `{node}`（后端零改动优先），handler 重写为 canonical 写回。
   - **(RESOLVED) → 55-04**：client 适配 server `{node}`（后端零改动）——55-04 Task 3：useCanvasSocket payload 修正 + adaptV2Node 节点级提炼 + addNodeFromSocket canonical 写回（幂等 + 有界落点）。

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| khs repo（只读） | NAV-01 契约测试 | ✓ | worktree 当前 HEAD | `KAIS_HERMES_SKILLS_PATH` env 重定向 |
| node | 全部 | ✓ | v24.13.0 | — |
| dev server | e2e/探针 | ✓ 运行中 | 9876 与 10588 双实例 | `npm run dev` 起本地 |
| vitest | 单测 | ✓ | 2.1.9（infinite-canvas devDeps） | — |
| playwright chromium | e2e/截图探针 | ✓ | 1.61（test-results/ 有历史产物） | — |
| data/db2.sqlite | 断言 fixture 导出 | ✓ | — | 生产库/运行中服务导出 |
| python3 | （仅本次研究验证用） | ✓ | — | 契约测试是 TS regex 解析，不需要 python |

**Missing dependencies with no fallback:** 无。
**Missing dependencies with fallback:** 无。

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.1.9（单测）+ @playwright/test 1.61（e2e）+ 根仓 verify-phase-*.ts（npx tsx 契约脚本） |
| Config file | packages/infinite-canvas 内 vite.config.ts（vitest 走默认 + jsdom）；playwright.config.mjs（baseURL localhost:9876, workers 1） |
| Quick run command | `cd packages/infinite-canvas && npx vitest run src/components/__tests__` |
| Full suite command | `cd packages/infinite-canvas && npm test && npm run test:e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| NAV-01 | 契约：kap 22-phase 镜像 ≡ khs _PHASE_INDEX_MAP（+ZONE_PHASES 归组/顺序） | contract | `npx tsx scripts/verify-phase-55.ts` | ❌ Wave 0（模式复制 verify-schema-drift.ts） |
| NAV-01 | 未映射兜底：未知 phaseIndex → fallback 条目 + warn，不 throw | unit | `npx vitest run src/components/pipeline` | ❌ Wave 0（derivePipelineModels extras 扩展测试） |
| NAV-01 | 导入断言：新导入图无未映射节点 | integration（vitest + db fixture） | `npx vitest run src/v3/__tests__/adapter.test.ts -t phase` | 部分（adapter.test.ts 在，断言新增） |
| NAV-02 | 场景分组 + 镜头卡字段派生（shot_id/景别/运镜/时长/video_prompt） | unit | `npx vitest run src/components/__tests__/StoryboardTimeline.shotKey.test.ts` | 部分（shotKey 测试在；新字段断言新增） |
| NAV-03 | 搜索结果列表派生 + 点击 setFocusAssetNodeId；hidden 过滤已删 | unit（列表派生纯函数）+ e2e | `npx vitest run src/components/__tests__` / `npm run test:e2e -- phase55` | ❌ Wave 0 |
| NAV-04 | 落点有界：新节点坐标 ∈ 视口中心 R 内 或 源节点 R 内 | unit（纯函数 placeNewAsset(centerOrSource)） | `npx vitest run src/components/__tests__/placeNewAsset.test.ts` | ❌ Wave 0 |
| NAV-05 | 泳道 zoom 记忆持久化/恢复；LOD 阈值/迟滞回归守卫 | unit | `npx vitest run src/hooks/__tests__/canvasState.test.ts` + 既有 useLod 断言 | 部分（canvasState.test.ts 在） |
| NAV-06 | selectBranchAsMain → REST PATCH + 乐观/回滚；BranchPanel 渲染 branches | unit | `npx vitest run src/store/__tests__/` | 部分（store 测试目录在，新用例新增） |

### Sampling Rate
- **Per task commit:** `cd packages/infinite-canvas && npx vitest run <touched dirs> && npx tsc -b --pretty`
- **Per wave merge:** `npm test`（全量 vitest）+ `npm run verify:phase-55`
- **Phase gate:** 全量 vitest + verify-phase-55 契约绿 + playwright 冒烟（搜索跳转/落点/泳道聚焦）后才 `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `scripts/verify-phase-55.ts` — NAV-01 契约（复制 verify-schema-drift 模式 + verify-harness）
- [ ] `src/components/__tests__/phaseRegistry.test.ts`（或 pipeline/ 下）— 22 条完整性 + fallback zone + 分组覆盖
- [ ] `src/components/__tests__/placeNewAsset.test.ts` — NAV-04 落点纯函数
- [ ] `src/components/__tests__/searchNavigator.test.ts` — NAV-03 结果派生（按场景分组）
- [ ] e2e `test/e2e/tests/phase55-nav.mjs` — `/` 打开→跳转→落点→泳道聚焦冒烟（probe 模板 canvas-real-screenshot.mjs，`window.__kaisCanvas` store 桥已存在）

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | 既有 session 层，本期无新端点暴露（branches PATCH 是既有鉴权路由） |
| V3 Session Management | no | — |
| V4 Access Control | no | 无新路由（若扩 import-from-dir 词汇表属既有端点内数据） |
| V5 Input Validation | marginal | 搜索输入仅客户端过滤（无注入面）；`/` 键监听排除输入框焦点（Pitfall 7 属可用性非安全） |
| V6 Cryptography | no | — |

### Known Threat Patterns for React Flow canvas + Express
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| 契约测试读兄弟仓路径 | Tampering | 只读 + 路径 env 可覆盖；不执行 khs 代码（TS regex 解析，无 python spawn） |
| phaseIndex 污染（图数据注入超大 index） | Tampering | D-03 fallback + zod Number.isFinite 既有守卫（adapter/phaseIndexOf） |

## Sources

### Primary (HIGH confidence — 本会话直接读源码/实跑验证)
- `/data/workspace/kais-hermes-skills/plugins/kais_aigc/canvas_sync.py` — `_PHASE_INDEX_MAP`（L2321-2346）、`_PHASE_PREFIX_RE`（L257）、node:created/zone 写入链（L1739-1805、L5174-5181）
- `/data/workspace/kais-hermes-skills/plugins/kais_aigc/canvas_graph.py` — `ZONE_PHASES`（L741-774）、`ensure_zone_node`（L805-838，zone phaseIndex=0 + data.phase=组）
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/__init__.py` — PHASE_REGISTRY 22 项（python3 实跑确认）、p11a0 语义（L100-103）
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/tests/test_phase_registry_canvas_map_consistency.py` — khs 侧契约测试先例
- `packages/infinite-canvas/src/components/pipeline/model.ts` — PIPELINE_PHASES 19 条全量、extras 兜底、sub 语义
- `packages/infinite-canvas/src/constants.ts` — PHASE_GROUPS（L324-331）、LAYOUT.NEW_NODE_*（L104-107）、RAW_FIELD_LABELS
- `src/routes/canvas/v2/import-from-dir.ts` — PHASE_DEFS 13 条（L88-102）、`phaseIndex=laneIndex+1`（L639/657/842）、端点挂载（router.ts:192）
- `packages/infinite-canvas/src/hooks/useLod.ts` — 全文（阈值/迟滞/LodProvider/FITVIEW_MIN_ZOOM）
- `packages/infinite-canvas/src/hooks/useCanvasPersistence.ts` — canvasStateKey/saveCanvasState patch 语义
- `packages/infinite-canvas/src/components/FlowCanvas.tsx` — 搜索 hidden 过滤（L608-626）、focusAssetNodeId effect（L700-721）、onNewAsset 随机落点（L217-224）、viewMode 切换（L755-831）、navHistory（L346-403）
- `packages/infinite-canvas/src/components/StoryboardTimeline.tsx` — extractShots（L302-402）、StoryboardShot 模型（L100-130）、sceneNumOf/VT_SCENE_COLORS（L1763-1773）
- `packages/infinite-canvas/src/components/storyboard/StoryboardBoard.tsx` + `services/canvasApi.ts`（L1085-1144）— 两级浏览先例与数据契约
- `packages/infinite-canvas/src/components/canvas/ShotTree.tsx` — 左树 + setCenter（L137）
- `packages/infinite-canvas/src/components/canvas/laneGeometry.ts` — computePhaseColumns；`PhaseColumns.tsx` — pointerEvents:'none'
- `packages/infinite-canvas/src/v3/adapter.ts` — buildPhaseCatalog（L380-408）
- `packages/infinite-canvas/src/store/canvasStore.ts` — branches/selectBranchAsMain（L975-1005）、focusAssetNodeId（L1054）、toLegacyBranches（L281-292）
- `src/routes/canvas/v2/branches.ts` + `nodes.ts`（node:created 广播 `{node}`，L90/151）+ `useCanvasSocket.ts`（client `{nodeId,data}`，L153）
- `scripts/canvas/verify-schema-drift.ts` + `scripts/canvas/lib/verify-harness.ts` — 契约测试模式
- `.planning/phases/51-canonical-write-path-coordination-guard/51-04-PLAN.md`（WRITE-04 删除清单）+ git `7ec2e605`（旧 BranchPanel 全文）
- `data/db2.sqlite` `o_agentWorkData`（key='canvasGraph'）— 18 图 phaseIndex 分布实测（node better-sqlite3 直读）

### Secondary (MEDIUM confidence)
- 无（无外部 web 来源）

### Tertiary (LOW confidence)
- 无

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 零新增依赖，全部既有版本读自 package.json
- Architecture: HIGH — 所有组件/数据链直接读码 + db 实测
- Pitfalls: HIGH — Pitfall 1/2/3/4 均为代码级实证（非推测）
- 数据现实（pre-W6 存量）: HIGH for dev db2；生产库未实测（A1 假设）

**Research date:** 2026-08-21
**Valid until:** 2026-09-21（仓库内活跃开发——53/54 并行提交中，khs 映射若再变更以契约为准）
