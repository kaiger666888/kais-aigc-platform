---
phase: 51-canonical-write-path-coordination-guard
plan: 05
subsystem: testing
tags: [verify-gate, aggregation, coord-01, isolation-chdir, save-v2, flowgraph-v3, contract-guard]

requires:
  - phase: 51-01
    provides: serializeGraphToV2 + save-v2 保存通道 + v1 路由删除（S1 被测面）
  - phase: 51-02
    provides: store 三 canonical 回写 action + socket/MetaRenderer 接线（S3 被测面）
  - phase: 51-03
    provides: 右键审核/删除 canonical 化 + deleteNode（S2 source-shape 被测面）
  - phase: 51-04
    provides: 12 死文件删除 + legacy 类型清零 + @kais/flowgraph-v3 依赖声明（S4 被测面）
provides:
  - scripts/verify-phase-51.ts — Phase 51 单门聚合契约门（S1-S5 共 46 断言 + forced-failure 自检），exit 0 = phase 51 全部成功标准的自动化部分成立
  - S2 "删除不复活"真实模块集成断言：真 saveFullGraph → 真 saveFullGraph(减节点减边) → 真 loadFullGraph（verify-49 隔离 chdir 范式，生产库零触碰）+ 幂等组
  - .planning/specs/COORD-01-khs2-parallel-coordination.md — khs2 v2.4 并行冲突管理规范（变更面三层限定 + p04/p09 排序约束 + plan 开工 checklist 复制块）
  - ROADMAP.md 架构决策 #4 → COORD-01 spec 引用闭环
  - v1 save 残留消费者收口：agent-sync.js 改打 save-v2（客户端 v1→v2 归一化），两个历史 verify 脚本 DEPRECATED 标注
  - 51-VALIDATION.md 签核（nyquist_compliant: true, approved）
affects: [phase-52, phase-53 VAR-01 排序, 后续涉 kmc 侧 plan（COORD-01 checklist 引用方）, verify-phase-51 作为 milestone 聚合门先例]

tech-stack:
  added: []
  patterns:
    - "GUARD 收尾聚合门：末 plan 把前 N 个 plan 的自动化验证收敛为单一 verify:phase-NN 契约门（grep/source-shape 组 + 真实模块集成组 + forced-failure 自检）"
    - "verify-49 隔离 chdir 范式复用：mkdtemp + 拷贝 package.json + chdir 先于动态 import utils barrel/store，saveFullGraph/loadFullGraph（绑定 db 单例）即在临时文件库上启动"
    - "forced-failure 自检：必失败断言经同一布尔求值路径跑 shadow 数组，输出标 SELF-CHECK 不计入总数，意外 PASS 则整体 exit 1（证明门能真的失败）"
    - "grep 门范围纪律（地雷 #5）：源码 walker 只扫 packages/infinite-canvas/src + src/，按路径段排除 src/routes/canvas/static/ 与 data/web/ 构建产物"

key-files:
  created:
    - scripts/verify-phase-51.ts
    - .planning/specs/COORD-01-khs2-parallel-coordination.md
  modified:
    - package.json（verify:phase-51 注册）
    - .planning/ROADMAP.md（架构决策 #4 补 spec 引用一句）
    - .planning/phases/51-canonical-write-path-coordination-guard/51-VALIDATION.md（签核）
    - scripts/agent-sync.js（canvas_graph 改打 save-v2，carryover 收口）
    - scripts/canvas/verify-save-gates.ts（DEPRECATED 头，注释插入）
    - scripts/verify-phase-39.ts（DEPRECATED 头，注释插入）

