# Phase 60 — UI Review

**Audited:** 2026-08-24
**Baseline:** 60-UI-SPEC.md (approved design contract — zero-new-visual-vocabulary phase)
**Screenshots:** captured (2 passive entry captures from deployed :10588; see note below)
**Audit mode:** code-diff audit + e2e/probe evidence review (Playwright-MCP unavailable; no dev server on 3000/5173/8080 — the deployed production app on :10588 was captured GET-only, no interaction, to avoid production writes)

**Screenshot note:** desktop (1440x900) and mobile (375x812) entry captures saved to `.planning/ui-reviews/60-20260824-093509/` (git-ignored via `.planning/ui-reviews/.gitignore`). The phase surface (panel stay-mounted, toast trigger matrix) is behavioral and not statically visible on an entry page; the harness uploaded the PNGs to CDN instead of rendering inline, so human spot-check of the two captures is advised but not blocking. All pillar findings below are evidence-based from the full phase git diff (`5550a770^..3ba9549a`, including post-60-05 code-review fix commits).

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | All contract strings verbatim, zero new user-facing strings on designed surface; but CR-02 added a user-surfacing fallback literal that can render 「评分失败: 评分失败」 duplicated |
| 2. Visuals | 4/4 | NodeDetailPanel.tsx zero diff across entire phase; FlowCanvas styling untouched; testid contract intact; stay-mounted verified by e2e + real-machine probe |
| 3. Color | 4/4 | 0 added color literals, 0 token changes in phase src diff; accent reserved list untouched |
| 4. Typography | 4/4 | 0 font size/weight changes in phase diff; locked 12/11px + 400/600 untouched |
| 5. Spacing | 4/4 | 0 padding/margin/border changes; locked geometry (480/400px, 6px handle, 48px topbar) untouched |
| 6. Experience Design | 3/4 | Toast matrix + honest collapse + silence contract all implemented exactly; but UI-SPEC §1 D-07 claims "selection ring survives reload" — the ring is structurally cleared (store anchor only) |

**Overall: 22/24**

---

## Top 3 Priority Fixes

1. **D-07 selection ring does not survive other-client reload (spec-implementation divergence)** — after an other-client save triggers reload, the detail panel stays open (correct) but the user's visible selection ring vanishes, leaving an asymmetric state; UI-SPEC §1 explicitly states "node selection (selection ring, `selectedNode`) survives reload by the same id re-anchor" — re-sync RF selection from `store.selectedNode` after `setGraph` re-anchor (e.g. an effect applying `selectedNode.id` into the RF instance), or amend the UI-SPEC wording to "store anchor survives; ring resets" so the contract matches reality.
2. **「评分失败」 fallback duplication path** — `canvasApi.ts:626` throws `ApiError(json.msg || '评分失败', …)` and the sole caller renders `评分失败: ${err.message}` (CanvasContextMenu.tsx:180); when the server envelope lacks `msg` the user sees the duplicated string 「评分失败: 评分失败」 — give the fallback a distinct message (e.g. `'服务未返回错误信息'`) or strip the prefix in the caller when message equals the fallback.
3. **CR-02 AI-score surface changed user-visibly inside phase 60 with no UI-contract coverage + human UAT still pending** — commit e15908fc fixed a real pre-existing bug (score toast showed 「总分 undefined」) but the AI-score surface (CanvasContextMenu score toasts, VariantWall `aiScore` rendering) is outside 60-UI-SPEC's declared surface and vocabulary table and received no UI checker pass — add a retroactive note to 60-UI-SPEC (or carry the score surface into the next UI audit), and complete the one pending human UAT item (panelWidth/scroll continuity, 60-HUMAN-UAT.md `status: partial`).

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**Contract compliance (verified verbatim against UI-SPEC §Copywriting):**
- Other-client reload toast 「Pipeline 同步了新数据,正在刷新画布…」 — `FlowCanvas.tsx:351`, byte-identical to contract ✓
- Health-poll fallback toast 「检测到 pipeline 远端更新,正在刷新画布…」 — `FlowCanvas.tsx:830`, verbatim, path untouched (FLAG-2 respected) ✓
- Save button states 「保存」/「保存中…」 — `FlowCanvas.tsx:1148`, unchanged ✓
- Save error toast `err?.message || '保存失败'` — `FlowCanvas.tsx:700`, unchanged ✓
- Anchor-loss console.warn `[panel-persist] 锚点丢失: {id} 在重载图中未找到,面板已收起` — `canvasStore.ts:438`, matches UI-SPEC §2 recommended default string exactly; dev-console only ✓
- No new empty-state, no confirm dialog, no new user-facing strings on the designed surface ✓ (full phase src diff reviewed — the only added string literals in user-reachable code are comments and the CR-02 fallback below)

