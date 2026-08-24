# Phase 61: 审计清债 TD-3/4/5 (Audit Debt Clearance) - Research

**Researched:** 2026-08-24
**Domain:** kap 仓画布侧四项独立技术债清偿（放置纯函数活调用方 / 出站 URL 尾斜杠 / V3 meta 读回 / socket 写路径裁定）
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01: 资产中心拖入为 anchor='source' 唯一活调用方。** 源锚定 + 8px 网格有界落位（55-04 NAV-04 既有 placeNewAsset 语义），e2e 断言落点有界；不做全路径统一（改动面控制）。
- **D-02: DEBT-04 证据驱动裁定。** 沿 60-01 Branch A/B 范式：planner 先查 node:created 当前写路径——已走 canonical（addNodeFromSocket/WRITE-03）则断言+文档化收口；绕过 canonical 则接线。裁定结果写入 phase 目录成文文档。
- **D-03: 4 个独立 mini-plan 并行单 wave。** ROADMAP 明示 parallel-safe、零文件交集；每项自带回归/守护与独立 verify。
- **D-04: 每笔债销账动作。** 修完即在 REQUIREMENTS.md 勾选 + 51-REVIEW 对应 finding 标注已清偿（若该文件存在追踪节）。

### Claude's Discretion
- e2e 断言组织（复用 phase55-nav 的放置断言面 vs 新文件）
- DEBT-02 回归锁形态（verify 聚合门静态锁 vs e2e 请求断言）
- DEBT-03 往返测试挂点（vitest 纯函数往返 vs dispatch 集成）

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEBT-01 | `placeNewAsset(anchor='source')` 获得活调用方(资产中心/画布入口放置新资产),附 e2e | 现状钉死：两个活调用点均 `anchor:'center'`（FlowCanvas.tsx L293 / main.tsx L79）；资产中心已有占位入口 `handleAddToCanvas`（stub）可承载；服务器 POST /api/canvas/v2/nodes/ 现成（position 必填+zod 门+node:created 广播）；e2e 断言面（getGraph+getViewCenter ≤64px）可直接复用 |
| DEBT-02 | reviewBridge 列表 URL 尾斜杠修正,307 中间跳消除,回归测试锁死 | 现场钉死：src/lib/reviewBridge.ts L182 唯一无斜杠列表调用；54-01 已修同款（gateStateService.ts L323-324 + verify-phase-54.ts L193 回归锁先例）；307→丢端口→404 已在本机 review-nginx :8090 活体验证 |
| DEBT-03 | `buildMeta` 读回 5 个持久化字段(emotion/promptMeta/murchGrade/archetype/viewAngle),save→reload meta 往返保真 (51-REVIEW I1) | 缺口钉死在**读侧**：packages/flowgraph-v3/ts/src/migrate.ts buildMeta（L246-310）script/storyboard/video/global 四分支缺 5 字段读取；写侧 serialize.ts flattenMeta（L171-209）摊平无缺口；zod/types 两侧行号均已核，5 字段全部 schema 合法 |
| DEBT-04 | `node:created` 写入 canonical graph(V3 资产构造)或显式文档化为 ephemeral 并留守护注释 (51-REVIEW I5) | **裁定 = Branch A（已 canonical）**：51-REVIEW I5 记录的 setNodes 直写已在 Phase 55-04 改为 addNodeFromSocket；证据链 useCanvasSocket L188 → FlowCanvas L284-304 → canvasStore L811-842 → adapter adaptV2Node L494-516（V3 资产构造=migrateV2toV3 单节点）→ setGraph |
</phase_requirements>

## Summary

四笔债全部在行级钉死，且每笔的「修法」都已有仓内先例可直接套用。最重要的勘误：CONTEXT `canonical_refs` 两处位置偏差——`placeNewAsset` 实际在 `packages/infinite-canvas/src/utils/placeNewAsset.ts`（非 canvasStore.ts），`buildMeta` 实际在 `packages/flowgraph-v3/ts/src/migrate.ts` L246（非 v3/adapter.ts——adapter 的 adaptV2Node L494 是 node:created 用的单节点入口，整图读回走同包 migrateV2toV3）。planner 按正确文件出 task。

工作量分布极不均匀：**DEBT-04 基本免费**（裁定已可下——Branch A，55-04 已接线，只差成文文档+静态锁）；**DEBT-02 是一字之修**（L182 补一个 `/`，配单元回归或静态锁）；**DEBT-03 是外科手术**（migrate.ts 四分支各补 1-2 行条件展开 + 两侧 vitest）；**DEBT-01 是本 phase 唯一的「真功能」**（资产中心拖入从零建：draggable 卡片 + 画布 onDrop + placeNewAsset(source) + 持久化通道 + e2e），其 mock-backend 缺口（无 POST /nodes 路由、无 assets-registry/search 路由）是 Wave 0 必补项。

四项零文件交集确认成立：DEBT-01 动 assetManager/FlowCanvas-drop/mock-backend；DEBT-02 动 src/lib/reviewBridge.ts；DEBT-03 动 flowgraph-v3 migrate.ts + 两处测试；DEBT-04 只产出文档 + verify 脚本断言（与 DEBT-01 在 FlowCanvas 同文件但不同行段——onNewAsset 处理器 vs 新增 onDrop，非冲突）。

