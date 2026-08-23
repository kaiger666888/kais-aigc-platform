---
phase: 60-post-save-panel-persistence
plan: "01"
subsystem: testing
tags: [diagnosis, roundtrip, id-stability, zustand, vitest, probe, zero-footprint]

requires:
  - phase: 59-narrow-trigger-stale-cascade
    provides: probe-59-real 零足迹范式(SCOPES/MIGRATE_SUPPORTED/stripUpdatedAt/捕获-恢复 finally) + cascadeFixtureGraph
provides:
  - scripts/diagnose-60-roundtrip.ts — 可重复真机 save→reload roundtrip 三层 id-diff 探针(--strict 门/exit 2 SKIP 契约,60-05 dispatch 复用)
  - packages/infinite-canvas/src/store/__tests__/reloadAnchor.test.ts — store 重锚 survive/collapse/other-anchor vitest 基底(60-03 Branch A 扩为永久锁)
  - 60-DIAGNOSIS.md — 根因裁定 + A/B 修复分支(60-03 的分支选择器)
affects: [60-03 (branch selector 消费), 60-05 (probe 复用), PANEL-02]

tech-stack:
  added: []  # 零新依赖(RESEARCH 承诺兑现;tsx/vitest 均既有 devDep)
  patterns:
    - "computed-specifier dynamic import: root tsc(node10)不解析 @kais/flowgraph-v3 exports-only 包时,根脚本以模板字符串动态 import 生产模块——tsc 静态不进 packages 程序图保持根 tsc 干净,tsx 运行时经 symlink 正常解析(verify-59-dispatch 相对直连先例的推广)"
    - "三层 id-diff 诊断法: V2 服务端重组层/V3 客户端全链层/evt_* 重合成层逐层差集 + wire→loadC 归因器(区分服务端漂移 vs 客户端折叠)"

key-files:
  created:
    - scripts/diagnose-60-roundtrip.ts
    - packages/infinite-canvas/src/store/__tests__/reloadAnchor.test.ts
    - .planning/phases/60-post-save-panel-persistence/60-DIAGNOSIS.md
  modified: []

key-decisions:
  - "Prong 1 实测 :10588 scope 2/1(31 节点)三层 id 差集全 0/0(层2 62v62 含 31 evt 全等;层3 evt 31v31)+恢复深比对全等 exit 0 —— 候选①(vm id 派生往返不对称)三层证伪"
  - "Prong 2 行级静态:FlowCanvas L1048/L1265 面板渲染点无 loading 门;L956 `loading && !hasData` 仅首载生效(hasData 全仓无回退 false 调用点);loadInitialGraph L477-493 无清锚 —— 候选②(loading 卸载闪断)不成立"
  - "候选③残留路径登记: fixtureSource.ts L99-111 loadBackend throw 时 decompose fixture 整图换入→锚必失;结构性在场但需 reload 期 load-v2 瞬时 throw,非系统性症状源,本 phase 不修(越 A/B 框架)"
  - "裁定规则逐字执行: Prong1 零漂移 + Prong2 ②不成立 → Branch A(60-03 仅锁零生产修复);用户可感症状根治在 60-02 D-01 自回声跳过(正交 workstream)"
  - "requirements.mark-complete 跳过: 本 plan 是 PANEL-02 的诊断面而非交付面,需求由 60-03+ 落地后才能 validated(诚实记账,不提前勾选)"

patterns-established:
  - "诊断探针的导入纪律: 见 tech-stack.patterns[0](root scripts 消费 packages 内部 @kais 别名模块的唯一 tsc-clean 通路)"
  - "reloadAnchor 三 case 基底(survive 含 toBe 引用刷新断言/collapse 对称 null/other-anchor-untouched)——60-03 永久锁的扩展点"

requirements-completed: []  # PANEL-02 诊断面落地,需求本体待 60-03+(见 key-decisions)

duration: 15min
completed: 2026-08-24
---

# Phase 60 Plan 01: 诊断先行 — 真机 roundtrip id-diff + store 重锚探针 Summary

**真机 :10588 实测 save→reload 三层 id 零漂移(31 资产+31 evt 全等)+行级静态证伪 loading 卸载假说 → 裁定 Branch A:reload 链锚安全已成立,60-03 仅锁不修,症状根治在 60-02 自回声跳过。**

> **诊断结果摘录(60-03 executor 首读,与 60-DIAGNOSIS.md「最终裁定」逐字一致):**
>
> 「**Pinned cause: ③其他@reload 链锚安全已被三层实证+静态钉死(①id 漂移/②loading 卸载均证伪);自保存后用户可感扰动来自自回声整图 reload 本身(60-02 D-01 自回声跳过即根除);残留低概率收起路径 = loadBackend 瞬时失败时 v3/fixtureSource.ts L99-111 decompose fixture 整图换入(锚必失,结构性在场但需 reload 期 load-v2 throw,非系统性症状源)**」
>
> 「**Fix branch: A(setGraph 语义已对,零生产修复,仅锁)**」

