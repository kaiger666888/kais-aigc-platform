# Phase 60: 保存后面板保持 (Post-Save Panel Persistence) - Research

**Date:** 2026-08-24
**Status:** Complete (inline research — subagent quota circuit; all claims line-verified)
**Confidence:** HIGH (chain anatomy) / MEDIUM (collapse root cause — Wave-1 diagnostic task pins it)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
D-01 自保存跳过自回声 reload（他端仍 reload）· D-02 reload 按 id 重锚（对齐 setGraph L445 语义）· D-03 锚丢失诚实收起 + console.warn（禁模糊匹配）· D-04 mock/真机契约对齐（客户端实现，非 mock 旋钮）· D-05 自保存静默无 toast · D-06 保持锚 + 数据刷新 · D-07 selected/detail 对称断言 · D-08 SC4 竞态销案（e2e 断言角标不复活）· D-09 新建 phase60-panel-persist.mjs 四用例 · D-10 probe-60-real 零足迹 · D-11 独立 verify:phase-60 · D-12 回归面 phase52 三件套 + phase59 全部

### Claude's Discretion
自回声判定机制 · loadCanvas 重构形状 · e2e 选择器细节

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PANEL-01 | 真机保存 200 后详情面板保持打开,不因 graph:saved 整图重载收起 | 自回声跳过（F-3 savedBy 机制）+ 根因诊断（F-2） |
| PANEL-02 | 重载恢复的面板锚定与保存前语义等价(同一资产/同一事件锚) | id 全链稳定性核查（F-1/F-2）+ setGraph 重锚既有语义 |
</phase_requirements>

## Summary

graph:saved 整图重载链全貌：`handleSave` → `serializeGraphToV2` → POST save-v2 → **服务端 broadcast 在 HTTP 响应之前发出** → 客户端 onGraphSaved → `loadCanvas` → `loadInitialGraph` → `resolveInitialGraph` → `setGraph`（已按 id 重锚 detailNode/selectedNode）。store 侧重锚语义已存在；真机收起的根因候选收敛为三个（vm id 派生 / loading 卸载闪断 / 其他），需 Wave-1 诊断任务实证钉死后再动手修——UI-SPEC FLAG-3 的「id 漂移」假说被部分证伪（关系表 id 全程透传稳定）。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 自保存身份标识 (D-01) | API/Backend (save-v2 echo) + Browser (tabId 生成/比对) | — | wire 契约需服务端回显;判定在客户端 |
| reload 锚保持 (D-02/D-03) | Browser (canvasStore setGraph 重锚) | — | store 层既有语义对齐 |
| toast 触发条件 (D-05) | Browser (FlowCanvas onGraphSaved) | — | 纯客户端 |
| mock/真机契约 (D-04) | 测试基建 (mock-backend) | API/Backend | mock 镜像服务端行为 |
| SC4 竞态销案 (D-08) | Browser (自回声跳过的副作用) | — | 根因在客户端 reload 触发 |

## Key Findings

### F-1: reload 链 anatomy（全部行级实证）
- `FlowCanvas.tsx:673-690` handleSave：serializeGraphToV2 → saveCanvasGraph → 200。**保存成功后客户端不做任何本地确认动作**——后续一切由 socket 回声驱动。
- `save-v2.ts:71` 服务端 `broadcastToProject(projectId, "graph:saved", {projectId, episodesId, timestamp: Date.now()})` 发生在 `res.status(200).send()` **之前**——socket 回声典型先于/伴随 save promise resolve 到达。
- `FlowCanvas.tsx:328-342` onGraphSaved：scope 守卫（projectId/episodesId）→ toast「Pipeline 同步了新数据,正在刷新画布…」→ `lastEventCountRef.current = null`（health 轮询基线重置）→ `loadCanvas`。
- `FlowCanvas.tsx:415-465` loadCanvas → `loadInitialGraph`（canvasStore.ts:477-493）→ `resolveInitialGraph` → `setGraph`（canvasStore.ts:430-460）。
- **setGraph L445-446 已按 id 重锚** `detailNode`/`selectedNode`（`vm.rfNodes.find(n => n.id === …) ?? null`）——store 侧保持语义**已存在**，这是 D-02 的对齐基准。

### F-2: id 稳定性核查（FLAG-3 假说部分证伪）
- **服务端全程透传稳定**：save-v2 经 canvasRelationalStore `upsertNode`（ON CONFLICT 更新，id 原样入表）；load-v2 `rowToNode` 直接 `id: r.id` 回读。关系表不重排 id。
- **事件节点不落盘**（serialize.ts:29-31）：event 节点 + role:'output' 边在序列化时被剔除；reload 时 migrate §14 从产出资产 flat data（prompt/seed/engine…）**确定性重合成**（`evt_*` id 派生确定——59-RESEARCH 已实证 server/client triggerEventId 收敛）。
- **真机收起根因候选（按嫌疑排序）**：① vm/视图模型 id 派生在 save→reload 往返中不对称（事件节点 evt id 合成与 rawData 袋还原路径）② `loadInitialGraph` 的 `setLoading(true)` 造成画布/面板卸载闪断（React unmount 杀内部态：panelWidth/tab/滚动位置——store 的 detailNode 活着但面板体验已断）③ 其他。
- **结论：D-02/D-03 的修法必须先诊断**。Planner 必须把「:10588/fixture 上的 save→reload roundtrip id diff 探针」排进 Wave 1 前置任务，实证钉死 ①/②/③ 再写修复任务——避免在错误层（store vs 服务端 vs loading 门）动刀。

