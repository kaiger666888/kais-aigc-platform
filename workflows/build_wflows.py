#!/usr/bin/env python3
"""Generate all ComfyUI workflow JSONs: LTX-2.3 (WF1-3) + Wan 2.2 (WF4-9).

Output format: ComfyUI API v0.4 (LiteGraph JSON)
"""

import json
import os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))


# ── LiteGraph helpers ──────────────────────────────────────────────────────────
def node(id, type, pos, widgets, title=None, inputs=None, outputs=None, size=None):
    n = {
        "id": id,
        "type": type,
        "pos": list(pos),
        "size": size or [315, 200],
        "flags": {},
        "order": 0,
        "mode": 0,
        "inputs": inputs or [],
        "outputs": outputs or [],
        "properties": {"Node name for S&R": type},
        "widgets_values": widgets,
    }
    if title:
        n["title"] = title
    return n


def link(id, src_node, src_slot, dst_node, dst_slot, type):
    return [id, src_node, src_slot, dst_node, dst_slot, type]


def out(name, type, links=None):
    return {"name": name, "type": type, "links": links or []}


def inp(name, type, link=None):
    return {"name": name, "type": type, "link": link}


def vhs_widgets(prefix, fps=16):
    return {
        "frame_rate": fps,
        "loop_count": 0,
        "filename_prefix": prefix,
        "format": "video/h264-mp4",
        "pix_fmt": "yuv420p",
        "crf": 19,
        "save_metadata": True,
        "trim_to_audio": False,
        "pingpong": False,
        "save_output": True,
        "videopreview": {
            "hidden": False,
            "paused": False,
            "params": {
                "filename": f"{prefix}.mp4",
                "subfolder": "",
                "type": "output",
                "format": "video/h264-mp4",
                "frame_rate": fps,
            },
        },
    }


def wrap(nodes, links, lid, nid, title, bounding, color="#3f789e", info=None):
    return {
        "last_node_id": nid,
        "last_link_id": lid,
        "nodes": nodes,
        "links": links,
        "groups": [{"title": title, "bounding": bounding, "color": color}],
        "config": {},
        "extra": {
            "ds": {"scale": 1, "offset": [0, 0]},
            "info": {"name": title, "description": (info or title)},
        },
        "version": 0.4,
    }


# ── Wan 2.2 Common Constants ─────────────────────────────────────────────────
WAN_W = 832
WAN_H = 480
WAN_FRAMES = 81
WAN_FPS = 16

# Model filenames (relative to ComfyUI/models/*)
WAN_HIGH_NOISE = "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"
WAN_LOW_NOISE = "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"
WAN_T5 = "umt5_xxl_fp8_e4m3fn_scaled.safetensors"
WAN_VAE = "wan_2.1_vae.safetensors"
WAN_CLIP_VISION = "model.safetensors"
WAN_T2V = "wan2.1-t2v-14b-Q8_0.gguf"

DEFAULT_POS = "cinematic film still, a young woman in red dress standing in a neon-lit alley at night, rain reflecting neon signs, moody atmosphere, 35mm film grain, volumetric lighting"
DEFAULT_NEG = "blurry, low quality, distorted, watermark, text, static"


