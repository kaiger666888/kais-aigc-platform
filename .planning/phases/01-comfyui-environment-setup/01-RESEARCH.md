# Phase 1: ComfyUI Environment Setup - Research

**Researched:** 2026-06-04
**Domain:** ComfyUI custom node installation, model management, Docker container configuration
**Confidence:** HIGH

## Summary

This phase installs 5 custom nodes (LatentSync, IP-Adapter Plus, InstantID, PhotoMaker Plus, ComfyUI-Frame-Interpolation) and downloads their required models into the ComfyUI Worker container. The system runs ComfyUI as a Docker container (`comfyui-worker:pytorch251-v6-gcc` image) on an RTX 3090 24GB GPU. Custom nodes are stored at `/data/workspace/comfyui-wan/custom_nodes/` (bind-mounted read-only into the container), and models are stored at `/data/models/comfyui/` (bind-mounted read-only). The `extra_model_paths.yaml` at `/data/workspace/comfyui-wan/extra_model_paths.yaml` maps model directories.

**Primary recommendation:** Install all custom nodes by git-cloning into `/data/workspace/comfyui-wan/custom_nodes/`, install their pip dependencies into the container, download models to the appropriate `/data/models/comfyui/` subdirectories, and verify each node registers via `GET /object_info/{node_class}` on ComfyUI's API.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at Claude's discretion -- pure infrastructure phase (setup, install, verify). Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Claude's Discretion
All implementation choices are at Claude's discretion.

### Deferred Ideas (OUT OF SCOPE)
None -- infrastructure phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIPS-01 | ComfyUI Worker install LatentSync custom node and dependency models (latentsync_unet, whisper_tiny, arcface) | LatentSync v1.6 node from ShmuelRonen/ComfyUI-LatentSyncWrapper, models from ByteDance/LatentSync-1.6 on HuggingFace |
| CHAR-01 | ComfyUI Worker install IP-Adapter Plus + InstantID + PhotoMaker nodes and models | cubiq/ComfyUI_IPAdapter_plus, cubiq/ComfyUI_InstantID, shiimizu/ComfyUI-PhotoMaker-Plus, all with documented model download paths |
| FRAM-01 | ComfyUI Worker install ComfyUI-Frame-Interpolation custom node (RIFE model) | Fannovel16/ComfyUI-Frame-Interpolation, RIFE v4.6-v4.9 models auto-downloaded or placed in frame_interpolation dir |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Custom node installation | Docker Container (ComfyUI Worker) | Host filesystem (bind mount) | Nodes run inside ComfyUI's Python env; source lives on host for persistence |
| Model file management | Host filesystem (/data/models/) | Docker Container (read-only mount) | Models are large (multi-GB), stored on host, mounted read-only into container |
| Node registration verification | ComfyUI API (/object_info) | -- | ComfyUI exposes /object_info endpoint listing all registered node classes |
| Dependency installation | Docker Container (pip install) | -- | Each custom node has Python deps that must be installed in ComfyUI's Python env |
| Docker container restart | Host (docker compose) | -- | Container must be restarted after node/dependency changes |

## Standard Stack

### Core Custom Nodes

| Node | Repo | Purpose | Models Required |
|------|------|---------|-----------------|
| ComfyUI-LatentSyncWrapper | `ShmuelRonen/ComfyUI-LatentSyncWrapper` | Lip sync via LatentSync 1.6 | latentsync_unet.pt (5.07GB), stable_syncnet.pt (1.61GB), whisper/tiny.pt, VAE, auxiliary |
| ComfyUI_IPAdapter_plus | `cubiq/ComfyUI_IPAdapter_plus` | IP-Adapter face/subject conditioning | ipadapter models, CLIP vision models, optional insightface + LoRA for FaceID |
| ComfyUI_InstantID | `cubiq/ComfyUI_InstantID` | Zero-shot face identity preservation | antelopev2 insightface model, InstantID ip-adapter model, InstantID ControlNet |
| ComfyUI-PhotoMaker-Plus | `shiimizu/ComfyUI-PhotoMaker-Plus` | Multi-reference character generation | photomaker-v1/v2 models, insightface (antelopev2), CLIP vision |
| ComfyUI-Frame-Interpolation | `Fannovel16/ComfyUI-Frame-Interpolation` | Video frame interpolation (RIFE) | RIFE flownet models (auto-downloaded) |

