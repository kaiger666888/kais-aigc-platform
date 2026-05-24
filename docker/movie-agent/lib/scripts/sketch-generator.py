#!/usr/bin/env python3
"""
sketch-generator.py — 线稿生成器

将场景描述 + S.P.A.C.E空间约束 + 角色参考图 → 漫画风格黑白线稿

用法:
  python3 sketch-generator.py \
    --prompt "角色坐在桌前吃面，看着面前的屏幕" \
    --space "SUBJECT:角色正面坐姿，双手持筷;PROPS:碗、筷子、屏幕;COMPOSITION:中景;ENVIRONMENT:简约房间" \
    --ref /path/to/char_ref.png \
    --output /path/to/output.png \
    [--model jimeng-5.0] \
    [--ratio 9:16] \
    [--sample-strength 0.35]

环境变量:
  JIMENG_SESSION_ID: 即梦 session ID
  JIMENG_API_URL: API 地址 (默认 http://localhost:8000)
"""

import argparse, json, base64, urllib.request, urllib.error, os, sys, time

API_URL = os.environ.get("JIMENG_API_URL", "http://localhost:8000")
SESSION_ID = os.environ.get("JIMENG_SESSION_ID", "")


def img_to_base64(path):
    """图片文件转 base64 data URI"""
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    ext = os.path.splitext(path)[1].lstrip(".")
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext, "image/png")
    return f"data:{mime};base64,{b64}"


def generate_sketch(prompt, space_constraints, ref_images, model, ratio, sample_strength, depth_constraints=""):
    """调用即梦 API 生成线稿"""
    
    # 构建线稿专用 prompt
    sketch_prompt = (
        f"黑白漫画风格线稿，简洁干净的线条，无阴影无渐变。\n"
        f"{prompt}\n"
        f"空间约束：{space_constraints}\n"
    )
    
    # 注入深度层次约束
    if depth_constraints:
        sketch_prompt += f"深度层次：{depth_constraints}\n"
    
    sketch_prompt += f"纯黑白线稿，清晰轮廓线，漫画分镜风格，没有颜色，没有灰度"
    
    negative = (
        "彩色, 上色, 渲染, 阴影, 光影, gradient, colored, rendered, shaded, 油画, 水彩, 照片, 3D, realistic, photo, "
        "bad anatomy, deformed, distorted, disfigured, mutated hands, missing fingers, extra fingers, "
        "fused fingers, too many fingers, bad hands, extra limbs, missing limbs, bad proportions, "
        "distorted face, asymmetric face, long neck, malformed limbs, unnatural pose"
    )
    
    body = {
        "model": model,
        "prompt": sketch_prompt,
        "negative_prompt": negative,
        "ratio": ratio,
        "resolution": "2k",
        "sample_strength": sample_strength,
    }
    
    if ref_images:
        body["images"] = ref_images
    
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{API_URL}/v1/images/generations",
        data=data,
        headers={
            "Authorization": f"Bearer {SESSION_ID}",
            "Content-Type": "application/json"
        }
    )
    
    with urllib.request.urlopen(req, timeout=120) as r:
        result = json.loads(r.read())
    
    if not result.get("data"):
        raise RuntimeError(f"API 未返回图片: {result}")
    
    return result["data"][0]["url"]


def download_image(url, output_path):
    """下载图片到本地"""
    urllib.request.urlretrieve(url, output_path)
    return output_path


def main():
    parser = argparse.ArgumentParser(description="线稿生成器")
    parser.add_argument("--prompt", required=True, help="场景描述")
    parser.add_argument("--space", default="", help="S.P.A.C.E 空间约束")
    parser.add_argument("--depth", default="", help="深度层次约束 (foreground=...;midground=...;background=...)")
    parser.add_argument("--ref", nargs="*", default=[], help="角色参考图路径（可多张）")
    parser.add_argument("--output", required=True, help="输出线稿路径")
    parser.add_argument("--model", default="jimeng-5.0", help="模型版本")
    parser.add_argument("--ratio", default="9:16", help="图片比例")
    parser.add_argument("--sample-strength", type=float, default=0.35, help="参考图影响强度")
    parser.add_argument("--retry", type=int, default=2, help="失败重试次数")
    
    args = parser.parse_args()
    
    if not SESSION_ID:
        print("❌ 请设置 JIMENG_SESSION_ID 环境变量")
        sys.exit(1)
    
    # 准备参考图
    ref_images = []
    for ref_path in args.ref:
        if os.path.exists(ref_path):
            ref_images.append(img_to_base64(ref_path))
            print(f"📎 参考图: {os.path.basename(ref_path)}")
        else:
            print(f"⚠️ 参考图不存在: {ref_path}")
    
    # 生成线稿
    for attempt in range(args.retry + 1):
        try:
            print(f"🎨 生成线稿 (尝试 {attempt + 1}/{args.retry + 1})...", flush=True)
            url = generate_sketch(
                args.prompt, args.space, ref_images,
                args.model, args.ratio, args.sample_strength,
                args.depth
            )
            
            # 确保输出目录存在
            os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
            
            download_image(url, args.output)
            print(f"✅ 线稿已保存: {args.output}")
            
            # 输出 JSON 元数据供后续流程使用
            meta = {
                "output": args.output,
                "url": url,
                "prompt": args.prompt,
                "space": args.space,
                "model": args.model,
                "sample_strength": args.sample_strength,
                "ref_count": len(ref_images),
                "attempts": attempt + 1
            }
            meta_path = args.output + ".meta.json"
            with open(meta_path, "w") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
            
            sys.exit(0)
            
        except Exception as e:
            print(f"❌ 生成失败: {e}")
            if attempt < args.retry:
                time.sleep(3)
            else:
                sys.exit(1)


if __name__ == "__main__":
    main()
