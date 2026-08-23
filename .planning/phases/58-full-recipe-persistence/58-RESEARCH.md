# Phase 58: 全配方持久化 (Full Recipe Persistence) - Research

**Researched:** 2026-08-23
**Domain:** kap 画布侧 V2↔V3 配方 round-trip 通道（packages/flowgraph-v3 + packages/infinite-canvas + src/lib/canvasAssetSchema + src/routes/canvas/execute.ts）
**Confidence:** HIGH（全部核心断言经本会话代码直读 + 生产 DB 探测 + 双包 vitest 实跑验证；零外部新依赖）

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**编辑入口与形态**
- 编辑落在**详情面板** PromptSection(52-03 三态范式扩展为配方编辑器);芯片 popover(EventParamsPopover)保持只读+换 seed——面板是 REGEN-01 主编辑面,popover 定位是快速查看
- 高级字段以折叠区「高级参数」呈现,默认**收起**(480px 审片面板 prompt 优先,高级字段低频)
- 控件按字段类型推导:steps/cfg → number input;quant/sageAttention → select;lora → 行级编辑(name + strength)
- 未知 catchall 字段(KNOWN_KEYS 之外的管线私有字段)**只读展示**,不提供编辑——防误伤

**通道与真值**
- 可编辑字段集白名单 = 导出 `RECIPE_EDITABLE_FIELDS` 单点常量;popover KNOWN_KEYS 与面板同源引用(一处定义两处消费)
- execute 请求体整袋 merge:`params: { ...源params, ...编辑patch }`——未编辑字段原值透传,天然满足 RECIPE-03 不被 nullish 清洗
- serialize 往返:migrate `recipeParams` 提取(v2 data → V3 params)扩到 GenerationParams 全集,lora 数组整袋深度透传,reload 读回完整配方
- 保存时机沿用 52-03 范式:本地编辑态,点「保存」一次 persistEventParams + saveCanvasGraph;不做字段级失焦自动保存

**守护与验证**
- RECIPE-04 防漂移 = verify-phase-58 聚合门:断言 canvasAssetSchema 字段集 ↔ `RECIPE_EDITABLE_FIELDS` ↔ migrate 提取集**三方一致** + nullish 计数锁 + forced-failure 自检
- e2e 新增 `phase58-recipe.mjs`:编辑 steps/cfg/lora → 保存 → reload 往返断言 → 重生成请求体断言(mock)
- 真机验证 `probe-58-real.mjs` 复用 probe-52-real Part B 零足迹模式(改 steps+cfg → 保存 → 重载往返 → 恢复)
- 回归基线:62 e2e 全量 + vitest 404/130 不降;流程末 build → deploy → 真机探针

### Claude's Discretion
- 折叠区组件实现细节、number input 步进/边界、select 选项来源、lora 行级编辑器具体交互
- RECIPE_EDITABLE_FIELDS 放哪个模块(倾向 flowgraph-v3 导出,schema/popover/panel 三处引用)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RECIPE-01 | 详情面板编辑高级配方字段并保存,reload 往返保真 | 双丢弃点已定位(serialize L245-251 / migrate recipeParams L155-162),对称拓宽 + graph:saved 即时回读链已验证;编辑 UI 挂 PromptSection 三态范式 |
| RECIPE-02 | 编辑后的高级字段直接进入重生成引擎请求 | execute.ts L28 params 槽位已存在(52-02 契约,接受并忽略);PromptSection handleRegenerate L696 已整袋 spread `{...evt.params}`——保存后 canonical 即携带新值,**零服务端改动**,mock logCall body 断言即可 |
| RECIPE-03 | 复杂结构字段可编辑;未编辑字段原样保留 | serialize 反向覆盖在 `{...raw, ...flattenMeta}` 之后(canonical 最后写,RECIPE-03 保真范式已存在);**关键新发现:清空字段需要 delete 传播语义**(见 Pitfall 1) |
| RECIPE-04 | canvasAssetSchema ↔ 面板可编辑字段集防漂移守护 | 三方集合来源已确认:flowgraph-v3 导出常量 / canvasAssetSchema 声明字面量(根仓 zod v4 不宜跨包 import) / migrate 提取集(同包可同源);verify-phase-52 源码形状断言 + 命令门 + forced-failure 范式照抄 |
</phase_requirements>

## Summary

§14 窄通道的本质是**两个对称丢弃点**,全部已精确定位:

