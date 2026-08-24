---
phase: 60-post-save-panel-persistence
verified: 2026-08-24T09:35:00Z
status: human_needed
score: 3/3 must-haves verified
overrides_applied: 0
human_verification:
  - test: "真机 :10588 面板编辑 → 保存 → 人眼观察 panelWidth 与面板内滚动位置连续性"
    expected: "保存后详情面板宽度与滚动位置与保存前连续(无视觉跳动/重置);机器面(可见/标题/锚/静默/零 reload)已由 probe-60-real 断言,仅剩肉眼观感"
    why_human: "panelWidth/滚动连续性是视觉观感,e2e 仅能以 ±2px 宽度与 DOM 存活标记做行为代理,肉眼连续性判断无法程序化(VALIDATION.md Manual-Only 行,标注待 UAT)"
---

# Phase 60: 保存后面板保持 (Post-Save Panel Persistence) Verification Report

**Phase Goal:** 保存动作不再打断审片流——graph:saved 触发的整图重载链保住 detailNode,真机后端保存 200 后详情面板保持打开,重载恢复的锚定与保存前语义等价,mock/真机行为对齐。
**Verified:** 2026-08-24T09:35:00Z
**Status:** human_needed(全部机器可断言面 VERIFIED;1 项 Manual-Only 观感待 UAT)
**Re-verification:** No — initial verification

**Verifier note:** 本验证独立重跑了全部关键门(非引用 SUMMARY):`npm run verify:phase-60` → 20/20 PASS exit 0;`node test/e2e/probe-60-real.mjs`(:10588 真机)→ 13/13 PASS exit 0 净足迹=0;D-12 五文件回归 → 18/18 PASS exit 0。

## Goal Achievement

### Observable Truths — Roadmap Success Criteria(合同层)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1(PANEL-01): 真机后端保存返回 200 后,详情面板保持打开——不因 graph:saved 触发的整图重载而收起 | ✓ VERIFIED | 探针独立重跑(:10588 真浏览器段):面板 count=1 保存后仍可见、标题 "p04_character_design" 不变、锚 id n-p04 不变、零 toast、load-v2 计数 2→2(零 reload,PANEL-01 决定性信号)。机制链代码全部在场:clientTabId.ts 单例 → canvasApi.saveCanvasGraph body 附 savedBy(L344)→ save-v2.ts zod+条件回显 → FlowCanvas onGraphSaved selfEcho 早退(L348-350,基线重置 L343 先行) |
| 2 | SC2(PANEL-02): 重载恢复后的面板锚定与保存前语义等价——同一资产/同一事件锚,不漂移、不丢锚上下文 | ✓ VERIFIED | reloadAnchor.test.ts 8/8(verify 门 B 段实跑,752ms):survive 引用刷新重锚/collapse 对称收起/other-anchor-untouched/warn-on-miss/no-warn-on-hit/no-warn-spam/roundtrip-lock(evt_ 子集单列);canvasStore.ts setGraph 重锚 L452-457 `rfNodes.find(n.id ===)?? null` 语义在场 + warn 钩子 L436-440(diagnose --strict 三层 id 零漂移 31/62/31、diff 0/0/0 exit 0——id 稳定性物理前提);mock e2e Test 2:同 id 重锚+标题随新真相刷新+tab/宽度不重置+selectedNode 对称 |
| 3 | SC3: mock 后端与真机后端两个环境下保存后面板行为一致,e2e 双环境断言通过 | ✓ VERIFIED | 跳过逻辑在客户端(同一份 FlowCanvas 代码双环境共用);契约同形实证:真机协议段带身份→回显同值("tab_probe60"),不带→广播键恰 [projectId,episodesId,timestamp](kmc 兼容);mock server.mjs L210 同款条件展开;suppressGraphSaved 旋钮全 test 目录零命中(退役,广播恒发);mock e2e 4/4 与真机探针 5 断言行为面一一对应 |

**Score:** 3/3 roadmap truths verified

### Observable Truths — PLAN 层(60-01..60-05 frontmatter must_haves)

