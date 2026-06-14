# Output Path Convention (v1.5+)

**Status:** Active
**Applies to:** All new code writing files to `/mnt/agents/output/*`
**Migration target:** Existing 33 ComfyUI routes (opportunistic, not enforced)

## TL;DR

```typescript
// OLD (still works, but inconsistent across modules)
const outputDir = process.env.FLUX_OUTPUT_DIR || "/mnt/agents/output";

// NEW (preferred for code touched after 2026-06-14)
import { engineOutputDir } from "@/lib/paths";
const outputDir = engineOutputDir("flux");
```

## The Problem

The codebase accumulated 6+ parallel env vars for output paths:

| Env var | Default | Used by |
|---|---|---|
| `OUTPUT_DIR` | `/mnt/agents/output` | generic + comfyui default |
| `COMFYUI_OUTPUT_DIR` | `/mnt/agents/output` | ace, comfyui routes |
| `FLUX_OUTPUT_DIR` | `/mnt/agents/output` | flux routes |
| `INDEXTTS2_OUTPUT_DIR` | `/mnt/agents/output/gpu1` | indextts2 routes |
| `LTX_OUTPUT_DIR` | (not set) | ltx routes (uses OUTPUT_DIR fallback) |
| `TTS_OUTPUT_DIR` | (not set) | tts routes |

Defaults were inconsistent — some pointed to `/mnt/agents/output`, others to `/mnt/agents/output/gpu1`. Callers had to know which env var each module respected.

## The Convention

**Single source of truth:** `OUTPUT_ROOT` env var (defaults to `/mnt/agents/output`).

**Per-engine subdirectories** under OUTPUT_ROOT:

```
/mnt/agents/output/
├── ace/             # ACE-Step music (.mp3, .flac)
├── flux/            # Flux image generation (.png, .webp)
├── tts/             # CosyVoice, Chatterbox, IndexTTS2 (.wav, .mp3)
├── ltx/             # LTX video (.mp4)
├── wan/             # Wan2.2 video (.mp4)
├── postprocess/     # face restore, upscale, RIFE
├── 3d/              # Hunyuan3D, Trellis (.glb, .mp4)
└── (root)           # generic comfyui output (no subdir)
```

## API

```typescript
import { engineOutputDir, getOutputRoot, EngineKind } from "@/lib/paths";

// Get the output dir for a specific engine
const dir = engineOutputDir("flux");  // → "/mnt/agents/output/flux" (or override)

// Get the root (for ad-hoc paths)
const root = getOutputRoot();  // → "/mnt/agents/output"

// Type for engine kinds (autocomplete-safe)
function myFunc(engine: EngineKind) { ... }
```

## Backwards Compatibility

Legacy env vars continue to work as **overrides**:

| If env var is set | `engineOutputDir(kind)` returns |
|---|---|
| `FLUX_OUTPUT_DIR=/custom/path` | `/custom/path` (legacy override wins) |
| `OUTPUT_ROOT=/other/root` (only) | `/other/root/flux` (new convention) |
| Neither set | `/mnt/agents/output/flux` (default) |

This means:
- **Existing deployments:** no breaking changes. If you set `FLUX_OUTPUT_DIR`, Flux still writes there.
- **New deployments:** set only `OUTPUT_ROOT`. All engines write to their subdirs.

## Migration Strategy

**Opportunistic, not enforced.** When you touch a route for any reason:

1. Find its `outputDir` resolution (usually `process.env.XXX_OUTPUT_DIR || ...`)
2. Replace with `engineOutputDir("xxx")`
3. Remove the local env var fallback (now handled by `paths.ts`)
4. Test the route still resolves to the same path in production (env vars unchanged)

### Routes to migrate (priority order)

High-traffic first:

1. `src/routes/v1/ace/config.ts` — **DONE** (Phase 25 demo)
2. `src/routes/production/flux/config.ts`
3. `src/routes/production/indextts2/config.ts`
4. `src/routes/v1/tts/config.ts`
5. `src/routes/production/ltx/config.ts`
6. `src/routes/production/postprocess/_shared/config.ts`
7. `src/routes/v1/hunyuan3d/config.ts`
8. Remaining 26 ComfyUI routes (use `engineOutputDir("comfyui")` for generic)

### What NOT to migrate

- `docker-compose.v9.yml` volume mounts — these define what's *visible* to containers, separate from where Node writes. Leave as-is.
- gold-team / hermes-agent configs — they have their own conventions.

## Verification

```bash
# Confirm paths.ts exports resolve correctly
node -e '
const { engineOutputDir, getOutputRoot } = require("./src/lib/paths");
console.log("root:", getOutputRoot());
console.log("flux:", engineOutputDir("flux"));
console.log("ace: ", engineOutputDir("ace"));
'
```

Expected output (with no env vars set):
```
root: /mnt/agents/output
flux: /mnt/agents/output/flux
ace:  /mnt/agents/output/ace
```
