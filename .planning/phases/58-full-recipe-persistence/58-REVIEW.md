---
phase: 58-full-recipe-persistence
reviewed: 2026-08-23T14:05:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - packages/flowgraph-v3/ts/src/recipe.ts
  - packages/flowgraph-v3/ts/src/index.ts
  - packages/flowgraph-v3/ts/src/migrate.ts
  - packages/flowgraph-v3/ts/tests/migrate.test.ts
  - packages/infinite-canvas/src/v3/serialize.ts
  - packages/infinite-canvas/src/v3/__tests__/serialize.test.ts
  - packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx
  - packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx
  - src/lib/canvasAssetSchema.ts
  - packages/infinite-canvas/test/e2e/tests/phase58-recipe.mjs
  - packages/infinite-canvas/test/e2e/tests/phase57-deeplink.mjs
  - packages/infinite-canvas/test/e2e/probe-58-real.mjs
  - scripts/verify-phase-58.ts
  - scripts/verify-phase-51.ts
  - package.json
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: resolved
resolved: 2026-08-23T14:12:00Z
---

# Phase 58: Code Review Report

**Reviewed:** 2026-08-23T14:05:00Z
**Depth:** standard
**Files Reviewed:** 15（base 6a38f7c8..HEAD，9 commits）
**Status:** resolved（见下方 Resolution）

## Resolution

**Resolved:** 2026-08-23T14:12:00Z — Critical/Warning 四条全部修复入 master，`npm run verify:phase-58` 25/25 全绿（vitest 门经 WR-01 修复后为真实退出码）；`npx vitest run src/v3` 63/63（含 CR-01 新用例）、`npx tsc -b` 与根仓 `npx tsc --noEmit` 均 clean。

| ID | 处置 | Commit | 说明 |
|----|------|--------|------|
| CR-01 | fixed | 58ac3d10 | serialize 反向覆盖循环对 `curation==='deprecated'` 成员豁免 **delete 分支**（`else if (!loserExempt) delete data[dk]`；写折叠保留——Pitfall 7 预存语义裁定不治，最小行为变更）。新增 serialize.test.ts 用例 e：落选 + 共享主事件仅 prompt → 落选 data 袋 seed/steps/cfg/engine/lora 原样保留、prompt 折叠为 'A'（预存语义），winner 对照组陈旧 steps=50 被 delete 传播照常清除 |
| WR-01 | fixed | ee165250 | S5 两条 vitest 门去 shell 管道（`res.status` 回归 vitest 真实退出码）+ `spawnSync maxBuffer: 16MB`（去管道后全量捕获防 1MB 截断）。verify-phase-52.ts 同款缺陷按 fix scope 记 Info 不动 |
| WR-02 | fixed | 7bf3c0b0 | NodeDetailPanel 新增 `applyNumDraft`：steps/cfg 空串 → `patch[key]=undefined`（显式清空删键语义保留）、非有限数（'1e999'→Infinity/非法文本→NaN）→ 不写 patch 键（canonical 不动）；lora strength 非有限回退默认 1（与空串同语义） |
| WR-03 | fixed | e0c7c01a | steps/cfg dirty 改 `numDirty` 数值比较（'30.0' 与 30 等价 → 不 dirty），与 lora 数值深比较对齐；保存后不再永久 dirty 卡死重生成 |
| IN-01/02/03 | 记录不修 | — | Info 级，按本轮 fix scope（Critical+Warning）不动：IN-01 lora `.strict()` 为 RESEARCH V5 锁定决策知悉项；IN-02 probe-58-real P4 注释误导、IN-03 verify S1 断言只覆盖子集方向——留待后续 phase 处理 |

## Summary

主干契约链（recipe.ts 九键映射 ↔ migrate 全集提取 ↔ serialize 九键写回 + delete 传播 ↔ canvasAssetSchema 五分支声明 ↔ verify 三方集合门）实现质量整体良好：映射表单点契约成立、serialize/migrate 对称落地、lora 空→undefined 归一化无绕过路径（全仓 `updateEventParams` 写入点仅面板与 popover reroll，后者只写 seed）、popover KNOWN_KEYS 换源语义等价（九键同名）、zod v4 语法与 flowgraph-v3 zod.ts 形状一致（lora 内层均 `.strict()`）、phase57 navbar 6→5 与 verify-phase-51 两处外科修正经事实核验均成立（NAV_ITEMS 现 4 项 + 品牌 = 5 链接；BranchPanel 确被 FlowCanvas.tsx L60 消费；COORD-01 引用确在 v3.0-ROADMAP.md）。

