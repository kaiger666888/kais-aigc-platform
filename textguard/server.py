#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Text-Guard M1 — 生成图中文错字修复守卫 sidecar (:5120)

配方真源: /data/workspace/blind3_arm_0906/ksfix_v3_banner.py (0906-0907 Ks 修字战役
实证修通, Kai 终审 pass)。本服务把该配方装成常驻 sidecar:
  RapidOCR 全图检测 → 单目标 crop-zoom → qwen-edit(ComfyUI 直连 :8188) 修字
  → 期望串 OCR 复验 → seed 彩票首中即停 → 羽化贴回。

纪律与边界 (kais-image-edit-ops SKILL.md「文字修复 v3」):
  - 单载体单目标: 一次 /fix 只修一个 box, 多招牌逐区各跑各的 (v2 整图双目标
    carrier 混淆实锤败绩, 勿回退)。
  - 期望串判据必须含残差字, 宽子串键会把错字误判 hit 提前终止彩票 —— 本服务
    命中判据 = expect_text/variants 整串归一化包含, 不做宽子串。
  - OCR 对书法/艺术字有假阴性 (竖排首字易漏检): 比对不中/suspect 是"待复核"
    信号, 终裁归 vision 结构级复核 (人工或上游)。
  - 修不动 (复杂繁体) = 引擎边界, 走上游 Z-Image 重生成, 本服务如实报 hit:false。

运行边界: Python 标准库 + rapidocr_onnxruntime + PIL, 不引 node/express;
单进程内全局锁串行处理 /check 与 /fix (禁并发进 ComfyUI), /health 无锁可探。

环境变量 (均有默认, systemd unit 可覆盖):
  TEXTGUARD_PORT=5120                    监听端口
  TEXTGUARD_COMFY_URL=http://127.0.0.1:8188
  TEXTGUARD_CONTAINER=comfyui-primary    crop 上传目标容器 (docker cp 主路)
  TEXTGUARD_OUTPUT_ROOT=/mnt/agents/output/gpu1   ComfyUI 产物宿主挂载根
  TEXTGUARD_SETTLE_S=45                  提交前探活稳定窗 (0 关闭, 见 probe)
  TEXTGUARD_ROUND_TIMEOUT_S=1800         单轮彩票 poll 预算 (磁盘级)
  TEXTGUARD_ALLOWED_ROOTS=               逗号分隔的本机路径白名单, 空=不限制
                                         (只防远端 URL, 白名单收紧归 operator)

用法:
  python3 server.py              # 常驻服务
  python3 server.py --selftest   # mock 引擎自测 (不碰 GPU/ComfyUI/网络)
