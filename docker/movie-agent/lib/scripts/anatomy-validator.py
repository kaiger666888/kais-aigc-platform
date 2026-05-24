#!/usr/bin/env python3
"""
anatomy-validator.py — AI 生成图片的解剖质量检测器

使用 GLM-4V-Flash 视觉模型检测图片中的肢体变形问题。

用法:
  python3 anatomy-validator.py <img_path> [--mode full|hands|face|body] [--threshold 0.6]

输出: JSON 格式的解剖报告
  {
    "pass": true/false,
    "score": 0.0-1.0,
    "issues": [...],
    "regions": {
      "hands": {"score": 0.8, "issues": []},
      "face": {"score": 0.9, "issues": []},
      "body": {"score": 0.7, "issues": ["左臂比例偏长"]}
    },
    "retry_hint": "...",   // 如果 fail，给出修复建议
    "negative_boost": "..." // 推荐追加的 negative_prompt
  }

环境变量:
  自动从 ~/.openclaw/openclaw.json 读取 zai API key
"""

import json, base64, urllib.request, os, sys, argparse

API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
MODEL = "glm-4.6v"
MAX_IMG_SIZE = 4 * 1024 * 1024


def get_api_key():
    config_path = os.path.expanduser("~/.openclaw/openclaw.json")
    with open(config_path) as f:
        return json.load(f)["models"]["providers"]["zai"]["apiKey"]


def compress_if_needed(img_path, max_size=MAX_IMG_SIZE):
    size = os.path.getsize(img_path)
    if size <= max_size:
        return img_path

    compressed = img_path + ".anatomy.tmp.png"
    try:
        import subprocess
        subprocess.run(
            ["convert", img_path, "-resize", "1080x", "-quality", "85", compressed],
            check=True, capture_output=True
        )
        return compressed
    except Exception:
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", img_path, "-vf", "scale=1080:-1", "-q:v", "5", compressed],
                check=True, capture_output=True
            )
            return compressed
        except Exception:
            return img_path


ANATOMY_SYSTEM = (
    "你是人体解剖质量检测员，专门检查 AI 生成图片中的肢体变形问题。\n"
    "请从以下维度检查，每项给出 0-1 的评分和问题描述：\n"
)

ANATOMY_CHECKS_FULL = """1. 手部检查：
   - 每只手是否有 5 根手指（如果可见）
   - 手指是否有融合/多余/缺失
   - 手指关节是否自然
   - 手掌比例是否正常

2. 面部检查：
   - 眼睛大小是否对称
   - 鼻梁位置是否居中
   - 嘴唇形状是否自然
   - 耳朵位置是否正确
   - 五官整体是否协调

3. 肢体检查：
   - 手臂长度比例是否正确（上臂:前臂 ≈ 1:1）
   - 腿部长度比例是否正确（大腿:小腿 ≈ 1:1）
   - 关节位置是否自然
   - 是否有多余或缺失的肢体
   - 肩宽和髋宽比例是否合理

4. 整体比例：
   - 头身比是否合理（成人约 6-8 头身）
   - 手的大小是否合理（约等于面部大小）
   - 脚的大小是否合理"""

ANATOMY_CHECKS_HANDS = """仅检查手部：
- 每只可见的手是否有 5 根手指
- 手指是否有融合/多余/缺失/变形
- 手指关节是否自然
- 手掌比例是否正常
- 指甲是否正常"""

ANATOMY_CHECKS_FACE = """仅检查面部：
- 眼睛大小和位置是否对称
- 瞳孔方向是否一致
- 鼻梁位置是否居中
- 嘴唇形状是否自然
- 耳朵位置是否正确
- 五官整体是否协调"""

ANATOMY_CHECKS_BODY = """仅检查肢体和身体比例：
- 手臂长度比例
- 腿部长度比例
- 关节位置是否自然
- 是否有多余或缺失的肢体
- 肩宽和髋宽比例
- 头身比
- 手脚大小比例"""

NEGATIVE_BOOST_MAP = {
    "hands": "bad hands, deformed hands, missing fingers, extra fingers, fused fingers, mutated fingers, too many fingers, fewer fingers, distorted fingers, unnatural hand pose",
    "face": "deformed face, asymmetric face, distorted eyes, crossed eyes, mismatched eyes, unnatural facial features, disfigured, bad face",
    "body": "bad anatomy, extra limbs, missing limbs, mutated body, malformed limbs, bad proportions, distorted body, unnatural pose, long neck, extra arms, missing arms",
}


