#!/usr/bin/env python3
"""
前后端 API 契约审计脚本
扫描前端所有 /api/ 路径调用，与后端 router.ts 注册路径做交叉比对，报告不匹配项。

用法: python3 scripts/audit-api-contract.py
"""
import re
import os
import sys
from pathlib import Path
from collections import defaultdict

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "packages" / "infinite-canvas" / "src"
ROUTER_FILE = REPO_ROOT / "src" / "router.ts"

# ─── 1. 提取后端注册的所有 base paths ───────────────────────

def extract_backend_paths():
    """从 router.ts 提取所有 app.use("path", routeN) 注册路径。"""
    content = ROUTER_FILE.read_text()
    # 匹配 app.use("/api/...", routeN);
    pattern = r'app\.use\("(/[^"]+)"\s*,\s*route\d+\)'
    paths = re.findall(pattern, content)
    return sorted(set(paths))

# ─── 2. 提取前端所有 API 调用路径 ───────────────────────────

def extract_frontend_calls():
    """
    扫描前端 src/ 下所有 .ts/.tsx 文件，提取 /api/ 路径调用。
    覆盖模式:
      - apiCall('/path', ...)
      - fetch(`/api/path...`)
      - fetch(`${API_BASE}/path...`)
      - fetch(`${apiBase}/api/path...`)
      - 字符串字面量 '/api/path'
    """
    calls = []  # [(file, line, method, full_path)]

    # API_BASE = '/api' 前缀映射
    api_base = "/api"

    files = []
    for ext in ("*.ts", "*.tsx"):
        files.extend(FRONTEND_DIR.rglob(ext))

    for fpath in sorted(files):
        if fpath.suffix == ".d.ts":
            continue
        if "node_modules" in str(fpath):
            continue

        try:
            lines = fpath.read_text(encoding="utf-8").splitlines()
        except Exception:
            continue

        for i, line in enumerate(lines, 1):
            line_stripped = line.strip()
            # 跳过注释行
            if line_stripped.startswith("//") or line_stripped.startswith("*"):
                continue

            rel_path = str(fpath.relative_to(FRONTEND_DIR))

            # Pattern 1: apiCall('/path', ...) → path 拼接 API_BASE='/api'
            for m in re.finditer(r"apiCall\s*\(\s*[`'\"`]([^`'\"]+)[`'\"`]", line):
                path = m.group(1)
                if path.startswith("/"):
                    full = api_base + path
                    calls.append((rel_path, i, "POST(apiCall)", full))

            # Pattern 2: fetch(`/api/...`) 或 fetch(`${API_BASE}/...`) 或 fetch(`${apiBase}/api/...`)
            for m in re.finditer(r"fetch\s*\(\s*[`'\"`]([^`'\"]+)[`'\"`]", line):
                raw = m.group(1)
                full = resolve_path(raw, api_base)
                if full and full.startswith("/api/"):
                    method = "GET"  # 默认 GET，下面会修正
                    if "method:" in line and "POST" in line:
                        method = "POST"
                    elif "method:" in line and "PATCH" in line:
                        method = "PATCH"
                    elif "method:" in line and "DELETE" in line:
                        method = "DELETE"
                    calls.append((rel_path, i, method + "(fetch)", full))

            # Pattern 3: ${API_BASE}/path → /api/path
            for m in re.finditer(r"\$\{API_BASE\}([^`'\"]+)", line):
                path = m.group(1)
                if path.startswith("/"):
                    full = api_base + path
                    method = "GET"
                    if "method:" in line and "POST" in line:
                        method = "POST"
                    elif "method:" in line and "PATCH" in line:
                        method = "PATCH"
                    elif "method:" in line and "DELETE" in line:
                        method = "DELETE"
                    calls.append((rel_path, i, method + "(API_BASE)", full))

    return calls

def resolve_path(raw, api_base):
    """把各种路径形式统一为 /api/... 形式。"""
    # ${apiBase}/api/canvas/... → /api/canvas/...
    raw = re.sub(r"\$\{apiBase\}", "", raw)
    # ${API_BASE}/canvas/... → /api/canvas/...
    raw = re.sub(r"\$\{API_BASE\}", api_base, raw)
    # 去掉模板字符串变量（如 ${projectId}）保留路径结构
    raw = re.sub(r"\$\{[^}]+\}", ":param", raw)
    return raw

# ─── 3. 交叉比对 ─────────────────────────────────────────────

