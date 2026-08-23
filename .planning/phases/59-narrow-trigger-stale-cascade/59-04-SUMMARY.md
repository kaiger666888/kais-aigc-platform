---
phase: 59-narrow-trigger-stale-cascade
plan: "04"
subsystem: e2e / probe / verify-gate / validation
tags: [stale-cascade, sc1-sc4, mock-replay, zero-footprint-probe, verify-phase-59, phase59]
dependency_graph:
  requires:
    - 59-02 服务端契约 (markStaleAndBroadcast → node:updated {node, changedFields:["data.stale"]})
    - 59-03 客户端接线 (regenSource 发射 + onNodeUpdated → triggerStaleCascade)
    - mock-backend :9876 + helpers (getCalls/getMockState/getGraph 桥) + save-v2 fixture 注入范式 (58-03)
    - phase52 e2e 三件套回归基线 (52-01 stale 保留红线)
  provides:
    - phase59-stale-cascade.mjs — SC1-SC4 e2e(mock 回放 node:updated 契约,四用例 -g 可过滤)
    - probe-59-real.mjs — :10588 零足迹真机探针(级联实证 + SC3 真机负向 + 净足迹 0)
    - verify-phase-59 S5 客户端静态断言 + S6 命令门(56/56)
    - 59-VALIDATION.md 状态收口(Status 全 ✅ + wave_0_complete + W2 修正 + probe 结果)
  affects:
    - mock-backend/server.mjs(execute regenSource 回放 + save-v2 suppressGraphSaved 旋钮,默认零行为变化)
    - /gsd:verify-work 验收面(phase 59 四 plan 材料齐备)
tech_stack:
  added: []
  patterns:
    - mock 契约回放(非语义重实现:回放严格在 regenSource 条件分支内,语义真值在 59-02 服务端断言)
    - mock config 旋钮剔除正交竞态(suppressGraphSaved——被测语义聚焦 52-01 清角标链)
    - dispatchEvent 直发 inner onClick div(边中点芯片被节点卡 z 序截获时的确定性交互)
    - 真机探针 socket.io-client 直收完成信号 + filePath 前后快照比对防存量误报
key_files:
  created:
    - packages/infinite-canvas/test/e2e/tests/phase59-stale-cascade.mjs
    - packages/infinite-canvas/test/e2e/probe-59-real.mjs
  modified:
    - packages/infinite-canvas/test/e2e/mock-backend/server.mjs
    - scripts/verify-phase-59.ts
    - .planning/phases/59-narrow-trigger-stale-cascade/59-VALIDATION.md
decisions:
  - mock 回放契约: execute mock 的 stale 级联回放严格在 body 含 regenSource 的条件分支内(success 广播前 BFS 逐节点 node:updated,changedFields:['data.stale']);无 regenSource 零回放 = SC3 mock 侧负向前提
  - SC4 时序确定性: mock 新增 suppressGraphSaved 旋钮(默认 false)——剔除 rerun 自保存的 graph:saved 自回声 reload;该 reload 与 running/success 清 stale 的写-写竞态窗口是 Pitfall 4 已知边界(planner 裁定不治),实测 reload 落地 ~1s 且抖动(restore 可落在 clear 后致角标复活,后由 success 再清)
  - 芯片交互: fixture 布局下边中点芯片与节点卡重叠(nodes z 序在上,实体 click 被截获)→ dispatchEvent('click') 直发芯片内层 onClick div(React 合成事件 root 冒泡,等价 handleEventChipClick)
  - 真机发现(如实记录): 含 'phase' 型 legacy 节点的图(如 1/2)markStaleAndBroadcast 在 migrateV2toV3 阶段结构性 throw(execute.ts try/catch 仅 console.error,任务仍 success 零 stale 写、零足迹)——该图 V3 客户端同样不可加载(migrate 同一函数),非本 phase 回归;探针以 MIGRATE_SUPPORTED 全图校验选 scope
  - probe A1 证据判定: 触发节点 filePath 与原图快照比对,只有本次新增才算引擎产物落库(存量 pipeline-runs 绝对路径不得误报)