**Primary recommendation:** 按 D-03 出 4 个独立 mini-plan 并行：61-01(D1 e2e+拖入接线,最重) / 61-02(D2 一字修+回归锁) / 61-03(D3 buildMeta 四分支+双侧往返测试) / 61-04(D4 Branch A 裁定文档+静态锁)，收口在 verify:phase-61 聚合门（58/59/60 范式）。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 放置落点决策（placeNewAsset 纯函数 + source 锚定调用） | Browser / Client (infinite-canvas) | — | 落点是视图态决策（拖放点/视口），纯函数已在前端包，e2e 断言面在前端 testMode 桥 |
| 新节点持久化 + 多 tab 广播 | API / Backend (POST /api/canvas/v2/nodes/) | Browser (zod 前置校验) | 单行 UPSERT + broadcastToProject('node:created') 现成；relational store 是真值源 |
| review 列表出站 URL | API / Backend (src/lib/reviewBridge.ts) | — | 桥在服务端发 fetch（fire-and-forget），URL 常量在服务端 lib |
| V2→V3 meta 读回（buildMeta） | Browser / Client (@kais/flowgraph-v3 migrate.ts) | — | reload 链：load-v2 响应 → adaptV2Graph → migrateV2toV3 → buildMeta，全在前端数据层包 |
| node:created → canonical graph | Browser / Client (canvasStore addNodeFromSocket) | Server (广播形状 { node }) | WRITE-03 裁定写路径归 store canonical action；服务器只广播不落前端状态 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @xyflow/react | ^12.6.0 | 画布/拖放（onDrop/onDragOver pane props + screenToFlowPosition） | 既有依赖；v12 原生 HTML5 DnD 集成面 [VERIFIED: codebase package.json] |
| @kais/flowgraph-v3 | file:../flowgraph-v3 (v3.1.0) | V3 schema/迁移/buildMeta 所在包 | 既有 workspace 依赖；exports 直指 `./ts/src/index.ts` 源码（无构建产物），改 migrate.ts 即时生效 [VERIFIED: codebase] |
| vitest | ^2.1.9 | 单测（infinite-canvas `npm test`；flowgraph-v3 `npm test` = `cd ts && vitest run`） | 既有测试基建 [VERIFIED: codebase] |
| Playwright | (infinite-canvas devDep, chromium 缓存在位) | e2e（workers:1, webServer :9876 起 mock-backend） | 既有 e2e 基建，16 个 phase 测试文件先例 [VERIFIED: codebase] |
| zod | (root + flowgraph-v3) | 节点入参门（nodeInputSchema）+ assetStageMetaSchema | 既有；zod schema 是 spec 真值源（继承裁定）[VERIFIED: codebase] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| socket.io / socket.io-client | ^4.8.3 | mock-backend 已内建 `io.of('/ws/projects')` + `/__mock/emit` 广播 | DEBT-01 若走服务端 POST，mock 需在 route 内 broadcastToProject | 

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| 服务端 POST /nodes 持久化拖入 | 纯客户端 addNodeFromSocket 本地写 | 客户端写不落库——graph:saved 全量 reload 会抹掉（I5 描述的 ephemeral 陷阱重演）；不取 |
| HTML5 DnD（draggable + onDrop） | pointer-events 手写拖拽 | RF v12 生态标准是 HTML5 DnD + screenToFlowPosition；手写要自己处理 capture/threshold，无收益 |

**Installation:** 无新包。本 phase 零外部依赖新增。

**Version verification:** 全部为仓内既有依赖（package.json 已核对），无 registry 新装。

## Package Legitimacy Audit

> 本 phase 不安装任何外部包。所有改动使用既有 workspace 依赖。slopcheck 门不适用（无新增包名可审）。

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none new) | — | — | — | — | — | N/A — 零新装 |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

四笔债在「保存→广播→重载」闭环中的触点：

```
资产中心(AssetLibrary)                后端(kap src/)                     flowgraph-v3 / canvasStore
┌──────────────────┐   DEBT-01    ┌─────────────────────┐          ┌──────────────────────────┐
│ 卡片拖入(drag) ───────────────────▶ POST /api/canvas/v2/nodes/    │                          │
│                  │  placeNewAsset│  · zod nodeInputSchema(必填    │                          │
│ (stub 按钮待废)  │  (anchor=     │    position)                   │                          │
│                  │   'source')   │  · upsertNode + touchMeta      │                          │
└──────────────────┘               │  · broadcastToProject ──┐      │                          │
                                   └─────────────────────────┼──────┘                          │
                                                             │ node:created {node}            │
                                    ┌─────────────────────────▼──────┐                        │
                                    │ useCanvasSocket L188 形状守卫    │  DEBT-04 (Branch A)    │
                                    │ → FlowCanvas onNewAsset L284    │────────────────────────┤
                                    │   position: 服务端有限即用       │ addNodeFromSocket L811  │
                                    │   else placeNewAsset(center)   │ → adaptV2Node L494      │
                                    │                                 │   (V3 资产构造)          │
                                    │                                 │ → setGraph(canonical)   │
                                    └─────────────────────────────────┘                        │
                                                                                               │
  保存: store.graph ──serializeGraphToV2(flattenMeta 摊平 5 字段 ✅)──▶ save-v2 ──▶ relational   │
  重载: load-v2 ──▶ adaptV2Graph ──▶ migrateV2toV3 ──▶ buildMeta ❌ 丢 5 字段 ──────────────────┘
                                                (DEBT-03 读侧缺口, migrate.ts L246-310)

  选定 winner(异步) ──▶ reviewBridge.ts L182 `/api/v1/reviews?` (无斜杠) ──▶ review-nginx :8090
                          DEBT-02: 307 → Location 丢端口 → 404 (活体验证) ; 修为 `/api/v1/reviews/?`
```

