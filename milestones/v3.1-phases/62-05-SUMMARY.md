---
phase: 62-asset-hierarchy-selection
plan: "05"
subsystem: infinite-canvas/assetManager
tags: [batch-selection, batch-elimination, arm-confirm, mtime-winner, C4-batch-bar, manual-chip]
requires:
  - 62-01（isSceneGroup/isVoiceGroup/isAssetPending/isAssetEliminated 共享判定式——批量规则直接消费）
  - 62-04（selectGroupWinner 共享 handler（含 D-05 fire-and-forget）/AssetCardDeps/
    buildHierarchyModel（isManualScene/isManualVoice/hasPrimary 已派生）/AssetHierarchy 组卡
    header checkbox null 占位）
provides:
  - assetHierarchy.ts 批量层（assetFreshnessKey 三段键 + pickLatestActive 最新非淘汰 winner
    规则 + planBatchSelection/planBatchElimination 纯规则 + runBatchSelect/runBatchEliminate
    编排薄层——逐组走共享通道，无组级事务）
  - AssetHierarchy.tsx C4 批量决策面（BatchActionBar in-flow 粘条 + 组 checkbox 落位 +
    ✋ 手动选择 chip + armed 两段式状态机（5s 自动解除））
  - AssetLibrary.tsx 自动初始化升级（activeGroup[0] 取首 → pickLatestActive 最新非淘汰——
    D-06 单组路径同步，HIER-04 锚收窄为「每组仍恰一 winner」）
  - canvasApi.ts AssetDetail.createdAt 透传字段（UI-GREY-1 裁定零后端改动）
  - 14 新 vitest 用例（批量纯规则契约锁；全包 488 = 基线 474 + 14）
affects:
  - 62-06（.am-hier 栅格改三列时批量条位置不动——条在 toolbar 下、滚动区上，不受影响）
  - 62-07（e2e 断言面全套就绪：hier-batch-bar/hier-batch-select/hier-batch-eliminate
    [data-armed]/hier-batch-clear/hier-group-check[data-group-key]/hier-manual-chip +
    两条汇总 toast 精确串 + auto-init 最新规则断言语义）
tech-stack:
  added: []（零新依赖）
  patterns: [assetHierarchy.ts 批量层追加形态（plan 纯规则 / run 编排薄层分层）,
    62-04 .am-badge 派生 chip 形态（--cv-mod-audio 弱底）, 既有 .am-btn--ghost/--primary 词汇]
key-files:
  created:
    - packages/infinite-canvas/src/components/assetManager/__tests__/assetHierarchy.test.ts
  modified:
    - packages/infinite-canvas/src/services/canvasApi.ts
    - packages/infinite-canvas/src/components/assetManager/assetHierarchy.ts
    - packages/infinite-canvas/src/components/assetManager/AssetHierarchy.tsx
    - packages/infinite-canvas/src/components/assetManager/assetManager.css
    - packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx
decisions:
  - "批量选定汇总 toast 跳过后缀按 UI-SPEC §Copywriting 条件式（M>0 才追加
    「（跳过 {M} 个手动选择组）」）——PLAN Task 1 无条件串与 UI-SPEC 冲突时以
    Copywriting 权威面（硬门「精确串逐字 UI-SPEC §Copywriting」）为准"
  - "编排函数命名 runBatchSelect/runBatchEliminate（must_haves/key_links 权威段）——
    Task 1(e) 行文 runBatchElimination 为 plan 内部笔误；规划函数保持
    planBatchSelection/planBatchElimination 对称"
  - "批量规划输入 BatchGroup = HierarchyGroup 结构兼容子集（key/items/isManualScene/
    isManualVoice/hasPrimary）——手动标志直接消费 62-04 buildHierarchyModel 派生位
    （其派生源就是 isSceneGroup/isVoiceGroup，语义等价零重算）"
  - "批量选定 ctx 注入 syncCanvas（D-05 画布同步内含于共享通道，两动作同调用点）；
    批量淘汰无 winner 选定语义，走 baseCtx 即可"
  - "armed 态在选择集变化时自动解除（armed 文案内嵌 N，选择变了旧意图即失效）+
    unmount 清 timer + 二击执行后立即复位——三重清理防悬挂 armed"
  - "selectedGroups 从全模型取（不受当前搜索/域过滤影响）——用户显式勾选的组，
    过滤态切换不应静默吞掉已选意图"
  - "T-62-16 落地形态：assetFreshnessKey 对 raw 值 Number() 收窄（数字字符串可数值化
    通过）+ 非有限值回退 id——负数有限值可排序故放行（威胁登记仅要求 NaN 防御）"
metrics:
  duration: 505s（2026-08-24 13:50–13:59 UTC）
  completed: 2026-08-24
  tasks: 3/3
  tests: 14 新增用例全绿（assetHierarchy 套件）；全包 488/488（基线 474 + 14）零回归
---

# Phase 62 Plan 05: C4 批量决策（批量选定/批量淘汰）+ mtime winner 规则全域统一 Summary

