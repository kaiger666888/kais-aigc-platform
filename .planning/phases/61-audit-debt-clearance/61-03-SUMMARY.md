---
phase: 61-audit-debt-clearance
plan: "03"
subsystem: testing
tags: [flowgraph-v3, migrate, buildMeta, meta-roundtrip, vitest, zod, serialize]

# Dependency graph
requires:
  - phase: 51-canonical-write-path-coordination-guard
    provides: serialize.ts flattenMeta 写侧摊平（零改动，本 plan 只补读侧）+ 51-REVIEW I1 finding 登记
  - phase: 58-recipe-roundtrip-channel
    provides: serializeGraphToV2 rawDataByNodeId 通道语义（raw=null 纯 flattenMeta 档）
provides:
  - buildMeta 四分支（script/storyboard/video/global）5 个持久化字段读回（emotion/promptMeta/murchGrade/archetype/viewAngle）——save→reload meta 往返保真（DEBT-03 / 51-REVIEW I1 销账）
  - flowgraph-v3 migrate.test 六用例（五字段分 stage + audio string 回归锁 + 负向）
  - infinite-canvas serialize.test 集成往返用例（adapt∘serialize，rawDataByNodeId=null 最严格档，canonical meta 层断言）
  - v2types FlowNodeV2Data 诚实 wire 契约（emotion 双类型 string|number + 4 个新消费字段声明）
affects: [61-05 聚合门（五句式计数静态锁 S4）, 无限画布 reload 链路, 未来 meta 字段扩展]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "buildMeta 条件展开读回句式 ...(d.X != null ? { X: d.X } : {})（61-03 扩至 5 字段；emotion 双类型加 typeof 守卫零 cast）"
    - "往返断言 canonical meta 层 + rawDataByNodeId=null 档（raw 透传假绿防线，Pitfall 4）"
    - "变异实证：pre-fix migrate.ts 下新用例必红（4 单测 + 1 集成）后还原"

key-files:
  created: []
  modified:
    - packages/flowgraph-v3/ts/src/migrate.ts
    - packages/flowgraph-v3/ts/src/v2types.ts
    - packages/flowgraph-v3/ts/tests/migrate.test.ts
    - packages/infinite-canvas/src/v3/__tests__/serialize.test.ts

key-decisions:
  - "读回修复在 migrate 层 buildMeta 分支内（非客户端 post-hoc 补丁）——V3 直通/fixture 图无 rawData 袋，客户端补丁救不了"
  - "emotion 双类型 typeof 守卫（script=number/audio=string）替代 cast——静态网保留，zod strict 判别联合仍是回归网"
  - "v2types 声明新消费字段（文件自身「迁移消费字段进 meta」区块惯例）而非 migrate 层 cast 读取"

patterns-established:
  - "wire 双类型字段契约声明在 v2types（union 类型），migrate 分支读回用 typeof 守卫窄化"

requirements-completed: [DEBT-03]

# Metrics
duration: 12min
completed: 2026-08-24
---

# Phase 61 Plan 03: buildMeta 5 字段读回 Summary

**flowgraph-v3 migrate.ts buildMeta 四分支补 5 个持久化字段读回（script.emotion(number)/storyboard.promptMeta/video.murchGrade/global.archetype+viewAngle），双面测试锁死（单元 6 用例 + adapt∘serialize 集成往返 raw=null 档），三面（两包 vitest 424+139 + root tsc）全绿。**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-24T05:27:40Z
- **Completed:** 2026-08-24T05:39:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- DEBT-03 / 51-REVIEW I1 销账：写侧 flattenMeta 摊平无缺口、读侧 buildMeta 漏拣导致 save→reload 后 meta 5 字段静默丢失——读侧缺口在 migrate 层补齐（修复发生在数据层，V3 直通/fixture 图同样保真）
- 双类型契约锁死：script meta emotion 是 number、audio（voice/foley/bgm）meta emotion 是 string，两侧均有 typeof 正断言；zod strict 判别联合零改动继续当类型错配回归网
- 集成级证据：adapt∘serialize 往返用例断言全部打在 canonical meta 层（back.graph.nodes[i].meta.*），serializeGraphToV2 第二参传 null（无 raw 袋兜底才暴露真读侧缺口，Pitfall 4 假绿防线）
- 变异实证测试有效性：临时还原 pre-fix migrate.ts，新增 4 个单元用例 + 1 个集成用例必红，还原后全绿

## Task Commits

Each task was committed atomically:

1. **Task 1: buildMeta 四分支 5 行读回 + flowgraph-v3 六用例** - `fd280475` (fix)
2. **Task 2: infinite-canvas 集成往返用例(raw=null 档) + 三面收口** - `5f30bc96` (test)

**Plan metadata:** (见下方 final commit)

## Files Created/Modified
- `packages/flowgraph-v3/ts/src/migrate.ts` - buildMeta 四分支各补 1-2 行条件展开读回（含 emotion 双类型 typeof 守卫）
- `packages/flowgraph-v3/ts/src/v2types.ts` - FlowNodeV2Data 声明 promptMeta/murchGrade/archetype/viewAngle + emotion 诚实双类型（string | number）
- `packages/flowgraph-v3/ts/tests/migrate.test.ts` - 新增 describe「DEBT-03 buildMeta 5 字段读回(61-03)」六用例（a-f），逐例过 validateFlowGraphV3
- `packages/infinite-canvas/src/v3/__tests__/serialize.test.ts` - 新增五节点往返保真 it（raw=null 最严格档，canonical meta 层断言）

