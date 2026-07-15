---
phase: 45-text-asset-mapping-ui-completeness
plan: 01
wave: 1
requirements: [TEXT-01]
status: complete
commits:
  - "8acf5950 fix(45-01): lift sidecar .txt cap from 500 → 10K chars"
  - "c7a23cd4 feat(45-01): probe root-level .txt files for script phase dirs"
key-files:
  modified:
    - src/routes/canvas/v2/import-from-dir.ts
---

# 45-01 — Backend Text-Asset Mapping

## What was built

Two surgical edits to `import-from-dir.ts`:

1. **Lifted sidecar cap from 500 → 10_000 chars** (line 512). The
   previous cap silently truncated long script content; 10K fits any
   short-form script while keeping node.data payloads sane.

2. **Added Scan 1.5** between the JSON-manifest scan and the asset-dir
   scan: for each root-level `.txt` file whose name maps (via the
   existing `findPhaseFromFile` prefix table) to a script-typed phase
   (p01..p06, p13), creates a script artifact with description = file
   content. Gated on `def.canvasType === "script"` so media-typed
   phases don't pick up stray .txt files.

New helper `artifactsFromScriptTextFiles(dirPath, filenames, consumedBaselineSet, outputKey)`
— exported with dedupe parameter for future call sites that may need
it. At root scope the dedupe set is empty (different directory from
asset-dir sidecars, no collision possible).

## Notable deviations from PLAN

- The PLAN assumed script `.txt` files would live alongside media files
  in asset directories. In the actual codebase, script `.txt` files
  live at the workdir root (alongside JSON manifests like
  `p03_script.json` + `p03_script.txt`). The new Scan 1.5 reads at root
  level — same loop where JSON manifests are scanned — which matches
  the actual filesystem layout. The `consumedBaselineSet` parameter is
  kept in the helper signature for future-proofing but populated with
  an empty Set at the call site.

## Verification

- `grep "slice(0, 500)"` returns 0; `grep "slice(0, 10000)"` returns 1+
- `grep "artifactsFromScriptTextFiles"` returns 2+ (def + call)
- `grep 'canvasType === "script"'` returns 1 (the gate)
- `npx tsc --noEmit` reports 3 pre-existing errors, 0 new
- `npx tsx scripts/verify-phase-45.ts` TEXT-01 section: 5/5 assertions pass

## Forward enables

- Plan 02's UI panels can now render text from script .txt files that
  previously had no canvas node.
- Plan 03's verifier statically asserts this plan's outputs.
- Phase 47 backfill will find fewer empty-shell script nodes.
