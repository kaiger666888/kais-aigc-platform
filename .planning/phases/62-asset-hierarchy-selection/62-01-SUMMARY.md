---
phase: 62-asset-hierarchy-selection
plan: "01"
subsystem: infinite-canvas/assetManager
tags: [shared-pure-functions, key-surface-constants, vitest, dual-prefix-reverse-lookup]
requires: []
provides:
  - groupCanvasLinkage.ts（getGroupKey/getGroupDisplayInfo/groupOrder/parseMetaFields/metaStr 搬迁导出
    + isAssetSelected/isAssetPending/isAssetEliminated 三态判定式（D-04 单套）
    + isSceneGroup/isVoiceGroup 豁免式 + canvasNodeIdsForAsset/resolveAssetNodeId/
    findVariantGroupForAsset 双前缀反查）
  - generationConfigKeys.ts（GENERATION_CONFIG_KEYS 14 键 + LOCKED_CONFIG_KEYS 汇总
    + TYPE_DOMAIN + domainOfType + PHASE_BY_SUBTYPE + clampRedundancy）
  - 两份 vitest（42 用例）——62-02/04/05/07 的共享地基
affects:
  - AssetLibrary.tsx（纯移动改 import；tabFiltered/自动初始化豁免同式换名；
    handleGoCanvasSelect/handleLocateOnCanvas 走共享反查 + a-oasset- 增量）
tech-stack:
  added: []（零新依赖——纯提取 + 常量 + vitest 既有）
  patterns: [assetManagerData.ts 模块级纯函数族形态（P1）, REAL_TYPE_GROUPS 导出常量形态（P2）,
    placeNewAsset.test.ts vitest 形态（P8）]
key-files:
  created:
    - packages/infinite-canvas/src/components/assetManager/groupCanvasLinkage.ts
    - packages/infinite-canvas/src/components/assetManager/generationConfigKeys.ts
    - packages/infinite-canvas/src/components/assetManager/__tests__/groupCanvasLinkage.test.ts
    - packages/infinite-canvas/src/components/assetManager/__tests__/generationConfigKeys.test.ts
  modified:
    - packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx
decisions:
  - "findVariantGroupForAsset/resolveAssetNodeId 双前缀都查（asset- 拖入 / a-oasset- 服务端建点），候选序 asset- 优先——RESEARCH D 实测增量"
  - "键面 = runner.py:2341-2392 实码口径：11 嵌套（transition 并入 shot_list 仅 note 注记）+ 3 扁平（p01_hook final=null 哨兵回落 pre；p02/p03 final=1；topic_kernel pre 共享扁平=3）+ tts 钉死 + 18 报告/审计汇总（锁定区 19）+ bgm/foley unwired + 5 preCap1 + gpuHint(p11_video)"
  - "clampRedundancy = khs resolver 逐字（pre≥1；final=clamp(1,final,pre)）"
  - "PHASE_BY_SUBTYPE：rapid_preview→P10(P10b)、delivery_package→P13+reportAudit:true、unknown 不入表"
metrics:
  duration: 1457s（2026-08-24 12:42–13:06 UTC）
  completed: 2026-08-24
  tasks: 3/3
  tests: 42 新增用例全绿；既有套件 120（serialize+components）+ 全包 466 零回归
---

# Phase 62 Plan 01: 资产分组/反查/三态判定共享提取 + khs 键面常量化 Summary

分组轴（getGroupKey 族）与三态判定式从 AssetLibrary 逐字搬迁为无 React 依赖的共享纯函数、
新增 asset-/a-oasset- 双前缀画布反查 util，并把 khs v2.5 键面（runner.py 实码口径）固化为
14 可配键 + 19 锁定键常量表，配 42 个 vitest 契约锁——62-02/04/05/07 的共享地基。

## What Was Built

### Task 1 · groupCanvasLinkage.ts 提取 + AssetLibrary 纯移动（commit 336b6d21）