### Recommended Project Structure
```
改动落点（按 mini-plan 分组,零文件交集）:
packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx   # 61-01: 卡片 draggable + 拖入处理
packages/infinite-canvas/src/components/FlowCanvas.tsx                   # 61-01: ReactFlow onDrop/onDragOver (onNewAsset 段不碰)
packages/infinite-canvas/src/services/canvasApi.ts                       # 61-01: placeAssetOnCanvas stub → 真实现(POST nodes)
packages/infinite-canvas/test/e2e/mock-backend/server.mjs               # 61-01: 补 POST /nodes + assets-registry/search 路由
packages/infinite-canvas/test/e2e/tests/phase61-debt.mjs (新)           # 61-01: 拖入有界落点 e2e
src/lib/reviewBridge.ts                                                 # 61-02: L182 尾斜杠 + 文档头 L19 契约注释
src/lib/__tests__/reviewBridge.test.ts (新)                             # 61-02: 注入 fetchImpl 断言 URL
packages/flowgraph-v3/ts/src/migrate.ts                                 # 61-03: buildMeta 四分支补 5 字段
packages/flowgraph-v3/ts/tests/migrate.test.ts                          # 61-03: buildMeta 单测
packages/infinite-canvas/src/v3/__tests__/serialize.test.ts             # 61-03: adapt∘serialize 往返用例
.planning/phases/61-audit-debt-clearance/61-DEBT04-VERDICT.md (新)      # 61-04: Branch A 裁定成文
scripts/verify-phase-61.ts (新) + package.json 注册                     # 收口: 聚合门
```

### Pattern 1: 聚合 verify 门（58/59/60 范式）
**What:** S 静态锁段（grep 锚）+ B 行为门段（spawn 子进程跑 tsc/vitest/build/e2e）+ F forced-failure 自检（变异样本证明门能红）→ exit 0/1/2。
**When to use:** 本 phase 收口门 verify:phase-61 必须照此骨架（verify-phase-60.ts L1-43 头注释即模板）。
**Example:**
```typescript
// Source: scripts/verify-phase-60.ts (L52-90, 现行范式)
interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void { ... }
function runCmd(name: string, cwdRel: string, cmd: string, tailLines = 3): void {
  const res = spawnSync(cmd, { cwd: path.join(REPO_ROOT, cwdRel), shell: true,
    timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  ...
}
```

### Pattern 2: 尾斜杠回归锁（54-01 先例，DEBT-02 直接复用）
**What:** 行为断言捕获出站 URL 后断言带斜杠；或静态 grep 锁源码字面量。
**When to use:** DEBT-02 的回归锁二选一（CONTEXT discretion）——推荐**两者都做**（单测防行为回归 + 静态锁防文件被复制）。
**Example:**
```typescript
// Source: scripts/verify-phase-54.ts L193 (现行, gateStateService 的锁)
assert(uriLog.every((u) => u.includes("/api/v1/reviews/?")), "S-poller: 列表 URL 带尾斜杠(54-01 纪律)");
```

### Pattern 3: e2e 有界落点断言（phase55-nav 现行断言面，DEBT-01 复用）
**What:** testMode 桥 `getGraph()` 读 canonical 节点 position（rfNodes 是布局缓存不可断言）+ `getViewCenter()` 读 live 视口 → 各轴 ≤64px。
**When to use:** DEBT-01 拖入落点断言：source 锚定下锚 = 拖放点（或源节点 position），断言 |node.pos − source| 各轴 ≤64（既有界先例；源锚定理论紧界 dx≤26/dy≤18，取 64 留裕量亦可）。
**Example:**
```javascript
// Source: packages/infinite-canvas/test/e2e/tests/phase55-nav.mjs L139-152 (现行)
const dist = await page.evaluate((nid) => {
  const g = window.__kaisCanvas?.getGraph()
  const n = g?.nodes.find((x) => x.id === nid)
  const c = window.__kaisCanvas?.getViewCenter()
  if (!n || !c) return null
  return { dx: Math.abs(n.position.x - c.x), dy: Math.abs(n.position.y - c.y) }
}, added)
expect(dist.dx).toBeLessThanOrEqual(64)
expect(dist.dy).toBeLessThanOrEqual(64)
```

### Pattern 4: buildMeta 条件展开（DEBT-03 外科修法，仓内同款句式）
**What:** 每分支 `...(d.X != null ? { X: d.X } : {})` 读回 flat data 字段——与 migrate.ts 既有 14 处同句式零新范式。
**When to use:** DEBT-03 的 migrate.ts 四分支修改。
**Example:**
```typescript
// Source: packages/flowgraph-v3/ts/src/migrate.ts L284 (audio emotion 现行同款句式,DEBT-03 照抄)
...(d.emotion != null ? { emotion: d.emotion } : {}),
```

### Anti-Patterns to Avoid
- **「修 307」= 让 fetch 容忍重定向：** 根因是 URL 非法（无斜杠撞 Starlette redirect_slashes），修法是 URL 补斜杠直连，不是加重定向处理逻辑（54-01 已裁定同款）。
- **断言 rfNodes position：** rfNodes 是 layoutFlowGraph 布局缓存，非放置决策真值（main.tsx L41-43 注释明示）；必须断言 store.graph 节点 position。
- **在 onNewAsset 里再手写一次落点：** 服务端 position 有限即用（真相优先，FlowCanvas L288-292）；拖入方算好 position POST 上去，广播回来直用，不要二次偏移。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 落点数学（偏移+网格 snap+非有限防御） | 重写坐标计算 | `placeNewAsset`（utils/placeNewAsset.ts） | 纯函数已存在且有单测（placeNewAsset.test.ts 8 用例）；DEBT-01 就是给它接活调用方 |
| 新节点持久化路由 | 新建 place 端点 | `POST /api/canvas/v2/nodes/`（src/routes/canvas/v2/nodes.ts L48-97） | 现成：zod 门+单行 UPSERT+node:created 广播+409 查重；canvasApi.ts L1202 stub 注释里的 `POST /v1/assets-registry/place` 从未落地也不需要 |
| V2→V3 单节点适配 | 拖入后手拼 V3 节点 | `addNodeFromSocket`（canvasStore L811）→ adaptV2Node（adapter L494） | zod 同源校验+id 查重+raw 袋注入+setGraph 派生重建一条龙；测试桥 addNodeForTest 同路（main.tsx L73） |
| meta 读回合并逻辑 | 客户端 post-hoc 补字段 | `buildMeta` 分支内读 | 读回必须发生在 migrate 层（V3 直通/fixture 图无 rawData 袋，任何客户端补丁都救不了；51-REVIEW I1 suggested fix 同裁定） |
| review 列表分页/过滤 | — | 现有 resolveOpenReviewForSelection 骨架不动 | DEBT-02 只动 URL 字符串；分页/三维修护已过 49/54 两轮 verify |

