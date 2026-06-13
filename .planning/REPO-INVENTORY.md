# Sibling Repo Inventory — KAIS AIGC Platform Workspace

**Audited:** 2026-06-13 (v1.4 Phase 22 / REPO-01..03)
**Workspace root:** `/data/workspace/`
**Total sibling repos:** 19 (excluding this repo `kais-aigc-platform` and in-tree `docker/hermes-agent`)

## Classification Legend

| State | Definition |
|-------|------------|
| **ACTIVE** | Referenced by `docker-compose.v9.yml` as a build context or required runtime volume. Production stack depends on it. |
| **LEGACY** | Has 2026 activity but NOT in v9 stack. May have been used by v6/v7/v8 or superseded by consolidation. Worth verifying before archiving. |
| **ARCHIVED** | Pre-May 2026 last commit, single-purpose agent consolidated into `kais-gold-team` engine layer during v1.0–v1.3. Candidate for archival. |

## Inventory Table

### ACTIVE — Production Stack (4 repos)

| Repo | Role | Last Commit | Commits | Compose Reference | Used By |
|------|------|-------------|---------|-------------------|---------|
| **kais-gold-team** | Unified execution engine (FastAPI :8002), GPU scheduler, all generation routing | 2026-06-10 | 20 | `context: ../kais-gold-team` | `kais-gold-team` service |
| **kais-review-platform** | AI production pipeline review/approval platform | 2026-05-27 | 277 | `context: ../kais-review-platform` | `kais-review-platform` service (profile=review) |
| **ACE-Step-1.5** | ACE-Step 1.5 music generation — standalone REST sidecar container | 2026-05-18 | 1 (upstream fork) | `context: ${ACESTEP_PROJECT_DIR:-../ACE-Step-1.5}` | `kais-acestep` service (profile=ace) |
| **comfyui-incremental-nodes** | Custom ComfyUI node packages (LTXVideo, TRELLIS2, AIIA, IndexTTS2, facerestore_cf) + setup scripts | 2026-06-05 | 1 | Volume mount `/data/workspace/comfyui-incremental-nodes` | `comfyui-primary` + `comfyui-auxiliary` services |

### LEGACY — Superseded but Recent Activity (4 repos)

| Repo | Role | Last Commit | Commits | Status Notes |
|------|------|-------------|---------|--------------|
| **kais-movie-agent** | Original AI short-drama pipeline orchestrator (14 sub-skills) | 2026-06-05 | 134 | **v1.3 explicitly retired** (CLN-01..03). OpenClaw Agent replaces. Recent commits likely cleanup. Safe to archive after user confirms. |
| **kais-aigc-integration** | Multi-repo integration planning for gold-team + review-platform + movie-agent | 2026-05-21 | 42 | Role absorbed by `kais-aigc-platform` (this repo) in v1.0. Legacy planning docs. |
| **kais-3d-toolkit** | 3D-related helper code (purpose unclear — no README) | 2026-06-04 | 3 | 3D generation now goes through gold-team's `Hunyuan3DEngine` + `build_hunyuan3d_workflow` / `build_trellis_image_to_3d_workflow`. ⚠️ **Needs user verification** before archiving. |
| **kais-jimeng** | OpenClaw skill for Jimeng (Dreamina) text-to-image / image-to-image API | 2026-05-29 | 2 | gold-team has its own `JimengEngine` using HTTP API directly. This repo is an **OpenClaw agent skill**, not a compose dependency. Active in agent layer, not engine layer. |

### ARCHIVED — Pre-May 2026 Single-Purpose Agents (10 repos)

> All consolidated into `kais-gold-team` engine layer or replaced by upstream models during v1.0–v1.3.

| Repo | Role (Historical) | Last Commit | Commits | Superseded By |
|------|-------------------|-------------|---------|---------------|
| **kais-soul-radar** | Unknown (no README) | 2026-05-06 | 9 | ⚠️ Purpose unclear — needs user verification |
| **kais-parallax-scene** | Parallax visual effect generator | 2026-04-30 | 11 | Not in v9 stack |
| **kais-blender-engine** | Blender integration | 2026-04-26 | 5 | Not in v9 stack |
| **kais-slideshow-agent** | Slideshow generation agent | 2026-04-26 | 2 | Not in v9 stack |
| **kais-song-agent** | Song generation agent | 2026-04-26 | 1 | Consolidated into ACE-Step |
| **kais-sound-effects-agent** | Sound effects agent | 2026-04-26 | 3 | Not in v9 stack |
| **kais-TTS-agent** | TTS agent | 2026-04-26 | 2 | Consolidated into gold-team's `TTSTracker` + `TripleTrackTTSEngine` (CosyVoice in-process) |
| **kais-music-score** | Music scoring | 2026-04-23 | 8 | Consolidated into ACE-Step |
| **kais-story-score** | Story scoring | 2026-04-22 | 10 | Not in v9 stack |
| **kais-lipVoice** | Lip sync (oldest repo) | 2026-04-20 | 1 | Consolidated into gold-team's `build_lipsync_workflow` (LatentSync via ComfyUI) |

### NOT SOURCE — Directory Only (1)

| Path | Type | Notes |
|------|------|-------|
| `comfyui-output` | Plain directory (not a git repo) | Output volume target; not source code |

## Service ↔ Repo Dependency Map

