# LTX-2.3 Dual-Conditioning (LiconMSR + DWPose) Integration Architecture

**Status:** Implementation-ready design
**Date:** 2026-07-01
**Author:** Hermes Agent (architecture analysis)

---

## Table of Contents

1. [Overview & Goals](#1-overview--goals)
2. [Key Findings from Codebase Analysis](#2-key-findings-from-codebase-analysis)
3. [Architecture Decisions](#3-architecture-decisions)
4. [API Endpoints](#4-api-endpoints)
5. [ComfyUI Workflow JSON Topology](#5-comfyui-workflow-json-topology)
6. [Pose Preprocessing Pipeline](#6-pose-preprocessing-pipeline)
7. [Route File Structure](#7-route-file-structure)
8. [Frontend Integration Points](#8-frontend-integration-points)
9. [Config Changes](#9-config-changes)
10. [VRAM & Performance Considerations](#10-vram--performance-considerations)
11. [Implementation Checklist](#11-implementation-checklist)

---

## 1. Overview & Goals

### What we're building

A new LTX-2.3 video generation workflow that combines **two conditioning signals** simultaneously:

| Condition | Source | IC-LoRA | ComfyUI Node |
|-----------|--------|---------|--------------|
| **Identity** | ref1–ref5 reference images | `LTX-2.3-Licon-MSR-V1.safetensors` | `LiconMSR` → `LTXAddVideoICLoRAGuide` (Guide 1) |
| **Motion/Pose** | DWPose pose-map sequence (from Kimodo NPZ or video) | `ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors` | `LTXAddVideoICLoRAGuide` (Guide 2, chained from Guide 1) |

### Why dual-conditioning

The existing MSR workflow (`src/routes/production/ltx/msr.ts`) generates video with **identity consistency** but **no motion control** — the model decides how subjects move. By adding a second IC-LoRA guide injecting a DWPose pose-map sequence, we get:

- **Identity lock** from LiconMSR (character/scene appearance)
- **Motion lock** from Union Control IC-LoRA (body pose trajectory over time)

### Deliverables

1. New route file: `src/routes/production/ltx/msrPose.ts`
2. Pose preprocessing endpoint: `src/routes/production/ltx/posePreprocess.ts`
3. Config additions to `src/routes/production/ltx/config.ts`
4. Router registration in `src/router.ts`
5. Frontend canvas integration (node metadata + API wiring)
6. New ComfyUI model asset: `ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors`

---

## 2. Key Findings from Codebase Analysis

### 2.1 Existing MSR Workflow Pattern (`msr.ts` — 460 lines)

```
LowVRAMCheckpointLoader ("3")
    → LTXICLoRALoaderModelOnly ("10")     [applies LTX-2.3-Licon-MSR-V1]
    → CFGGuider ("37") model input

LTXAVTextEncoderLoader ("26") → CLIPTextEncode pos ("5") / neg ("6")
    → LTXVConditioning ("7")

LiconMSR ("28") [IMAGE output from ref images]
    → LTXAddVideoICLoRAGuide ("9")        [identity guide]
        inputs: positive/negative from ("7"), latent from ("8"), image from ("28")
        outputs: [0]=positive, [1]=negative, [2]=latent

CFGGuider ("37") → SamplerCustomAdvanced ("16") → VAEDecode → SaveVideo
```

**Critical insight:** `LTXAddVideoICLoRAGuide` outputs `(positive, negative, latent)` — all three can be **chained** into a second guide node. This is the mechanism for dual-conditioning.

### 2.2 ICLoRA Node Signatures (verified from source)

**`LTXICLoRALoaderModelOnly`** (`ComfyUI-LTXVideo/iclora.py:470`):
```
Inputs:  model (MODEL), lora_name (string), strength_model (float)
Outputs: model (MODEL), latent_downscale_factor (FLOAT)
```
→ Two loaders can be **chained sequentially**: Loader B takes Loader A's model output. Both LoRAs stack onto the same base model.

**`LTXAddVideoICLoRAGuide`** (`ComfyUI-LTXVideo/iclora.py:18`):
```
Inputs:  positive (CONDITIONING), negative (CONDITIONING), vae (VAE),
         latent (LATENT), image (IMAGE), frame_idx (int),
         strength (float), latent_downscale_factor (float),
         crop (disabled|center), use_tiled_encode (bool),
         tile_size (int), tile_overlap (int)
Outputs: positive (CONDITIONING), negative (CONDITIONING), latent (LATENT)
```
→ Guide 2 receives Guide 1's outputs. The final `CFGGuider` references Guide 2's conditioning.

### 2.3 LiconMSR Node (verified from source)

`ComfyUI-Licon-MSR/licon_msr.py` — takes up to 4 ref images + background, repeats them into `frame_count` (17/25/33/41) frames. Outputs a single IMAGE tensor. Pure CPU numpy/cv2 — no VRAM impact.

### 2.4 Container State (verified via `docker exec`)

| Component | Status |
|-----------|--------|
| `LTX-2.3-Licon-MSR-V1.safetensors` | ✅ Present in `/root/ComfyUI/models/loras/` |
| `ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors` | ❌ **MISSING — must be added** |
| `comfyui_controlnet_aux` | ✅ Installed (custom node dir exists) |
| `ComfyUI-Advanced-ControlNet` | ✅ Installed |
| DWPose Python module | ❌ `import dwpose` fails — **DWPose not functional** |
| `controlnet_aux` Python import | ❌ Not importable as standalone module |

**Implication:** DWPose-based pose extraction **cannot currently run inside ComfyUI**. The `comfyui_controlnet_aux` custom node pack is present but its DWPose backend (which requires `mmcv`, `mmpose`, `mmtrack`) is not installed. This drives Architecture Decision #1 below.

### 2.5 Platform Patterns

- **All LTX routes** share identical boilerplate: `LOCAL_STAGING_DIR`, `copyToContainer()`, `multer` upload, `validateFields()`, `axios.post` to ComfyUI `/prompt`.
- **Router registration:** Simple import + `app.use("/api/production/ltx/<name>", routeN)` in `src/router.ts`.
- **Response format:** `{ code, data, message }` via `success()` / `error()` from `@/lib/responseFormat`.
- **Config:** Single `config.ts` exports `LTX_CONFIG` + `LTX_DEFAULTS` objects.
- **Frontend canvas:** Node types are extensible via `NODE_SCHEMA` in `packages/infinite-canvas/src/constants.ts`. VideoNode already has a `ref-input` Handle for multi-reference wiring.

---

## 3. Architecture Decisions

### Decision 1: Pose-map conversion location → **Backend Python microservice (NOT ComfyUI, NOT Node/TS)**

**Options evaluated:**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| A. ComfyUI DWPose node | Native, no extra service | DWPose deps not installed; installing mmcv/mmpose in the container is fragile and adds ~4GB | ❌ |
| B. Node/TS backend | No new service | No native DWPose/npz library in Node ecosystem; would need ONNX runtime + custom pose model | ❌ |
| C. **Python microservice** | Clean separation, reuses Kimodo's existing NPZ format, can run on CPU | New service to deploy | ✅ **Chosen** |
| D. Pre-process offline, upload PNGs | Zero infra | Bad UX; user must manually convert every time | ❌ (fallback only) |

**Chosen approach:** A lightweight Python FastAPI service (`pose-preprocessor`) that:
1. Accepts a video file OR Kimodo NPZ file
2. Runs DWPose extraction (using `mmpose`/`ControlNet` pose pipeline)
3. Outputs pose-map PNG sequence (or a single contact-sheet image)
4. Returns filenames that get `docker cp`'d into ComfyUI's input dir

This service runs on CPU (pose extraction is lightweight) and can be containerized alongside the platform.

**Fallback path:** If the pose service is unavailable, the API accepts **pre-rendered pose-map PNGs** uploaded directly by the frontend (Option D). This makes the feature usable immediately without the microservice.

### Decision 2: Dual ICLoRA loading → **Sequential chaining (not parallel)**

Two `LTXICLoRALoaderModelOnly` nodes are **chained**:

```
LowVRAMCheckpointLoader → ICLoRA Loader 1 (MSR) → ICLoRA Loader 2 (Union Control) → CFGGuider
```

Both LoRAs stack onto the same model weights. This is the only correct approach — ComfyUI's model graph is linear; you cannot merge two model branches without a custom node. Both LoRAs contribute their delta to the same UNet.

**Strength tuning:** Each LoRA's `strength_model` is independently controllable. Default: MSR=1.0, UnionControl=0.5 (matching the `-ref0.5` in the filename, which suggests the reference strength during training).

### Decision 3: Dual guide injection → **Sequential chaining (Guide 1 → Guide 2)**

```
LTXVConditioning → Guide 1 (MSR identity) → Guide 2 (Pose motion) → CFGGuider
```

Guide 1 injects the LiconMSR identity frames at `frame_idx=0, strength=1.0`.
Guide 2 injects the DWPose pose-map sequence at `frame_idx=0, strength=0.5–0.8` (tunable).

Both guides operate on the **same latent** but at different `latent_downscale_factor` values if needed. The final conditioning (Guide 2's output) goes to `CFGGuider`.

### Decision 4: Pose-map representation → **Single contact-sheet IMAGE tensor**

The Union Control IC-LoRA expects an IMAGE input. The pose sequence must be a single IMAGE tensor of shape `(N, H, W, C)` where N = number of pose frames.

Two representations work:
1. **Individual pose-map PNGs** → loaded via `LoadImageBatch` or a custom batch node
2. **Single contact-sheet** → pre-stitched vertically, split inside the workflow

We use **approach 1** (batch of PNGs) loaded via a `LoadImageBatch` node, because `LTXAddVideoICLoRAGuide` expects a multi-frame IMAGE tensor and handles the temporal compression internally.

### Decision 5: How frontend passes pose reference → **Multipart upload (video or NPZ or PNG batch)**

The API accepts pose data in three forms via multipart fields:
- `poseVideo`: a video file (mp4/webm) — triggers server-side DWPose extraction
- `poseNpz`: a Kimodo NPZ file — triggers server-side NPZ→pose-map conversion
- `poseMap1`...`poseMapN`: pre-rendered pose-map PNGs — used directly

The route auto-detects which form was provided and processes accordingly.

---

## 4. API Endpoints

### 4.1 Primary Endpoint: `POST /api/production/ltx/msr-pose`

**Content-Type:** `multipart/form-data`

#### Required fields

| Field | Type | Description |
|-------|------|-------------|
| `projectId` | number | Project ID |
| `prompt` | string | Positive prompt |
| `ref1`–`ref5` | file | 2–5 identity reference images (ref1 = background) |
| `poseVideo` **OR** `poseNpz` **OR** `poseMap1+` | file(s) | Motion/pose source (exactly one form) |

#### Optional fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `duration` | number | 3 | Video seconds |
| `fps` | number | 24 | Frame rate |
| `width` | number | 1280 | Resolution width |
| `height` | number | 704 | Resolution height |
| `negativePrompt` | string | (preset) | Negative prompt |
| `seed` | number | random | Noise seed |
| `msrStrength` | number | 1.0 | LiconMSR IC-LoRA strength |
| `poseStrength` | number | 0.6 | Union Control IC-LoRA strength |
| `poseGuideStrength` | number | 0.7 | Guide 2 injection strength (0–1) |
| `outputFilename` | string | auto | Output filename prefix |
| `outputDir` | string | "" | Container output subdirectory |

#### Response (200)

```json
{
  "code": 200,
  "data": {
    "promptId": "abc-123-def",
    "status": "pending",
    "message": "LTX MSR+Pose dual-conditioning task submitted",
    "refCount": 3,
    "poseSource": "video",
    "poseFrameCount": 73,
    "params": {
      "width": 1280,
      "height": 704,
      "duration": "3.0s",
      "fps": 24,
      "numFrames": 73,
      "msrFrameCount": 41,
      "msrStrength": 1.0,
      "poseStrength": 0.6,
      "poseGuideStrength": 0.7,
      "seed": 12345,
      "trimFrames": 22,
      "trimSec": 0.9167
    }
  },
  "message": "成功"
}
```

#### Error responses

| Status | Condition |
|--------|-----------|
| 400 | Fewer than 2 ref images; no pose source provided; multiple pose sources |
| 422 | Pose preprocessing failed (invalid video, corrupt NPZ) |
| 502 | ComfyUI rejected the workflow or unreachable |

---

### 4.2 Pose Preprocessing Endpoint: `POST /api/production/ltx/pose-preprocess`

**Content-Type:** `multipart/form-data`

Standalone endpoint for pose extraction (can be called independently for preview/caching).

| Field | Type | Description |
|-------|------|-------------|
| `source` | file | Video file (mp4/webm/mov) OR Kimodo NPZ file |
| `sourceType` | string | `"video"` or `"npz"` (auto-detected if omitted) |
| `maxFrames` | number | Max pose frames to extract (default: 97) |
| `width` | number | Target width for pose-maps (default: 768) |
| `height` | number | Target height for pose-maps (default: 1024) |
| `format` | string | `"png_batch"` (default) or `"npz"` |

**Response (200):**
```json
{
  "code": 200,
  "data": {
    "poseMapFilenames": ["pose_0001.png", "pose_0002.png", "..."],
    "frameCount": 73,
    "sourceType": "video",
    "processingTimeMs": 4523
  },
  "message": "成功"
}
```

The PNGs are placed in ComfyUI's input dir (`/root/ComfyUI/input/`) ready for workflow use.

---

## 5. ComfyUI Workflow JSON Topology

### 5.1 Node graph overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  MODEL LOADING (sequential IC-LoRA stacking)                            │
│                                                                         │
│  LowVRAMCheckpointLoader ──model──► ICLoRA Loader 1 (MSR)             │
│     ("3")                              │                                │
│                                        ├──model──► ICLoRA Loader 2     │
│                                        │              (Union Ctrl)     │
│                                        │                  │            │
│                                        │                  ├──model──► CFGGuider
│                                        │                  └──ldf──┐    │
│                                        └──ldf──┐               │    │
│                                                │               │    │
└────────────────────────────────────────────────│───────────────│────┘
                                                 │               │
┌────────────────────────────────────────────────│───────────────│────┐
│  TEXT ENCODING                                 │               │    │
│                                                │               │    │
│  LTXAVTextEncoderLoader ──► CLIPTextEncode pos │     CLIPText  │    │
│       ("26")               ("5")           ────┤     Encode    │    │
│                                       ───► neg │     neg ("6") │    │
│                                                │               │    │
│                          LTXVConditioning ◄────┘               │    │
│                               ("7")                            │    │
└────────────────────────────────┬───────────────────────────────│────┘
                                 │                               │
┌────────────────────────────────│───────────────────────────────│────┐
│  CONDITIONING GUIDE CHAIN      │                               │    │
│                                 ▼                               ▼    │
│                    ┌──────────────────────┐         ┌──────────────┐ │
│  LiconMSR ("28")──►│ Guide 1: MSR ("9")   │────────►│ latent       │ │
│  [from ref images] │ pos,neg from ("7")   │         │ downscale    │ │
│                    │ latent from ("8")    │         │ factor mux   │ │
│                    │ ldf from Loader 1    │         │ ("50")       │ │
│                    └──────────┬───────────┘         └──────┬───────┘ │
│                               │                            │         │
│                               ▼                            ▼         │
│                    ┌──────────────────────────────────────────────┐  │
│  PoseMaps ("45")──►│ Guide 2: Pose ("46")                         │  │
│  [LoadImageBatch]  │ pos,neg,latent from Guide 1 ("9")           │  │
│                    │ ldf from Loader 2                            │  │
│                    │ strength = poseGuideStrength (0.7)           │  │
│                    └──────────────────────┬───────────────────────┘  │
└───────────────────────────────────────────│──────────────────────────┘
                                            │
┌───────────────────────────────────────────│──────────────────────────┐
│  SAMPLING                                 ▼                          │
│                                                               ┌──────┐│
│  EmptyLatent ("8") ──► LTXVConcatAVLatent ("23") ◄── AudioLatent│      ││
│                              │                                │      ││
│                              ▼                                │      ││
│                     SamplerCustomAdvanced ("16") ◄── CFGGuider │      ││
│                              │                                └──────┘│
│                              ▼                                        │
│                     LTXVSeparateAVLatent ("24")                      │
│                       ├──► VAEDecode ("38") ──► CreateVideo ("19")   │
│                       └──► AudioVAEDecode ("25") ──► SaveVideo ("20")│
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 Full workflow JSON (API format)

This is the exact JSON that `buildMSRPoseWorkflow()` will produce. Node IDs are chosen to not collide with the existing MSR workflow.

```json
{
  "3": {
    "class_type": "LowVRAMCheckpointLoader",
    "inputs": {
      "ckpt_name": "ltx-2.3-22b-distilled-1.1.safetensors"
    }
  },
  "26": {
    "class_type": "LTXAVTextEncoderLoader",
    "inputs": {
      "text_encoder": "gemma_3_12B_it_fp8_scaled.safetensors",
      "ckpt_name": "ltx-2.3-22b-distilled-1.1.safetensors",
      "device": "default"
    }
  },

  "10": {
    "class_type": "LTXICLoRALoaderModelOnly",
    "inputs": {
      "model": ["3", 0],
      "lora_name": "LTX-2.3-Licon-MSR-V1.safetensors",
      "strength_model": 1.0
    }
  },
  "11": {
    "class_type": "LTXICLoRALoaderModelOnly",
    "inputs": {
      "model": ["10", 0],
      "lora_name": "ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors",
      "strength_model": 0.6
    }
  },

  "5": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "<PROMPT>", "clip": ["26", 0] }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "<NEGATIVE_PROMPT>", "clip": ["26", 0] }
  },
  "7": {
    "class_type": "LTXVConditioning",
    "inputs": {
      "positive": ["5", 0],
      "negative": ["6", 0],
      "frame_rate": 24
    }
  },

  "21": {
    "class_type": "LTXVAudioVAELoader",
    "inputs": { "ckpt_name": "ltx-2.3-22b-distilled-1.1.safetensors" }
  },

  "8": {
    "class_type": "EmptyLTXVLatentVideo",
    "inputs": { "width": 1280, "height": 704, "length": 73, "batch_size": 1 }
  },
  "22": {
    "class_type": "LTXVEmptyLatentAudio",
    "inputs": {
      "audio_vae": ["21", 0],
      "frames_number": 73,
      "frame_rate": 24,
      "batch_size": 1
    }
  },

  "30": {
    "class_type": "LoadImage",
    "inputs": { "image": "<background.png>" }
  },
  "40": {
    "class_type": "LoadImage",
    "inputs": { "image": "<ref1.png>" }
  },
  "41": {
    "class_type": "LoadImage",
    "inputs": { "image": "<ref2.png>" }
  },

  "28": {
    "class_type": "LiconMSR",
    "inputs": {
      "width": 1280,
      "height": 704,
      "frame_count": 41,
      "1": ["40", 0],
      "2": ["41", 0],
      "background": ["30", 0]
    }
  },

  "45": {
    "class_type": "VHS_LoadImagesPath",
    "inputs": {
      "directory": "<pose_maps_dir>",
      "image_load_cap": 97,
      "skip_first_images": 0,
      "select_every_nth": 1,
      "meta_batch": false,
      "choose folder to upload": ""
    }
  },

  "9": {
    "class_type": "LTXAddVideoICLoRAGuide",
    "inputs": {
      "positive": ["7", 0],
      "negative": ["7", 1],
      "vae": ["3", 2],
      "latent": ["8", 0],
      "image": ["28", 0],
      "frame_idx": 0,
      "strength": 1.0,
      "latent_downscale_factor": ["10", 1],
      "crop": "center",
      "use_tiled_encode": false,
      "tile_size": 256,
      "tile_overlap": 64
    }
  },

  "46": {
    "class_type": "LTXAddVideoICLoRAGuide",
    "inputs": {
      "positive": ["9", 0],
      "negative": ["9", 1],
      "vae": ["3", 2],
      "latent": ["9", 2],
      "image": ["45", 0],
      "frame_idx": 0,
      "strength": 0.7,
      "latent_downscale_factor": ["11", 1],
      "crop": "center",
      "use_tiled_encode": false,
      "tile_size": 256,
      "tile_overlap": 64
    }
  },

  "23": {
    "class_type": "LTXVConcatAVLatent",
    "inputs": {
      "video_latent": ["46", 2],
      "audio_latent": ["22", 0]
    }
  },

  "15": {
    "class_type": "RandomNoise",
    "inputs": { "noise_seed": 123456789 }
  },
  "27": {
    "class_type": "ManualSigmas",
    "inputs": {
      "sigmas": "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0"
    }
  },
  "13": {
    "class_type": "KSamplerSelect",
    "inputs": { "sampler_name": "euler" }
  },
  "37": {
    "class_type": "CFGGuider",
    "inputs": {
      "model": ["11", 0],
      "positive": ["46", 0],
      "negative": ["46", 1],
      "cfg": 1.0
    }
  },
  "16": {
    "class_type": "SamplerCustomAdvanced",
    "inputs": {
      "noise": ["15", 0],
      "guider": ["37", 0],
      "sampler": ["13", 0],
      "sigmas": ["27", 0],
      "latent_image": ["23", 0]
    }
  },

  "24": {
    "class_type": "LTXVSeparateAVLatent",
    "inputs": { "av_latent": ["16", 0] }
  },
  "17": {
    "class_type": "LTXVCropGuides",
    "inputs": {
      "positive": ["46", 0],
      "negative": ["46", 1],
      "latent": ["24", 0]
    }
  },
  "38": {
    "class_type": "VAEDecode",
    "inputs": { "samples": ["17", 2], "vae": ["3", 2] }
  },
  "25": {
    "class_type": "LTXVAudioVAEDecode",
    "inputs": {
      "samples": ["24", 1],
      "audio_vae": ["21", 0]
    }
  },
  "19": {
    "class_type": "CreateVideo",
    "inputs": {
      "images": ["38", 0],
      "audio": ["25", 0],
      "fps": 24
    }
  },
  "20": {
    "class_type": "SaveVideo",
    "inputs": {
      "video": ["19", 0],
      "filename_prefix": "<OUTPUT_PREFIX>",
      "format": "auto",
      "codec": "auto"
    }
  }
}
```

### 5.3 Key topology notes

1. **IC-LoRA chain:** Node `"10"` (MSR) → feeds model into node `"11"` (Union Control). Node `"11"`'s model output goes to `CFGGuider ("37")`.
2. **`latent_downscale_factor` from LoRA metadata:** Each guide node receives its `latent_downscale_factor` from its corresponding loader's second output `["10", 1]` / `["11", 1]`. This auto-extracts the correct downscale factor from the safetensors metadata.
3. **Guide chain:** Guide 1 (`"9"`) receives raw conditioning from `"7"` and latent from `"8"`. Guide 2 (`"46"`) receives Guide 1's outputs. `CFGGuider` and `SamplerCustomAdvanced` reference Guide 2's outputs.
4. **Pose image loading:** Node `"45"` (`VHS_LoadImagesPath`) loads the pose-map PNG sequence from a directory path as a single multi-frame IMAGE tensor. **Verified available** in container via `ComfyUI-VideoHelperSuite` custom node pack. Alternatives (all verified present): `VHS_LoadImages` (upload-based), or `MakeImageBatch` from Impact-Pack. See Appendix D for the exact node inputs.
5. **`LTXVCropGuides` references Guide 2** (`"46"`, not `"9"`), because the final conditioning after both guides is what the sampler uses.

---

## 6. Pose Preprocessing Pipeline

### 6.1 Architecture

```
┌──────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Frontend    │────►│  Backend (Express)   │────►│  Pose Processor │
│  (upload     │     │  msrPose.ts route    │     │  (Python µsvc)  │
│   video/npz) │     │                      │     │                 │
└──────────────┘     └──────────────────────┘     └────────┬────────┘
                                                            │
                                   ┌────────────────────────┘
                                   ▼
                          ┌────────────────────┐
                          │  DWPose Pipeline   │
                          │  (mmpose + mmtrack)│
                          │                    │
                          │  video → frames    │
                          │  → pose keypoints  │
                          │  → pose-map render │
                          │  → PNG sequence    │
                          └────────┬───────────┘
                                   │
                                   ▼
                          ┌────────────────────┐
                          │  docker cp PNGs    │
                          │  → ComfyUI input/  │
                          └────────────────────┘
```

### 6.2 Pose Processor Microservice

**Tech stack:** Python 3.11 + FastAPI + ultralytics/mmpose + OpenCV

**Dockerfile** (`docker/pose-processor/Dockerfile`):
```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y ffmpeg libgl1-mesa-glx libglib2.0-0
RUN pip install fastapi uvicorn python-multipart opencv-python numpy \
    mmcv-full mmpose mmdet onnxruntime
COPY pose_server.py /app/pose_server.py
WORKDIR /app
EXPOSE 8190
CMD ["uvicorn", "pose_server:app", "--host", "0.0.0.0", "--port", "8190"]
```

**Core endpoint** (`pose_server.py` sketch):
```python
@app.post("/extract-poses")
async def extract_poses(
    file: UploadFile,
    source_type: str = "video",
    max_frames: int = 97,
    width: int = 768,
    height: int = 1024,
):
    # 1. Save uploaded file to temp
    # 2. If video: ffmpeg extract frames
    # 3. If npz: load keypoints from Kimodo format
    # 4. Run DWPose (mmpose) on each frame
    # 5. Render pose-maps (skeleton on black background)
    # 6. Save as PNG sequence
    # 7. Return filenames
    ...
```

### 6.3 NPZ → Pose-Map Conversion (Kimodo format)

Kimodo outputs `.npz` files containing pose keypoints. The conversion logic:

```python
def npz_to_pose_maps(npz_path: str, output_dir: str, width: int, height: int):
    """
    Kimodo NPZ structure (typical):
      arr_0: keypoints array [N_frames, N_persons, 17, 2]  (COCO format)
      or
      all_kpts: [N_frames, N_keypoints, 3]  (x, y, confidence)
    """
    data = np.load(npz_path, allow_pickle=True)
    
    # Detect key name
    if 'arr_0' in data:
        kpts = data['arr_0']
    elif 'all_kpts' in data:
        kpts = data['all_kpts']
    else:
        kpts = data[list(data.keys())[0]]
    
    filenames = []
    for i, frame_kpts in enumerate(kpts):
        pose_map = render_pose(frame_kpts, width, height)
        fname = f"pose_{i:04d}.png"
        cv2.imwrite(os.path.join(output_dir, fname), pose_map)
        filenames.append(fname)
    
    return filenames
```

### 6.4 Integration with Express backend

The `msrPose.ts` route calls the pose processor via HTTP:

```typescript
async function preprocessPose(
  sourceFile: Express.Multer.File,
  sourceType: "video" | "npz",
  width: number,
  height: number,
  maxFrames: number,
): Promise<string[]> {
  const formData = new FormData();
  formData.append("file", fs.createReadStream(sourceFile.path), sourceFile.originalname);
  formData.append("source_type", sourceType);
  formData.append("max_frames", String(maxFrames));
  formData.append("width", String(width));
  formData.append("height", String(height));

  const res = await axios.post(
    `${POSE_PROCESSOR_URL}/extract-poses`,
    formData,
    { headers: formData.getHeaders(), timeout: 120_000 }
  );

  // Pose processor returns filenames relative to its output dir
  // We then docker cp them into ComfyUI
  const poseFiles = res.data.filenames as string[];
  return poseFiles;
}
```

**Config addition:**
```typescript
POSE_PROCESSOR_URL: process.env.POSE_PROCESSOR_URL || "http://localhost:8190",
```

### 6.5 Fallback: Pre-rendered pose PNGs

If `POSE_PROCESSOR_URL` is not configured or the service is down, the route checks for `poseMap1`...`poseMapN` uploaded files and uses them directly. This makes the feature immediately usable without deploying the microservice.

```typescript
const hasPoseService = !!process.env.POSE_PROCESSOR_URL;
const hasPoseVideo = !!files?.poseVideo?.[0];
const hasPoseNpz = !!files?.poseNpz?.[0];
const hasPoseMaps = !!files?.poseMap1?.[0];

if (!hasPoseService && (hasPoseVideo || hasPoseNpz)) {
  return res.status(422).send(error(
    "Pose processor service not configured. Upload pre-rendered poseMap PNGs instead, or set POSE_PROCESSOR_URL."
  ));
}
```

---

## 7. Route File Structure

### 7.1 New files to create

```
src/routes/production/ltx/
├── msrPose.ts           ← NEW: Main dual-conditioning route (primary deliverable)
├── posePreprocess.ts    ← NEW: Standalone pose preprocessing endpoint
├── config.ts            ← MODIFIED: Add pose-related config
└── msr.ts               ← UNCHANGED (existing single-conditioning route)

docker/
└── pose-processor/
    ├── Dockerfile       ← NEW: Pose microservice container
    └── pose_server.py   ← NEW: FastAPI pose extraction server

docker-compose.v9.yml    ← MODIFIED: Add pose-processor service
```

### 7.2 `msrPose.ts` — Structure (following `msr.ts` pattern exactly)

```typescript
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { LTX_CONFIG, LTX_DEFAULTS, LTX_POSE } from "./config";
import { calcTrimFrames, MSR_FRAME_COUNTS, pickMSRFrameCount, roundTo8nPlus1 }
  from "./msr"; // Reuse existing helpers

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-ltx-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}
const upload = multer({ dest: LOCAL_STAGING_DIR });

// Reuse copyToContainer from shared pattern
function copyToContainer(localPath: string, containerPath: string) { /* same as msr.ts */ }

// ─── Pose preprocessing ───────────────────────────────────

async function preprocessPose(
  sourceFile: Express.Multer.File,
  sourceType: "video" | "npz",
  width: number, height: number, maxFrames: number,
): Promise<string[]> { /* as described in section 6.4 */ }

// ─── Workflow builder ─────────────────────────────────────

function buildMSRPoseWorkflow(opts: {
  refFilenames: string[];
  poseMapFilenames: string[];   // pose-map PNG filenames in ComfyUI input dir
  prompt: string;
  negativePrompt: string;
  width: number; height: number;
  numFrames: number;
  msrFrameCount: number;
  fps: number;
  seed: number;
  msrStrength: number;          // IC-LoRA 1 strength
  poseStrength: number;         // IC-LoRA 2 strength
  poseGuideStrength: number;    // Guide 2 injection strength
  filenamePrefix: string;
}): Record<string, any> {
  // Returns the JSON topology from Section 5.2
  // Key differences from msr.ts:
  //   1. Two ICLoRA loaders (chained)
  //   2. Two guide nodes (chained)
  //   3. LoadImageBatch for pose-maps
  //   4. CFGGuider references Guide 2 + Loader 2
}

// ─── Route handler ────────────────────────────────────────

export default router.post(
  "/",
  upload.fields([
    { name: "ref1", maxCount: 1 },
    { name: "ref2", maxCount: 1 },
    { name: "ref3", maxCount: 1 },
    { name: "ref4", maxCount: 1 },
    { name: "ref5", maxCount: 1 },
    { name: "poseVideo", maxCount: 1 },
    { name: "poseNpz", maxCount: 1 },
    // Dynamic poseMap1...poseMapN handled separately
  ]),
  validateFields({
    projectId: z.coerce.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    // 1. Parse params (same pattern as msr.ts)
    // 2. Collect ref images
    // 3. Determine pose source:
    //    a. poseVideo → preprocessPose(file, "video", ...)
    //    b. poseNpz   → preprocessPose(file, "npz", ...)
    //    c. poseMap1+ → use directly
    // 4. Copy ref images to container
    // 5. Copy pose-map PNGs to container
    // 6. Build workflow
    // 7. Submit to ComfyUI
    // 8. Return promptId + params
  }
);
```

### 7.3 `posePreprocess.ts` — Structure

```typescript
import express from "express";
import multer from "multer";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { LTX_CONFIG, LTX_POSE } from "./config";

const router = express.Router();
const upload = multer({ dest: "/tmp/comfyui-ltx-input" });

export default router.post(
  "/",
  upload.single("source"),
  validateFields({}),
  async (req, res) => {
    if (!req.file) return res.status(400).send(error("source file required"));

    const sourceType = (req.body.sourceType as string) || "video";
    const maxFrames = Number(req.body.maxFrames) || 97;
    const width = Number(req.body.width) || 768;
    const height = Number(req.body.height) || 1024;

    try {
      const poseMapFilenames = await preprocessPose(
        req.file, sourceType as "video" | "npz",
        width, height, maxFrames,
      );
      res.status(200).send(success({
        poseMapFilenames,
        frameCount: poseMapFilenames.length,
        sourceType,
      }));
    } catch (err: any) {
      res.status(422).send(error(`Pose preprocessing failed: ${err.message}`));
    } finally {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
  }
);
```

### 7.4 Router registration (`src/router.ts`)

Add two new imports and registrations:

```typescript
// Add to imports (after line 33):
import route33b from "./routes/production/ltx/posePreprocess";
import route33c from "./routes/production/ltx/msrPose";

// Add to app.use() block (after line 161):
app.use("/api/production/ltx/msr-pose", route33c);
app.use("/api/production/ltx/pose-preprocess", route33b);
```

---

## 8. Frontend Integration Points

### 8.1 Canvas node type extension

The existing `VideoNode` already supports a `ref-input` Handle. For pose input, we add a **third input Handle** or reuse the existing ref-input with semantic differentiation.

**Option A (recommended): Reuse existing ref-input Handle, add metadata**

No new node type needed. The video node's `ref-input` Handle connects to either:
- Asset nodes (identity references) — existing behavior
- A new **"pose source" asset node** (video/npz uploaded as an asset)

The `engine` field in video node metadata distinguishes the generation mode:
```typescript
// In VIDEO_METADATA_LABELS.engine, add:
'msr_pose': 'LTX MSR+Pose',
```

### 8.2 Constants update (`packages/infinite-canvas/src/constants.ts`)

```typescript
// Add to VIDEO_METADATA_LABELS:
export const VIDEO_METADATA_LABELS = {
  engine: {
    'ltx': 'LTX-Video',
    'ltx_msr': 'LTX LiconMSR',         // NEW
    'ltx_msr_pose': 'LTX MSR+Pose',    // NEW
    'wan': 'Wan 2.2',
    // ... existing entries
  },
  // Add pose-specific structured field
  poseSource: {
    'video': '视频驱动',
    'npz': 'Kimodo NPZ',
    'png_batch': '姿势图序列',
  },
} as const;

// Add to NODE_SCHEMA.video:
video: [
  // ... existing fields
  { key: 'engine', label: '引擎', type: 'enum', options: VIDEO_METADATA_LABELS.engine },
  { key: 'poseSource', label: '姿势源', type: 'enum', options: VIDEO_METADATA_LABELS.poseSource },
  { key: 'poseStrength', label: '姿势强度', type: 'number', min: 0, max: 1, step: 0.05 },
  { key: 'msrStrength', label: '身份强度', type: 'number', min: 0, max: 1, step: 0.05 },
],
```

### 8.3 Canvas API service (`packages/infinite-canvas/src/services/canvasApi.ts`)

Add a new API call function for the MSR+Pose workflow:

```typescript
export async function submitLtxMsrPose(params: {
  projectId: number;
  prompt: string;
  refImages: File[];       // identity references
  poseSource: File;        // video or npz
  poseSourceType: 'video' | 'npz';
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  msrStrength?: number;
  poseStrength?: number;
  poseGuideStrength?: number;
  seed?: number;
}): Promise<{ promptId: string }> {
  const formData = new FormData();
  formData.append('projectId', String(params.projectId));
  formData.append('prompt', params.prompt);

  params.refImages.forEach((file, i) => {
    formData.append(`ref${i + 1}`, file);
  });

  if (params.poseSourceType === 'video') {
    formData.append('poseVideo', params.poseSource);
  } else {
    formData.append('poseNpz', params.poseSource);
  }

  // Optional params
  if (params.duration) formData.append('duration', String(params.duration));
  if (params.fps) formData.append('fps', String(params.fps));
  if (params.msrStrength) formData.append('msrStrength', String(params.msrStrength));
  if (params.poseStrength) formData.append('poseStrength', String(params.poseStrength));
  if (params.poseGuideStrength) formData.append('poseGuideStrength', String(params.poseGuideStrength));

  const res = await fetch(`${API_BASE}/production/ltx/msr-pose`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, 'network', res.status);
  const json = await res.json();
  return { promptId: json.data.promptId };
}
```

### 8.4 NodeDetailPanel — Pose source upload UI

The `NodeDetailPanel` component (`packages/infinite-canvas/src/components/NodeDetailPanel.tsx`) needs a conditional upload section when `engine === 'ltx_msr_pose'`:

- **Pose source selector:** dropdown (Video / NPZ / PNG Batch)
- **File upload zone:** accepts the selected type
- **Pose preview:** after upload, show the first few pose-map frames
- **Strength sliders:** `msrStrength`, `poseStrength`, `poseGuideStrength`

This is the primary frontend work — roughly 100–150 lines of JSX in NodeDetailPanel.

### 8.5 VideoNode visual indicator

When a video node uses MSR+Pose mode, show a small badge:
```tsx
{data.engine === 'ltx_msr_pose' && (
  <span style={{ fontSize: 9, background: '#9b59b6', padding: '1px 4px', borderRadius: 3 }}>
    🕺 姿态驱动
  </span>
)}
```

---

## 9. Config Changes

### 9.1 `src/routes/production/ltx/config.ts` additions

```typescript
export const LTX_CONFIG = {
  comfyuiUrl: process.env.LTX_COMFYUI_URL || process.env.COMFYUI_URL || "http://localhost:8188",
  containerName: process.env.LTX_CONTAINER_NAME || "comfyui-primary",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output",
  comfyuiInputDir: "/root/ComfyUI/input",
  comfyuiOutputDir: "/root/ComfyUI/output",
  pollIntervalMs: 2000,
  pollTimeoutMs: 600_000,
  // ↓ NEW
  poseProcessorUrl: process.env.POSE_PROCESSOR_URL || "",  // empty = service disabled
};

export const LTX_DEFAULTS = {
  modelName: "ltx-2.3-22b-distilled-mxfp8.safetensors",
  clipName1: "gemma_3_12B_it_fp8_scaled.safetensors",
  clipName2: "ltx-2.3_text_projection_bf16.safetensors",
  vaeName: "ltx2_vae/LTX23_video_vae_bf16.safetensors",
  loraName: "ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
  msrLoraName: "LTX-2.3-Licon-MSR-V1.safetensors",
  msrModelName: "ltx-2.3-22b-distilled-1.1.safetensors",
  // ↓ NEW
  unionControlLoraName: "ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors",
};

// ↓ NEW
export const LTX_POSE = {
  /** Default strengths for dual-conditioning */
  msrStrength: 1.0,           // IC-LoRA 1 (identity)
  poseLoraStrength: 0.6,      // IC-LoRA 2 (union control)
  poseGuideStrength: 0.7,     // Guide 2 injection
  /** Pose extraction defaults */
  poseMapWidth: 768,
  poseMapHeight: 1024,
  maxPoseFrames: 97,          // ~4s at 24fps, rounded to 8n+1
  /** Whether to auto-trim MSR conditioning frames from output */
  autoTrim: false,
};

export const LTX_MSR_TRIM = {
  vaeTemporalFactor: 8,
  autoTrim: false,
};
```

### 9.2 `.env` additions

```bash
# Pose processor microservice (optional — omit to require pre-rendered PNGs)
POSE_PROCESSOR_URL=http://pose-processor:8190
```

### 9.3 `docker-compose.v9.yml` additions

```yaml
services:
  pose-processor:
    build:
      context: ./docker/pose-processor
      dockerfile: Dockerfile
    container_name: pose-processor
    ports:
      - "8190:8190"
    volumes:
      - /tmp/comfyui-ltx-input:/data/pose-output
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 4G
    # CPU-only; no GPU needed for pose extraction
```

### 9.4 ComfyUI model addition

The Union Control IC-LoRA must be placed in the container:
```bash
# Download ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors
# Place at: /data/models/comfyui/loras/ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors
# (The docker-compose volume maps this to /root/ComfyUI/models/loras/ inside the container)
```

### 9.5 `LoadImageBatch` node availability

Verify `LoadImageBatch` exists in the container. If not, add it via the incremental nodes mount or use an alternative:

```bash
# Check:
docker exec comfyui-primary python3 -c "from custom_nodes import NODE_CLASS_MAPPINGS; print('LoadImageBatch' in str(NODE_CLASS_MAPPINGS))" 2>/dev/null

# If missing, install ComfyUI-Impact-Pack or ComfyUI_essentials which provide batch loading
```

**Fallback:** Pre-stitch pose-maps into a single vertical contact-sheet PNG, load via `LoadImage`, then split with `ImageBatch` or a crop+stack sequence. This avoids the `LoadImageBatch` dependency entirely.

---

## 10. VRAM & Performance Considerations

### 10.1 VRAM budget on RTX 3090 (24GB)

| Component | VRAM | Notes |
|-----------|------|-------|
| Base model (22B distilled, mxfp8) | ~11 GB | `LowVRAMCheckpointLoader` offloads CLIP to CPU |
| IC-LoRA 1 (MSR) delta | ~0.5 GB | Applied in-place to model weights |
| IC-LoRA 2 (Union Control) delta | ~0.5 GB | Stacked on top of LoRA 1 |
| Text encoder (Gemma 12B fp8) | ~6 GB | Offloaded via `LowVRAMCheckpointLoader` |
| VAE (video + audio) | ~1.5 GB | Shared from checkpoint |
| Latent (73 frames, 1280×704) | ~0.8 GB | 5D video latent |
| Guide 1 latent (41 MSR frames) | ~0.3 GB | Separate conditioning latent |
| Guide 2 latent (pose-map frames) | ~0.4 GB | Separate conditioning latent |
| Sampler working memory | ~2 GB | Attention intermediates |
| **Total estimate** | **~23 GB** | **Tight on 24GB — may OOM** |

### 10.2 Mitigation strategies

1. **Enable tiled VAE encoding** for both guides: `use_tiled_encode: true, tile_size: 256, tile_overlap: 64`. This reduces peak VAE memory by ~40%.

2. **Reduce resolution for testing:** Start with 768×448 (instead of 1280×704) to validate the pipeline, then scale up.

3. **Reduce `numFrames`:** 73 frames (3s) is safe. For longer videos, use the existing `extension.ts` route to extend in a second pass.

4. **Sequential guide processing:** ComfyUI processes Guide 1 then Guide 2 sequentially (not in parallel), so only one guide's intermediates are in VRAM at a time. The guide chain is inherently memory-efficient.

5. **Offload text encoder after encoding:** The `LowVRAMCheckpointLoader` already handles this. The text encoder is loaded, used for CLIP encoding, then offloaded before sampling.

6. **`latent_downscale_factor`:** The Union Control IC-LoRA's metadata may specify a downscale factor >1, which reduces the guide latent resolution and saves memory. The loader auto-extracts this from metadata.

### 10.3 Expected generation time (RTX 3090, 22B distilled, 8 sigmas)

| Resolution | Frames | Time (est.) |
|------------|--------|-------------|
| 768×448 | 49 | ~45s |
| 1280×704 | 73 | ~2min |
| 1280×704 | 97 | ~3min |

These are similar to existing MSR timings — the dual-conditioning adds ~10–15% overhead from the extra guide VAE encoding, but sampling speed is unchanged (same number of denoising steps).

---

## 11. Implementation Checklist

### Phase 1: Model + Config (no code changes needed to test)

- [ ] **Download** `ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors` → place in `/data/models/comfyui/loras/`
- [ ] **Verify** the LoRA loads: `docker exec comfyui-primary python3 -c "import folder_paths; print('ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors' in folder_paths.get_filename_list('loras'))"`
- [ ] **Verify** `LoadImageBatch` node exists in container (or plan contact-sheet fallback)
- [ ] **Update** `config.ts` with `LTX_POSE` + `unionControlLoraName`
- [ ] **Update** `.env` with `POSE_PROCESSOR_URL` (or leave empty for PNG-only mode)

### Phase 2: Backend routes

- [ ] **Create** `src/routes/production/ltx/msrPose.ts` (~350 lines, following `msr.ts` pattern)
- [ ] **Create** `src/routes/production/ltx/posePreprocess.ts` (~80 lines)
- [ ] **Register** both routes in `src/router.ts`
- [ ] **Export** `buildMSRPoseWorkflow()` for unit testing
- [ ] **Test** workflow JSON submission to ComfyUI (dry run with mock pose PNGs)

### Phase 3: Pose processor microservice

- [ ] **Create** `docker/pose-processor/Dockerfile`
- [ ] **Create** `docker/pose-processor/pose_server.py` (FastAPI + mmpose)
- [ ] **Add** `pose-processor` service to `docker-compose.v9.yml`
- [ ] **Test** video → pose-map extraction end-to-end
- [ ] **Test** NPZ → pose-map conversion (Kimodo format, **SOMA-77 skeleton** is default)
- [ ] **Implement** SOMA-77 → OpenPose BODY-25 joint mapping table in `pose_server.py`

### Phase 4: Frontend

- [ ] **Update** `constants.ts` — add engine enum + pose structured fields
- [ ] **Add** `submitLtxMsrPose()` to `canvasApi.ts`
- [ ] **Add** pose source upload UI to `NodeDetailPanel.tsx`
- [ ] **Add** MSR+Pose badge to `VideoNode.tsx`
- [ ] **Test** full canvas → backend → ComfyUI flow

### Phase 5: Polish

- [ ] **Add** auto-trim integration (reuse `calcTrimFrames` + `trim.ts`)
- [ ] **Add** progress polling via WebSocket (existing `broadcastToProject` pattern)
- [ ] **Write** integration test: upload refs + pose video → verify promptId returned
- [ ] **Document** API in `docs/` (reference this design doc)

---

## Appendix A: Difference from existing `msr.ts`

| Aspect | `msr.ts` (existing) | `msrPose.ts` (new) |
|--------|---------------------|---------------------|
| IC-LoRA loaders | 1 (MSR) | 2 (MSR + Union Control, chained) |
| Guide nodes | 1 (identity) | 2 (identity + pose, chained) |
| Pose input | None | Video / NPZ / PNG batch |
| Pose preprocessing | None | External microservice or pre-rendered |
| CFGGuider model | Loader 1 output | Loader 2 output (both LoRAs applied) |
| CFGGuider conditioning | Guide 1 output | Guide 2 output (both guides applied) |
| `calcTrimFrames` | Used for MSR trim | Same (MSR trim still applies) |
| Output | Video with identity | Video with identity + motion |

## Appendix B: `latent_downscale_factor` handling

Each `LTXICLoRALoaderModelOnly` extracts `reference_downscale_factor` from the LoRA's safetensors metadata and outputs it. The corresponding guide node receives this as its `latent_downscale_factor` input:

- Guide 1: `latent_downscale_factor: ["10", 1]` (from MSR loader)
- Guide 2: `latent_downscale_factor: ["11", 1]` (from Union Control loader)

If the metadata is missing, the loader defaults to `1.0`. This ensures the guide latent resolution matches what each IC-LoRA was trained on.

## Appendix D: Verified ComfyUI Node Availability

All node classes below were verified present in the `comfyui-primary` container via `docker exec` inspection (2026-07-01):

| Node class_type | Package | Status | Used for |
|-----------------|---------|--------|----------|
| `LowVRAMCheckpointLoader` | ComfyUI-LTXVideo | ✅ | Base model loading |
| `LTXAVTextEncoderLoader` | ComfyUI-LTXVideo | ✅ | Text encoder |
| `LTXICLoRALoaderModelOnly` | ComfyUI-LTXVideo | ✅ | IC-LoRA loading (both MSR + Union Control) |
| `LTXAddVideoICLoRAGuide` | ComfyUI-LTXVideo | ✅ | Guide injection (both identity + pose) |
| `LiconMSR` | ComfyUI-Licon-MSR | ✅ | Multi-reference identity frame generation |
| `LTXVConditioning` | ComfyUI-LTXVideo | ✅ | Conditioning |
| `EmptyLTXVLatentVideo` | ComfyUI-LTXVideo | ✅ | Empty latent |
| `LTXVEmptyLatentAudio` | ComfyUI-LTXVideo | ✅ | Empty audio latent |
| `LTXVAudioVAELoader` | ComfyUI-LTXVideo | ✅ | Audio VAE |
| `LTXVConcatAVLatent` | ComfyUI-LTXVideo | ✅ | AV latent concat |
| `LTXVSeparateAVLatent` | ComfyUI-LTXVideo | ✅ | AV latent separation |
| `LTXVCropGuides` | ComfyUI-LTXVideo | ✅ | Guide cropping |
| `VAEDecode` | ComfyUI core | ✅ | Latent → pixels |
| `LTXVAudioVAEDecode` | ComfyUI-LTXVideo | ✅ | Audio latent → audio |
| `CreateVideo` | ComfyUI-LTXVideo | ✅ | Video composition |
| `SaveVideo` | ComfyUI-LTXVideo | ✅ | Output saving |
| `CLIPTextEncode` | ComfyUI core | ✅ | Prompt encoding |
| `RandomNoise` | ComfyUI core | ✅ | Noise seed |
| `ManualSigmas` | ComfyUI core | ✅ | Sigma schedule |
| `KSamplerSelect` | ComfyUI core | ✅ | Sampler selection |
| `CFGGuider` | ComfyUI core | ✅ | CFG guidance |
| `SamplerCustomAdvanced` | ComfyUI core | ✅ | Sampling |
| `LoadImage` | ComfyUI core | ✅ | Reference image loading |
| **`VHS_LoadImagesPath`** | **ComfyUI-VideoHelperSuite** | **✅** | **Pose-map PNG sequence loading** |
| `VHS_LoadImages` | ComfyUI-VideoHelperSuite | ✅ | Alternative (upload-based) |
| `VHS_VideoCombine` | ComfyUI-VideoHelperSuite | ✅ | Alternative output (used in singularityFFLF) |
| `MakeImageBatch` | ComfyUI-Impact-Pack | ✅ | Alternative batch assembly |

### `VHS_LoadImagesPath` node inputs (verified)

```python
class_type: "VHS_LoadImagesPath"
inputs:
  directory: <path to folder containing PNGs>
  image_load_cap: 97        # max frames to load (0 = all)
  skip_first_images: 0
  select_every_nth: 1
  meta_batch: false
  choose folder to upload: ""  # for upload mode
outputs:
  [0]: IMAGE (multi-frame tensor, shape [N, H, W, C])
  [1]: MASK
  [2]: VHS_FILENAMES (metadata)
```

### Missing components (must be provisioned before implementation)

| Component | Action |
|-----------|--------|
| `ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors` | Download → `/data/models/comfyui/loras/` |
| DWPose runtime (`mmpose`, `mmtrack`, `mmcv`) | Install in `pose-processor` container (NOT in comfyui-primary) |
| `pose-processor` microservice | Build from `docker/pose-processor/Dockerfile` |