# ── Workflow 4: Wan 2.2 I2V Dual Stage (High Noise + Low Noise) ────────────────
def build_workflow4():
    """Dual-stage I2V: Stage 1 (high noise, shift=8) → Stage 2 (low noise, shift=4).
    Uses WanVideoWrapper nodes throughout."""
    nodes, links = [], []
    lid = 1

    # [1] WanVideoModelLoader — high noise (stage 1)
    nodes.append(node(1, "WanVideoModelLoader", [0, 0],
        [WAN_HIGH_NOISE, "bf16", "fp8_e4m3fn_scaled", "offload_device"],
        title="High Noise Model (Stage 1)",
        size=[315, 180],
        outputs=[out("model", "WANVIDEOMODEL")]
    ))

    # [2] WanVideoModelLoader — low noise (stage 2)
    nodes.append(node(2, "WanVideoModelLoader", [0, 250],
        [WAN_LOW_NOISE, "bf16", "fp8_e4m3fn_scaled", "offload_device"],
        title="Low Noise Model (Stage 2)",
        size=[315, 180],
        outputs=[out("model", "WANVIDEOMODEL")]
    ))

    # [3] LoadWanVideoT5TextEncoder
    nodes.append(node(3, "LoadWanVideoT5TextEncoder", [0, 500],
        [WAN_T5, "bf16", "offload_device", "disabled"],
        title="T5 Text Encoder",
        size=[315, 120],
        outputs=[out("wan_t5_model", "WANTEXTENCODER")]
    ))

    # [4] WanVideoTextEncode
    nodes.append(node(4, "WanVideoTextEncode", [400, 0],
        [DEFAULT_POS, DEFAULT_NEG],
        title="Text Encode",
        size=[400, 120],
        inputs=[inp("t5", "WANTEXTENCODER", lid)],
        outputs=[out("text_embeds", "WANVIDEOTEXTEMBEDS")]
    ))
    links.append(link(lid, 3, 0, 4, 0, "WANTEXTENCODER")); lid += 1

    # [5] WanVideoVAELoader
    nodes.append(node(5, "WanVideoVAELoader", [0, 700],
        [WAN_VAE, "bf16"],
        title="Wan VAE",
        size=[315, 80],
        outputs=[out("vae", "WANVAE")]
    ))

    # [6] LoadImage — start frame
    nodes.append(node(6, "LoadImage", [0, 850],
        ["example.png", "image"],
        title="Start Frame Image",
        size=[315, 314],
        outputs=[out("IMAGE", "IMAGE")]
    ))

    # [7] WanVideoImageToVideoEncode — encode start frame
    # widgets: width, height, num_frames, noise_aug_strength, start_latent_strength, end_latent_strength, force_offload
    nodes.append(node(7, "WanVideoImageToVideoEncode", [400, 200],
        [WAN_W, WAN_H, WAN_FRAMES, 0.0, 1.0, 1.0, True],
        title="I2V Encode (81 frames)",
        size=[350, 260],
        inputs=[
            inp("vae", "WANVAE", lid),
            inp("start_image", "IMAGE", lid + 1),
        ],
        outputs=[out("image_embeds", "WANVIDIMAGE_EMBEDS")]
    ))
    links.append(link(lid, 5, 0, 7, 0, "WANVAE")); lid += 1
    links.append(link(lid, 6, 0, 7, 1, "IMAGE")); lid += 1

    # [8] WanVideoSampler — Stage 1 (high noise, shift=8, steps=20)
    # widgets: steps, cfg, shift, seed, force_offload, scheduler, riflex_freq_index
    nodes.append(node(8, "WanVideoSampler", [800, 0],
        [20, 3.5, 8.0, 42, True, "euler/beta", 0],
        title="Stage 1 Sampler (shift=8, steps=20)",
        size=[400, 400],
        inputs=[
            inp("model", "WANVIDEOMODEL", lid),
            inp("image_embeds", "WANVIDIMAGE_EMBEDS", lid + 1),
        ],
        outputs=[out("samples", "LATENT"), out("denoised_samples", "LATENT")]
    ))
    links.append(link(lid, 1, 0, 8, 0, "WANVIDEOMODEL")); lid += 1
    links.append(link(lid, 7, 0, 8, 1, "WANVIDIMAGE_EMBEDS")); lid += 1

    # [9] WanVideoSampler — Stage 2 (low noise, shift=4, steps=30, denoise=0.6)
    # widgets: steps, cfg, shift, seed, force_offload, scheduler, riflex_freq_index
    nodes.append(node(9, "WanVideoSampler", [800, 500],
        [30, 3.5, 4.0, 42, True, "euler/beta", 0],
        title="Stage 2 Sampler (shift=4, steps=30)",
        size=[400, 400],
        inputs=[
            inp("model", "WANVIDEOMODEL", lid),
            inp("image_embeds", "WANVIDIMAGE_EMBEDS", lid + 1),
            inp("samples", "LATENT", lid + 2),
        ],
        outputs=[out("samples", "LATENT"), out("denoised_samples", "LATENT")]
    ))
    links.append(link(lid, 2, 0, 9, 0, "WANVIDEOMODEL")); lid += 1
    links.append(link(lid, 7, 0, 9, 1, "WANVIDIMAGE_EMBEDS")); lid += 1
    links.append(link(lid, 8, 0, 9, 2, "LATENT")); lid += 1

    # [10] WanVideoDecode
    nodes.append(node(10, "WanVideoDecode", [1250, 200],
        [False, 272, 272, 144, 128],
        size=[350, 200],
        inputs=[
            inp("vae", "WANVAE", lid),
            inp("samples", "LATENT", lid + 1),
        ],
        outputs=[out("IMAGE", "IMAGE")]
    ))
    links.append(link(lid, 5, 0, 10, 0, "WANVAE")); lid += 1
    links.append(link(lid, 9, 0, 10, 1, "LATENT")); lid += 1

    # [11] VHS_VideoCombine
    nodes.append(node(11, "VHS_VideoCombine", [1650, 200],
        vhs_widgets("wan_dual_stage_i2v", WAN_FPS),
        size=[320, 200],
        inputs=[inp("images", "IMAGE", lid)],
        outputs=[]
    ))
    links.append(link(lid, 10, 0, 11, 0, "IMAGE")); lid += 1

    return wrap(nodes, links, lid, 11,
        "Workflow 4: Wan 2.2 I2V Dual Stage (High+Low Noise)",
        [-50, -50, 2400, 1500], "#3f789e",
        "Dual-stage I2V: Stage 1 (high noise, shift=8, steps=20) → Stage 2 (low noise, shift=4, steps=30, denoise=0.6). Best quality output for Wan 2.2.")


