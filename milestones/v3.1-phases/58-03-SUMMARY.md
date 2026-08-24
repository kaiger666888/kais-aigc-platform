---
phase: 58-full-recipe-persistence
plan: 03
subsystem: e2e-testing
tags: [playwright, e2e, recipe-roundtrip, delete-propagation, lora-structure, mock-backend, save-v2-injection]

# Dependency graph
requires:
  - phase: 58-full-recipe-persistence plan 01
    provides: 九键 round-trip 数据通道（serialize 写回 + delete 传播 + migrate 全集提取）——本 plan 断言的被测语义
  - phase: 58-full-recipe-persistence plan 02
    provides: PromptSection 高级参数折叠区编辑器 + UI-SPEC §7 全量 testid 契约（断言选择器来源）
provides:
  - phase58-recipe.mjs 8 用例：RECIPE-01（编辑往返三层）/RECIPE-02（regen 请求体整袋）/RECIPE-03（保留·清空·结构三面）行为级证明
  - save-v2 POST fixture 注入范式落地（Pitfall 6：mock DEFAULT_NODES 无高级字段，注入节点带 steps/cfg/quant/sageAttention/lora 全套）
  - 62 e2e 基线扩为 70 用例/14 文件全绿
affects: [58-04-verify-phase-58]

# Tech tracking
tech-stack:
  added: []  # 零新依赖
  patterns:
    - "fixture 注入即测试基底：每用例 save-v2 POST 写带全套配方字段的单节点 graph → page.reload → migrate 全集提取——禁对 DEFAULT_NODES 直断高级字段（Pitfall 6）"
    - "两段式 expect.poll：先等 /__mock/state wire 值落盘再断言面板/canonical（Pitfall 3 graph:saved 同屏回读时序）"
    - "落选用例 fixture 给 winner 配高级字段：只断言 disabled + 锁死文案，不断言落选自有配方（Pitfall 7 折叠语义预存，不试图修）"

key-files:
  created:
    - packages/infinite-canvas/test/e2e/tests/phase58-recipe.mjs
  modified:
    - packages/infinite-canvas/test/e2e/tests/phase57-deeplink.mjs  # deviation: navbar 6→5 stale assertion

key-decisions:
  - "每条 test 独立注入 fixture（loadCanvas → save-v2 POST → reload）而非 beforeAll 共享——串行 workers:1 下天然隔离，mock reset 语义不破坏"
  - "lora 增删用例在两次保存间以 toHaveValue 等待 graph:saved 回读重置 draft 后再点删行——防删行点在 React 重渲染前"
  - "落选只读断言 param-input-steps 值 = winner 配方 44（Pitfall 7 折叠语义的证据化，而非回避）"

patterns-established:
  - "Pattern: 高级字段 e2e 断言一律先 click advanced-toggle（默认收起契约，UI-SPEC §7）——openAdvanced helper 收敛该纪律"

requirements-completed: [RECIPE-01, RECIPE-02, RECIPE-03]

# Metrics
duration: 25 min
completed: 2026-08-23
---

# Phase 58 Plan 03: 全配方持久化 e2e Summary

**phase58-recipe.mjs 8 用例三层断言（wire /__mock/state + execute 请求体 + canonical getGraph）锁死全配方闭环：save-v2 注入带全套高级字段 fixture → 编辑往返 reload 保真 → regen 请求体整袋透传 → 清空 delete 传播不复活 → 空 lora undefined 非 [] → 落选只读；全量 e2e 70/70（62 基线+8 新增）零回归**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-23T13:13:34Z
- **Completed:** 2026-08-23T13:39:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- phase58-recipe.mjs 新建（416 行 / 8 test）：fixture 注入范式（Pitfall 6）+ openDetailPanel/openAdvanced/wireNodeData/canonicalParams 四 helper
- RECIPE-01 三层齐备：①wire 层 save-v2 反写 data.steps/cfg/lora ②canonical 层 getGraph() EventNodeV3.params ③page.reload 往返重开面板值保持（REGEN-01-b 同款）
- RECIPE-02 请求体整袋：仅编辑 steps=50 → 重生成 → body.params.steps===50 且未编辑 quant==='fp8'/cfg===7/sageAttention===true/lora 深等于初始值（窄通道不再丢弃的整袋 spread 证明）
- RECIPE-03 三面：lora 行增删 wire 结构保真（{name,strength}）；清空 steps → wire 键消失 + reload canonical 不复活（delete 传播 e2e 防线，Pitfall 1）；删光 lora → data.lora===undefined 非 []（Pitfall 2）+「暂无 LoRA」空态
- 落选只读：advanced 控件随整块 disabled（含 lora-remove/lora-add）+「落选变体」锁死文案 + 保存/重生成 disabled
- 全量回归：npm run build → test:e2e **70/70 全绿**（14 文件 = 13 基线 + 1 新增）；phase52-regen 全绿 = 本 phase 未改 regen 通道的证明

## Task Commits

1. **Task 1: fixture 注入 + 编辑保存 reload 往返用例组（RECIPE-01/03）** - `0b3cab61` (test)
2. **Task 2: regen 请求体整袋断言 + 清空 delete 传播 + 落选只读 + 全量回归（RECIPE-02/03）** - `2ce55b0c` (test)

