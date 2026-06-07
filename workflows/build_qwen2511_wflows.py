#!/usr/bin/env python3
"""Build Qwen-Image-Edit-2511 ComfyUI workflow JSONs (v2 with image input).

Output: workflow10_qwen_material.json, workflow11_qwen_multiangle.json, workflow12_qwen_inpaint.json
"""

import json
import os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Model filenames
QWEN_DIT = "qwen_image_edit_2511_fp8mixed.safetensors"
QWEN_CLIP = "qwen_2.5_vl_7b_fp8_scaled.safetensors"
QWEN_VAE = "qwen_image_vae.safetensors"
QWEN_MULTIANGLE_LORA = "qwen-image-edit-2511-multiple-angles-lora.safetensors"

# Sampling defaults (QwenImage default shift=1.15)
QWEN_SHIFT = 1.15
DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 1024
DEFAULT_STEPS = 40
DEFAULT_CFG = 5.0
DEFAULT_SAMPLER = "euler"
DEFAULT_SCHEDULER = "normal"


# ── Helpers ───────────────────────────────────────────────────────────────
def node(id, type, pos, widgets, title=None, inputs=None, outputs=None, size=None):
    n = {
        "id": id, "type": type, "pos": list(pos),
        "size": size or [315, 200],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": inputs or [], "outputs": outputs or [],
        "properties": {"Node name for S&R": type},
        "widgets_values": widgets,
    }
    if title:
        n["title"] = title
    return n


def link(id, src_node, src_slot, dst_node, dst_slot, type_str):
    return [id, src_node, src_slot, dst_node, dst_slot, type_str]


def out(name, type_str, links=None):
    return {"name": name, "type": type_str, "links": links or []}


def inp(name, type_str, link=None):
    return {"name": name, "type": type_str, "link": link}


def wrap(nodes, links, lid, nid, title, bounding, color="#3f789e", info=None):
    return {
        "last_node_id": nid, "last_link_id": lid,
        "nodes": nodes, "links": links,
        "groups": [{"title": title, "bounding": bounding, "color": color}],
        "config": {},
        "extra": {
            "ds": {"scale": 1, "offset": [0, 0]},
            "info": {"name": title, "description": (info or title)},
        },
        "version": 0.4,
    }


# ── Shared base nodes ───────────────────────────────────────────────────
def base_loader_nodes(nid_start, lid_start):
    """Create UNETLoader, CLIPLoader, VAELoader nodes. Returns (nodes, lid, nid)."""
    nodes = []
    lid = lid_start
    nid = nid_start

    # [N] UNETLoader
    nodes.append(node(nid, "UNETLoader", [0, 0],
        [QWEN_DIT, "fp8_e4m3fn"],
        title="DiT (Qwen Image Edit 2511)", size=[315, 100],
        outputs=[out("model", "MODEL")]))
    nid += 1

    # [N] CLIPLoader (type=qwen_image is required!)
    nodes.append(node(nid, "CLIPLoader", [0, 150],
        [QWEN_CLIP, "qwen_image"],
        title="Text Encoder (Qwen 2.5 VL 7B)", size=[315, 120],
        outputs=[out("clip", "CLIP")]))
    nid += 1

    # [N] VAELoader
    nodes.append(node(nid, "VAELoader", [0, 320],
        [QWEN_VAE],
        title="VAE (Qwen Image VAE)", size=[315, 80],
        outputs=[out("vae", "VAE")]))
    nid += 1

    return nodes, lid, nid