key-decisions:
  - "agent-sync.js canvas_graph 路径改打 save-v2 而非删除：实证 khs2 无任何自动化调用方（管线活路径是 plugins/kais_aigc/canvas_sync.py，已走 save-v2），该脚本是文档化的手动工具，客户端复刻被删 v1 路由的归一化逻辑即可保住能力"
  - "两个历史 verify 脚本按 verify-phase-50 D-12 先例 deprecated not deleted（仅注释插入），指向 verify:phase-51 为继任契约门"
  - "e2e 前置（51-02 deviation #4）以文档形式落进 verify-phase-51.ts 头注释：npm run build 重建 dist 后再跑 test:e2e"
  - "forced-failure 自检的反向 COORD-01 断言依赖 spec 存在——spec 落地前会意外 PASS，属同 run 内 Task 1→2 排序的预期瞬态，Task 2 后稳定"

requirements-completed: [WRITE-01, WRITE-02, WRITE-03, WRITE-04, COORD-01]

duration: 35 min
completed: 2026-08-21
---

# Phase 51 Plan 05: 聚合契约门 + COORD-01 成文 Summary

**verify-phase-51.ts 单门收敛 Phase 51 全部自动化验证（S1 保存通道 / S2 右键审核删除含"删除不复活"真 saveFullGraph→loadFullGraph 集成断言 / S3 canonical 回写 / S4 死代码与依赖 / S5 COORD-01，46 断言 + forced-failure 自检），COORD-01 并行冲突规范成文并闭环 ROADMAP 引用，v1 save 三个残留消费者收口，全量回归（双包 vitest 202+118、e2e 40/40、双根 tsc、vite build、聚合门 exit 0）全绿，51-VALIDATION 签核。**

## Performance

- **Duration:** 35 min
- **Started:** 2026-08-21T09:25Z
- **Completed:** 2026-08-21T10:00Z
- **Tasks:** 3（+ 1 个 carryover 收口提交）
- **Files modified:** 8（2 新建 / 6 修改）

## Accomplishments

- **聚合门落地（Task 1）**：`scripts/verify-phase-51.ts` 46 断言——S1 保存通道 8 断言（canvasToFlowGraph 源码 0 命中、v1 路由/挂载消失、save-v2 接线、handleSave toast、serialize.ts 全 import type、adapter error→failed）；S2 右键审核删除 4 source-shape + 8 集成断言（真 saveFullGraph → 减节点减边再 save → 真 loadFullGraph：被删节点与其边不复活、其余节点 data 逐字节相等、同图二次 save → load 零 diff 幂等）；S3 canonical 回写 4 断言；S4 死代码/依赖 18 断言（12 文件 gone、红线 NodeBadges/ScoreMiniBar 存在、4 legacy 类型 0 命中、@kais/flowgraph-v3 declared）；S5 COORD-01 3 断言；forced-failure 自检证明门 fail-path 是活的。零逻辑重实现（无 INSERT/UPDATE 直写），隔离 chdir 逐行复刻 verify-49（chdir L83 先于动态 import L203/205），生产 data/db2.sqlite 运行前后 mtime 不变（14:39:49 实证）。`verify:phase-51` 注册进 package.json。
- **COORD-01 双落地（Task 2）**：`.planning/specs/COORD-01-khs2-parallel-coordination.md` 成文——①变更面限定 field-map/canvas_sync/manifest schema 三层（受保护面：kmc 22 phases 内部算法）；②p04/p09 输出字段映射排在 khs2 v2.4 Phase 25 验收后（Phase 53 VAR-01 前置的规范出处）；③plan 开工 checklist 复制块（工作树干净 `git -C /data/workspace/kais-hermes-skills status --porcelain` 为空 / 上游同步 / 变更面自查 / 排序自查）。ROADMAP.md 架构决策 #4 末尾补 spec 引用。gsd-plan-phase skill 未动（用户级共享 skill 裁定遵守）。
- **全量回归 + 签核（Task 3）**：infinite-canvas vitest 202/202、`npm run build`（tsc -b + vite build）后 e2e 40/40、flowgraph-v3/ts vitest 118/118、根 tsc exit 0、verify:phase-51 46/46 exit 0；51-VALIDATION.md nyquist_compliant: true、status: approved、验证表全 ✅ green、sign-off 清单按实际勾选。
- **carryover 收口**：agent-sync.js 改打 save-v2（客户端 v1→v2 归一化，镜像被删路由逻辑）；verify-save-gates.ts / verify-phase-39.ts 加 [DEPRECATED — Phase 51] 头（D-12 先例，注释插入不删除）。

