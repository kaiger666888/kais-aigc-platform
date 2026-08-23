# Phase 59: 窄触发 stale 级联 (Narrow-Trigger Stale Cascade) - Context

**Gathered:** 2026-08-23
**Status:** Ready for planning

<domain>
## Phase Boundary

生成-迭代闭环的下游感知 + execute 链真实化。两部分（用户裁决 08-23 扩入第二部分）：

1. **窄触发级联**（STALE-01/02/03）：仅「面板配方重生成」与「事件芯片换 seed 重跑」两条路径，在任务**成功**后把该资产的下游节点自动标 stale（角标可见、可一键重跑）；编排/批量路径行为零变化（负向断言锁死）。
2. **execute 链四断点全修**（用户裁决扩入 scope，详见 D-06）：canvas→引擎 execute 链当前 4 断点使「重生成成功」本身是假的——级联语义建立在其上必须先修真。ROADMAP Phase 59 Goal 已同步补线。

改动面：src/routes/canvas/execute.ts + _engine.ts + _simulate.ts（服务端标记 + 断点修复）、packages/flowgraph-v3 stale.ts（复用不改动或最小接线）、infinite-canvas 客户端（预期零改动或近零——服务端经既有 node:updated 链驱动级联）。

</domain>

<decisions>
## Implementation Decisions

### 标记架构
- **D-01: 服务端标记。** executeNode(extra) 请求携带 regen 身份标识；服务端在任务成功判定处调 markStaleDownstream 写库（data.stale 上 wire，reload 即在）+ 发 node:updated，客户端**零改动**复用既有 socket node:updated → triggerStaleCascade 级联链。编排/批量不走 executeNode-extra 通道 → SC3 零波及是**架构性保证**而非行为过滤。
- **D-02: 失败不级联。** error/failed 状态绝不标下游（SC1/SC2 锁「成功后」）；修完 D-06 断点③后「成功」信号为真，此语义才可靠。

### 级联语义（宪法 §13 全部沿用，不重新发明）
- **D-03: 级联深度 = 传递闭包。** markStaleDownstream 沿因果边（asset→event→asset→…）级联，flowgraph-v3 stale.ts 现成语义直接复用。
- **D-04: 落选/locked 边界沿用。** isInactive 置灰边不传播（P12×P13「选定版接管下游」——改选定变体不误波及落选）；curation:'locked' 资产是传播终点（自身不标脏、不向下传）；sequence 边不参与。与 Phase 58 CR-01 的落选豁免语义一致，planner 无需重新裁决。
- **D-05: stale 字段复用不另开。** 级联标记写同一 data.stale 字段（52-02 上 wire 语义 + relational store 落库）；StaleInfo.trigger* 已记录链条起点（triggerAssetId/triggerEventId），不区分「手动/级联」来源字段。

### execute 链四断点（用户裁决全修，scope 扩入）
- **D-06: 四断点全修**（08-23 review 未修项，编号沿用 review 记录）：
  ① `_engine.ts:133` poll 读 `raw.output_url/raw.result?.*` 但引擎返回 `outputs.image` → outputUrl 恒 null——改读引擎真实返回形状；
  ② 输出 `/mnt/agents/output/` 容器路径无 `/oss/` 翻译——复用 import 链现成的 fsToOssUrl；
  ③ `_simulate.ts:145` 引擎任何错误 catch 后 simulateOnly→广播 success=**假成功**（引擎挂掉时 100% 触发）——改为广播 error/failed + 负向断言锁死；
  ④ ref 参数名错配：canvas 发 `reference_images`/值 `/oss/` web 路径 vs 引擎收 `ref_images`/容器可见路径——对齐参数名与路径形态。
  另：REGEN-02 seed 被 execute.ts 校验后直接丢弃——一并对齐（seed 须真传到引擎请求体）。
- **D-07: 修真优先于接线。** 断点修复 plan 先行/同波前置，标记接线 plan 依赖其产出（假成功不修，STALE-01/02 的「成功后」在引擎故障时是假的）。