# ── Workflow 10: Material Replacement (with image input) ────────────────
def build_workflow10():
    nodes = []
    links = []
    lid = 1

    # Loaders
    base_nodes, lid, nid = base_loader_nodes(1, lid)
    nodes.extend(base_nodes)
    # Nodes: 1=UNET, 2=CLIP, 3=VAE

    # [4] LoadImage (original image)
    nodes.append(node(4, "LoadImage", [400, 0],
        ["example.png", "image"],
        title="Input Image", size=[315, 314],
        outputs=[out("IMAGE", "IMAGE"), out("MASK", "MASK")]))

    # [5] TextEncodeQwenImageEdit (positive - with image + vae optional inputs)
    nodes.append(node(5, "TextEncodeQwenImageEdit", [800, 0],
        ["Replace the wooden table with a marble table"],
        title="Edit Instruction",
        inputs=[
            inp("clip", "CLIP", lid),     # from CLIPLoader
            inp("vae", "VAE", lid + 1),    # from VAELoader (optional)
            inp("image", "IMAGE", lid + 2),  # from LoadImage (optional)
        ],
        outputs=[out("CONDITIONING", "CONDITIONING")]))
    links.append(link(lid, 2, 0, 5, 0, "CLIP")); lid += 1
    links.append(link(lid, 3, 0, 5, 1, "VAE")); lid += 1
    links.append(link(lid, 4, 0, 5, 2, "IMAGE")); lid += 1

    # [6] TextEncodeQwenImageEdit (negative - no image)
    nodes.append(node(6, "TextEncodeQwenImageEdit", [800, 200],
        ["low quality, blurry, distorted, watermark, text"],
        title="Negative Prompt",
        inputs=[
            inp("clip", "CLIP", lid),
        ],
        outputs=[out("CONDITIONING", "CONDITIONING")]))
    links.append(link(lid, 2, 0, 6, 0, "CLIP")); lid += 1

    # [7] ModelSamplingAuraFlow
    nodes.append(node(7, "ModelSamplingAuraFlow", [800, 420],
        [QWEN_SHIFT],
        title="ModelSampling (shift=1.15)", size=[315, 60],
        inputs=[inp("model", "MODEL", lid)],
        outputs=[out("model", "MODEL")]))
    links.append(link(lid, 1, 0, 7, 0, "MODEL")); lid += 1

    # [8] EmptyLatentImage
    nodes.append(node(8, "EmptyLatentImage", [1200, 0],
        [DEFAULT_WIDTH, DEFAULT_HEIGHT, 1],
        title="Empty Latent (1024x1024)", size=[315, 100],
        outputs=[out("LATENT", "LATENT")]))

    # [9] KSampler
    nodes.append(node(9, "KSampler", [1200, 200],
        [42, DEFAULT_STEPS, DEFAULT_CFG, DEFAULT_SAMPLER, DEFAULT_SCHEDULER, 1.0],
        title="KSampler (40 steps, cfg=5.0)", size=[315, 260],
        inputs=[
            inp("model", "MODEL", lid),
            inp("positive", "CONDITIONING", lid + 1),
            inp("negative", "CONDITIONING", lid + 2),
            inp("latent_image", "LATENT", lid + 3),
        ],
        outputs=[out("LATENT", "LATENT")]))
    links.append(link(lid, 7, 0, 9, 0, "MODEL")); lid += 1
    links.append(link(lid, 5, 0, 9, 1, "CONDITIONING")); lid += 1
    links.append(link(lid, 6, 0, 9, 2, "CONDITIONING")); lid += 1
    links.append(link(lid, 8, 0, 9, 3, "LATENT")); lid += 1

    # [10] VAEDecode
    nodes.append(node(10, "VAEDecode", [1600, 0],
        [],
        title="VAE Decode", size=[200, 80],
        inputs=[
            inp("samples", "LATENT", lid),
            inp("vae", "VAE", lid + 1),
        ],
        outputs=[out("IMAGE", "IMAGE")]))
    links.append(link(lid, 9, 0, 10, 0, "LATENT")); lid += 1
    links.append(link(lid, 3, 0, 10, 1, "VAE")); lid += 1

    # [11] SaveImage
    nodes.append(node(11, "SaveImage", [1600, 200],
        ["qwen_material"],
        title="Save Image", size=[315, 100],
        inputs=[inp("images", "IMAGE", lid)],
        outputs=[]))
    links.append(link(lid, 10, 0, 11, 0, "IMAGE")); lid += 1

    return wrap(nodes, links, lid, 11,
        "Workflow 10: Qwen Image Edit – Material Replacement (with Image)",
        [-50, -50, 2100, 800], "#2d6a4f",
        "Image editing: pass original image + text instruction to Qwen-Image-Edit.\n"
        "Works with or without reference image in the prompt.")


