---
phase: 62-asset-hierarchy-selection
plan: "04"
subsystem: infinite-canvas/assetManager
tags: [hierarchy-view, 5th-tab, selectGroupWinner, renderAssetCard, singleton-bucket, count-chips]
requires:
  - 62-01（groupCanvasLinkage 纯函数家 + generationConfigKeys 常量表——本 plan 直接消费零重造）
provides:
  - assetHierarchy.ts（selectGroupWinner/deselectAsset/restoreAsset 共享 handler 家；
    D-05 fire-and-forget selectVariantWinner 分支 + 幂等断言纪律 pin 注释）
  - AssetHierarchy.tsx（第 5 Tab「资产层级」视图壳：C1 布局/C2 域树/C3 组卡+单件桶/
    C6 阶段+VG 徽标/C7 计数芯片/toolbar 搜索+展开全部+折叠全部+刷新）
  - renderAssetCard（AssetLibrary.tsx 模块级导出，模式参数化：library 字节等价 /
    hierarchy 按卡三态；opts.singletonPhase 单件阶段徽标 hier-card-phase）
  - groupCanvasLinkage.ts 追加（assetPhaseOf 阶段徽标推导 + buildHierarchyModel
    域指派/单件桶/计数聚合派生 + 类型面）
  - 8 新 vitest 用例（层级派生契约锁；套件 33 用例）
affects:
  - AssetLibrary.tsx（handleSelect/deselect/restore 改薄壳 + renderCard 提取；库路径行为字节等价）
  - canvasStore.ts（assetView 联合追加 'hierarchy'，默认 'library' 锚不动）
  - AssetManager.tsx（TABS 第 5 项 + 渲染分支；既有 4 Tab 零改动）
  - useNavHistory.ts（NavSnapshot.assetView 类型镜像追加——Rule 3 编译修复）
  - 62-05（批量决策/C4 batch-bar/组 checkbox 挂载点）/ 62-06（右栏 340px 栅格位）/
    62-07（e2e 断言面 hier-* testid 全套 + data-count-*）
tech-stack:
  added: []（零新依赖）
  patterns: [AssetLibrary.tsx 结构形态（P3：同 useRealAssets/同 patchLocal/同 toast 通道）,
    .am-tree/.am-group 既有样式词汇复用（零新全局 token）,
    62-01 groupCanvasLinkage 纯函数家追加形态]
key-files:
  created:
    - packages/infinite-canvas/src/components/assetManager/assetHierarchy.ts
    - packages/infinite-canvas/src/components/assetManager/AssetHierarchy.tsx
  modified:
    - packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx
    - packages/infinite-canvas/src/components/assetManager/groupCanvasLinkage.ts
    - packages/infinite-canvas/src/components/assetManager/__tests__/groupCanvasLinkage.test.ts
    - packages/infinite-canvas/src/components/assetManager/assetManager.css
    - packages/infinite-canvas/src/store/canvasStore.ts
    - packages/infinite-canvas/src/components/assetManager/AssetManager.tsx
    - packages/infinite-canvas/src/hooks/useNavHistory.ts
decisions:
  - "renderCard 复用 = 两处增量（checker FLAG D2 裁定）：模式参数（library 传当前 tab 字节等价 /
    hierarchy 按卡自身三态出按钮）+ opts.singletonPhase 单件徽标；留居 AssetLibrary.tsx 导出，
    不新建 AssetCard.tsx"
  - "AssetCardDeps 在 PLAN 列出的字段外加 onLocate（📍 定位闭包依赖）——「组件闭包显式化」
    裁定的必要成员，AssetLibrary/AssetHierarchy 两视图注入同一 handleLocateOnCanvas 同式实现"
  - "D-05 syncCanvas 仅在 store projectId/episodesId 均非 null 时构造（selectVariantWinner
    签名要求 number；未就绪时静默跳过画布侧同步，不报错）"
  - "搜索语义：组命中（title 或任一成员）保留；title 命中而成员全未命中 → 整组展示（组级命中）；
    否则仅展示命中成员；隐藏数计入 data-count-filtered-out"
  - "域树固定纲三域恒渲染（空域 is-empty 灰态但可点不 disabled）；域节点折叠为视觉态
    （树无第三级，L2/L3 都在主区——UI-SPEC C2 刻意差异）"
metrics:
  duration: 1740s（2026-08-24 13:09–13:39 UTC）
  completed: 2026-08-24
  tasks: 3/3
  tests: 8 新增用例全绿（groupCanvasLinkage 套件 33）；全包 474/474（基线 466 + 8）
---