**Key insight:** 四笔债没有一笔需要新抽象——每笔的修法都在仓内有逐字先例（Pattern 2/3/4 分别对应 DEBT-02/01/03）。本 phase 的风险不在「怎么修」而在「别多修」（D-01 改动面控制）。

## Common Pitfalls

### Pitfall 1: e2e 跑的是 dist 不是源码
**What goes wrong:** 改了 src 直接跑 playwright，测试的还是旧 bundle。
**Why it happens:** mock-backend `express.static(DIST_DIR)`（server.mjs L482）服务 `packages/infinite-canvas/dist/`。
**How to avoid:** e2e 前必须 `npm run build`（= `tsc -b && vite build`）；verify-phase-60 B 段已把 build 列为纪律门，phase-61 照做。
**Warning signs:** e2e 行为与源码改动不符。

### Pitfall 2: 307 修复后跟着来的「假绿」
**What goes wrong:** 单测注入的 fetchImpl 天然不会走真重定向——只断言「URL 带斜杠」在 URL 改对后恒绿，但改回无斜杠时若断言只查「请求成功」也不红。
**Why it happens:** 注入 fetch 是 mock，307 是网络层行为。
**How to avoid:** 回归锁必须断言**字面量**（URL 含 `/api/v1/reviews/?`）或捕获的 URL 串含斜杠——而非响应成功；静态锁 + 单测双保险（verify-phase-54 L193 + reviewBridge.test.ts）。
**Warning signs:** 回归测试删掉斜杠仍绿。

### Pitfall 3: emotion 双类型陷阱（DEBT-03）
**What goes wrong:** buildMeta script 分支补 `d.emotion` 读取时想当然当 string。
**Why it happens:** 同名字段两个类型——script meta `emotion?: number`（types.ts L114 / zod.ts L155），audio meta `emotion?: string`（types.ts L128 / zod.ts L143）。
**How to avoid:** script 分支读回的 emotion 是 number；zod strict 判别联合会在类型错配时打回（正好是回归网）。
**Warning signs:** migrate 测试用 string emotion 过不了 schema。

### Pitfall 4: rawData 透传掩盖 DEBT-03 损失
**What goes wrong:** 往返测试断言「wire data 里有 emotion」——即使 buildMeta 没修也绿。
**Why it happens:** serialize 公式 `{...raw, ...flattenMeta}`（serialize.ts L247）——reload 后 raw 袋还带着旧值，wire 层看似保真，损失只在 canonical `asset.meta`；而 V3 直通/fixture 模式（无 raw 袋）才真丢 wire。
**How to avoid:** 断言必须打在 **adapt∘serialize 之后的 canonical meta 字段**（`graph.nodes[i].meta.emotion === 原值`），不能打在 wire data 或 raw 袋。
**Warning signs:** 测试读 `rawDataByNodeId` 或 wire body 而非 V3 meta。

### Pitfall 5: D-01「8px 网格」措辞与代码事实的出入
**What goes wrong:** planner 按决策文字把 source 分支网格改成 8px，或误以为要改 placeNewAsset。
**Why it happens:** CONTEXT D-01 写「源锚定 + 8px 网格有界落位（55-04 NAV-04 既有 placeNewAsset 语义）」——但既有函数 source 分支是 **4px 网格**（PLACE_GRID = { source: 4, center: 8 }，placeNewAsset.ts L18）；「既有语义」才是锁定的对象，8px 是 center 分支的参数。
**How to avoid:** placeNewAsset 零改动，只接线；如 planner 对文字有疑，按「既有函数语义优先」处理并留 note（本条已列入 Assumptions A2 待确认）。
**Warning signs:** task 里出现「修改 placeNewAsset 网格」动作。

### Pitfall 6: 资产中心遗留双入口
**What goes wrong:** 拖入做好的同时保留 stub 的「添加到画布」按钮，产生第二条放置路径，违反 D-01「拖入为唯一活调用方」。
**Why it happens:** AssetLibrary.tsx L817-825 handleAddToCanvas（stub toast「占位 · 待后端 place 端点」）+ canvasApi.ts L1202-1209 placeAssetOnCanvas（恒 true 假实现）现状仍在。
**How to avoid:** 拖入落地时同步处置 stub 链（按钮删除或改为等价触发拖入语义——planner 裁定，倾向删除按钮+stub 函数改造为真 POST nodes 封装，被拖入路径复用）。
**Warning signs:** grep `placeAssetOnCanvas` 仍有无实现调用方。