**Findings:**
- **WARNING (W1-1):** New fallback literal 「评分失败」 at `canvasApi.ts:626` (commit e15908fc, CR-02 fix — post-60-05 code-review loop). Sole caller `CanvasContextMenu.tsx:180` renders `评分失败: ${err.message}`, so a server envelope without `msg` produces the duplicated user-facing string 「评分失败: 评分失败」. Low probability (real 404s carry specific msgs per review verification) but it is a new user-surfacing string the UI-SPEC's exhaustive vocabulary table does not contain — the spec's do-not-invent rule was technically breached by the review loop, not by the executor's planned surface.
- **Note (W1-2):** Same CR-02 commit changes how existing copy renders (「AI 评分完成: 总分 ${score.overall}」 previously showed 「总分 undefined」 due to the envelope bug; now shows a real number). This restores intended behavior of pre-existing copy — beneficial — but it is a user-visible behavioral change landed without UI-SPEC coverage (see Fix 3).

### Pillar 2: Visuals (4/4)

- **Locked surface untouched:** `git diff 5550a770^..3ba9549a -- packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx` = **0 lines**. Panel geometry (480px default/400px min), tabs, tokens, `data-testid="detail-panel"` (NodeDetailPanel.tsx:103) all byte-identical.
- **FlowCanvas diff is exactly two hunks:** the `getClientTabId` import (L53) and the `onGraphSaved` block (L336-352). No styling, no new components, no new icons or badges — the zero-new-visual-vocabulary scope discipline held.
- **Stay-mounted (the acceptance surface):** PANEL-01 machine evidence — e2e Test 1 (panel visible + same title + `getDetailNode().id` unchanged + DOM-continuation marker + zero load-v2) and real-machine probe (panel count=1, title "p04_character_design" unchanged, load-v2 count 2→2) both green per 60-04/60-05 records.
- **No intermediate null/flash:** `setGraph` is one synchronous `set()` call (`canvasStore.ts:441-458`); panel render sites not gated on loading (verified statically in 60-01 Prong 2). Atomic by construction ✓.
- **Selector/testid contract:** phase60 e2e references only existing testids (`detail-panel` ×5, `prompt-regenerate` ×2, `prompt-section`, `stale-rerun-btn`) — zero new, per UI-SPEC §7 ✓.
- Cross-reference: the one visual-behavior gap found (selection ring loss on other-client reload) is scored under Pillar 6 (it is an interaction-state divergence, not a styling change).

### Pillar 3: Color (4/4)

- Added color literals in the entire phase src diff (`packages/infinite-canvas/src` + `src/routes/canvas/v2/save-v2.ts`): **0** (grep for `#hex|rgb(|rgba(` over `^+` lines).
- Added `theme.*` / `v3theme.*` token usage: **0** — the phase consumed no color at all.
- Accent (`#E0B665`) reserved list untouched; stale trio (`#F0A52E`) vocabulary untouched; 60/30/10 distribution unchanged by construction (no style edits exist to shift it).
- `main.tsx` bridge additions are testMode-gated read accessors — zero render surface.

### Pillar 4: Typography (4/4)

- Added font size/weight/letterSpacing/lineHeight in phase src diff: **0** (grep over `^+` lines).
- Locked table (12px/400 body, 11px/400 secondary, 11px/600 label, 12px/600 button; exactly 2 weights) is entirely inside NodeDetailPanel/locked surfaces, which have a zero-line diff — contract held by construction.

### Pillar 5: Spacing (4/4)

- Added padding/margin/border/gap in phase src diff: **0** (grep over `^+` lines).
- Locked legacy geometry (panel 480/400px, resize handle 6px, topbar 48px) untouched — NodeDetailPanel.tsx and the FlowCanvas layout regions have zero styling diff.
- The only geometry-adjacent code touched is the `onGraphSaved` callback — no layout involvement.

### Pillar 6: Experience Design (3/4)