# ── Workflow 11: Multi-Angle Character (with image input + LoRA) ────────
def build_workflow11():
    nodes = []
    links = []
    lid = 1

    # Loaders
    base_nodes, lid, nid = base_loader_nodes(1, lid)
    nodes.extend(base_nodes)

    # [4] LoadImage
    nodes.append(node(4, "LoadImage", [400, 0],
        ["example.png", "image"],
        title="Character Image", size=[315, 314],
        outputs=[out("IMAGE", "IMAGE"), out("MASK", "MASK")]))

    # [5] LoraLoaderModelOnly
    nodes.append(node(5, "LoraLoaderModelOnly", [400, 400],
        [QWEN_MULTIANGLE_LORA, 1.0],
        title="LoRA: Multi-Angle Character", size=[315, 120],
        inputs=[inp("model", "MODEL", lid)],
        outputs=[out("MODEL", "MODEL")]))
    links.append(link(lid, 1, 0, 5, 0, "MODEL")); lid += 1

    # [6] TextEncodeQwenImageEdit (with image)
    nodes.append(node(6, "TextEncodeQwenImageEdit", [800, 0],
        ["Generate front, side, and back views of this character in a 3D turnaround sheet"],
        title="Multi-Angle Instruction",
        inputs=[
            inp("clip", "CLIP", lid),
            inp("vae", "VAE", lid + 1),
            inp("image", "IMAGE", lid + 2),
        ],
        outputs=[out("CONDITIONING", "CONDITIONING")]))
    links.append(link(lid, 2, 0, 6, 0, "CLIP")); lid += 1
    links.append(link(lid, 3, 0, 6, 1, "VAE")); lid += 1
    links.append(link(lid, 4, 0, 6, 2, "IMAGE")); lid += 1

    # [7] TextEncodeQwenImageEdit (negative)
    nodes.append(node(7, "TextEncodeQwenImageEdit", [800, 200],
        ["low quality, blurry, distorted"],
        title="Negative Prompt",
        inputs=[inp("clip", "CLIP", lid)],
        outputs=[out("CONDITIONING", "CONDITIONING")]))
    links.append(link(lid, 2, 0, 7, 0, "CLIP")); lid += 1

    # [8] ModelSamplingAuraFlow
    nodes.append(node(8, "ModelSamplingAuraFlow", [800, 420],
        [QWEN_SHIFT], title="ModelSampling (shift=1.15)", size=[315, 60],
        inputs=[inp("model", "MODEL", lid)],
        outputs=[out("model", "MODEL")]))
    links.append(link(lid, 5, 0, 8, 0, "MODEL")); lid += 1

    # [9] EmptyLatentImage
    nodes.append(node(9, "EmptyLatentImage", [1200, 0],
        [DEFAULT_WIDTH, DEFAULT_HEIGHT, 1],
        title="Empty Latent (1024x1024)", size=[315, 100],
        outputs=[out("LATENT", "LATENT")]))

    # [10] KSampler
    nodes.append(node(10, "KSampler", [1200, 200],
        [42, DEFAULT_STEPS, DEFAULT_CFG, DEFAULT_SAMPLER, DEFAULT_SCHEDULER, 1.0],
        title="KSampler (40 steps, cfg=5.0)", size=[315, 260],
        inputs=[
            inp("model", "MODEL", lid),
            inp("positive", "CONDITIONING", lid + 1),
            inp("negative", "CONDITIONING", lid + 2),
            inp("latent_image", "LATENT", lid + 3),
        ],
        outputs=[out("LATENT", "LATENT")]))
    links.append(link(lid, 8, 0, 10, 0, "MODEL")); lid += 1
    links.append(link(lid, 6, 0, 10, 1, "CONDITIONING")); lid += 1
    links.append(link(lid, 7, 0, 10, 2, "CONDITIONING")); lid += 1
    links.append(link(lid, 9, 0, 10, 3, "LATENT")); lid += 1

    # [11] VAEDecode
    nodes.append(node(11, "VAEDecode", [1600, 0], [],
        title="VAE Decode", size=[200, 80],
        inputs=[inp("samples", "LATENT", lid), inp("vae", "VAE", lid + 1)],
        outputs=[out("IMAGE", "IMAGE")]))
    links.append(link(lid, 10, 0, 11, 0, "LATENT")); lid += 1
    links.append(link(lid, 3, 0, 11, 1, "VAE")); lid += 1

    # [12] SaveImage
    nodes.append(node(12, "SaveImage", [1600, 200], ["qwen_multiangle"],
        title="Save Image", size=[315, 100],
        inputs=[inp("images", "IMAGE", lid)], outputs=[]))
    links.append(link(lid, 11, 0, 12, 0, "IMAGE")); lid += 1

    return wrap(nodes, links, lid, 12,
        "Workflow 11: Qwen Image Edit – Multi-Angle Character (with Image + LoRA)",
        [-50, -50, 2100, 900], "#4a7729",
        "Multi-angle character generation with LoRA.\n"
        "Requires qwen-image-edit-2511-multiple-angles-lora.safetensors in loras/.")


