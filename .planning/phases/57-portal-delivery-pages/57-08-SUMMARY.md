---
phase: 57-portal-delivery-pages
plan: 08
subsystem: verification
tags: [aggregate-gate, live-probe, playwright, contract-test, goal-backward]
requires: [57-03, 57-04, 57-05, 57-06, 57-07]
provides:
  - verify-phase-57 Part 2 探活聚合（P0 verdict 文档 + H health 门 + P1 门户三路由 + P2 /canvas 302 精确形态 + P3 四岛共脸/navbar 产物/toonflow iframe + P4 Toonflow 共存 + P5 phases 直方图 + registry 22 条）——单命令 48 断言收口四需求
  - portal-probe.mjs headless 真后端探针（playwright @10588：A 门户首页守卫分支 / B 交付页三区块+p13 守卫 / C 深链 round-trip detail-panel+DOM rect 居中）+ npm run probe 接线
affects: [Phase 57 verify 面收口，后续里程碑审计复用]
key-files:
  created: [packages/portal/test/probe/portal-probe.mjs]
  modified: [scripts/verify-phase-57.ts, packages/portal/package.json]
key-decisions:
  - decision: 服务不可达 = FAIL 不跳过（PLAN action 1 字面执行，非 SKIP/LIVE 门控）
    rationale: plan 明文「每条独立 assert 进 harness；服务不可达 = FAIL（不跳过）」；红线路径已实测（KAP_PROBE_BASE 指死端口 → 6 FAIL exit 1）。KAP_PROBE_BASE env 可覆盖 base（探针同款）。
  - decision: 追加 P0 verdict 文档组（fs 级七断言，超出 plan 字面 P1-P5 清单）
    rationale: plan success_criteria「ROADMAP 成功标准 1-4 每句至少一条聚合断言覆盖」——SC1 前半句是书面结论，只探活不断文档则该半句无门禁；57-01 的 grep 验证是一次性的，进 verify 脚本才可重放。
  - decision: P3 画布宿主断 kap-nav.css link、toonflow iframe 断 bundle 级 src:"/"
    rationale: 画布是纯 CSR（curl 时 #root 空，57-03 Deviation 3 已裁定形态；元素本体由 e2e 真浏览器断言）；/toonflow 的 iframe 是 React 运行时渲染，curl 只见壳——降一档到部署 bundle 字符串存在性，宿主形态各自最强断言。
  - decision: probe B 守卫镜像 resolveProjectId 列表序反查（firstProjOfEp 映射）
    rationale: 57-05 Deviation 1 数据现实（多项目共享 ep id）——首版守卫取「第一个 p13>0 的集」与页面反查落到不同项目，真机探针红（video count=0）后修复；守卫只接受反查一致且 p13>0 的集。
  - decision: portal-probe 的 playwright 经根仓 node_modules 解析（packages/portal 零新增依赖）
    rationale: UI-SPEC Registry Safety「零新增依赖」；playwright 已 hoist 在根仓（canvas-real-screenshot.mjs 先例同源浏览器缓存）。
patterns-established:
  - "live 探活进 verify harness：redirect:manual 见 302 原响应 + health 门统一降级 FAIL + 每段独立 assert（可红可绿可重放）"
  - "headless 探针数据守卫：分支决策必须镜像页面自身的数据解析序（反查/直方图），否则守卫与页面落到不同数据即假红"
requirements-completed: [PORTAL-01, PORTAL-02, PORTAL-03, PORTAL-04（聚合验证收口）]
duration: 55 min
completed: 2026-08-22
---

# Phase 57 Plan 08: 聚合验证（verify-phase-57 Part 2 + portal-probe）Summary

四需求成功标准全部进单命令门禁：`npm run verify:phase-57` = Part 1 taxonomy 三方 drift（14 断言）+ Part 2 探活聚合（34 断言）= **48/48 绿**；`npm run probe`（packages/portal）= headless 真后端三 probe **16/16 绿**。Phase 57 verify 面收口。

**Tasks:** 1/1 · **Commits:** 2（b34b37bf Part 2 / 6ed651af probe）· **Files:** 1 created + 2 modified

## 成功标准 → 断言映射表（plan success_criteria 交付物）

