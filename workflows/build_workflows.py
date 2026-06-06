#!/usr/bin/env python3
"""Generate 3 Kijai LTX-2.3 ComfyUI workflow JSONs.

Workflow 1: Prompt Relay I2V (Director Beats)
Workflow 2: Extension (Video Extend)  
Workflow 3: FFLF (First Frame Last Frame)

Output format: ComfyUI API v0.4 (LiteGraph JSON)
"""

import json
import os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

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
    s = {"name": name, "type": type, "link": link}
    return s


# ============================================================
# Workflow 1: Kijai Prompt Relay I2V (Director Beats)
# ============================================================
def build_workflow1():
    nodes = []
    links = []
    lid = 1

    # [1] UNETLoader
    nodes.append(node(1, "UNETLoader", [0, 0],
        ["ltx-2.3-22b-distilled-fp8.safetensors", "default"],
        size=[315, 98], outputs=[out("MODEL", "MODEL")]
    ))

    # [2] DualCLIPLoader (Gemma + text projection → ltxv type)
    nodes.append(node(2, "DualCLIPLoader", [0, 150],
        ["gemma_3_12B_it_fp8_scaled.safetensors", "ltx-2.3_text_projection_bf16.safetensors", "ltxv", "default"],
        size=[315, 130], outputs=[out("CLIP", "CLIP")]
    ))

    # [3] VAELoader
    nodes.append(node(3, "VAELoader", [0, 330],
        ["ltx2_vae/LTX23_video_vae_bf16.safetensors"],
        size=[315, 58], outputs=[out("VAE", "VAE")]
    ))

    # [4] LoadImage - First frame reference
    nodes.append(node(4, "LoadImage", [0, 500],
        ["example.png", "image"],
        size=[315, 314], outputs=[out("IMAGE", "IMAGE")]
    ))

    # [5] EmptyLTXVLatentVideo (832x480, 161 frames ≈ 6.4s at 25fps)
    nodes.append(node(5, "EmptyLTXVLatentVideo", [400, 0],
        [832, 480, 161, 1],
        size=[315, 106], outputs=[out("LATENT", "LATENT")]
    ))

    # [6] LTXVImgToVideoConditionOnly - Encode first frame into latent
    nodes.append(node(6, "LTXVImgToVideoConditionOnly", [400, 200],
        [1.0, False],
        size=[315, 126],
        inputs=[inp("vae", "VAE", lid), inp("image", "IMAGE", lid+1), inp("latent", "LATENT", lid+2)],
        outputs=[out("latent", "LATENT")]
    ))
    links.append(link(lid, 3, 0, 6, 0, "VAE")); lid += 1
    links.append(link(lid, 4, 0, 6, 1, "IMAGE")); lid += 1
    links.append(link(lid, 5, 0, 6, 2, "LATENT")); lid += 1

    # [7] PromptRelayEncode - Director beats
    nodes.append(node(7, "PromptRelayEncode", [400, 430],
        [
            "cinematic film still, a young woman in red dress standing in a neon-lit alley, night, rain, high detail, 35mm film grain",
            "she slowly turns her head to look over her shoulder | camera pushes in slowly | rain intensifies, she raises her hand to shield her face | she turns back and walks away down the alley",
            "",
            0.001
        ],
        title="Prompt Relay Encode",
        size=[450, 350],
        inputs=[inp("model", "MODEL", lid), inp("clip", "CLIP", lid+1), inp("latent", "LATENT", lid+2)],
        outputs=[out("model", "MODEL"), out("positive", "CONDITIONING")]
    ))
    links.append(link(lid, 1, 0, 7, 0, "MODEL")); lid += 1
    links.append(link(lid, 2, 0, 7, 1, "CLIP")); lid += 1
    links.append(link(lid, 6, 0, 7, 2, "LATENT")); lid += 1

    # [8] CLIPTextEncode - Negative (empty for distilled)
    nodes.append(node(8, "CLIPTextEncode", [400, 870],
        [""],
        title="Negative Prompt",
        size=[400, 100],
        inputs=[inp("clip", "CLIP", lid)],
        outputs=[out("CONDITIONING", "CONDITIONING")]
    ))
    links.append(link(lid, 2, 0, 8, 0, "CLIP")); lid += 1

    # [9] LTXVConditioning (frame_rate=25)
    nodes.append(node(9, "LTXVConditioning", [900, 430],
        [25.0],
        size=[315, 58],
        inputs=[inp("positive", "CONDITIONING", lid), inp("negative", "CONDITIONING", lid+1)],
        outputs=[out("positive", "CONDITIONING"), out("negative", "CONDITIONING")]
    ))
    links.append(link(lid, 7, 1, 9, 0, "CONDITIONING")); lid += 1
    links.append(link(lid, 8, 0, 9, 1, "CONDITIONING")); lid += 1

    # [10] KSampler (8 steps, euler_ancestral, normal)
    nodes.append(node(10, "KSampler", [900, 200],
        [156680208700286, "randomize", 8, 5.5, "euler_ancestral", "normal", 1.0],
        size=[315, 262],
        inputs=[
            inp("model", "MODEL", lid),
            inp("positive", "CONDITIONING", lid+1),
            inp("negative", "CONDITIONING", lid+2),
            inp("latent_image", "LATENT", lid+3),
        ],
        outputs=[out("LATENT", "LATENT")]
    ))
    links.append(link(lid, 7, 0, 10, 0, "MODEL")); lid += 1
    links.append(link(lid, 9, 0, 10, 1, "CONDITIONING")); lid += 1
    links.append(link(lid, 9, 1, 10, 2, "CONDITIONING")); lid += 1
    links.append(link(lid, 6, 0, 10, 3, "LATENT")); lid += 1

    # [11] VAEDecodeTiled (tile=128, overlap=64)
    nodes.append(node(11, "VAEDecodeTiled", [1250, 200],
        [128, 64],
        size=[315, 106],
        inputs=[inp("samples", "LATENT", lid), inp("vae", "VAE", lid+1)],
        outputs=[out("IMAGE", "IMAGE")]
    ))
    links.append(link(lid, 10, 0, 11, 0, "LATENT")); lid += 1
    links.append(link(lid, 3, 0, 11, 1, "VAE")); lid += 1

    # [12] VHS_VideoCombine
    nodes.append(node(12, "VHS_VideoCombine", [1600, 200],
        {
            "frame_rate": 25, "loop_count": 0,
            "filename_prefix": "kijai_relay_i2v",
            "format": "video/h264-mp4", "pix_fmt": "yuv420p", "crf": 19,
            "save_metadata": True, "trim_to_audio": False,
            "pingpong": False, "save_output": True,
            "videopreview": {"hidden": False, "paused": False, "params": {"filename": "kijai_relay_i2v.mp4", "subfolder": "", "type": "output", "format": "video/h264-mp4", "frame_rate": 25}}
        },
        size=[320, 200],
        inputs=[inp("images", "IMAGE", lid)],
        outputs=[]
    ))
    links.append(link(lid, 11, 0, 12, 0, "IMAGE")); lid += 1

    return {
        "last_node_id": 12, "last_link_id": lid,
        "nodes": nodes, "links": links,
        "groups": [{"title": "Workflow 1: Kijai Prompt Relay I2V (Director Beats)", "bounding": [-50, -50, 2300, 1200], "color": "#3f789e"}],
        "config": {},
        "extra": {"ds": {"scale": 1, "offset": [0, 0]}, "info": {"name": "Kijai Prompt Relay I2V", "description": "Multi-beat temporal control via PromptRelayEncode. Edit local_prompts with | separated segments."}},
        "version": 0.4,
    }


