# Phase 59 — UI Review

**Audited:** 2026-08-24
**Baseline:** 59-UI-SPEC.md (approved 2026-08-23; zero-new-visual-vocabulary contract)
**Screenshots:** partially captured — production portal root only (`.planning/ui-reviews/59-portal-root-desktop.png`); the phase surface (canvas stale badges / popover) requires live project state not reachable without driving writes on the production instance. The captured image could not be visually inspected in-session (tool offloaded it to CDN). **Effective audit: code-only**, with git-diff verification that locked surfaces are byte-untouched.

**Registry audit:** N/A — `components.json` absent (shadcn gate closed in phase 58; UI-SPEC declares not applicable). No Registry Safety flags.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | All 10 locked copy rows verbatim-conformant, but WR-04 review fix added 3 user-facing strings outside the spec's "exhaustive, exception: none" contract, with an internal label/toast inconsistency |
| 2. Visuals | 4/4 | Locked trio (badge/pulse/StaleSection) verified zero-change via git; the one new visual (disabled button state) follows the existing pending pattern exactly |
| 3. Color | 4/4 | Zero new stale-color usage in phase diff; all 4 reserved-list treatments match declared tokens (#F0A52E family); informational: spec's "complete list" omits 9 pre-existing consumers |
| 4. Typography | 4/4 | Stale surface uses exactly 400+600 weights, 11/12px sizes as declared; new WR-04 label inherits existing button style, adds nothing |
| 5. Spacing | 4/4 | All declared scale values (4/8/12/16) + locked exceptions (marginTop 6, marginBottom 4, badge geometry) verified verbatim; no new spacing values |
| 6. Experience Design | 3/4 | Pending/disabled/empty/error/guard states all present and §5 strict contract honored; but the deferred SC4 badge-resurrection race makes the phase's own acceptance path timing-nondeterministic, and legacy-graph cascade silently no-ops |

**Overall: 22/24**

---

## Top 3 Priority Fixes

1. **WR-04 copy inconsistency — button label misstates the guard condition** (`EventParamsPopover.tsx:192`) — label reads 「🎲 事件已删除，无法换 seed」 but the actual condition (`evt == null`) covers collapsed/ deleted/ reloaded anchors, and the toast (:76) and title (:185) both say 「事件已被折叠/删除」 — a user whose event is merely folded reads "deleted" and may try to "restore" something that exists. Fix: change the label to 「🎲 事件已被折叠/删除，无法换 seed」 (single phrasing across label/toast/title).
2. **Contract drift: shipped strings + wire shape not in the locked spec** — the UI-SPEC copywriting table claims exhaustiveness ("Exception: none") yet three WR-04 strings shipped, and the CR-02 fix extended the `node:updated` wire beyond the spec's `{node, changedFields?}` shape (adds `projectId`/`episodesId`, `_stale.ts:114-122`). Both changes are justified bugfixes, but the next audit or contract consumer will flag shipped code as a violation. Fix: append a "review-fix addenda" section to 59-UI-SPEC.md recording the three strings and the scope-field extension (5-minute doc fix; no code change).
3. **SC4 badge-resurrection race (deferred known issue, user-visible)** — `rerunStaleChain` saves with stale on the wire, then `graph:saved` self-echo reload can land *after* running/success cleared stale locally, resurrecting the badge on freshly-rerun nodes until the next clear/save (59-04 Known Issues #1; e2e needed a `suppressGraphSaved` mock knob to pass deterministically — the shipped behavior is timing-nondeterministic on the phase's own acceptance path). Fix: suppress self-echo (echo the save's origin clientId and skip own reload) or strip `stale` from persisted wire for chain members at orchestrate success.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

Verified verbatim against the UI-SPEC copy table (all locked rows PASS):

| Spec row | Implementation | Status |
|---|---|---|
| 「🔄 重跑下游」/「重跑提交中…」 | `NodeDetailPanel.tsx:1161` | PASS |
| `<title>重跑下游</title>` badge tooltip | `NodeBadges.tsx:86` | PASS |
| 「过期状态」 SectionLabel | `NodeDetailPanel.tsx:1149` | PASS |
| 「⚠ 已过期（上游变更触发）」 | `NodeDetailPanel.tsx:1151` | PASS |
| 「触发：{triggerLabel} · 自 {since}」 meta line | `NodeDetailPanel.tsx:1152` | PASS |
| Empty: StaleSection `null` | `NodeDetailPanel.tsx:1144` | PASS |
| 「无 stale 下游可重跑」 info toast | `useStaleRerun.ts:52` | PASS |
| Guards ×3 (画布尚未加载/缺少项目上下文/编排进行中) | `useStaleRerun.ts:31,36,41` | PASS |
| 「已提交重跑下游({n} 个节点)」 / 「重跑下游失败: {message}」 | `useStaleRerun.ts:62,64` | PASS |
| 「重生成提交失败: {message}」 | `NodeDetailPanel.tsx:740` | PASS |

**Findings (WARNING both):**
- **W1-1: Three post-spec user-facing strings** (`EventParamsPopover.tsx:76,185,192`, commit `329d478a` WR-04, after all four plan summaries): toast 「事件已被折叠/删除，无法换 seed 重跑」, title tooltip same, button label 「🎲 事件已删除，无法换 seed」. The spec's do-not-invent rule says the locked vocabulary "is exhaustive. (Exception: none.)" The strings are well-written (cause + consequence) and the guard they serve is a genuine UX improvement — but the contract was not amended, so shipped code now deviates from the approved spec.
- **W1-2: Internal inconsistency within the new set** — label says 「已删除」 where toast/title say 「已被折叠/删除」; the guard fires for all three causes (fold/delete/reload). See Priority Fix 1.

Pre-existing strings on adjacent surfaces (「已提交重生成」 :738, 「已提交换 seed 重跑（seed {n}）」 EventParamsPopover:114, 「未找到该事件的产出资产，无法重跑」 :93) predate the phase — not cascade additions, correctly outside the contract table.

### Pillar 2: Visuals (4/4)

- **Locked surfaces byte-untouched:** `git log a031f43e..HEAD` on `NodeBadges.tsx`, `useStale.ts`, `useStaleRerun.ts`, `catppuccin.ts` → zero commits. The entire client change is 5 files (+124/−12), none of them badge/pulse/panel render code.
- **Stale triangle** (`NodeBadges.tsx:83-88`): SVG 14×14 `viewBox 0 0 14 14`, polygon `0,14 14,14 0,0`, fill `v3theme.signal.stale`, absolute `left/bottom: off`, `cursor: pointer`, `stopPropagation()` before `rerunStaleChain` (地雷 #8), `aria-label="stale"` + `<title>` (canonical e2e hook intact). LOD gate `if (lod === 0) return null` (:24) — panorama hides badges per §1.
- **Verdict band coexistence** (:101): `left: off + badge.tri + 2`, `gap: 4` — locked 56-03 geometry preserved; no layout jump when cascade arrives.
- **The one new visual element** (WR-04 disabled state, `EventParamsPopover.tsx:184-190`): native `disabled` + `opacity 0.6` + `cursor: default` — exactly the existing pending-state pattern in the same style object. Visual vocabulary consistent; nothing invented.
- Minor, `needs_human_review: true`: native `title` tooltip on a `disabled` button — hover-tooltips on disabled controls are browser-dependent (reliable in Firefox/Chrome-desktop recent versions, historically flaky). Verify in the target browser; if unreliable, move the explanation into a visible hint line instead of `title`.

### Pillar 3: Color (4/4)

- **Token values match spec identification** (`catppuccin.ts:76,79`): `signal.stale #F0A52E`, `staleWeak rgba(240,165,46,0.5)`, `running #E0B665`, `rejected #DD6A82`.
- **All 4 reserved-list treatments verified:** triangle fill (`NodeBadges.tsx:87`); pulse drop-shadow `rgba(240,165,46,0.9)` (`FlowCanvas.tsx:1427-1431`); StaleSection `border 1px + text color + background rgba(240,165,46,0.10)` (`NodeDetailPanel.tsx:1150`); rerun button `border 1px + text color, background transparent` (:1159).
- **Zero new stale/accent usage in the phase diff** — the phase added no `signal.stale`, no `rgba(240,165,46,…)`, no `#E0B665` occurrences. Accent is not used on any stale element.
- Hardcoded rgba literals appear only in the two spec-permitted legacy slots (pulse keyframes, StaleSection tint).
- **Informational (spec-doc defect, not implementation):** the spec's "reserved for — complete list (all existing)" omits 9 pre-existing consumer sites: `AssetCardNode.tsx:224,694` (L0 stale border + dashed outline), `canvas/NodeBadgesDefault.tsx:75` (second triangle implementation), `canvas/Legend.tsx:122` (legend swatch), `G15TriagePanel.tsx:23,135,141,166,213` (triage category). All last touched 2026-07-25…08-22 (pre-phase, git-verified). The phase's zero-new-usage obligation is met; the enumeration in the spec is simply incomplete. No score deduction; fix the doc if the list is relied on downstream.

### Pillar 4: Typography (4/4)

- Stale surface weights: exactly **400 + 600** as declared — body/secondary default 400, button `fontWeight: 600` (`NodeDetailPanel.tsx:1159`), SectionLabel `fontWeight: 600` (:1188). No third weight introduced.
- Sizes: body 12px (:1150), secondary/meta 11px (:1152), SectionLabel 11px (:1188) with `uppercase + letterSpacing 0.05em` — all match.
- New WR-04 label inherits `rerollBtnStyle` (12px/600 UI font, `EventParamsPopover.tsx:233-236`) — no new size/weight/font.
- Trigger fallback `triggerAssetId.slice(-8)` renders in the secondary line in UI font (mono not introduced) — locked behavior confirmed (:1145-1152).
- Spec-doc nit: the typography table claims Label line-height 1.4, but `SectionLabel` sets no `lineHeight` (inherits). Pre-existing locked surface, unchanged per mandate — documentation inaccuracy only.

### Pillar 5: Spacing (4/4)

- Declared scale verified in place: box `padding: '8px 12px'` (sm vertical / md horizontal) + `borderRadius: 8` (:1150); button `padding: '4px 12px'` (xs/md) (:1159); SectionLabel rhythm `marginTop: 16, marginBottom: 8` (lg/sm) (:1188); verdict band `gap: 4` (xs).
- Locked exceptions honored verbatim: button `marginTop: 6, marginBottom: 4` (:1159); badge geometry `tri 14 / dot 10 / offset −6` untouched (`V3_NODE_SIZES.badge`, no phase commits).
- Phase introduced zero new spacing values; the WR-04 disabled state reuses the existing style object untouched.
- All values on the audited surface are multiples of 4 except the two declared locked exceptions (6, and the −6 corner offset) — exactly as the spec's exception clause requires.

### Pillar 6: Experience Design (3/4)

**State coverage — all present:**
- Pending: reroll 「重跑中…」+disabled+opacity (`EventParamsPopover.tsx:182-192`); StaleSection 「重跑提交中…」+disabled (:1157-1161); regen `submitting` (`NodeDetailPanel.tsx:724-744`).
- **Disabled-state coverage improved by WR-04**: broken event anchor (`evt == null`) now disables the button with an explanatory tooltip + defensive early-return double-insurance (:75-78) — previously this path silently submitted a seed-only recipe.
- Empty: StaleSection `null`; info toast for empty chain.
- Error: 4 error/warning toast surfaces verbatim; server-side engine failure → existing failed「!」badge + stale retained (52-01 red line preserved — `node:updated` registered as an independent handler, never routed into `normalizeSocketNodeState`, `useCanvasSocket.ts:246-263`).
- Guards: all six (no-graph / no-context / orchestrate-running / no-stale-downstream / missing-event / no-output-asset) present.

**§5 strict interaction contract — honored:** the `onNodeUpdated` handler (`FlowCanvas.tsx:379-404`) does shape validation (scope + `since` number + `triggerAssetId` string) with pure silent returns — zero store writes, zero toasts, zero selection/panel changes on invalid or non-stale payloads. Verified by reading the handler; also asserted by verify-phase-59 S5.

**SC3 structural guarantee:** `regenSource` confined to exactly two emitters (`NodeDetailPanel.tsx:734`, `EventParamsPopover.tsx:110`); `CanvasContextMenu.tsx` grep = 0; orchestrate client path carries no channel.

**Selector contract (§8):** phase59 e2e uses only pre-existing hooks (`svg[aria-label="stale"]`, `stale-rerun-btn`, `detail-panel`, `getGraph()`); zero new product testids (phase diff adds none).

**Findings (deductions):**
- **W6-1 (WARNING): SC4 badge-resurrection race, deferred but user-visible.** The phase's own acceptance flow (rerun → success → badge clears) is timing-nondeterministic in the shipped product: the e2e only passes deterministically with a mock-only `suppressGraphSaved` knob (59-04 Deviation #1), which is direct evidence the real UI can resurrect stale badges after a successful rerun. See Priority Fix 3.
- **W6-2 (WARNING, low impact): legacy-graph cascade silently no-ops.** Graphs containing `phase`-type V2 nodes throw inside `markStaleAndBroadcast` → caught → `console.error` only; task reports success, zero stale, zero user feedback (59-04 Known Issues #2). Mitigating: the same graphs cannot load in the V3 client (same migrate function), so the trigger surface is practically unreachable; deferred to data governance.
- **Informational — two spec deviations with sound engineering justification:** (a) CR-02 extended the `node:updated` wire with `projectId`/`episodesId` scope fields (`_stale.ts:114-122` + `FlowCanvas.tsx` guard), beyond the spec's "aligned to the existing v2/nodes.ts shape" — fixes real cross-episode cross-talk; (b) the handler consumes only `triggerAssetId` and relies on local recompute via `triggerStaleCascade` rather than merging the server node row into the store first — convergent by construction (same pure function both sides), consistent with the spec's idempotence argument, but it is the lighter half of the Option A description. Neither harms UX; both should ride along with the Priority Fix 2 doc amendment.

---

## Files Audited

**Planning/contract:** `.planning/phases/59-narrow-trigger-stale-cascade/` — 59-UI-SPEC.md, 59-CONTEXT.md, 59-01…04-PLAN.md, 59-01…04-SUMMARY.md

**Implementation (phase-touched, client):**
- `packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx` (only visible-behavior change)
- `packages/infinite-canvas/src/components/FlowCanvas.tsx` (onNodeUpdated handler + cv-stale-pulse keyframes)
- `packages/infinite-canvas/src/hooks/useCanvasSocket.ts` (subscription trio)
- `packages/infinite-canvas/src/services/canvasApi.ts` (regenSource type)
- `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx` (regenSource emission + StaleSection/SectionLabel audit)

**Locked surfaces (verified untouched + spec-conformance read):**
- `packages/infinite-canvas/src/components/badges/NodeBadges.tsx`
- `packages/infinite-canvas/src/hooks/useStale.ts` (MAX_PULSE 8 / PULSE_WINDOW_MS 1200 confirmed)
- `packages/infinite-canvas/src/hooks/useStaleRerun.ts`
- `packages/infinite-canvas/src/theme/catppuccin.ts`

**Color provenance checks (pre-existing consumers):** `nodes/AssetCardNode.tsx`, `canvas/NodeBadgesDefault.tsx`, `canvas/Legend.tsx`, `g15/G15TriagePanel.tsx`

**Server seam (wire contract):** `src/routes/canvas/_stale.ts`, `src/routes/canvas/execute.ts`

**Tests (selector contract):** `test/e2e/tests/phase59-stale-cascade.mjs`, `test/e2e/tests/phase52-reroll.mjs` (additive assertion only)

**Git range audited:** `a031f43e..HEAD` (full phase, incl. post-summary review-fix commits `1a36dc61`…`8fa7718c`)