**Contract obligations delivered (verified in code + machine evidence):**
- **Toast trigger matrix (§3/D-05):** `FlowCanvas.tsx:333-352` — scope guard first, then unconditional baseline reset (L343, FLAG-1 order: reset line precedes the early-return line, locked by verify gate S2), then `selfEcho` silent early-return (L348-350, no toast, no reload), then other-client toast+reload (L351-352). Self-save silence is proven at three levels: e2e toast-spy empty + load-v2 count unchanged; real-machine probe identical; health baseline reset prevents the ≤30s spurious fallback toast.
- **Honest collapse (§2/D-03):** `canvasStore.ts:436-440` warn loop with non-null→null transition guard (spam-safe); re-anchor semantics L452-457 byte-identical to pre-phase; no fuzzy matching, no placeholder. E2e Test 3 asserts panel count 0 + warn captured.
- **D-07 store-level symmetry:** `selectedNode` and `detailNode` re-anchored by id in adjacent lines; both anchors covered by the warn loop; symmetric-collapse vitest locked.
- **D-08 no-revival:** e2e Test 4 sampling window (2500ms, all-canvas stale count === 0) green; knob retired so the real echo path is exercised.
- **State coverage:** loading gate first-load-only (static Prong 2 finding); save-failure toast intact; no destructive action added (none permitted).

**Findings:**
- **WARNING (W6-1, = Fix 1):** UI-SPEC §1 states D-07 as "node selection (selection ring, `selectedNode`) survives reload by the same id re-anchor." Implementation: only the store anchor survives. `selectedNodeIds` is a one-way RF→store mirror (`FlowCanvas.tsx:210`, set solely by `onSelectionChange` L622-625); when `setGraph` swaps the node array, React Flow fires an empty-selection callback and the visible ring is cleared — no re-sync effect exists. The implementation team documented this themselves (60-04-SUMMARY Deviation #3: mirror "structurally always lost … existing design") and switched the e2e assertion to the store anchor. User-visible consequence: other-client reload leaves panel-open-but-ring-gone — an asymmetric visual state that contradicts the spec sentence. Pre-existing mechanism, but phase 60's contract explicitly promised the ring, and the panel-survives fix makes the asymmetry newly prominent.
- **Note (N6-1):** `setGraph(null)` early-return path (`canvasStore.ts:425-428`) clears graph/nodes but neither clears nor warns on `selectedNode`/`detailNode` — a panel could render stale anchors against an empty model with no honest collapse. Unreachable today (repo-wide grep: zero callers pass `null`), dead-path note only; worth a guard if a future caller appears.
- **Note (N6-2):** Human UAT for panelWidth/scroll continuity (the one Manual-Only item) is still `pending` in 60-HUMAN-UAT.md (`status: partial`). Machine-face evidence (±2px width, tab fontWeight, DOM continuation marker) is green; the eye-check remains open per phase-59 deferral precedent.
- **Registry audit:** `components.json` absent — shadcn never initialized (matches UI-SPEC Design System gate outcome 2026-08-24). Registry safety audit: not applicable, skipped.

---

## Files Audited

Phase diff (`git diff 5550a770^..3ba9549a`, 10 commits + 5 code-review fix commits):
- `packages/infinite-canvas/src/components/FlowCanvas.tsx` (onGraphSaved block, health-poll, selection mirror, save button, save error toast)
- `packages/infinite-canvas/src/store/canvasStore.ts` (setGraph warn loop + re-anchor semantics)
- `packages/infinite-canvas/src/services/clientTabId.ts` (new, identity singleton)
- `packages/infinite-canvas/src/services/canvasApi.ts` (savedBy attachment; CR-02 requestNodeScore)
- `packages/infinite-canvas/src/hooks/useCanvasSocket.ts` (payload type)
- `packages/infinite-canvas/src/main.tsx` (testMode bridge accessors)
- `packages/infinite-canvas/src/components/CanvasContextMenu.tsx` (score toast consumer, read-only)
- `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx` (zero-diff verification)
- `src/routes/canvas/v2/save-v2.ts` (savedBy zod + conditional echo)
- Test infra (no user-visible surface): `server.mjs`, `phase59-stale-cascade.mjs`, `phase60-panel-persist.mjs`, `probe-60-real.mjs`, `reloadAnchor.test.ts`, `diagnose-60-roundtrip.ts`, `verify-phase-60.ts`
- Planning: 60-CONTEXT.md, 60-UI-SPEC.md, 60-01..05 PLAN/SUMMARY, 60-REVIEW.md, 60-REVIEW-FIX.md, 60-HUMAN-UAT.md
- Screenshots: `.planning/ui-reviews/60-20260824-093509/` (desktop-entry.png, mobile-entry.png — git-ignored)