### Supporting Dependencies

| Package | Purpose | Notes |
|---------|---------|-------|
| insightface | Face detection/embedding for InstantID, PhotoMaker, IP-Adapter FaceID | Must be installed in ComfyUI container |
| onnxruntime / onnxruntime-gpu | Required by insightface for model inference | GPU version preferred |
| mediapipe | Face mesh/landmarks for LatentSync | Python 3.10 compatible (confirmed) |
| face-alignment | Face alignment for LatentSync | Depends on dlib or similar |
| decord | Video frame reading for LatentSync | Efficient video I/O |
| DeepCache | LatentSync 1.6 caching optimization | Listed in requirements |
| cupy | CUDA ops for RIFE frame interpolation | Installed via install.bat or pip |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ShmuelRonen/LatentSyncWrapper v1.6 | iVideoGameBoss/ComfyUI-LatentSync-Node (v1.5 only) | v1.6 has 512x512 training, better clarity, backward compatible |
| cubiq/ComfyUI_IPAdapter_plus | comfyorg/comfyui-ipadapter | Author set plus repo to maintenance-only; official fork available but plus is still the standard |
| shiimizu/ComfyUI-PhotoMaker-Plus | ZHO-ZHO-ZHO/ComfyUI-PhotoMaker | Plus version has better face resemblance, V2 support, more features |

## Package Legitimacy Audit

> All packages below are custom nodes installed via git clone, not pip packages from npm/PyPI. The "legitimacy" is assessed by GitHub repo popularity, author reputation, and community adoption.

| Package | Source | Stars/Forks | Author | Age | Disposition |
|---------|--------|-------------|--------|-----|-------------|
| ShmuelRonen/ComfyUI-LatentSyncWrapper | GitHub | Active, 1.6 release | Community developer | ~6 months | Approved -- primary LatentSync ComfyUI node |
| cubiq/ComfyUI_IPAdapter_plus | GitHub | 2000+ stars, reference implementation | cubiq (well-known ComfyUI contributor) | ~2 years | Approved -- standard IP-Adapter node |
| cubiq/ComfyUI_InstantID | GitHub | Well-maintained, native implementation | cubiq | ~1.5 years | Approved -- standard InstantID node |
| shiimizu/ComfyUI-PhotoMaker-Plus | GitHub | 296 stars | shiimizu | ~2 years | Approved -- standard PhotoMaker node |
| Fannovel16/ComfyUI-Frame-Interpolation | GitHub | Well-established | Fannovel16 | ~2 years | Approved -- standard frame interpolation node |

**No pip registry packages in this phase** -- all installations are git clone + pip install -r requirements.txt from well-known ComfyUI custom node repositories.

## Architecture Patterns

### System Architecture Diagram

```
Host Filesystem                           Docker Container (comfyui-main)
========================                  ==============================

/data/workspace/comfyui-wan/              /app/ComfyUI/
  custom_nodes/              :ro mount -->  custom_nodes/
    ComfyUI-WanVideoWrapper/                  ComfyUI-WanVideoWrapper/
    ComfyUI-GGUF/                             ComfyUI-GGUF/
    [NEW] ComfyUI-LatentSyncWrapper/          [NEW] ComfyUI-LatentSyncWrapper/
    [NEW] ComfyUI_IPAdapter_plus/             [NEW] ComfyUI_IPAdapter_plus/
    [NEW] ComfyUI_InstantID/                  [NEW] ComfyUI_InstantID/
    [NEW] ComfyUI-PhotoMaker-Plus/            [NEW] ComfyUI-PhotoMaker-Plus/
    [NEW] ComfyUI-Frame-Interpolation/        [NEW] ComfyUI-Frame-Interpolation/
    ComfyUI-Manager/                          ComfyUI-Manager/

/data/models/comfyui/         :ro mount --> /data/models/ (via extra_model_paths.yaml)
  ipadapter/                                  ipadapter/
  clip_vision/                                clip_vision/
  controlnet/                                 controlnet/
  loras/                                      loras/
  [NEW] insightface/                          [NEW] insightface/
  [NEW] instantid/                            [NEW] instantid/
  photomaker/                                 photomaker/
  frame_interpolation/                        frame_interpolation/

                                           :8188 API
                                             GET /object_info --> verify nodes
                                             GET /system_stats --> health check
```

