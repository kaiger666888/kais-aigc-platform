#!/usr/bin/env python3
"""
sketch-to-render.py — 基于线稿的渲染器 (四维锚定融合版)

将审核通过的线稿 + 角色参考 + 风格参考 + 光照/空间描述 → 最终渲染图

四维锚定 images 顺序：
  images[0] = 线稿（结构锚定）
  images[1] = 角色正面参考（身份锚定，权重最高）
  images[2] = 角色 3/4 视角参考（身份锚定补充）
  images[3] = 风格/光影参考图（光影锚定）

用法:
  python3 sketch-to-render.py \
    --sketch /path/to/sketch.png \
    --prompt "赛博朋克风格，霓虹灯光，暗色调" \
    --ref /path/to/char_front.png /path/to/char_34.png \
    --style-ref /path/to/style_ref.png \
    --lighting "direction=upper-left,intensity=0.7,color_temp=4500K,mood=dramatic" \
    --depth "foreground=角色;midground=桌面;background=窗外" \
    --output /path/to/render.png \
    [--model jimeng-5.0] \
    [--ratio 9:16] \
    [--sample-strength 0.25]

环境变量:
  JIMENG_SESSION_ID: 即梦 session ID
  JIMENG_API_URL: API 地址 (默认 http://localhost:8000)
"""

import argparse, json, base64, urllib.request, os, sys, time

API_URL = os.environ.get("JIMENG_API_URL", "http://localhost:8000")
SESSION_ID = os.environ.get("JIMENG_SESSION_ID", "")


def img_to_base64(path):
    """图片文件转 base64 data URI"""
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    ext = os.path.splitext(path)[1].lstrip(".")
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext, "image/png")
    return f"data:{mime};base64,{b64}"


def parse_kv_string(s):
    """解析 key=value 格式的字符串为字典
    支持逗号分隔: "direction=upper-left,intensity=0.7"
    支持分号分隔: "foreground=角色;midground=桌面;background=窗外"
    """
    result = {}
    if not s:
        return result
    # 尝试逗号分隔，再尝试分号分隔
    for pair in s.replace(";", ",").split(","):
        pair = pair.strip()
        if "=" in pair:
            k, v = pair.split("=", 1)
            result[k.strip()] = v.strip()
    return result


def build_anchored_images(sketch_path, ref_paths, style_ref_path):
    """构建四维锚定的 images 列表

    标准顺序:
      [0] 线稿 - 结构锚定
      [1] 角色正面参考 - 身份锚定（权重最高）
      [2] 角色 3/4 视角参考 - 身份锚定补充
      [3] 风格/光影参考图 - 光影锚定

    空位自动跳过，不会留空占位。
    """
    images = []

    # Slot 0: 线稿（结构锚定）— 必须存在
    if sketch_path and os.path.exists(sketch_path):
        images.append(img_to_base64(sketch_path))
    else:
        raise RuntimeError(f"线稿文件不存在: {sketch_path}")

    # Slot 1 & 2: 角色参考（身份锚定）
    # ref_paths[0] → 正面参考 (Slot 1)
    # ref_paths[1] → 3/4 视角参考 (Slot 2)
    if ref_paths:
        for i, ref_path in enumerate(ref_paths[:2]):  # 最多取前两张
            if os.path.exists(ref_path):
                images.append(img_to_base64(ref_path))

    # Slot 3: 风格/光影参考图（光影锚定）
    if style_ref_path and os.path.exists(style_ref_path):
        images.append(img_to_base64(style_ref_path))

    return images


def inject_lighting_prompt(prompt, lighting_str):
    """将 lighting 参数注入到 prompt 中

    格式: 光照要求：方向={direction}，强度={intensity}，色温={color_temp}，氛围={mood}
    """
    if not lighting_str:
        return prompt

    kv = parse_kv_string(lighting_str)
    parts = []
    if "direction" in kv:
        parts.append(f"方向={kv['direction']}")
    if "intensity" in kv:
        parts.append(f"强度={kv['intensity']}")
    if "color_temp" in kv:
        parts.append(f"色温={kv['color_temp']}")
    if "mood" in kv:
        parts.append(f"氛围={kv['mood']}")

    if parts:
        lighting_line = "光照要求：" + "，".join(parts)
        return f"{prompt}\n{lighting_line}"
    return prompt


def inject_depth_prompt(prompt, depth_str):
    """将 depth 参数注入到 prompt 中

    格式: 空间层次：前景={foreground}，中景={midground}，远景={background}
    """
    if not depth_str:
        return prompt

    kv = parse_kv_string(depth_str)
    parts = []
    if "foreground" in kv:
        parts.append(f"前景={kv['foreground']}")
    if "midground" in kv:
        parts.append(f"中景={kv['midground']}")
    if "background" in kv:
        parts.append(f"远景={kv['background']}")

    if parts:
        depth_line = "空间层次：" + "，".join(parts)
        return f"{prompt}\n{depth_line}"
    return prompt


