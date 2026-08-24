---
phase: 60-post-save-panel-persistence
fixed_at: 2026-08-24T09:25:00Z
review_path: .planning/phases/60-post-save-panel-persistence/60-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 60: Code Review Fix Report

**Fixed at:** 2026-08-24T09:25:00Z
**Source review:** .planning/phases/60-post-save-panel-persistence/60-REVIEW.md
**Iteration:** 1
**Scope:** CRITICAL + WARNING only（CR-01, CR-02, WR-01, WR-02；Info 5 条按 scope 指令跳过）

**Summary:**
- Findings in scope: 4
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: Zero-footprint restore blindly overwrites concurrent external writes on the live :10588 server

**Files modified:** `scripts/diagnose-60-roundtrip.ts`, `packages/infinite-canvas/test/e2e/probe-60-real.mjs`, `scripts/verify-phase-60.ts`
**Commit:** d2cbfbd2
**Applied fix:** 两探针 finally 均改为守卫式恢复：新增 `lastKnownServer`（探针最后已观测服务器态，自家每次成功写库后 load-v2 刷新——diagnose 为 loadC，probe 为 observeServer()，浏览器段保存在 waitForResponse 解析后立即观测，断言抛错不丢基准）与 `probeWrote`（是否真实写过库）双基准。恢复前先 load-v2 深比对当前态 === lastKnownServer：漂移（疑似 kmc pipeline/画布客户端并发写）→ 放弃恢复、并发写入被保留、note FAIL + exit 1 交人工对账（firstDiff 输出首个差异点）；核对 load-v2 失败 → 不盲写回存；无漂移且探针写过库 → 原图回存 + 轮询深比对（原有语义）；探针未写库（save 失败/折叠守卫/前置失败）→ 跳过回存（旧版此处无条件盲写 loadA，本身即对 ：10588 的额外扰动+广播）。净足迹=0 PASS 语义仅在无漂移时保留。verify 门新增 S8 静态锁。

### CR-02: `requestNodeScore` returns the response envelope, not the score object — AI score UI shows "总分 undefined"

**Files modified:** `packages/infinite-canvas/src/services/canvasApi.ts`, `scripts/verify-phase-60.ts`
**Commit:** e15908fc（+ S9 锚文本对齐修正 14a75dd7）
**Applied fix:** 移除 `apiCall<any>`，按信封实形 `{ code, data?: { score? }, msg? }` 泛型化，返回 `json.data?.score`（导出 `NodeScoreResult`，与服务端 `AIScoreResult` 同形）。apiCall 对 code 404（资产/分镜不存在）原样透传信封不抛错——此路径统一转 `ApiError('business')` 交调用方 catch → toast「评分失败」。调用方核验：全仓 grep 唯一调用方 CanvasContextMenu.tsx L174-178 零改动适配（score.overall 有值，aiScore 写入为 normalized 对象，VariantWall 的 aiScore.overall/dimensions 消费面恢复正常）；src/runtime/canvas-client.mjs 为独立运行时客户端（自有 _request），不受影响。verify 门新增 S9 静态锁。

### WR-01: diagnose-60-roundtrip layer-1 diff runs even after its own save-v2 failed — vacuous PASS lines and misattribution

**Files modified:** `scripts/diagnose-60-roundtrip.ts`, `scripts/verify-phase-60.ts`
**Commit:** 838ff50b
**Applied fix:** load-v2(C)/层1 diff/归因器/层1 锚点抽检整块嵌套进 save-v2 成功分支；save 失败 → note FAIL（含「层1/层1锚点显式 SKIP」理由行），不再对未落库的服务器态空跑（旧版会 vacuous PASS「服务端重组稳定性 PASS」或把并发写 spuriously FAIL 误归因「服务端漂移」）。loadC 失败分支同样 SKIP 层1 并注明恢复守卫基准停留 loadA（保守中止）。层2/3 既有 `serverLayerAvailable` 门控不变一并跳过；exit 契约不变（strict → exit 1，非 strict 如实打印 FAIL 行）。实跑 `npx tsx scripts/diagnose-60-roundtrip.ts --strict` exit 0 全绿。verify 门新增 S10 静态锁。

### WR-02: Mock health endpoint attributes ALL save-v2 calls to scope 1/1 — cross-scope eventCount contamination diverges from real backend semantics

**Files modified:** `packages/infinite-canvas/test/e2e/mock-backend/server.mjs`, `scripts/verify-phase-60.ts`
**Commit:** 894f6122
**Applied fix:** 新增 `state.scopeEvents = new Map()`（key `${projectId}:${episodesId}` → {eventCount, lastEventId, lastEventAt}），save-v2 handler 按请求 scope 归账递增（pid/eid 缺失不计数），reset() 清零；health 端点逐 key 各吐各的 eventCount，零事件 scope 不出现在 scopes（贴真形）。mock/real 分歧保持文档化：真实 health.ts 不吐 eventCount（FLAG-2，S3 双向锁锁死，本修未触碰真侧）。scratch port 9899 实测：空态 scopes=[]；1/1×2 + 7/3×1 保存后 scopes 恰两键（eventCount 2/1）、totalEvents=3——跨 scope 污染消除。verify 门新增 S11 静态锁。

## Skipped Issues

None — 全部 4 条 in-scope findings 修复。Info 5 条（IN-01..IN-05）按 scope 指令（CRITICAL+WARNING only）不在本轮范围。

## Verification

| 门 | 结果 |
|----|------|
| `npm run verify:phase-60` | **exit 0，20/20 PASS**（原 16 + 新增 S8-S11 四锁），WARN=0，F 段 3 变异样本 0/3 unexpectedly passed |
| 根 `npx tsc --noEmit` | exit 0 干净（verify B 段） |
| `packages/infinite-canvas` `npm run build` | exit 0（verify B 段，dist 纪律） |
| phase60-panel-persist.mjs e2e | 4/4 passed（verify B 段） |
| `npx tsx scripts/diagnose-60-roundtrip.ts --strict`（真机 :10588） | exit 0：三层 id 零漂移 + 层2 锚点抽检 PASS + 恢复全等（净足迹=0，经新守卫路径） |
| `node test/e2e/probe-60-real.mjs`（真机 :10588，探针本体被改后必跑） | **13/13 全 PASS，exit 0**：协议段双断言 + 浏览器段五断言（面板保持/标题/锚/静默/零 reload）+ 恢复（净足迹=0，经新守卫路径） |
| mock health per-scope 行为（scratch 9899） | 空态 scopes=[]；1/1:2 + 7/3:1 独立计数，totalEvents=3 |

红线遵守：真实 `src/routes/canvas/v2/health.ts` 零触碰（S3 锁绿）；STATE.md/ROADMAP.md/REVIEW.md 零触碰；预存 dirty 文件（yarn.lock/refs png/未跟踪探针脚本）零触碰零暂存。

---

_Fixed: 2026-08-24T09:25:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