| Compose Service | Source | Type |
|-----------------|--------|------|
| `comfyui-primary` | Pre-built image `yanwk/comfyui-boot:cu130-megapak-pt211` + volume `comfyui-incremental-nodes` | External image + sibling volume |
| `comfyui-auxiliary` | Same as primary | External image + sibling volume |
| `kais-core-backend` | `.` (in-tree `docker/core-backend/Dockerfile`) | In-tree |
| `kais-gold-team` | `../kais-gold-team` | Sibling repo (ACTIVE) |
| `kais-acestep` | `${ACESTEP_PROJECT_DIR:-../ACE-Step-1.5}` | Sibling repo (ACTIVE, profile=ace) |
| `kais-review-platform` | `../kais-review-platform` | Sibling repo (ACTIVE, profile=review) |
| `kais-gold-team-mock` | `.` (in-tree `docker/gold-team/Dockerfile.mock`) | In-tree (profile=mock) |
| `hermes-agent` | `./docker/hermes-agent` | In-tree (forked source) |
| `audit-db` | `postgres:15-alpine` | External image |
| `redis` | `redis:7-alpine` | External image |

## Call Relationship Diagram

```
                          ┌─────────────────────────────┐
                          │  kais-aigc-platform (this)  │
                          │  Deployment & integration   │
                          │  - docker-compose.v9.yml    │
                          │  - docker/core-backend/     │
                          │  - docker/hermes-agent/     │
                          │  - docker/gold-team/ deploy │
                          └──────────┬──────────────────┘
                                     │ builds / mounts
            ┌────────────────────────┼────────────────────────┐
            │                        │                        │
   ┌────────▼─────────┐   ┌──────────▼──────────┐  ┌──────────▼──────────┐
   │ kais-gold-team   │   │ ACE-Step-1.5        │  │ kais-review-platform│
   │ :8002 execution  │   │ :8009 music sidecar │  │ :8090 review (opt)  │
   └────────┬─────────┘   └─────────────────────┘  └─────────────────────┘
            │ HTTP
   ┌────────▼─────────────────────────┐
   │ comfyui-primary + auxiliary      │
   │ :8188 / :8189                    │
   │ ← comfyui-incremental-nodes      │
   │   (volume-mounted custom nodes)  │
   └──────────────────────────────────┘

   ── Legacy (not in v9 stack, OpenClaw layer) ──
   kais-jimeng → OpenClaw skill (agent layer, not engine layer)

   ── Archived (consolidated into gold-team) ──
   kais-lipVoice, kais-TTS-agent, kais-song-agent, kais-music-score,
   kais-story-score, kais-parallax-scene, kais-blender-engine,
   kais-slideshow-agent, kais-sound-effects-agent, kais-soul-radar

   ── Retired (v1.3 explicit removal) ──
   kais-movie-agent → replaced by OpenClaw Agent

   ── Absorbed ──
   kais-aigc-integration → role absorbed by this repo
   kais-3d-toolkit → 3D now in gold-team Hunyuan3D/TRELLIS workflows
```

## Summary Statistics

- **Total siblings audited:** 19
- **ACTIVE (production-critical):** 4 (21%)
- **LEGACY (verify before archiving):** 4 (21%)
- **ARCHIVED (consolidation candidates):** 10 (53%)
- **Compose-managed services:** 10 (5 in-tree, 4 sibling-built, 2 external images)
- **Repos needing user verification before archival:** 2 (kais-3d-toolkit, kais-soul-radar)

## Open Questions for User

1. **kais-3d-toolkit** — Recent commits (2026-06-04) but no README. Is this still used? Or fully replaced by gold-team 3D workflows?
2. **kais-soul-radar** — No README, unclear purpose. Confirm archive?
3. **kais-jimeng** — Confirmed as OpenClaw agent skill. Should it stay in legacy/, or move to a new "OpenClaw skills" classification?

## Archival Actions Taken (v1.4 REPO-04)

| Repo | Action | Commit | Status |
|------|--------|--------|--------|
| **kais-movie-agent** | `DEPRECATED.md` marker added and committed | `b4ae2b1` (in that repo) | ✅ Done — clean working tree, explicitly retired in v1.3 |

## Archival Pending — Blocked on Dirty Working Trees (9 repos)

The following ARCHIVED repos have uncommitted changes in their working trees. Adding a `DEPRECATED.md` marker now would co-mingle with their pre-existing dirty state. **User action required:** clean or stash the dirty state in each repo, then re-run archival marker.

| Repo | Dirty Files | Recommended Action |
|------|-------------|--------------------|
| kais-story-score | 40 | Review and clean, then mark DEPRECATED |
| kais-music-score | 24 | Review and clean, then mark DEPRECATED |
| kais-parallax-scene | 10 | Review and clean, then mark DEPRECATED |
| kais-blender-engine | 10 | Review and clean, then mark DEPRECATED |
| kais-slideshow-agent | 7 | Review and clean, then mark DEPRECATED |
| kais-lipVoice | 3 | Review and clean, then mark DEPRECATED |
| kais-song-agent | 3 | Review and clean, then mark DEPRECATED |
| kais-TTS-agent | 2 | Review and clean, then mark DEPRECATED |
| kais-sound-effects-agent | 1 | Review and clean, then mark DEPRECATED |

## Archival Pending — Needs User Verification (3 repos)

These LEGACY repos have 2026 activity but unclear status. Do NOT mark DEPRECATED until user confirms.

| Repo | Why Pending |
|------|-------------|
| kais-3d-toolkit | Recent commit (2026-06-04) — possibly still active |
| kais-soul-radar | No README — purpose unknown |
| kais-jimeng | OpenClaw skill layer — may still be in use for agent workflows |
| kais-aigc-integration | Planning repo — role absorbed by kais-aigc-platform, but may have reference value |

---
*Generated by v1.4 Phase 22 / REPO-01..03 audit on 2026-06-13*
*Archival actions recorded 2026-06-13 (REPO-04)*