# Phase 62 Plan 04: 资产层级视图壳 + 单组选定共享化 + renderAssetCard 提取 Summary

第 5 Tab「资产层级」三层视图成真（L1 三域折叠树 / L2 getGroupKey 组卡+单件桶 / L3
renderAssetCard 复用卡），同时完成两项共享化前置：selectGroupWinner 三 handler 提取到
assetHierarchy.ts（含 D-05 画布 best-effort 同步 fire-and-forget 分支）与 renderCard
提取为模式参数化的模块级 renderAssetCard——资产库路径行为字节等价（HIER-04）。

## What Was Built

### Task 1 · selectGroupWinner/deselect/restore 共享提取 + renderAssetCard 模式参数化（commit 327143e3）

- `assetHierarchy.ts`（新，handler 家——含网络副作用，纯函数家仍在 groupCanvasLinkage）：
  - `selectGroupWinner(assetId, groupKey, ctx)` = handleSelect 全语义逐字搬运（同组乐观淘汰 →
    winner 乐观选定 → updateAsset 循环单项失败忽略 → 成功/失败 toast + reload 回滚）；
    **D-05 增量**（成功 toast 后）：ctx.syncCanvas 存在且 `findVariantGroupForAsset` 命中且
    `resolveAssetNodeId` 非空 → `void selectVariantWinner(...)` fire-and-forget，catch 内
    toast「画布侧同步失败」（warning）+ console.warn 双留痕（T-62-13），不回滚不阻断；
    RESEARCH C 双通道幂等事实以 pin 注释钉死（常见路径客户端 POST = no-op 属预期，
    勿据 applied:false 报错——62-07 e2e 断言纪律）。
  - `deselectAsset`/`restoreAsset` = renderCard 内联体提取具名化，toast 文案逐字
    （`已退回待选 · {title}（{n} 个淘汰变体已恢复）`/`已恢复到待选`/错误三串）。
- `AssetLibrary.tsx`：
  - handleSelect 改薄壳：注入 ctx + syncCanvas（`useCanvasStore.getState()` 取
    episodesId/graph；projectId/episodesId 均就绪才构造）——**资产库与层级同调用点**
    （HIER-04 truth 3：D-05 分支对两路径同时生效）。
  - deselect/restore 内联体换调共享函数。
  - renderCard 提取为模块级导出 `renderAssetCard(d, deps, opts?)`：JSX 逐字搬迁，仅两处增量——
    (a) 三态按钮门控 `deps.mode==='library'` 沿 tab 门控（字节同构）／`'hierarchy'` 按卡自身
    `isAssetPending/Selected/Eliminated`（D-04 单套判定式）；(b) `opts.singletonPhase` →
    卡右上角 `[data-testid="hier-card-phase"]` 徽标（.am-badge 既有词汇 + 内联定位，零新全局类），
    title 区分「资产 meta 直读」/「按子类型推导」。拖入/定位/双击详情/.am-card 断言面全原样。
  - 组件内 `renderCard = (d) => renderAssetCard(d, { mode:'library', tab, ...deps })` 薄壳。

### Task 2 · 层级派生纯函数 + 8 用例（commit d29d40a2）

- `groupCanvasLinkage.ts` 追加（纯函数家红线沿用，零 React/零 store；消费 62-01 常量表零重造）：
  - `assetPhaseOf(d)`：meta.phaseCode 直读优先（T-62-12：仅 `^P\d{2}$` 形态，异常值回落查表）
    → `inferSubtype → PHASE_BY_SUBTYPE` 推导（reportAudit 仅此路径可 true）→ 未命中空 phaseCode
    （UI 不渲染徽标）。
  - `buildHierarchyModel(assets)`：分组轴 getGroupKey / 域 domainOfType（type-first，未列兜底
    media）/ 计数聚合全经 isAsset* 三式（D-04 单套，零内联判定）/ 单件桶 = 域内 size===1 且
    !reportAudit（D-03：reportAudit 不进桶渲染集但计域 total）/ 组排序 groupOrder + title
    自然序（既有 candidateGroups 排序式）/ 三域固定纲恒在场。
- 单测 8 例（套件 33）：三态计数公式（isPrimaryView 整数 0/1 + 「淘汰且 isPrimaryView=1 仅计
  淘汰」不变量 + DAG pending≡total-selected-eliminated）、D-03 排除语义程序化断言、keyframe
  剥 `_v` 同组、scene/voice isManual 标志、组排序 char<scene<keyframe<other、兜底 media 域、
  T-62-12 三异常 phaseCode 回落。

### Task 3 · AssetHierarchy 视图壳 + 第 5 Tab 挂载 + css（commit 974a6e3e）

