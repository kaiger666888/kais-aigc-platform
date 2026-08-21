---
phase: 53
slug: variant-contract-picker-upgrade
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-21
---

# Phase 53 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. **Scope: Wave A only (D-01)** — Wave B (khs field-map + E2E closure) gated on khs2 v2.4 Phase 25 acceptance; its validation contract is written into the Wave B plan, not this file.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^2.1.9 (packages/infinite-canvas, 包内 `npm test`);root 侧契约用 tsx verify 脚本范式(verify-phase-51 同款,node:assert + :memory: knex) |
| **Config file** | `packages/infinite-canvas/vitest.config.*`(既有);root 无 vitest — 契约测试走 verify 脚本 |
| **Quick run command** | `cd packages/infinite-canvas && npx vitest run src/components/variants` |
| **Full suite command** | `npm run verify:phase-53`(+ 包内 `npm test`);e2e 前须 `npm run build`(51-02 已记录前置) |
| **Estimated runtime** | ~180 seconds |

---

## Sampling Rate

- **After every task commit:** 包内 `npx vitest run <相关文件>`(<30s)
- **After every plan wave:** `npm run verify:phase-53` + 包内 `npm test` + 双根 tsc
- **Before `/gsd:verify-work`:** verify:phase-53 全绿 + forced-failure 自检(S5)行为正确
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

