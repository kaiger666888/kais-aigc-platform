import json

# v3: 使用 RGBA PNG（LoadImage 自动提取 alpha 作为 mask），跳过 RemoveBackground
workflow = {
    "2": {
        "class_type": "LoadTrellis2Models",
        "inputs": {
            "resolution": "1024_cascade",
            "precision": "auto",
            "attn_backend": "auto"
        }
    },
    "3": {
        "class_type": "LoadImage",
        "inputs": {
            "image": "multiview_demo/front.png"
        }
    },
    "5": {
        "class_type": "Trellis2GetConditioning",
        "inputs": {
            "model_config": ["2", 0],
            "image": ["3", 0],
            "mask": ["3", 1],  # LoadImage 的第二个输出是 mask（来自 alpha channel）
            "background_color": "black"
        }
    },
    "6": {
        "class_type": "Trellis2MultiViewImageToShape",
        "inputs": {
            "model_config": ["2", 0],
            "front_image": ["3", 0],
            "front_mask": ["3", 1],  # 直接用 alpha channel 作为 mask
            "seed": 42,
            "ss_guidance_strength": 6.5,
            "ss_guidance_rescale": 0.05,
            "ss_sampling_steps": 12,
            "shape_guidance_strength": 6.5,
            "shape_guidance_rescale": 0.05,
            "shape_sampling_steps": 12,
            "max_tokens": 49152,
            "front_axis": "z",
            "blend_temperature": 2.0,
            "background_color": "black"
        }
    },
    "7": {
        "class_type": "Trellis2RenderPreview",
        "inputs": {
            "trimesh": ["6", 0]
        }
    },
    "8": {
        "class_type": "Trellis2ExportTrimesh",
        "inputs": {
            "trimesh": ["6", 0],
            "filename_prefix": "multiview_demo/demo_mesh",
            "file_format": "glb"
        }
    }
}

payload = {"prompt": workflow, "client_id": "demo_003"}
with open("/home/kai/workspace/kais-aigc-platform/test-output/prompt_v3.json", "w") as f:
    json.dump(payload, f, indent=2)
print("v3 written (RGBA PNG, no RemoveBackground)")
