#!/usr/bin/env python3
"""
scene-evaluator.py — AI 生成场景图逻辑一致性自动评价器

用法:
  # 默认模式（通用逻辑检查）
  python3 scene-evaluator.py <spec.json> <img_path_or_dir>

  # 线稿审核模式
  python3 scene-evaluator.py --mode sketch <spec.json> <img_path_or_dir>

  # 渲染审核模式
  python3 scene-evaluator.py --mode render <spec.json> <img_path_or_dir>

  spec.json 格式:
  {
    "shots": [
      {
        "id": "B01-foot-catch",
        "description": "场景描述",
        "constraints": ["约束1", "约束2", ...]
      }
    ]
  }

  也可以直接传目录，自动匹配 id.png

输出: 每张图 PASS/FAIL + 问题列表

评价模式:
  - default: 通用逻辑一致性检查（物品重复、道具缺失、物理合理性等）
  - sketch:  线稿专项检查（构图/空间/元素完整性/纯黑白/线条清晰）
  - render:  渲染专项检查（风格一致性/美感/无残留线稿/角色一致）
"""

import json, base64, urllib.request, os, sys, glob

API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
MODEL = "glm-4.6v"
MAX_IMG_SIZE = 4 * 1024 * 1024  # 4MB


def get_api_key():
    config_path = os.path.expanduser("~/.openclaw/openclaw.json")
    with open(config_path) as f:
        return json.load(f)["models"]["providers"]["zai"]["apiKey"]


def compress_if_needed(img_path, max_size=MAX_IMG_SIZE):
    """如果图片超过 max_size，压缩到 1080px 宽"""
    size = os.path.getsize(img_path)
    if size <= max_size:
        return img_path
    
    compressed = img_path + ".eval.tmp.png"
    try:
        import subprocess
        subprocess.run(["convert", img_path, "-resize", "1080x", "-quality", "85", compressed],
                      check=True, capture_output=True)
        return compressed
    except Exception:
        # 如果 imagemagick 不可用，尝试用 ffmpeg
        try:
            subprocess.run(["ffmpeg", "-y", "-i", img_path, "-vf", "scale=1080:-1", "-q:v", "5", compressed],
                          check=True, capture_output=True)
            return compressed
        except Exception:
            print(f"⚠️ 无法压缩 {img_path}，可能导致 API 错误")
            return img_path


# ── 模式专用 prompt 构建 ──

SKETCH_SYSTEM = (
    "你是线稿质量审核员，专门审核漫画风格黑白线稿。\n"
    "请从以下维度检查，每项标注✅或❌并简要说明："
)

SKETCH_CHECKS = """1. 纯黑白：画面必须完全是黑白线稿，不能有任何灰度、渐变或彩色
2. 线条清晰：轮廓线干净锐利，无模糊或断裂
3. 构图合理性：空间布局合理，无透视错误或比例失调
4. 空间关系：前景/中景/远景层次分明，物体间位置关系正确
5. 元素完整性：场景描述中的关键元素（角色、道具、环境）都已呈现
6. 角色姿态：角色姿态与描述一致，关节位置合理
7. 肢体完整性：手指数量正确（5根/手），无多余或缺失肢体，关节位置自然，身体比例合理"""

RENDER_SYSTEM = (
    "你是AI渲染图质量审核员，专门审核基于线稿渲染的最终场景图。\n"
    "请从以下维度检查，每项标注✅或❌并简要说明："
)

RENDER_CHECKS = """1. 无残留线稿：画面中不应有明显的黑色线稿痕迹或粗糙线条
2. 风格一致性：整体风格统一，色彩/光影/质感协调
3. 角色一致性：角色外观（脸型、发型、服装）与参考图一致
4. 构图保持：渲染后的构图与原线稿布局一致，没有显著偏移
5. 美感质量：画面美观，光影自然，无明显的AI生成瑕疵（如多余手指、扭曲）
6. 深度层次一致性：前景/中景/远景层次清晰，前景角色清晰可辨、中景道具可见、远景有纵深感
7. 解剖准确性：手指数量正确无融合，面部五官对称协调，肢体比例自然无变形，无多余或缺失肢体"""