| ROADMAP 成功标准 | verify-phase-57 Part 2 | portal-probe（headless 渲染级） |
|---|---|---|
| 1 评估书面结论 + 门户壳路由/导航/项目入口可运行 | P0 verdict 六章节 ×7；P1 三路由 200+「制片门户」+裸 /portal 301 ×7 | probe A：navbar 6 链/当前项=门户/项目分节或空态守卫 ×5 |
| 2 深链跳转画布节点/泳道 + 四岛统一导航任一页抵其余三套 | P2 302 Location 精确形态 + 未知键不回显 ×3；P3 四岛 kap-navbar/产物 200/iframe ×9 | probe C：/canvas 302 → detail-panel 打开 + 目标节点 DOM rect 居中(dist=0.17px) + URL 留 focus ×5；（另有 57-03 e2e 3 case 真浏览器口径） |
| 3 p13 交付页 master.mp4 + 交付清单 + G8 终审 | P1 /deliver/1 200+制片门户；P5 episodes[].phases 直方图 ×2 | probe B：成片/交付清单/终审三区块 +「成片终审」+ p13 守卫分支（video src 非空 ↔ 无成片空态文案）×6；（G8 操作面全分支断言在 57-06 vitest 34） |
| 4 taxonomy 22/16 + review_gate 真实 gate ID + drift 断言 | Part 1 S/T1-T5/F ×14 + P5 registry 22 条 ×1 | —（契约面，无需渲染级） |

## 验证证据（最终电池全记录）

| 门 | 结果 |
|---|---|
| `npm run verify:phase-57` | **48/48 PASS exit 0**（Part 1 ×14 + Part 2 ×34） |
| 红线自测 `KAP_PROBE_BASE=http://localhost:10599 npm run verify:phase-57` | 21/27 passed，**6 FAIL**（H + P1-P5 各段「服务不可达」）exit 1——可红证明 |
| `cd packages/portal && node test/probe/portal-probe.mjs` | **16/16 PASS exit 0**（A×5 + B×6 + C×5；分支日志：A 数据分支 projects=63、B 无 p13 集空态分支、C 真实节点 focus） |
| probe 红线自测（死端口） | FATAL /health 不可达 exit 1；开发中真实红一例：守卫未镜像反查时 video count=0 → 15/17 两 FAIL（修复后转绿） |
| `npm run verify:phase-54 / 55 / 56` | 全 exit 0（54 catalog/fold/ops/live ✓；55 registry ≡ khs ✓；56 七 section ✓） |
| 根仓 `npm run lint`（tsc --noEmit）+ `npx tsc --noEmit` | 双 0 错 |
| `packages/infinite-canvas` `tsc -b` / vitest | 0 错 / **401/401**（37 files） |
| `packages/portal` tsc / vitest | 0 错 / **34/34**（3 files） |
| e2e 三件套（dist 重建后；9876 mock 新起） | **13/13**：phase55-nav 5 + phase56-viz 5 + phase57-deeplink 3 |
| e2e 全套 | **54/56**：唯一 2 fail 均在 `phase52-regen.mjs`——**untracked 并行会话在途文件**（Phase 52-03 两个用例，最近并行提交 1690e36c 领域），非 57 缺口 |
| khs 仓 `git status --porcelain` | **plugins/ 零改动**（脏文件全在 skills/kais-movie-pipeline 并行会话域）——只读纪律保持 |

## Deviations

1. **不可达语义按 plan 字面 = FAIL**（协调指令提及 SKIP/LIVE=1 备选但以「follow plan text」收尾）：无 env 门控；KAP_PROBE_BASE 仅作 base 覆盖（红线自测用）。
2. **P0 verdict 文档组为计划外追加**（7 断言，fs 级）：补齐 SC1 前半句「书面结论」的可重放门禁（见 key-decisions）。
3. **P3 两处宿主形态降档**：画布断 kap-nav.css link（CSR curl 形态）、toonflow iframe 断部署 bundle `src:"/"`（React 运行时渲染）——各自宿主的最强 curl 级断言，元素/iframe 本体由 e2e 与 probe 真浏览器承担。
4. **probe B 守卫首版假红→修**：未镜像 resolveProjectId 反查序时与页面落到不同项目（15/17）；修后当前库无「反查一致且 p13>0」的集 → 活体走无成片空态支（p13-video 支断言在位，数据集门控，分支日志明示）。
5. **P5 用真实路由** `/api/v1/skills/movie-v1/phases`（plan 简写 `/api/v1/skills/phases` 非实存路径）。
6. **phase55-nav placement 用例一次组合跑闪失**：首跑 13 用例中 1 红（≤64px 有界断言）→ 单独重跑 5/5 ×2、三件套重跑 13/13；canvas 自 57-03（256c2262）零提交（git log 证）→ 既有 timing flake，非本期回归。
7. **phase52-regen.mjs 2 fail 为并行会话在途**（untracked 文件 + Phase 52-03 域），按协调指令记录不计 57 缺口。

## 运维注记

- 探针/探活 base 覆盖：`KAP_PROBE_BASE`（默认 http://localhost:10588）；verify 与 probe 同名 env。
- probe A/B 守卫分支随库数据自动切换（空库走空态支，两支都有断言文案——不跳过）。
- Phase 57 至此 8/8 plans 落地，四需求全收口。

---

Ready for phase 收口（verify-work / milestone audit 可直接复跑两命令）。