# ── Workflow 5: Wan 2.2 T2V (Text to Video) ──────────────────────────────────
def build_workflow5():
    """Pure text-to-video using WanVideoWrapper."""
    nodes, links = [], []
    lid = 1

    # [1] WanVideoModelLoader — T2V model
    nodes.append(node(1, "WanVideoModelLoader", [0, 0],
        [WAN_T2V, "bf16", "disabled", "offload_device"],
        title="T2V Model",
        size=[315, 180],
        outputs=[out("model", "WANVIDEOMODEL")]
    ))

    # [2] LoadWanVideoT5TextEncoder
    nodes.append(node(2, "LoadWanVideoT5TextEncoder", [0, 250],
        [WAN_T5, "bf16", "offload_device", "disabled"],
        title="T5 Text Encoder",
        size=[315, 120],
        outputs=[out("wan_t5_model", "WANTEXTENCODER")]
    ))

    # [3] WanVideoTextEncode
    nodes.append(node(3, "WanVideoTextEncode", [400, 0],
        ["a cinematic aerial shot of a coastal city at sunset, golden hour light reflecting off glass skyscrapers, waves crashing against the shoreline, seagulls flying overhead, dramatic clouds, 4K quality",
         "blurry, low quality, static, watermark, text"],
        title="Text Encode",
        size=[500, 120],
        inputs=[inp("t5", "WANTEXTENCODER", lid)],
        outputs=[out("text_embeds", "WANVIDEOTEXTEMBEDS")]
    ))
    links.append(link(lid, 2, 0, 3, 0, "WANTEXTENCODER")); lid += 1

    # [4] WanVideoEmptyEmbeds
    nodes.append(node(4, "WanVideoEmptyEmbeds", [400, 200],
        [WAN_W, WAN_H, WAN_FRAMES],
        title="Empty Embeds (832x480, 81f)",
        size=[315, 100],
        outputs=[out("image_embeds", "WANVIDIMAGE_EMBEDS")]
    ))

    # [5] WanVideoSampler — widgets: steps, cfg, shift, seed, force_offload, scheduler, riflex_freq_index
    nodes.append(node(5, "WanVideoSampler", [800, 0],
        [30, 3.5, 5.0, 42, True, "euler/beta", 0],
        title="T2V Sampler",
        size=[400, 400],
        inputs=[
            inp("model", "WANVIDEOMODEL", lid),
            inp("image_embeds", "WANVIDIMAGE_EMBEDS", lid + 1),
        ],
        outputs=[out("samples", "LATENT"), out("denoised_samples", "LATENT")]
    ))
    links.append(link(lid, 1, 0, 5, 0, "WANVIDEOMODEL")); lid += 1
    links.append(link(lid, 4, 0, 5, 1, "WANVIDIMAGE_EMBEDS")); lid += 1

    # [6] WanVideoVAELoader
    nodes.append(node(6, "WanVideoVAELoader", [0, 450],
        [WAN_VAE, "bf16"],
        title="Wan VAE",
        size=[315, 80],
        outputs=[out("vae", "WANVAE")]
    ))

    # [7] WanVideoDecode
    nodes.append(node(7, "WanVideoDecode", [1250, 0],
        [False, 272, 272, 144, 128],
        size=[350, 200],
        inputs=[
            inp("vae", "WANVAE", lid),
            inp("samples", "LATENT", lid + 1),
        ],
        outputs=[out("IMAGE", "IMAGE")]
    ))
    links.append(link(lid, 6, 0, 7, 0, "WANVAE")); lid += 1
    links.append(link(lid, 5, 0, 7, 1, "LATENT")); lid += 1

    # [8] VHS_VideoCombine
    nodes.append(node(8, "VHS_VideoCombine", [1650, 0],
        vhs_widgets("wan_t2v", WAN_FPS),
        size=[320, 200],
        inputs=[inp("images", "IMAGE", lid)],
        outputs=[]
    ))
    links.append(link(lid, 7, 0, 8, 0, "IMAGE")); lid += 1

    return wrap(nodes, links, lid, 8,
        "Workflow 5: Wan 2.2 T2V (Text to Video)",
        [-50, -50, 2300, 1000], "#a1a1a1",
        "Pure text-to-video generation with Wan 2.2. No image input required.")


