# Phase 61 DEBT-04 Verdict — `node:created` 写路径裁定 (Branch A)

**Date:** 2026-08-24
**Author:** 61-04 executor(证据驱动裁定 plan,D-02/orchestrator 预裁定 Branch A 待证)
**Status:** FINAL(61-05 聚合门 S-DEBT4 静态锁规格的消费方,零代码 rewire)
**Evidence grade:** HIGH(行级静态实读 2026-08-24 工作区 + git 历史原文取回经 diff 逐字核对)
**Paradigm:** 60-DIAGNOSIS 证据裁定文档范式(裁定结论先行 / 证据链分段 / 裁定如实性验收)

---

## 裁定结论(先行,61-05 executor 首读)

> **Ruling: Branch A —— `node:created` 已写入 canonical graph。**
> 链路:`useCanvasSocket` 形状守卫(`{node}`)→ FlowCanvas `onNewAsset`(服务端 position 真相优先,否则 `placeNewAsset(center)`)→ `canvasStore.addNodeFromSocket` → `adapter.adaptV2Node`(`migrateV2toV3` 单节点 = V3 资产构造)→ `setGraph` canonical 全量重建 + `rawDataByNodeId` 注入。
> 51-REVIEW I5 记录的 FlowCanvas `setNodes` 派生缓存直写已在 **Phase 55-04(commit `531fc0d9`)** 重写消除。本 phase 收口动作 = **成文(本档)+ 静态锁(61-05 聚合门 S-DEBT4)**,**零代码 rewire**(D-02 证据驱动裁定;orchestrator 预裁定与工作区证据一致,无需接线分支)。

裁定依据:D-02 规定「已走 canonical 则断言+文档化收口;绕过 canonical 则接线」。四段行级证据(下节)逐段引文证实 canonical 链路完整在场;I5 原文(第 3 节)描述的 `setNodes` 直写现场在当前工作区已不存在。故取 Branch A(断言+文档化),Branch B(接线)不触发。

---

## 证据链四段(行级,2026-08-24 工作区实读;引用一律内容锚,不写死绝对行号——61-01 并行改同文件不同段,行号会漂移)

### 段 1 — `packages/infinite-canvas/src/hooks/useCanvasSocket.ts`:订阅与 `{node}` 形状守卫

**内容锚:** 块起于注释 `// 新资产生成完成` 后的 `socket.on('node:created',` 订阅,止于其闭合 `})`(位于 `node:preview` 订阅之后、`execution:progress` 之前)。逐字引文:

```typescript
socket.on('node:created', (payload: { node?: Record<string, unknown> }) => {
  // 55-04 (Q4):server broadcast 形状是 { node }(nodes.ts upsert 的 V2 节点);
  // 客户端适配,后端零改动。坏形状静默忽略(warn 归 store 层)。
  const node = payload?.node
  if (node != null && typeof node === 'object') {
    callbacksRef.current.onNewAsset?.(node)
  }
})
```

**一句话语义:** server broadcast 形状是 `{ node }`;仅当 `payload?.node` 为 object 才转发 `onNewAsset`,坏形状静默忽略——链路入口只放行结构合法的单节点载荷。

### 段 2 — `packages/infinite-canvas/src/components/FlowCanvas.tsx`:`onNewAsset` 位置决策 + canonical 写回调用

**内容锚:** 块起于 `onNewAsset: (node` 回调属性、止于 `onOrchestrateStart:` 回调属性(同一 `useCanvasSocket({...})` 实参对象内相邻回调)。逐字引文(块首注释与位置决策):

```tsx
onNewAsset: (node: Record<string, unknown>) => {
  // 55-04 (NAV-04):随机散布反模式已删——位置决策:服务端 position 有限
  // 即用(真相优先);否则视口中心(placeNewAsset 8px 网格,UI-SPEC §6)。
  // 写回走 canonical addNodeFromSocket(WRITE-03),不再 setNodes 直写。
```

逐字引文(块尾写回三行,即 I5 记录的 `setNodes` 直写被替换后的现场):

```tsx
  const nodeId = typeof node.id === 'string' ? node.id : '(unknown)'
  const added = useCanvasStore.getState().addNodeFromSocket(node, position)
  if (added) setFocusAssetNodeId(nodeId)
},
```

**一句话语义:** position 决策 = 服务端 position 有限即用(真相优先),否则 `placeNewAsset(center)`;节点落图唯一出口是 `addNodeFromSocket`,块内零 `setNodes`。

**佐证注记(同文件,61-01 落地后在场):** `handleAssetDrop` 上方注释逐字声明 `写回走服务端广播 node:created → onNewAsset → addNodeFromSocket(WRITE-03 canonical),本 handler 零 setNodes`——DEBT-01 拖入接线(61-01,commit `8204d7a3`)正是**因 Branch A 成立**才把拖入持久化路由到 `node:created` 广播回环,而非客户端直写;两条放置路径(center 兜底/source 拖入)在 canonical 写回上汇于同一动作。

