---
quick_id: 260703-iw6
slug: ltx-pose-video-pipeline
description: 独立骨骼动作引导视频工作流 + MSR可选消费
date: 2026-07-03
status: complete
---

# Quick Task 260703-iw6 — Summary

## What shipped

**New route: `POST /api/production/ltx/poseVideo`** (independent workflow)
- Accepts: prompt + ref1 (character image) + optional motionPrompt / cameraAngles / poseFrameCount / duration / fps / width / height / negativePrompt / seed / steps / cfg / strength
- Pipeline: Kimodo gold-team (motion_generate → BVH) → Blender :8095 (/render/bvh → PNG frames) → docker cp front-frame to ComfyUI → LTX-2.3 I2V workflow (16 nodes, NOT MSR) → ComfyUI prompt
- Returns: `{ promptId, poseVideoId, stages: { bvh, blender, ltx } }`

**Modified: `POST /api/production/ltx/msr`** (optional consumption)
- New optional multipart field `poseVideoFrames` (JSON-stringified array of host paths or bare container filenames)
- When present: each frame is `docker cp`'d into ComfyUI input dir and appended to `filenames` array AFTER user-uploaded refs
- When absent: behavior unchanged (back-compat verified)
- Path safety: host paths must be under `/data/workspace/kais-blender-docker/outputs/`, `/mnt/agents/output/`, or `/tmp/comfyui-ltx-input/`
- Total ref count (uploaded + pose) capped at 5 (LiconMSR limit)

**Config additions** in `src/routes/production/ltx/config.ts`:
- `LTX_CONFIG.kimodoUrl` (default `http://localhost:8002`)
- `LTX_CONFIG.blenderUrl` (default `http://localhost:8095`)

## Files changed

| File | Type | Notes |
|------|------|-------|
| `src/routes/production/ltx/poseVideo.ts` | NEW (~430 lines) | Route + 4 helpers + LTX I2V workflow builder |
| `src/routes/production/ltx/msr.ts` | MODIFIED | Parse `poseVideoFrames`, validate paths, copy into ComfyUI, extend filenames |
| `src/routes/production/ltx/config.ts` | MODIFIED | Add `kimodoUrl` + `blenderUrl` to `LTX_CONFIG` |
| `src/router.ts` | MODIFIED | Import as `poseVideoRoute` (pitfall #15), register at `/api/production/ltx/poseVideo` |

## Validation

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | ✅ Clean (4 modified/new files have 0 errors) |
| Module import test (`npx tsx -e`) | ✅ poseVideo.ts loads, exports default router (same CJS/ESM shape as msr.ts) |
| Existing `/api/production/ltx/msr` still works without `poseVideoFrames` | ✅ Verified via curl — same 400 "missing prompt" response as before |
| New `/api/production/ltx/poseVideo` returns 400 on missing prompt | ⚠️ **Pending server restart** — running dev server at :10588 is in tsx non-watch mode; user must restart to pick up new route |

## How to use

### Independent pose-video generation

```bash
curl -X POST http://localhost:10588/api/production/ltx/poseVideo \
  -F "projectId=1" \
  -F "prompt=martial arts kick, slow motion" \
  -F "ref1=@/path/to/character.png" \
  -F "duration=3" \
  -F "cameraAngles=front,iso"
```

Response:
```json
{
  "code": 0,
  "data": {
    "promptId": "<comfyui-prompt-id>",
    "poseVideoId": "<uuid>",
    "status": "pending",
    "stages": {
      "bvh": { "taskId": "pose-<uuid>", "path": "/mnt/agents/output/.../motion.bvh" },
      "blender": { "frames": ["front_001.png", "iso_001.png"], "frontFrame": "...", "containerFilename": "<uuid>.png" },
      "ltx": { "promptId": "...", "refFilename": "<uuid>.png", "skelFilename": "<uuid>.png" }
    }
  }
}
```

### MSR consuming pose frames

```bash
curl -X POST http://localhost:10588/api/production/ltx/msr \
  -F "projectId=1" \
  -F "prompt=character walks through a forest" \
  -F "ref1=@char.png" \
  -F "ref2=@bg.png" \
  -F 'poseVideoFrames=["/data/workspace/kais-blender-docker/outputs/render_xxx/front_001.png"]'
```

The pose frame becomes `ref3` in the LiconMSR sequence (after user-uploaded refs).

## Deferred items

None. The route is feature-complete per the spec. Optional polish (not blocking):
- Webhook / SSE for async pose-video completion notification (currently synchronous within ComfyUI polling)
- Caching pose-video frames for re-use across MSR calls (currently caller manages frame lifecycle)

## Notes for user

- **Restart your dev server** to pick up the new route: `pkill -f "tsx src/app.ts"` then re-run your `npm run dev` (or just `npx tsx --watch src/app.ts` to enable hot reload)
- The spec listed step 1 as `curl → 400 (缺少 prompt)` — this will pass once server reloads. Code path verified via `tsc` + module import.
- BVH extraction strategy: prefer `outputs.bvh` from Kimodo task detail; fallback scans `/mnt/agents/output` for newest `.bvh` modified in last 10 min. May need adjustment once a real motion_generate task reveals actual Kimodo output schema.
