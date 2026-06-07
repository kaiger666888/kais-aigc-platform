#!/usr/bin/env python3
"""Demo runner for Qwen-Image-Edit-2511 ComfyUI workflows (10/11/12).

Usage:
  python3 run_qwen2511_demo.py --wf 10 --image input.png --prompt "Replace background with sunset"
  python3 run_qwen2511_demo.py --wf 11 --image character.png
  python3 run_qwen2511_demo.py --wf 12 --image photo.png --prompt "Remove watermark"
"""

import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

WF_FILES = {
    10: "workflow10_qwen_material.json",
    11: "workflow11_qwen_multiangle.json",
    12: "workflow12_qwen_inpaint.json",
}

WF_PROMPTS = {
    10: "Replace the wooden table with a marble table",
    11: "Generate multi-angle views of this character: front, side, and back view",
    12: "Remove the person from the background and fill with sky",
}


def find_nodes(workflow, node_type):
    return [n for n in workflow["nodes"] if n["type"] == node_type]


def set_prompt(workflow, prompt):
    te_nodes = find_nodes(workflow, "TextEncodeQwenImageEdit")
    if te_nodes:
        te_nodes[0]["widgets_values"][0] = prompt
        print(f"📝 Prompt: {prompt[:80]}")


def set_seed(workflow, seed):
    for n in workflow["nodes"]:
        if n["type"] == "KSampler":
            n["widgets_values"][0] = seed
            break


def upload_image(image_path, comfyui_url):
    p = Path(image_path)
    with open(p, "rb") as f:
        resp = requests.post(f"{comfyui_url}/upload/image",
                             files={"image": (p.name, f)},
                             data={"overwrite": "true"})
    resp.raise_for_status()
    filename = resp.json()["name"]
    print(f"📤 Uploaded: {filename}")
    return filename


def build_api_prompt(workflow, comfyui_url):
    """Convert LiteGraph JSON to ComfyUI API format.

    Key insight: Every node in the API format MUST have an 'inputs' dict.
    Widget values are positional and map to non-linked widget-capable params
    in the order they appear in required + optional input definitions.
    """
    link_map = {}
    for link in workflow["links"]:
        link_map[link[0]] = (link[1], link[2])

    try:
        obj_info = requests.get(f"{comfyui_url}/object_info", timeout=10).json()
    except Exception:
        obj_info = {}

    # ComfyUI type tags (passed via links, not widgets)
    TYPE_TAGS = {'CLIP', 'VAE', 'MODEL', 'CONDITIONING', 'LATENT', 'IMAGE',
                'MASK', 'CONTROL_NET', 'UPSCALE_MODEL'}

    api = {}
    for node in workflow["nodes"]:
        nid = str(node["id"])
        ntype = node["type"]

        # Collect linked input names
        linked_names = set()
        for inp in node.get("inputs", []):
            if inp.get("link") is not None:
                linked_names.add(inp["name"])

        # Build inputs dict starting with links
        node_inputs = {}
        for inp in node.get("inputs", []):
            if inp.get("link") is not None:
                src_node, src_slot = link_map[inp["link"]]
                node_inputs[inp["name"]] = [str(src_node), src_slot]

        # Map widget values to non-linked widget-capable params
        widgets = node.get("widgets_values", [])
        if widgets and ntype in obj_info:
            widget_capable = []  # ordered list of (param_name, type_tag)
            for section in ["required", "optional"]:
                for key, val in obj_info[ntype]["input"].get(section, {}).items():
                    if key in linked_names:
                        continue
                    # Widget-capable: STRING, INT, FLOAT, BOOLEAN, dropdown (list of str)
                    if isinstance(val, (tuple, list)) and len(val) >= 1:
                        v0 = val[0]
                        # Widget-capable: STRING, INT, FLOAT, BOOLEAN, dropdown
                        # Type tags like 'CLIP', 'VAE', 'IMAGE' — skip them
                        if isinstance(v0, str) and isinstance(val[1], dict) and val[1]:
                            widget_capable.append(key)
                        elif isinstance(v0, (int, float)):
                            widget_capable.append(key)
                        elif isinstance(v0, bool):
                            widget_capable.append(key)
                        elif isinstance(v0, list) and v0 and isinstance(v0[0], str):
                            # dropdown (e.g. sampler_name, clip_name)
                            widget_capable.append(key)
                        elif isinstance(v0, str) and not isinstance(val[1], dict):
                            pass  # type tag, not widget
                        elif v0 not in TYPE_TAGS:
                            widget_capable.append(key)
            for i, key in enumerate(widget_capable):
                if i < len(widgets):
                    node_inputs[key] = widgets[i]

        api[nid] = {
            "class_type": ntype,
            "_meta": {"title": node.get("title", "")},
            "inputs": node_inputs,
        }

    return api