## Task Commits

1. **Task 1: verify-phase-51.ts（S1-S5 + forced-failure 自检）+ npm 注册** — `d1b3d4c3` (test)
2. **Task 2: COORD-01 规范成文 + ROADMAP 引用** — `19bc799b` (docs)
3. **Carryover: v1 save 消费者收口（agent-sync.js + 两 verify 脚本 DEPRECATED）** — `e6d17cff` (fix)
4. **Task 3: 全量回归 + 51-VALIDATION 签核** — `1d1ca372` (test)

## Files Created/Modified

- `scripts/verify-phase-51.ts` — Phase 51 聚合契约门（S1-S5 + forced-failure 自检；头注释载 e2e dist 重建前置）
- `.planning/specs/COORD-01-khs2-parallel-coordination.md` — khs2 v2.4 并行冲突管理规范 + checklist 复制块
- `package.json` — `verify:phase-51` 注册（对齐 verify:phase-50 行）
- `.planning/ROADMAP.md` — 架构决策 #4 补 COORD-01 spec 引用一句
- `scripts/agent-sync.js` — syncCanvasGraph 改打 `/api/canvas/v2/save-v2` + 客户端 v1→v2 归一化
- `scripts/canvas/verify-save-gates.ts`、`scripts/verify-phase-39.ts` — [DEPRECATED — Phase 51] 头（仅注释插入）
- `51-VALIDATION.md` — approved + nyquist_compliant: true + 验证表/sign-off 全绿

## Decisions Made

- **agent-sync.js 改打而非删除**：调查实证——khs2 全仓无任何脚本/py/sh 自动化调用 agent-sync.js（管线活同步路径是 `plugins/kais_aigc/canvas_sync.py`，本就走 save-v2）；该脚本是 AGENT_SYNC_README 文档化的手动工具，客户端复刻被删 v1 路由的 v1→v2 归一化（nodes/links/branches/variantGroups 构造）即可保住 `canvas_graph` 能力，行为与被删路由的服务端归一 + zod/结构化参数门 parity。
- **e2e 前置走文档**：carryover 允许"gate 或其文档"记录前置——落进 verify-phase-51.ts 头注释（test:e2e 服务 dist 而非源码，须先 `npm run build`），聚合门本身不跑 e2e。
- **forced-failure 自检的反向 COORD-01 断言**依赖 spec 文件存在，Task 1 提交时（spec 未落地）会意外 PASS——属同 run 内排序的预期瞬态，Task 2 后稳定为 expected-FAIL。

## Deviations from Plan

### Auto-fixed Issues

**1. [Criterion 排序澄清] Task 1 acceptance "verify exit 0" 依赖 Task 2 的 S5 产物**
- **Found during:** Task 1 acceptance
- **Issue:** plan 把 S5（COORD-01 spec 存在性）编进 Task 1 的 verify 脚本，但 spec 文件由 Task 2 创建——Task 1 提交点 verify 必然 S5 红（42/46）
- **Fix:** 按 plan 任务序执行：Task 1 提交时 S1-S4 全绿 + 自检机制验证（含反向 COORD-01 断言意外 PASS 的瞬态），Task 2 落地 spec 后复跑 46/46 exit 0，Task 2/3 的 acceptance（复跑 exit 0）均满足；最终态全部 acceptance 成立
- **Files modified:** 无（排序如实记录）
- **Verification:** Task 1 后 42/46（S5×3 + 自检×1 红，预期）；Task 2 后 46/46 exit 0；Task 3 全量回归再确认

---

**Total deviations:** 1 criterion 排序澄清（零代码偏差）
**Impact on plan:** 无范围蔓延；最终态与 plan 全部 acceptance/verification/success_criteria 一致。

## Issues Encountered