# ── Workflow 12: Targeted Inpainting (with image + layered latent) ─────
def build_workflow12():
    nodes = []
    links = []
    lid = 1

    # Loaders
    base_nodes, lid, nid = base_loader_nodes(1, lid)
    nodes.extend(base_nodes)

    # [4] LoadImage
    nodes.append(node(4, "LoadImage", [400, 0],
        ["example.png", "image"],
        title="Input Photo", size=[315, 314],
        outputs=[out("IMAGE", "IMAGE"), out("MASK", "MASK")]))

    # [5] TextEncodeQwenImageEdit (positive with image)
    nodes.append(node(5, "TextEncodeQwenImageEdit", [800, 0],
        ["Remove the person from the background and fill with natural scenery"],
        title="Inpaint Instruction",
        inputs=[
            inp("clip", "CLIP", lid),
            inp("vae", "VAE", lid + 1),
            inp("image", "IMAGE", lid + 2),
        ],
        outputs=[out("CONDITIONING", "CONDITIONING")]))
    links.append(link(lid, 2, 0, 5, 0, "CLIP")); lid += 1
    links.append(link(lid, 3, 0, 5, 1, "VAE")); lid += 1
    links.append(link(lid, 4, 0, 5, 2, "IMAGE")); lid += 1

    # [6] TextEncodeQwenImageEdit (negative)
    nodes.append(node(6, "TextEncodeQwenImageEdit", [800, 200],
        ["low quality, blurry, distorted, artifacts"],
        title="Negative Prompt",
        inputs=[inp("clip", "CLIP", lid)],
        outputs=[out("CONDITIONING", "CONDITIONING")]))
    links.append(link(lid, 2, 0, 6, 0, "CLIP")); lid += 1

    # [7] ModelSamplingAuraFlow
    nodes.append(node(7, "ModelSamplingAuraFlow", [800, 420],
        [QWEN_SHIFT], title="ModelSampling (shift=1.15)", size=[315, 60],
        inputs=[inp("model", "MODEL", lid)],
        outputs=[out("model", "MODEL")]))
    links.append(link(lid, 1, 0, 7, 0, "MODEL")); lid += 1

    # [8] EmptyQwenImageLayeredLatentImage (layered for inpainting)
    nodes.append(node(8, "EmptyQwenImageLayeredLatentImage", [1200, 0],
        [DEFAULT_WIDTH, DEFAULT_HEIGHT, 3, 1],
        title="Layered Latent (1024x1024, 3 layers)", size=[315, 120],
        outputs=[out("LATENT", "LATENT")]))

    # [9] KSampler (denoise=0.8 for inpainting - preserve more of original)
    nodes.append(node(9, "KSampler", [1200, 250],
        [42, DEFAULT_STEPS, DEFAULT_CFG, DEFAULT_SAMPLER, DEFAULT_SCHEDULER, 0.8],
        title="KSampler (40 steps, cfg=5.0, denoise=0.8)", size=[315, 260],
        inputs=[
            inp("model", "MODEL", lid),
            inp("positive", "CONDITIONING", lid + 1),
            inp("negative", "CONDITIONING", lid + 2),
            inp("latent_image", "LATENT", lid + 3),
        ],
        outputs=[out("LATENT", "LATENT")]))
    links.append(link(lid, 7, 0, 9, 0, "MODEL")); lid += 1
    links.append(link(lid, 5, 0, 9, 1, "CONDITIONING")); lid += 1
    links.append(link(lid, 6, 0, 9, 2, "CONDITIONING")); lid += 1
    links.append(link(lid, 8, 0, 9, 3, "LATENT")); lid += 1

    # [10] VAEDecode
    nodes.append(node(10, "VAEDecode", [1600, 0], [],
        title="VAE Decode", size=[200, 80],
        inputs=[inp("samples", "LATENT", lid), inp("vae", "VAE", lid + 1)],
        outputs=[out("IMAGE", "IMAGE")]))
    links.append(link(lid, 9, 0, 10, 0, "LATENT")); lid += 1
    links.append(link(lid, 3, 0, 10, 1, "VAE")); lid += 1

    # [11] SaveImage
    nodes.append(node(11, "SaveImage", [1600, 200], ["qwen_inpaint"],
        title="Save Image", size=[315, 100],
        inputs=[inp("images", "IMAGE", lid)], outputs=[]))
    links.append(link(lid, 10, 0, 11, 0, "IMAGE")); lid += 1

    return wrap(nodes, links, lid, 11,
        "Workflow 12: Qwen Image Edit – Targeted Inpainting (Layered Latent)",
        [-50, -50, 2100, 800], "#6b2737",
        "Targeted inpainting using EmptyQwenImageLayeredLatentImage.\n"
        "Uses 3 layers + denoise=0.8 for precise editing.")


# ── Main ─────────────────────────────────────────────────────────────────
def main():
    builders = {
        "workflow10_qwen_material.json": build_workflow10,
        "workflow11_qwen_multiangle.json": build_workflow11,
        "workflow12_qwen_inpaint.json": build_workflow12,
    }
    for fname, fn in builders.items():
        path = os.path.join(OUT_DIR, fname)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(fn(), f, indent=2, ensure_ascii=False)
        print(f"✅ {fname}")
    print(f"\nGenerated {len(builders)} Qwen-Image-Edit-2511 workflows in {OUT_DIR}")


if __name__ == "__main__":
    main()