- `groupCanvasLinkage.ts`（新，纯函数家红线：仅 type import，零 React/零 store）：
  - `parseMetaFields`/`metaStr`/`getGroupKey`/`getGroupDisplayInfo`/`groupOrder` 从
    AssetLibrary.tsx **逐字搬迁**（全部层级语义注释随迁；T-62-01 try/catch 防御沿用）；
  - 三态判定式 `isAssetSelected`/`isAssetPending`/`isAssetEliminated`（原 tabFiltered
    三式同式导出，JSDoc 钉 D-04 单套红线）；`isSceneGroup`/`isVoiceGroup` 豁免式提取；
  - 双前缀反查：`ASSET_NODE_ID_PREFIX`/`OASSET_NODE_ID_PREFIX` 常量 +
    `canvasNodeIdsForAsset`（T-62-02：非有限 number 拒拼，前缀白名单拼接）+
    `resolveAssetNodeId`（实存节点解析，asset- 候选优先）+
    `findVariantGroupForAsset`（variantNodeIds ∪ winnerNodeId 任一前缀命中；
    size=variantNodeIds.length）。
- `AssetLibrary.tsx`：本地定义全删改 `import ... from './groupCanvasLinkage'`（恰 1 处）；
  tabFiltered / 自动初始化豁免改调共享导出（表达式语义零变）；
  `handleGoCanvasSelect`/`handleLocateOnCanvas` 走 `resolveAssetNodeId(...) ?? asset-{id}`
  兜底——既有 asset- 路径行为逐字节一致，**唯一行为增量 = 补 a-oasset-（服务端建点）覆盖**。

### Task 2 · generationConfigKeys.ts 键面常量（commit 0ef05f52）

- `GENERATION_CONFIG_KEYS`：14 键（11 嵌套 + 3 扁平），每键
  `{ phaseKey, tier, label(UI-SPEC 显示名逐字), defaultPre, defaultFinal, preCap1?, unwired?, gpuHint?, note? }`；
  默认值按 runner.py:2285-2292 实码——扁平 pre 全 3（p02/p03 final=1、**p01_hook final=null
  哨兵**=khs default_final=None 语义）；嵌套全 {1,1} 除 `p01_hook.topic_kernel`
  （final=1、pre 共享扁平=3）；`p09_shotlist.shot_list` 带 note「转场随分镜表候选整体」
  （transition 无独立键）；bgm/foley `unwired:true`；p11_video `gpuHint:true`。
- `LOCKED_CONFIG_KEYS`：tts 单列（reason 含「钉死 1」）+ reportAudit 汇总
  `{ count: 18 }`（不逐键枚举——RESEARCH F 防新漂移面建议）+ `LOCKED_KEYS_TOTAL = 19`
  （UI-SPEC「30」按漂移修正③改 19）。
- `TYPE_DOMAIN` 三域全量表（keyframe∈setting 等 UI-SPEC L1 全量）+ `domainOfType` 兜底 media。
- `PHASE_BY_SUBTYPE`：按 `<interfaces>` 裁定映射逐键落（rapid_preview→P10、
  delivery_package→P13+reportAudit:true、unknown 不入表）。
- `clampRedundancy`：khs `_vision_review.py:87-91` 逐字（pre≥1；final=clamp(1,final,pre)）。

### Task 3 · 纯函数单测（commit 9f81c0da）

- `groupCanvasLinkage.test.ts`（25 用例）：getGroupKey 分层全分支（keyframe `_v\d+$` 剥后缀、
  costume_design episode+scene 细分、baseline_tr 三路、bible/voice/concept 兜底、场景三 type、
  `${type}:${name}` 兜底、meta 非 JSON 防御）；**a-oasset 反查回归锁**（仅 a-oasset-{id} 在
  variantNodeIds 也命中——现单前缀实现会漏的缺陷防回归）、winnerNodeId 双前缀分支、
  size=length、resolveAssetNodeId asset- 优先（与节点数组序无关）、判定式组合矩阵关键 5 格
  （SQLite 整数 0/1 经 !! 转换）、isSceneGroup/isVoiceGroup。
- `generationConfigKeys.test.ts`（17 用例）：键数全程序化（嵌套 11/扁平 3/preCap1×5 五键点名/
  unwired×2/合计 14）；transition 无独立键漂移锁；扁平默认值三态断言；嵌套默认值除
  topic_kernel 断言；LOCKED（count=18、reason「钉死 1」、总 19）；TYPE_DOMAIN L1 全量 +
  keyframe→setting + 兜底 media；PHASE_BY_SUBTYPE 抽查；clampRedundancy 四象限。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 修复并发编辑引入的 nodeId=false 缺陷**