### Recommended Project Structure

```
/data/workspace/comfyui-wan/
  custom_nodes/                          # Bind-mounted :ro into container
    ComfyUI-WanVideoWrapper/             # Existing
    ComfyUI-GGUF/                        # Existing
    ComfyUI-eesahesNodes/                # Existing
    ComfyUI-joycaption-beta-one-GGUF/    # Existing
    ComfyUI-Manager/                     # Existing
    ComfyUI-LatentSyncWrapper/           # [NEW] Phase 1
    ComfyUI_IPAdapter_plus/              # [NEW] Phase 1
    ComfyUI_InstantID/                   # [NEW] Phase 1
    ComfyUI-PhotoMaker-Plus/             # [NEW] Phase 1
    ComfyUI-Frame-Interpolation/         # [NEW] Phase 1
  extra_model_paths.yaml                 # Model path configuration
  docker-compose.yml                     # Container orchestration

/data/models/comfyui/                    # Bind-mounted :ro into container
  ipadapter/                             # IP-Adapter model weights
  ipadapter-flux/                        # Flux-specific IP-Adapter models (already exists)
  clip_vision/                           # CLIP vision encoder models
  controlnet/                            # ControlNet models
  loras/                                 # LoRA weights (including FaceID LoRAs)
  insightface/                           # [NEW] InsightFace antelopev2 models
    models/
      antelopev2/
  instantid/                             # [NEW] InstantID ip-adapter model
  photomaker/                            # PhotoMaker models
  frame_interpolation/                   # RIFE models (auto-downloaded)
  unet/                                  # UNet models
  vae/                                   # VAE models
  text_encoders/                         # Text encoder models
```

### Pattern 1: Custom Node Installation (git clone into bind-mounted directory)

**What:** Each custom node is cloned from GitHub into `/data/workspace/comfyui-wan/custom_nodes/`, which is bind-mounted read-only into the ComfyUI container.

**When to use:** For every custom node installation.

**Example:**
```bash
# On the host machine
cd /data/workspace/comfyui-wan/custom_nodes/
git clone https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper.git

# Install dependencies inside the running container
docker exec comfyui-main bash -c "cd /app/ComfyUI/custom_nodes/ComfyUI-LatentSyncWrapper && pip install -r requirements.txt"
```

### Pattern 2: Model Download to Shared Storage

**What:** Download model files from HuggingFace to the appropriate subdirectory under `/data/models/comfyui/`.

**When to use:** For each model required by custom nodes.

**Example:**
```bash
# Download IP-Adapter models
cd /data/models/comfyui/ipadapter/
wget https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus-face_sd15.safetensors

# Or use huggingface-cli
huggingface-cli download h94/IP-Adapter --local-dir /data/models/comfyui/ipadapter/
```

### Pattern 3: Node Verification via ComfyUI API

**What:** After restarting ComfyUI, verify each custom node is registered by querying the /object_info endpoint.

**When to use:** After each node installation, and as final verification.

**Example:**
```bash
# Check if a specific node class is registered
curl -s http://localhost:8188/object_info/LatentSync1.6 | python3 -m json.tool | head -5

# List all registered node classes
curl -s http://localhost:8188/object_info | python3 -c "import sys,json; nodes=json.load(sys.stdin); print('\n'.join(sorted(nodes.keys())))"
```

### Anti-Patterns to Avoid

- **Installing nodes inside the container without persistence:** Nodes installed inside a running container will be lost on restart if not in the bind-mounted directory.
- **Downloading models to /app/ComfyUI/models/ inside the container:** Use the extra_model_paths.yaml mapped directories (/data/models/) instead, as the container's internal model dirs have placeholder files and are not persisted.
- **Running pip install on the host instead of inside the container:** Dependencies must be installed in ComfyUI's Python environment (inside the container).
- **Using LatentSync v1.5 instead of v1.6:** v1.6 provides significantly better clarity (512x512 training). The v1.5 unet is 3.4GB, v1.6 unet is 5.07GB.
- **Forgetting to restart the container after adding nodes:** ComfyUI scans custom_nodes/ on startup.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lip sync from scratch | Custom diffusion pipeline | LatentSync node (ShmuelRonen) | Complex audio-conditioned latent diffusion model; ByteDance spent significant research effort |
| Face identity preservation | Custom face swap pipeline | InstantID / IP-Adapter FaceID / PhotoMaker nodes | Each has unique strengths; all require insightface + specialized models |
| Frame interpolation | Custom optical flow pipeline | RIFE VFI node (Fannovel16) | RIFE is real-time, well-optimized, supports v4.0-4.9 |
| Node verification | Manual workflow testing | `GET /object_info/{node_class}` API | ComfyUI exposes registration status via API; no need to build a workflow |