**Deviation fix:** `69fd1ae2` (fix) — phase57-deeplink navbar 陈旧断言

**Plan metadata:** 见本文件提交（docs）

## Files Created/Modified

- `packages/infinite-canvas/test/e2e/tests/phase58-recipe.mjs` — 新建：8 用例（A wire/canonical/reload 三层编辑往返、B lora 结构、C regen 请求体、D 清空 delete 传播、E 空 lora 归一化、F 落选只读）+ save-v2 注入 fixture + loserVariantGraph
- `packages/infinite-canvas/test/e2e/tests/phase57-deeplink.mjs` — expectCompactNavbar toHaveCount(6)→(5) + 注记（deviation，见下）

## Verification Results（plan-level）

- `npm run build`（packages/infinite-canvas）✓——e2e 测 dist 纪律（Pitfall 5/地雷 #10），本 plan 全程跑最新构建
- `npx playwright test phase58-recipe`：**8/8 全绿**（workers:1，:9876 mock）
- `npm run test:e2e` 全量：**70 passed / 14 文件**（62 基线 + 8 新增；含 phase52-regen 4/4 = regen 通道零回归）
- acceptance grep 复核：test 计数 8；`params?.steps/quant/lora` 4 处命中；toBeUndefined 3 处（清空不复活）；`not.toHaveProperty('lora')` 1 处（非 [] 归一化）；「落选变体」4 处；toBeDisabled 10 处；save-v2/advanced-toggle//__mock/state/getGraph() 全命中

## Decisions Made

- 每条 test 独立注入 fixture（而非 beforeAll 共享）：mock reset 语义天然隔离，且 loser 变体用例需要不同 fixture 基底
- lora 增删用例两次保存间以 toHaveValue 等待 graph:saved 回读重置 draft 再点删行，消除重渲染竞态
- 落选用例给 winner（而非 loser）配高级字段并断言只读面板显示 winner 配方值 44——Pitfall 7 折叠语义的证据化断言，plan 要求的 disabled + 锁死文案之外的最小增强

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - 全量门假红] phase57-deeplink navbar 断言 6→5（Toonflow 下线后陈旧）**
- **Found during:** Task 2（全量 test:e2e 回归首跑）
- **Issue:** `expectCompactNavbar` 断言 `toHaveCount(6)`（品牌 KAP + 5 项，phase57 UI-SPEC P-1 词表）；b8be598a（2026-08-23 16:34 +0800，「下线 Toonflow 旧工作台」）把 kap-nav.ts NAV_ITEMS 缩为 4 项（源注释自记「Toonflow 项 2026-08-23 下线」），:10588 已部署新导航 → 断言永久假红（case A/C 双红）。phase57-deeplink 自 b8be598a 后无人跑过，58-03 全量首跑即触发——预存失败，非本 plan 引入
- **Fix:** toHaveCount(6)→(5) + 行内注记（品牌 KAP + 4 项 − Toonflow）——Phase 48「旧断言随现实更新并注记」先例、58-01 verify 门 S4/S5 同款
- **Files modified:** packages/infinite-canvas/test/e2e/tests/phase57-deeplink.mjs
- **Verification:** phase57-deeplink 3/3 绿；全量 70/70 绿
- **Committed in:** 69fd1ae2

---

**Total deviations:** 1 auto-fixed（1 × Rule 1 全量门假红）
**Impact on plan:** 不修则本 plan acceptance「全量 ≥62+8 全绿」不可达且假红掩盖真回归。修复外科化（一行 + 注记），无 scope creep。

## Issues Encountered

- **phase55-nav 全量跑间歇性 flake（环境负载，未修）**：全量第 2/3 跑各出现 1-2 条 phase55-nav 时序用例红（new-asset-placement 视口中心 ≤64px / search-navigator `/` 键劫持），每轮失败集不同；隔离复跑 5/5 绿 + repeat-each=3 绿；文件序 phase55 在 phase57/58 之前（不可能被本 plan 测试污染）；当时机器 load 4-9（root python 进程 50% CPU/42% MEM，并行会话负载）。最终全量跑（load 9.37 下）70/70 全绿。判定为预存时序 flake，超出本 plan 范围（SCOPE BOUNDARY），仅记录。

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 58-03 三个 requirement（RECIPE-01/02/03）e2e 行为级证明就位，58-04（verify-phase-58 聚合门 + probe-58-real 真机探针）可直接消费本文件作为 e2e 命令门基底（`npx playwright test phase58-recipe`）
- 全量 e2e 基线更新为 **70 用例/14 文件**——58-04 wave 门与 phase 收口以此为回归基线
- 注意（58-04）：wave 门 `npm run verify:phase-58` 须在 Plan 04 落地后一并跑（本 plan 按计划跳过）；真机探针前需 build → deploy-canvas.sh → build:server → 重启

## Self-Check: PASSED

- created/modified 文件 2/2 在盘（phase58-recipe.mjs 416 行、phase57-deeplink.mjs）
- commits 0b3cab61 / 2ce55b0c / 69fd1ae2 均在 git log
- 全部 acceptance criteria 复跑通过（见 Verification Results）

---
*Phase: 58-full-recipe-persistence*
*Completed: 2026-08-23*
