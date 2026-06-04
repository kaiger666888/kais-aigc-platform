---
phase: 01
slug: comfyui-environment-setup
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-04
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | curl + bash scripts (API verification) |
| **Config file** | None needed |
| **Quick run command** | `curl -sf http://localhost:8188/system_stats` |
| **Full suite command** | `bash -c 'curl -sf http://localhost:8188/object_info | python3 -c "import sys,json; n=json.load(sys.stdin); nodes=[\"LatentSync\",\"IPAdapter\",\"InstantID\",\"PhotoMaker\",\"RIFE\"]; [print(f\"{k}: OK\") if any(k.lower() in x.lower() for x in n.keys()) else None for k in nodes]"'` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `curl -sf http://localhost:8188/system_stats`
- **After every plan wave:** Full node registration verification
- **Before `/gsd:verify-work`:** All 5 nodes registered, all models present, ComfyUI health check passes
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 01-01-T01 | 01-01 | 1 | LIPS-01, CHAR-01, FRAM-01 | T-01-01 | Nodes from official repos only | smoke | `ls /data/workspace/comfyui-wan/custom_nodes/ComfyUI-LatentSyncWrapper/` | ⬜ pending |
| 01-02-T01 | 01-02 | 2 | LIPS-01 | — | N/A | smoke | `test -f /data/workspace/comfyui-wan/custom_nodes/ComfyUI-LatentSyncWrapper/checkpoints/latentsync_unet.pt` | ⬜ pending |
| 01-02-T02 | 01-02 | 2 | CHAR-01, FRAM-01 | T-01-04 | Models from official HF repos | smoke | `ls /data/models/comfyui/insightface/models/antelopev2/*.onnx && ls /data/models/comfyui/photomaker/*.bin` | ⬜ pending |
| 01-03-T01 | 01-03 | 3 | All | — | N/A | checkpoint | Human verify target container choice | ⬜ pending |
| 01-03-T02 | 01-03 | 3 | LIPS-01, CHAR-01, FRAM-01 | — | N/A | regression | `curl -sf http://localhost:8188/object_info` node check | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] curl available on host — verified (host has curl)
- [ ] ComfyUI container running — verified during execution
- [ ] Model directories exist under /data/models/comfyui/ — verified during execution

---

## Phase Gate Criteria

All of the following must be TRUE before phase can be marked complete:

1. **Node Registration:** Each of the 5 node groups (LatentSync, IPAdapter, InstantID, PhotoMaker, RIFE) appears in ComfyUI's `/object_info` API response
2. **Model Files:** All model files listed in acceptance criteria exist and have reasonable file sizes (>0 bytes, >expected minimum)
3. **Existing Workflows:** ComfyUI health check passes (`/system_stats` returns 200), existing nodes (Wan2.2 T2V/I2V, FLUX txt2img) still registered
4. **Disk Space:** /data/ partition has >10GB free space after all installations
5. **No Import Errors:** ComfyUI startup log contains no Python import errors for new nodes