# ============================================================
# Workflow 2: Kijai Extension (Video Extend)
# ============================================================
def build_workflow2():
    nodes = []
    links = []
    lid = 1

    # [1] UNETLoader
    nodes.append(node(1, "UNETLoader", [0, 0],
        ["ltx-2.3-22b-distilled-fp8.safetensors", "default"],
        size=[315, 98], outputs=[out("MODEL", "MODEL")]
    ))

    # [2] DualCLIPLoader
    nodes.append(node(2, "DualCLIPLoader", [0, 150],
        ["gemma_3_12B_it_fp8_scaled.safetensors", "ltx-2.3_text_projection_bf16.safetensors", "ltxv", "default"],
        size=[315, 130], outputs=[out("CLIP", "CLIP")]
    ))

    # [3] VAELoader
    nodes.append(node(3, "VAELoader", [0, 330],
        ["ltx2_vae/LTX23_video_vae_bf16.safetensors"],
        size=[315, 58], outputs=[out("VAE", "VAE")]
    ))

    # [4] LoadVideoPath - Load previous video
    nodes.append(node(4, "LoadVideoPath", [0, 500],
        ["input_video.mp4", 0, 0, 0, "start_frame", 1, False],
        size=[315, 210],
        outputs=[out("IMAGE", "IMAGE"), out("frame_count", "INT"), out("audio", "AUDIO"), out("video_info", "VHS_VIDEOINFO")]
    ))

    # [5] GetImagesFromBatchIndexed - Extract last frame
    nodes.append(node(5, "GetImagesFromBatchIndexed", [400, 500],
        ["-1"],
        title="Extract Last Frame",
        size=[315, 60],
        inputs=[inp("images", "IMAGE", lid)],
        outputs=[out("IMAGE", "IMAGE")]
    ))
    links.append(link(lid, 4, 0, 5, 0, "IMAGE")); lid += 1

    # [6] EmptyLTXVLatentVideo (49 frames ≈ 2s)
    nodes.append(node(6, "EmptyLTXVLatentVideo", [400, 0],
        [832, 480, 49, 1],
        size=[315, 106], outputs=[out("LATENT", "LATENT")]
    ))

    # [7] CLIPTextEncode - Positive prompt
    nodes.append(node(7, "CLIPTextEncode", [400, 200],
        ["a man and woman continue talking. The camera remains static."],
        title="Positive Prompt",
        size=[400, 100],
        inputs=[inp("clip", "CLIP", lid)],
        outputs=[out("CONDITIONING", "CONDITIONING")]
    ))
    links.append(link(lid, 2, 0, 7, 0, "CLIP")); lid += 1

    # [8] CLIPTextEncode - Negative prompt
    nodes.append(node(8, "CLIPTextEncode", [400, 350],
        [""],
        title="Negative Prompt",
        size=[400, 100],
        inputs=[inp("clip", "CLIP", lid)],
        outputs=[out("CONDITIONING", "CONDITIONING")]
    ))
    links.append(link(lid, 2, 0, 8, 0, "CLIP")); lid += 1

    # [9] LTXVImgToVideoConditionOnly - Inject last frame
    nodes.append(node(9, "LTXVImgToVideoConditionOnly", [400, 650],
        [1.0, False],
        size=[315, 126],
        inputs=[inp("vae", "VAE", lid), inp("image", "IMAGE", lid+1), inp("latent", "LATENT", lid+2)],
        outputs=[out("latent", "LATENT")]
    ))
    links.append(link(lid, 3, 0, 9, 0, "VAE")); lid += 1
    links.append(link(lid, 5, 0, 9, 1, "IMAGE")); lid += 1
    links.append(link(lid, 6, 0, 9, 2, "LATENT")); lid += 1

    # [10] LoraLoaderModelOnly - Freeze frame LoRA (strength=-0.3)
    nodes.append(node(10, "LoraLoaderModelOnly", [400, 850],
        ["ltx-2.3-22b-distilled-lora-384-1.1.safetensors", -0.3],
        title="Freeze Frame LoRA",
        size=[315, 106],
        inputs=[inp("model", "MODEL", lid)],
        outputs=[out("MODEL", "MODEL")]
    ))
    links.append(link(lid, 1, 0, 10, 0, "MODEL")); lid += 1

    # [11] LTXVConditioning
    nodes.append(node(11, "LTXVConditioning", [800, 200],
        [25.0],
        size=[315, 58],
        inputs=[inp("positive", "CONDITIONING", lid), inp("negative", "CONDITIONING", lid+1)],
        outputs=[out("positive", "CONDITIONING"), out("negative", "CONDITIONING")]
    ))
    links.append(link(lid, 7, 0, 11, 0, "CONDITIONING")); lid += 1
    links.append(link(lid, 8, 0, 11, 1, "CONDITIONING")); lid += 1

    # [12] KSampler
    nodes.append(node(12, "KSampler", [800, 400],
        [156680208700286, "randomize", 8, 5.5, "euler_ancestral", "normal", 1.0],
        size=[315, 262],
        inputs=[
            inp("model", "MODEL", lid),
            inp("positive", "CONDITIONING", lid+1),
            inp("negative", "CONDITIONING", lid+2),
            inp("latent_image", "LATENT", lid+3),
        ],
        outputs=[out("LATENT", "LATENT")]
    ))
    links.append(link(lid, 10, 0, 12, 0, "MODEL")); lid += 1
    links.append(link(lid, 11, 0, 12, 1, "CONDITIONING")); lid += 1
    links.append(link(lid, 11, 1, 12, 2, "CONDITIONING")); lid += 1
    links.append(link(lid, 9, 0, 12, 3, "LATENT")); lid += 1

    # [13] VAEDecodeTiled
    nodes.append(node(13, "VAEDecodeTiled", [1150, 400],
        [128, 64],
        size=[315, 106],
        inputs=[inp("samples", "LATENT", lid), inp("vae", "VAE", lid+1)],
        outputs=[out("IMAGE", "IMAGE")]
    ))
    links.append(link(lid, 12, 0, 13, 0, "LATENT")); lid += 1
    links.append(link(lid, 3, 0, 13, 1, "VAE")); lid += 1

    # [14] VHS_VideoCombine
    nodes.append(node(14, "VHS_VideoCombine", [1500, 400],
        {
            "frame_rate": 25, "loop_count": 0,
            "filename_prefix": "kijai_extend",
            "format": "video/h264-mp4", "pix_fmt": "yuv420p", "crf": 19,
            "save_metadata": True, "trim_to_audio": False,
            "pingpong": False, "save_output": True,
            "videopreview": {"hidden": False, "paused": False, "params": {"filename": "kijai_extend.mp4", "subfolder": "", "type": "output", "format": "video/h264-mp4", "frame_rate": 25}}
        },
        size=[320, 200],
        inputs=[inp("images", "IMAGE", lid)],
        outputs=[]
    ))
    links.append(link(lid, 13, 0, 14, 0, "IMAGE")); lid += 1

    return {
        "last_node_id": 14, "last_link_id": lid,
        "nodes": nodes, "links": links,
        "groups": [{"title": "Workflow 2: Kijai Extension (Video Extend)", "bounding": [-50, -50, 2300, 1300], "color": "#a1a1a1"}],
        "config": {},
        "extra": {"ds": {"scale": 1, "offset": [0, 0]}, "info": {"name": "Kijai Extension", "description": "Video extension with freeze-frame LoRA. Feed output back as input for iterative extending."}},
        "version": 0.4,
    }