"""

import difflib
import json
import logging
import os
import random
import re
import subprocess
import threading
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw, ImageFilter

# ─── 配置 ────────────────────────────────────────────────────────────────

PORT = int(os.environ.get("TEXTGUARD_PORT", "5120"))
COMFY_URL = os.environ.get("TEXTGUARD_COMFY_URL", "http://127.0.0.1:8188")
CONTAINER = os.environ.get("TEXTGUARD_CONTAINER", "comfyui-primary")
OUTPUT_ROOT = os.environ.get("TEXTGUARD_OUTPUT_ROOT", "/mnt/agents/output/gpu1")
SETTLE_S = float(os.environ.get("TEXTGUARD_SETTLE_S", "45"))
ROUND_TIMEOUT_S = float(os.environ.get("TEXTGUARD_ROUND_TIMEOUT_S", "1800"))
ALLOWED_ROOTS = [p.strip() for p in os.environ.get("TEXTGUARD_ALLOWED_ROOTS", "").split(",") if p.strip()]

_HERE = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(_HERE, "server.log")
BODY_LIMIT = 1 << 20  # 请求体上限 1MB (只收路径与参数, 不收图)

SUSPECT_CONF = 0.85        # conf 低于此值 = suspect (0906 实测: 正字 0.92-0.99 / 错字 0.52-0.84)
PARTIAL_OVERLAP = 0.5      # 期望串字符覆盖率 ≥ 此值算 partial 命中 (不升级为 ok, 只免 missing)
PARTIAL_RATIO = 0.6        # difflib 相似度备选阈值
MAX_LOTTERY_DEFAULT = 4    # 默认彩票轮数上限
MAX_LOTTERY_CAP = 8        # 单次 /fix 轮数硬顶 (防失控烧卡)
BASE_SEEDS = (42, 43, 44, 45)  # 战役实证首发种子 (s43/44/45 三中)

# qwen-edit-2511 工作流模型 (与 KAP qwen-edit/config.ts 现役一致, 勿改)
MODELS = dict(
    unet="qwen_image_edit_2511_Q4_KM.gguf",
    clip="qwen_2.5_vl_7b_fp8_scaled.safetensors",
    vae="qwen_image_vae.safetensors",
    lora="qwen_image_edit_2511_lightning_4steps_bf16.safetensors",
)

# ─── 日志 ────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(LOG_PATH, encoding="utf-8"), logging.StreamHandler()],
)
log = logging.getLogger("textguard")

# 全局串行锁: /check 与 /fix 全程持锁 (单进程串行, 禁并发进 ComfyUI); /health 免锁
QUEUE_LOCK = threading.Lock()

# ─── OCR 引擎 (延迟初始化; selftest 环境 rapidocr 可能缺席, 故不顶层 import) ──

_OCR_INSTANCE = None
_OCR_INIT_LOCK = threading.Lock()


def get_ocr():
    """单例 RapidOCR (CPU ~1.5s/图)。导入放函数内: --selftest 在无 rapidocr 的
    python 下也要能跑 (selftest 全程 stub ocr_image, 不触达这里)。"""
    global _OCR_INSTANCE
    if _OCR_INSTANCE is None:
        with _OCR_INIT_LOCK:
            if _OCR_INSTANCE is None:
                from rapidocr_onnxruntime import RapidOCR  # 延迟导入

                _OCR_INSTANCE = RapidOCR()
                log.info("[ocr] RapidOCR 就绪")
    return _OCR_INSTANCE


def ocr_ready() -> bool:
    return _OCR_INSTANCE is not None


def _ocr_image_impl(png_path):
    """全图 OCR → [{text, conf, box:[x0,y0,x1,y1]}] (box 由 4 点取包络)。
    rapidocr 返回 (result, elapsed), result 每项 = [box4点, text, conf]。"""
    try:
        result, _elapsed = get_ocr()(png_path)
    except Exception as exc:  # 单图失败不炸服务
        log.warning("[ocr] %s 失败: %s", png_path, exc)
        return []
    findings = []
    for item in result or []:
        box4, text, conf = item[0], item[1], item[2]
        xs = [p[0] for p in box4]
        ys = [p[1] for p in box4]
        findings.append({
            "text": str(text),
            "conf": round(float(conf), 3),
            "box": [float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))],
        })
    return findings


# 引擎挂钩 (selftest 通过改写模块级名字注入 mock, fix_core 运行期查名)
ocr_image = _ocr_image_impl

# ─── 纯逻辑: 归一化 / 期望串判定 (selftest 靶点) ─────────────────────────


def normalize_text(s):
    r"""OCR/期望串归一化: 只留 \w (CJK+字母数字), 去空格与标点。"""
    return "".join(re.findall(r"\w", str(s or ""), re.UNICODE))


def _char_overlap(finding_norm, expect_norm):
    """期望串字符覆盖率: | finding ∩ expect | / | expect | (set 口径)。"""
    if not expect_norm:
        return 0.0
    return len(set(expect_norm) & set(finding_norm)) / len(set(expect_norm))


def match_level(finding_text, expect_text):
    """期望串比对: full = 归一化整串包含 (唯一可判 hit 的档位);
    partial = 过半字符被读到 (免 missing, 供"OCR 假阴性待复核"档);
    none = 零命中素材。宽子串不判 hit —— v3 纪律: 宽键会把許彈夜話误判修通。"""
    a, b = normalize_text(finding_text), normalize_text(expect_text)
    if not a or not b:
        return "none"
    if b in a:
        return "full"
    if _char_overlap(a, b) >= PARTIAL_OVERLAP or difflib.SequenceMatcher(None, a, b).ratio() >= PARTIAL_RATIO:
        return "partial"
    return "none"


def region_findings(findings, cbox, slack=10):
    """取落在 crop 区 (含 slack 容差) 内的 OCR 结果 — 复验只看手术区。"""
    x0, y0, x1, y1 = cbox
    out = []
    for f in findings:
        bx0, by0, bx1, by1 = f["box"]
        if bx0 >= x0 - slack and bx1 <= x1 + slack and by0 >= y0 - slack and by1 <= y1 + slack:
            out.append(f)
    return out


def joined_text(findings):
    return "".join(f["text"] for f in findings)


def accept_hit(joined, expect_text, variants):
    """彩票命中判据: expect_text 或任一 variant 归一化整串包含。"""
    keys = [normalize_text(expect_text)] + [normalize_text(v) for v in (variants or [])]
    j = normalize_text(joined)
    return any(k and k in j for k in keys)


# ─── 纯逻辑: crop 边距计算 (selftest 靶点, 抄参考实现公式) ───────────────


def compute_crop_box(box, width, height):
    """crop 边距: 横向 0.5x 宽 / 纵向 0.7x 高, 地板 40px, 再钳回图内。
    (竖排载体字高方向上下文重, 纵向边距更大 — v3 实证配方)"""
    x0, y0, x1, y1 = box
    mx = max(40, int((x1 - x0) * 0.5))
    my = max(40, int((y1 - y0) * 0.7))
    return (max(0, x0 - mx), max(0, y0 - my), min(width, x1 + mx), min(height, y1 + my))


# ─── 纯逻辑: 修字 prompt 模板 (抄参考实现句式) ───────────────────────────

_NUM_WORD = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
             7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve"}


def build_prompt(carrier_desc, expect_text, vertical):
    """点名载体 + must read exactly + 排排方向 + Do NOT change others + keep same。
    carrier_desc 缺省回退 "sign"; 方向按 box 纵横比推断 (高>宽 = 竖排)。"""
    carrier = (carrier_desc or "sign").strip()
    n = len(normalize_text(expect_text)) or len(expect_text)
    n_word = _NUM_WORD.get(n, str(n))
    if vertical:
        dir_phrase, arrange = "from top to bottom", "vertically arranged"
    else:
        dir_phrase, arrange = "from left to right", "horizontally arranged"
    return (
        f'Repaint ONLY the characters on the {carrier}. The characters must read '
        f'exactly "{expect_text}" {dir_phrase}, {n_word} Chinese characters in black ink '
        f'calligraphy, {arrange}. Do NOT change any other sign, plaque, or banner. '
        f'Keep the {carrier} shape, background, surrounding scene, lighting and style '
        f'exactly the same.'
    )


# ─── ComfyUI 接线 (直连 :8188, 抄参考实现; selftest 可整体 stub) ─────────


def build_workflow(crop_name, seed, prompt):
    """qwen-edit-2511 直连工作流 — 节点接线与 0904/0907 实测版逐节点一致, 勿改。"""
    return {
        "10": {"class_type": "LoadImage", "inputs": {"image": crop_name}},
        "15": {"class_type": "CLIPLoader", "inputs": {"clip_name": MODELS["clip"], "type": "qwen_image"}},
        "12": {"class_type": "VAELoader", "inputs": {"vae_name": MODELS["vae"]}},
        "14": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": MODELS["unet"]}},
        "16": {"class_type": "LoraLoaderModelOnly",
               "inputs": {"model": ["14", 0], "lora_name": MODELS["lora"], "strength_model": 1.0}},
        "22": {"class_type": "ImageScaleToTotalPixels",
               "inputs": {"image": ["10", 0], "upscale_method": "lanczos", "megapixels": 1.0, "resolution_steps": 1}},
        "23": {"class_type": "VAEEncode", "inputs": {"pixels": ["22", 0], "vae": ["12", 0]}},
        "20": {"class_type": "TextEncodeQwenImageEditPlus",
               "inputs": {"prompt": prompt, "clip": ["15", 0], "vae": ["12", 0], "image1": ["10", 0]}},
        "21": {"class_type": "TextEncodeQwenImageEditPlus",
               "inputs": {"prompt": " ", "clip": ["15", 0], "vae": ["12", 0], "image1": ["10", 0]}},
        "40": {"class_type": "KSampler",
               "inputs": {"seed": seed, "steps": 4, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple",
                          "denoise": 1.0, "model": ["16", 0], "positive": ["20", 0], "negative": ["21", 0],
                          "latent_image": ["23", 0]}},
        "50": {"class_type": "VAEDecode", "inputs": {"samples": ["40", 0], "vae": ["12", 0]}},
        "60": {"class_type": "SaveImage", "inputs": {"filename_prefix": "tgfix", "images": ["50", 0]}},
    }


def _engine_probe_impl():
    """提交前探活 + 稳定窗 (tr_v13b_heal 配方): /system_stats 通 → 等 SETTLE_S →
    再通才算稳。防止把任务提交进刚重启/自愈中的 ComfyUI。重试 6 次 × 60s。"""
    for i in range(6):
        try:
            urllib.request.urlopen(COMFY_URL + "/system_stats", timeout=20).read()
            if SETTLE_S > 0:
                time.sleep(SETTLE_S)
            urllib.request.urlopen(COMFY_URL + "/system_stats", timeout=20).read()
            return
        except Exception as exc:
            log.warning("[probe] :8188 不可达 (%s), 60s 后重试 %d/6", exc, i + 1)
            time.sleep(60)
    raise RuntimeError("ComfyUI 探活失败 (重试耗尽)")


def _engine_upload_impl(local_path, container_name):
    """crop 进 ComfyUI input: docker cp 主路 (参考实现实证) + ComfyUI /upload/image
    备路 (无 docker 权限时兜底)。返回容器内文件名。"""
    name = os.path.basename(local_path)
    r = subprocess.run(["docker", "cp", local_path, f"{container_name}:/root/ComfyUI/input/{name}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode == 0:
        return name
    log.warning("[upload] docker cp 失败 (%s), 改走 /upload/image", r.stderr.strip()[:200])
    boundary = "----tg" + uuid.uuid4().hex
    with open(local_path, "rb") as fh:
        payload = fh.read()
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
            f"Content-Type: image/png\r\n\r\n").encode() + payload + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(COMFY_URL + "/upload/image", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    resp = json.loads(urllib.request.urlopen(req, timeout=60).read())
    uploaded = resp.get("name", name)
    log.info("[upload] /upload/image 返回名: %s", uploaded)
    return uploaded


def _engine_submit_impl(api):
    """POST /prompt 直连提交 (与 KAP qwen-edit 路由同一 ComfyUI, 但本 sidecar 是
    独立进程直连 —— 同进程 HTTP 自调用禁令不适用)。"""
    req = urllib.request.Request(
        COMFY_URL + "/prompt",
        json.dumps({"prompt": api, "client_id": "textguard-m1"}).encode(),
        {"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=90).read())["prompt_id"]


def _engine_wait_impl(prompt_id, timeout_s):
    """轮询 /history 至出图, 返回 (filename, subfolder, elapsed_s)。产物从宿主
    挂载直读 (docker cp 取不到, 0907 实证)。"""
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(5)
        try:
            hist = json.loads(urllib.request.urlopen(f"{COMFY_URL}/history/{prompt_id}", timeout=60).read())
        except Exception as exc:
            log.warning("[wait] poll err %s", exc)
            continue
        if prompt_id in hist:
            status = hist[prompt_id].get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(json.dumps(status.get("messages", []))[:400])
            images = hist[prompt_id].get("outputs", {}).get("60", {}).get("images", [])
            if images:
                return images[0]["filename"], images[0].get("subfolder", ""), time.time() - t0
    raise TimeoutError(f"ComfyUI poll 超时 ({timeout_s:.0f}s)")


# 引擎挂钩 (selftest 靶点)
engine_probe = _engine_probe_impl
engine_upload = _engine_upload_impl
engine_submit = _engine_submit_impl
engine_wait = _engine_wait_impl


# ─── 纯逻辑: 羽化贴回 (抄参考实现) ──────────────────────────────────────


def compose_paste(base_img, fixed_img, cbox):
    """修后 crop 缩放回原尺寸 → inset 24px 白矩形蒙版 → GaussianBlur(14) 羽化 →
    贴回原位。返回新图 (不改入参)。crop 小于 48px 时收缩 inset 防蒙版倒挂。"""
    crop_w, crop_h = cbox[2] - cbox[0], cbox[3] - cbox[1]
    out = fixed_img.convert("RGB").resize((crop_w, crop_h), Image.LANCZOS)
    inset = 24
    if crop_w - 2 * inset <= 0 or crop_h - 2 * inset <= 0:
        inset = max(1, min(24, (crop_w - 2) // 2, (crop_h - 2) // 2))
    mask = Image.new("L", (crop_w, crop_h), 0)
    ImageDraw.Draw(mask).rectangle([inset, inset, crop_w - inset, crop_h - inset], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(14))
    composed = base_img.copy()
    composed.paste(out, (cbox[0], cbox[1]), mask)
    return composed


# ─── 核心流程 ────────────────────────────────────────────────────────────


def validate_local_path(image_path):
    """只认本机现存文件 (防 SSRF: 拒 URL scheme; 白名单可再收紧到根目录)。"""
    if not isinstance(image_path, str) or not image_path.strip():
        raise ValueError("image_path 必填")
    if re.match(r"^\s*[a-zA-Z][a-zA-Z0-9+.-]*://", image_path):
        raise ValueError("image_path 只认本机路径, 拒绝 URL")
    real = os.path.realpath(image_path)
    if not os.path.isfile(real):
        raise ValueError(f"图片不存在: {image_path}")
    if ALLOWED_ROOTS and not any(real.startswith(root) for root in ALLOWED_ROOTS):
        raise ValueError(f"路径不在白名单内: {real}")
    return real


def parse_box(box, width=None, height=None):
    """校验 [x0,y0,x1,y1]; width/height 给出时钳回图内。"""
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        raise ValueError("box 须为 [x0,y0,x1,y1] 四元数组")
    try:
        x0, y0, x1, y1 = (int(round(float(v))) for v in box)
    except (TypeError, ValueError):
        raise ValueError("box 须为四个数值")
    if width is not None:
        x0, x1 = max(0, min(x0, width)), max(0, min(x1, width))
    if height is not None:
        y0, y1 = max(0, min(y0, height)), max(0, min(y1, height))
    if x1 - x0 < 2 or y1 - y0 < 2:
        raise ValueError(f"box 退化 (裁剪后 {x1 - x0}x{y1 - y0}px)")
    return [x0, y0, x1, y1]


def check_core(image_path, expect=None, regions=None):
    """/check 核心: 全图 OCR → 逐条判 verdict → expect 零命中补 missing。
    返回 data (不包 envelope)。"""
    findings = ocr_image(image_path)
    if regions:
        keep = []
        for f in findings:
            fb = f["box"]
            if any(not (fb[2] < r[0] or fb[0] > r[2] or fb[3] < r[1] or fb[1] > r[3]) for r in regions):
                keep.append(f)
        findings = keep

    expect = expect or []
    out = []
    for f in findings:
        verdict = "ok" if f["conf"] >= SUSPECT_CONF else "suspect"
        if expect:
            matched = next((e.get("carrier") for e in expect
                            if match_level(f["text"], e.get("text", "")) == "full"), None)
            if matched is None:
                verdict = "suspect"  # expect 表在但比对不中
            elif matched:
                f = dict(f, carrier=matched)
        out.append({**f, "verdict": verdict})
    for e in expect:
        e_text = e.get("text", "")
        if e_text and not any(match_level(f["text"], e_text) != "none" for f in findings):
            out.append({"text": e_text, "conf": 0.0, "box": None,
                        "verdict": "missing", "carrier": e.get("carrier")})
    return {"findings": out, "image_path": image_path}


def lottery_seeds(max_lottery):
    """首发用战役实证种子 42-45, 超出部分随机补 (防重跑撞已烧过的种子)。"""
    seeds = list(BASE_SEEDS[:max_lottery])
    while len(seeds) < max_lottery:
        seeds.append(random.randrange(1, 2 ** 31 - 1))
    return seeds


def fix_core(image_path, box, expect_text, variants=None, carrier_desc=None, max_lottery=None):
    """/fix 核心: 单目标 crop-zoom 修字 + seed 彩票 + 期望串复验 + 羽化贴回。
    未中 = 正常返回 hit:false + 最优残差 (引擎边界, 不是错误)。"""
    max_lottery = max(1, min(int(max_lottery or MAX_LOTTERY_DEFAULT), MAX_LOTTERY_CAP))
    variants = [v for v in (variants or []) if isinstance(v, str) and v.strip()]

    engine_probe()
    im = Image.open(image_path).convert("RGB")
    width, height = im.size
    x0, y0, x1, y1 = parse_box(box, width, height)
    cbox = compute_crop_box([x0, y0, x1, y1], width, height)
    vertical = (y1 - y0) > (x1 - x0)
    prompt = build_prompt(carrier_desc, expect_text, vertical)
    log.info("[fix] %s box=%s cbox=%s 竖排=%s expect=%r variants=%r 彩票=%d轮",
             image_path, box, cbox, vertical, expect_text, variants, max_lottery)

    uid = uuid.uuid4().hex[:8]
    best = None   # (score, composed, seed, inreg) — 未中时返回最高分残差
    hit = False   # 首中即停; 全程未中 = 引擎边界, 如实报 hit:false
    ocr_blind = False  # OCR 首字符漏检指纹 (任一轮出现即置位)
    rounds = 0
    for seed in lottery_seeds(max_lottery):
        rounds += 1
        crop_name_local = f"/tmp/tgfix_s{seed}_{uid}.png"
        im.crop(cbox).save(crop_name_local)
        container_name = engine_upload(crop_name_local, CONTAINER)
        pid = engine_submit(build_workflow(container_name, seed, prompt))
        log.info("[fix] seed=%s 已提交 %s", seed, pid)
        fn, sub, elapsed = engine_wait(pid, ROUND_TIMEOUT_S)
        host_path = os.path.join(OUTPUT_ROOT, sub, fn) if sub else os.path.join(OUTPUT_ROOT, fn)
        fixed = Image.open(host_path).convert("RGB")
        composed = compose_paste(im, fixed, cbox)
        full_tmp = f"/tmp/tgfix_full_s{seed}_{uid}.png"
        composed.save(full_tmp)
        inreg = region_findings(ocr_image(full_tmp), cbox, slack=10)
        joined = joined_text(inreg)
        hit = accept_hit(joined, expect_text, variants)
        score = 1.0 if hit else _char_overlap(normalize_text(joined), normalize_text(expect_text))
        # OCR 盲区旗标 (0907 割接实测): 竖排书法首字符漏检会让真命中被判 false。
        # 特征 = 长度差恰为 1 且缺的正是首字符 → 产物标 ocr_blind, 提示调用方 vision 复核。
        # 注意: 不改判 hit (纪律=OCR 整串命中才收彩), 只是诚实上报盲区。
        joined_norm = normalize_text(joined)
        expect_norm = normalize_text(expect_text)
        ocr_blind = (
            not hit
            and len(expect_norm) - len(joined_norm) == 1
            and joined_norm == expect_norm[1:]
        )
        if ocr_blind:
            score = max(score, 0.99)  # 盲区残差视作近满覆盖, 参与最优轮比较
            log.info("[fix] seed=%s ocr_blind=True (首字符漏检指纹, 待 vision 复核)", seed)
        log.info("[fix] seed=%s %.0fs hit=%s ocr=%r", seed, elapsed, hit, joined)
        if best is None or score > best[0]:
            best = (score, composed, seed, inreg)
        try:
            os.unlink(crop_name_local)
            os.unlink(full_tmp)
        except OSError:
            pass
        if hit:
            break

    _score, composed, seed, inreg = best
    stem, _ext = os.path.splitext(image_path)
    output_path = f"{stem}_tgfix.png"
    try:
        composed.save(output_path)
    except OSError:
        output_path = f"/tmp/{os.path.basename(stem)}_tgfix_{uid}.png"
        composed.save(output_path)
        log.warning("[fix] 源目录不可写, 产物落 %s", output_path)
    log.info("[fix] 完成 hit=%s seed=%s rounds=%d -> %s", hit, seed, rounds, output_path)
    return {
        "hit": hit,
        "ocr_blind": ocr_blind,
        "seed": seed,
        "rounds": rounds,
        "ocr_final": [{"text": f["text"], "conf": f["conf"], "box": f["box"]} for f in inreg],
        "output_path": os.path.abspath(output_path),
    }


# ─── HTTP 层 (http.server, 单进程; check/fix 持全局锁串行) ───────────────


def comfyui_reachable():
    """健康探针用: /system_stats 2s 快探 (只读统计, 不属渲染提交)。"""
    try:
        urllib.request.urlopen(COMFY_URL + "/system_stats", timeout=2).read()
        return True
    except Exception:
        return False


class TextGuardHandler(BaseHTTPRequestHandler):
    server_version = "TextGuard/1.0"
    protocol_version = "HTTP/1.1"  # keep-alive + 显式 Content-Length

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)

    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _ok(self, data, message="ok"):
        self._send(200, {"code": 200, "data": data, "message": message})

    def _fail(self, status, message):
        self._send(status, {"code": status, "data": None, "message": message})

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            raise ValueError("缺少请求体")
        if length > BODY_LIMIT:
            raise ValueError("请求体超限")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        if self.path.split("?")[0] != "/health":
            return self._fail(404, f"未知路径 {self.path}")
        self._ok({"ocr": ocr_ready(), "comfyui": comfyui_reachable(), "port": PORT})

    def do_POST(self):
        route = self.path.split("?")[0]
        handler = {"/check": self._handle_check, "/fix": self._handle_fix}.get(route)
        if handler is None:
            return self._fail(404, f"未知路径 {self.path}")
        try:
            body = self._read_json()
        except (ValueError, json.JSONDecodeError) as exc:
            return self._fail(400, f"请求体不合法: {exc}")
        try:
            # 串行队列: /check 与 /fix 全程持锁 (禁并发进 ComfyUI / OCR)
            with QUEUE_LOCK:
                return handler(body)
        except ValueError as exc:
            return self._fail(400, str(exc))
        except TimeoutError as exc:
            return self._fail(504, str(exc))
        except Exception as exc:  # 引擎/文件系统故障如实 5xx (未中≠错误, 不会走到这)
            log.exception("[handler] %s 内部错误", route)
            return self._fail(500, f"{type(exc).__name__}: {exc}")

    def _handle_check(self, body):
        if not ocr_ready():  # fail-loud: OCR 不可用时静默返回空 findings 会误导
            raise RuntimeError("OCR 引擎不可用 (rapidocr 未初始化, 详见启动日志)")
        image_path = validate_local_path(body.get("image_path"))
        expect = body.get("expect")
        if expect is not None:
            if not isinstance(expect, list) or not all(isinstance(e, dict) and e.get("text") for e in expect):
                raise ValueError("expect 须为 [{carrier?, text}] 且 text 必填")
        regions = body.get("regions")
        if regions is not None:
            if not isinstance(regions, list):
                raise ValueError("regions 须为 [box] 数组")
            regions = [parse_box(r) for r in regions]
        t0 = time.time()
        data = check_core(image_path, expect, regions)
        log.info("[check] %s findings=%d 耗时 %.1fs", image_path, len(data["findings"]), time.time() - t0)
        self._ok(data)

    def _handle_fix(self, body):
        if not ocr_ready():  # 复验依赖 OCR, 同样 fail-loud
            raise RuntimeError("OCR 引擎不可用 (rapidocr 未初始化, 详见启动日志)")
        image_path = validate_local_path(body.get("image_path"))
        expect_text = body.get("expect_text")
        if not isinstance(expect_text, str) or not expect_text.strip():
            raise ValueError("expect_text 必填")
        variants = body.get("variants")
        if variants is not None and not (isinstance(variants, list) and all(isinstance(v, str) for v in variants)):
            raise ValueError("variants 须为字符串数组")
        carrier_desc = body.get("carrier_desc")
        if carrier_desc is not None and not isinstance(carrier_desc, str):
            raise ValueError("carrier_desc 须为字符串")
        max_lottery = body.get("max_lottery")
        if max_lottery is not None and not isinstance(max_lottery, (int, float)):
            raise ValueError("max_lottery 须为数值")
        # box 在图内校验需要图宽高, 放进 fix_core (parse_box 带尺寸钳边)
        t0 = time.time()
        data = fix_core(image_path, body.get("box"), expect_text, variants, carrier_desc, max_lottery)
        log.info("[fix] 端到端耗时 %.1fs", time.time() - t0)
        self._ok(data)


def serve():
    try:
        get_ocr()  # 启动即加载 (数秒), 健康探针立刻能报 ocr:true
    except Exception as exc:
        log.error("[boot] RapidOCR 初始化失败 (服务照常启动, /health 如实报 false): %s", exc)
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), TextGuardHandler)
    httpd.daemon_threads = True
    log.info("[boot] Text-Guard sidecar 监听 :%d (日志 %s)", PORT, LOG_PATH)
    httpd.serve_forever()


# ─── selftest (mock 引擎, 不碰 GPU / ComfyUI / 网络 / rapidocr) ───────────


def run_selftest():
    """逻辑冒烟: box 裁剪计算 / 期望串判定 / verdict 分配 / 彩票循环(mock 引擎) /
    首中即停 / 最优残差 / 羽化贴回 containment。全部绿 exit 0。"""
    import tempfile

    checks = []

    def check(name, cond, detail=""):
        checks.append((name, bool(cond), detail))
        print(f"[selftest] {'PASS' if cond else 'FAIL'} {name}" + (f" — {detail}" if detail and not cond else ""))

    # T1 crop 边距计算 (参考实现公式: 0.5x宽/0.7x高, 地板 40, 钳回图内)
    cb = compute_crop_box([100, 242, 132, 349], 1920, 1080)
    check("T1a 战役实录框", cb == (60, 168, 172, 423), f"got {cb}")  # mx=40,my=74
    cb = compute_crop_box([0, 0, 50, 50], 200, 100)
    check("T1b 边缘钳回+地板40", cb == (0, 0, 90, 90), f"got {cb}")
    cb = compute_crop_box([10, 10, 300, 90], 320, 100)
    check("T1c 大边距钳回", cb == (0, 0, 320, 100), f"got {cb}")

    # T2 期望串判定 (归一化 / full / partial / none)
    check("T2a 归一化去空格", normalize_text("評 彈 夜 話") == normalize_text("評彈夜話"))
    check("T2b 整串包含=full", match_level("招牌 評彈夜話", "評彈夜話") == "full")
    check("T2c 首字漏检=partial", match_level("彈夜話", "評彈夜話") == "partial")
    check("T2d 許字残差≠full", match_level("許彈夜話", "評彈夜話") != "full")
    check("T2e 零命中=none", match_level("NOODLE BAR", "評彈夜話") == "none")
    check("T2f 命中判据含variants", accept_hit("评弹夜话", "評彈夜話", ["评弹夜话"]))
    check("T2g 宽子串不命中", not accept_hit("彈夜", "評彈夜話", []))

    # T3 verdict 分配 + missing 合成 (先 stub ocr_image, 喂受控 findings)
    findings = [
        {"text": "評彈夜話", "conf": 0.93, "box": [10, 10, 40, 200]},
        {"text": "許彈夜話", "conf": 0.64, "box": [60, 10, 90, 200]},   # 低conf+比对不中
        {"text": "NOODLE BAR", "conf": 0.97, "box": [200, 10, 380, 60]},  # 高conf但expect表比对不中
    ]
    saved_ocr, server_globals = ocr_image, globals()

    def mock_ocr_static(_path):
        return findings

    server_globals["ocr_image"] = mock_ocr_static
    data = check_core("fake.png", expect=[{"carrier": "竖幡", "text": "評彈夜話"},
                                          {"carrier": "木匾", "text": "聽雨軒"}])
    v = {f["text"]: f["verdict"] for f in data["findings"]}
    check("T3a 正字高conf=ok", v.get("評彈夜話") == "ok")
    check("T3b 低conf=suspect", v.get("許彈夜話") == "suspect")
    check("T3c expect比对不中=suspect", v.get("NOODLE BAR") == "suspect")
    missing = [f for f in data["findings"] if f["verdict"] == "missing"]
    check("T3d 零命中expect=missing", len(missing) == 1 and missing[0]["carrier"] == "木匾")
    check("T3e 命中项带carrier", data["findings"][0].get("carrier") == "竖幡")

    # T4/T5 彩票循环 (mock 引擎)
    tmpdir = tempfile.mkdtemp(prefix="tg_selftest_")
    src = os.path.join(tmpdir, "src.png")
    Image.new("RGB", (400, 300), (30, 30, 30)).save(src)

    submitted = []

    def mock_upload(local_path, _container):
        return os.path.basename(local_path)

    def mock_submit(api):
        submitted.append(api["40"]["inputs"]["seed"])
        return "pid-s%d" % api["40"]["inputs"]["seed"]

    def mock_wait(pid, _timeout):
        seed = int(pid.split("-s")[1])
        fake = os.path.join(tmpdir, f"fixed_s{seed}.png")
        Image.new("RGB", (256, 256), (200, 180, 160)).save(fake)  # 假"修后"crop
        # filename 给绝对路径: fix_core 的 os.path.join(OUTPUT_ROOT, sub, fn) 遇
        # 绝对段会整体覆盖 → 直读 tmpdir 假产物, 不碰 /mnt/agents/output
        return fake, "", 0.1

    ocr_table = {}

    def mock_ocr(path):
        m = re.search(r"_s(\d+)_", path)
        seed = int(m.group(1)) if m else -1
        return [{"text": t, "conf": 0.9, "box": [155, 105, 245, 195]} for t in ocr_table.get(seed, [])]

    def install_mocks():
        server_globals["engine_probe"] = lambda: None
        server_globals["engine_upload"] = mock_upload
        server_globals["engine_submit"] = mock_submit
        server_globals["engine_wait"] = mock_wait
        server_globals["ocr_image"] = mock_ocr

    def restore_mocks():
        server_globals["engine_probe"] = _engine_probe_impl
        server_globals["engine_upload"] = _engine_upload_impl
        server_globals["engine_submit"] = _engine_submit_impl
        server_globals["engine_wait"] = _engine_wait_impl
        server_globals["ocr_image"] = saved_ocr

    install_mocks()
    try:
        # T4: s42 残差 → s43 命中, 验证首中即停 (只提交 2 轮)
        ocr_table.clear()
        ocr_table[42] = ["許彈夜話"]
        ocr_table[43] = ["評彈夜話"]
        out = fix_core(src, [150, 100, 250, 200], "評彈夜話", variants=["评弹夜话"],
                       carrier_desc="tall narrow vertical hanging cloth banner", max_lottery=4)
        check("T4a 命中", out["hit"] is True)
        check("T4b 首中seed", out["seed"] == 43)
        check("T4c 轮数=2 (首中即停)", out["rounds"] == 2 and submitted == [42, 43], f"got {submitted}")
        check("T4d ocr_final", out["ocr_final"][0]["text"] == "評彈夜話")
        check("T4e 产物存在", os.path.isfile(out["output_path"]))
        composed = Image.open(out["output_path"]).convert("RGB")
        check("T4f 尺寸不变", composed.size == (400, 300))
        # 羽化贴回 containment: cbox 外像素逐位不变, cbox 内有变化
        base = Image.open(src).convert("RGB")
        cbox = compute_crop_box([150, 100, 250, 200], 400, 300)
        outside_same = all(composed.getpixel((x, y)) == base.getpixel((x, y))
                           for x in range(0, 400, 7) for y in range(0, 300, 7)
                           if not (cbox[0] <= x < cbox[2] and cbox[1] <= y < cbox[3]))
        inside_diff = any(composed.getpixel((x, y)) != base.getpixel((x, y))
                          for x in range(cbox[0] + 20, cbox[2] - 20, 5)
                          for y in range(cbox[1] + 20, cbox[3] - 20, 5))
        check("T4g cbox外零扰动", outside_same)
        check("T4h cbox内已贴回", inside_diff)

        # T5: 全轮未中 → hit:false + rounds=max_lottery + 最优残差 (s42 三字残差胜 s43 全错)
        submitted.clear()
        ocr_table.clear()
        ocr_table[42] = ["許彈夜話"]
        ocr_table[43] = ["錯錯"]
        ocr_table[44] = ["錯錯"]
        ocr_table[45] = ["錯錯"]
        out = fix_core(src, [150, 100, 250, 200], "評彈夜話", max_lottery=4)
        check("T5a 未中=hit:false (200语义非错误)", out["hit"] is False)
        check("T5b 跑满轮数", out["rounds"] == 4 and len(submitted) == 4)
        check("T5c 最优残差seed=42", out["seed"] == 42, f"got {out['seed']}")

        # T6: prompt 模板
        p = build_prompt("tall narrow vertical hanging cloth banner", "評彈夜話", True)
        check("T6a 点名载体", "hanging cloth banner" in p)
        check("T6b 引号点名目标", '"評彈夜話"' in p and "must read exactly" in p)
        check("T6c 竖排方向", "from top to bottom" in p and "vertically arranged" in p)
        check("T6d 不动他人+keep same", "Do NOT change any other sign" in p and "exactly the same" in p)
        p2 = build_prompt(None, "龍軒酒家", False)
        check("T6e 横排+缺省载体", "from left to right" in p2 and " on the sign" in p2)
    finally:
        restore_mocks()

    # T7 参数守卫
    for bad_call, name in [
        (lambda: validate_local_path("http://evil/x.png"), "T7a 拒URL(SSRF)"),
        (lambda: validate_local_path("/nonexistent/x.png"), "T7b 拒不存在"),
        (lambda: parse_box([1, 2, 3]), "T7c 拒坏box"),
        (lambda: parse_box([100, 100, 1000, 130], width=400), "T7d box钳边"),
    ]:
        try:
            r = bad_call()
            check(name, name == "T7d box钳边" and r == [100, 100, 400, 130], f"got {r}")
        except ValueError:
            check(name, name != "T7d box钳边")

    failed = [c for c in checks if not c[1]]
    print(f"[selftest] {len(checks) - len(failed)}/{len(checks)} 通过" + (" — 全绿" if not failed else ""))
    return 0 if not failed else 1


if __name__ == "__main__":
    import sys

    if "--selftest" in sys.argv[1:]:
        sys.exit(run_selftest())
    serve()