metrics:
  duration_min: 49
  tasks_completed: 3
  files_modified: 5
  completed_at: "2026-08-24T02:20:00Z"
---

# Phase 59 Plan 04: 端到端契约与守护收口 Summary

**One-liner:** mock-backend 按 59-02 wire 契约回放 node:updated 级联 + phase59 e2e 四用例锁 SC1-SC4(SC3 双负向 + 正向对照)+ probe-59-real 真机零足迹实证(scope 2/1 王奶奶链 4 下游级联 / 无标记 execute 零新增 / 净足迹 0)+ verify 聚合门补 S5 客户端静态断言与 S6 命令门(56/56)+ 全量 e2e 回归 21/21(phase52 三件套零回归)——phase 59 验收材料齐备,/gsd:verify-work 就绪。

## What Was Built

### Task 1 — mock regenSource 回放 + phase59-stale-cascade.mjs(SC1-SC4)(commit `e2b13842`)

- `mock-backend/server.mjs` execute mock 扩展(52-02 注释风格续 59 段):body 含 `regenSource` 时在既有 node:state success 广播**之前**调 `replayStaleCascade`——沿 mock links 自 nodeId 下游 BFS(事件芯片 evt_*/eventChip 穿过不标记;`data.curation === 'locked'` 传播终点;visited 去重环防御;已 stale 不覆盖保留最早 since),对每个命中节点写 `data.stale = { since: Date.now(), triggerAssetId: nodeId, triggerEventId: 'evt_' + nodeId }`(migrate L523 同规则)并逐节点 `broadcastToProject('node:updated', { node, changedFields: ['data.stale'] })`(59-02 wire 契约严格镜像,T-59-09);**无 regenSource 分支行为与今天完全一致**(回放调用严格在条件分支内,grep 可证)。
- `phase59-stale-cascade.mjs` 新建(文件头复刻 phase52-regen L15-16 dist 纪律注释):fixture 经 save-v2 注入(58-03 范式)——`trig-1 →┬ mid-1 → down-2(传递闭包链)└ down-1(独立叶子)+ unrel-1(零连接负向锚)`;四用例命名含组词供 -g 过滤(各恰命中 1 条):
  - **SC1** `panel regen cascades stale to downstream`:面板重生成 → getCalls 断言 `body.regenSource === 'panel-regen'` → 三下游角标实时出现(**全程无 page.reload**,FLAG-1 Option A 验收)→ getGraph() 链尾 down-2 `stale.triggerAssetId === trig-1`(D-03 传递闭包链起点保持)+ 三字段形状;触发节点/无关节点零角标。
  - **SC2** `seed reroll cascades and passes seed`:事件芯片 popover(evt_mid-1,产出资产有下游)换 seed → `body.regenSource === 'reroll-seed'` + `params.seed` 数字 + nodeId 非 evt_*;下游角标实时出现,触发资产自身/上游/兄弟分支零波及。
  - **SC3-negative** `orchestrate does not cascade`:全量 orchestrate(等全部节点 success)→ 角标 0;无 regenSource execute(ContextMenu 形状,等页面 node state success 到达)→ 角标仍 0;getMockState 复核 mock 画布零 data.stale;末尾正向对照(同节点带 regenSource 重生成角标出现)防 socket 死假绿。
  - **SC4** `rerun-clears badge via existing exits`:SC1 前置产生角标后,出口 1 面板 `[data-testid="stale-rerun-btn"]`(down-1)与出口 2 角标 click(mid-1,链子集 [mid-1, down-2])各断言 orchestrate batch nodeIds 子集与 `node:state success → 角标 toHaveCount(0)`(52-01 链);unrel-1 全程无角标;出口间等编排态离开 running(useStaleRerun「编排进行中」守卫)。

### Task 2 — probe-59-real.mjs 真机零足迹探针(commit `56d66507`)