### Claude's Discretion
- regen 身份标识的具体形态（extra 字段名、requestId vs 来源枚举）
- 服务端 markStaleDownstream 的执行位置（execute 成功回调内 vs poll 完成处）与 node:updated 的 payload 形状（对齐既有事件格式）
- 断点修复的测试策略（mock 引擎返回形状的构造方式）
- e2e 断言的组织（复用 phase52-regen mock 范式）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 级联语义真值源
- `packages/flowgraph-v3/ts/src/stale.ts` — P13 脏传播纯函数全文（宪法 §3/§13 注释即契约：传递闭包/sequence·isInactive 排除/locked 终点/trigger 溯源/纯函数）
- `packages/flowgraph-v3/ts/tests/stale.test.ts` — 级联语义既有测试基线

### execute 链现场
- `src/routes/canvas/execute.ts` — executeNode 入口（L28 params 槽位、extra 通道、seed 校验丢弃点 REGEN-02）
- `src/routes/canvas/_engine.ts` — 引擎 poll（L133 断点①现场）
- `src/routes/canvas/_simulate.ts` — 模拟器（L33 legacy blob 读取、L145 假成功 catch、NODE_TYPE_TO_TASK_TYPE）
- `packages/infinite-canvas/src/services/canvasApi.ts` L372-385 — executeNode 客户端签名（extra: prompt/seed/params，52-02 契约）

### 客户端级联消费侧（预期零改动的复用面）
- `packages/infinite-canvas/src/hooks/useStale.ts` — triggerStaleCascade + 脉冲动效（现有触发：变体切换/审核通过/human_edit/socket node:updated）
- `packages/infinite-canvas/src/store/canvasStore.ts` L57-58/L455 — markStaleDownstream action；L725-730 node:state success 自动清 stale（52-01 红线：error/failed 保留 stale）
- `packages/infinite-canvas/src/hooks/useStaleRerun.ts` — 重跑下游统一出口（SC4 消除标记路径，无需改动）
- `packages/infinite-canvas/src/components/badges/NodeBadges.tsx` — stale 角标渲染

### 上下游 phase 契约
- `.planning/phases/58-full-recipe-persistence/58-CONTEXT.md` — §14 全配方窄通道（STALE-01 触发路径即 Phase 58 打通的配方编辑重生成）
- `.planning/phases/58-full-recipe-persistence/58-REVIEW.md` — CR-01 落选豁免语义（serialize delete 传播对 deprecated 豁免——本 phase D-04 的姊妹边界）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `markStaleDownstream(changedAssetIds, graph)` — 级联核心零改动复用（服务端执行时需在 Node 侧引入 flowgraph-v3 纯函数——注意 flowgraph-v3 是 ts 源码包，服务端 tsx/esbuild 已有 alias 先例）
- socket `node:updated` → useStale.triggerStaleCascade 链 — 客户端标记路径 100% 现成
- `useStaleRerun` + StaleSection + NodeBadges — 角标可见与一键重跑（SC4）全部现成
- fsToOssUrl（import 链）— 断点② 的现成翻译函数

### Established Patterns
- executeNode extra 通道（52-02）：可选参数向后兼容，既有调用方不传——regen 身份标识经此扩展
- verify-phase-52/58 聚合门范式 — 本 phase 的负向断言（SC3 编排零波及）与断点修复守护门可循
- e2e mock getCalls 请求体断言（58-03）— 断点④ ref 参数名对齐的断言侧

### Integration Points
- 服务端 execute 成功判定处 → markStaleDownstream（DB 写）→ node:updated socket → 客户端级联（唯一新增接缝，D-01）
- 引擎 :8002 REST 返回形状（outputs.image）— 断点①的对齐目标
- `/mnt/agents/output/` ↔ `/oss/` 路径翻译 — 断点②，import 链有现成映射

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within (expanded) phase scope

</deferred>

---

*Phase: 59-narrow-trigger-stale-cascade*
*Context gathered: 2026-08-23*