- **批量 insert 担忧证伪**：verify-49 曾记录"appDb pool 上 knex 批量 insert 不落settle"（49-01 教训），saveFullGraph 的 chunkedInsert 正是批量路径——先写探针脚本实证：隔离 chdir boot 后 3 节点批量 upsert 4ms 完成、save→save(减 X)→load 结果精确（该教训特指同进程长驻 :memory: section 与 app-db 共存的情形，本脚本无 :memory: section，单进程临时文件库无此问题）。探针文件用后已删。

## COORD-01 Checklist 首用示范（plan 接口区要求记录）

本 plan 不触碰 kmc 侧任何文件（全部变更在 kais-aigc-platform 仓内），checklist 执行结果：

- **kais-hermes-skills 工作树干净**：`git -C /data/workspace/kais-hermes-skills status --porcelain` 输出 **96 行（不干净）**——属 khs2 v2.4 进行中的工作，本 plan 零 kmc 侧变更故无踩踏；此结果恰好演示 checklist 的预警价值（若本 plan 涉及 kmc 侧，此处即应停手确认归属）。
- **与上游同步确认**：N/A（不读不写 kmc 契约面）。
- **变更面自查**：N/A（kmc 侧改动为零，天然满足"只碰契约/映射层"）。
- **排序自查**：N/A（不涉及 p04/p09 输出字段映射）。

## User Setup Required

None - no external service configuration required.

## 人工待办（显式交接，不自动执行）

1. **重跑 `scripts/deploy-canvas.sh`（地雷 #5，51-03/51-04 同款提醒）**：线上 SPA（`data/web/infinite-canvas`）与 `src/routes/canvas/static` 旧 bundle 仍调 v1 `/canvas/save`，路由已删，不重部署则线上保存 404。本 plan 已 `npm run build` 重建 dist，但 dist → data/web 的部署是人工步骤。
2. **保存失败 toast 视觉确认（51-VALIDATION Manual-Only）**：断网/停后端后点保存，确认 error toast 弹出（WRITE-01 成功标准 1 的 UI 视觉部分）。

## Next Phase Readiness

- Phase 51 全部成功标准自动化部分由 `npm run verify:phase-51` 单门收敛（exit 0）；Phase 52（生成-迭代闭环）可在 canonical 写路径地基上开工
- COORD-01 checklist 可复制进 Phase 53+ 涉 kmc 侧 PLAN.md；Phase 53 VAR-01 开工前须确认 khs2 v2.4 Phase 25 验收完成（排序约束 ②）
- 后续 phase 若再动画布交互行为，须先 `npm run build` 再跑 `npm run test:e2e`（51-02 教训已写入 verify 头注释）
- Phase complete, ready for next step（v3.0 ROADMAP → Phase 52）

## Self-Check: PASSED

- [x] key-files 全部存在于磁盘（verify-phase-51.ts、COORD-01 spec 新建已提交）
- [x] `git log --grep="51-05"` = 4 commits（d1b3d4c3 / 19bc799b / e6d17cff / 1d1ca372）
- [x] 全部 acceptance_criteria 重跑通过：
  - Task 1: `npm run verify:phase-51` 46/46 exit 0；data/db2.sqlite mtime 运行前后不变（2026-08-21 14:39:49）；chdir(L83) 先于动态 import(L203/205)；`grep -c 'INSERT INTO\|UPDATE '` = 0；根 tsc exit 0；package.json 含 verify:phase-51
  - Task 2: spec 存在且含三层限定/排序约束/checklist/`git -C ... status --porcelain` 原文；ROADMAP 引用 grep ≥ 1；复跑 verify exit 0
  - Task 3: 双包 vitest 202+118、e2e 40/40（build 后）、双根 tsc、vite build、verify:phase-51 全 exit 0；51-VALIDATION nyquist_compliant: true 无 pending 行；人工待办两项已显式标注
- [x] plan 级 verification 全绿；carryover 三项全部 disposition（①收口提交 e6d17cff ②verify 头注释 ③人工待办交接）

---
*Phase: 51-canonical-write-path-coordination-guard*
*Completed: 2026-08-21*