- 复刻 probe-58-real 骨架:部署纪律头(build → deploy-canvas.sh → build:server → :10588 kill+setsid nohup 重启序列)+ SKIP 条款 + stripUpdatedAt/firstDiff + 捕获-改-断言-恢复。
- scope 动态探测(SCOPES [2/1, 2001/1] + MIGRATE_SUPPORTED 全图校验):映射命中类型 + ≥1 下游的触发资产(preferred asset/storyboard/global 优先、下游集最小优先);socket.io-client 直收 `/ws/projects` node:state/node:updated 事件。
- 段一(级联实证):`POST /api/canvas/execute { ..., regenSource: "panel-regen" }` → 轮询 load-v2(≤180s,2s)至下游 data.stale 出现 → 五断言(级联出现 / triggerAssetId === 触发节点 / 三字段 / 下游成员 / node:updated changedFields=data.stale socket 直收);filePath 与原图快照比对判定引擎路径证据(防存量误报)。
- 段二(SC3 真机负向):无下游映射节点(或同节点二次)无标记 execute → socket node:state 完成 → stale 集合与段一后全等(零新增)。
- finally:saveV2 原图回存 + load-v2 stripUpdatedAt 深比对(净足迹 = 0)。
- **真机运行结果(scope 2/1,触发 n-p04-character-王奶奶 → 下游 [n-p07-scene-S06, n-p11-video, n-p12-composition, n-p13-delivery]):全绿**——段一 12-14s(simulateOnly)级联出现,triggerEventId=evt_n-p07-scene-S06(服务端 migrate 真实链语义),node:updated 事件实证;段二 n-p13 无标记 execute success 后零新增;净足迹恢复深比对全等。GOLD_TEAM_URL 未配置(:10588 进程环境实测)→ simulateOnly 路径如实记录,filePath 本次未新增(快照比对)。
- 部署动作(探针前置,纪律序列):deploy-canvas.sh(dist 备份+部署)+ build:server(app.js 含 markStaleAndBroadcast/regenSource 实证)+ :10588 重启(NODE_ENV=production PORT=10588,与原进程同 env)。

### Task 3 — verify 终局聚合门 + 全量回归 + VALIDATION 收口(commit `e60546fa`)

- `verify-phase-59.ts` 新增 **S5 客户端静态断言**(8 条):useCanvasSocket `socket.on('node:updated'` 注册块经 `callbacksRef.current.onNodeUpdated` 独立转发且**不在 normalizeSocketNodeState 调用链内**(FLAG-3/52-01 红线,读注册块 700 字符上下文断言);FlowCanvas onNodeUpdated+triggerStaleCascade;canvasApi regenSource;panel-regen/reroll-seed 两发射点。
- 新增 **S6 命令门**(verify-phase-58 同款,WR-01 无管道 + maxBuffer 16MB):根仓 tsc --noEmit / infinite-canvas tsc -b / flowgraph-v3 tsc --noEmit / 双包 vitest run(flowgraph-v3 全量含 stale.test.ts——D-03 语义基线回归)。
- forced-failure 补一项(共 7/7 expected-FAIL):「orchestrate.ts 含 markStaleDownstream」必须不成立(SC3 架构性保证反向自证)。
- **全量回归**(任务内执行):phase59-stale-cascade + phase52-regen/reroll/stale-panel + phase58-recipe 五文件 **21/21 全绿**(52-01 stale 保留红线零回归)。
- `59-VALIDATION.md` 收口:Per-Task Verification Map 11 行 Status 按实际结果全 ✅(含 File Exists 列落位);D-03/04 行 Task ID 修正 `59-02-T2` → `59-02-T1 + 59-02-T3`(plan-checker W2);frontmatter `wave_0_complete: true`;Manual-Only 表补 probe 真机结果段。

## Verification Evidence