D-06/D-07 组层批量决策成真：组 checkbox 多选 → 批量条两动作（选定走逐组共享
selectGroupWinner / 淘汰走 arm-confirm 两段式），场景/声纹组「✋ 手动选择」chip 恒显 +
批量选定跳过 toast 明示；「最新」winner 规则（updatedAt??createdAt??id 三段键）在批量
选定与自动初始化两路径同构落地，HIER-04 锚语义收窄成文。

## What Was Built

### Task 1 · createdAt 透传 + 批量纯规则 + 编排薄层 + 14 单测（commit 04df1b8f）

- `canvasApi.ts`：AssetDetail 追加 `createdAt?: number | null`（JSDoc 注明 62-05
  UI-GREY-1 裁定——服务端 search select('a.*') 已透传 o_assets.createdAt，零后端改动）。
- `assetHierarchy.ts` 批量层追加（模块头注释同步；IO handler 家红线不变）：
  - `assetFreshnessKey(d)`：三段键 `updatedAt ?? createdAt ?? id`——updatedAt 经局部
    扩展类型声明（AssetDetail 现无该字段，服务端未来透传后自动前移）；T-62-16 落地 =
    Number() 收窄 + 非有限值回退 id。
  - `pickLatestActive(items)`：组内最新非淘汰（isAssetEliminated 过滤 + 键降序取首）；
    空组/全淘汰 → null。
  - `planBatchSelection(groups)`：手动组（isManualScene/isManualVoice）跳过计数（D-07
    只绑批量选定）；已有 winner 组跳过提交（重申幂等无意义——D-06 按需初始化理解，
    与 auto-init 同构，注释 pin）；其余组 pickLatestActive 恰一条。
  - `planBatchElimination(groups)`：每组 isAssetPending 成员（winner/已淘汰不动）；
    手动组不豁免；无待选组不计 groupCount。
  - `runBatchSelect`/`runBatchEliminate` 编排薄层：逐组/逐条 try/catch 单项忽略
    （T-62-17 console.warn 留痕，不回滚）→ 汇总 toast（「批量选定完成 · {N} 组」+
    M>0 时追加跳过后缀 /「批量淘汰完成 · {N} 组共 {K} 个待选已淘汰」逐字）。
- `__tests__/assetHierarchy.test.ts`（14 用例，只测纯规则）：三段键三段优先级 +
  T-62-16 两畸形分支；pickLatestActive 淘汰不中/降序/全淘汰 null/id 末位决胜；
  planBatchSelection 手动组跳过/已有 winner 跳过/恰一条=最新非淘汰/全淘汰组不入；
  planBatchElimination 仅待选/手动组照入/无待选组不计数。

### Task 2 · BatchActionBar UI + 组 checkbox + 手动 chip + 接线（commit bb1d7697）

- `AssetHierarchy.tsx`：
  - 组卡 header checkbox 正式落位（62-04 null 占位转真）：
    `[data-testid="hier-group-check"][data-group-key]`（input + label，checked 读
    selectedGroupKeys Set；单件桶无 checkbox——无批量决策意义；手动组 checkbox 不禁用，
    批量淘汰可用）。
  - 手动 chip：isManualScene||isManualVoice 组 header 恒显
    `[data-testid="hier-manual-chip"]`「✋ 手动选择」（.am-badge 基底 +
    .am-hier__manual-chip --cv-mod-audio 弱底；title「场景/声纹不参与批量选定 ·
    需逐组手动选择」逐字）——仅手动组条件渲染，非手动组零存在。
  - BatchActionBar（选中组 ≥1 渲染，toolbar 下 in-flow 粘条）：
    `已选 {N} 组`（mono）｜`hier-batch-select`「批量选定」（.am-btn--primary 青位）｜
    `hier-batch-eliminate` `data-armed="true|false"`（.am-btn--ghost + 玫 hover；armed 态
    文案「确认淘汰 {N} 组待选？」+ 玫实底）｜`hier-batch-clear`「清除」。两态文案逐字
    UI-SPEC §Copywriting。
  - armed 状态机：5s setTimeout 自动解除（useRef 存 timer id）；unmount useEffect 清理；
    二击执行后立即复位；选择集变化自动解除（文案内嵌 N 防陈旧意图）。
  - 接线：ctxWithSync 提取（handleSelect 与批量选定同注入点，D-05 对单组/批量同生效）；
    handleBatchSelect/handleBatchEliminate → runBatchSelect/runBatchEliminate（共享通道，
    无组级事务代码）→ 执行后清选择集；selectedGroups 从全模型取（不受搜索/域过滤影响）。
- `assetManager.css` append：.am-hier__batch 粘条 / .am-hier__batch-eliminate[data-armed]
  玫实底 / .am-hier__group-check（accent 青）/ .am-hier__manual-chip（--cv-mod-audio-weak）
  ——全既有 token 零新全局。

### Task 3 · 自动初始化 winner 规则升级（commit 0811ea2a）

- `AssetLibrary.tsx`：`needsInit.push(activeGroup[0].id)` →
  `needsInit.push(pickLatestActive(activeGroup)!.id)`（外层已判 activeGroup.length > 0
  故非空断言安全）；pin 注释注明 62-05 D-06 升级 + HIER-04 回归锚收窄为「每组仍恰一
  winner」（checker FLAG 3，62-07 e2e 以此断言）。豁免/防重入/reload 逻辑零改动。