def render_from_sketch(sketch_path, prompt, ref_images, model, ratio,
                       sample_strength, style_prompt="",
                       lighting_str="", depth_str=""):
    """调用即梦 API 基于线稿渲染"""

    # 构建渲染 prompt：保留构图 + 添加风格 + 光照 + 空间层次
    render_prompt = prompt
    if style_prompt:
        render_prompt = f"{render_prompt}\n风格要求：{style_prompt}"

    # 注入光照参数
    render_prompt = inject_lighting_prompt(render_prompt, lighting_str)

    # 注入空间层次参数
    render_prompt = inject_depth_prompt(render_prompt, depth_str)

    negative = (
        "线稿, sketch, lineart, 草图, draft, 线条, 粗糙, rough, unfinished, 黑白, monochrome, wireframe, "
        "bad anatomy, deformed, distorted, disfigured, mutated hands, missing fingers, extra fingers, "
        "fused fingers, too many fingers, bad hands, extra limbs, missing limbs, bad proportions, "
        "distorted face, asymmetric face, long neck, malformed limbs, unnatural pose"
    )

    # images: 四维锚定顺序已在外部构建
    images = list(ref_images)  # 直接使用已排序的 images

    body = {
        "model": model,
        "prompt": render_prompt,
        "negative_prompt": negative,
        "ratio": ratio,
        "resolution": "2k",
        "sample_strength": sample_strength,
        "images": images,
    }

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


def main():
    parser = argparse.ArgumentParser(description="基于线稿的渲染器（四维锚定融合版）")
    parser.add_argument("--sketch", required=True, help="线稿图片路径")
    parser.add_argument("--prompt", required=True, help="场景描述 + 风格")
    parser.add_argument("--style", default="", help="额外风格描述（独立于prompt）")
    parser.add_argument("--ref", nargs="*", default=[],
                        help="角色参考图路径（最多2张：正面 + 3/4视角）")
    parser.add_argument("--style-ref", default=None,
                        help="风格/光影参考图路径")
    parser.add_argument("--lighting", default="",
                        help='光照参数，格式: "direction=upper-left,intensity=0.7,color_temp=4500K,mood=dramatic"')
    parser.add_argument("--depth", default="",
                        help='空间层次参数，格式: "foreground=角色;midground=桌面;background=窗外"')
    parser.add_argument("--output", required=True, help="输出渲染图路径")
    parser.add_argument("--model", default="jimeng-5.0", help="模型版本")
    parser.add_argument("--ratio", default="9:16", help="图片比例")
    parser.add_argument("--sample-strength", type=float, default=0.25,
                        help="线稿结构保留强度")
    parser.add_argument("--retry", type=int, default=1, help="失败重试次数")

    args = parser.parse_args()

    if not SESSION_ID:
        print("请设置 JIMENG_SESSION_ID 环境变量")
        sys.exit(1)

    if not os.path.exists(args.sketch):
        print(f"线稿不存在: {args.sketch}")
        sys.exit(1)

    # 构建四维锚定的 images 列表
    ref_paths = args.ref if args.ref else []
    try:
        images = build_anchored_images(args.sketch, ref_paths, args.style_ref)
    except RuntimeError as e:
        print(f"图片准备失败: {e}")
        sys.exit(1)

    # 打印锚定信息
    print(f"线稿 (结构锚定): {os.path.basename(args.sketch)}")
    if ref_paths:
        for i, p in enumerate(ref_paths[:2]):
            label = "正面参考 (身份锚定)" if i == 0 else "3/4视角 (身份锚定补充)"
            if os.path.exists(p):
                print(f"  [{i+1}] {label}: {os.path.basename(p)}")
    if args.style_ref and os.path.exists(args.style_ref):
        print(f"  [3] 风格参考 (光影锚定): {os.path.basename(args.style_ref)}")
    print(f"锚定图片总数: {len(images)} 张")

    if args.lighting:
        print(f"光照参数: {args.lighting}")
    if args.depth:
        print(f"空间层次: {args.depth}")

    for attempt in range(args.retry + 1):
        try:
            print(f"渲染中 (尝试 {attempt + 1}/{args.retry + 1})...", flush=True)
            url = render_from_sketch(
                args.sketch, args.prompt, images,
                args.model, args.ratio, args.sample_strength, args.style,
                lighting_str=args.lighting,
                depth_str=args.depth
            )

            os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
            urllib.request.urlretrieve(url, args.output)
            print(f"渲染完成: {args.output}")

            meta = {
                "output": args.output,
                "sketch": args.sketch,
                "url": url,
                "prompt": args.prompt,
                "style": args.style,
                "lighting": args.lighting or None,
                "depth": args.depth or None,
                "model": args.model,
                "sample_strength": args.sample_strength,
                "ref_count": len(ref_paths),
                "style_ref": args.style_ref,
                "total_images": len(images),
                "anchoring": {
                    "structure": args.sketch,
                    "identity_front": ref_paths[0] if len(ref_paths) > 0 else None,
                    "identity_34": ref_paths[1] if len(ref_paths) > 1 else None,
                    "lighting_style": args.style_ref,
                },
                "attempts": attempt + 1
            }
            meta_path = args.output + ".meta.json"
            with open(meta_path, "w") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)

            sys.exit(0)

        except Exception as e:
            print(f"渲染失败: {e}")
            if attempt < args.retry:
                time.sleep(3)
            else:
                sys.exit(1)


if __name__ == "__main__":
    main()