但审出一处 **BLOCKER 级数据丢失路径**：delete 传播在「共享主事件的落选变体成员」上会把主事件缺键的配方字段从 wire/DB **永久删除**（58-01 SUMMARY 只论证了「migrate 必回填 modelVersion 所以 audio engine 删除不可达」，漏掉了 Pass 3 边重指让落选资产的反查命中主事件这一路径）。另有 3 处 WARNING：verify 门 S5 的 vitest 命令被管道退出码掩蔽（假绿）、面板 number 输入无 finite/范围守卫（NaN/Infinity → JSON null → 整图 save-v2 400）、steps/cfg dirty 用字符串比较导致数值等价文本不等时保存后永久 dirty（重生成被禁）。

## Critical Issues

### CR-01: delete 传播在落选变体成员上静默抹除管线写入的配方字段（DB 永久数据丢失）

**File:** `packages/infinite-canvas/src/v3/serialize.ts:257-265`（与 `packages/flowgraph-v3/ts/src/migrate.ts:787-796` 的交互）
**Issue:** migrate Pass 3 把落选候选（`curation === 'deprecated'`）的 output 边重指到 winner 主事件（migrate.ts L789 `if (link.source === candEventId) link.source = primaryEventId`）。因此 serialize 的 `producingEventByAssetId` 反查对**落选资产**命中的是**共享主事件**。反向覆盖循环对九键执行「params 有值→写，缺键→`delete data[dk]`」（serialize.ts L262-264），且对 `n.curation === 'deprecated'` 无任何豁免：

- 落选资产 raw data 里由管线写入、而主事件 params 缺失的键（seed/engine/steps/cfg/lora/quant/sageAttention/negative），在**下一次任意整图保存**（不只是编辑该节点）时被从 wire 删除并落库——永久丢失。
- 落选配方的唯一持久化载体就是落选资产自身的 data 袋（serialize 不写 `variantRecipes`，migrate 每次加载从落选 data 重建 variantRecipes，见 migrate.ts L783-796）——删除后 reload 时 `Object.keys(candEvent.params).length > 0` 不成立，variantRecipes 里该候选条目整个消失，可复现性归零。

具体场景：winner 事件 params 仅 `{prompt:'A'}`（生产现状：a-p04-art4/5/6 均 prompt-only），loser raw data `{prompt:'B', seed:222, steps:30}`。52-02 时代 loser 的 seed/steps 在每次保存后原样存活（旧窄通道只覆盖 prompt/seed/engine 且「有值才写」）；本 phase 后：loser 的 `data.prompt` 被覆写为 'A'（预存折叠语义，Pitfall 7 已裁定不治），但 `data.seed`/`data.steps` 被 **delete 传播新增行为直接删除**——这是 Pitfall 7（覆写）之外的新 amplify，RESEARCH 未论证过。58-01 SUMMARY L141 的「migrate 必回填 modelVersion → engine 删除不可达」论证只覆盖了自迁移闭环，未覆盖共享事件路径。

serialize.test.ts 用例 b（`data.engine` 陈旧值删除断言）把简单场景的删除语义锁死为 intended，但**没有任何单测/e2e 覆盖「落选成员 + 保存」的 wire 层断言**（phase58-recipe.mjs 落选用例只断言 UI disabled，不点保存）——正是这个缺口让该路径漏网。

**Fix:**
```typescript
// serialize.ts 反向覆盖循环外（或循环内首行）加落选豁免：
const producingEvt = producingEventByAssetId.get(n.id)
if (producingEvt != null && n.curation !== 'deprecated') {
  // 落选变体的 data 袋是其配方（variantRecipes 重建源）的唯一存活地，
  // 共享主事件缺键 ≠ 用户清空 —— 不写不删，交 Pitfall 7 预存折叠语义
  const p = producingEvt.params as Record<string, unknown>
  for (const { p: pk, d: dk } of RECIPE_ROUNDTRIP_KEYS) {
    if (n.stage === 'script' && pk === 'prompt') continue
    const v = p[pk]
    if (v != null) data[dk] = v
    else delete data[dk]
  }
}
```
（备选：delete 分支仅对「该事件唯一 output 目标」生效。）并补 serialize 单测：deprecated 成员 + 主事件缺 steps + raw data 有 steps → 保存后 wire `data.steps` 仍在。

