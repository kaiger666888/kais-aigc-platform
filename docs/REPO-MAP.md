# KAIS AIGC Platform — Repo Map (Newcomer Guide)

**Goal:** Orient a new contributor in 5 minutes. **Last updated:** 2026-06-13 (v1.4)

## TL;DR — What is this workspace?

The `/data/workspace/` directory holds **20 repositories** that together form the KAIS AIGC short-drama production platform. Only **5 of them** are required to run the production stack — the rest are legacy/archived single-purpose agents consolidated into the unified engine.

**Start here:** `kais-aigc-platform` (this repo) is the deployment and integration hub.

---

## The 5 Active Repos (Production Stack)

| Repo | Role | How it's wired |
|------|------|----------------|
| **kais-aigc-platform** (this) | Deployment hub. Holds `docker-compose.v9.yml`, `docker/core-backend/`, `docker/hermes-agent/`, `docker/gold-team/` deploy Dockerfile | Build context `.` for `kais-core-backend`, `kais-gold-team-mock`, `hermes-agent` services |
| **kais-gold-team** | Unified execution engine. FastAPI :8002. Routes every generation task (image, video, audio, 3D, music) to the right backend | Build context `../kais-gold-team` for `kais-gold-team` service |
| **kais-review-platform** | AI production pipeline review/approval platform (FastAPI + HTMX) | Build context `../kais-review-platform` for `kais-review-platform` service (profile=review) |
| **ACE-Step-1.5** | Music generation sidecar (upstream ACE-Step fork + REST wrapper) | Build context `../ACE-Step-1.5` for `kais-acestep` service (profile=ace) |
| **comfyui-incremental-nodes** | Custom ComfyUI node packages (LTXVideo, TRELLIS2, AIIA, IndexTTS2, facerestore) | Volume-mounted into `comfyui-primary` and `comfyui-auxiliary` |

## The Production Stack (docker-compose.v9.yml)

```
   ┌──────────────────────────────────────────────────────────────────┐
   │                   kais-aigc-platform (this repo)                 │
   │                                                                   │
   │  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────┐ │
   │  │ kais-core-backend │   │ kais-gold-team   │   │ hermes-agent │ │
   │  │ :8000 (Node.js)   │──▶│ :8002 (FastAPI)  │   │ :8080        │ │
   │  │ Content layer     │   │ Execution + GPU  │   │ Decisions    │ │
   │  └─────────┬─────────┘   └────────┬─────────┘   └──────────────┘ │
   │            │                      │                              │
   │            │              ┌───────┴────────┐                     │
   │            │              │                │                     │
   │            │       ┌──────▼──────┐  ┌──────▼──────┐              │
   │            │       │ comfyui-    │  │ kais-acestep│              │
   │            │       │ primary     │  │ :8009       │              │
   │            │       │ :8188 (3090)│  │ (3090, ace) │              │
   │            │       └─────────────┘  └─────────────┘              │
   │            │              ↕ volume                                  │
   │            │       ┌─────────────────────────┐                    │
   │            │       │ comfyui-auxiliary       │                    │
   │            │       │ :8189 (3060Ti)          │                    │
   │            │       └─────────────────────────┘                    │
   │            ▼                                                      │
   │  ┌──────────────┐    ┌──────────────┐                            │
   │  │ audit-db     │    │ redis        │                            │
   │  │ PostgreSQL15 │    │ :6390        │                            │
   │  └──────────────┘    └──────────────┘                            │
   │                                                                   │
   │  Optional: kais-review-platform:8090 (profile=review)             │
   └──────────────────────────────────────────────────────────────────┘
            ↑ builds from sibling repos ↑
   ┌───────┴──────────┐  ┌──────────────┐  ┌─────────────────────┐
   │ kais-gold-team   │  │ ACE-Step-1.5 │  │ kais-review-platform│
   └──────────────────┘  └──────────────┘  └─────────────────────┘

   External image: comfyui-primary/auxiliary use yanwk/comfyui-boot:cu130-megapak-pt211
   Custom nodes mounted from: /data/workspace/comfyui-incremental-nodes
```

## GPU Allocation

| GPU | Hardware | Services |
|------|----------|----------|
| GPU 0 | RTX 3060Ti (8GB, ~5.5GB usable) | `comfyui-auxiliary` only |
| GPU 1 | RTX 3090 (24GB) | `comfyui-primary` + `kais-gold-team` + `kais-acestep` (time-shared) |

---

## Common Entry Points

| If you want to... | Go to... |
|--------------------|----------|
| Add a new generation engine | `kais-gold-team` → `src/v6/engines/` + register in `main.py` |
| Add a new ComfyUI workflow | `kais-gold-team` → `src/v6/engines/workflow_builder.py` |
| Add a new task type | `kais-gold-team` → `src/v6/models/task.py` (TaskType enum) + `executor.py` routing |
| Add a new ComfyUI custom node | `comfyui-incremental-nodes` (sibling repo) |
| Change service composition | `kais-aigc-platform/docker-compose.v9.yml` |
| Add a new review workflow | `kais-review-platform` (sibling repo) |
| Change music generation | `ACE-Step-1.5` (sibling repo) or `kais-gold-team` ACEStepEngine |

## Deployment

```bash
# Full stack
docker compose -f docker-compose.v9.yml up -d

# With music sidecar
docker compose -f docker-compose.v9.yml --profile ace up -d

# With review platform
docker compose -f docker-compose.v9.yml --profile review up -d

# Engines only (no app layer)
docker compose -f docker-compose.v9.yml up -d comfyui-primary comfyui-auxiliary

# Mock mode (no GPU)
docker compose -f docker-compose.v9.yml --profile mock up -d
```

---

## Ignore These (Legacy / Archived)

These repos are NOT part of the production stack. Most were single-purpose agents consolidated into `kais-gold-team` during v1.0–v1.3. They're kept for git history only.

**Retired in v1.3:**
- `kais-movie-agent` ⚠️ DEPRECATED — replaced by OpenClaw Agent

**Consolidated into gold-team (ARCHIVED):**
- `kais-lipVoice` → gold-team `build_lipsync_workflow` (LatentSync)
- `kais-TTS-agent` → gold-team `TTSTracker` + `TripleTrackTTSEngine` (CosyVoice)
- `kais-song-agent` / `kais-music-score` → ACE-Step sidecar
- `kais-blender-engine`, `kais-slideshow-agent`, `kais-sound-effects-agent`, `kais-story-score`, `kais-parallax-scene` → not in v9 stack

**Status unclear (LEGACY — needs verification):**
- `kais-3d-toolkit`, `kais-soul-radar`, `kais-jimeng`, `kais-aigc-integration`

👉 **Full audit details:** `.planning/REPO-INVENTORY.md`

## Not Repos
- `comfyui-output` — output directory, not a git repo

---

## Where to Read More

- **Architecture deep-dive:** `docs/architecture.md`
- **Engine registration pattern:** `.planning/PROJECT.md` (Key Decisions table)
- **Full repo audit + classifications:** `.planning/REPO-INVENTORY.md`
- **v1.3 milestone history:** `.planning/MILESTONES.md` + `.planning/v1.3-MILESTONE-AUDIT.md`