def path_matches(frontend_path, backend_paths):
    """
    检查前端路径是否匹配某个后端 base path。
    前端路径可能带 query params 和 path params。

    匹配规则：后端 base path 是前端路径的前缀。
    例如：
      前端 /api/notion/pages → 后端 /api/notion ✓
      前端 /api/v1/assets-registry/search → 后端 /api/v1/assets-registry ✓
      前端 /api/v2/canvas/review/options → 后端 /api/v2/canvas/review ✗ (没有这个注册)
    """
    # 去掉 query string
    path = frontend_path.split("?")[0]

    # 去掉 trailing slash
    path = path.rstrip("/")

    for bp in backend_paths:
        bp_clean = bp.rstrip("/")
        # 通用化：所有 :xxx 参数都替换为 [^/]+
        # （\\? 兼容 Python 3.7+ 不转义冒号 与旧版本转义出的 \:）
        bp_pattern = re.escape(bp_clean)
        bp_pattern = re.sub(r"\\?:([a-zA-Z_]+)", r"[^/]+", bp_pattern)
        if re.match(rf"^{bp_pattern}(/|$)", path):
            return True, bp

    return False, None

# ─── 4. 主函数 ───────────────────────────────────────────────

def main():
    backend_paths = extract_backend_paths()
    frontend_calls = extract_frontend_calls()

    print(f"\n{'='*80}")
    print(f"前后端 API 契约审计报告")
    print(f"{'='*80}")
    print(f"\n后端注册 base paths: {len(backend_paths)} 个")
    print(f"前端 API 调用: {len(frontend_calls)} 处\n")

    # ── 匹配检查 ──
    matched = []
    unmatched = []
    seen_unmatched = set()

    for rel_path, line_no, method, full_path in frontend_calls:
        ok, matched_bp = path_matches(full_path, backend_paths)
        if ok:
            matched.append((rel_path, line_no, method, full_path, matched_bp))
        else:
            key = (rel_path, full_path)
            if key not in seen_unmatched:
                seen_unmatched.add(key)
                unmatched.append((rel_path, line_no, method, full_path))

    # ── 报告 ──
    if unmatched:
        print(f"\n{'!'*80}")
        print(f"❌ 不匹配的前端 API 调用 ({len(unmatched)} 个)")
        print(f"{'!'*80}\n")
        for rel_path, line_no, method, full_path in unmatched:
            print(f"  {rel_path}:{line_no}")
            print(f"    {method} {full_path}")
            # 尝试找最接近的后端路径
            suggestions = find_suggestions(full_path, backend_paths)
            if suggestions:
                print(f"    → 可能应该匹配的后端路径:")
                for s in suggestions:
                    print(f"      • {s}")
            else:
                print(f"    → 后端完全找不到对应路由!")
            print()
    else:
        print(f"\n✅ 所有前端 API 调用都能匹配到后端路由!")

    # ── 统计 ──
    print(f"\n{'='*80}")
    print(f"统计摘要")
    print(f"{'='*80}")
    print(f"  匹配成功: {len(matched)}")
    print(f"  匹配失败: {len(unmatched)}")
    print(f"  匹配率:   {len(matched)/(len(matched)+len(unmatched))*100:.1f}%")

    # ── 未被任何前端调用的后端路由 ──
    used_backends = set(bp for _, _, _, _, bp in matched)
    unused_backends = sorted(set(backend_paths) - used_backends)
    # 过滤掉明显不需要前端调用的（pipeline/生产引擎/管理 API，仅后端或 Python 管线调用）
    ignore_prefixes = [
        "/api/v1/pipeline/callback",
        "/api/v1/pipeline/ingest",
        "/api/v1/pipeline/render-shot",
        "/api/v1/pipeline/resume",
        "/api/v1/pipeline/status",
        "/api/v1/pipeline/submit",
        "/api/proxy/",
        "/api/setting/",
        "/api/project/",
        "/api/script/",
        "/api/v1/telegram/",
        "/api/v1/sync/",
        "/api/assets/",
        "/api/v1/ace/",
        "/api/v1/hunyuan3d/",
        "/api/v1/trellis2/",
        "/api/v1/lora-train",
        "/api/v1/tts/",
        "/api/production/",  # 所有生产引擎 API（Python 管线调用）
        "/api/v1/stableaudio/",
        "/api/v1/director-desk/",
        "/api/v1/reflection",
        "/api/v1/shots/",
        "/api/v1/audit",
        "/api/v1/snapshots",
    ]
    truly_unused = [bp for bp in unused_backends
                    if not any(bp.startswith(p) for p in ignore_prefixes)]
    if truly_unused:
        print(f"\n⚠ 前端未调用的后端路由 (可能是后端专用/管理路由):")
        for bp in truly_unused:
            print(f"  • {bp}")

    return 1 if unmatched else 0

def find_suggestions(path, backend_paths):
    """为不匹配的路径找最接近的后端路径。"""
    suggestions = []
    path_parts = path.strip("/").split("/")

    for bp in backend_paths:
        bp_parts = bp.strip("/").split("/")
        # 计算公共前缀长度
        common = 0
        for a, b in zip(path_parts, bp_parts):
            if a == b:
                common += 1
            else:
                break
        if common >= 2:  # 至少匹配 2 级
            suggestions.append((common, bp))

    suggestions.sort(key=lambda x: -x[0])
    return [bp for _, bp in suggestions[:3]]

if __name__ == "__main__":
    sys.exit(main())
