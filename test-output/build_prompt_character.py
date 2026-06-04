import json

# 多视图 demo：用角色 front 图跑 TRELLIS.2 MultiViewImageToShape + TexturedMesh + ExportGLB
workflow = {
    "1": {
        "class_type": "LoadTrellis2Models",
        "inputs": {
            "resolution": "1024_cascade",
            "precision": "auto",
            "attn_backend": "auto"
        }
    },
    "2": {
        "class_type": "LoadImage",
        "inputs": {
            "image": "multiview_demo/character_front.png"
        }
    },
    "3": {
        "class_type": "Trellis2GetConditioning",
        "inputs": {
            "model_config": ["1", 0],
            "image": ["2", 0],
            "mask": ["2", 1],
            "background_color": "white"
        }
    },
    "4": {
        "class_type": "Trellis2MultiViewImageToShape",
        "inputs": {
            "model_config": ["1", 0],
            "front_image": ["2", 0],
            "front_mask": ["2", 1],
            "seed": 12345,
            "ss_guidance_strength": 6.5,
            "ss_guidance_rescale": 0.05,
            "ss_sampling_steps": 12,
            "shape_guidance_strength": 6.5,
            "shape_guidance_rescale": 0.05,
            "shape_sampling_steps": 12,
            "max_tokens": 49152,
            "front_axis": "z",
            "blend_temperature": 2.0,
            "background_color": "white"
        }
    },
    "5": {
        "class_type": "Trellis2ShapeToTexturedMesh",
        "inputs": {
            "model_config": ["1", 0],
            "conditioning": ["3", 0],
            "shape_slat": ["4", 1],
            "subs": ["4", 2],
            "seed": 12345,
            "tex_guidance_strength": 3.0,
            "tex_guidance_rescale": 0.20,
            "tex_sampling_steps": 12
        }
    },
    "6": {
        "class_type": "Trellis2RasterizePBR",
        "inputs": {
            "trimesh": ["4", 0],
            "voxelgrid": ["5", 0],
            "texture_size": 2048
        }
    },
    "7": {
        "class_type": "Trellis2ExportTrimesh",
        "inputs": {
            "trimesh": ["6", 0],
            "filename_prefix": "multiview_demo/character_textured",
            "file_format": "glb"
        }
    },
    "8": {
        "class_type": "Trellis2RenderPreview",
        "inputs": {
            "trimesh": ["6", 0]
        }
    }
}

payload = {"prompt": workflow, "client_id": "character_demo_001"}
with open("/home/kai/workspace/kais-aigc-platform/test-output/prompt_character.json", "w") as f:
    json.dump(payload, f, indent=2)
print("Character textured workflow written")