def submit_prompt(api_prompt, comfyui_url):
    payload = {"prompt": api_prompt, "client_id": str(uuid.uuid4())}
    resp = requests.post(f"{comfyui_url}/prompt", json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"ComfyUI error: {json.dumps(data['error'], indent=2)[:2000]}")
    prompt_id = data["prompt_id"]
    print(f"🚀 Submitted: prompt_id={prompt_id}")
    return prompt_id


def poll_history(prompt_id, comfyui_url, timeout=600):
    start = time.time()
    while time.time() - start < timeout:
        resp = requests.get(f"{comfyui_url}/history/{prompt_id}")
        if resp.status_code == 200:
            history = resp.json()
            if prompt_id in history:
                status = history[prompt_id].get("status", {})
                if status.get("completed", False) or status.get("status_str") == "success":
                    return history[prompt_id].get("outputs", {})
                if status.get("status_str") == "error":
                    raise RuntimeError(f"Workflow error: {json.dumps(status, indent=2)[:500]}")
                pct = status.get("value", 0) / max(status.get("value_max", 1), 1) * 100
                sys.stdout.write(f"\r⏳ Progress: {pct:.0f}%")
                sys.stdout.flush()
        time.sleep(2)
    raise TimeoutError(f"Workflow timed out after {timeout}s")


def download_output(outputs, output_path, comfyui_url):
    for node_id, node_out in outputs.items():
        if "images" in node_out:
            for img in node_out["images"]:
                url = (f"{comfyui_url}/view?filename={img['filename']}"
                       f"&subfolder={img.get('subfolder', '')}"
                       f"&type={img.get('type', 'output')}")
                resp = requests.get(url, timeout=30)
                resp.raise_for_status()
                with open(output_path, "wb") as f:
                    f.write(resp.content)
                print(f"\n💾 Saved: {output_path} ({len(resp.content)/1024:.0f} KB)")
                return output_path
    return None


def main():
    parser = argparse.ArgumentParser(description="Qwen-Image-Edit-2511 Demo Runner")
    parser.add_argument("--wf", type=int, required=True, choices=[10, 11, 12])
    parser.add_argument("--image", type=str, help="Input image path")
    parser.add_argument("--prompt", type=str, help="Edit prompt")
    parser.add_argument("--url", type=str, default="http://localhost:8188")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    comfyui_url = args.url

    # Check ComfyUI
    try:
        requests.get(f"{comfyui_url}/system_stats", timeout=5).raise_for_status()
        print(f"✅ ComfyUI connected: {comfyui_url}")
    except Exception:
        print(f"❌ Cannot connect to ComfyUI at {comfyui_url}")
        sys.exit(1)

    # Load workflow
    wf_file = os.path.join(SCRIPT_DIR, WF_FILES[args.wf])
    with open(wf_file) as f:
        workflow = json.load(f)
    print(f"📋 {workflow['extra']['info']['name']}")

    prompt = args.prompt or WF_PROMPTS.get(args.wf, "")
    if prompt:
        set_prompt(workflow, prompt)
    set_seed(workflow, args.seed)

    if args.image:
        if not os.path.exists(args.image):
            print(f"❌ Image not found: {args.image}")
            sys.exit(1)
        upload_image(args.image, comfyui_url)
        img_name = Path(args.image).name
        for n in workflow["nodes"]:
            if n["type"] == "LoadImage":
                n["widgets_values"][0] = img_name

    api_prompt = build_api_prompt(workflow, comfyui_url)

    if args.dry_run:
        print(f"\n🔍 API Payload (dry-run):")
        print(json.dumps(api_prompt, indent=2, ensure_ascii=False)[:3000])
        return

    prompt_id = submit_prompt(api_prompt, comfyui_url)
    outputs = poll_history(prompt_id, comfyui_url, timeout=600)
    output_path = args.output or f"demo_qwen_wf{args.wf}_{int(time.time())}.png"
    result = download_output(outputs, output_path, comfyui_url)
    if result:
        print(f"✅ Done! Output: {result}")
    else:
        print("⚠️ No output images found")


if __name__ == "__main__":
    main()