- `AssetHierarchy.tsx`（新，`[data-testid="hierarchy-view"]` 根 + `.am-hier` 220px/1fr 栅格，
  右栏 340px 位 62-06 落）：
  - L1 域树（C2）：.am-tree 既有词汇；「全部」`hier-all-node`（全量计数芯片）+ 三域
    `hier-domain-node[data-domain]`（C7 计数芯片 ★青/○中性/✕玫 + 灰 mono 共 N，
    `data-count-*` 属性同值；域计数含 reportAudit；空域 is-empty 可点不 disabled；折叠箭头
    stopPropagation）。
  - toolbar：搜索（.am-search「搜索资产 / 组…」）+ `hier-expand-all`「展开全部」/
    `hier-collapse-all`「折叠全部」（checker FLAG 2 裁定；作用于 collapsedGroups 全清/全置）
    + 刷新（reload）。
  - L2 组卡（C3）：`hier-group[data-group-key][data-collapsed][data-count-*][data-count-filtered-out]`；
    header 序 = checkbox 占位（62-05 落，渲染 null 不留死按钮）→ emoji+title（组含选定者 ★ 前缀）
    → `hier-group-phase` 阶段徽标（组首 assetPhaseOf，tooltip 直读/推导）→ VG 徽标
    （primary??first 反查命中 → 可点 `hier-group-vg[data-vg-id]`「⧉ 画布组 · {size}」开变体墙；
    未命中 → 既有「去画布选片 →」仅定位降级）→ 计数芯片 → 折叠箭头（折叠只收 L3 网格，
    header sticky 既有）。
  - L3：`renderAssetCard(d, hierDeps)`（mode='hierarchy' 按卡三态出按钮；onSelect =
    selectGroupWinner 含 syncCanvas——与库同调用点）。
  - 单件桶：每域末尾 `hier-singletons[data-domain]`「📦 单件资产」
    （.am-group--singleton 去金竖条；tooltip「无互斥组的单产物 · 不参与组间流转」；桶内卡带
    hier-card-phase 徽标；空桶整卡不渲染）。
  - 空态：域空「该域暂无资产 —— 运行管线产出后自动注册到这里。」；全局空沿用资产库既有串。
    loading/error 复用 .am-loading/.am-empty + `hier-loading`/`hier-error`。
- `canvasStore.ts`：assetView 联合 + setAssetView 签名追加 'hierarchy'；**默认值
  `assetView: 'library'`（:1152）不动**（HIER-04 锚 pin 注释）。
- `AssetManager.tsx`：TABS 追加 `{ key:'hierarchy', label:'资产层级' }` + 渲染分支；
  既有 4 Tab 与分支零改动。
- `useNavHistory.ts`：NavSnapshot.assetView 镜像联合同步追加（Rule 3，见 Deviations）。
- `assetManager.css` append：.am-hier 栅格 / .am-hier__toolbar / .am-hier__counts 计数芯片
  （C7 配色语义）/ .am-group--singleton / .am-hier__vg + ≤880px 响应式（.am-lib 同款断点）；
  零新全局 token。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - 编译阻塞] useNavHistory.ts NavSnapshot.assetView 类型镜像未含 'hierarchy'**
- **Found during:** Task 3 首次 `npm run build`（tsc -b 在 useNavHistory.ts:83 报 TS2322——
  该文件本地镜像了 canvasStore.assetView 联合类型，PLAN files_modified 未预见此位点）
- **Fix:** 镜像联合追加 `'hierarchy'`（纯类型变更，零行为差异；snapshot 捕获/比较逻辑不变）
- **Files modified:** packages/infinite-canvas/src/hooks/useNavHistory.ts
- **Commit:** 974a6e3e

**2. [设计必要增量] AssetCardDeps 追加 onLocate 字段**
- **Found during:** Task 1 提取 renderCard（📍 定位按钮闭包依赖 handleLocateOnCanvas，
  PLAN 列出的 deps 字段清单未含；无此字段则提取后的卡片丢失定位按钮）
- **Fix:** deps 追加 `onLocate`——「组件闭包显式化」裁定的必要成员；两视图注入同式实现
  （双前缀反查 + nav 快照 + focus + setViewMode）
- **Files modified:** AssetLibrary.tsx（AssetCardDeps 类型 + renderAssetCard 消费）
- **Commit:** 327143e3

### 执行环境备注（非偏差，如实记录）