## Performance

- **Duration:** 15 min
- **Started:** 2026-08-23T23:23:24Z(=2026-08-24 07:23 +08)
- **Completed:** 2026-08-24(本地 07:4x +08)
- **Tasks:** 2/2
- **Files modified:** 3(created: 探针脚本/vitest/DIAGNOSIS;生产代码 0 改动——诊断先于修复次序兑现)

## Accomplishments

1. **Task 1 — 真机 roundtrip id-diff 探针(Prong 1):** `scripts/diagnose-60-roundtrip.ts`(probe-59-real 零足迹范式)。实跑 `--strict` 于 :10588(部署产物与源码同步已核):scope 2/1 选定,层1 V2 31v31 双向差集 0/0(锚点 n-p04 同 id 存在)、层2 V3 62v62 差集 0/0、层3 evt_* 31v31 差集 0,恢复原图回存 stripUpdatedAt 深比对全等,exit 0。**候选①三层证伪。**
2. **Task 2 — store 重锚 vitest + 静态裁定(Prong 2):** `reloadAnchor.test.ts` 3/3 绿(survive 含引用刷新 toBe 断言/collapse 对称收起/other-anchor-untouched;原子性 by construction 注记)。静态裁定候选②不成立(行级依据 4 条:渲染点无 loading 门/L956 仅首载/loadInitialGraph 无清锚/卸载唯一触发是 detailNode null=重锚 miss 或用户关闭)。
3. **60-DIAGNOSIS.md:** Prong 1(实测数字+exit code+恢复结论)/Prong 2(裁定+行级依据+候选③残留登记)/最终裁定(Pinned cause + Fix branch 两行,60-03 分支选择器)。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] root tsc 无法静态 import adapter/serialize(@kais 别名解析)**
- **Found during:** Task 1(probe 实测)
- **Issue:** root tsconfig `moduleResolution: "Node"`(node10)不解析 `@kais/flowgraph-v3` 的 exports-only 包声明(TS2307 + 级联 implicit-any)——计划假定的静态 import 会让 `npx tsc --noEmit`(verify 硬门)红;plan (f) 只预案了 tsx 运行时解析失败的场景,未覆盖 tsc 静态门。
- **Fix:** 探针对 adapter/serialize 走 computed-specifier(`${V3_DIR}/adapter`)dynamic import:tsc 静态分析不跟进 packages 程序图(根 tsc 干净),tsx 运行时经 `packages/infinite-canvas/node_modules` symlink 正常解析(实测两层均过)。已在脚本头注释固化该纪律。
- **Files modified:** scripts/diagnose-60-roundtrip.ts(设计期内嵌,无额外 commit)
- **Commit:** 5550a770

**2. [Rule 2 - 缺失关键功能] 层1 补归因器(wire→loadC)与客户端折叠守卫**
- **Found during:** Task 1 编码
- **Issue:** plan 字面层1(loadA vs loadC)会把客户端 serialize 事件折叠混入「服务端重组稳定性」判定,潜在误导向 Branch B;且 wire 若丢节点(折叠)仍会真实落库,违背零足迹最小写纪律。
- **Fix:** 层1 非零时自动加测 wire→loadC 纯透传差集区分归因;wire 节点数 ≠ loadA 时取消真实落库改走内存 roundtrip(adapt(wire))出层2 证据。本次实跑两者均未触发(层1 干净),守卫在位为复跑兜底。
- **Files modified:** scripts/diagnose-60-roundtrip.ts(设计期内嵌)
- **Commit:** 5550a770

### 流程偏差(非代码)

- **requirements.mark-complete 跳过:** plan frontmatter `requirements: [PANEL-02]`,但 60-01 是诊断面(为 60-03 定分支),PANEL-02 本体由 60-03+ 落地;提前勾选 REQUIREMENTS.md 会失真。已在本 SUMMARY key-decisions 记账。

## Auth Gates

None(无认证门槛;:10588 本机直连)。

## Known Stubs

None(诊断产物无桩;探针 SKIP 路径是显式契约非桩)。

## Threat Flags

None(无新增安全面;T-60-01a 捕获-恢复 mitigate 已兑现——恢复深比对全等,T-60-01b 守卫在位,T-60-SC 零新依赖兑现)。

## TDD Gate Compliance

N/A(plan type: execute,非 tdd;Task 2 vitest 是诊断探针基底而非 RED/GREEN 循环——60-03 Branch A 将其扩为永久锁)。

## Self-Check: PASSED

- scripts/diagnose-60-roundtrip.ts / reloadAnchor.test.ts / 60-DIAGNOSIS.md / 60-01-SUMMARY.md 全部 FOUND
- commits 5550a770(Task 1) / fdb6a8ab(Task 2) 全部 FOUND