# ── Workflow 6: Wan 2.2 Animate Mix (角色一致性 + 风格迁移) ──────────────────
def build_workflow6():
    """Character consistency: reference image + style/action prompt → new video."""
    nodes, links = [], []
    lid = 1

    # [1] WanVideoModelLoader — I2V model for animate
    nodes.append(node(1, "WanVideoModelLoader", [0, 0],
        [WAN_HIGH_NOISE, "bf16", "fp8_e4m3fn_scaled", "offload_device"],
        title="I2V Model (Animate)",
        size=[315, 180],
        outputs=[out("model", "WANVIDEOMODEL")]
    ))

    # [2] LoadWanVideoT5TextEncoder
    nodes.append(node(2, "LoadWanVideoT5TextEncoder", [0, 250],
        [WAN_T5, "bf16", "offload_device", "disabled"],
        title="T5 Text Encoder",
        size=[315, 120],
        outputs=[out("wan_t5_model", "WANTEXTENCODER")]
    ))

    # [3] WanVideoTextEncode
    nodes.append(node(3, "WanVideoTextEncode", [400, 0],
        [DEFAULT_POS + ", she gracefully dances in the rain",
         DEFAULT_NEG],
        title="Text Encode",
        size=[500, 120],
        inputs=[inp("t5", "WANTEXTENCODER", lid)],
        outputs=[out("text_embeds", "WANVIDEOTEXTEMBEDS")]
    ))
    links.append(link(lid, 2, 0, 3, 0, "WANTEXTENCODER")); lid += 1

    # [4] WanVideoVAELoader
    nodes.append(node(4, "WanVideoVAELoader", [0, 450],
        [WAN_VAE, "bf16"],
        title="Wan VAE",
        size=[315, 80],
        outputs=[out("vae", "WANVAE")]
    ))

    # [5] LoadImage — reference character
    nodes.append(node(5, "LoadImage", [0, 600],
        ["character_ref.png", "image"],
        title="Reference Character",
        size=[315, 314],
        outputs=[out("IMAGE", "IMAGE")]
    ))

    # [6] WanVideoAnimateEmbeds — character consistency embeds
    # widgets: vae(not widget), width, height, num_frames, force_offload, frame_window_size, colormatch, pose_strength, face_strength
    nodes.append(node(6, "WanVideoAnimateEmbeds", [400, 200],
        [WAN_W, WAN_H, WAN_FRAMES, True, 77, "disabled", 1.0, 1.0],
        title="Animate Embeds (character ref)",
        size=[400, 260],
        inputs=[
            inp("vae", "WANVAE", lid),
            inp("ref_images", "IMAGE", lid + 1),
        ],
        outputs=[out("image_embeds", "WANVIDIMAGE_EMBEDS")]
        # NOTE: vae is an INPUT, not a widget. widgets start with width.
        # LiteGraph auto-order: inputs first, then widgets_values in order of required fields
        # that are NOT in inputs. For WanVideoAnimateEmbeds, vae is optional input,
        # so it goes in inputs. Widgets: width, height, num_frames, force_offload,
        # frame_window_size, colormatch, pose_strength, face_strength
    ))
    links.append(link(lid, 4, 0, 6, 0, "WANVAE")); lid += 1
    links.append(link(lid, 5, 0, 6, 1, "IMAGE")); lid += 1

    # [7] WanVideoSampler — widgets: steps, cfg, shift, seed, force_offload, scheduler, riflex_freq_index
    nodes.append(node(7, "WanVideoSampler", [850, 0],
        [30, 3.5, 5.0, 42, True, "euler/beta", 0],
        title="Animate Sampler",
        size=[400, 400],
        inputs=[
            inp("model", "WANVIDEOMODEL", lid),
            inp("image_embeds", "WANVIDIMAGE_EMBEDS", lid + 1),
        ],
        outputs=[out("samples", "LATENT"), out("denoised_samples", "LATENT")]
    ))
    links.append(link(lid, 1, 0, 7, 0, "WANVIDEOMODEL")); lid += 1
    links.append(link(lid, 6, 0, 7, 1, "WANVIDIMAGE_EMBEDS")); lid += 1

    # [8] WanVideoDecode
    nodes.append(node(8, "WanVideoDecode", [1300, 0],
        [False, 272, 272, 144, 128],
        size=[350, 200],
        inputs=[
            inp("vae", "WANVAE", lid),
            inp("samples", "LATENT", lid + 1),
        ],
        outputs=[out("IMAGE", "IMAGE")]
    ))
    links.append(link(lid, 4, 0, 8, 0, "WANVAE")); lid += 1
    links.append(link(lid, 7, 0, 8, 1, "LATENT")); lid += 1

    # [9] VHS_VideoCombine
    nodes.append(node(9, "VHS_VideoCombine", [1700, 0],
        vhs_widgets("wan_animate_mix", WAN_FPS),
        size=[320, 200],
        inputs=[inp("images", "IMAGE", lid)],
        outputs=[]
    ))
    links.append(link(lid, 8, 0, 9, 0, "IMAGE")); lid += 1

    return wrap(nodes, links, lid, 9,
        "Workflow 6: Wan 2.2 Animate Mix (Character Consistency)",
        [-50, -50, 2400, 1200], "#2a5f2a",
        "Character consistency + style transfer. Reference image maintains character appearance while generating new motion/video.")