**Key insight:** This phase is purely about installing community-tested, well-documented ComfyUI custom nodes and their models. There should be zero custom code -- only git clone, pip install, model download, and API verification.

## Common Pitfalls

### Pitfall 1: Disk Space Exhaustion
**What goes wrong:** /data partition is 94% full (38GB available). Model downloads total ~15-20GB.
**Why it happens:** Multiple large models (LatentSync 5.07GB + 1.61GB, IP-Adapter models ~2-3GB, InstantID ~1GB, CLIP vision ~3.5GB, etc.)
**How to avoid:** Calculate total download size before starting. Monitor disk usage. Consider cleaning up unused models first.
**Warning signs:** `df -h /data/` shows <10GB free after any download step.

### Pitfall 2: LatentSync v1.6 Models on Private HuggingFace Repo
**What goes wrong:** ByteDance/LatentSync-1.6 may require authentication or access approval.
**Why it happens:** The v1.6 repo appears to be public but the node README mentions it may require manual download.
**How to avoid:** Test `huggingface-cli download ByteDance/LatentSync-1.6` first. If blocked, use Google Drive package mentioned in node README, or fall back to v1.5 (ByteDance/LatentSync, public).
**Warning signs:** `403 Forbidden` or `Repository Not Found` errors during download.

### Pitfall 3: Python 3.10 + mediapipe Compatibility
**What goes wrong:** mediapipe has specific Python version requirements.
**Why it happens:** Container runs Python 3.10.13 -- mediapipe>=0.10.8 supports Python 3.8-3.11.
**How to avoid:** Verify mediapipe installs successfully: `docker exec comfyui-main pip install mediapipe>=0.10.8`
**Warning signs:** Import errors for mediapipe after installation.

### Pitfall 4: Custom Nodes Mounted Read-Only
**What goes wrong:** The custom_nodes directory is bind-mounted `:ro` (read-only). Nodes that try to write to their own directory (auto-download models, cache) will fail.
**Why it happens:** docker-compose.yml mounts custom_nodes as `:ro`.
**How to avoid:** Two options: (a) Change mount to read-write, or (b) Pre-download all models to the appropriate directories before mounting. Option (b) is safer and more reproducible.
**Warning signs:** Permission denied errors in ComfyUI logs.

### Pitfall 5: InsightFace antelopev2 Model Placement
**What goes wrong:** InstantID and PhotoMaker require insightface antelopev2, but the model must be in a specific directory structure.
**Why it happens:** ComfyUI looks for insightface models in `ComfyUI/models/insightface/models/antelopev2/` OR the extra_model_paths.yaml mapped path.
**How to avoid:** Download antelopev2 and place at `/data/models/comfyui/insightface/models/antelopev2/` (requires adding `insightface` mapping to extra_model_paths.yaml), or use the ComfyUI internal path.
**Warning signs:** "InsightFace model not found" or "antelopev2 not found" errors.

### Pitfall 6: RIFE Models Not Auto-Downloading in :ro Mount
**What goes wrong:** ComfyUI-Frame-Interpolation auto-downloads RIFE models on first use, but the frame_interpolation directory is on a read-only mount.
**Why it happens:** The auto-download writes to the model directory inside the container.
**How to avoid:** Pre-download RIFE models manually to `/data/models/comfyui/frame_interpolation/` before running the node.
**Warning signs:** "Failed to download" or "Permission denied" errors when using RIFE VFI node.

### Pitfall 7: Dependency Conflicts Between Nodes
**What goes wrong:** Different nodes may require different versions of the same package.
**Why it happens:** LatentSync needs `diffusers>=0.32.2`, WanVideoWrapper needs `diffusers>=0.33.0`, container already has `diffusers==0.38.0`.
**How to avoid:** Check version compatibility before installing. Current diffusers (0.38.0) satisfies both requirements.
**Warning signs:** `pip install` downgrades a package, or ComfyUI fails to start with import errors.