# ── 深度层次检查专用 prompt ──

DEPTH_SYSTEM = (
    "你是AI渲染图深度层次审核员，专门检查画面的空间纵深感。\n"
    "请对画面进行深度层次评估，返回严格 JSON 格式。"
)

DEPTH_PROMPT_TEMPLATE = """请评估这张渲染图的深度层次表现。

场景描述：{description}

DEPTH 约束：
{depth_constraints}

请从以下维度评估并返回 JSON（不要输出其他内容）：
{{
  "score": <1-10 整数，10为最佳>,
  "foreground_clear": <true/false，前景角色是否清晰锐利>,
  "midground_visible": <true/false，中景道具是否可辨认>,
  "background_depth": <true/false，远景是否有纵深感/景深模糊>,
  "foreground_size_ok": <true/false，前景元素占比是否最大（近大远小原则）>,
  "background_blurred": <true/false，背景是否有适当模糊/简化>,
  "depth_elements_present": <true/false，DEPTH约束中描述的元素是否都存在>,
  "issues": ["<问题描述1>", "<问题描述2>"]
}}

评分标准：
- score 9-10: 三层层次完美，前景清晰锐利，远景自然虚化，近大远小比例正确
- score 7-8: 三层层次基本清晰，有轻微层次混淆
- score 5-6: 部分层次缺失，前景或远景不清晰
- score 3-4: 层次混乱，缺乏纵深感
- score 1-2: 平面感强，无深度层次

仅返回 JSON，不要额外解释。"""


def build_eval_prompt(mode, description, constraints):
    """根据模式构建评价 prompt"""
    checks_text = "\n".join(f"  {i+1}. {c}" for i, c in enumerate(constraints))
    
    if mode == "sketch":
        return (
            f"{SKETCH_SYSTEM}\n{SKETCH_CHECKS}\n\n"
            f"场景描述：{description}\n"
            f"自定义检查：\n{checks_text}\n\n"
            f"最后给出：PASS 或 FAIL\n如果 FAIL，列出所有问题。简洁回答。"
        )
    elif mode == "render":
        return (
            f"{RENDER_SYSTEM}\n{RENDER_CHECKS}\n\n"
            f"场景描述：{description}\n"
            f"自定义检查：\n{checks_text}\n\n"
            f"最后给出：PASS 或 FAIL\n如果 FAIL，列出所有问题。简洁回答。"
        )
    else:
        # default 模式
        return (
            f"你是AI生成图片的逻辑一致性审核员。\n"
            f"场景：{description}\n\n"
            f"检查每一项，标注✅或❌并简要说明：\n{checks_text}\n\n"
            f"最后给出：PASS 或 FAIL\n如果 FAIL，列出所有问题。简洁回答。"
        )


def has_depth_constraint(shot):
    """检查 shot 是否包含 DEPTH 约束"""
    # 检查 constraints 列表中的 DEPTH 约束
    for c in shot.get("constraints", []):
        if isinstance(c, str) and c.upper().startswith("DEPTH"):
            return True
        if isinstance(c, str) and "DEPTH" in c.upper():
            return True
    # 检查是否有独立的 depth 字段
    if "depth" in shot:
        return True
    return False


def extract_depth_constraints(shot):
    """提取 shot 中所有 DEPTH 相关约束"""
    depth_items = []
    for c in shot.get("constraints", []):
        if isinstance(c, str) and ("DEPTH" in c.upper() or c.upper().startswith("DEPTH")):
            depth_items.append(c)
    if "depth" in shot:
        d = shot["depth"]
        if isinstance(d, str):
            depth_items.append(d)
        elif isinstance(d, list):
            depth_items.extend(str(item) for item in d)
        elif isinstance(d, dict):
            for k, v in d.items():
                depth_items.append(f"{k}: {v}")
    return depth_items