# ── Workflow 7: Wan 2.2 Animate Move (动作参考迁移) ──────────────────────────
def build_workflow7():
    """Action reference transfer: character image + motion tracks → video."""
    nodes, links = [], []
    lid = 1

    # [1] WanVideoModelLoader
    nodes.append(node(1, "WanVideoModelLoader", [0, 0],
        [WAN_HIGH_NOISE, "bf16", "fp8_e4m3fn_scaled", "offload_device"],
        title="I2V Model",
        size=[315, 180],
        outputs=[out("model", "WANVIDEOMODEL")]
    ))

    # [2] LoadWanVideoT5TextEncoder
    nodes.append(node(2, "LoadWanVideoT5TextEncoder", [0, 250],
        [WAN_T5, "bf16", "offload_device", "disabled"],
        title="T5 Text Encoder",
        size=[315, 120],
        outputs=[out("wan_t5_model", "WANTEXTENCODER")]
    ))

    # [3] WanVideoTextEncode
    nodes.append(node(3, "WanVideoTextEncode", [400, 0],
        [DEFAULT_POS,
         DEFAULT_NEG],
        title="Text Encode",
        size=[500, 120],
        inputs=[inp("t5", "WANTEXTENCODER", lid)],
        outputs=[out("text_embeds", "WANVIDEOTEXTEMBEDS")]
    ))
    links.append(link(lid, 2, 0, 3, 0, "WANTEXTENCODER")); lid += 1

    # [4] WanVideoVAELoader
    nodes.append(node(4, "WanVideoVAELoader", [0, 450],
        [WAN_VAE, "bf16"],
        title="Wan VAE",
        size=[315, 80],
        outputs=[out("vae", "WANVAE")]
    ))

    # [5] WanVideoEmptyEmbeds
    nodes.append(node(5, "WanVideoEmptyEmbeds", [400, 200],
        [WAN_W, WAN_H, WAN_FRAMES],
        title="Empty Embeds (832x480, 81f)",
        size=[315, 100],
        outputs=[out("image_embeds", "WANVIDIMAGE_EMBEDS")]
    ))

    # [6] WanVideoAddWanMoveTracks — inject motion tracks
    nodes.append(node(6, "WanVideoAddWanMoveTracks", [400, 380],
        [1.0],
        title="WanMove Tracks",
        size=[400, 100],
        inputs=[
            inp("image_embeds", "WANVIDIMAGE_EMBEDS", lid),
        ],
        outputs=[
            out("image_embeds", "WANVIDIMAGE_EMBEDS"),
            out("tracks", "TRACKS"),
        ]
    ))
    links.append(link(lid, 5, 0, 6, 0, "WANVIDIMAGE_EMBEDS")); lid += 1

    # [7] WanVideoSampler — widgets: steps, cfg, shift, seed, force_offload, scheduler, riflex_freq_index
    nodes.append(node(7, "WanVideoSampler", [850, 0],
        [30, 3.5, 5.0, 42, True, "euler/beta", 0],
        title="Move Sampler",
        size=[400, 400],
        inputs=[
            inp("model", "WANVIDEOMODEL", lid),
            inp("image_embeds", "WANVIDIMAGE_EMBEDS", lid + 1),
        ],
        outputs=[out("samples", "LATENT"), out("denoised_samples", "LATENT")]
    ))
    links.append(link(lid, 1, 0, 7, 0, "WANVIDEOMODEL")); lid += 1
    links.append(link(lid, 6, 0, 7, 1, "WANVIDIMAGE_EMBEDS")); lid += 1

    # [8] WanVideoDecode
    nodes.append(node(8, "WanVideoDecode", [1300, 0],
        [False, 272, 272, 144, 128],
        size=[350, 200],
        inputs=[
            inp("vae", "WANVAE", lid),
            inp("samples", "LATENT", lid + 1),
        ],
        outputs=[out("IMAGE", "IMAGE")]
    ))
    links.append(link(lid, 4, 0, 8, 0, "WANVAE")); lid += 1
    links.append(link(lid, 7, 0, 8, 1, "LATENT")); lid += 1

    # [9] VHS_VideoCombine
    nodes.append(node(9, "VHS_VideoCombine", [1700, 0],
        vhs_widgets("wan_animate_move", WAN_FPS),
        size=[320, 200],
        inputs=[inp("images", "IMAGE", lid)],
        outputs=[]
    ))
    links.append(link(lid, 8, 0, 9, 0, "IMAGE")); lid += 1

    return wrap(nodes, links, lid, 9,
        "Workflow 7: Wan 2.2 Animate Move (Motion Transfer)",
        [-50, -50, 2400, 1000], "#5f2a5f",
        "Motion reference transfer via WanMove. Provide track_coords (JSON) to animate character with reference motion patterns.")