### F-3: 自回声机制选型（D-01 discretion → 推荐裁决）
- **推荐：`savedBy` tabId 回显。** 客户端启动时生成 tabId（sessionStorage/随机，如 `tab_${crypto.randomUUID().slice(0,8)}`）；save-v2 body 增加可选 `savedBy: z.string().max(64)`；服务端原样回显进 broadcast payload；客户端 onGraphSaved 比对 `payload.savedBy === myTabId` → 相等则跳过 reload + 跳过 toast（D-05 一并实现）。
- **为什么不用时间窗**：F-1 实证 broadcast 先于 HTTP 响应发出——「save promise 挂起期标记」窗口天生竞态（回声可能在 resolve 前后任意侧到达）。
- **为什么不用 per-save requestId**：等价但多一层状态管理；tabId 语义即「谁保存」，天然覆盖同用户多 tab（他端=reload 正确），且复用同一字段。
- **服务端改动面**：save-v2.ts zod schema + broadcast 一行；mock server.mjs save-v2 handler 镜像同一行为（D-04）。
- **威胁评估（security_enforcement L1）**：savedBy 客户端可伪造——最坏情形是冒充他端 tabId 使该端跳过一次 reload（UI 短暂陈旧，health-poll/手动刷新可恢复）；无数据完整性影响。定级 Informational，文档化即可，不加鉴权（该字段语义上不是权限依据）。

### F-4: SC4 竞态销案链（D-08 实证）
`useStaleRerun.ts:59` rerunStaleChain 保存（saveCanvasGraph）→ mock save-v2 5ms 后 broadcast graph:saved（server.mjs L193-196）→ 自回声 reload 与 node:state success 清 stale 写-写竞态 → 角标短暂复活。**自回声跳过（F-3）直接消灭 reload 侧**——竞态根因不存在了。落地后：删除 mock `suppressGraphSaved` 旋钮（server.mjs L135/L193，UI-SPEC FLAG-4），phase59 e2e SC4 必须保持绿（59-04 用例改走真实回声路径后被 D-01 机制自然跳过）。

### F-5: toast + health 基线（D-05 / UI-SPEC FLAG-1/FLAG-2）
- onGraphSaved 的 `lastEventCountRef.current = null` 基线重置在自回声分支**必须保留**（跳 reload 不跳基线重置）——mock 的 health `eventCount` 把每次 save-v2 计为事件，不重置 → 自保存后 ≤30s 冒出假「Pipeline 同步」toast（D-05 违反，>30s e2e 等待才能抓到 → 静态锁锁死）。
- FLAG-2（背景，不修）：真机 health 返回 `nodeCount`/`lastEventId` 而非 `eventCount`——health-poll fallback 在真机结构性失活。**执行器禁止顺手修这个字段映射**（pre-existing quirk，修了会引入本 phase 外的行为变化）。

### F-6: mock/真机契约对齐点（D-04）
| 维度 | 真机 (save-v2.ts) | mock (server.mjs) | 对齐动作 |
|------|-------------------|-------------------|----------|
| broadcast payload | {projectId, episodesId, timestamp} → **加 savedBy** | 同形 → **加 savedBy 透传** | 两端同加 |
| broadcast 时机 | HTTP 响应前 | 响应后 5ms setTimeout | 保持差异（对 e2e 无影响——客户端判定靠 savedBy 非时序） |
| suppressGraphSaved 旋钮 | 无 | 有（59-04 SC4 绕开） | **删除**（F-4），59 e2e SC4 改由 D-01 机制自然通过 |

## Validation Architecture

> config 无 `workflow.nyquist_validation` 键 → 启用。测试基建同 59（vitest 双包 + Playwright :9876 mock + tsx 聚合门范式）。

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.1.9 双包 · Playwright 1.61 e2e · tsx 聚合门（新 verify-phase-60.ts） |
| Quick run | `npx tsc --noEmit`（根）+ 触及包 vitest 最窄文件 |
| Full suite | `npm run verify:phase-60`（新聚合门：静态锁 + 行为断言 + forced-failure）+ `cd packages/infinite-canvas && npm run build && npx playwright test test/e2e/tests/phase60-panel-persist.mjs` |

