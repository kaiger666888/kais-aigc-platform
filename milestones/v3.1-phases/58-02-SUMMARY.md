---
phase: 58-full-recipe-persistence
plan: 02
subsystem: canvas-recipe-editor
tags: [recipe-editor, NodeDetailPanel, EventParamsPopover, canvasAssetSchema, zod, RECIPE_EDITABLE_FIELDS, lora-editor]

# Dependency graph
requires:
  - phase: 58-full-recipe-persistence plan 01
    provides: recipe.ts 单点契约（RECIPE_EDITABLE_FIELDS 五键白名单 + RECIPE_KNOWN_KEYS 九键集，@kais/flowgraph-v3 barrel 导出）
  - phase: 52-regen-loop
    provides: PromptSection 三态范式 + persistEventParams 保存链 + updateEventParams 空值删键语义
provides:
  - PromptSection「高级参数」折叠区编辑器（默认收起，五高级字段可编辑，seed/modelVersion/catchall 只读，UI-SPEC §7 testid 全量在位）
  - EventParamsPopover KNOWN_KEYS 换源共享常量（一处定义两处消费，视觉/分组零改）
  - canvasAssetSchema 五类型（audio/video/asset/storyboard/script）各五 optional 配方字段声明（在场形状强制，T-58-01 mitigate 落点）
affects: [58-03-e2e, 58-04-verify-phase-58, 59-stale-cascade]

# Tech tracking
tech-stack:
  added: []  # 零新依赖
  patterns:
    - "控件集由单点常量驱动：RECIPE_EDITABLE_FIELDS.map(renderField) 生成控件，switch 只定义控件形态，字段集永不本地重列"
    - "内容键 draft 重置：lora 草稿以 JSON 序列化内容 key 触发 useEffect 重置（引用变化但内容未变不打断编辑），与 prompt 字符串 dep 语义对齐"
    - "保存归一化：dirty-only patch + 清空→undefined（store 删键）+ 空 lora 数组→undefined 非 []（Pitfall 2）"
    - "伪类焦点样式经 token 插值 CSS class（.cv-adv-control:focus），inline style 无法表达 :focus/:hover"

key-files:
  created: []
  modified:
    - packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx
    - packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx
    - src/lib/canvasAssetSchema.ts

key-decisions:
  - "lora 草稿行 strength 以 string 承载（number input 受控值），保存时归一：空 strength→1（新行默认）、trim 后空名行丢弃、结果空数组→undefined 非 []"
  - "lora draft 重置用内容序列化 key（JSON.stringify）而非对象引用——params 对象引用变化但 lora 内容未变（如 popover 换 seed 回写）不打断进行中的 lora 编辑"
  - "quant select 对不在选项列表的 canonical 值注入为额外选中 option（禁静默 coerce，RECIPE-03 保真）"
  - "KNOWN_KEYS 换源用 new Set(RECIPE_KNOWN_KEYS) 一行别名——下游 .has() 过滤与分组渲染零 diff"
  - "canvasAssetSchema lora 内层 .strict() 逐字对齐 flowgraph-v3 zod.ts L109（zod v4 下 .strict() 实测可用，tsc 双根 clean 证实）"

patterns-established:
  - "Pattern: 高级参数折叠区三态覆盖——readonly 分支（落选/无事件）复用同一 AdvancedParamsSection 组件传 readOnly，值可展开查看但控件全 disabled"
  - "Pattern: schema 形状镜像声明——根仓 zod v4 直接字面量抄形状（禁跨包 import zod 对象，Pitfall 4），集合相等由 verify-phase-58 机器锁死"

requirements-completed: [RECIPE-01, RECIPE-03]

# Metrics
duration: 10 min
completed: 2026-08-23
---

# Phase 58 Plan 02: 配方编辑器 + popover 换源 + schema 声明 Summary

**PromptSection 高级参数折叠区编辑器（RECIPE_EDITABLE_FIELDS 常量驱动五字段控件 + lora 行编辑器 + dirty-only 保存归一化）+ popover KNOWN_KEYS 换源 recipe.ts + canvasAssetSchema 五类型五键 optional 声明（在场形状强制）**

## Performance

- **Duration:** 10 min
- **Started:** 2026-08-23T13:01:29Z
- **Completed:** 2026-08-23T13:11:22Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- PromptSection 扩「高级参数」折叠区（默认收起，组件本地态切节点重置）：steps/cfg number input（min/max/step 按 UI-SPEC §2）、quant/sageAttention native select（quant canonical 值不在列表时注入额外选中项，禁静默 coerce）、lora 行编辑器（name + strength 72px + ✕ remove aria-label「移除此 LoRA」+「+ 添加 LoRA」追加 `{name:'', strength:1}`）
- 共享「保存」按钮治理整个编辑器：patch 只含 dirty 字段；清空 number/未设置 select → undefined（store 删键）；lora 归一化 trim 空名行丢弃、空数组 → **undefined 非 []**（Pitfall 2）；dirty 时重生成 disabled + 锁死 title
- 三态只读覆盖（落选/无事件）：AdvancedParamsSection 同组件传 readOnly，值可展开查看；prompt-readonly-hint 两条锁死文案逐字未动；seed/modelVersion/catchall（KNOWN_KEYS 之外 JSON.stringify）只读行，seed 编辑权留在 popover reroll 通道
- draft 重置（Pitfall 9）：五字段 canonical 变化（保存回读/失败回滚）→ useEffect 重置，防「保存后仍 dirty → regen 永久禁用」；lora 用内容序列化 key 触发
- EventParamsPopover KNOWN_KEYS 换源 `new Set(RECIPE_KNOWN_KEYS)`（@kais/flowgraph-v3 导入），otherEntries 过滤 + 分组渲染 + 🎲 换 seed 全部零 diff
- canvasAssetSchema 五分支各声明 steps/cfg/quant/sageAttention/lora 五 optional 字段，lora 内层 `.strict()` 对齐 flowgraph-v3 zod.ts L109——畸形形状（如 `lora: [{name: 1}]`）save-v2 400（T-58-01 mitigate）；audio/video engine 必填位现状未动