- **Found during:** Task 1（与并行 wave 执行者（62-02/62-03）在同一工作树上交错编辑同文件时，
  AssetLibrary.tsx handleLocateOnCanvas 一度出现
  `(a.id != null && resolveAssetNodeId(...)) ?? \`asset-${a.id}\``——id 为 null 时短路值为
  `false` 而非 null/undefined，`??` 不触发兜底，nodeId 会变成布尔 false）
- **Fix:** 改三元 `(a.id != null ? resolveAssetNodeId(...) : null) ?? \`asset-${a.id}\``，
  保留 null-id 防御意图且兜底语义正确
- **Files modified:** AssetLibrary.tsx（已含在 Task 1 commit 内）
- **Commit:** 336b6d21

**2. [Rule 1 - Bug] 测试文件相对路径层级修正**
- **Found during:** Task 3 首次 build（`__tests__/` 深一层，`../../services/canvasApi` 应为
  `../../../services/canvasApi`；vitest 因 type-only import 擦除未拦，tsc 拦下）
- **Fix:** 修正 import 路径
- **Files modified:** `__tests__/groupCanvasLinkage.test.ts`（已含在 Task 3 commit 内）
- **Commit:** 9f81c0da

### 执行环境备注（非偏差，如实记录）

- 本 plan 执行期间，62-02/62-03 的 wave-1 执行者在本工作树**并行**提交（e9796c5e/b73ce3e8/
  f9f8ca90/4a9cbc7a/07fb8cfa，文件集与本 plan 零交叠）。Task 1 的 AssetLibrary.tsx 出现过
  双方编辑交错的中间态，已收敛为单套实现（import 单处、定义单处、语义以 PLAN 为准核对），
  上述缺陷修复即来自该交错期。
- PLAN verify 命令中 `grep "function groupOrder"` 计 0（groupOrder 为 const 箭头函数形态，
  与原 AssetLibrary 形态一致）——三函数定义唯一性以逐函数 grep 验证：
  getGroupKey/getGroupDisplayInfo（function 声明）+ groupOrder（const 声明）各恰 1 处，
  均仅在 groupCanvasLinkage.ts。

## Verification Results

| Gate | Result |
|------|--------|
| Task 1 automated verify（build + 定义唯一 grep + import 计数） | PASS（build exit 0；三函数定义全仓仅 groupCanvasLinkage.ts 一处；AssetLibrary import 恰 1 处） |
| Task 2 automated verify（build + transition 负向 grep + 键数程序化） | PASS（`p09_shotlist.transition` 全文件 0 命中；嵌套 11/扁平 3/preCap1 5/unwired 2/count 18） |
| Task 3 automated verify（vitest ×2 + build） | PASS（42/42 用例绿，build exit 0） |
| `npx tsc --noEmit`（packages/infinite-canvas） | PASS（exit 0） |
| root `npx tsc --noEmit` | PASS（exit 0） |
| 既有回归 serialize + components | PASS（120/120） |
| 全包 vitest | PASS（41 文件 466 用例全绿——含并行执行者新增套件） |

## Auth Gates

None.

## Known Stubs

None——本 plan 产物为纯函数/常量/测试，无 UI 渲染面；bgm/foley 的 `unwired: true` 不是 stub，
是对 khs「占位未接线」实态的常量化标注（读侧显示原因文案，62-06 落地 UI）。

## Notes for Downstream Plans

- 62-02 服务端 `src/lib/generationConfigService.ts` 已在本 plan 执行期间并行落地其
  `GENERATION_CONFIG_KEYS` 拷贝（其文件头已引用本文件路径）——两侧键集相等由
  verify-phase-62 S-门锁最终裁决，非本 plan 门。
- `findVariantGroupForAsset` 返回 `{ groupId, size, winnerNodeId? }`（UI-SPEC C6-2 消费
  `{ id, size }` 形态，62-04 取 `.groupId` 即可）。
- 层级派生纯函数（域分组/单件桶/计数聚合）按裁定仍落 groupCanvasLinkage.ts（62-04），
  TYPE_DOMAIN/PHASE_BY_SUBTYPE 已就位可直接消费。

## Self-Check: PASSED

- 文件存在性：groupCanvasLinkage.ts / generationConfigKeys.ts / 两测试文件 FOUND；
  AssetLibrary.tsx FOUND（modified）。
- Commits：336b6d21 / 0ef05f52 / 9f81c0da 均在 git log FOUND。
- 无 files_modified 之外的文件被本 plan 提交（git show --stat 三 commit 共 5 文件核对）。
