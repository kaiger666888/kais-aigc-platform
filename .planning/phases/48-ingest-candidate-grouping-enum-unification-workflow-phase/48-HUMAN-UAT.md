---
status: partial
phase: 48-ingest-candidate-grouping-enum-unification-workflow-phase
source: [48-VERIFICATION.md]
started: 2026-08-19T00:00:00+08:00
updated: 2026-08-19T00:00:00+08:00
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live HTTP round-trip: ingest → registry search
expected: On a running kap server, POST /api/v1/pipeline/ingest/images with the fixture manifest payload (scripts/fixtures/phase48-p11-manifest.fixture.json shape) → 200 with grouped result (per-group exactly one isPrimaryView, member assetsId = primary id); duplicate filePath / duplicate shot_id payloads → 400 naming the offender. Then POST /api/v1/assets-registry/search with type=character returns both canonical rows AND legacy 'role' rows (whereIn expansion).
result: [pending]

### 2. Asset-center visual check of a freshly ingested group
expected: In infinite-canvas Asset Library (资产中心), a newly ingested candidate group renders as one primary + variants under the candidate tab; sync-assets (canvas) still surfaces state='active' rows; nothing disappears.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