### Pitfall 7: mock-backend 缺路由导致 e2e 假失败
**What goes wrong:** e2e 拖入后节点没出现/资产中心空列表。
**Why it happens:** mock server.mjs 无 `POST /api/canvas/v2/nodes/` 路由（现有 16 条路由已核，L169-475 全列）；也无 `/api/v1/assets-registry/search`（useRealAssets 唯一数据源，失败即空态）。
**How to avoid:** Wave 0 补两条 mock 路由（nodes 仿 save-v2 写 state + broadcastToProject('node:created',{node})，server.mjs 已有 io 实例 L500；search 返回 2-3 条已知 id/filePath 的 AssetDetail envelope `{data:{assets:[...]}}`）。
**Warning signs:** e2e 网络面板 404。

### Pitfall 8: node id 约定与查重语义
**What goes wrong:** 拖入构造节点 id 随机生成，locate-on-canvas（`asset-${a.id}` 约定，AssetLibrary L831）失效；或同资产二次拖入 409/静默忽略无反馈。
**Why it happens:** POST /nodes 对已存在 id 返回 409（nodes.ts L76-78）；addNodeFromSocket 对重播 warn+ignore（canvasStore L827-829）。
**How to avoid:** id 用 `asset-${a.id}` 约定（与 handleLocateOnCanvas/handleGoCanvasSelect 同源）；重复放置走 409 → toast「已在画布」提示。
**Warning signs:** e2e 重复拖同一卡片断言失败。

### Pitfall 9: verify 脚本与父进程共享 knex/事件循环
**What goes wrong:** verify-phase-61 里直接 import app 触发 knex pool 不 settle / fake 引擎死锁。
**Why it happens:** 49-01 教训（STATE 决策记录）+ 59-02 spawnSync 冻结事件循环教训。
**How to avoid:** 行为门一律 `spawnSync` 子进程（runCmd 范式）；本 phase 若不触 DB 甚至可以纯静态+vitest+e2e，不引 app。
**Warning signs:** verify 挂起不退出。

### Pitfall 10: flowgraph-v3 改动的测试/类型面遗漏
**What goes wrong:** 只跑 infinite-canvas vitest，漏了 flowgraph-v3 自己的测试包与 root tsc。
**Why it happens:** flowgraph-v3 exports 是 ts 源码（无构建），两个消费方（infinite-canvas vitest / root `tsc --noEmit`）+ 自身 `cd ts && vitest run` 三面都要绿（v3.0 审计「3× tsc clean」口径）。
**How to avoid:** 61-03 verify 动作包含：flowgraph-v3 npm test + infinite-canvas npm test + root tsc --noEmit。
**Warning signs:** 聚合门只跑了 infinite-canvas。

## Code Examples

### DEBT-02: 一字修 + 文档头同步
```typescript
// 现状 Source: src/lib/reviewBridge.ts L182 [VERIFIED: codebase]
const listResp = await fetchImpl(`${baseUrl}/api/v1/reviews?${qs.toString()}`, { ... })
//                                            ↑ 无斜杠 → review-nginx 307 → Location 丢端口 → 404

// 修法（54-01 同款, Source: src/lib/gateStateService.ts L323-324 [VERIFIED: codebase]）
// 尾斜杠(54-01):/api/v1/reviews 无斜杠 307 → location 丢端口 → 404。
const resp = await this.fetchImpl(`${this.baseUrl}/api/v1/reviews/?${qs.toString()}`, { ... })
// 同步改模块头契约注释 L19: `GET /api/v1/reviews?...` → `GET /api/v1/reviews/?...`
```

### DEBT-02: 活体验证证据（本机 review-nginx :8090, 2026-08-24）
```
$ curl -D - "http://localhost:8090/api/v1/reviews?status=PENDING&limit=1"
HTTP/1.1 307 Temporary Redirect
Location: http://localhost/api/v1/reviews/?status=PENDING&limit=1   ← 端口 8090 被丢
$ curl -w "%{http_code}" "http://localhost:8090/api/v1/reviews/?status=PENDING&limit=1"
200  {"data":{"items":[],"next_cursor":null,"has_more":false},...}   ← 带斜杠直连 200
```

### DEBT-03: buildMeta 四分支补丁点（修后形状）
```typescript
// Source: packages/flowgraph-v3/ts/src/migrate.ts L246-310 现状 + 补丁示意
case 'script':   // L248-255 — 补 1 行
  return {
    stage: 'script',
    ...(d.hookType != null ? { hookType: d.hookType } : {}),
    ...(d.hookIntensity != null ? { hookIntensity: d.hookIntensity } : {}),
    ...(d.premise != null ? { premise: d.premise } : {}),
    ...(d.emotion != null ? { emotion: d.emotion } : {}),          // ← 补 (number!)
  };
case 'storyboard': // L256-271 — 补 1 行 (promptMeta: PromptFacets 对象,record 直传)
  ...(d.promptMeta != null ? { promptMeta: d.promptMeta } : {}),   // ← 补
case 'video':     // L272-278 — 补 1 行
  ...(d.murchGrade != null ? { murchGrade: d.murchGrade } : {}),   // ← 补
case 'global':    // L279-305 — 补 2 行
  ...(d.archetype != null ? { archetype: d.archetype } : {}),      // ← 补
  ...(d.viewAngle != null ? { viewAngle: d.viewAngle } : {}),      // ← 补
```
schema 合法性已核：zod.ts L155(script emotion: number)/L168(promptMeta)/L177(murchGrade)/L187-188(archetype/viewAngle) 全部 optional 在场——补读不改 schema。