- 升级证明：pickLatestActive(activeGroup) 恰 1 处、activeGroup[0].id 全文件零残留。

## Deviations from Plan

### Plan 内部不一致裁决（非代码缺陷，两处）

**1. 批量选定汇总 toast 跳过后缀 = 条件式**
- **Found during:** Task 1——PLAN Task 1 action 行文给无条件串
  「批量选定完成 · {N} 组（跳过 {M} 个手动选择组）」，但 UI-SPEC §Copywriting（硬门
  指定的文案权威面）明确「有跳过时追加」
- **Fix:** 按 UI-SPEC 条件式实现（M=0 无后缀；M>0 后缀逐字）——两文本在 M>0 路径
  逐字一致，无断言面损失
- **Commit:** 04df1b8f

**2. 编排函数名 runBatchEliminate（非 Task 1(e) 行文的 runBatchElimination）**
- **Found during:** Task 1——PLAN must_haves（权威契约段）与 key_links 均写
  runBatchEliminate，仅 Task 1(e) 行文为 runBatchElimination
- **Fix:** 取 must_haves/key_links 命名；规划函数对称保持 planBatchElimination
- **Commit:** 04df1b8f

**3. [设计必要增量] armed 态随选择集变化自动解除**
- **Found during:** Task 2——armed 文案内嵌组数 N；用户武装后继续勾选/取消组，
  文案 N 会更新但武装意图针对旧选择集
- **Fix:** useEffect([selectedGroupKeys]) 解除武装——PLAN 只要求 5s timer + 复位，
  此为防陈旧意图的加严（不与 UI-SPEC 冲突）
- **Commit:** bb1d7697

## Verification Results

| Gate | Result |
|------|--------|
| Task 1 automated verify（vitest 新套件 + build） | PASS（14/14 用例绿，build exit 0） |
| Task 2 automated verify（build + 6 testid grep） | PASS（build exit 0；hier-batch-bar/select/eliminate/clear/group-check/manual-chip 计 6 行全在场） |
| Task 3 automated verify（build + npm test + 升级点 grep） | PASS（488/488；pickLatestActive(activeGroup)=1、activeGroup[0].id 零残留 → UPGRADED） |
| `npx tsc --noEmit`（packages/infinite-canvas） | PASS（exit 0） |
| root `npx tsc --noEmit` | PASS（exit 0） |
| 全包 vitest（终态树） | PASS（42 文件 488 用例全绿 = 基线 474 + 本 plan 14，零回归） |
| 终态 dist rebuild | PASS（build exit 0） |
| 文案抽查（grep -F 逐字） | PASS（两条汇总 toast + armed 两态 + 已选 N 组 + ✋ 手动选择 + chip title 全在场） |
| 工作树卫生 | PASS（仅 pre-existing 脏文件 yarn.lock/ltx pngs 未触碰；无本 plan 遗留；三 commit 文件清单核对全在 files_modified 内） |

## Auth Gates

None.

## Known Stubs

None——62-04 遗留的 checkbox null 占位与「C4 62-05 落」注释均已在本 plan 转正/清理；
右栏 340px 仍为 62-06 的计划内空位（非本 plan 文件）。

## Notes for Downstream Plans

- 62-07 e2e：
  - 批量断言面全套就绪（6 testid + data-armed 两态）；勾选两组后
    `hier-batch-bar` 出现 `已选 2 组`；批量选定断言每组恰一 PATCH 且 winner=最新非淘汰
    （fixture 需给组内成员造 createdAt 差——mock fixture 62-03 已带 createdAt）。
  - 要断言跳过 toast，fixture 需含场景/声纹组（`（跳过 {M} 个手动选择组）` 后缀仅
    M>0 时出现）；`hier-manual-chip` 负向断言：非手动组零存在（条件渲染保证）。
  - 批量淘汰：首击只 arm 不发请求（可断零 PATCH），二击才逐条 PATCH eliminated；
    winner 不动（负向断言）。
  - 自动初始化断言语义已变：HIER-04 锚=「每组仍恰一 winner」，**勿断 winner=
    组内第一个**（现= mtime 最新）；D-05 断言纪律沿 62-04 pin 注释（勿断 applied:true）。
  - `data-count-pending` 等计数属性断言面不变（本 plan 未动 buildHierarchyModel）。
- 62-06：栅格改三列时批量条不受影响（条位于 toolbar 与滚动区之间，不依赖栅格列数）。

## Self-Check: PASSED

- 文件存在性：__tests__/assetHierarchy.test.ts FOUND（新建）；
  canvasApi.ts / assetHierarchy.ts / AssetHierarchy.tsx / assetManager.css /
  AssetLibrary.tsx FOUND（修改）——files_modified 6 文件全覆盖。
- Commits：04df1b8f / bb1d7697 / 0811ea2a 均在 git log FOUND。
- 无 files_modified 之外文件被本 plan 提交（git show --stat 三 commit 核对：
  04df1b8f=3 文件、bb1d7697=2 文件、0811ea2a=1 文件）。
