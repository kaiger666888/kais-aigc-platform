---
phase: 52-prompt-edit-regenerate-loop
status: passed
verified: 2026-08-22
verification: verify-phase-52 aggregate gate (31/31) + full suite + real-machine probe
requirements: [REGEN-01, REGEN-02, REGEN-03, REGEN-04]
---

# Phase 52 — VERIFICATION(prompt-edit-regenerate-loop)

> 聚合门单入口:`npm run verify:phase-52`(GUARD 收尾传统,ROADMAP 决策 #7)。
> e2e 前置纪律(地雷 #10):e2e 跑 dist,复跑前必须 `cd packages/infinite-canvas && npm run build`。

## 需求逐项验证

### REGEN-01 — 详情面板内改 prompt → 保存 → 一键重生成

| 证据 | 结果 |
|---|---|
| PromptSection 三态(可编辑/落选只读/无事件只读)+ persistEventParams + 重生成 nodeId=资产 id | 52-03(e2e REGEN-01-a 断言 body.prompt/params.prompt/nodeId 非 evt_*) |
| reload 往返保真 | e2e REGEN-01-b ✓ |
| 落选只读可观察(UI 入口) | 52-08 syntheticDetailNode + focus 分流;e2e REGEN-01-c(侧栏卡入口)✓ |
| **真机闭环(UAT Test 2/3 gap)** | 52-07 probe-52-real Part B:保存 200 → reload 往返 → 重生成 running→success + toast → 零足迹恢复 ✓ |
| **save-v2 存量 blocker(UAT Test 2)** | 52-07 Part A:项目 1/2、2/1、2001/1、9999/1 原图回发全 **200**(修前全 400)+ 回读深度全等(verified no-op)✓;离线锁 verify:save-v2-legacy 17/17 |

### REGEN-02 — 事件芯片「同配方换 seed 重跑」

残桩清零 + anchor 注入 + execute 通道 + pending + canonical seed 回写(52-04);e2e phase52-reroll a/b ✓(同配方 prompt 不变 + seed 1e6 域内 ≠ 旧 + nodeId 资产 id + pending 观测 + data-seed 回写上屏 + toast)。

### REGEN-03 — stale 下游一键重跑

getDownstreamIds(52-01)+ data.stale wire + orchestrate stale-success 不跳过(52-02,双侧+mock 镜像)+ useStaleRerun 双出口(StaleSection 按钮 + 角标点击,52-05);e2e phase52-stale-panel REGEN-03-a/b ✓(注入→点击→orchestrate nodeIds/total=1/skipped=0→角标消除;reload 后角标仍在)。

### REGEN-04 — 面板交互

默认宽 480 + 单击跟随 + 多选修饰键守卫(52-05);e2e REGEN-04-a/b ✓(宽 400..520;跟随切换 textarea 值;点空白关;关后单击不开)。

## 命令门结果(2026-08-22 终跑)

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit`(根) | exit 0 |
| `npx tsc -b`(infinite-canvas) | exit 0 |
| `npx tsc --noEmit`(flowgraph-v3/ts) | exit 0 |
| `npm test`(infinite-canvas) | **404/404** |
| `npx vitest run`(flowgraph-v3) | **130/130**(含 52-07 migrate 防御 ×2 + 52-02 stale ×3) |
| `npm run test:e2e`(infinite-canvas,build 后) | **62 passed**(phase35/36/37/40/41/55/57 + 52 三件套;phase57 真实后端用例一并绿) |
| `npm run verify:save-v2-legacy` | 17/17 |
| `npm run verify:phase-52` | **31/31**(S1-S5 + forced-failure 自检 4/4 预期 FAIL) |
| `node test/e2e/probe-52-real.mjs`(真后端 10588,部署后) | 全绿(Part A 回放门 + Part B 闭环,零净足迹) |

## 执行中收口的计划外地雷(详见各 SUMMARY)

1. **migrate Pass 3 整图崩溃**(52-07):envelope 变体组共享候选 → 非空断言 throw → 整图降级空(9999 画布消失);修复 = warn+跳过合并,回归 ×2。
2. **execute allowlist 缺 V3 Stage**(52-07):stage='global' 真机重生成 400;补齐 Stage 全集。
3. **verify:schema-drift 解析锚**(52-07):canvasAssetSchema 注释不得出现 EXPECTED 常量全名(正则锚首次出现)。

## 遗留说明

- **地雷 #11(重生成后下游不自动标 stale)**:锁定决策未授权,本期不做——socket success 路径无 triggerStaleCascade 接线,贸然全局触发会把 Phase 37 批量执行下游全标脏。如未来需要,最小方案 = per-request 关联后仅在 PromptSection/reroll 发起路径触发。
- **§14 窄通道(地雷 #3)**:steps/cfg/lora/quant 等全配方持久化出范围(prompt/seed/engine/modelVersion 已覆盖)。
- **真机保存后面板收起**(52-07 Part B 观察):真后端 save 200 后 graph:saved 整图 reload,detailPanel 随 setGraph 重解析收起(mock 无此现象)。未裁定为缺陷;若产品要求「保存后面板保持」,需在 reload 链保 detailNode(独立小改)。
- **migrate 组间共享候选的配方语义**(52-07):被前组消费事件的候选在后组跳过合并(warn),其 curation 由**后组**路径置 deprecated——跨组共享属 envelope 罕见形态,渲染不受影响;如需精确归组留待 Phase 53 变体域裁定。

## 人工验证项(Manual-Only,52-VALIDATION)

- 审片场景面板开合体验:480px 视觉 + 单击跟随流畅度(打开面板 → 单击多个节点 → 确认不反复开合)。

## 结论

**PASSED** — 四需求全部有自动化锁死(e2e 9 用例 + 真机探针 + 聚合门 31 断言),save-v2 存量 blocker 与两颗真机地雷收口,遗留成文。