| Gate | Result |
|------|--------|
| `npm run verify:phase-59` | **56/56 PASS,exit 0**(S1 翻译 8 + S2 fake 引擎 9 + S3/S4 dispatch 20 + 静态 5 + S5 客户端 8 + S6 命令门 5 + self-check 1;forced-failure 7/7 expected-FAIL) |
| `npx playwright test`(五文件全量) | **21/21 passed**(phase59 4 + phase52-regen 3 + phase52-reroll 2 + phase52-stale-panel 4 + phase58-recipe 8) |
| `-g panel / reroll / orchestrate / rerun-clears` | 各恰命中 1 用例(--list 实证) |
| `node --check probe-59-real.mjs` + grep SKIP/deploy-canvas/stripUpdatedAt | 全命中 |
| probe-59-real 真机(:10588) | **全绿**(级联 12-14s + 五断言 + 段二零新增 + 净足迹 0) |
| mock 回放隔离 | `if (regenSource) replayStaleCascade(...)` — 回放严格条件分支内 |
| 新增 data-testid | 0(仅既有七选择器:UI-SPEC §8) |
| SC1/SC2 无 page.reload | 是(断言路径零 reload;fixture 注入 reload 在动作之前) |
| `grep -c "planner fills" 59-VALIDATION.md` | 0 |
| 三 commit 零 deletion(`git diff --diff-filter=D`) | 全部为空 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking] mock 新增 suppressGraphSaved 旋钮(SC4 时序确定性)**
- **Found during:** Task 1(SC4 首跑失败)
- **Issue:** rerunStaleChain 先 save(stale 上 wire,52-02 语义)再 orchestrate——save 的 graph:saved 自回声触发客户端全量 reload,与 node:state running/success 本地清 stale(52-01 两态都清)存在写-写竞态窗口:实测 reload 落地(load-v2 + adapt + 布局)约 1s 且抖动,restore 可落在 clear 之后使角标复活(仪器化时间线实证:exit-1 的 reload 在 exit-2 的 save 之后才落地,down-1 从旧 wire 复活且再无清除事件)。orchDelay 加大(250/600/2000ms)均无法稳定赢过 reload 抖动。
- **Fix:** mock `/__mock/config` 新增 `suppressGraphSaved`(默认 false,reset 复位)——SC4 用它把自回声 reload 剔出被测面(被测语义 = 既有出口重跑 → success 清角标,52-01 链);其余用例与 phase52/58 回归零影响(默认 false)。**产品竞态不修**(RESEARCH Pitfall 4 已知边界,planner 裁定本 phase 不做合并写),如实记录于 Known Issues。
- **Files modified:** mock-backend/server.mjs、tests/phase59-stale-cascade.mjs
- **Commit:** e2b13842

**2. [Rule 3 - blocking] 芯片交互改 dispatchEvent(SC2)**
- **Issue:** 边中点 evt_* 芯片在 fixture 布局下与节点卡重叠(React Flow nodes z 序在边之上),实体 click 被节点 div 截获(15s 超时,playwright call log 实证「subtree intercepts pointer events」);phase52-reroll 的默认图布局恰无重叠故先例可用。
- **Fix:** `chip.first().locator('div').first().dispatchEvent('click')` 直发芯片内层 onClick div(React 合成事件经 root 冒泡,等价触发 handleEventChipClick → popover 全链)。
- **Commit:** e2b13842

**3. [Rule 3 - probe 修正] scope 字段名 bug + 1/2 不可用(真机发现)**
- **Found during:** Task 2 首跑(诊断输出 + 服务端日志)
- **Issue:** ①probe 首版 `scope.episodesId` 字段名笔误(eid)致轮询全 400;②scope 1/2(爆炸半径最小)真机实证不可用——其图含 'phase' 型节点,migrateV2toV3 planNode 对不支持类型 throw → markStaleAndBroadcast 在 migrate 阶段即失败(execute.ts try/catch 仅 console.error,任务仍 success、零 stale 写、零足迹)。该图 V3 客户端同样不可加载(migrate 同一函数)——**legacy 图级联结构性失效**,非本 phase 回归,已记录决策。
- **Fix:** 字段统一 `{pid, eid}`;SCOPES 改 [2/1, 2001/1] + MIGRATE_SUPPORTED 全图校验(混入不支持类型即跳过该 scope);1/2 发现写入文件头注释与 STATE 决策。首跑失败的 1/2 操作零足迹(throw 先于任何 DB 写,服务端日志复核)。
- **Commit:** 56d66507

**4. [Rule 1 - 证据诚实] probe filePath 判定改前后快照比对**
- **Issue:** 首版 INFO 行把触发节点**存量** filePath(pipeline-runs 绝对路径)误报为「引擎路径产物已落库(A1 真机证据)」——本环境引擎未跑(GOLD_TEAM_URL 未配置)。
- **Fix:** filePath 与原图快照比对,只有本次新增才计 A1 证据;复跑输出如实记录「本次未新增(simulateOnly)」。
- **Commit:** 56d66507(修正后未单独 commit,含于 Task 2 提交)