# ============================================================
# Workflow 3: Kijai FFLF (First Frame Last Frame)
# ============================================================
def build_workflow3():
    nodes = []
    links = []
    lid = 1

    # [1] UNETLoader
    nodes.append(node(1, "UNETLoader", [0, 0],
        ["ltx-2.3-22b-distilled-fp8.safetensors", "default"],
        size=[315, 98], outputs=[out("MODEL", "MODEL")]
    ))

    # [2] DualCLIPLoader
    nodes.append(node(2, "DualCLIPLoader", [0, 150],
        ["gemma_3_12B_it_fp8_scaled.safetensors", "ltx-2.3_text_projection_bf16.safetensors", "ltxv", "default"],
        size=[315, 130], outputs=[out("CLIP", "CLIP")]
    ))

    # [3] VAELoader
    nodes.append(node(3, "VAELoader", [0, 330],
        ["ltx2_vae/LTX23_video_vae_bf16.safetensors"],
        size=[315, 58], outputs=[out("VAE", "VAE")]
    ))

    # [4] LoadImage - First frame (start position A)
    nodes.append(node(4, "LoadImage", [0, 500],
        ["first_frame.png", "image"],
        title="First Frame (Start A)",
        size=[315, 314], outputs=[out("IMAGE", "IMAGE")]
    ))

    # [5] LoadImage - Last frame (end position B)
    nodes.append(node(5, "LoadImage", [0, 880],
        ["last_frame.png", "image"],
        title="Last Frame (End B)",
        size=[315, 314], outputs=[out("IMAGE", "IMAGE")]
    ))

    # [6] EmptyLTXVLatentVideo (768x512, 161 frames)
    nodes.append(node(6, "EmptyLTXVLatentVideo", [400, 0],
        [768, 512, 161, 1],
        size=[315, 106], outputs=[out("LATENT", "LATENT")]
    ))

    # [7] CLIPTextEncode - Positive
    nodes.append(node(7, "CLIPTextEncode", [400, 200],
        ["smooth transition, cinematic, high detail"],
        title="Positive Prompt",
        size=[400, 100],
        inputs=[inp("clip", "CLIP", lid)],
        outputs=[out("CONDITIONING", "CONDITIONING")]
    ))
    links.append(link(lid, 2, 0, 7, 0, "CLIP")); lid += 1

    # [8] CLIPTextEncode - Negative
    nodes.append(node(8, "CLIPTextEncode", [400, 350],
        [""],
        title="Negative Prompt",
        size=[400, 100],
        inputs=[inp("clip", "CLIP", lid)],
        outputs=[out("CONDITIONING", "CONDITIONING")]
    ))
    links.append(link(lid, 2, 0, 8, 0, "CLIP")); lid += 1

    # [9] LTXVImgToVideoInplaceKJ - Inject first frame (index=0) and last frame (index=-1)
    # NOTE: This is a DynamicCombo node - widgets_values is a placeholder.
    # In ComfyUI UI, select "2 images" from the dropdown, then set:
    #   image_1 = first_frame, index_1 = 0, strength_1 = 1.0
    #   image_2 = last_frame, index_2 = -1, strength_2 = 1.0
    nodes.append(node(9, "LTXVImgToVideoInplaceKJ", [400, 500],
        [2],  # DynamicCombo: select "2 images"
        title="Inject First+Last Frame",
        size=[350, 200],
        inputs=[inp("vae", "VAE", lid), inp("latent", "LATENT", lid+1)],
        outputs=[out("latent", "LATENT")]
    ))
    links.append(link(lid, 3, 0, 9, 0, "VAE")); lid += 1
    links.append(link(lid, 6, 0, 9, 1, "LATENT")); lid += 1

    # [10] LTXVConditioning
    nodes.append(node(10, "LTXVConditioning", [800, 200],
        [25.0],
        size=[315, 58],
        inputs=[inp("positive", "CONDITIONING", lid), inp("negative", "CONDITIONING", lid+1)],
        outputs=[out("positive", "CONDITIONING"), out("negative", "CONDITIONING")]
    ))
    links.append(link(lid, 7, 0, 10, 0, "CONDITIONING")); lid += 1
    links.append(link(lid, 8, 0, 10, 1, "CONDITIONING")); lid += 1

    # [11] LTX2_NAG - Negative Attention Guidance (scale=1.0 for distilled)
    nodes.append(node(11, "LTX2_NAG", [800, 0],
        [1.0, 0.25, 2.5, True],
        title="NAG (required for distilled)",
        size=[315, 150],
        inputs=[inp("model", "MODEL", lid)],
        outputs=[out("model", "MODEL")]
    ))
    links.append(link(lid, 1, 0, 11, 0, "MODEL")); lid += 1

    # [12] KSampler (30 steps for FFLF consistency)
    nodes.append(node(12, "KSampler", [800, 350],
        [156680208700286, "randomize", 30, 5.5, "euler_ancestral", "normal", 1.0],
        size=[315, 262],
        inputs=[
            inp("model", "MODEL", lid),
            inp("positive", "CONDITIONING", lid+1),
            inp("negative", "CONDITIONING", lid+2),
            inp("latent_image", "LATENT", lid+3),
        ],
        outputs=[out("LATENT", "LATENT")]
    ))
    links.append(link(lid, 11, 0, 12, 0, "MODEL")); lid += 1
    links.append(link(lid, 10, 0, 12, 1, "CONDITIONING")); lid += 1
    links.append(link(lid, 10, 1, 12, 2, "CONDITIONING")); lid += 1
    links.append(link(lid, 9, 0, 12, 3, "LATENT")); lid += 1

    # [13] VAEDecodeTiled
    nodes.append(node(13, "VAEDecodeTiled", [1150, 350],
        [128, 64],
        size=[315, 106],
        inputs=[inp("samples", "LATENT", lid), inp("vae", "VAE", lid+1)],
        outputs=[out("IMAGE", "IMAGE")]
    ))
    links.append(link(lid, 12, 0, 13, 0, "LATENT")); lid += 1
    links.append(link(lid, 3, 0, 13, 1, "VAE")); lid += 1

    # [14] VHS_VideoCombine
    nodes.append(node(14, "VHS_VideoCombine", [1500, 350],
        {
            "frame_rate": 25, "loop_count": 0,
            "filename_prefix": "kijai_fflf",
            "format": "video/h264-mp4", "pix_fmt": "yuv420p", "crf": 19,
            "save_metadata": True, "trim_to_audio": False,
            "pingpong": False, "save_output": True,
            "videopreview": {"hidden": False, "paused": False, "params": {"filename": "kijai_fflf.mp4", "subfolder": "", "type": "output", "format": "video/h264-mp4", "frame_rate": 25}}
        },
        size=[320, 200],
        inputs=[inp("images", "IMAGE", lid)],
        outputs=[]
    ))
    links.append(link(lid, 13, 0, 14, 0, "IMAGE")); lid += 1

    return {
        "last_node_id": 14, "last_link_id": lid,
        "nodes": nodes, "links": links,
        "groups": [{"title": "Workflow 3: Kijai FFLF (First Frame Last Frame)", "bounding": [-50, -50, 2300, 1500], "color": "#b5812d"}],
        "config": {},
        "extra": {"ds": {"scale": 1, "offset": [0, 0]}, "info": {"name": "Kijai FFLF", "description": "First Frame + Last Frame interpolation. LTXVImgToVideoInplaceKJ injects both endpoints, NAG ensures quality."}},
        "version": 0.4,
    }


if __name__ == "__main__":
    workflows = [
        ("workflow1_prompt_relay_i2v.json", build_workflow1),
        ("workflow2_extension.json", build_workflow2),
        ("workflow3_fflf.json", build_workflow3),
    ]

    for filename, builder in workflows:
        wf = builder()
        path = os.path.join(OUT_DIR, filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(wf, f, indent=2, ensure_ascii=False)
        print(f"✅ {filename} ({len(wf['nodes'])} nodes, {len(wf['links'])} links)")