## Warnings

### WR-01: verify-phase-58 S5 vitest 命令门被 `| tail -2` 管道退出码掩蔽（假绿）

**File:** `scripts/verify-phase-58.ts:222-223`（`runCmd` 断言在 L72-76）
**Issue:** `spawnSync("npm test 2>&1 | tail -2", { shell: true })` 下 `res.status` 是整条管道（即 `tail`）的退出码，不是 vitest/npm 的。vitest 全红时 `res.status === 0` → `assert(res.status === 0, ...)` 仍然 PASS——S5 五条命令门里两条 vitest 门**永远不可能红**（失败文本只会出现在 detail 字符串里，断言本身通过）。RECIPE-04 防漂移门的核心承诺（「双包 vitest 不降」机器锁）一半是橡皮图章。此缺陷系照抄 verify-phase-52.ts L214-215 的既有模式，但本文件是本 phase 新增交付物。tsc 三条无管道，不受影响。

**Fix:** 去 Shell 管道，JS 侧切尾并调大 maxBuffer：
```typescript
function runCmd(name: string, cwdRel: string, cmd: string, tailLines = 3): void {
  const res = spawnSync(cmd, { cwd: path.join(REPO_ROOT, cwdRel), shell: true,
    encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  // ...
}
// 调用侧改为不带管道：
runCmd("infinite-canvas vitest", "packages/infinite-canvas", "npm test", 2);
runCmd("flowgraph-v3 vitest", "packages/flowgraph-v3", "npx vitest run", 2);
```
（`runCmd` 已在 JS 侧做 `slice(-tailLines)`，管道纯属多余。）

### WR-02: 面板 number 输入无 finite/范围守卫——NaN/Infinity 经 JSON null 化触发整图 save-v2 400

**File:** `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx:708-709`（`Number(adv.drafts.steps)` / `Number(adv.drafts.cfg)`）、`:811`（`normalizeLoraDraft` 的 `Number(r.strength)`）
**Issue:** `input[type=number]` 的 `min/max/step` HTML 属性不拦截手工键入的越界/溢出文本。`'1e999'` 是合法数字语法，`Number('1e999') === Infinity`；`patch.steps = Infinity` 经 `updateEventParams`（Infinity 非空值 → 写入）→ serialize `v != null` → `data.steps = Infinity` → fetch `JSON.stringify` 把 Infinity 序列化为 `null` → 服务端 canvasAssetSchema `steps: z.number().optional()`（不收 null）400——**整图保存失败**，报错信息完全不指向根因。steps/cfg/lora strength 三处同构。空串路径已正确归一为 `undefined`，唯独非有限数无守卫。

**Fix:**
```typescript
const toNumOrUndef = (s: string): number | undefined => {
  const t = s.trim()
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined // NaN/Infinity → 未设置，防 JSON null 化 400
}
// handleSave:
if (adv.stepsDirty) patch.steps = toNumOrUndef(adv.drafts.steps)
if (adv.cfgDirty) patch.cfg = toNumOrUndef(adv.drafts.cfg)
// normalizeLoraDraft: strength: Number.isFinite(Number(r.strength)) ? Number(r.strength) : 1
```

### WR-03: steps/cfg dirty 用字符串比较——数值等价但文本不等（'30.0'/'3e1'）保存成功后永久 dirty，重生成被禁

**File:** `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx:853-854`
**Issue:** `stepsDirty = drafts.steps !== (canonicalSteps != null ? String(canonicalSteps) : '')` 是**字符串**比较。用户把 30 改成 '30.0' → dirty → 保存 → `patch.steps = 30`（数值不变）→ `updateEventParams` 写入同值 → `canonicalSteps` 原语不变 → `useAdvancedDrafts` 的 reset effect deps（L851）不触发 → drafts.steps 保持 '30.0' → **保存已成功但面板仍 dirty**：保存按钮常开、重生成按钮持续 disabled（L773 `disabled={dirty || submitting}`），只能手工把文本改回 '30' 解锁。对照组：lora 的 dirty 走 `normalizeLoraDraft` 后数值深比较（L858、`loraRowsEqual`），无此问题——同屏两套 dirty 语义不一致即证 steps/cfg 是疏漏。Pitfall 9 防的「保存后仍 dirty → regen 永久禁用」恰在此输入形态下成真。