### 段 3 — `packages/infinite-canvas/src/store/canvasStore.ts`:`addNodeFromSocket` canonical 动作

**内容锚:** 块起于 `addNodeFromSocket: (node, position) => {`,止于其闭合 `},`(位于 `applySocketScored` 之后、审核 `approveNode` 段注释之前)。逐字引文(入口与适配):

```typescript
addNodeFromSocket: (node, position) => {
  // 55-04 (NAV-04/WRITE-03):单节点增量 canonical 写回。
  // 绝不动 setNodes/派生缓存;zod 同源宽松校验经 adaptV2Node;
  // 幂等:同 id 重播只更新 rawData,不重复 append。
  const adapted = adaptV2Node(node)
```

逐字引文(canonical 全量重建出口):

```typescript
  // 经 setGraph 全量重建派生缓存(rfNodes/edges/phaseCatalog)——直接 set
  // graph 会让 store.nodes/useLayout 渲染链看不到新节点;setGraph 的
  // rawDataByNodeId 从 V3 重建(shot_id 等原始字段会丢),注入 raw 补回。
  get().setGraph(
    { ...graph, nodes: [...graph.nodes, { ...v3Node, position }] },
    get().warnings,
  )
```

**一句话语义:** store 层 canonical 写入动作——`adaptV2Node` 适配 → id 查重(重播 warn+ignore)→ `setGraph` 全量重建派生缓存 + `rawDataByNodeId` 注入;注释自证「绝不动 setNodes/派生缓存」。

### 段 4 — `packages/infinite-canvas/src/v3/adapter.ts`:`adaptV2Node` = V3 资产构造

**内容锚:** 块起于 `adaptV2Node` 的头 doc-comment(`单节点级 V2 → V3 适配`),止于函数闭合 `}`(位于 `AdaptedGraph` 接口之后、`adaptV2Graph` 之前)。逐字引文(头注释与签名):

```typescript
/**
 * 单节点级 V2 → V3 适配(55-04 / NAV-04:socket node:created 增量写回用;
 * 整图路径 adaptV2Graph 不可用于单节点)。normalizeNode 宽松归一 +
 * rawData 袋捕获 + migrateV2toV3 单节点图转换;坏节点返回 null 不 throw
 * (fail-loud 不崩同源哲学,warn 归调用方)。
 */
export function adaptV2Node(rn: unknown): {
```

逐字引文(V3 构造核心——单节点图喂 `migrateV2toV3`):

```typescript
  const migrated = migrateV2toV3({
    meta: { projectId: 0, episodesId: 0, createdAt: 0, updatedAt: 0 },
    nodes: [n],
    links: [],
    branches: [],
  })
```

**一句话语义:** I5 suggested fix 所要求的「V3 asset constructor」即此——`normalizeNode` 宽松归一 + `migrateV2toV3` 单节点图转换产出真 V3 节点,socket 增量写回与整图读回同源同构。

---

## I5 原文摘录(git 历史取回,出处 `d59af2f3^`)

**出处与事实:** `51-REVIEW.md` 已随 v3.0 里程碑归档移出工作区(仅存 git 历史);本文档成文时执行 `git show "d59af2f3^:.planning/phases/51-canonical-write-path-coordination-guard/51-REVIEW.md"`,取回文件与 `/tmp/51-REVIEW.md` 缓存 `diff` **逐字节一致**(IDENTICAL_TO_GIT_HISTORY)。以下 I5 全文原样引用:

> ### I5 — Info: socket `node:created` still writes the derived cache directly
>
> **File:** `packages/infinite-canvas/src/components/FlowCanvas.tsx:217-224`
>
> **Issue:** `onNewAsset` appends the new node via `setNodes` — a derived-cache-only write. The node never enters `store.graph`, so it is wiped by the next `applyGraphTransform` and is absent from any `handleSave` serialization. CONTEXT ruled only `node:state`/`node:preview` in scope for this phase, so this is a known surviving instance of the bug class the phase eliminates, not a regression. In practice the `graph:saved` full reload converges the view.
>
> **Suggested fix:** Track as follow-up: either route node creation through the canonical graph (requires a V3 asset constructor) or document that `node:created` is display-only-ephemeral until the next `graph:saved`.

**对照裁定:** I5 记录的现场 `FlowCanvas.tsx:217-224 setNodes 直写` 在 55-04 重写后不存在(段 2 引文即替换后现场);I5 suggested fix 的前者(canonical graph + V3 asset constructor)已由 `addNodeFromSocket` + `adaptV2Node` 完整落地——不是后者(ephemeral 文档化)分支。

### 顺手摘录 I1 一段(交叉供 61-03 引用;清偿证据见 61-03-SUMMARY.md)