### Phase Requirements → Test Map
| Req/SC | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PANEL-01/自保存保持 | save 200 → 面板不收起（savedBy 回声被跳过） | e2e | `npx playwright test test/e2e/tests/phase60-panel-persist.mjs -g "self-save"` | ❌ W0 |
| PANEL-02/他端重锚 | 他端 saved → reload → detailNode 按 id 重锚同节点 | e2e | `… -g "other-client"` | ❌ W0 |
| D-03/锚丢失 | reload 后 id 不存在 → 面板收起 + console.warn | e2e 负向 | `… -g "anchor-miss"` | ❌ W0 |
| D-05/自保存静默 | 自保存后无 toast；他端保存有 toast | e2e | `… -g "silent"` | ❌ W0 |
| D-08/SC4 销案 | rerun 后角标 0 且保持 0（无复活） | e2e 负向 | `… -g "no-revival"` | ❌ W0 |
| D-07/selected 对称 | reload 后 selectedNode 与 detailNode 同语义保持 | e2e + 静态 | `… -g "symmetry"` + verify 静态锁 | ❌ W0 |
| F-1/基线重置保留 | 自回声分支保留 lastEventCountRef 重置（静态） | verify 静态锁 | verify-phase-60 S 段 grep | ❌ W0 |
| F-2/roundtrip id diff | save→reload id 全等（诊断任务产物） | probe/dispatch | verify-phase-60 dispatch 模式 | ❌ W0 |
| PANEL-01/真机 | :10588 真机保存后面板保持 | probe-60-real（零足迹） | 手动/CI 探针 | ❌ W0 |
| 回归 | phase52 三件套 + phase59 全部绿 | e2e 全量 | `npx playwright test`（59/52 套件） | ✅ 既有 |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit` + 触及包 vitest
- **Per wave:** `npm run verify:phase-60` + build + phase60 e2e
- **Phase gate:** 全量 e2e（含 52/59）+ probe-60-real

### Wave 0 Gaps
- [ ] `packages/infinite-canvas/test/e2e/tests/phase60-panel-persist.mjs` — 四用例骨架
- [ ] `scripts/verify-phase-60.ts` — 聚合门骨架（S 段：静态锁/行为断言/forced-failure）
- [ ] mock save-v2 savedBy 透传 + suppressGraphSaved 移除（与实现任务同波）
- [ ] `packages/infinite-canvas/test/e2e/probe-60-real.mjs` — 零足迹探针骨架

## Security Domain

### Applicable ASVS Categories
| Category | Applies | Standard Control |
|----------|---------|-----------------|
| V2/V3 | no（会话面不变） | — |
| V4 | no（路由鉴权链不变） | — |
| V5 Input Validation | yes | savedBy: `z.string().max(64).optional()`（zod 白名单长度限制;不落库只回显） |
| V6 | no | — |

### Known Threat Patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|-----------|
| savedBy 伪造（冒充他端 → 该端跳过 reload） | Repudiation/DoS(弱) | 影响限 UI 短暂陈旧（health-poll/手动刷新恢复）;字段非权限依据;文档化接受 |

## Pitfalls

1. **broadcast 先于 HTTP 响应**（save-v2.ts:71 顺序）——任何基于 save promise 窗口的自回声判定天生竞态;必须用 savedBy 显式身份。
2. **诊断先于修复**——D-02 的修法取决于 F-2 候选①②③哪个为真;没有 roundtrip id diff 实证就在 store 层加重锚代码可能是无效修（setGraph 已重锚）或修错层（loading 门）。
3. **基线重置不能随 reload 一起跳过**（F-5/FLAG-1）——跳 reload 但不跳 `lastEventCountRef` 重置。
4. **禁止顺手修 health 字段映射**（FLAG-2）。
5. **suppressGraphSaved 删除后 59 SC4 必须保持绿**（FLAG-4）——若红,说明 D-01 判定漏了 rerun 的保存路径（rerun save 也带 savedBy 即自然覆盖）。
6. **loading 门闪断是面板内部态杀手**——store detailNode 活着 ≠ 面板体验连续（panelWidth/tab/滚动位置在 unmount 时丢失）;e2e 断言应含「面板 DOM 未卸载」级检查（如 data-testid 持续存在）而非仅「重新打开」。

## Sources

### Primary (HIGH confidence)
- 全部为本仓代码行级实读:FlowCanvas.tsx L266/328-342/415-465/673-690 · canvasStore.ts L445-446/477-493 · save-v2.ts L60-77 · load-v2.ts L85-145 · canvasRelationalStore.ts upsertNode/upsertLink · serialize.ts L1-58 · useStaleRerun.ts L59 · mock server.mjs L170-197 · useCanvasSocket.ts L234-237 · useCanvasPersistence.ts L115-136

### Metadata
**Confidence breakdown:**
- Standard stack: HIGH — 全部仓内既有设施,零新依赖
- Architecture: HIGH — reload 链全貌行级实证
- Pitfalls: HIGH — 6 条全部有行号/先例;collapse 根因 MEDIUM（诊断任务收口）

**Research date:** 2026-08-24
**Valid until:** 2026-09-24（仓内代码,随 drift 失效）