| Plan | Truth | Status | Evidence |
|------|-------|--------|----------|
| 60-01 | 真机 roundtrip 三层 id 漂移实证测量 | ✓ VERIFIED | diagnose-60-roundtrip.ts(407 行)三层结构在场;实跑 exit 0:层1 31v31 差集 0/0、层2 62v62 差集 0/0、层3 evt 31v31 差集 0,锚点抽检 n-p04 同 id |
| 60-01 | store 重锚 survive/collapse vitest + loading 卸载静态结论 | ✓ VERIFIED | reloadAnchor.test.ts case a/b/c 绿;60-DIAGNOSIS Prong 2 行级裁定(候选②不成立,4 条行级依据) |
| 60-01 | 60-DIAGNOSIS 钉死根因 + A/B 分支 | ✓ VERIFIED | 「Pinned cause」/「Fix branch: A」两行逐字在场(DIAGNOSIS L12-14 + 最终裁定节 + Branch A confirmation 段) |
| 60-01 | :10588 净足迹零 | ✓ VERIFIED | 探针 finally 守卫恢复:原图回存 + deep-equal 全等(净足迹=0,独立重跑确认) |
| 60-02 | 自保存 200 后自回声不 reload、不弹 toast | ✓ VERIFIED | FlowCanvas L343-352 代码序核实 + mock e2e Test 1(__toastLog 空 + load-v2 计数不变)+ 真机探针同断言双环境绿 |
| 60-02 | 他端保存仍 toast+reload(零回归) | ✓ VERIFIED | mock e2e Test 2(toast 命中「Pipeline 同步了新数据…」+ reload 落地);kmc 兼容:不带 savedBy 广播形状逐键一致(真机协议段键集断言) |
| 60-02 | 六处保存路径自动携带 tabId | ✓ VERIFIED | 单点附加:saveCanvasGraph body 内部构造(L344),签名不变;调用方零改动(verify S5 锁绿;rerun 路径经 e2e Test 4 + phase59 SC4 自然通过证明) |
| 60-02 | mock/真机广播同形,旋钮退役 | ✓ VERIFIED | server.mjs L192/L210 条件展开同形;suppressGraphSaved 在 packages/infinite-canvas/test 目录零命中(全仓仅 verify 脚本自身的锁逻辑引用 token) |
| 60-02 | 自回声分支保留 health 基线重置(FLAG-1) | ✓ VERIFIED | L343 `lastEventCountRef.current = null` 无条件先于 L350 早退;verify S2 次序锁 PASS + F-S2 变异样本判 false(锁可失败) |
| 60-03 | 他端 reload 后按 id 重锚,panelWidth/tab 不丢 | ✓ VERIFIED | vitest a/c + e2e Test 2(「🔄 迭代」tab active + 宽度 ±2px,先拖至 ≈560 再断言) |
| 60-03 | 锚丢失诚实收起 + console.warn 一次,无模糊匹配 | ✓ VERIFIED | canvasStore L436-440 转移守卫 warn(`[panel-persist]` 默认串);vitest d/e/f/g;e2e Test 3 面板 count===0 + console 捕获;无 assetKey 模糊匹配(grep 无) |
| 60-03 | roundtrip 零漂移可重复门 | ✓ VERIFIED | 双门:diagnose --strict(真机,verify D 段 spawn exit 0)+ vitest h roundtrip-lock(纯函数,CI 安全) |
| 60-04 | mock 四用例 e2e 全绿(六 -g 组词) | ✓ VERIFIED | 独立重跑 4/4;六组词全部在标题内:self-save/silent(Test1)、other-client/symmetry(Test2)、anchor-miss(Test3)、no-revival(Test4) |
| 60-04 | D-12 回归零红 | ✓ VERIFIED | 独立重跑五文件 18/18 PASS(1.1m,exit 0):phase52 3+2+4 + phase59 5(SC1-SC4+CR-02)+ phase60 4 |
| 60-05 | npm run verify:phase-60 聚合门全绿 | ✓ VERIFIED | 独立重跑 20/20 PASS exit 0(S1-S11 静态 14 断言 + B 四命令 + D dispatch + F 三变异样本 0/3 unexpectedly passed) |
| 60-05 | 真机 savedBy 回显契约(带/不带) | ✓ VERIFIED | 协议段双断言 PASS(带→同值回显;不带→键集恰三键) |
| 60-05 | 真机浏览器:保存后面板保持/标题/静默/零 load-v2 | ✓ VERIFIED | 浏览器段五断言 PASS(postData.savedBy=tab_819418e2 上 wire) |
| 60-05 | 探针净足迹零 | ✓ VERIFIED | 恢复 deep-equal 全等 PASS(净足迹=0) |