> **Issue:** `flattenMeta` spreads all meta fields into the data bag, but reload-side `buildMeta` only lifts a subset: `script.emotion`, `storyboard.promptMeta`, `video.murchGrade`, and `global.archetype`/`viewAngle` are persisted into `data.*` yet never read back into canonical meta. After save → reload these fields vanish from `asset.meta` (they survive only in the `rawDataByNodeId` passthrough view).

(I1 的 5 字段读回缺口已由 61-03 在 `packages/flowgraph-v3/ts/src/migrate.ts` buildMeta 四分支补齐并双侧往返测试锁定,commit `fd280475`。)

---

## 历史时间线

| 时点 | 事件 | 证据 |
|------|------|------|
| 2026-08-21(v3.0 收尾) | 51-REVIEW 记录 I5:`onNewAsset` 经 `setNodes` 派生缓存直写,节点不进 `store.graph`,被下次 `applyGraphTransform` 抹掉且不进 `handleSave` 序列化 | I5 原文(上节,git `d59af2f3^` 取回) |
| Phase 55-04(commit `531fc0d9`) | WRITE-03/NAV-04 重写:`onNewAsset` 的 `setNodes` 直写 → `addNodeFromSocket`(adaptV2Node 单节点 V3 构造 + setGraph canonical 重建);`useCanvasSocket` 补 `{node}` 形状守卫 | `git log -S "addNodeFromSocket"` 首个引入 commit = `531fc0d9`(FlowCanvas/canvasStore/adapter 三文件同批);段 1-4 当前工作区引文 |
| Phase 61-01(commit `8204d7a3`) | 拖入接线显式依赖本裁定:持久化走服务端 `node:created` 广播回环,handler 零 `setNodes`(佐证注记) | FlowCanvas `handleAssetDrop` 上方注释(段 2) |
| 2026-08-24(本档) | 61-04 成文收口:Branch A 裁定 + 静态锁规格交付 61-05 | 本文档 |

---

## 静态锁规格(交 61-05 聚合门 `verify-phase-61.ts` S 段实现,锁名 S-DEBT4)

三条锁断言 + 一存在性检查,全过才绿:

1. **`addNodeFromSocket` 在块内 ≥1:** `FlowCanvas.tsx` 的 `onNewAsset` 块切片(内容锚:块起 `onNewAsset:` 止 `onOrchestrateStart`,**切片按内容锚提取,禁绝对行号**——61-01/后续 plan 并行增删行会让行号锁脆断)内出现 `addNodeFromSocket` ≥1 次。
2. **块内 `setNodes` 直写 = 0:** 同一切片内出现 `setNodes` 0 次。注:`setNodes` 在该文件其他段合法在场(store selector 绑定/视图清空/布局应用),锁只约束切片内——这正是切片锁而非全文锁的原因。
3. **形状守卫在场:** `useCanvasSocket.ts` 含 `node:created` 订阅且含 `payload?.node` 形状守卫(两者 grep 均命中)。
4. **裁定文档存在:** `.planning/phases/61-audit-debt-clearance/61-DEBT-04-VERDICT.md` 存在(本档;文档陈述与代码事实由门强制一致,T-61-10 缓解)。

**forced-failure 变异样本规格(F 段自检):** 构造内存样本,把 `onNewAsset` 块内的 `addNodeFromSocket` 字符串替换为 `setNodes` 后喂给锁逻辑,断言 1 必须判 false(且断言 2 同时判 false)——证明锁能红,防恒绿假锁(59/60 F 段范式)。

---

## D-04 清偿标注

- **I5 → 已清偿(Branch A)。** 清偿主体 = Phase 55-04 接线(`531fc0d9`:setNodes 直写 → addNodeFromSocket canonical);本档 = 成文收口(裁定 + 证据链 + 锁规格),零代码改动。
- **51-REVIEW.md 本体不在工作区(A6 降级条款):** D-04「51-REVIEW 对应 finding 标注已清偿(若该文件存在追踪节)」——文件不存在,原地标注不可能;本档第 3 节的 finding 级全文引用 + 本清偿标注即降级后的追踪记录。
- **I1 → 已清偿(61-03,`fd280475`),** 非本 plan 义务,仅交叉记录。
- **REQUIREMENTS.md 勾选动作归 61-05 统一执行**(本 plan 不动 REQUIREMENTS.md)。

---

## 裁定如实性验收(成文时自检,60-03 Branch A 逐字执行同款纪律)

- [x] 四段引文逐字复制自 2026-08-24 当前工作区(非转述、非记忆重构);成文后以源文件对应行 diff 复核一致。
- [x] 全部引用采用内容锚(块起止标识),文档内零绝对行号依赖。
- [x] I5/I1 原文取自 `git show d59af2f3^:...` 且与 `/tmp/51-REVIEW.md` diff 为空(逐字节一致)。
- [x] 本 plan 唯一产物为本档(零代码 diff;`git status` 除既有 pre-existing 脏文件外无代码改动)。