### DEBT-03: 往返测试断言形状（canonical meta, 非 wire/raw）
```typescript
// 挂点 A: packages/flowgraph-v3/ts/tests/migrate.test.ts — buildMeta 单元级
//   构造 FlowNodeV2 { type:'script', data:{ emotion: 7, ... } } → migrateV2toV3 →
//   断言 graph.nodes[0].meta.emotion === 7 (五字段×对应 stage 各一用例)
// 挂点 B: packages/infinite-canvas/src/v3/__tests__/serialize.test.ts — adapt∘serialize 集成级
//   (现有 asset() builder + serializeGraphToV2 + adaptV2Graph 工具链直接复用, head 已核)
const g3 = buildV3GraphWithFiveFields()          // meta 含 emotion/promptMeta/murchGrade/archetype/viewAngle
const wire = serializeGraphToV2(g3, null, undefined)  // rawDataByNodeId=null → 纯 flattenMeta(最严格:无 raw 兜底)
const back = adaptV2Graph(JSON.parse(JSON.stringify(wire)))
expect(findNode(back.graph, 'n-script').meta.emotion).toBe(7)        // canonical meta 断言
// 注意: rawDataByNodeId 传 null 是关键——传 raw 袋时 Pitfall 4 的透传会掩盖读侧缺口
```

### DEBT-04: Branch A 证据链（裁定文档的引用材料）
```text
[VERIFIED: codebase, 2026-08-24]
1. useCanvasSocket.ts L188-195   socket.on('node:created') 形状守卫({node}) → onNewAsset 转发
2. FlowCanvas.tsx L284-304       onNewAsset: position 决策(服务端有限即用/否则 center)
                                 → useCanvasStore.getState().addNodeFromSocket(node, position)
                                 注释明示「写回走 canonical addNodeFromSocket(WRITE-03),不再 setNodes 直写」
3. canvasStore.ts L811-842       addNodeFromSocket: adaptV2Node → id 查重 → setGraph(canonical 全量重建)
                                 + rawDataByNodeId 注入
4. adapter.ts L494-516           adaptV2Node: normalizeNode + migrateV2toV3 单节点 = V3 资产构造
                                 (头注释 L489 明示「socket node:created 增量写回用」)
51-REVIEW I5 原文已从 git 历史 (d59af2f3^) 取回: 其记录的 FlowCanvas.tsx:217-224 setNodes 直写
已被 Phase 55-04 重写——I5 描述的 bug 类已在 55-04 消除,DEBT-04 只欠「断言+文档化收口」。
```