def evaluate_depth(img_path, description, depth_constraints, api_key):
    """调用视觉模型进行深度层次专项评估，返回 depth_check 结构"""
    actual_path = compress_if_needed(img_path)

    with open(actual_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    depth_text = "\n".join(f"  - {c}" for c in depth_constraints)
    prompt = DEPTH_PROMPT_TEMPLATE.format(description=description, depth_constraints=depth_text)

    payload = {
        "model": MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                {"type": "text", "text": prompt}
            ]
        }]
    }

    data = json.dumps(payload).encode()
    req = urllib.request.Request(API_URL, data=data, headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    })

    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
        raw = d["choices"][0]["message"]["content"]

    # 清理临时文件
    if actual_path != img_path:
        try:
            os.unlink(actual_path)
        except:
            pass

    # 解析 JSON 响应（兼容 markdown 代码块包裹）
    return parse_depth_json(raw)


def parse_depth_json(raw_text):
    """从模型返回文本中解析 depth_check JSON"""
    # 尝试提取 JSON 块
    text = raw_text.strip()
    # 去掉 markdown 代码块包裹
    if text.startswith("```"):
        lines = text.split("\n")
        # 去掉首尾的 ``` 行
        json_lines = []
        inside = False
        for line in lines:
            if line.strip().startswith("```"):
                if inside:
                    break
                inside = True
                continue
            if inside:
                json_lines.append(line)
        text = "\n".join(json_lines)

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # 尝试找到第一个 { 和最后一个 }
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                parsed = json.loads(text[start:end])
            except json.JSONDecodeError:
                return {
                    "score": 0,
                    "foreground_clear": False,
                    "midground_visible": False,
                    "background_depth": False,
                    "foreground_size_ok": False,
                    "background_blurred": False,
                    "depth_elements_present": False,
                    "issues": [f"无法解析深度评估结果: {raw_text[:200]}"]
                }
        else:
            return {
                "score": 0,
                "foreground_clear": False,
                "midground_visible": False,
                "background_depth": False,
                "foreground_size_ok": False,
                "background_blurred": False,
                "depth_elements_present": False,
                "issues": [f"深度评估返回非JSON: {raw_text[:200]}"]
            }

    # 标准化输出结构
    return {
        "score": int(parsed.get("score", 0)),
        "foreground_clear": bool(parsed.get("foreground_clear", False)),
        "midground_visible": bool(parsed.get("midground_visible", False)),
        "background_depth": bool(parsed.get("background_depth", False)),
        "foreground_size_ok": bool(parsed.get("foreground_size_ok", False)),
        "background_blurred": bool(parsed.get("background_blurred", False)),
        "depth_elements_present": bool(parsed.get("depth_elements_present", False)),
        "issues": parsed.get("issues", [])
    }


def evaluate_single(img_path, description, constraints, api_key, mode="default"):
    """调用视觉模型评估单张图片"""
    actual_path = compress_if_needed(img_path)
    
    with open(actual_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    
    prompt = build_eval_prompt(mode, description, constraints)
    
    payload = {
        "model": MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                {"type": "text", "text": prompt}
            ]
        }]
    }
    
    data = json.dumps(payload).encode()
    req = urllib.request.Request(API_URL, data=data, headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    })
    
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
        return d["choices"][0]["message"]["content"]
    
    # 清理临时文件
    if actual_path != img_path:
        try:
            os.unlink(actual_path)
        except:
            pass


def parse_result(text):
    """从评价结果中提取 PASS/FAIL"""
    if "FAIL" in text.upper():
        return "FAIL", text
    return "PASS", text


