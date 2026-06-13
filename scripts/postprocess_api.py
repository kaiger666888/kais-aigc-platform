#!/usr/bin/env python3
"""
统一后处理 API — 一键执行 CodeFormer + Depth + UltraSharp
用法:
  python postprocess_api.py --input test_input.png --prefix test
  python postprocess_api.py --input test_input.png --prefix test --steps codeformer,ultrasharp
  python postprocess_api.py --input test_input.png --prefix test --steps depth --depth-only
"""
import argparse
import json
import time
import urllib.request
import urllib.error
import sys

COMFYUI_URL = "http://localhost:8188"

def submit_prompt(workflow):
    """提交 workflow 到 ComfyUI"""
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt",
        data=json.dumps({"prompt": workflow}).encode(),
        headers={"Content-Type": "application/json"}
    )
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        data = json.loads(resp.read())
        return data.get("prompt_id")
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"提交失败: {e.code} - {body[:300]}")
        return None
    except Exception as e:
        print(f"提交失败: {e}")
        return None

def wait_for_result(prompt_id, timeout=300):
    """等待执行完成并返回结果"""
    for i in range(timeout // 5):
        time.sleep(5)
        try:
            req = urllib.request.Request(f"{COMFYUI_URL}/history/{prompt_id}")
            resp = urllib.request.urlopen(req, timeout=10)
            hist = json.loads(resp.read())
            if prompt_id in hist:
                entry = hist[prompt_id]
                status = entry.get("status", {})
                if status.get("status_str") == "error":
                    msgs = status.get("messages", [[]])
                    print(f"  执行错误: {str(msgs[-1][-1])[:200] if msgs else 'unknown'}")
                    return None
                outputs = entry.get("outputs", {})
                images = []
                for nid, out in outputs.items():
                    if "images" in out:
                        images.extend(out["images"])
                return images
        except Exception:
            pass
    print(f"  超时 ({timeout}s)")
    return None

def build_workflow(image_name, prefix, steps, depth_only=False):
    """构建后处理 workflow"""
    nodes = {}
    
    if not depth_only:
        # LoadImage
        nodes["1"] = {
            "class_type": "LoadImage",
            "inputs": {"image": image_name}
        }
    
    next_image = ["1", 0] if not depth_only else None
    node_id = 2
    
    # CodeFormer 面部修复
    if "codeformer" in steps:
        nodes[str(node_id)] = {
            "class_type": "FaceRestoreModelLoader",
            "inputs": {"model_name": "codeformer.pth"}
        }
        loader_id = str(node_id)
        node_id += 1
        
        nodes[str(node_id)] = {
            "class_type": "FaceRestoreCFWithModel",
            "inputs": {
                "facerestore_model": [loader_id, 0],
                "image": next_image,
                "facedetection": "retinaface_resnet50",
                "codeformer_fidelity": 0.7
            }
        }
        nodes[str(node_id + 1)] = {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": f"{prefix}_codeformer",
                "images": [str(node_id), 0]
            }
        }
        next_image = [str(node_id), 0]
        node_id += 2
    
    # DepthAnythingV2 深度图
    if "depth" in steps:
        nodes[str(node_id)] = {
            "class_type": "DepthAnythingV2Preprocessor",
            "inputs": {
                "image": next_image,
                "model": "large"
            }
        }
        nodes[str(node_id + 1)] = {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": f"{prefix}_depth",
                "images": [str(node_id), 0]
            }
        }
        if depth_only:
            return nodes
        node_id += 2
    
    # UltraSharp 锐化放大
    if "ultrasharp" in steps:
        nodes[str(node_id)] = {
            "class_type": "Upscale Model Loader",
            "inputs": {"model_name": "4x-UltraSharp.pth"}
        }
        loader_id = str(node_id)
        node_id += 1
        
        nodes[str(node_id)] = {
            "class_type": "ImageUpscaleWithModel",
            "inputs": {
                "upscale_model": [loader_id, 0],
                "image": next_image
            }
        }
        nodes[str(node_id + 1)] = {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": f"{prefix}_ultrasharp",
                "images": [str(node_id), 0]
            }
        }
        node_id += 2
    
    # RealESRGAN 锐化 (备选)
    if "realesrgan" in steps:
        nodes[str(node_id)] = {
            "class_type": "Upscale Model Loader",
            "inputs": {"model_name": "RealESRGAN_x4plus.pth"}
        }
        loader_id = str(node_id)
        node_id += 1
        
        nodes[str(node_id)] = {
            "class_type": "ImageUpscaleWithModel",
            "inputs": {
                "upscale_model": [loader_id, 0],
                "image": next_image
            }
        }
        nodes[str(node_id + 1)] = {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": f"{prefix}_realesrgan",
                "images": [str(node_id), 0]
            }
        }
    
    return nodes

def main():
    parser = argparse.ArgumentParser(description="统一后处理 API")
    parser.add_argument("--input", required=True, help="输入图片文件名（ComfyUI input 目录）")
    parser.add_argument("--prefix", default="post", help="输出文件前缀")
    parser.add_argument("--steps", default="codeformer,depth,ultrasharp", 
                       help="执行步骤，逗号分隔: codeformer,depth,ultrasharp,realesrgan")
    parser.add_argument("--depth-only", action="store_true", help="仅生成深度图")
    parser.add_argument("--timeout", type=int, default=300, help="超时秒数")
    args = parser.parse_args()
    
    steps = [s.strip() for s in args.steps.split(",")]
    
    print(f"🚀 统一后处理: {args.input}")
    print(f"   步骤: {', '.join(steps)}")
    print(f"   前缀: {args.prefix}")
    
    workflow = build_workflow(args.input, args.prefix, steps, args.depth_only)
    print(f"   节点数: {len(workflow)}")
    
    pid = submit_prompt(workflow)
    if not pid:
        sys.exit(1)
    
    print(f"   已提交: {pid[:12]}")
    
    images = wait_for_result(pid, args.timeout)
    if not images:
        sys.exit(1)
    
    print(f"\n✅ 完成! 生成 {len(images)} 张图片:")
    for img in images:
        print(f"   📄 {img['filename']} ({img.get('width','?')}x{img.get('height','?')})")

if __name__ == "__main__":
    main()