def get_checks(mode):
    if mode == "hands":
        return ANATOMY_CHECKS_HANDS
    elif mode == "face":
        return ANATOMY_CHECKS_FACE
    elif mode == "body":
        return ANATOMY_CHECKS_BODY
    else:
        return ANATOMY_CHECKS_FULL


def validate_anatomy(img_path, api_key, mode="full"):
    actual_path = compress_if_needed(img_path)

    with open(actual_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    checks = get_checks(mode)
    prompt = (
        f"{ANATOMY_SYSTEM}\n{checks}\n\n"
        f"请对这张图片进行解剖质量检测，返回严格 JSON 格式：\n"
        f"{{\n"
        f'  "pass": <true/false，所有区域评分 >= threshold 则 pass>,\n'
        f'  "score": <0.0-1.0 整体评分>,\n'
        f'  "issues": ["<问题描述1>", "<问题描述2>"],\n'
        f'  "regions": {{\n'
        f'    "hands": {{"score": <0.0-1.0>, "issues": ["..."]}},\n'
        f'    "face": {{"score": <0.0-1.0>, "issues": ["..."]}},\n'
        f'    "body": {{"score": <0.0-1.0>, "issues": ["..."]}}\n'
        f'  }},\n'
        f'  "retry_hint": "<如果 fail，给出一句中文修复建议>",\n'
        f'  "negative_boost": "<推荐追加的英文 negative_prompt 关键词>"\n'
        f"}}\n\n"
        f"仅返回 JSON，不要额外解释。如果某个区域不可见（如手被遮挡），该区域评分设为 1.0 并 issues 为空。"
    )

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

    return parse_anatomy_json(raw)


def parse_anatomy_json(raw_text):
    text = raw_text.strip()
    # 去掉 markdown 代码块
    if text.startswith("```"):
        lines = text.split("\n")
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
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                parsed = json.loads(text[start:end])
            except json.JSONDecodeError:
                return {
                    "pass": False,
                    "score": 0,
                    "issues": [f"无法解析检测结果: {raw_text[:200]}"],
                    "regions": {},
                    "retry_hint": "重新生成",
                    "negative_boost": "bad anatomy, deformed"
                }
        else:
            return {
                "pass": False,
                "score": 0,
                "issues": [f"检测返回非JSON: {raw_text[:200]}"],
                "regions": {},
                "retry_hint": "重新生成",
                "negative_boost": "bad anatomy, deformed"
            }

    # 标准化输出
    return {
        "pass": bool(parsed.get("pass", False)),
        "score": float(parsed.get("score", 0)),
        "issues": parsed.get("issues", []),
        "regions": parsed.get("regions", {}),
        "retry_hint": parsed.get("retry_hint", ""),
        "negative_boost": parsed.get("negative_boost", ""),
    }


def main():
    parser = argparse.ArgumentParser(description="解剖质量检测器")
    parser.add_argument("image", help="图片路径")
    parser.add_argument("--mode", choices=["full", "hands", "face", "body"],
                        default="full", help="检测模式")
    parser.add_argument("--threshold", type=float, default=0.6,
                        help="通过阈值 (0.0-1.0)")
    args = parser.parse_args()

    if not os.path.exists(args.image):
        print(f"图片不存在: {args.image}")
        sys.exit(1)

    api_key = get_api_key()
    print(f"🔍 解剖检测 [{args.mode}] {os.path.basename(args.image)}...", flush=True)

    result = validate_anatomy(args.image, api_key, mode=args.mode)

    # 应用阈值
    if result["score"] < args.threshold:
        result["pass"] = False

    status = "✅ PASS" if result["pass"] else "❌ FAIL"
    print(f"{status} score={result['score']:.2f}")

    if result["issues"]:
        for issue in result["issues"][:5]:
            print(f"  - {issue}")

    if not result["pass"]:
        print(f"\n💡 修复建议: {result.get('retry_hint', '无')}")
        boost = result.get("negative_boost", "")
        if boost:
            print(f"🚫 追加 negative: {boost}")

    # 输出 JSON
    output_path = args.image + ".anatomy.json"
    with open(output_path, "w") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n📄 报告: {output_path}")

    sys.exit(0 if result["pass"] else 1)


if __name__ == "__main__":
    main()
