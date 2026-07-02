---
slug: iteration-engine-frontend
status: in_progress
created: 2026-07-02
---

# Iteration Engine — Frontend Integration

## Goal

Wire the backend Iteration Engine API (`/api/v1/iteration/*`, shipped quick-260702-rg2)
into the infinite canvas so users can diagnose→execute→confirm iterations from the UI.

## Backend Contract (verified)

All routes mounted at `/api/v1/iteration` and **require `workdir`** (zod-validated
to be under `/data/workspace`). Standard `{ code, data, message }` envelope.

| Endpoint                          | Method | Body / Query                                  | Returns `data`                       |
|-----------------------------------|--------|-----------------------------------------------|--------------------------------------|
| `/plan`                           | POST   | `{ workdir, projectId, episodesId?, apiBase?}`| `{ status: 'ok', plan: IterationPlan }` |
| `/execute`                        | POST   | `{ workdir, planId, projectId, episodesId? }` | `{ status: 'ok', result: IterationResult }` |
| `/confirm`                        | POST   | `{ workdir, branchId, projectId, episodesId?}`| `{ status: 'ok' }`                   |
| `/discard`                        | POST   | `{ workdir, branchId, reason?, projectId, ...}`| `{ status: 'ok' }`                  |
| `/approve-adjustment`             | POST   | `{ workdir, planId }`                         | `{ status: 'ok', planId }`           |
| `/status/:planId`                 | GET    | `?workdir=`                                   | status object                        |
| `/plans`                          | GET    | `?workdir=&projectId=&episodesId=`            | `IterationPlan[]` (capped 1000)      |

**Spec deviation:** original task spec omitted `workdir` on `approveAdjustment`
and `getIterationStatus`. Both require it — added to signatures.

## Files

### New
- `packages/infinite-canvas/src/components/IterationPanel.tsx` — full panel

### Modified
- `packages/infinite-canvas/src/services/canvasApi.ts` — types + 7 API fns
- `packages/infinite-canvas/src/store/canvasStore.ts` — IterationState + actions
- `packages/infinite-canvas/src/components/FlowCanvas.tsx` — toolbar button + overlay
- `packages/infinite-canvas/src/components/NodeDetailPanel.tsx` — iteration tab

## Implementation Plan

1. canvasApi.ts: Append `// ─── Iteration Engine ───` block. Export 4 types and
   7 functions. Each POST goes through `apiCall` helper (auto-retry/timeout);
   the two GETs use `fetch` directly (matching existing FeedbackPanel pattern).
2. canvasStore.ts: Add `IterationState` interface (idle/planning/plan_ready/
   executing/done/error), `INITIAL_ITERATION` const, plus 5 actions:
   `setIterationPlan`, `updateIterationProgress`, `resetIteration`,
   `pushIterationHistory` (for tab display), `setAdjustmentApproved`.
3. IterationPanel.tsx: 5 sub-sections per spec — diagnosis card with color
   coding, action list, pipeline adjustment approval, execution progress,
   result review. Uses catppuccin tokens (green/peach/red), no bare colors.
4. FlowCanvas.tsx: Add ToolbarButton after 一键成片, plus modal-style overlay
   when `iteration.status !== 'idle'`. handleIterate calls createIterationPlan
   then sets status to plan_ready.
5. NodeDetailPanel.tsx: Add `'detail' | 'feedback' | 'iteration'` to tab type,
   third TabButton, render IterationPanel filtered to current node's history.

## Verification

- `npx tsc --noEmit` passes
- `npm run build` passes
- Toolbar shows 🔄 迭代 button
- NodeDetailPanel shows third tab
- UI gracefully displays API errors (workdir missing etc.)