1. **保存向丢弃**:`serialize.ts` L245-251 事件配方反向覆盖只 round-trip `prompt`/`seed`/`modelVersion→engine` 三键——`EventNodeV3.params` 里的 steps/cfg/lora/quant/sageAttention 在写盘时被丢弃(注释自认「窄通道(地雷 #3)」)。
2. **加载向丢弃**:`migrate.ts` `recipeParams()` L155-162 只提取 `d.prompt`/`d.seed`/`d.engine` 三键——即使 data 袋里有高级字段也不进 V3 params。

两端之间的一切环节都是**通透的**(逐点验证):服务端 save-v2 的 `FlowNodeV2Schema.data = z.record(z.string(), z.any())` 全透传;`saveFullGraph` 以 `JSON.stringify(node.data)` 整袋落 `canvas_nodes.data` 列;load-v2 原样 `JSON.parse` 回;`adapter.adaptV2Graph` 的 `rawDataByNodeId` 原袋捕获。**即:拓宽这两处 = 全链路通,零服务端/DB 改动**。生产 DB 实测 9217 行 canvas_nodes 中 0 行含 steps/cfg/lora/quant——纯绿地数据,零回填、零存量形状风险。

另一个关键发现:**`graph:saved` socket 广播让每次保存即时触发前端全图 reload**(FlowCanvas.tsx L326-340 → loadCanvas → load-v2 → migrate)。所以 migrate 窄通道在**保存后同屏即咬**(面板保存 → 服务端广播 → 前端重载 → 高级字段立即回退),不是「刷新页面才丢」。这决定了 serialize 与 migrate **必须同一计划内对称落地**,单边拓宽测不出往返。

execute.ts 侧结论:请求体 `params` 槽位 52-02 已开(`z.record(z.string(), z.unknown()).optional()`),面板 regen 已整袋 spread——**本 phase 对 execute.ts 是零改动**(「直接消费」指请求体可见性,mock `getCalls` 断言;真引擎派发不在范围)。

**Primary recommendation:** 单计划三段式——①flowgraph-v3 导出 `RECIPE_ROUNDTRIP_KEYS`/`RECIPE_EDITABLE_FIELDS`(可从 `generationParamsSchema.shape` 程序化派生,zod 侧零改动)+ `recipeParams` 拓宽(含 modelVersion↔engine 键名映射);②serialize 反向覆盖拓宽 + **delete 传播语义**(params 缺键时同步删 data 袋同键,防 rawData 陈旧值复活)+ 面板高级参数编辑器 + popover KNOWN_KEYS 换源;③verify-phase-58 三方集合相等门 + e2e `phase58-recipe.mjs` + probe-58-real。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 配方编辑 UI(高级参数折叠区) | infinite-canvas NodeDetailPanel PromptSection | — | 52-03 三态范式所在;REGEN-01 主编辑面(CONTEXT 锁定) |
| 可编辑字段集单点常量 | packages/flowgraph-v3 导出 | popover/panel 消费 | GenerationParams 真值源同包;CONTEXT 裁定倾向 |
| V3→V2 落盘配方反向覆盖 | infinite-canvas serialize.ts | — | 画布保存唯一入口(51 WRITE-01);窄通道所在 |
| V2→V3 配方提取 | flowgraph-v3 migrate.ts recipeParams | — | §14 迁移纯函数;窄通道所在 |
| 服务端 data 袋校验/存储 | src/routes/canvas/v2/save-v2 + canvasRelationalStore | canvasAssetSchema | 已通透(zod record + JSON blob);仅需 canvasAssetSchema 声明配方字段(RECIPE-04 断言侧) |
| 重生成请求体携带 | infinite-canvas PromptSection handleRegenerate | execute.ts(接受并忽略) | params 槽位已存在;regen spread 已整袋 |
| 防漂移守护 | scripts/verify-phase-58.ts | package.json 注册 | verify-phase-52 聚合门范式 |

## Standard Stack

**零外部新依赖**——本 phase 全部为仓内改造。核心既有模块(全部本会话验证):

### Core (in-repo)
| Module | 版本/位置 | 角色 | 本 phase 动作 |
|---------|-----------|------|---------------|
| `GenerationParams` 类型 | flowgraph-v3/ts/src/types.ts L181-192 | 配方形状真值源:prompt/negative/seed/modelVersion/lora/steps/cfg/quant/sageAttention + catchall | 零改动(字段已全) |
| `generationParamsSchema` | flowgraph-v3/ts/src/zod.ts L103-115 | zod 校验,九键全列 + `.catchall(z.unknown())` | 零改动;**可从 `.shape` 派生键集** |
| `recipeParams()` | flowgraph-v3/ts/src/migrate.ts L155-162 | V2→V3 提取窄通道 | 拓宽到全集(含 engine→modelVersion 键名映射) |
| `serializeGraphToV2` | infinite-canvas/src/v3/serialize.ts L209-371 | V3→V2 唯一保存序列化器;反向覆盖 L245-251 | 拓宽 + delete 传播 |
| `persistEventParams`/`updateEventParams` | infinite-canvas/src/store/canvasStore.ts L623-689 | canonical 写入 + 乐观保存 + 外科回滚 | 零改动(已泛型 patch) |
| `PromptSection` | infinite-canvas/src/components/panel/NodeDetailPanel.tsx L617-739 | 编辑面板三态范式 + 保存/重生成 | 扩展高级参数折叠区 |
| `EventParamsPopover` | infinite-canvas/src/components/eventParams/EventParamsPopover.tsx | 只读分组展示 + 换 seed 重跑;KNOWN_KEYS L27 | KNOWN_KEYS 换共享常量导入,视觉零改 |
| `canvasAssetSchema` | src/lib/canvasAssetSchema.ts | save-v2 结构化参数校验(zod v4) | 增配方字段可选声明(RECIPE-04 断言侧) |
| execute.ts `params` 槽 | src/routes/canvas/execute.ts L28 | 重生成请求契约(接受并忽略) | **零改动** |

### Supporting
| Tool | 版本 | 用途 |
|------|------|------|
| vitest | infinite-canvas(内嵌)/ flowgraph-v3 ^2.1.9 | 单测;基线 406/37 文件 + 130/7 文件(2026-08-23 实跑) |
| Playwright | @playwright/test(infinite-canvas 内嵌) | e2e;62 用例/13 文件,mock-backend :9876,workers:1 |
| tsx | ^4.19.2(devDep) | verify-phase-58.ts 独立脚本(51/52 传统,`npx tsx scripts/verify-phase-58.ts`) |
| zod | 三处分裂:根仓 ^4.3.5 / infinite-canvas ^3.25.76 / flowgraph-v3 ^3.23.8 | **见 Pitfall 4:勿跨包共享 zod 对象,只共享字符串键集** |

**Installation:** 无(`npm install` 不需要任何新包)

## Package Legitimacy Audit

本 phase **不安装任何外部包**——全部改动为仓内既有模块扩展。slopcheck/registry 校验不适用,无 [ASSUMED] 包名。

## Architecture Patterns

### System Architecture Diagram(配方 round-trip 数据流 + 丢弃点)

```
[详情面板 PromptSection]                [芯片 popover]
  编辑 steps/cfg/lora/quant/sage          只读展示 + 换 seed 重跑
        │ 点保存                           │ (params 整袋 spread L81)
        ▼                                  ▼
  persistEventParams(eventId, patch)    executeNode(..., {params:{...evt.params, seed:新}})
        │ 乐观写 canonical                │
        ▼                                 ▼
  updateEventParams ←← nullish 键删除语义   POST /canvas/execute
        │                                 (params 槽已存在,服务端接受并忽略)
        ▼
  serializeGraphToV2(cur, rawDataByNodeId)
        │
        ├─ data = {...rawData, ...flattenMeta}   ← rawData 陈旧值复活源(Pitfall 1)
        │
        ├─ ★丢弃点① 事件配方反向覆盖(L245-251)
        │    现状:仅 prompt/seed/modelVersion→engine 写回 data 袋
        │    拓宽:RECIPE_ROUNDTRIP_KEYS 全写 + 缺键 delete 传播
        ▼
  POST /canvas/v2/save-v2  ── 通透带(验证无损)──▶ canvas_nodes.data = JSON.stringify(整袋)
        │                                          (生产 DB 9217 行,0 行含高级字段=绿地)
        │ broadcastToProject('graph:saved')
        ▼
  FlowCanvas onGraphSaved → loadCanvas(同屏即时回读,非刷新才触发)
        │
        ▼
  load-v2 → JSON.parse(data) → adaptV2Graph
        ├─ rawDataByNodeId 原袋捕获(通透)
        └─ ★丢弃点② migrateV2toV3 → recipeParams(v2)
             现状:仅提取 d.prompt/d.seed/d.engine
             拓展:RECIPE_ROUNDTRIP_KEYS 全提取(engine→modelVersion 映射)
        │
        ▼
  EventNodeV3.params(canonical 真值) ──▶ 面板重渲染显示保存后的值(RECIPE-01 闭环)
```

### Recommended Project Structure(改动面)

```
packages/flowgraph-v3/ts/src/
├── recipe.ts          # [新增·建议] RECIPE_ROUNDTRIP_KEYS(可派生自 generationParamsSchema.shape)
│                      #   + RECIPE_EDITABLE_FIELDS + modelVersion↔engine 键名映射表
├── migrate.ts         # recipeParams/hasRecipe 消费映射表(L155-167)
└── zod.ts             # 零改动(.shape 键集即派生源)
packages/infinite-canvas/src/
├── v3/serialize.ts            # 反向覆盖拓宽 + delete 传播(L245-251)
├── components/panel/NodeDetailPanel.tsx  # PromptSection 内加「高级参数」折叠区
├── components/eventParams/EventParamsPopover.tsx  # KNOWN_KEYS → import 共享常量
└── test/e2e/tests/phase58-recipe.mjs      # [新增] e2e
src/lib/canvasAssetSchema.ts    # 配方字段可选声明(字面量,不跨包 import)
scripts/verify-phase-58.ts      # [新增] 聚合门
packages/infinite-canvas/test/e2e/probe-58-real.mjs  # [新增] 真机探针
```

### Pattern 1: 键名映射 round-trip(非恒等映射)
**What:** `params.modelVersion ↔ data.engine` 是键名改写,其余 8 键恒等。round-trip 键集必须是 `{paramKey, dataKey}` 对,不是裸字符串数组。
**When to use:** recipeParams 提取 / serialize 反向覆盖 / verify 集合断言三处统一消费同一映射表。
**Example:**
```typescript
// Source: 本会话代码直读 migrate.ts L160 + serialize.ts L250(engine ↔ modelVersion 改写已存在)
export const RECIPE_ROUNDTRIP_KEYS: ReadonlyArray<{ p: keyof GenerationParams; d: string }> = [
  { p: 'prompt', d: 'prompt' }, { p: 'negative', d: 'negative' },
  { p: 'seed', d: 'seed' }, { p: 'modelVersion', d: 'engine' },  // ← 键名映射
  { p: 'lora', d: 'lora' }, { p: 'steps', d: 'steps' },
  { p: 'cfg', d: 'cfg' }, { p: 'quant', d: 'quant' }, { p: 'sageAttention', d: 'sageAttention' },
]
// 键集可交叉验证:Object.keys(generationParamsSchema.shape) 与上表 p 侧严格相等(zod.ts L104-114 九键)
```

### Pattern 2: delete 传播(「未设置」清空语义,本 phase 新增的承重语义)
**What:** serialize 反向覆盖拓宽后,`if (p.steps != null) data.steps = p.steps` 不够——`data` 由 `{...raw}` 起底,raw 里有上次保存的陈旧 `steps` 时,canonical 清空(steps 键被 updateEventParams 删除)后落盘仍带旧值,reload 复活。
**When to use:** 反向覆盖循环内,对 RECIPE_ROUNDTRIP_KEYS:`params 有值→写;params 无键→delete data[dataKey]`(script stage 的 prompt 例外照旧)。
**Example:**
```typescript
// Source: serialize.ts L245-251 现状 + canvasStore.ts L646 删除语义(本会话直读)
const producingEvt = producingEventByAssetId.get(n.id)
if (producingEvt != null) {
  const p = producingEvt.params
  for (const { p: pk, d: dk } of RECIPE_ROUNDTRIP_KEYS) {
    if (n.stage === 'script' && pk === 'prompt') continue // 52-02 例外,content 为真值
    const v = (p as Record<string, unknown>)[pk]
    if (v != null) data[dk] = v
    else delete data[dk]  // ← 新增:canonical 缺键 = 用户清空 → wire 同步删,防 rawData 复活
  }
}
```

### Pattern 3: 52-03 三态扩展(零新状态)
PromptSection 现有 readonly 分支(L647-672)整块覆盖高级区——落选变体(`curation==='deprecated'`)/无事件 → 整个 PromptSection(含高级控件)只读,`prompt-readonly-hint` 文案 e2e 锁死不可改(UI-SPEC 明示)。编辑态 dirty = promptDirty || 各高级字段 dirty(lora 深比较);保存 patch 只含 dirty 字段;regen 在 dirty 时 disabled(防半编辑)。

### Pattern 4: verify 聚合门(verify-phase-52 范式)
`scripts/verify-phase-58.ts`:源码形状断言(regex 文本)+ 三方集合相等(import 双侧常量直接比)+ S5 命令门(三根 tsc + 双包 vitest tail)+ forced-failure 自检(shadow assert 全必须 FAIL)。package.json 注册 `verify:phase-58`。

### Anti-Patterns to Avoid
- **裸字符串数组当键集**(忘掉 modelVersion↔engine 映射)→ reload 后 modelVersion 丢/双写。
- **只拓 serialize 不拓 migrate**(或反之)——graph:saved 同屏回读让单边拓宽立即自噬,但 mock e2e 若不点保存后断言面板值就测不出。
- **面板编辑直接改 popover**(CONTEXT 锁死 popover 只读;只换 KNOWN_KEYS 来源)。
- **把 catchall 字段(variantRecipes/sourcePath 等)做成可编辑**——只读 JSON.stringify 展示(52 防误伤裁定)。
- **跨包 import zod 对象**(根仓 zod v4 ≠ 包 zod v3,见 Pitfall 4)。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 保存链(乐观写+回滚+toast) | 新保存 action | `persistEventParams`(L653) | 已泛型 patch,外科回滚范式成熟 |
| 事件→资产反查 | 新查找逻辑 | `graph.links role:'output' && target===asset.id` 反查(PromptSection L627 / serialize L224-229 同款) | 唯一正道,两处既有先例 |
| 重生成请求体 | 新 execute 入口 | `executeNode(..., { params })`(52-02 extra 契约) | 服务端槽位已在,mock logCall 断言链成熟 |
| e2e 观测面 | 新 testMode hook | `window.__kaisCanvas.getGraph()`(main.tsx L43)+ `/__mock/state` + `getCalls` | UI-SPEC 明示不加新 hook |
| 真机探针 | 新探针框架 | probe-52-real.mjs Part B 零足迹模式(stripUpdatedAt 深比对 + 恢复) | 9999/1 实证可用 |

**Key insight:** 本 phase 的全部「难」在两个丢弃点的对称拓宽与 delete 传播语义,不在任何新基建——保存链/执行链/校验链/测试装置 51-52 已全部铺好。

## Common Pitfalls

### Pitfall 1: 清空字段复活(delete 传播缺失)——本 phase 最重要发现
**What goes wrong:** 用户把 steps 从 50 清空(未设置)→ updateEventParams 删除 params.steps(`undefined/null/''` → delete,L646)→ 保存 → serialize 里 `{...raw}` 仍带 raw.steps=50,反向覆盖 `if (p.steps != null)` 不写 → wire 落盘 data.steps=50 → reload 复活 50。
**Why it happens:** 52-02 反向覆盖只有「有值才写」,没有「缺键则删」;prompt/seed/engine 从未有 UI 清空流程所以未暴露,本 phase 「空 = 未设置」是主交互。
**How to avoid:** Pattern 2 的 delete 传播。**注:** 今天 prompt 清空为 '' 也有同款复活(潜在 bug,本 phase 顺手被 delete 传播覆盖,52-02 测试 a/b/c 不受影响——它们断言的是「有值覆盖/不伪造」,删 != 伪造)。
**Warning signs:** e2e「清空 steps → 保存 → reload」用例红;`/__mock/state` 里 data.steps 在清空保存后仍在。

### Pitfall 2: 空数组 ≠ 删除(updateEventParams 语义边界)
**What goes wrong:** lora 全删后 patch 传 `lora: []` —— L646 只删 `undefined/null/''`,`[]` 是合法值会被**写入** params.lora=[](而非删除键)。UI-SPEC 锁定「空 lora 数组 → 字段删除」。
**How to avoid:** 面板归一化:trim 后空行丢弃,结果数组为空 → patch 传 `undefined`(触发删除),非 `[]`。serialize 侧同理:`[]` 会写 data.lora=[](不是 nullish,不触发删除分支)——语义自洽(显式空数组保留,清空走 undefined)。
**Warning signs:** e2e「删光 lora 行 → 保存 → reload」后 getGraph() 里 params.lora === [] 而非 undefined。

### Pitfall 3: graph:saved 同屏回读让单边拓宽自噬
**What goes wrong:** 只拓 serialize → 保存后面板看似成功,但 socket graph:saved → loadCanvas → migrate 窄通道重建 params → 高级字段立即回退旧值(e2e 若在保存后直接断言输入框值会闪红/间歇红)。
**How to avoid:** serialize+migrate 同一计划落地;e2e 保存后先等 `/__mock/state` wire 值、再断言面板/canonical 值(REGEN-01-a 的 expect.poll 两段式范式)。

### Pitfall 4: zod 版本三分裂
根仓 src(zod ^4.3.5)≠ infinite-canvas(^3.25.76)≠ flowgraph-v3(^3.23.8)。canvasAssetSchema(根仓)若 import flowgraph-v3 的 zod 对象会双实例+版本冲突;root tsconfig 也无 flowgraph-v3 path alias(src/ 现零引用,已验证)。**共享的只能是纯字符串键集/常量**(JSON-serializable),verify 脚本里才做双侧 import 比较(verify 脚本 import 双侧源码是 51 先例)。

### Pitfall 5: e2e 测的是 dist 不是源码(地雷 #10 传统)
Playwright webServer 服务 `dist/`(playwright.config.mjs L31-33);改完源码必须先 `npm run build`(packages/infinite-canvas)再跑 e2e,否则全绿假象。deploy 同理:`bash scripts/deploy-canvas.sh` + `npm run build:server` + 重启后真机才生效。

### Pitfall 6: mock fixture 无高级字段
mock DEFAULT_NODES(server.mjs L51-110)的节点 data 只有 prompt,**没有 steps/cfg/lora/quant/sageAttention**。phase58-recipe.mjs 必须先注入(经 save-v2 POST 写带高级字段的 data,REGEN-01-c 注入范式)或选其他断言策略;直接对 storyboard-1 断言高级字段 = undefined 假红/假绿。

### Pitfall 7: 落选变体 data 袋被主事件配方覆盖(预存语义,勿在本 phase 治)
Pass 3 把候选 output 边重指主事件后,serialize 反向覆盖把**主事件** params 写进**每个成员**的 data 袋(52-02 起即如此)。拓宽后 steps/cfg 同样整组同值。这是预存折叠语义,RECIPE 面板对落选只读(UI-SPEC 状态机)已防用户编辑路径;不要试图在本 phase「修复」。
**Warning signs:** 若新用例断言「落选候选 data 保留自己原配方」→ 会红,且不该修。

### Pitfall 8: orphan/hasRecipe 边缘(LOW)
migrate `hasRecipe`(L164-167)只查 prompt/seed/engine;孤儿判定(orphan→import 种子,params 只剩 sourcePath)会丢「仅 steps 无 prompt/seed/engine」的节点配方。真图概率极低(实测生产 0 行含 steps),建议顺手让 hasRecipe 检查映射表任意键在场——一行改动,防未来管线写入踩坑。

### Pitfall 9: REGEN 后 regen-disabled 的时序
保存成功 → graph:saved 回读 → setGraph → PromptSection useEffect 以 canonical 重置 draft(52-08 gap#7a 实证:mock 下面板保持打开)。dirty 计算依赖 canonical 引用变化;若高级字段 draft 状态在 setGraph 后不重置,会出现「保存后仍 dirty → regen 永久禁用」。复用 52-03 的 useEffect 重置模式(依赖 evt?.id + 各 canonical 值)。

## Code Examples

### 现状锚点 1: serialize 窄通道(丢弃点①原文)
```typescript
// Source: packages/infinite-canvas/src/v3/serialize.ts L245-251(本会话直读)
const producingEvt = producingEventByAssetId.get(n.id)
if (producingEvt != null) {
  const p = producingEvt.params
  if (n.stage !== 'script' && p.prompt != null) data.prompt = p.prompt
  if (p.seed != null) data.seed = p.seed
  if (p.modelVersion != null) data.engine = p.modelVersion   // ← 窄通道终点:三键之外全弃
}
```

### 现状锚点 2: migrate 窄通道(丢弃点②原文)
```typescript
// Source: packages/flowgraph-v3/ts/src/migrate.ts L155-162(本会话直读)
function recipeParams(v2: FlowNodeV2): GenerationParams {
  const d = v2.data ?? {};
  const params: GenerationParams = {};
  if (d.prompt != null) params.prompt = d.prompt;
  if (d.seed != null) params.seed = d.seed;
  if (d.engine != null) params.modelVersion = d.engine; // engine → modelVersion
  return params;   // ← steps/cfg/lora/quant/sageAttention/negative 全部不提取
}
```

### 现状锚点 3: canonical 删除语义 + 整袋 regen(已正确,零改动)
```typescript
// Source: canvasStore.ts L644-648(删除语义) + NodeDetailPanel.tsx L694-697(整袋 regen)
for (const [key, value] of Object.entries(patch)) {
  if (value === undefined || value === null || value === '') delete params[key]  // 空值=删除
  else params[key] = value
}
// ...
await executeNode(projectId, episodesId, asset.id, asset.stage, {
  prompt: canonicalPrompt,
  params: { ...evt.params, prompt: canonicalPrompt },  // 整袋 spread:保存后即携带高级字段
})
```

### e2e 断言范式(phase52-regen.mjs 实证,phase58 照抄)
```javascript
// Source: packages/infinite-canvas/test/e2e/tests/phase52-regen.mjs(本会话直读)
// ① wire 层:等 save-v2 把编辑值反写到 mock 节点 data
await expect.poll(async () => {
  const res = await page.request.get('/__mock/state')
  const s = await res.json()
  return s.canvas.nodes.find((n) => n.id === 'storyboard-1')?.data?.steps   // phase58 换键
}, { timeout: 5_000 }).toBe(50)
// ② 请求体层:execute 完整 body 断言
const calls = await getCalls(page)
const exec = calls.find((c) => c.path === '/api/canvas/execute')
expect(exec.body.params?.steps).toBe(50)        // RECIPE-02
expect(exec.body.params?.lora).toEqual([...])   // RECIPE-03 结构保真
// ③ canonical 层:window.__kaisCanvas.getGraph() 直接断言 EventNodeV3.params
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| §14 窄通道(prompt/seed/engine 三键) | 全配方 round-trip(九键映射表) | 本 phase | 「编辑即真值」闭环;高级字段首次可持久化 |
| recipeParams 手写三 if | 映射表驱动提取 | 本 phase | RECIPE-04 集合断言有落点 |
| 反向覆盖「有值才写」 | 有值写 + 缺键 delete 传播 | 本 phase | 清空语义成立(修掉潜在复活 bug) |
| KNOWN_KEYS popover 本地定义(L27) | flowgraph-v3 共享常量 | 本 phase | 一处定义两处消费 |

**Deprecated/outdated(仓内注释自认):** serialize.ts L34-36「窄通道声明(地雷 #3):§14 只 round-trip prompt/seed/engine 三键;steps/cfg/lora/quant 等全配方持久化出范围(预存损耗…防 scope creep)」——本 phase 正是该声明的解除。

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 「sampler」字段不存在——ROADMAP 描述里的 sampler 是泛称;实际锁定字段集 = steps/cfg/quant/sageAttention/lora(UI-SPEC 已锁;types.ts 无 sampler 字段佐证) | 全文 | LOW:若用户真想要 sampler 枚举控件需补字段(GenerationParams catchall 可承载但无类型) |
| A2 | RECIPE_ROUNDTRIP 集含 negative(CONTEXT「扩到 GenerationParams 全集」字面含 negative;但 UI-SPEC 编辑集与只读行均未列 negative 的面板展示位) | Pattern 1 | LOW:negative 进 round-trip 但面板不展示/不可编辑 → popover 照旧可见;若裁出 round-trip 则 negative 继续丢(planner 定夺,倾向入 round-trip) |
| A3 | verify-phase-58 可 import 双侧源码做集合比较(verify-phase-51 有「根 scripts 可直接 import infinite-canvas 文件」先例;flowgraph-v3 经 serialize.ts 的 `import type` 链已被 verify 消费) | Pattern 4 | LOW:若 tsx 解析 @kais alias 失败,退化为读源码文本 regex 提取键集(52 范式本来就是文本断言) |
| A4 | canvasAssetSchema 声明配方字段用「直接字面量」而非 pipeline-field-map.yaml 生成链(yaml 只支持 string|number,装不下 boolean/array) | 架构 | LOW:若强行走 yaml 需改 generate_mappings.py + yaml schema,范围膨胀 |

## Open Questions

1. **canvasAssetSchema 声明哪些 V2 类型的配方字段?**
   - What we know: 反向覆盖会把配方键写上**任何**有产生事件的资产 data(全 stage);assetDataSchemas 按 type(script/asset/storyboard/video/audio)分schema;生产 DB 0 行含配方字段。
   - What's unclear: 五个类型全声明(可选)vs 只声明高频类型(video/asset/storyboard)。zod object 默认 strip 不拒未知键——**未声明的类型不会 400**,只是不形状强制。
   - Recommendation: 五类型全声明可选字段(steps:number / cfg:number / quant:string / sageAttention:boolean / lora:{name,strength}[] 全 optional),一次到位,verify 断言集相等才有完整对照面。
2. **regen 请求体是否需要在 params 外平铺高级键?**(52-02 契约 prompt/seed 在 body 顶层,params 整袋在内)
   - What we know: 现契约 `extra?: { prompt?, seed?, params? }`;prompt/seed 双轨(顶层+params 内)。
   - Recommendation: 不平铺新键——params 整袋即 RECIPE-02 断言面(「请求体断言可见」已满足);维持 extra 契约零改动。
3. **probe-58-real 目标节点**
   - What we know: 9999/1 有 479 节点,6 个带配方(a-p04-art4/5/6,prompt-only);steps/cfg 生产零存量。
   - Recommendation: a-p04-art4(与 probe-52-real 同锚);「恢复」= 删新增键(delete 传播恰好是被测语义)。

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | 全部 | ✓ | v24.13.0 | — |
| vitest(infinite-canvas) | 单测基线 | ✓ | 实跑 406/37 绿 | — |
| vitest(flowgraph-v3) | 单测基线 | ✓ | ^2.1.9,实跑 130/7 绿 | — |
| Playwright + mock-backend | e2e | ✓ | config :9876 workers:1 | — |
| 真机后端 :10588 | probe-58-real | ✓ | load-v2 → 200(本会话探测) | 延后探针(不阻塞 verify 门) |
| tsx | verify 脚本 | ✓ | ^4.19.2 | — |
| better-sqlite3(只读探测) | DB 存量核查 | ✓ | 已用(9217 行/0 配方字段) | — |

**Missing dependencies with no fallback:** 无。
**Missing dependencies with fallback:** 无。

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.9(双包)+ Playwright(e2e) |
| Config file | packages/infinite-canvas/vite.config.ts(test 段)/ packages/flowgraph-v3/ts(vitest 默认)/ playwright.config.mjs |
| Quick run command | `cd packages/infinite-canvas && npx vitest run src/v3`(~4s 全量也快;flowgraph-v3 `npx vitest run` 515ms) |
| Full suite command | 双包 vitest + `cd packages/infinite-canvas && npm run build && npm run test:e2e`(62 基线) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RECIPE-01 | 编辑 steps/cfg/lora → 保存 → reload 往返保真 | e2e + unit | e2e: `npx playwright test phase58-recipe` / unit: `npx vitest run src/v3/__tests__/serialize.test.ts` | ❌ Wave 0(serialize.test.ts 已存在,新增用例) |
| RECIPE-02 | regen 请求体携带编辑后高级字段 | e2e(mock logCall) | `npx playwright test phase58-recipe` | ❌ Wave 0 |
| RECIPE-03 | 只改 steps 时 quant/lora 原样保留;lora 结构保真 | e2e + unit(serialize 52-02 describe 扩展) | 同上 + `npx vitest run src/v3` | 部分(serialize.test.ts 'Phase 52-02' describe 为扩展基底) |
| RECIPE-04 | 三方集合相等 + nullish 计数锁 + forced-failure | verify 脚本 | `npm run verify:phase-58` | ❌ Wave 0 |
| (migrate 拓宽) | recipeParams 全集提取 + lora 深透传 | unit | `cd packages/flowgraph-v3 && npx vitest run tests/migrate.test.ts` | 部分(migrate.test.ts L239 既有窄通道用例为扩展基底) |
| (真机) | 改 steps+cfg → 保存 → 重载 → 恢复 | manual probe | `node test/e2e/probe-58-real.mjs`(须先 deploy) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** 双包 vitest(共 <10s)+ `npx tsc --noEmit`(受触包)
- **Per wave merge:** `npm run verify:phase-58`(含三根 tsc + 双包 vitest 命令门)
- **Phase gate:** verify:phase-58 绿 + e2e 全量 ≥62+新增 绿(先 `npm run build`)+ build:server → deploy-canvas → probe-58-real 零足迹通过

### Wave 0 Gaps
- [ ] `packages/infinite-canvas/test/e2e/tests/phase58-recipe.mjs` — RECIPE-01/02/03(需先经 save-v2 注入带高级字段的 fixture,Pitfall 6)
- [ ] `scripts/verify-phase-58.ts` + package.json `verify:phase-58` 注册 — RECIPE-04
- [ ] `packages/infinite-canvas/test/e2e/probe-58-real.mjs` — 真机零足迹探针
- [ ] serialize.test.ts 新增 describe(Phase 58: 全配方反向覆盖 + delete 传播)/ migrate.test.ts 新增提取全集用例 — 框架在,用例缺

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | 既有路由鉴权不动(零新端点) |
| V3 Session Management | no | 无会话变更 |
| V4 Access Control | no | save-v2/execute 既有权限面不变 |
| V5 Input Validation | yes | zod 双层:save-v2 `FlowGraphV2Schema`(data=record any 透传,**预存设计**)+ canvasAssetSchema 新声明可选字段(在场时形状强制:lora 必须 {name:string,strength:number}[]——恶意畸形形状仍 400) |
| V6 Cryptography | no | 无密码学面 |

### Known Threat Patterns for kap 画布栈

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| save-v2 data 袋注入任意键(配方字段成为新载体) | Tampering | data 袋本就是开放 record(管线直写 DB 绕过 HTTP 为既定事实);配方字段声明后**在场形状强制**兜底;值最终只进 JSON blob 与引擎请求体,无代码执行面 |
| 面板 number input 注入 NaN/Infinity → params 污染 | Tampering | input[type=number] + UI-SPEC 边界(min/max/step);updateEventParams 值透传,zod `z.number()` 在 v3 直通模式拒绝非有限数 |

## Sources

### Primary (HIGH confidence — 全部本会话工具直读/实跑)
- `packages/flowgraph-v3/ts/src/types.ts` L181-192 — GenerationParams 九键全集(catchall 开放)
- `packages/flowgraph-v3/ts/src/zod.ts` L103-115 — generationParamsSchema 已全键 + catchall(零改动依据)
- `packages/flowgraph-v3/ts/src/migrate.ts` L155-167/489-503 — recipeParams 窄通道 + hasRecipe + orphan 分支
- `packages/infinite-canvas/src/v3/serialize.ts` L209-371 — 反向覆盖窄通道(L245-251)/ eventToAsset 折叠(L293-301)/ rawData 合并公式
- `packages/infinite-canvas/src/v3/adapter.ts` — adaptV2Graph 全链(rawDataByNodeId 捕获 L565-574)/ v3-passthrough rawData=null 分支
- `packages/infinite-canvas/src/store/canvasStore.ts` L623-689/L953-957 — updateEventParams 删除语义 / persistEventParams 乐观保存 / deleteNode 保存链
- `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx` L617-739 — PromptSection 三态/保存/regen 整袋 spread
- `packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx` L27/L59-91 — KNOWN_KEYS / reroll 整袋 spread
- `packages/infinite-canvas/src/hooks/useCanvasSocket.ts` L218 + `src/components/FlowCanvas.tsx` L326-340 — graph:saved → loadCanvas 同屏回读
- `src/routes/canvas/execute.ts` L28 — params 槽位(接受并忽略,零改动依据)
- `src/routes/canvas/v2/save-v2.ts` L36-69 + `src/types/flowgraph-v2-schema.ts` L40 — zod record 透传 + validateGraphNodes 只校验不转换
- `src/lib/canvasRelationalStore.ts` L93/L790 — data JSON.stringify 整袋落库(全保真)
- `src/lib/canvasAssetSchema.ts` + `schema/generated/frontend-zod-extensions.ts` — 现无配方字段;yaml 生成链仅 string|number
- 生产 DB `data/db2.sqlite`(只读):canvas_nodes 9217 行,0 行含 steps/cfg/lora/quant(绿地确认)
- 真机 :10588 load-v2 200;9999/1 图 479 节点(a-p04-art4 prompt-only)
- vitest 实跑:infinite-canvas 406 tests/37 files、flowgraph-v3 130 tests/7 files 全绿(2026-08-23)
- e2e 基线:`grep -rE "^\s*test\(" test/e2e/tests/*.mjs` = 62 用例/13 文件
- `scripts/verify-phase-52.ts` — 聚合门范式(源码形状断言/S5 命令门/forced-failure)
- `packages/infinite-canvas/test/e2e/{helpers.mjs,tests/phase52-regen.mjs,mock-backend/server.mjs,probe-52-real.mjs}` — e2e/probe 装置范式

### Secondary (MEDIUM confidence)
- 无(本 phase 无外部库调研需求)

### Tertiary (LOW confidence)
- 无

## Metadata

**Confidence breakdown:**
- Standard stack(仓内模块图): HIGH — 全部代码直读 + 行号锚定
- Architecture(双丢弃点 + 通透带): HIGH — 每一环逐一开文件验证,含 DB 层与服务端 zod 层
- Pitfalls: HIGH(P1/P2/P3 从已验证代码语义推导,非猜测)/ 部分边缘(P7/P8)MEDIUM
- 基线数字: HIGH — vitest 本会话实跑,e2e grep 计数,DB SQL 实查

**Research date:** 2026-08-23
**Valid until:** 2026-09-23(仓内代码,随主干演进;执行前 planner 应复核 serialize.ts/migrate.ts 行号未漂移)
