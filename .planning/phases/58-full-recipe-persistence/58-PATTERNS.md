# Phase 58: 全配方持久化 (Full Recipe Persistence) - Pattern Map

**Mapped:** 2026-08-23
**Files analyzed:** 14（新建 4 / 修改 8 / 条件性零改动 1 / 注册 1）
**Analogs found:** 14 / 14（全部命中；其中 9 个为「原位拓宽」——analog 即修改目标自身）

> 本 phase 的特殊性：绝大多数改动点是**既有文件原位拓宽**（serialize 窄通道 / migrate 窄通道 /
> PromptSection / KNOWN_KEYS），analog 与目标同文件。真正「从零找范式」的只有 4 个新建文件
> （recipe.ts / phase58-recipe.mjs / probe-58-real.mjs / verify-phase-58.ts），全部有 51-52 一比一先例。

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/flowgraph-v3/ts/src/recipe.ts`（新建） | 常量模块 (utility) | transform（键名映射表） | `packages/flowgraph-v3/ts/src/layout.ts` L67 `STAGE_ORDER` | role-match |
| `packages/flowgraph-v3/ts/src/index.ts`（修改：+1 行 barrel） | barrel export | — | 自身 L5-13 | exact |
| `packages/flowgraph-v3/ts/src/migrate.ts`（修改） | transform 纯函数 | transform（V2→V3） | 自身 L155-167 `recipeParams`/`hasRecipe` | exact（原位拓宽） |
| `packages/infinite-canvas/src/v3/serialize.ts`（修改） | serializer | transform（V3→V2） | 自身 L245-251 反向覆盖 | exact（原位拓宽） |
| `packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx`（修改） | component | read-only display + request-response | 自身 L27 `KNOWN_KEYS` | exact（换 import 源） |
| `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx`（修改） | component（编辑器） | CRUD（编辑→持久化→往返） | 自身 L617-739 `PromptSection` | exact（原位扩展） |
| `src/lib/canvasAssetSchema.ts`（修改） | config / zod schema | validation | 自身 L93-111 asset 分支 `views` 数组可选先例 | exact（原位声明） |
| `schema/generated/frontend-zod-extensions.ts`（**条件性零改动**，见 A4 裁定） | generated config | — | 自身（AUTO-GENERATED 头） | n/a |
| `packages/infinite-canvas/test/e2e/tests/phase58-recipe.mjs`（新建） | test (e2e) | request-response + round-trip | `test/e2e/tests/phase52-regen.mjs` 全文件 | exact |
| `packages/infinite-canvas/test/e2e/probe-58-real.mjs`（新建） | test (真机探针) | request-response | `test/e2e/probe-52-real.mjs` Part B | exact |
| `scripts/verify-phase-58.ts`（新建） | verify 聚合门 | batch | `scripts/verify-phase-52.ts` 全文件 | exact |
| `package.json`（修改：+1 行注册） | config | — | 自身 L43-51 verify 注册块 | exact |
| `packages/infinite-canvas/src/v3/__tests__/serialize.test.ts`（扩展） | unit test | transform | 自身 L294-393 `'Phase 52-02'` describe | exact（扩展基底） |
| `packages/flowgraph-v3/ts/tests/migrate.test.ts`（扩展） | unit test | transform | 自身 L239-244 窄通道用例 + L206-217 `migrateStoryboard` helper | exact（扩展基底） |

## Pattern Assignments

### `packages/flowgraph-v3/ts/src/recipe.ts`（新建：常量模块）

**Analog:** `packages/flowgraph-v3/ts/src/layout.ts` L67 —— 包内运行时常量导出的既有先例；
键集派生源 = `zod.ts` L103-115。

**常量导出先例**（layout.ts L67，laneGeometry.ts L10 跨包消费实证）：
```typescript
export const STAGE_ORDER: readonly Stage[] = [   // flowgraph-v3/ts/src/layout.ts L67
// 消费侧：packages/infinite-canvas/src/components/canvas/laneGeometry.ts L10
//   import { STAGE_ORDER } from '@kais/flowgraph-v3'   ← 运行时值导入，vite/tsconfig alias 均通
```

**派生源**（zod.ts L103-115，零改动，`.shape` 可程序化取九键）：
```typescript
export const generationParamsSchema = z
  .object({
    prompt: z.string().optional(),
    negative: z.string().optional(),
    seed: z.number().optional(),
    modelVersion: z.string().optional(),
    lora: z.array(z.object({ name: z.string(), strength: z.number() }).strict()).optional(),
    steps: z.number().optional(),
    cfg: z.number().optional(),
    quant: z.string().optional(),
    sageAttention: z.boolean().optional(),
  })
  .catchall(z.unknown());
```

**要点：**
- 键集结构按 RESEARCH Pattern 1（p 侧类型注解修正：零 import 纯常量文件用内联九键字面量联合 `'prompt'|'negative'|'seed'|'modelVersion'|'lora'|'steps'|'cfg'|'quant'|'sageAttention'`，**非 `keyof GenerationParams`**——后者需 import 类型，与零依赖前提冲突）：`ReadonlyArray<{ p: <内联九键字面量联合>; d: string }>` 对（modelVersion↔engine 非恒等映射，禁裸字符串数组）。
- 文件**零 import**（纯常量）→ root `scripts/verify-phase-58.ts` 可经相对路径 `../packages/flowgraph-v3/ts/src/recipe` 直接 import 做三方集合比较（tsx 无解析风险）。
- barrel 注册照抄 index.ts 既有行：`export * from './recipe.js';`（index.ts L5-13，注意 `.js` 后缀惯例）。

---

### `packages/flowgraph-v3/ts/src/migrate.ts`（修改：recipeParams 全集提取 + hasRecipe 拓宽）

**Analog:** 自身 L155-167（原位拓宽）。

**现状窄通道**（L155-167，直接改此处）：
```typescript
function recipeParams(v2: FlowNodeV2): GenerationParams {
  const d = v2.data ?? {};
  const params: GenerationParams = {};
  if (d.prompt != null) params.prompt = d.prompt;
  if (d.seed != null) params.seed = d.seed;
  if (d.engine != null) params.modelVersion = d.engine; // engine → modelVersion
  return params;
}

function hasRecipe(v2: FlowNodeV2): boolean {   // Pitfall 8：顺手改查映射表任意键
  const d = v2.data ?? {};
  return d.prompt != null || d.seed != null || d.engine != null;
}
```

**拓宽范式**：手写三 if → 映射表驱动循环（消费 recipe.ts 导出）；lora 数组整袋透传
（`d.lora` 是 `{name,strength}[]`，`!= null` 判断后原样赋值即可，无需逐项校验——
`generationParamsSchema.catchall` 已宽容）。孤儿分支在 L489-503（hasRecipe 消费点）。

**单测扩展基底**（migrate.test.ts L239-244 既有窄通道用例 + L206-217 helper 范式）：
```typescript
it('节点 data 上的 prompt/seed/engine → 生成事件 params', () => {   // migrate.test.ts L239
  const e = event(graph, 'evt_n_video_02');
  expect(e.params.prompt).toBe('城市夜景，天台远景，雨渐停');
  expect(e.params.seed).toBe(90001);
  expect(e.params.modelVersion).toBe('wan2.2-t2v');
});
// 局部图构造 helper 先例（L206-217 migrateStoryboard）：单节点 migrateV2toV3 取 event 断言
```
新增用例：data 带 steps/cfg/lora/quant/sageAttention/negative → params 全提取；lora 深结构保真；
仅 steps 无 prompt/seed/engine 的节点不再落 orphan import 种子（hasRecipe 拓宽证据）。

---

### `packages/infinite-canvas/src/v3/serialize.ts`（修改：反向覆盖拓宽 + delete 传播）

**Analog:** 自身 L245-251（原位拓宽）；delete 语义对照 canvasStore.ts L646。

**现状反向覆盖**（L245-251，直接改此处）：
```typescript
const producingEvt = producingEventByAssetId.get(n.id)   // L245
if (producingEvt != null) {
  const p = producingEvt.params
  if (n.stage !== 'script' && p.prompt != null) data.prompt = p.prompt
  if (p.seed != null) data.seed = p.seed
  if (p.modelVersion != null) data.engine = p.modelVersion   // ← 窄通道终点
}
```

**拓宽 + delete 传播目标形态**（RESEARCH Pattern 2 已给出全文；关键行）：
```typescript
for (const { p: pk, d: dk } of RECIPE_ROUNDTRIP_KEYS) {
  if (n.stage === 'script' && pk === 'prompt') continue // 52-02 例外保留
  const v = (p as Record<string, unknown>)[pk]
  if (v != null) data[dk] = v
  else delete data[dk]   // ← 新增：防 rawData 陈旧值复活（Pitfall 1）
}
```

**⚠ 关键约束（本 mapper 新发现，planner 必读）：** serialize.ts 头注释 L10-11 自我声明
「对 @kais/flowgraph-v3 只许 `import type`（tsx 下类型擦除，根 scripts/verify-phase-51.ts
可直接 import 本文件做断言）」。若 serialize.ts 改为运行时 `import { RECIPE_ROUNDTRIP_KEYS }`，
root tsx script 直接 import serialize.ts 的性质即失效。两条路线（planner 定夺）：
- **路线 A（推荐）**：serialize.ts 运行时导入常量——仓内先例充分（canvasStore.ts L13 /
  FlowCanvas.tsx L15 / laneGeometry.ts L10 均运行时导入，vite+tsconfig alias 双通，见
  infinite-canvas/tsconfig.json L22 + vite.config.ts L12）；verify-phase-58 对 serialize 侧
  退化为文本 regex 断言（52 范式本就是 `read()` + 正则，verify-phase-52.ts L93-100 同款），
  三方集合比较由「recipe.ts 相对 import ↔ canvasAssetSchema 文本提取 ↔ migrate 源文本提取」完成。
- **路线 B**：serialize.ts 保持 import-type 纪律，映射表本地复制 → RECIPE-04 三方一致断言
  多一处复制点，防漂移门反而变弱。不推荐。
- 同步动作：serialize.ts 头注释 L34-36「窄通道声明（地雷 #3）」需更新为本 phase 解除声明。

**单测扩展基底**（serialize.test.ts L294-393 `'Phase 52-02: 事件配方反向覆盖 + stale wire'`
describe）：`evt()` / `minimalGraph()` / `asset()` helper 已就位（L298-313），新 describe
`'Phase 58: 全配方反向覆盖 + delete 传播'` 照抄该结构。必测：九键写回 + rawData 陈旧
steps 被 delete（构造 `raw = new Map([['n', { steps: 50, ... }]])` + 事件 params 无 steps
→ 断言 `node.data.steps === undefined`）+ adapt∘serialize round-trip 保真（L332-336 同款）
+ 输出过 `FlowGraphV2Schema.safeParse`（L23 直接相对路径 import 根 schema 的先例）。

---

### `packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx`（修改：KNOWN_KEYS 换源）

**Analog:** 自身 L27（一行换源，视觉零改）。

**现状**（L27）：
```typescript
const KNOWN_KEYS = new Set(['prompt', 'negative', 'seed', 'modelVersion', 'lora', 'steps', 'cfg', 'quant', 'sageAttention'])
```
**改为**：`import { RECIPE_KNOWN_KEYS } from '@kais/flowgraph-v3'`（recipe.ts 同时导出
known 键集或由 ROUNDTRIP 映射派生 `new Set(RECIPE_ROUNDTRIP_KEYS.map(k => k.p))`——
注意 known 集是 **p 侧**（V3 param 键），与 round-trip d 侧不同）。分组渲染 L116-146
（提示词/采样/LoRA/其他）与 `otherEntries` 过滤 L93 全部不动。

---

### `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx`（修改：PromptSection 扩配方编辑器 + 高级参数折叠区）

**Analog:** 自身 `PromptSection` L617-739（三态 + 保存/重生成范式，直接扩展）；
只读行控件对照 EventParamsPopover `KvRow`（L177-185）。

**三态判定**（L647-672，readonly 分支整块覆盖高级区——不改判定逻辑，只加内容）：
```typescript
const isLoserVariant = asset.curation === 'deprecated'   // L647
if (!evt || isLoserVariant) {
  const hint = asset.variantGroupId
    ? '落选变体配方已并入主事件 variantRecipes，不可单独编辑'   // ← e2e 锁死文案，禁改
    : '无产生事件，prompt 不可编辑'
  // ... prompt-readonly-hint + disabled textarea + disabled 保存/重生成
```

**draft 重置范式**（L633-638，Pitfall 9 防「保存后仍 dirty」）：
```typescript
const canonicalPrompt = evt?.params.prompt ?? ''
const [draft, setDraft] = useState(canonicalPrompt)
// 切换节点/产生事件、或 canonical 变化（保存成功/失败回滚）时重置草稿
useEffect(() => { setDraft(canonicalPrompt) }, [evt?.id, canonicalPrompt])
```
→ 高级字段各配一个同款 useEffect（依赖 evt?.id + 各 canonical 值）。

**保存按钮范式**（L676-683 + L718-726，共享保存按钮治理整个编辑器）：
```typescript
const handleSave = async () => {
  setSaving(true)
  try { await persistEventParams(evt.id, { prompt: draft }) }   // → patch 只含 dirty 字段
  finally { setSaving(false) }
}
// 按钮: disabled={!dirty || saving} / background: dirty ? theme.node.script : theme.bg.surface
```

**重生成整袋 spread**（L694-697，RECIPE-02 零服务端改动依据，照抄不动）：
```typescript
await executeNode(projectId, episodesId, asset.id, asset.stage, {
  prompt: canonicalPrompt,
  params: { ...evt.params, prompt: canonicalPrompt },   // 整袋:保存后即携带高级字段
})
```

**控件样式 token**（textarea L716 为基准）：`background: theme.bg.input, border: 1px solid
theme.border.default, borderRadius: 8, color: theme.text.primary, fontSize: 12`；数值用
`fontFamily: 'var(--cv-font-mono, monospace)'`；只读行用 `theme.text.disabled`。
SectionLabel（L787-789）= 高级参数 toggle 的字型基准（11px/600/uppercase/0.05em）。
UI-SPEC testid 契约（advanced-toggle / param-input-steps / lora-row-{i} 等）见 58-UI-SPEC.md §7。

**lora 归一化注意**（Pitfall 2，保存前处理）：trim 后空行丢弃；结果空数组 → patch 传
`lora: undefined`（触发 store 删除），**不是** `[]`。

---

### `src/lib/canvasAssetSchema.ts`（修改：五类型声明可选配方字段）

**Analog:** 自身 asset 分支 L93-111 —— `views` 已证明**数组可选字段可直接字面量声明**
（A4 裁定：不走 yaml 生成链）。

**既有先例**（L107-110）：
```typescript
// Optional structured params:
scene_id: z.string().optional(),
views: z.array(z.string()).optional(),          // ← 数组可选字段直接声明先例
style_vector: z.string().optional(),
```
**新增**（五类型 assetDataSchemas L61-141 每分支同款，全 optional）：
```typescript
steps: z.number().optional(),
cfg: z.number().optional(),
quant: z.string().optional(),
sageAttention: z.boolean().optional(),
lora: z.array(z.object({ name: z.string(), strength: z.number() }).strict()).optional(),
```
（lora 元素形状逐字对齐 flowgraph-v3 zod.ts L109，含内层 `.strict()`——两侧行为一致；此处是根仓 zod v4——**禁跨包 import zod 对象**，
Pitfall 4，只抄形状字面量。）注意 zod object 默认 strip 未声明键——`prompt/seed/engine` 已在
部分分支声明或经 record 透传，勿重复声明冲突键（audio/video 分支已有 `engine` 必填位
L68/L81，配方 round-trip 的 `engine` 写的是同键——保持现状勿动）。
`schema/generated/frontend-zod-extensions.ts` 为 AUTO-GENERATED（L1 头注释），yaml 链只
string|number，**本 phase 不改它**（A4）。

---

### `packages/infinite-canvas/test/e2e/tests/phase58-recipe.mjs`（新建 e2e）

**Analog:** `test/e2e/tests/phase52-regen.mjs` 全文件（结构一比一照抄）。

**头部与 helper**（L1 + L31-56）：
```javascript
import { test, expect, loadCanvas, nodeSelector, getCalls, switchToCanvasView } from '../helpers.mjs'

async function openDetailPanel(page, nodeId) {
  await page.locator(nodeSelector(nodeId)).dblclick()
  await page.waitForSelector('[data-testid="detail-panel"]', { timeout: 5_000 })
  await page.waitForSelector('[data-testid="prompt-section"]', { timeout: 5_000 })
}
// phase58 追加: await page.click('[data-testid="advanced-toggle"]')（默认收起,UI-SPEC §7）
```

**三层断言范式**（phase52-regen.mjs L51-55 / L73-77 / L80-84）：
```javascript
// ① wire 层: 等 save-v2 反向覆盖写进 mock 节点 data（phase58 换键 steps/cfg/lora）
await expect.poll(async () => {
  const res = await page.request.get('/__mock/state')
  const s = await res.json()
  return s.canvas.nodes.find((n) => n.id === 'storyboard-1')?.data?.steps
}, { timeout: 5_000 }).toBe(50)
// ② 请求体层: getCalls 断言 execute body.params
const calls = await getCalls(page)
const exec = calls.find((c) => c.path === '/api/canvas/execute')
expect(exec.body.params?.steps).toBe(50)
// ③ canonical 层: window.__kaisCanvas.getGraph()（helpers L37 已等 hook 挂载）
```
**fixture 注入范式（Pitfall 6 必用）**：mock DEFAULT_NODES（server.mjs L46-112）的 data
只有 prompt 无高级字段——照抄 REGEN-01-c 的 save-v2 POST 注入（phase52-regen.mjs
L106-145：构造 nodes/links 完整 graph POST `/api/canvas/v2/save-v2` → `page.reload` →
`switchToCanvasView`）。注入节点的 data 带 `steps/cfg/lora/quant/sageAttention`。
**用例清单**（RESEARCH Wave 0）：编辑三键→保存→wire 断言；reload 往返（REGEN-01-b
L87-100 同款 page.reload 重开面板断言）；清空 steps→保存→`/__mock/state` 里 data.steps
消失（Pitfall 1 防线）；regen body 整袋断言（未编辑 quant/lora 原样保留，RECIPE-03）；
落选只读（advanced 控件随整块 disabled）。

---

### `packages/infinite-canvas/test/e2e/probe-58-real.mjs`（新建真机探针）

**Analog:** `test/e2e/probe-52-real.mjs` Part B（L93-188，零足迹捕获-恢复模式）。

**骨架照抄**（L14-22 常量 + L94-105 捕获 + L170-187 finally 恢复）：
```javascript
const BASE = 'http://localhost:10588'
const QS = 'projectId=9999&episodesId=1&testMode=1'
const NODE_A = 'a-p04-art4'   // RESEARCH Open Question 3 裁定:与 probe-52 同锚
// 捕获原图 → openPanel → 编辑(steps+cfg) → 保存(saveStatuses.includes(200)) →
// reload 往返 → finally: saveV2(原图) 恢复 + reload 复核「净足迹=0」
```
**深比对工具**（L44-59 `stripUpdatedAt`/`deepEqual`，整段照抄——剔 meta.updatedAt/lastEventId）。
**openPanel 范式**（L119-126）：goto `?${QS}&focus=${NODE_A}` → 点「画布」→ 等
`.react-flow__node` → 等 `detail-panel` → 等 `prompt-section`（phase58 追加等
`advanced-toggle` 并点击展开）。**恢复即被测语义**：删新增键靠 delete 传播
（RESEARCH Open Question 3）。

---

### `scripts/verify-phase-58.ts`（新建聚合门）+ `package.json` 注册

**Analog:** `scripts/verify-phase-52.ts` 全文件（259 行，结构完整照抄）。

**骨架**（L37-72）：
```typescript
import fs from "node:fs"; import path from "node:path"; import { spawnSync } from "node:child_process";
const results: TestResult[] = [];
function assert(cond, name, detail?) { results.push(...); console.log(...) }
const REPO_ROOT = path.resolve(__dirname, "..");
function read(rel) { /* fs.readFileSync 文本 */ }
function runCmd(name, cwdRel, cmd, tailLines = 3) { /* spawnSync, exit!=0 即红 */ }
```
**S5 命令门照抄**（L211-216）：三根 tsc（root / infinite-canvas `-b` / flowgraph-v3）+
双包 vitest tail。
**forced-failure 自检照抄**（L218-234）：shadowAssert 组全必须 FAIL，意外 PASS 整门红。
**三方集合相等（本 phase 新断言面，52 无先例，构造方式）**：
```typescript
// A3 先例: verify-phase-52 经 read() 文本断言;serialize.test.ts L23 证明包测试可相对 import 根 src。
// recipe.ts 零依赖 → 相对 import 直接拿常量:
import { RECIPE_ROUNDTRIP_KEYS } from "../packages/flowgraph-v3/ts/src/recipe";
const pSide = RECIPE_ROUNDTRIP_KEYS.map(k => k.p).sort().join(",");
// canvasAssetSchema 侧: read() + 正则提取五分支配方键字面量（或 import assetDataSchemas 取 shape——
// 根仓 zod v4,本脚本在根仓跑,可 import;与 recipe.ts 常量比集合相等）
// migrate 侧: read(migrate.ts) 断言消费 RECIPE_ROUNDTRIP_KEYS（文本证据）而非手写键列表
// 交叉验证: Object.keys(generationParamsSchema.shape) 与 p 侧严格相等（zod.ts L104-114 九键）
```
**nullish 计数锁先例**（L113-117）：`(schemaSrc.match(/\.nullish\(\)/g) ?? []).length >= 15`
——phase58 同款对配方 optional 声明计数。**package.json 注册**（L43-51 块内 +1 行）：
`"verify:phase-58": "npx tsx scripts/verify-phase-58.ts",`

---

## Shared Patterns

### 1. 事件→资产反查（role:'output' 边，三处先例，唯一正道）
**Source:** serialize.ts L224-229 / NodeDetailPanel.tsx L625-631 / EventParamsPopover.tsx L67-71
**Apply to:** 本 phase 不新增第四处（PromptSection 已有），仅复用。
```typescript
const producingIds = graph.links.filter((l) => l.role === 'output' && l.target === asset.id).map((l) => l.source)
const evts = graph.nodes.filter((n): n is EventNodeV3 => n.kind === 'event' && producingIds.includes(n.id))
```

### 2. persistEventParams 保存链（乐观写 + 外科回滚 + toast，零改动直接消费）
**Source:** canvasStore.ts L653-689
**Apply to:** PromptSection 高级参数保存（patch 扩为多字段，store 侧不动）。
```typescript
const prevParams = target.params            // L671 不可变引用,回滚安全
get().updateEventParams(eventId, patch)     // L672 乐观写
try { await saveCanvasGraph(projectId, episodesId, serializeGraphToV2(cur, rawDataByNodeId)) }  // L676
catch (err) { /* L680-686 只还原该事件 params */ showToast(`配方保存失败已回滚: ...`, 'error') }
```

### 3. updateEventParams 空值删除语义（面板归一化必须配合）
**Source:** canvasStore.ts L644-648
**Apply to:** 面板保存 patch 构造（清空 number/未设置 select → undefined；空 lora → undefined 非 []）。
```typescript
for (const [key, value] of Object.entries(patch)) {
  if (value === undefined || value === null || value === '') delete params[key]  // 空值=删除
  else params[key] = value
}
```

### 4. 整袋 spread execute 请求体（RECIPE-02/03 契约）
**Source:** NodeDetailPanel.tsx L694-697 / EventParamsPopover.tsx L80-82
**Apply to:** 重生成（零改动）；e2e 断言面 = `getCalls` body.params。
```typescript
params: { ...evt.params, prompt: canonicalPrompt }   // 未编辑字段原值透传
```

### 5. @kais/flowgraph-v3 运行时导入边界（本 phase 承重决策）
**Source:** infinite-canvas/tsconfig.json L22 + vite.config.ts L12（alias）；
运行时导入先例 canvasStore.ts L13 / FlowCanvas.tsx L15 / laneGeometry.ts L10（STAGE_ORDER 常量）；
反例约束 serialize.ts 头注释 L10-11（root tsx 直连链）。
**Apply to:** recipe.ts 消费方（popover / panel / migrate / serialize）全部走正常
`import { ... } from '@kais/flowgraph-v3'`；**唯 serialize.ts 需按上文「路线 A/B」显式决策**；
根仓 src/ 永不 import 该包（root tsconfig 无 alias，RESEARCH Pitfall 4）。

### 6. e2e 前置纪律（地雷 #10）
**Source:** phase52-regen.mjs 头注释 L15-16 / probe-52-real.mjs 头注释 L13。
**Apply to:** phase58-recipe.mjs 头注释照写 + 执行前 `npm run build`（packages/infinite-canvas）；
probe-58-real 须先 `build → deploy-canvas.sh → build:server → restart`。

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| （无完全空缺） | — | — | 全部改动点有 analog |

两个「最近似但非完全同构」项（planner 注意差异）：
1. **三方集合相等断言**（verify-phase-58 新断言面）——52 只有单侧文本/计数断言，无双侧
   import 集合比较先例；构造方式见 verify-phase-58 一节（recipe.ts 零依赖相对 import +
   根仓 zod shape 提取，A3 有退化 fallback）。
2. **RECIPE_EDITABLE_FIELDS 三包单点消费**——KNOWN_KEYS 现为组件本地定义（Popover L27），
   「一处定义两处消费」本身是本 phase 新建结构；跨包运行时常量消费先例 = STAGE_ORDER
   （layout.ts L67 → laneGeometry.ts L10）。

## Metadata

**Analog search scope:** packages/infinite-canvas/src/{v3,components,store,test/e2e} +
packages/flowgraph-v3/ts/{src,tests} + src/lib + src/routes/canvas + scripts + 根 package.json
**Files scanned:** 直读 14 个 analog 文件（serialize/serialize.test/migrate/migrate.test/
NodeDetailPanel/EventParamsPopover/canvasStore/canvasAssetSchema/frontend-zod-extensions/
verify-phase-52/probe-52-real/phase52-regen/helpers/mock-server）+ grep 定位 6 处
**Pattern extraction date:** 2026-08-23
**行号漂移提醒:** RESEARCH「执行前 planner 应复核 serialize.ts/migrate.ts 行号未漂移」——
本 map 行号基于当日主干直读，与 RESEARCH 锚点一致（serialize L245-251 / migrate L155-167 实测吻合）。