### Pitfall 8: extra_model_paths.yaml Missing Directories
**What goes wrong:** New model directories (insightface, instantid) are not mapped in extra_model_paths.yaml.
**Why it happens:** The yaml only maps specific paths; new model types need explicit entries.
**How to avoid:** Update extra_model_paths.yaml to add `insightface` and `instantid` mappings. Also need to create the actual directories.
**Warning signs:** ComfyUI logs "model not found" even though the file exists in the filesystem.

## Code Examples

### Verifying Node Registration (Bash)
```bash
# Source: [CITED: docs.comfy.org/development/comfyui-server/comms_routes]
# Check if a specific node is registered
curl -sf http://localhost:8188/object_info/RIFE_VFI | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'RIFE_VFI' in data:
    print('RIFE_VFI: REGISTERED')
    print('  Inputs:', list(data['RIFE_VFI']['input']['required'].keys()))
else:
    print('RIFE_VFI: NOT FOUND')
"

# List all newly registered nodes
curl -sf http://localhost:8188/object_info | python3 -c "
import sys, json
nodes = json.load(sys.stdin)
targets = ['LatentSync', 'IPAdapter', 'InstantID', 'PhotoMaker', 'RIFE']
for t in targets:
    matching = [n for n in nodes.keys() if t.lower() in n.lower()]
    print(f'{t}: {matching if matching else \"NOT FOUND\"}')"
```

### Downloading LatentSync v1.6 Models
```bash
# Source: [CITED: github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper]
# Option 1: From HuggingFace (if accessible)
cd /data/workspace/comfyui-wan/custom_nodes/ComfyUI-LatentSyncWrapper/
mkdir -p checkpoints/whisper checkpoints/vae checkpoints/auxiliary

# Download from ByteDance/LatentSync-1.6 (5.07GB unet + 1.61GB syncnet + whisper)
huggingface-cli download ByteDance/LatentSync-1.6 latentsync_unet.pt --local-dir ./checkpoints/
huggingface-cli download ByteDance/LatentSync-1.6 stable_syncnet.pt --local-dir ./checkpoints/
huggingface-cli download ByteDance/LatentSync-1.6 whisper tiny.pt --local-dir ./checkpoints/whisper/

# VAE model (separate repo)
huggingface-cli download stabilityai/sd-vae-ft-mse diffusion_pytorch_model.safetensors config.json --local-dir ./checkpoints/vae/

# Auxiliary models (face detection)
huggingface-cli download ByteDance/LatentSync-1.6 auxiliary --local-dir ./checkpoints/auxiliary/
```

### Updating extra_model_paths.yaml
```yaml
# /data/workspace/comfyui-wan/extra_model_paths.yaml
# Existing entries
aigc_platform:
  base_path: /data/models
  unet: comfyui/unet
  clip: comfyui/text_encoders
  vae: comfyui/vae
  diffusion_models: comfyui/unet
  text_encoders: comfyui/text_encoders
  clip_vision: comfyui/clip_vision
  controlnet: comfyui/controlnet
  loras: comfyui/loras
  ipadapter: comfyui/ipadapter
  # [NEW] Phase 1 additions
  insightface: comfyui/insightface
  instantid: comfyui/instantid
  photomaker: comfyui/photomaker
  frame_interpolation: comfyui/frame_interpolation
```