## Decisions Made
- 读回修复落 migrate 层 buildMeta 分支内（51-REVIEW I1 suggested fix 同裁定）——任何客户端 post-hoc 补丁对无 rawData 袋的 V3 直通/fixture 图无效
- emotion 双类型用 typeof 守卫窄化而非 `as` cast——计划明令勿 cast；守卫让 tsc 静态网继续生效（cast 会把它关掉），错配值宽容降级不进 meta（与 stale 畸形降级风格一致）
- v2types 按文件自身惯例声明新消费字段——migrate.ts 里 cast 读取（仓库对 thumbnailPath/stale 的旧做法）会让 tsc 对 5 字段全失明

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] v2types.ts 声明 4 个新消费字段 + emotion 拓宽为 string | number**
- **Found during:** Task 1（补丁实现时）
- **Issue:** 计划只列 migrate.ts/两测试文件，但 promptMeta/murchGrade/archetype/viewAngle 未在 FlowNodeV2Data 声明——经 index signature 解析为 `unknown`，`{ promptMeta: d.promptMeta }` 不满足 `PromptFacets | undefined`，tsc 必红；且计划自带的测试构造 `data:{emotion: 7}` 在声明的 `emotion?: string` 下同样无法编译
- **Fix:** 按该文件「以下为迁移消费的描述性字段（进 meta，非配方）」区块的既有惯例声明四字段；emotion 拓宽为诚实双类型 wire 契约（script=number / audio=string，注释锚定 Pitfall 3）
- **Files modified:** packages/flowgraph-v3/ts/src/v2types.ts
- **Verification:** ts 包 typecheck exit 0 + root `tsc --noEmit` exit 0 + 139/139 vitest
- **Committed in:** fd280475（Task 1 commit）

**2. [Rule 3 - Blocking] emotion 读回两行加 typeof 守卫（audio 行被迫触碰）**
- **Found during:** Task 1（补丁实现时）
- **Issue:** 计划要求照抄 L284 句式 `...(d.emotion != null ? { emotion: d.emotion } : {})` 且「audio 分支不动」——但 wire 类型诚实化后 `string | number` 对 script 分支目标 `emotion?: number` 与 audio 分支目标 `emotion?: string` 均不可赋值，裸句式无法过 tsc；cast 又被计划明令禁止
- **Fix:** 两行各加 typeof 守卫：script `d.emotion != null && typeof d.emotion === 'number'`、audio `d.emotion != null && typeof d.emotion === 'string'`。对全部合法 wire 数据语义零变化；grep 五句式模式（`d.emotion != null` 等）仍命中 6 行（emptions×2 + 其余×1），满足验收与 61-05 聚合门 S4 计数锁
- **Files modified:** packages/flowgraph-v3/ts/src/migrate.ts
- **Verification:** typecheck 双绿；用例 a/e 的 typeof 正断言绿；pre-fix 变异下用例 a 红（守卫存在不掩盖修复缺口）
- **Committed in:** fd280475（Task 1 commit）

**3. [Rule 3 - Blocking] 恢复 flowgraph-v3 缺失的 vitest bin 符号链接（环境修复，非源码）**
- **Found during:** Task 1（跑包测试时）
- **Issue:** `cd packages/flowgraph-v3 && npm test`（计划 verify 命令，也是 61-05 聚合门将跑的命令）报 `vitest: not found`——vitest 包本体已装在 ts/node_modules，但 `.bin/vitest` 符号链接缺失（8 月 21 日安装残留缺陷，与本 plan 无关）；且 npm 脚本 PATH 只含包根 node_modules/.bin，不含 ts/ 子目录
- **Fix:** 补两条符号链接（ts/node_modules/.bin/vitest → ../vitest/vitest.mjs；包根 node_modules/.bin/vitest → ../../ts/node_modules/vitest/vitest.mjs）。零网络、零 lockfile、node_modules 均被 .gitignore 覆盖（git check-ignore 已验证）
- **Files modified:** node_modules 符号链接×2（不进 git）
- **Verification:** `npm test` 139/139 绿；git status 无新增脏文件
- **Committed in:** 无需提交（环境态，不在版本控制内）

---

**Total deviations:** 3 auto-fixed (3 blocking)
**Impact on plan:** 前两项为 tsc 静态网与计划自身测试代码可编译的必要前提（计划漏核 v2types 声明面），第三项为预存环境缺陷的最小修复。零范围蔓延——修复语义与计划真值完全一致（5 字段 migrate 层读回 + 双类型契约锁死）。

## Issues Encountered
- 无阻塞问题。变异实证按 61-02 文化主动执行：`git show HEAD~1:migrate.ts` 临时还原 → 新用例 4+1 红 → `git checkout -- migrate.ts` 还原 → 全绿（证明测试真能咬住缺口，非假绿）。

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DEBT-03 双面证据在位（单元 + 集成），61-05 聚合门 S4 可对五句式做计数静态锁（grep -c = 6：emotion×2 含 typeof 守卫复合条件 + promptMeta/murchGrade/archetype/viewAngle 各 1）与 forced-failure 变异样本（本 SUMMARY 变异实证方法可直接复用）
- META_PATCHABLE_KEYS（canvasStore）与 zod/types 两侧对 5 字段早已在场——本 plan 后写侧/读侧/store patch 白名单三层对齐
- `cd packages/flowgraph-v3 && npm test` 环境已修复可用

---
*Phase: 61-audit-debt-clearance*
*Completed: 2026-08-24*

## Self-Check: PASSED

All 4 modified source files exist; both task commits (fd280475, 5f30bc96) verified in git log.