def main():
    import argparse
    parser = argparse.ArgumentParser(description="场景图评价器")
    parser.add_argument("--mode", choices=["default", "sketch", "render"], default="default",
                       help="评价模式: sketch=线稿审核, render=渲染审核, default=通用逻辑检查")
    parser.add_argument("spec", help="spec.json 路径")
    parser.add_argument("target", help="图片路径或目录")
    args = parser.parse_args()
    
    mode = args.mode
    spec_path = args.spec
    target = args.target
    api_key = get_api_key()
    
    mode_label = {"sketch": "线稿审核", "render": "渲染审核", "default": "通用检查"}
    print(f"📋 评价模式: {mode_label[mode]}")
    
    with open(spec_path) as f:
        spec = json.load(f)
    
    shots = spec.get("shots", [])
    
    results = {"pass": [], "fail": [], "error": [], "depth_checks": {}}

    for shot in shots:
        shot_id = shot["id"]
        desc = shot["description"]
        constraints = shot.get("constraints", [])

        # 找到对应图片
        if os.path.isdir(target):
            # 在目录中找 id 开头的 png
            matches = glob.glob(os.path.join(target, f"{shot_id}*.png"))
            if not matches:
                matches = glob.glob(os.path.join(target, f"*{shot_id}*.png"))
            img_path = matches[0] if matches else None
        else:
            img_path = target

        if not img_path or not os.path.exists(img_path):
            print(f"❌ {shot_id}: 图片未找到")
            results["error"].append(shot_id)
            continue

        try:
            print(f"🔍 {shot_id}...", end=" ", flush=True)
            eval_text = evaluate_single(img_path, desc, constraints, api_key, mode=mode)
            status, detail = parse_result(eval_text)

            # ── render 模式下检查 DEPTH 约束 ──
            depth_check = None
            if mode == "render" and has_depth_constraint(shot):
                depth_constraints = extract_depth_constraints(shot)
                print(f"  📐 深度检查...", end=" ", flush=True)
                try:
                    depth_check = evaluate_depth(img_path, desc, depth_constraints, api_key)
                    results["depth_checks"][shot_id] = depth_check
                    depth_score = depth_check.get("score", 0)
                    print(f"得分={depth_score}", end=" ", flush=True)
                except Exception as de:
                    print(f"深度检查失败({de})", end=" ", flush=True)
                    results["depth_checks"][shot_id] = {
                        "score": 0,
                        "foreground_clear": False,
                        "midground_visible": False,
                        "background_depth": False,
                        "foreground_size_ok": False,
                        "background_blurred": False,
                        "depth_elements_present": False,
                        "issues": [f"深度评估API调用失败: {de}"]
                    }

            if status == "FAIL":
                print(f"❌ FAIL")
                result_item = {"id": shot_id, "detail": detail}
                if depth_check:
                    result_item["depth_check"] = depth_check
                results["fail"].append(result_item)
            else:
                print(f"✅ PASS")
                result_item = shot_id
                # PASS 且有深度问题时附加提示
                if depth_check and depth_check.get("score", 0) < 7:
                    print(f"    ⚠️ 深度得分偏低: {depth_check.get('score', 0)}/10")
                    for issue in depth_check.get("issues", [])[:3]:
                        print(f"      - {issue}")
                results["pass"].append(result_item)
        except Exception as e:
            print(f"⚠️ ERROR: {e}")
            results["error"].append(shot_id)
    
    # 汇总
    print(f"\n{'='*60}")
    print(f"📊 评价结果: {len(results['pass'])} PASS / {len(results['fail'])} FAIL / {len(results['error'])} ERROR")

    # 深度检查汇总
    if results["depth_checks"]:
        depth_scores = [dc["score"] for dc in results["depth_checks"].values()]
        avg_depth = sum(depth_scores) / len(depth_scores) if depth_scores else 0
        print(f"📐 深度检查: {len(results['depth_checks'])} 张已评估, 平均分 {avg_depth:.1f}/10")

    if results["fail"]:
        print(f"\n❌ 需要重跑:")
        for item in results["fail"]:
            print(f"  - {item['id']}")
            # 打印问题要点
            for line in item["detail"].split("\n"):
                if "❌" in line:
                    print(f"    {line.strip()}")
            # 打印深度问题
            if "depth_check" in item:
                dc = item["depth_check"]
                if dc.get("issues"):
                    print(f"    深度问题:")
                    for issue in dc["issues"][:3]:
                        print(f"      - {issue}")
    
    # 输出 JSON 结果供后续流程使用
    output_path = os.path.join(os.path.dirname(target) if os.path.isdir(target) else os.path.dirname(target), "eval-result.json")
    with open(output_path, "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=str)
    print(f"\n📄 详细结果: {output_path}")
    
    # 返回非零退出码如果有 FAIL
    sys.exit(1 if results["fail"] else 0)


if __name__ == "__main__":
    main()