### Regression Test: Verify Existing Workflows Still Work
```bash
# Submit a minimal txt2img workflow to verify ComfyUI still functions
curl -s -X POST http://localhost:8188/prompt -H 'Content-Type: application/json' -d '{
  "prompt": {
    "3": {"class_type": "KSampler", "inputs": {"seed": 42, "steps": 1, "cfg": 1, "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}},
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "test.safetensors"}},
    "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 64, "height": 64, "batch_size": 1}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "test", "clip": ["4", 1]}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["4", 1]}},
    "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
    "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "test-regression", "images": ["8", 0]}}
  },
  "client_id": "regression-test"
}'
# Expected: {"prompt_id": "...", "number": 1, "node_errors": {}}
# If existing models are not loaded, this will fail at CheckpointLoaderSimple -- that's expected.
# The key check is that ComfyUI starts without import/registration errors.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LatentSync v1.0/v1.5 (256x256) | LatentSync v1.6 (512x512) | 2025-06 | Better lip clarity, same architecture |
| IPAdapter separate loaders | Unified Model Loader | 2024 | Simplified model loading with naming convention |
| InstantID diffusers-based | Native ComfyUI implementation (cubiq) | 2024 | Better integration, no diffusers dependency |
| PhotoMaker V1 only | PhotoMaker V2 with insightface | 2024-07 | Better face fidelity, requires insightface |
| RIFE v3.x | RIFE v4.6-v4.9 | 2023+ | Better quality, no fast_mode in v4.5+ |

**Deprecated/outdated:**
- `ip-adapter_sd15_light.safetensors` (v1.0) -- replaced by `ip-adapter_sd15_light_v11.bin`
- `ip-adapter-faceid-plus_sd15.bin` -- replaced by `ip-adapter-faceid-plusv2_sd15.bin`
- LatentSync v1.0 (`chunyu-li/LatentSync` repo) -- replaced by v1.5, then v1.6

## Model Download Checklist

### LatentSync (LIPS-01)
| Model | Source | Size | Destination |
|-------|--------|------|-------------|
| latentsync_unet.pt | [ByteDance/LatentSync-1.6](https://huggingface.co/ByteDance/LatentSync-1.6) | 5.07 GB | `custom_nodes/ComfyUI-LatentSyncWrapper/checkpoints/` |
| stable_syncnet.pt | [ByteDance/LatentSync-1.6](https://huggingface.co/ByteDance/LatentSync-1.6) | 1.61 GB | `custom_nodes/ComfyUI-LatentSyncWrapper/checkpoints/` |
| whisper/tiny.pt | [ByteDance/LatentSync-1.6](https://huggingface.co/ByteDance/LatentSync-1.6) | ~75 MB | `custom_nodes/ComfyUI-LatentSyncWrapper/checkpoints/whisper/` |
| VAE (sd-vae-ft-mse) | [stabilityai/sd-vae-ft-mse](https://huggingface.co/stabilityai/sd-vae-ft-mse) | ~335 MB | `custom_nodes/ComfyUI-LatentSyncWrapper/checkpoints/vae/` |
| auxiliary/* | [ByteDance/LatentSync-1.6](https://huggingface.co/ByteDance/LatentSync-1.6) | ~small | `custom_nodes/ComfyUI-LatentSyncWrapper/checkpoints/auxiliary/` |

**Total LatentSync: ~7.1 GB** [VERIFIED: huggingface.co/ByteDance/LatentSync-1.6]

### IP-Adapter Plus (CHAR-01)
| Model | Source | Size | Destination |
|-------|--------|------|-------------|
| CLIP-ViT-H-14-laion2B | h94/IP-Adapter | ~2.5 GB | `/data/models/comfyui/clip_vision/` |
| ip-adapter-plus-face_sd15.safetensors | h94/IP-Adapter | ~700 MB | `/data/models/comfyui/ipadapter/` |
| ip-adapter-faceid-plusv2_sd15.bin | h94/IP-Adapter | ~700 MB | `/data/models/comfyui/ipadapter/` |
| ip-adapter-faceid-plusv2_sd15_lora.safetensors | h94/IP-Adapter | ~300 MB | `/data/models/comfyui/loras/` |

**Total IP-Adapter: ~4.2 GB** [ASSUMED -- sizes from community reports]

### InstantID (CHAR-01)
| Model | Source | Size | Destination |
|-------|--------|------|-------------|
| antelopev2 (insightface) | insightface models | ~400 MB | `/data/models/comfyui/insightface/models/antelopev2/` |
| InstantID ip-adapter | InstantX/InstantID | ~700 MB | `/data/models/comfyui/instantid/` |
| instantid_controlnet | InstantX/InstantID | ~1.5 GB | `/data/models/comfyui/controlnet/` |

**Total InstantID: ~2.6 GB** [ASSUMED -- sizes from community reports]

### PhotoMaker (CHAR-01)
| Model | Source | Size | Destination |
|-------|--------|------|-------------|
| photomaker-v1.bin | TencentARC/PhotoMaker | ~700 MB | `/data/models/comfyui/photomaker/` |
| photomaker-v2.safetensors | bssrdf/PhotoMakerV2 | ~700 MB | `/data/models/comfyui/photomaker/` |

**Total PhotoMaker: ~1.4 GB** [ASSUMED -- sizes from community reports]

### Frame Interpolation (FRAM-01)
| Model | Source | Size | Destination |
|-------|--------|------|-------------|
| RIFE v4.6 flownet | Auto-downloaded by node | ~100 MB | `/data/models/comfyui/frame_interpolation/` or auto |

**Total RIFE: ~0.1 GB** [ASSUMED -- RIFE models are small]

### Grand Total Estimated: ~15.4 GB
### Available Disk Space: ~38 GB (94% used)
### Post-Install Available: ~22 GB (should be sufficient)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | LatentSync v1.6 is the best choice; v1.6 repo is publicly accessible | Standard Stack | If repo is gated/private, fall back to v1.5 (public) or use Google Drive package |
| A2 | InsightFace antelopev2 can be downloaded without license restrictions | Model Download | Commercial use may require license; for dev/testing this is fine |
| A3 | Model sizes are approximately as listed (some not verified by direct download) | Model Download | May need more or less disk space |
| A4 | Existing custom_nodes mount can be changed from :ro to :rw if needed | Architecture | If read-only is required, must pre-download everything before container start |
| A5 | Current diffusers 0.38.0 is compatible with all nodes' requirements | Pitfalls | If a node requires a specific version, pip may downgrade |
| A6 | The extra_model_paths.yaml can be updated to add new model directories | Code Examples | If the yaml is also :ro mounted, need to update the host file and restart |
| A7 | RIFE models auto-download to the frame_interpolation directory listed in extra_model_paths | Model Download | May need manual download if auto-download path differs |
| A8 | All nodes' pip dependencies are compatible with Python 3.10 + PyTorch 2.5.1 | Standard Stack | Some nodes may need newer Python or specific PyTorch |

## Open Questions (RESOLVED)

1. **LatentSync v1.6 HuggingFace access** — RESOLVED: Plan 01-02 includes v1.5 fallback if v1.6 is gated. Also, host cannot access huggingface.co directly; use HF_ENDPOINT=https://hf-mirror.com for all downloads.
2. **Custom nodes mount: read-only vs read-write** — RESOLVED: Plan 01-03 Task 1 surfaces this as a human decision checkpoint (Option A/B/C). The executor will confirm the target deployment before proceeding.
3. **InstantID SDXL vs SD1.5 compatibility** — RESOLVED: Install the node per CHAR-01 requirement; compatibility testing with FLUX is Phase 3's responsibility.
4. **Disk space sufficiency** — RESOLVED: ~15GB needed, ~38GB available. Plan 01-02 monitors df after each download batch; stop if <10GB free.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Container management | Yes | 5.1.3 | -- |
| NVIDIA GPU (RTX 3090) | All inference | Yes | GPU 1 | -- |
| Python 3.10 | ComfyUI runtime | Yes | 3.10.13 | -- |
| PyTorch 2.5.1 + CUDA 12.1 | All ML ops | Yes | 2.5.1+cu121 | -- |
| ffmpeg | LatentSync video I/O | Yes | 4.3 | -- |
| git | Clone custom nodes | Yes | -- | -- |
| huggingface-cli | Download models | Needs check | -- | wget/curl as fallback |
| curl | API verification | Yes | -- | -- |
| Internet access (via proxy) | Download models/nodes | Yes | http://host.docker.internal:7890 | -- |

**Missing dependencies with no fallback:**
- None identified -- all core tools are available

**Missing dependencies with fallback:**
- huggingface-cli: Can use `wget` or `curl` with direct HuggingFace URLs as fallback

## Validation Architecture

> nyquist_validation not explicitly set in config (config.json absent). Including section as default enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | curl + bash scripts (API verification) |
| Config file | None needed |
| Quick run command | `curl -sf http://localhost:8188/object_info/RIFE_VFI` |
| Full suite command | See node verification script below |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIPS-01 | LatentSync node registers in ComfyUI | smoke | `curl -sf http://localhost:8188/object_info \| python3 -c "import sys,json; n=json.load(sys.stdin); assert any('LatentSync' in k for k in n.keys()), 'LatentSync not found'"` | N/A (API test) |
| LIPS-01 | LatentSync models are present on disk | smoke | `ls /data/workspace/comfyui-wan/custom_nodes/ComfyUI-LatentSyncWrapper/checkpoints/latentsync_unet.pt` | N/A (file check) |
| CHAR-01 | IP-Adapter Plus node registers in ComfyUI | smoke | `curl -sf http://localhost:8188/object_info \| python3 -c "import sys,json; n=json.load(sys.stdin); assert any('IPAdapter' in k for k in n.keys()), 'IPAdapter not found'"` | N/A |
| CHAR-01 | InstantID node registers in ComfyUI | smoke | `curl -sf http://localhost:8188/object_info \| python3 -c "import sys,json; n=json.load(sys.stdin); assert any('InstantID' in k for k in n.keys()), 'InstantID not found'"` | N/A |
| CHAR-01 | PhotoMaker Plus node registers in ComfyUI | smoke | `curl -sf http://localhost:8188/object_info \| python3 -c "import sys,json; n=json.load(sys.stdin); assert any('PhotoMaker' in k for k in n.keys()), 'PhotoMaker not found'"` | N/A |
| CHAR-01 | insightface antelopev2 model present | smoke | `ls /data/models/comfyui/insightface/models/antelopev2/*.onnx` | N/A |
| FRAM-01 | RIFE VFI node registers in ComfyUI | smoke | `curl -sf http://localhost:8188/object_info/RIFE_VFI` | N/A |
| (All) | Existing workflows still work | regression | ComfyUI health check: `curl -sf http://localhost:8188/system_stats` | N/A |