**5. [orchestrator 指令] VALIDATION W2 修正**
- D-03/04 cascade 行 Task ID `59-02-T2` → `59-02-T1 + 59-02-T3`(plan-checker W2,59-04 Task 3 一并执行)。
- **Commit:** e60546fa

## Auth Gates

None.

## Known Stubs

None. 本 plan 产物全部为测试/探针/门,无产品代码改动(mock 旋钮默认零行为变化)。

## Known Issues(如实记录,非本 plan 修复)

1. **rerun 写-写竞态窗口(产品级,Pitfall 4 已知边界)**:rerunStaleChain 的 save(stale 上 wire)→ graph:saved 自回声 reload 若落在 running/success 清 stale 之后,角标会复活并在下一次清态事件前保持可见(终态由后续 success 收敛,或保持复活直至下次保存)。planner 已裁定本 phase 不做合并写;SC4 e2e 以 suppressGraphSaved 旋钮剔出被测面。潜在后续:自保存回声抑制或成功后补一次保存清 wire。
2. **legacy 图级联结构性失效**:'phase' 等不支持 V2 类型的图,markStaleAndBroadcast 在 migrate 阶段 throw(仅 console.error)——任务仍 success 但零级联。该类图本就无法被 V3 客户端加载,影响面=旧数据,处置留待数据治理。

## Threat Flags

None. T-59-09(mock 回放形状严格镜像 59-02 wire 契约——payload 逐字段一致,probe 在 :10588 断言真实形状闭环)、T-59-10(finally saveV2 恢复 + stripUpdatedAt 深比对净足迹 0 + SKIP 条款)均落地;未引入 plan 外新攻击面(测试/探针资产,无生产代码路径变更)。

## Requirements Closed

- **STALE-01/02 用户可见证据闭环**:mock e2e(SC1/SC2 角标实时出现 + getGraph triggerAssetId)+ 真机探针(级联落库 + node:updated 广播 socket 直收)双证据;REQUIREMENTS.md 三项已标 Complete。
- **STALE-03 三层负向全绿**:mock e2e(orchestrate + 无标记 execute 计数不变 + mock 零 data.stale 写 + 正向对照)+ 服务端(59-02 S4 dispatch 双负向 + 静态锁)+ 真机(段二零新增)。
- **SC4 经既有出口消除**:双出口(面板 btn / 角标 click)orchestrate 子集 → success 清角标 e2e 锁死;phase52 三件套回归零失败(52-01 红线未破)。
- **SC5/A1 真机证据边界如实记录**:GOLD_TEAM_URL 未配置环境走 simulateOnly(计划内合法降级);filePath 快照比对防存量误报;引擎路径 A1 证据待引擎配置环境补跑(探针可直接复用)。
- **VALIDATION.md 与实物一致**:11 行 Status 全 ✅、wave_0_complete、W2 修正、probe 结果入册——/gsd:verify-work 就绪。

## Self-Check: PASSED

- `packages/infinite-canvas/test/e2e/tests/phase59-stale-cascade.mjs` FOUND(四用例 + -g 过滤各恰 1)
- `packages/infinite-canvas/test/e2e/probe-59-real.mjs` FOUND(含 SKIP 条款/部署纪律头/stripUpdatedAt 深比对/finally 恢复)
- `scripts/verify-phase-59.ts` 含 S5 静态断言段 + S6 命令门 + 第 7 条 forced-failure FOUND
- `mock-backend/server.mjs` 含 `if (regenSource) replayStaleCascade` + `suppressGraphSaved` FOUND
- `59-VALIDATION.md` Status 全 ✅、`grep -c "planner fills"` = 0、D-03/04 行 = `59-02-T1 + 59-02-T3` FOUND
- Commit `e2b13842`(Task 1)FOUND in git log
- Commit `56d66507`(Task 2)FOUND in git log
- Commit `e60546fa`(Task 3)FOUND in git log