**Fix:** 与 lora 对齐为数值比较：
```typescript
const numDirty = (draft: string, canonical: number | undefined): boolean =>
  draft.trim() === '' ? canonical != null : Number(draft) !== canonical
const stepsDirty = numDirty(drafts.steps, canonicalSteps)
const cfgDirty = numDirty(drafts.cfg, canonicalCfg)
```

## Info

### IN-01: lora 内层 `.strict()` 对管线富字段 lora 条目的整图保存砖化风险（设计权衡，建议知悉）

**File:** `src/lib/canvasAssetSchema.ts:80,102,134,156,179`
**Issue:** 五分支 lora 均为 `z.array(z.object({ name, strength }).strict())`——内层拒未知键。serialize 对 raw lora 是深度透传（不清洗），migrate 提取也不校验；一旦管线（直写 DB，绕过 HTTP）写下带额外键的 lora 条目（如 `{name, strength, path}`），该画布的**每一次** UI 保存都会 400（服务端形状强制），与 WR-02 同为整图级爆炸半径。生产 DB 现 0 行含 lora（绿地），且「在场形状强制」是 RESEARCH V5 锁定决策、与 flowgraph-v3 zod.ts 逐字一致——故记 Info 不记 Warning；但若未来 kmc/jimeng 引擎写富 lora，此处是第一嫌疑点。
**Fix:** 届时将内层 `.strict()` 放宽为默认 strip（去未知键），或 serialize 写回前对 lora 条目做键白名单收窄；保持与 flowgraph-v3 zod.ts 同步改。

### IN-02: probe-58-real P4「恢复即被测语义（delete 传播）」注释与实现不符

**File:** `packages/infinite-canvas/test/e2e/probe-58-real.mjs:164-166`
**Issue:** 注释称「新增 steps/cfg 的删除恰好走 Plan 01 delete 传播」，实际恢复是 `saveV2(9999, 1, originalGraph)` 整袋回 POST 原图——节点 data 被整体覆盖，steps/cfg 消失与 delete 传播语义无关（该路径根本不经过 serialize）。注释误导后续维护者以为 P4 顺带验证了 delete 传播的真机行为。
**Fix:** 注释改为「恢复 = 整袋回存原图（wholesale overwrite），非 delete 传播路径；delete 传播由 e2e RECIPE-03-b + serialize 单测 b 覆盖」。

### IN-03: verify-phase-58 S1「不多不少」断言实际只校验子集方向

**File:** `scripts/verify-phase-58.ts:88-103`
**Issue:** `recipeKeysOfBranch` 以 `RECIPE_EDITABLE_FIELDS.includes(k)` 过滤 shape 键——只能发现「漏声明」，不能发现「多声明」（如某分支额外声明了 `negative: ...` 不会红，因 negative 不在 EDITABLE 白名单内）。断言文案「EDITABLE ⊆ shape，不多不少」中的「不少」方向未实现。S2 九键交叉已锁 ROUNDTRIP 侧，故实际漂移窗口很小。
**Fix:** 若要兑现文案，改为断言 `RECIPE_ROUNDTRIP_KEYS` 的 d 侧键 ∪ 五可编辑键之外无其它新增配方状声明（例如对 shape 键做「已知全集 = 各分支原有键快照 + 九键」差集检查），或把文案改为「五键全声明且互相相等」。

---

**已核无误、不构成 finding 的重点项**（对应 review focus）：
1. delete 传播误删必填位：audio/video `data.engine` 在 canvasAssetSchema 已 nullish（52-UAT gap#1），删除不触发 400；自迁移闭环内 migrate 必回填 modelVersion，engine 删除确不可达——唯一可达裂缝即 CR-01 的共享事件路径。
2. 空 lora `[]` 归一化：全仓 `updateEventParams` 调用点仅 NodeDetailPanel（面板归一化 `undefined`）与 popover reroll（只写 seed），无绕过路径。
3. canvasAssetSchema zod v4 语法：`z.object().strict()`/`.extend`/`.shape` 在 v4.3.5 均可用（根仓 tsc clean 佐证）；键集与 flowgraph-v3 zod.ts 语义一致。
4. `negative` 进往返集但未在 schema 五分支声明——zod 默认 strip 未知键，不 400、data 原样落库，无丢键。
5. phase57 navbar 6→5、verify-phase-51 BranchPanel/ROADMAP 两处外科修正：经源码实核全部属实。

_Reviewed: 2026-08-23T14:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