### Sampling Rate
- **Per task commit:** `curl -sf http://localhost:8188/system_stats` (health check)
- **Per wave merge:** Full node registration verification script
- **Phase gate:** All 5 nodes registered, all models present, ComfyUI health check passes

### Wave 0 Gaps
- None -- test infrastructure is curl/bash (already available), no test framework needed for this phase

## Security Domain

> security_enforcement not explicitly disabled. Including minimal section.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A -- no auth endpoints in this phase |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | no | N/A -- no user input in this phase |
| V6 Cryptography | no | N/A |

### Known Threat Patterns for ComfyUI Custom Node Installation

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious custom node code | Tampering | Only install from well-known, high-star GitHub repos |
| Model file poisoning | Tampering | Download from official HuggingFace repos only |
| Supply chain attack via pip dependencies | Tampering | Review requirements.txt before installing |
| Disk exhaustion (DoS) | Denial of Service | Monitor disk space before/after downloads |

## Sources

### Primary (HIGH confidence)
- [CITED: github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper] - LatentSync v1.6 node README, requirements, model structure
- [CITED: github.com/cubiq/ComfyUI_IPAdapter_plus] - IP-Adapter Plus installation and model naming conventions
- [CITED: github.com/cubiq/ComfyUI_InstantID] - InstantID installation, model requirements, insightface dependency
- [CITED: github.com/shiimizu/ComfyUI-PhotoMaker-Plus] - PhotoMaker Plus installation, V1/V2 support
- [CITED: github.com/Fannovel16/ComfyUI-Frame-Interpolation] - Frame interpolation installation, RIFE support
- [CITED: huggingface.co/ByteDance/LatentSync-1.6] - LatentSync v1.6 model sizes (5.07GB unet, 1.61GB syncnet)
- [CITED: huggingface.co/ByteDance/LatentSync] - LatentSync v1.0 model sizes (3.4GB unet, 1.49GB syncnet) as fallback
- [VERIFIED: docker exec] - Container Python 3.10.13, PyTorch 2.5.1+cu121, diffusers 0.38.0, ffmpeg 4.3
- [VERIFIED: docker inspect + filesystem] - custom_nodes bind mount, /data/models structure, disk usage 94%
- [CITED: docs.comfy.org/development/comfyui-server/comms_routes] - ComfyUI API /object_info endpoint documentation

### Secondary (MEDIUM confidence)
- [WebSearch: RunComfy, InstaSD] - Installation guides for each node
- [WebSearch: community discussions] - Model sizes, common pitfalls

### Tertiary (LOW confidence)
- Model sizes for IP-Adapter, InstantID, PhotoMaker models -- estimated from community reports, not verified by direct download

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All custom nodes verified via official GitHub repos and READMEs
- Architecture: HIGH - Container configuration verified via docker exec and docker-compose.yml inspection
- Model requirements: HIGH for LatentSync (verified on HuggingFace), MEDIUM for others (from official READMEs but sizes estimated)
- Pitfalls: HIGH - Based on direct observation of the running system

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (30 days -- stable infrastructure)
