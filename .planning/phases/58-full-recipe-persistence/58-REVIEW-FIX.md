---
phase: 58-full-recipe-persistence
fixed_at: 2026-08-23T14:12:00Z
review_path: .planning/phases/58-full-recipe-persistence/58-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 58: Code Review Fix Report

**Fixed at:** 2026-08-23T14:12:00Z
**Source review:** .planning/phases/58-full-recipe-persistence/58-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (Critical + Warning): 4
- Fixed: 4
- Skipped: 0
- Info 级 3 条（IN-01/02/03）按本轮 fix scope 仅记录不修（REVIEW.md Resolution 节已注明）

**Verification:** `npm run verify:phase-58` 25/25 PASS（S5 vitest 门经 WR-01 修复后为真实退出码）；`packages/infinite-canvas && npx vitest run src/v3` 63/63（含 CR-01 新用例 e）；`npx tsc -b`（infinite-canvas）exit 0 ×2；根仓 `npx tsc --noEmit` exit 0。

## Fixed Issues

### CR-01: delete 传播在落选变体成员上静默抹除管线写入的配方字段（DB 永久数据丢失）

**Files modified:** `packages/infinite-canvas/src/v3/serialize.ts`, `packages/infinite-canvas/src/v3/__tests__/serialize.test.ts`
**Commit:** 58ac3d10
**Applied fix:** 反向覆盖循环加 `loserExempt = n.curation === 'deprecated'`，delete 分支改为 `else if (!loserExempt) delete data[dk]`——**只豁免 delete，保留写覆盖**。裁决依据：RESEARCH Pitfall 7 已锁定「winner 配方折叠写进落选 data」为预存语义本 phase 不治，REVIEW.md 备选与 orchestrator 修法方向（「跳过 delete」）一致，最小行为变更。新增 serialize 单测 e（CR-01 语义锁）：落选 + 共享主事件仅 prompt → 落选 data 袋 seed/steps/cfg/engine/lora 原样保留、prompt 折叠 'A'（预存语义注记），winner 对照组陈旧 steps=50 被 delete 传播照常清除。既有用例 b（delete 传播）用 candidate 资产不受影响。verify-phase-58 S3 的 `delete data[dk]` 文本断言仍命中。
**验证备注:** 属数据丢失逻辑修复，单测已锁 wire 层语义；建议人工抽查一次真机落选节点保存往返（probe 路径，非阻塞）。

### WR-01: verify-phase-58 S5 vitest 命令门被 `| tail -2` 管道退出码掩蔽（假绿）

**Files modified:** `scripts/verify-phase-58.ts`
**Commit:** ee165250
**Applied fix:** 两条 vitest 门去 shell 管道（`npm test` / `npx vitest run` 直跑，`res.status` 回归 vitest 真实退出码）；`spawnSync` 加 `maxBuffer: 16 * 1024 * 1024`（去管道后 stdout/stderr 全量捕获，默认 1MB 会被 vitest 全量输出撑爆致 status=null 假红）；文件头 S5 注释同步更新。verify-phase-52.ts 的同款缺陷按 scope 记 Info 未动。

### WR-02: 面板 number 输入无 finite/范围守卫——NaN/Infinity 经 JSON null 化触发整图 save-v2 400

**Files modified:** `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx`
**Commit:** 7bf3c0b0
**Applied fix:** 新增 `applyNumDraft(patch, key, draft)` 守卫：空串 → `patch[key] = undefined`（显式清空 → store 删键语义保留）；非有限数（'1e999'→Infinity / 非法文本→NaN）→ 不写 patch 键（canonical 原值不动，非法输入留待用户改正）。steps/cfg 两处 handleSave 换用守卫；`normalizeLoraDraft` strength 非有限回退默认 1（与空串默认同语义）。比 REVIEW.md 原建议多区分了「显式清空」与「非法输入」两种 undefined 路径（orchestrator 指令「非有限值回退不写 patch」）。

### WR-03: steps/cfg dirty 用字符串比较——数值等价但文本不等保存成功后永久 dirty，重生成被禁

**Files modified:** `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx`
**Commit:** e0c7c01a
**Applied fix:** `useAdvancedDrafts` 内 steps/cfg dirty 改 `numDirty(draft, canonical)` 数值比较（`draft.trim()==='' ? canonical != null : Number(draft) !== canonical`），'30.0'/'3e1' 与 30 数值等价 → 不 dirty；与 lora 的数值深比较对齐为同语义。非有限输入（'1e999'）仍 dirty——视为待修正的非法输入，属预期行为（已在注释注记）。

## Skipped Issues

None — 全部 in-scope finding 已修复。

## 备注

- 另有 1 个 docs commit：`213372e7 docs(58-review): mark REVIEW resolved...`（58-REVIEW.md status → resolved + Resolution 节，findings 正文未动）。
- 并行会话纪律：全程仅 `git add` 本报告列出的具体文件，未触碰 yarn.lock / workflows/*.png / probe 脚本 / test-viewer/ 等其它会话未提交文件。
- 工作模式偏离注记：按 orchestrator 明确指令（「Working directory: 主工作树」+ 主树验证工具链 node_modules 依赖）在主工作树直接操作，未走 /tmp 隔离 worktree；风险由逐文件精确 add + 原子 commit 缓解。

---

_Fixed: 2026-08-23T14:12:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