*(Task IDs = `{plan}-T{n}`,按最终计划 01-07 回填,对应各 PLAN.md `<task>` 声明顺序;vitest 命令在 `packages/infinite-canvas` 目录执行,verify/tsc 命令在仓库根执行)*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 53-01-T1 | 01 | 1 | VAR-01 | T-53-01-01 | envelope zod 契约(5 源 enum/groupKey 词表/G15 taxonomy 9 值)+ legacy 归一化(a-flf/c-* → 统一信封;score 缺省 = undefined 不造 0 分) | unit(纯模块;round-trip 断言归 S1) | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 53-01-T2 | 01 | 1 | VAR-01 | — | S1 双代 round-trip 字段不丢(score/prompt/seed/percent 刻度)+ 未知键容忍 + forced-failure 自检(gate 能失败) | contract | `npm run verify:phase-53` | ❌ W0 | ⬜ pending |
| 53-02-T1 | 02 | 1 | VAR-02 | — | wallTransport 漂移校正(>120ms 硬 seek)/solo mute/min-span 回绕/stall 对齐纯逻辑 | unit(fake video) | `npx vitest run src/components/variants/__tests__/wallTransport.test.ts` | ❌ W0 | ⬜ pending |
| 53-02-T2 | 02 | 1 | VAR-02/D-20 | — | 键盘流映射(1-9 检视/Enter 选定/←→ 切镜/空格同播;disabled 门控 + cleanup 移除) | unit | `npx vitest run src/components/variants/__tests__/useWallKeyboard.test.ts` | ❌ W0 | ⬜ pending |
| 53-02-T3 | 02 | 1 | VAR-02 | T-53-02-01/02 | 缩略图三段自愈(fetch 注入):单次触发保护(每卡至多一次 POST)/ sourcePath 仅 /oss/ 白名单 / _thumbs URL 切换 / 占位回退 | unit(注入 fetch) | `npx vitest run src/components/variants/__tests__/healThumb.test.ts` | ❌ W0 | ⬜ pending |
| 53-03-T1 | 03 | 2 | VAR-01/03 | T-53-03-04/05 | 候选组两通道推导(envelope + `_v{N}` 命名)+ 幂等事务物化(cand: 前缀/id>128 拒绝/参数化 SQL)纯逻辑 | unit(纯函数;行为断言归 S2) | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 53-03-T2 | 03 | 2 | VAR-01/03 | T-53-03-01/02 | S2 六组断言:推导/首尾两键(Pitfall 6)/物化幂等/用户组保护/词表与 Phase 48 一致/端点集成 | integration(:memory: knex + 子进程 dispatch) | `npm run verify:phase-53`(S2) | ❌ W0 | ⬜ pending |
| 53-04-T1 | 04 | 3 | VAR-03/D-10 | T-53-04-02 | canvas_writeback_queue DDL + enqueueWriteback/drainOnce/ensureDrainStarted(退避 30s×2^attempts,max_attempts=8,串行) | unit(tsc;队列行为断言归 S3) | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 53-04-T2 | 04 | 3 | VAR-03 | T-53-04-01/03 | select-winner 扩展:frameSlot/source optional(zod enum)、hook best-effort 隔离(never-throws + .catch 二 backstop)、幂等分支不触发 hook | integration(行为断言归 S3) | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 53-04-T3 | 04 | 3 | VAR-03 | — | S3 四组断言:队列机制/退避数学/hook 隔离(transport=null 不入队)/端点集成(向后兼容 + applied:false 队列不变)/drain 重放闭环 | integration(:memory: + 子进程 dispatch) | `npm run verify:phase-53`(S3) | ❌ W0 | ⬜ pending |
| 53-05-T1 | 05 | 3 | VAR-02/03 | — | frameSlotOfGroup/nextReviewGroup 纯函数(shot 序/跳已选)+ canvasApi frameSlot spread-omit + g15Ops sibling 预置 | unit(纯函数) | `npx tsc -b` | ❌ W0 | ⬜ pending |
| 53-05-T2 | 05 | 3 | VAR-02/03/D-12 | T-53-05-02/03 | selectWinner frameSlot 透传(mock api 断言 body)+ 失败回滚回归 + legacy RF 废弃 warn 早退(不 throw) | unit(mock canvasApi,既有文件扩展) | `npx vitest run src/store/__tests__/selectWinner.test.ts` | ✅ 既有可扩 | ⬜ pending |
| 53-05-T3 | 05 | 3 | VAR-02/D-11 | T-53-05-01 | slot 标签(首帧/尾帧)+ 选定后自动下一待审组(默认跳已选)+ 手动「下一镜」可越 + G13 首尾两组各选各的 | unit(组件接线;tsc + 全量) | `npx tsc -b && npm test` | ❌ W0 | ⬜ pending |
| 53-06-T1 | 06 | 4 | VAR-02 | T-53-06-01 | adapter variantGroupIds/variantGroupSize 成员通道 + 组徽章点击 openWallByGroup(onStackToggle deprecated 回落保留) | unit(tsc + 全量) | `npx tsc -b && npm test` | ❌ W0 | ⬜ pending |
| 53-06-T2 | 06 | 4 | VAR-02/D-19/D-12 | T-53-06-02 | 「去画布选片」跳转(cand:{groupKey} 拼接)+ VariantPicker 删除零引用 + 💾 叙事清零 | contract(grep + tsc + 全量) | `grep -rn "VariantPicker" packages/infinite-canvas/src --include="*.tsx" \| grep -v variantPickerStore \| wc -l`(期望 0)+ `npx tsc -b` | ❌ W0 | ⬜ pending |
| 53-07-T1 | 07 | 4 | VAR-04/D-15 | T-53-07-01/02 | g15Bridge(waive/requeue,never-throws + fail-closed 三维匹配)+ g15-ops 端点 zod(action enum + shotIds 每项 ≤128 且数组 ≤200) | unit(tsc;桥行为断言归 S5) | `npx tsc --noEmit && grep -c 'g15-ops' src/router.ts` | ❌ W0 | ⬜ pending |
| 53-07-T2 | 07 | 4 | VAR-04/D-14 | T-53-07-03 | 分诊面板勾选状态机/行展开/批量乐观+回滚/重渲二次确认(组件内 state,禁原生 confirm)/>200 前端预拦截 | unit(mock canvasApi) | `npx vitest run src/components/g15` | ❌ W0 | ⬜ pending |
| 53-07-T3 | 07 | 4 | VAR-04 | T-53-07-02 | S4 墙源形状 grepSource + S5 g15 桥注入 fetch(200→delivered / 409 已处理 / throw→delivered=false+reason / fail-closed fetch 计数 0 / >200 zod 拒 400)+ forced-failure 收口 | contract(注入 fetch) | `npm run verify:phase-53`(S4+S5) | ❌ W0 | ⬜ pending |
| 全体 | 01/07 | — | 全体 | — | forced-failure 自检持续有效(gate 能失败;53-01 建立 shadow asserts,53-07 收口追加) | contract | `npm run verify:phase-53`(S5 shadow asserts) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-53.ts` — S1..S5 骨架 + npm script 注册(package.json scripts,41 行后)
- [ ] root 契约测试位约定(root 无 vitest — 契约测试放 verify 脚本,node:assert,verify-phase-51 同款)
- [ ] 包内 `src/components/variants/__tests__/` 目录(store/__tests__ 先例)
- [ ] fixture 文件:两代 candidate 样本(今日 a-flf/c-* data 快照 + Wave B 信封样本)+ take-log/failed-shots 样本

*(e2e:墙为全屏 overlay,detail-panel phase35 契约不回归即可;墙自身 e2e 可选,组件单测优先 — 93 镜真机验收属 HUMAN-UAT。)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 同播走带观感(跨变体 playhead 对齐、solo 切换听感) | VAR-02 | 音画主观体验 | 打开变体墙→同播→切 solo→确认无回声/漂移感 |
| 93 镜键盘审片流(1-9/Enter/→ 连续操作手感) | VAR-02/D-20 | 键盘连续操作手感 | 键盘完成 3 个变体组的检视+选定+下一镜 |
| G15 批量重渲二次确认(贵操作防误触体验) | VAR-04/D-14 | 破坏性操作主观确认 | 勾选多条→批量重渲→确认弹层文案与计数 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