# ── Workflow 8: Wan 2.2 Video Extend (视频延长) ───────────────────────────
def build_workflow8():
    """Video extension: extract last frame → I2V → extended clip."""
    nodes, links = [], []
    lid = 1

    # [1] VHS_LoadVideoPath — load existing video
    nodes.append(node(1, "VHS_LoadVideoPath", [0, 0],
        ["input_video.mp4", 0, 0, 0, "start_frame", 1, False],
        title="Load Video",
        size=[315, 210],
        outputs=[
            out("IMAGE", "IMAGE"),
            out("frame_count", "INT"),
            out("audio", "AUDIO"),
            out("video_info", "VHS_VIDEOINFO"),
        ]
    ))

    # [2] GetImagesFromBatchIndexed — extract last frame
    nodes.append(node(2, "GetImagesFromBatchIndexed", [400, 0],
        ["-1"],
        title="Extract Last Frame",
        size=[315, 60],
        inputs=[inp("images", "IMAGE", lid)],
        outputs=[out("IMAGE", "IMAGE")]
    ))
    links.append(link(lid, 1, 0, 2, 0, "IMAGE")); lid += 1

    # [3] WanVideoModelLoader — I2V for extend
    nodes.append(node(3, "WanVideoModelLoader", [0, 300],
        [WAN_HIGH_NOISE, "bf16", "fp8_e4m3fn_scaled", "offload_device"],
        title="I2V Model (Extend)",
        size=[315, 180],
        outputs=[out("model", "WANVIDEOMODEL")]
    ))

    # [4] LoadWanVideoT5TextEncoder
    nodes.append(node(4, "LoadWanVideoT5TextEncoder", [0, 550],
        [WAN_T5, "bf16", "offload_device", "disabled"],
        title="T5 Text Encoder",
        size=[315, 120],
        outputs=[out("wan_t5_model", "WANTEXTENCODER")]
    ))

    # [5] WanVideoTextEncode
    nodes.append(node(5, "WanVideoTextEncode", [400, 200],
        ["continuation of the scene, smooth transition, consistent motion",
         DEFAULT_NEG],
        title="Text Encode (Extend)",
        size=[500, 120],
        inputs=[inp("t5", "WANTEXTENCODER", lid)],
        outputs=[out("text_embeds", "WANVIDEOTEXTEMBEDS")]
    ))
    links.append(link(lid, 4, 0, 5, 0, "WANTEXTENCODER")); lid += 1

    # [6] WanVideoVAELoader
    nodes.append(node(6, "WanVideoVAELoader", [0, 750],
        [WAN_VAE, "bf16"],
        title="Wan VAE",
        size=[315, 80],
        outputs=[out("vae", "WANVAE")]
    ))

    # [7] WanVideoImageToVideoEncode — last frame as new start, 77 frames extend
    # widgets: width, height, num_frames, noise_aug_strength, start_latent_strength, end_latent_strength, force_offload
    nodes.append(node(7, "WanVideoImageToVideoEncode", [400, 400],
        [WAN_W, WAN_H, 77, 0.0, 1.0, 1.0, True],
        title="I2V Encode (77 frames extend)",
        size=[350, 260],
        inputs=[
            inp("vae", "WANVAE", lid),
            inp("start_image", "IMAGE", lid + 1),
        ],
        outputs=[out("image_embeds", "WANVIDIMAGE_EMBEDS")]
    ))
    links.append(link(lid, 6, 0, 7, 0, "WANVAE")); lid += 1
    links.append(link(lid, 2, 0, 7, 1, "IMAGE")); lid += 1

    # [8] WanVideoSampler — widgets: steps, cfg, shift, seed, force_offload, scheduler, riflex_freq_index
    nodes.append(node(8, "WanVideoSampler", [800, 200],
        [30, 3.5, 5.0, 42, True, "euler/beta", 0],
        title="Extend Sampler (77f)",
        size=[400, 400],
        inputs=[
            inp("model", "WANVIDEOMODEL", lid),
            inp("image_embeds", "WANVIDIMAGE_EMBEDS", lid + 1),
        ],
        outputs=[out("samples", "LATENT"), out("denoised_samples", "LATENT")]
    ))
    links.append(link(lid, 3, 0, 8, 0, "WANVIDEOMODEL")); lid += 1
    links.append(link(lid, 7, 0, 8, 1, "WANVIDIMAGE_EMBEDS")); lid += 1

    # [9] WanVideoDecode
    nodes.append(node(9, "WanVideoDecode", [1250, 200],
        [False, 272, 272, 144, 128],
        size=[350, 200],
        inputs=[
            inp("vae", "WANVAE", lid),
            inp("samples", "LATENT", lid + 1),
        ],
        outputs=[out("IMAGE", "IMAGE")]
    ))
    links.append(link(lid, 6, 0, 9, 0, "WANVAE")); lid += 1
    links.append(link(lid, 8, 0, 9, 1, "LATENT")); lid += 1

    # [10] VHS_VideoCombine
    nodes.append(node(10, "VHS_VideoCombine", [1650, 200],
        vhs_widgets("wan_extend", WAN_FPS),
        size=[320, 200],
        inputs=[inp("images", "IMAGE", lid)],
        outputs=[]
    ))
    links.append(link(lid, 9, 0, 10, 0, "IMAGE")); lid += 1

    return wrap(nodes, links, lid, 10,
        "Workflow 8: Wan 2.2 Video Extend",
        [-50, -50, 2300, 1200], "#7a3f3f",
        "Video extension: extract last frame from existing video, generate continuation. Feed output back as input for iterative extending.")