**Plan-level score: 18/18 truths verified**

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/routes/canvas/v2/save-v2.ts` | savedBy zod + broadcast 回显 | ✓ VERIFIED | L34 zod 行 + 条件展开 broadcast;81→94 行实质 |
| `packages/infinite-canvas/src/services/clientTabId.ts` | getClientTabId() 单例 | ✓ VERIFIED | 34 行,tab_ 前缀 + randomUUID/Math.random 回退 + 头注释 |
| `packages/infinite-canvas/src/services/canvasApi.ts` | saveCanvasGraph 附 savedBy | ✓ VERIFIED | L344 单点附加;phase60 diff 仅 3 hunk(imports/saveCanvasGraph/requestNodeScore) |
| `packages/infinite-canvas/src/components/FlowCanvas.tsx` | onGraphSaved 自回声判定 + FLAG-1 次序 | ✓ VERIFIED | L330-353;health-poll 段(L795+)eventCount 读取原样(FLAG-2 正向) |
| `packages/infinite-canvas/src/hooks/useCanvasSocket.ts` | payload 类型含 savedBy? | ✓ VERIFIED | L74 回调签名 + L236 订阅块双处 |
| `packages/infinite-canvas/src/store/canvasStore.ts` | [panel-persist] warn | ✓ VERIFIED | L436-440 转移守卫;重锚语义 L452-457 原样 |
| `packages/infinite-canvas/src/store/__tests__/reloadAnchor.test.ts` | 8 case 永久锁 | ✓ VERIFIED | 303 行,a-h 全场(survive/collapse/other-anchor/warn×3/symmetric/roundtrip-lock) |
| `packages/infinite-canvas/test/e2e/mock-backend/server.mjs` | savedBy 透传 + 旋钮退役 + scopeEvents | ✓ VERIFIED | L206 logCall savedBy、L210 条件展开、L145/L198-204 per-scope eventCount(WR-02);旋钮零命中 |
| `packages/infinite-canvas/src/main.tsx` | getDetailNode/getSelectedNode 桥 | ✓ VERIFIED | L46/L50,testMode 门内只读 |
| `packages/infinite-canvas/test/e2e/tests/phase60-panel-persist.mjs` | D-09 四用例 | ✓ VERIFIED | 408 行,4 test,六 -g 组词,零新增 testid(仅引用既有 4 个) |
| `scripts/verify-phase-60.ts` | D-11 聚合门 | ✓ VERIFIED | 384 行,S1-S11+B+D+F;实跑 20/20 |
| `scripts/diagnose-60-roundtrip.ts` | 三层 id-diff 探针 | ✓ VERIFIED | 407 行,--strict exit 契约 + CR-01/WR-01 守卫(lastKnownServer/probeWrote/save 成功门控) |
| `packages/infinite-canvas/test/e2e/probe-60-real.mjs` | D-10 真机探针 | ✓ VERIFIED | 348 行,双段式 + 恢复守卫;实跑 13/13 |
| `package.json` | verify:phase-60 注册 | ✓ VERIFIED | L53 恰 1 处 |
| `src/routes/canvas/v2/health.ts` | FLAG-2 负向:eventCount 零出现 | ✓ VERIFIED | grep eventCount = 0(禁激活第二 reload 通道保持) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| canvasApi.saveCanvasGraph | save-v2.ts | body savedBy | ✓ WIRED | L344 附加 → L34 zod 解构;e2e 断言 body.savedBy /^tab_/(mock logCall + 真机 postData) |
| save-v2 broadcastToProject | useCanvasSocket graph:saved | payload.savedBy 回显 | ✓ WIRED | 条件展开 → socket 类型 savedBy? → FlowCanvas 消费;真机协议段双向断言 |
| FlowCanvas onGraphSaved | getClientTabId | selfEcho 判定早退 | ✓ WIRED | L348-350;早退在 toast/loadCanvas 之前、基线重置之后(FLAG-1 序,verify S2 锁) |
| canvasStore setGraph | rfNodes.find 重锚 | id 重锚语义 | ✓ WIRED | L452-457 两锚同形;vitest 8 case 行为锁 |
| diagnose-60-roundtrip | v3 adapter/serialize | adaptV2Graph/serializeGraphToV2 | ✓ WIRED | computed-specifier 动态 import(60-01 变体解法);实跑两层过 |
| phase60 e2e | [data-testid="detail-panel"] | phase35 契约选择器 | ✓ WIRED | 5 处引用,零新增 testid |
| phase60 e2e / probe | __kaisCanvas.getDetailNode() | 锚 id 真值断言 | ✓ WIRED | main.tsx L46;e2e/probe 断言 id 全绿 |
| verify D 段 | diagnose --strict | spawn exit 分级 | ✓ WIRED | exit 0 PASS / 2 WARN / 1 FAIL;实跑 exit 0 |
| probe 浏览器段 | :10588 已部署 dist | chromium + testMode=1 + response 计数 | ✓ WIRED | goto /infinite-canvas/?…&testMode=1;load-v2 计数 2→2 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| probe-60-real 浏览器段 | detailNode/标题/load-v2 计数 | :10588 真实 31 节点图(n-p04) | Yes(实跑断言全过) | ✓ FLOWING |
| diagnose-60-roundtrip | loadA/loadC/wire | :10588 真实库 save→load 往返 | Yes(31/62/31 节点实测) | ✓ FLOWING |
| phase60 e2e | fixture 图 + mock calls | injectCascadeFixture + logCall savedBy | Yes(savedBy 上 wire 断言过) | ✓ FLOWING |
| FlowCanvas 面板渲染 | detailNode | canvasStore setGraph 重锚 | Yes(双环境行为断言过) | ✓ FLOWING |

### Behavioral Spot-Checks(本验证独立执行)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| D-11 聚合门全绿 | `npm run verify:phase-60` | 20/20 PASS,exit 0(F 段 3/3 expected-FAIL) | ✓ PASS |
| D-10 真机探针 | `node test/e2e/probe-60-real.mjs` | 13/13 PASS,exit 0,净足迹=0 | ✓ PASS |
| 真机 roundtrip 三层零漂移 | diagnose --strict(经 verify D 段 spawn) | 层1/2/3 差集 0/0/0,恢复全等,exit 0 | ✓ PASS |
| D-12 五文件回归 | `npx playwright test phase52-{regen,reroll,stale-panel} phase59-stale-cascade phase60-panel-persist` | 18 passed (1.1m),exit 0 | ✓ PASS |
| store 重锚永久锁 | reloadAnchor vitest(经 verify B 段) | 8/8 绿,752ms | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `scripts/diagnose-60-roundtrip.ts` | `npx tsx scripts/diagnose-60-roundtrip.ts --strict`(verify D 段 spawn,本验证触发) | exit 0,三层零漂移 + 净足迹=0 | PASS |
| `packages/infinite-canvas/test/e2e/probe-60-real.mjs` | `node test/e2e/probe-60-real.mjs`(本验证直跑) | exit 0,13/13,净足迹=0 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PANEL-01 | 60-02, 60-04, 60-05 | 真机后端保存 200 后详情面板保持打开,不因 graph:saved 整图重载收起 | ✓ SATISFIED | REQUIREMENTS.md 已勾 [x]+traceability Complete;真机探针五断言 + mock e2e Test 1 + savedBy 契约链全部实证 |
| PANEL-02 | 60-01, 60-03, 60-04, 60-05 | 重载恢复的面板锚定与保存前语义等价(同一资产/同一事件锚) | ✓ SATISFIED | REQUIREMENTS.md 已勾 [x]+traceability Complete;三层 id 零漂移 + 8-case 重锚锁 + e2e Test 2/3 |

无 ORPHANED 需求:REQUIREMENTS.md 映射到 Phase 60 的 ID 恰为 PANEL-01/02,全部被 plan frontmatter 认领并落地。

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| canvasApi.ts | 1175-1207 | TODO(backend)×4(assets-registry 前瞻接缝) | ℹ️ Info | 预存债务(commit e0ac4313,先于 phase 60);phase 60 diff 未触及该区段(hunk 仅 L2/L334/L586)——非本 phase 引入,不计 gap |

无 TBD/FIXME/XXX;无空实现;无占位符;无恒真锁(F 段 3/3 变异样本判 false 证明)。

### Human Verification Required

### 1. 真机面板保持人工观感(panelWidth/滚动连续性)

**Test:** :10588 打开画布 → dblclick 资产节点开详情面板 → 调整面板宽度/滚动面板内容 → 点「保存」→ 人眼观察
**Expected:** 保存后面板宽度与滚动位置与保存前连续,无视觉跳动/重置;无 toast;面板不闪断
**Why human:** 机器面已全部断言(probe:可见/标题/锚/静默/零 reload;mock e2e:宽度 ±2px + DOM 存活标记 + tab 保持);肉眼连续性是观感判断,无法程序化。VALIDATION.md Manual-Only 行已登记为「待 UAT」。

### Gaps Summary

无 gaps。三条 roadmap SC 与 18 条 plan 级 truth 全部 VERIFIED——验证方式为独立重跑全部关键门(verify:phase-60 20/20、probe-60-real 13/13 净足迹 0、D-12 回归 18/18)加源码逐点核实(savedBy 契约链/FLAG-1 次序/重锚语义/warn 钩子/旋钮退役/FLAG-2 双向)。诊断→修复次序被如实执行(Branch A,三候选生产文件零改动,唯一生产 delta 为 plan 明列的 D-03 warn 纯增量)。code review 链闭环(4 findings 修复 + 复审 clean 0/0/0,修复中新增 S8-S11 四锁)。已知预存项不计 gap:phase55-nav load-flake(独立通过)、FLAG-2 真机 health 无 eventCount(设计上不动,真机 PANEL-01 由探针零 reload 证明不受影响)、fixtureSource 残留路径(DIAGNOSIS 登记为低概率结构性,越本 phase A/B 框架)、canvasApi 预存 TODO(先于本 phase)。

唯一未闭合项为 Manual-Only 人眼观感 UAT(见上节),故 status=human_needed。

---

_Verified: 2026-08-24T09:35:00Z_
_Verifier: Claude (gsd-verifier)_