### DEBT-01: 服务器侧通道（现成,零后端新增）
```typescript
// Source: src/routes/canvas/v2/nodes.ts L28-45, L48-97 [VERIFIED: codebase]
// POST /api/canvas/v2/nodes/  body: { projectId, episodesId, node: {
//   id?, type(enum 含 'asset'), branchId, phaseIndex, phaseName,
//   position: {x,y} ← 必填, placeNewAsset(source) 的产出放这里,
//   size, data(record,过 validateNodeData), state, ... } }
// → upsertNode + broadcastToProject('node:created', { node })   ← 全 tab 含本 tab 收敛
// 拖入方(id=asset-${a.id}, data={label:a.name, assetType, filePath}) → 409 = 已在画布
// asset data schema: label/assetType 均 min(1).nullish() (canvasAssetSchema L109-115, 52-UAT 宽容)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| e2e mock graph:saved 抑制旋钮 (suppressGraphSaved) | 真实回声路径 + savedBy 自回声跳过 | Phase 60-02 | phase59/60 e2e 已迁；phase-61 新 e2e 不要再造抑制旋钮，直接信任 save-v2 真实广播 |
| deleteNode 整图快照回滚 | 外科式 reinsertDeleted (51-REVIEW W1 fix) | Phase 51 | 拖入/放置不需关心；但说明 graph 并发写已有成熟共存语义（addNodeFromSocket 与 transform 可安全交错） |
| setNodes 派生缓存直写 (node:created 旧路径) | addNodeFromSocket canonical (WRITE-03) | Phase 55-04 | DEBT-04 的 Branch A 事实基础 |
| /api/v1/reviews 无斜杠 (reviewBridge) | gateStateService 已修, reviewBridge 是最后一个未修调用点 | Phase 54-01 | DEBT-02 修完后仓内 reviews 列表调用 100% 带斜杠 |

**Deprecated/outdated:**
- `canvasApi.placeAssetOnCanvas`（L1202-1209 stub 恒 true）与 AssetLibrary「添加到画布」按钮（L817-825 占位 toast）——DEBT-01 落地时处置，勿在新代码引用。
- constants.ts L82 旧 LAYOUT 随机散布常量注释已声明「新代码禁止引用」（55-07 删除）——拖入落点只能走 placeNewAsset。

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 307 根因 = Starlette redirect_slashes + nginx Location 丢端口 | DEBT-02 / Pitfall 2 | 低——本机活体验证 + 仓内 54-01 注释双重佐证；若 review-platform 改部署（nginx 直传端口）陷阱形态变，但带斜杠直连恒为正解 |
| A2 | D-01 文字「8px 网格」按「既有 placeNewAsset 语义优先」解读（source 分支实际 4px 网格，placeNewAsset 本体零改动） | Pitfall 5 | 低——若 planner/用户真要 8px 需改 PLACE_GRID.source（一行+单测），与「既有语义」措辞矛盾，倾向本解读；建议 plan 时一句话确认 |
| A3 | 拖入 sourcePosition 映射 = 拖放点（drop point 经 screenToFlowPosition），非「源节点 position」 | DEBT-01 | 中——资产中心拖入无「事件源节点」概念，drop point 是自然锚；但若用户预期是「落到最近节点旁」，交互语义不同（e2e 断言锚也随之变）。planner 裁定并在 plan 记录 |
| A4 | 拖入持久化走现成 POST /api/canvas/v2/nodes/（服务端真值），不做纯客户端写 | DEBT-01 | 低——客户端写会重演 I5 ephemeral 陷阱；stub 注释期望的 assets-registry/place 端点从未存在 |
| A5 | stub「添加到画布」按钮与 placeAssetOnCanvas 在 DEBT-01 中一并处置（删除/改造），保证拖入为唯一 anchor='source' 调用方 | Pitfall 6 | 低——D-01「唯一活调用方」的直接推论；处置方式（删 vs 改造为 POST 封装）planner 定 |
| A6 | 51-REVIEW.md 已随里程碑归档从工作区清除（仅存 git 历史 d59af2f3^），D-04 的「51-REVIEW 标注已清偿」需在 phase 目录新文档中引用 finding 编号替代原地标注 | DEBT-04 / D-04 | 低——文件不存在则按 CONTEXT「若该文件存在追踪节」条款自然降级为 verdict 文档内引用 |

## Open Questions

1. **拖入锚点语义（A3）**
   - What we know: placeNewAsset(anchor='source') 吃 sourcePosition，偏移 +24/−16、4px 网格。
   - What's unclear: 资产中心拖入的 source 是 drop point 本身（推荐，无歧义）还是光标下最近节点。
   - Recommendation: drop point（screenToFlowPosition 换算），plan 里显式记一句；e2e 断言锚 = 记录的 drop flow 坐标，界 ≤64px。
2. **DEBT-02 回归锁形态（CONTEXT discretion 已授权二选一）**
   - What we know: 静态锁先例（verify-phase-54 L193）与单测注入（reviewBridge deps.fetchImpl 原生支持）成本都极低。
   - Recommendation: 单测（新文件 src/lib/__tests__/reviewBridge.test.ts，捕获 URL 断言 `/api/v1/reviews/?` + 单次调用无重定向）为主，verify-phase-61 加一条静态 grep 锁为辅。
3. **e2e 文件组织（discretion）**
   - What we know: phase55-nav 已有 new-asset-placement 用例（center 锚）；DEBT-01 是 source 锚新交互。
   - Recommendation: 新文件 `test/e2e/tests/phase61-debt.mjs`（本 phase 专属，避免动 55 的既有噪音面——60-04 决策记录提过 phase55-nav 有并行会话负载 flake 史）。
4. **verify-phase-61 是否含真机 probe（review-nginx :8090 / kap :10588 都在跑）**
   - What we know: 四笔债的回归全部可 mock/静态锁定，真机非必需；60-05 有 WARN 分级先例（exit 2 = SKIP 计 WARN）。
   - Recommendation: 默认纯 mock 收口；如想加 :8090 活体 307 消除证明，按 60-05 D 段 WARN 分级（不可达不红）。

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | 全部 | ✓ | v24.13.0 | — |
| tsc (root) | 类型门 | ✓ | 5.9.3 | — |
| Playwright + chromium | DEBT-01 e2e | ✓ | devDep in place, chromium-1208/1228 缓存在位 | — |
| mock-backend :9876 | e2e | ✗（未起,正常） | — | playwright webServer 自启（reuseExistingServer） |
| kap 后端 :10588 | 可选真机 probe | ✓ | HTTP 200 | 不用（四债全可 mock 锁定） |
| review-nginx :8090 | 可选 307 活体验证 | ✓ | 307/200 已实测 | 不用（结论已存档于本文档） |
| docker review-api 等 5 容器 | 可选 | ✓ 运行中 | — | 不用 |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** none（全部可选依赖均有 mock/静态替代路径）

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.9（infinite-canvas: `npm test` → vitest run；flowgraph-v3: `npm test` → `cd ts && vitest run`）+ Playwright（chromium, workers:1）+ verify-phase-*.ts 聚合门（tsx 脚本） |
| Config file | packages/infinite-canvas/playwright.config.mjs（e2e）；vitest 默认发现；无独立 vitest.config（各包 npm test 直跑） |
| Quick run command | `cd packages/infinite-canvas && npx vitest run <file>` / `cd packages/flowgraph-v3 && cd ts && npx vitest run tests/migrate.test.ts` |
| Full suite command | root `npx tsc --noEmit` + 两包 `npm test` + `cd packages/infinite-canvas && npm run build && npx playwright test test/e2e/tests/phase61-debt.mjs` + `npm run verify:phase-61`（新注册） |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEBT-01 | 资产中心拖入 → placeNewAsset(source) 有界落点 + canonical 落图 + 持久化 POST | e2e | `cd packages/infinite-canvas && npm run build && npx playwright test test/e2e/tests/phase61-debt.mjs` | ❌ Wave 0（含 mock 路由） |
| DEBT-01 | placeNewAsset source 分支纯函数语义 | unit（既有） | `cd packages/infinite-canvas && npx vitest run src/components/__tests__/placeNewAsset.test.ts` | ✅ 既有 8 用例 |
| DEBT-02 | 列表 URL 带尾斜杠、单跳直连 | unit | `npx vitest run src/lib/__tests__/reviewBridge.test.ts` | ❌ Wave 0 |
| DEBT-02 | 源码字面量静态锁 | verify 静态 | `npm run verify:phase-61`（含 grep 断言） | ❌ Wave 0 |
| DEBT-03 | buildMeta 读回 5 字段（分 stage） | unit (flowgraph-v3) | `cd packages/flowgraph-v3/ts && npx vitest run tests/migrate.test.ts` | 文件在，用例 ❌ Wave 0 |
| DEBT-03 | adapt∘serialize 往返 canonical meta 保真（raw=null 最严格档） | unit (infinite-canvas) | `cd packages/infinite-canvas && npx vitest run src/v3/__tests__/serialize.test.ts` | 文件在，用例 ❌ Wave 0 |
| DEBT-04 | node:created → addNodeFromSocket 链 + 无 setNodes 直写 | verify 静态 + 文档 | `npm run verify:phase-61`（S 段断言 FlowCanvas onNewAsset 含 addNodeFromSocket 调用 + 该处理器内无 setNodes + verdict 文档文件存在） | ❌ Wave 0 |
| 全部 | 类型面 | build | root `npx tsc --noEmit` + infinite-canvas `npm run build` | ✅ 基建在 |

### Sampling Rate
- **Per task commit:** 对应包的单文件 vitest + `npx tsc --noEmit`（<30s 档）
- **Per wave merge:** 两包全量 `npm test` + infinite-canvas `npm run build`（dist 纪律）+ phase61 e2e 整文件
- **Phase gate:** `npm run verify:phase-61` 聚合门全绿（S 静态锁 + B 行为门 + F forced-failure 自检至少覆盖 DEBT-02 静态锁与 DEBT-04 链锁各一变异样本）后才 `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/infinite-canvas/test/e2e/tests/phase61-debt.mjs` — DEBT-01 拖入有界落点 e2e（+ 可并 DEBT-02 若选 e2e 断言形态）
- [ ] `packages/infinite-canvas/test/e2e/mock-backend/server.mjs` 补两条路由：`POST /api/canvas/v2/nodes/`（写 state + broadcastToProject node:created）与 `POST /api/v1/assets-registry/search`（返回已知 AssetDetail envelope）— 覆盖 DEBT-01 e2e 前置
- [ ] `src/lib/__tests__/reviewBridge.test.ts` — DEBT-02 单测（deps.fetchImpl 注入捕获 URL）
- [ ] `packages/flowgraph-v3/ts/tests/migrate.test.ts` 增 5 字段读回用例 — DEBT-03
- [ ] `packages/infinite-canvas/src/v3/__tests__/serialize.test.ts` 增往返用例（rawDataByNodeId=null 档）— DEBT-03
- [ ] `scripts/verify-phase-61.ts` + package.json 注册 `"verify:phase-61"` — 收口门

## Security Domain

> security_enforcement 未显式关闭（config 无该键，按启用处理）。本 phase 攻击面变化极小。

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | 无新端点/会话改动（node:created 广播 room 隔离 project:{id} 既有） |
| V3 Session Management | no | socket room 语义不变 |
| V4 Access Control | no | POST /nodes 既有 projectId/episodesId 域门，拖入复用不新增 |
| V5 Input Validation | yes | 拖入构造节点走既有 zod nodeInputSchema（nodes.ts L28-45）+ validateNodeData（canvasAssetSchema）；客户端不得绕过（main.tsx 桥注释同纪律） |
| V6 Cryptography | no | 无密码学改动 |

### Known Threat Patterns for kap canvas + outbound bridge

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| 伪造 position/NaN 载荷注入派生缓存 | Tampering | placeNewAsset finitePoint 防御（T-55-02 既有）+ addNodeFromSocket zod 同源校验——DEBT-01 沿用不放松 |
| 出站 baseUrl SSRF | Tampering | reviewBridge baseUrl 注入/env 级配置（既有纪律，本次只改 path 字面量，不碰 baseUrl 解析） |
| XSS via 资产名/label | Tampering | React 文本插值自动转义（51-REVIEW Verified-Positive 已核全包无 dangerouslySetInnerHTML）；拖入 label 走同渲染路径 |
| 307 开放重定向滥用 | Spoofing | n/a——出站方向（kap→review-platform），非用户可控 URL；修复后反而消除中间跳 |

## Sources

### Primary (HIGH confidence)
- 仓内代码行级读取（全部 [VERIFIED: codebase]）：placeNewAsset.ts / main.tsx L29-87 / FlowCanvas.tsx L255-334 / canvasStore.ts L385-395, L600-640, L811-842 / adapter.ts L1-40, L440-560 / serialize.ts L160-260 / useCanvasSocket.ts L99-295 / reviewBridge.ts 全文 / gateStateService.ts L323-324 / nodes.ts 全文 / canvasAssetSchema.ts / migrate.ts L240-360 / types.ts L114-129 / zod.ts L143-207 / AssetLibrary.tsx L23, L423, L790-855 / assetManagerData.ts L32-60 / useRealAssets.ts / canvasApi.ts L289-306, L1202-1209 / mock-backend server.mjs / playwright.config.mjs / verify-phase-60.ts / verify-phase-54.ts L193
- 活体探针（本机, 2026-08-24）：review-nginx :8090 无斜杠 307 + Location 丢端口；带斜杠 200 envelope 与 reviewBridge 解析形状一致
- git 历史：`.planning/phases/51-canonical-write-path-coordination-guard/51-REVIEW.md`（取自 d59af2f3^，I1/I5 原文全文）
- 邻仓：/data/workspace/kais-review-platform app/api/v1/reviews.py（FastAPI, `@router.get("/")` → 注册为 `/api/v1/reviews/`；Starlette redirect_slashes 默认开）

### Secondary (MEDIUM confidence)
- 无——本 phase 全部结论有一手来源

### Tertiary (LOW confidence)
- 无

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 零新依赖，全部仓内既有
- Architecture: HIGH — 四债全部行级钉死，DEBT-04 裁定（Branch A）有完整证据链
- Pitfalls: HIGH — 每条都有仓内行号或活体验证支撑；A2/A3 两处语义解读已显式标记待确认

**Research date:** 2026-08-24
**Valid until:** 2026-09-23（仓内代码稳定；若 58-60 有 post-audit fix 落地需复核行号）
