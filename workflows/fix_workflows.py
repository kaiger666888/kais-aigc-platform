#!/usr/bin/env python3
"""Update 3 Kijai LTX-2.3 workflow JSONs to use correct parameters.

Changes:
- UNETLoader with ltx-2.3-22b-distilled-mxfp8.safetensors (mxfp8 block32, NOT GGUF)
- W1: length=81 (3.2s per Kimi spec)
- W2: VHS_LoadVideoPath node name fix
- All other parameters kept identical (verified working)
"""

import json, os, sys

DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_NAME = "ltx-2.3-22b-distilled-mxfp8.safetensors"
CLIP1 = "gemma_3_12B_it_fp8_scaled.safetensors"
CLIP2 = "ltx-2.3_text_projection_bf16.safetensors"
VAE_NAME = "ltx2_vae/LTX23_video_vae_bf16.safetensors"

def update_model_loader(nodes):
    for n in nodes:
        if n['type'] in ('UNETLoader', 'UnetLoaderGGUF', 'CheckpointLoaderSimple'):
            n['type'] = 'UNETLoader'
            if len(n['widgets_values']) >= 1:
                n['widgets_values'][0] = MODEL_NAME
            if len(n['widgets_values']) >= 2:
                n['widgets_values'][1] = 'default'

def fix_workflow1():
    path = os.path.join(DIR, 'workflow1_prompt_relay_i2v.json')
    with open(path) as f:
        data = json.load(f)
    
    for n in data['nodes']:
        # Fix model loader
        if n['type'] in ('UNETLoader', 'UnetLoaderGGUF'):
            n['type'] = 'UNETLoader'
            n['widgets_values'] = [MODEL_NAME, 'default']
        # Fix length: 161 -> 81 (3.2s per Kimi spec)
        if n['type'] == 'EmptyLTXVLatentVideo':
            n['widgets_values'][2] = 81  # length
    
    with open(path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f'✅ W1 updated (length=81, UNETLoader+mxfp8)')

def fix_workflow2():
    path = os.path.join(DIR, 'workflow2_extension.json')
    with open(path) as f:
        data = json.load(f)
    
    for n in data['nodes']:
        if n['type'] in ('UNETLoader', 'UnetLoaderGGUF'):
            n['type'] = 'UNETLoader'
            n['widgets_values'] = [MODEL_NAME, 'default']
        # Fix LoadVideoPath -> VHS_LoadVideoPath
        if n['type'] == 'LoadVideoPath':
            n['type'] = 'VHS_LoadVideoPath'
    
    with open(path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f'✅ W2 updated (UNETLoader+mxfp8, VHS_LoadVideoPath)')

def fix_workflow3():
    path = os.path.join(DIR, 'workflow3_fflf.json')
    with open(path) as f:
        data = json.load(f)
    
    for n in data['nodes']:
        if n['type'] in ('UNETLoader', 'UnetLoaderGGUF'):
            n['type'] = 'UNETLoader'
            n['widgets_values'] = [MODEL_NAME, 'default']
    
    with open(path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f'✅ W3 updated (UNETLoader+mxfp8)')

if __name__ == '__main__':
    fix_workflow1()
    fix_workflow2()
    fix_workflow3()
