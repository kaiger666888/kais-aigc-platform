# Minimax H3 — 二采重绘放大 (Second-Sampling Redraw Upscale)

Two sampler passes around `MiniMaxH3LatentUpscaleCombined` (Tr1dae): pass 1 generates at low
resolution, the latent is **spatially upscaled + re-noised**, then pass 2 redraws detail at higher
resolution. Result: sharper output + stronger identity/consistency than a single pass, at far lower
VRAM than generating the high-res frame directly.

Stock `LatentUpscaleBy` / `AddNoise` corrupt MiniMax H3's packed `NestedTensor` AV latent
(`video [B,24,T,H/16,W/16]` + `audio [B,32,2,T_audio]`). The Tr1dae node is the only correct way to
upscale between two H3 samplers.

## Verified (2026-08-12 smoke render)
Ran end-to-end on `comfyui-primary` (3090, int8): pass1 864×480 → `MiniMaxH3LatentUpscaleCombined`
scale_by 1.5 → pass2 **1312×736**, 73 frames / 3.04 s, **h264 + aac audio intact**, 202 s render, ~23.7 GB VRAM.
Confirms the full 2-pass pipeline + that audio survives the redraw at `audio_denoise=0.35`.
(Prompt-only, no ref images — purely a pipeline check. Attach ref images via `MiniMaxH3ReferenceToVideo`
to lock identity/consistency.)

## ⚠ Output directory caveat
`fix-kornia.sh` overrides `CLI_ARGS` to `--enable-triton-backend --use-sage-attention --reserve-vram 1`,
which **drops** the compose's `--output-directory /mnt/agents/output/gpu1` **and** `--lowvram`. Consequences:
1. Renders save to the container's default `/root/ComfyUI/output/` (writable layer), **not** the bind-mounted
   `gpu1/` dir — copy files out promptly; they're lost on `docker compose` recreate.
2. No `--lowvram` → VRAM runs near the 24 GB ceiling. Add `--lowvram` back into the hook's `CLI_ARGS` before
   pushing scale_by / frame count higher (see `project_3090_xid31_mmu_fault`).

## Files
- `h3_redraw_upscale_api.json` — API format, queue via `POST /prompt` (used by the smoke test)
- `h3_redraw_upscale.json` — UI graph format, open in the ComfyUI editor (also in the container at
  `/root/ComfyUI/user/default/workflows/`)
- `build_workflow.py` — regenerator; validates every node/input against live `/object_info`

## The graph

```
UNETLoader ─┐
CLIPLoader ─┤
VAELoader(vid) ─┤
VAELoader(aud) ─┤
            ├─► TESpeedMiniMaxH3 ──► (patched MODEL, used everywhere below)
            ├─► MiniMaxH3ReferenceToVideo ──► CONDITIONING, LATENT(low-res)
            │                                      │
RandomNoise ─► SamplerCustomAdvanced ◄── BasicGuider ◄── conditioning   [PASS 1: low-res, full denoise]
              KSamplerSelect   ▲                  ▲
              BasicScheduler(denoise=1.0, steps=20)┘
                    │ denoised_output
                    ▼
              ★ MiniMaxH3LatentUpscaleCombined ★   scale_by=1.5, audio_denoise=0.35
                    │   (upscales video latent + scales minimax_refs to new canvas; re-noises at sigmas[0])
                    │   positive=ref2va conditioning → upscaled CONDITIONING
                    ▼ upscaled LATENT
DisableNoise ► SamplerCustomAdvanced ◄── BasicGuider ◄── upscaled conditioning   [PASS 2: high-res redraw]
              KSamplerSelect   ▲
              BasicScheduler(denoise=0.35, steps=10) ◄── also feeds Combined.sigmas
                    │
                    ▼
              VAEDecode + VAEDecodeAudio ──► CreateVideo ──► final high-res MP4 (with audio)
```

## Key parameters

| Param | Default | Notes |
|---|---|---|
| **pass-1 res** | 0.4 MP (864×480) | Cheap first pass. Lower = faster pass 1, more for pass 2 to redraw. |
| **`scale_by`** | 1.5 | pass-1 → pass-2 upscale. 1.5× → ~0.9 MP. 2.0× → ~1.6 MP (heavy on 24 GB). |
| **`audio_denoise`** | 0.35 | How hard pass 2 may rewrite **audio**. `0` = lock pass-1 audio (clean, no remix). `1` = full re-noise (sampler 2 can improve audio, risks garble). `0.25–0.5` = light polish. If audio garbles, run more of the schedule in pass 1 (audio settles late) or lower this. |
| **pass-2 `denoise`** | 0.35 | Video redraw strength; matches `audio_denoise`. Feeds both `Combined.sigmas` and pass-2 sampler. |
| **`steps`** | 20 / 10 | Pass 1 / pass 2. |
| **`length`** | 73 (~3 s @24fps) | Must satisfy H3's modular frame constraint. Use the Math Expression node from the TE-Speed template for arbitrary durations. |

## Rules (from the Tr1dae README)
1. Take **`denoised_output`** from pass 1 (not `output`).
2. Build the pass-2 **Guider from the Combined node's returned conditioning** (it scaled the refs).
3. Pass-2 sampler uses **`DisableNoise`** — the Combined node already re-noised.
4. **Do NOT Empty Cache / force-unload between passes** (especially with `--lowvram` + quantized
   MiniMax + SageAttention). The Combined node parks the latent on CPU + `soft_empty_cache` only.
5. Pass-2 sigma schedule feeds **both** `Combined.sigmas` and pass-2 sampler — keep them the same.

## VRAM (24 GB int8)
Two passes are heavier than one. Conservative defaults (0.4 MP → 0.9 MP, 73 frames) fit with
`--lowvram`. To go bigger: keep pass-1 small, raise `scale_by` gradually, watch `comfyui_8188.log`
for the Xid31 / OOM patterns documented in `project_3090_xid31_mmu_fault`. `UniBlockSwap` /
`ReservedVRAMSetter` (installed alongside) help if you hit the wall.

## Installed toolkit nodes (all 5 registered on `comfyui-primary`)
- `MiniMaxH3LatentUpscaleCombined` — **core**, this workflow
- `UniBlockSwap` / `UniBlockSwapTE` / `UniBlockSwapCacheControl` — block-swap for low-VRAM
- `ReservedVRAMSetter` — dynamic reserved-VRAM tuning (needs `nvidia-ml-py`, installed)
- `PT_H3ConcatAVLatent` — concat AV latent for H3 video redraw (overlaps `LTXVConcatAVLatent`)
- `SolAttnPatch` / `SolAttnBlockProbe` — Sol-Attn attention override (needs `triton`, installed;
  `TORCH_CUDA_DISABLE_TRITON` stays `1` — SolAttn uses `import triton` directly, per-model)

## Models required (all present under `/data/models/comfyui/`)
- `diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors`
- `text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`
- `vae/minimax_h3_video_vae_fp16.safetensors`, `vae/minimax_h3_audio_vae_fp32.safetensors`