# ── Workflow 9: Wan 2.2 I2V Single Stage Quick ────────────────────────────
def build_workflow9():
    """Quick single-stage I2V for preview. Simplest Wan 2.2 architecture."""
    nodes, links = [], []
    lid = 1

    # [1] WanVideoModelLoader — high noise
    nodes.append(node(1, "WanVideoModelLoader", [0, 0],
        [WAN_HIGH_NOISE, "bf16", "fp8_e4m3fn_scaled", "offload_device"],
        title="I2V Model (High Noise)",
        size=[315, 180],
        outputs=[out("model", "WANVIDEOMODEL")]
    ))

    # [2] LoadWanVideoT5TextEncoder
    nodes.append(node(2, "LoadWanVideoT5TextEncoder", [0, 250],
        [WAN_T5, "bf16", "offload_device", "disabled"],
        title="T5 Text Encoder",
        size=[315, 120],
        outputs=[out("wan_t5_model", "WANTEXTENCODER")]
    ))

    # [3] WanVideoTextEncode
    nodes.append(node(3, "WanVideoTextEncode", [400, 0],
        [DEFAULT_POS,
         DEFAULT_NEG],
        title="Text Encode",
        size=[500, 120],
        inputs=[inp("t5", "WANTEXTENCODER", lid)],
        outputs=[out("text_embeds", "WANVIDEOTEXTEMBEDS")]
    ))
    links.append(link(lid, 2, 0, 3, 0, "WANTEXTENCODER")); lid += 1

    # [4] WanVideoVAELoader
    nodes.append(node(4, "WanVideoVAELoader", [0, 450],
        [WAN_VAE, "bf16"],
        title="Wan VAE",
        size=[315, 80],
        outputs=[out("vae", "WANVAE")]
    ))

    # [5] LoadImage — start frame
    nodes.append(node(5, "LoadImage", [0, 600],
        ["example.png", "image"],
        title="Start Frame Image",
        size=[315, 314],
        outputs=[out("IMAGE", "IMAGE")]
    ))

    # [6] WanVideoImageToVideoEncode
    # widgets: width, height, num_frames, noise_aug_strength, start_latent_strength, end_latent_strength, force_offload
    nodes.append(node(6, "WanVideoImageToVideoEncode", [400, 200],
        [WAN_W, WAN_H, WAN_FRAMES, 0.0, 1.0, 1.0, True],
        title="I2V Encode (81 frames)",
        size=[350, 260],
        inputs=[
            inp("vae", "WANVAE", lid),
            inp("start_image", "IMAGE", lid + 1),
        ],
        outputs=[out("image_embeds", "WANVIDIMAGE_EMBEDS")]
    ))
    links.append(link(lid, 4, 0, 6, 0, "WANVAE")); lid += 1
    links.append(link(lid, 5, 0, 6, 1, "IMAGE")); lid += 1

    # [7] WanVideoSampler — single stage, quick
    # widgets: steps, cfg, shift, seed, force_offload, scheduler, riflex_freq_index
    nodes.append(node(7, "WanVideoSampler", [800, 0],
        [20, 3.5, 5.0, 42, True, "euler/beta", 0],
        title="Quick Sampler (steps=20)",
        size=[400, 400],
        inputs=[
            inp("model", "WANVIDEOMODEL", lid),
            inp("image_embeds", "WANVIDIMAGE_EMBEDS", lid + 1),
        ],
        outputs=[out("samples", "LATENT"), out("denoised_samples", "LATENT")]
    ))
    links.append(link(lid, 1, 0, 7, 0, "WANVIDEOMODEL")); lid += 1
    links.append(link(lid, 6, 0, 7, 1, "WANVIDIMAGE_EMBEDS")); lid += 1

    # [8] WanVideoDecode
    nodes.append(node(8, "WanVideoDecode", [1250, 0],
        [False, 272, 272, 144, 128],
        size=[350, 200],
        inputs=[
            inp("vae", "WANVAE", lid),
            inp("samples", "LATENT", lid + 1),
        ],
        outputs=[out("IMAGE", "IMAGE")]
    ))
    links.append(link(lid, 4, 0, 8, 0, "WANVAE")); lid += 1
    links.append(link(lid, 7, 0, 8, 1, "LATENT")); lid += 1

    # [9] VHS_VideoCombine
    nodes.append(node(9, "VHS_VideoCombine", [1650, 0],
        vhs_widgets("wan_i2v_quick", WAN_FPS),
        size=[320, 200],
        inputs=[inp("images", "IMAGE", lid)],
        outputs=[]
    ))
    links.append(link(lid, 8, 0, 9, 0, "IMAGE")); lid += 1

    return wrap(nodes, links, lid, 9,
        "Workflow 9: Wan 2.2 I2V Quick (Single Stage)",
        [-50, -50, 2300, 1200], "#3f5f78",
        "Quick single-stage I2V for preview. Fewest steps (20), fastest generation.")


# ── Main: generate all ────────────────────────────────────────────────────────
def main():
    builders = {
        "workflow4_wan_i2v_dual_stage.json": build_workflow4,
        "workflow5_wan_t2v.json": build_workflow5,
        "workflow6_wan_animate_mix.json": build_workflow6,
        "workflow7_wan_animate_move.json": build_workflow7,
        "workflow8_wan_video_extend.json": build_workflow8,
        "workflow9_wan_i2v_quick.json": build_workflow9,
    }
    for fname, fn in builders.items():
        path = os.path.join(OUT_DIR, fname)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(fn(), f, indent=2, ensure_ascii=False)
        print(f"✅ {fname}")
    print(f"\nGenerated {len(builders)} Wan 2.2 workflows in {OUT_DIR}")


if __name__ == "__main__":
    main()