- **e2e 基线备注**：`phase55-nav.mjs:63`（search-navigator-open）与 `:120`
  （new-asset-placement）在本机 load ~3.5 下为既有 flaky——已用 pre-plan 基线复现证实：
  checkout 19445b7e（本 plan 4 新文件完全移除）重建 dist 后 4 轮 e2e 中第 3 轮同样失败于
  `:120`；本 plan 构建亦有 8/8 全绿轮次（多次）。失败在两测试间跳变、与本 plan 改动面
  （资产中心视图/资产库内部）零交互（测试跑在 viewMode='canvas' 画布态），判定为环境性
  时序 flaky 非回归。62-07 e2e 收尾时如仍见建议加 retry 策略。
- **并行执行者**：本 plan 收尾期间 62-07 执行者在本仓提交 6b540909（verify-phase-62 S 静态锁），
  与本 plan 文件集零交叠。
- Task 2 首跑 1 例失败为本 plan 自身新测试的手算期望值笔误（pending 8 应为 11，
  实现与分域小计正确），修正字面量后 33/33 全绿——正常 TDD 迭代非偏差。

## Verification Results

| Gate | Result |
|------|--------|
| Task 1 automated verify（build + npm test + toast 文案单点 grep + renderAssetCard 计数） | PASS（build exit 0；466/466；`已设为选定资产` 全 assetManager 仅 assetHierarchy.ts 1 处；renderAssetCard AssetLibrary 内 5 处引用；updateAsset 选定循环仅 assetHierarchy.ts） |
| Task 2 automated verify（vitest linkage 套件 + build） | PASS（33/33，build exit 0） |
| Task 3 automated verify（build + npm test + testid grep + 默认视图锚） | PASS（474/474；AssetHierarchy 11 类 testid 全在场；`assetView: 'library',` :1152 不动） |
| `npx tsc --noEmit`（packages/infinite-canvas） | PASS（exit 0） |
| root `npx tsc --noEmit` | PASS（exit 0） |
| 全包 vitest | PASS（41 文件 474 用例全绿 = 基线 466 + 本 plan 8） |
| e2e phase55-nav + phase61-debt（build 后） | PASS with 既有 flaky 备注（存在 8/8 全绿轮次；失败轮次在 pre-plan 基线同样复现——见执行环境备注；7 个稳定用例含 61-debt 全部 4 例从未失败） |
| 文案抽查 | PASS（17 串逐字 grep 全在场；`去画布选片 →`/`资产库为空…`/`画布侧同步失败` 既有串保留 + toast 定义单点） |
| 工作树卫生 | PASS（仅 pre-existing 脏文件 yarn.lock/ltx pngs 未触碰；无本 plan 遗留 untracked） |

## Auth Gates

None.

## Known Stubs

Plan 裁定的有意占位（非缺陷，下游 plan 接管）：
- 组卡 header checkbox 位渲染 null（62-05 C4 批量决策落地——PLAN 明示「渲染 null 占位不留死按钮」）。
- 根栅格仅两列，右栏 340px 冗余配置位不渲染（62-06 C8 落地）。
- 域树节点折叠为纯视觉态（树无第三级，L2/L3 在主区——UI-SPEC C2 刻意设计）。

## Notes for Downstream Plans

- 62-05：`hierDeps`/`baseCtx` 在 AssetHierarchy.tsx 组件内现成可扩展（批量选定循环调
  `selectGroupWinner` 即 D-06 语义）；组卡 header checkbox 位点在 renderGroupCard header 首位。
- 62-06：`.am-hier` 栅格改三列 `220px 1fr 340px` + toolbar 加「⚙ 冗余配置」开关位。
- 62-07：E2E Hooks 表 hierarchy 侧 testid 全部就绪；D-05 断言**勿断 applied:true**（RESEARCH C，
  assetHierarchy.ts:92-97 pin 注释）；D-04 一致性断言用 `data-count-pending` 属性（非 innerText）。
- `findVariantGroupForAsset` 返回 `{ groupId, size }`——VG chip 消费 `.groupId`/`.size`
  （62-01 SUMMARY 同款提示）。

## Self-Check: PASSED

- 文件存在性：assetHierarchy.ts / AssetHierarchy.tsx FOUND（新建）；
  AssetLibrary.tsx / groupCanvasLinkage.ts / groupCanvasLinkage.test.ts / assetManager.css /
  canvasStore.ts / AssetManager.tsx / useNavHistory.ts FOUND（修改）。
- Commits：327143e3 / d29d40a2 / 974a6e3e 均在 git log FOUND。
- 无 files_modified 之外文件被本 plan 提交（useNavHistory.ts 为已记录的 Rule 3 偏差，
  git show --stat 三 commit 核对：327143e3=2 文件、d29d40a2=2 文件、974a6e3e=5 文件）。