## Task Commits

1. **Task 1: PromptSection 高级参数折叠区编辑器** - `f0c498f8` (feat)
2. **Task 2: popover KNOWN_KEYS 换源 + canvasAssetSchema 五类型配方字段声明** - `0e28b7a1` (feat)

**Plan metadata:** 见本文件提交（docs）

## Files Created/Modified

- `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx` — PromptSection 扩高级参数编辑器（+369 行）：useAdvancedDrafts hook、normalizeLoraDraft/loraRowsEqual、AdvancedParamsSection/AdvancedFieldRow/AddLoraButton 组件、dirty-only patch 保存
- `packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx` — KNOWN_KEYS 换源共享常量（3 行 diff：import + 别名 + 注释）
- `src/lib/canvasAssetSchema.ts` — assetDataSchemas 五分支各 +5 optional 配方字段（audio/video/asset/storyboard/script）

## Verification Results（plan-level）

- `npx tsc --noEmit`（root）clean；`npx tsc -b`（infinite-canvas）clean
- infinite-canvas 全量 vitest **410/410** 全绿（58-01 后基线 410 不降；52-03/52-08 面板用例零回归）
- `npm run verify:phase-52` **31/31 PASSED**（含 S5 命令门 verify:save-v2-legacy 17/17 + forced-failure 自检 4/4）——面板与 schema 改动对既有聚合门零扰动
- UI-SPEC §7 testid 契约逐项 grep 在位：advanced-toggle（aria-expanded + data-state + data-dirty）/ advanced-section / param-input-steps / param-input-cfg / param-select-quant / param-select-sage / advanced-readonly-seed / advanced-readonly-modelVersion / lora-row-{i} / lora-name-{i} / lora-strength-{i} / lora-remove-{i}（aria-label="移除此 LoRA"）/ lora-add / advanced-catchall / advanced-empty
- 锁死文案逐字在位 ×3：「落选变体配方已并入主事件 variantRecipes，不可单独编辑」「无产生事件，prompt 不可编辑」「在事件芯片 popover 换 seed 重跑」
- 重生成整袋 spread（`params: { ...evt.params, prompt: canonicalPrompt }`）逐字未改
- acceptance grep：`sageAttention: z.boolean().optional()` = 5、`steps: z.number().optional()` = 5、popover 本地九键字面量 = 0、canvasAssetSchema 无 @kais/flowgraph-v3 import
- 既有 schema 守护门核对：verify-schema-drift（EXPECTED_PARAM_FIELDS_BY_TYPE 未动）、verify-phase-52 S1 nullish 计数（仅增 optional）、verify-canvas-shot-timeline CANVAS-03 additive-only（纯增量）均不受影响

## Decisions Made

- lora 草稿 strength 以 string 承载（受控 number input 天然字符串态），保存归一化时空 strength 回退 1（新行默认值）
- lora draft 重置以内容序列化 key 触发而非对象引用——params 重建（如换 seed 回写）但 lora 内容未变时不丢用户进行中的编辑，与 prompt 字符串 dep 的 52-03 语义对齐
- 焦点/悬停伪类样式经 token 插值 `<style>` class（`.cv-adv-control:focus` / `.cv-adv-ghost:hover`）实现——inline style 无法表达伪类，token 全程引用无 raw hex
- zod v4 `.strict()` 实测可用（与 z.strictObject 等价），plan 字面量逐字落地无需替换

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 面板编辑器/popover/schema 声明就位，58-03 e2e（phase58-recipe.mjs）可直接按 UI-SPEC §7 testid 写断言（默认收起，e2e 须先点 advanced-toggle）
- 58-04 verify-phase-58 三方集合相等门的 canvasAssetSchema 侧对照面已就绪（五类型 × 五键全声明，planner 裁决 3）
- 注意：e2e 测 dist（地雷 #10），58-03 须先 `npm run build`；mock fixture 无高级字段（Pitfall 6），注入走 save-v2 POST 范式

## Self-Check: PASSED

- modified 文件 3/3 在盘
- commits f0c498f8 / 0e28b7a1 均在 git log
- 全部 acceptance criteria 复跑通过（见 Verification Results）

---
*Phase: 58-full-recipe-persistence*
*Completed: 2026-08-23*
