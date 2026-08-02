#!/usr/bin/env python3
"""
Turnaround Sheet 方向（portrait/landscape）自动检测脚本。

检查指定 episode 的所有 turnaround sheet PNG 文件是否符合 form_factor 方向要求：
  - portrait (9:16)：宽 < 高，竖屏
  - landscape (16:9)：宽 > 高，横屏

用法:
  python3 validate_turnaround_orientation.py --workdir /path/to/episode/assets
  python3 validate_turnaround_orientation.py --workdir /path/to/episode/assets --expected portrait
  python3 validate_turnaround_orientation.py --oss-dir /data/workspace/kais-aigc-platform/data/oss/PROJECT_ID/p04/turnaround_sheets --expected portrait

退出码:
  0 = 全部达标
  1 = 有不达标文件
  2 = 参数错误
"""
import argparse
import sys
import os
from pathlib import Path

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def get_image_size(filepath: str) -> tuple[int, int] | None:
    """返回 (width, height)，失败返回 None。"""
    if not os.path.exists(filepath):
        return None
    if HAS_PIL:
        try:
            from PIL import Image as _Image
            with _Image.open(filepath) as img:
                return img.size
        except Exception:
            pass
    # Fallback: identify (ImageMagick)
    import subprocess
    try:
        result = subprocess.run(
            ["identify", "-format", "%w %h", filepath],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            parts = result.stdout.strip().split()
            return int(parts[0]), int(parts[1])
    except Exception:
        pass
    return None


def detect_orientation(width: int, height: int) -> str:
    """检测图片方向：portrait (竖) / landscape (横) / square。"""
    if height > width * 1.1:
        return "portrait"
    elif width > height * 1.1:
        return "landscape"
    else:
        return "square"


def validate_turnaround(
    search_dir: str,
    expected: str = "portrait",
    pattern: str = "turnaround_*.png",
) -> list[dict]:
    """
    检查目录下所有匹配的 turnaround 文件。
    返回 [{file, width, height, orientation, passed}] 列表。
    """
    results = []
    search_path = Path(search_dir)
    if not search_path.exists():
        print(f"❌ 目录不存在: {search_dir}")
        return results

    files = sorted(search_path.glob(pattern))
    if not files:
        print(f"⚠️  目录下无匹配 '{pattern}' 的文件: {search_dir}")
        return results

    print(f"\n{'='*60}")
    print(f"Turnaround 方向检测")
    print(f"  目录: {search_dir}")
    print(f"  期望方向: {expected}")
    print(f"  找到文件: {len(files)} 个")
    print(f"{'='*60}\n")

    all_passed = True
    for f in files:
        size = get_image_size(str(f))
        if size is None:
            results.append({
                "file": f.name, "width": 0, "height": 0,
                "orientation": "unknown", "passed": False,
                "error": "无法读取尺寸"
            })
            print(f"  ❌ {f.name}: 无法读取尺寸")
            all_passed = False
            continue

        w, h = size
        orientation = detect_orientation(w, h)
        passed = orientation == expected

        status = "✅" if passed else "⚠️"
        results.append({
            "file": f.name, "width": w, "height": h,
            "orientation": orientation, "passed": passed
        })

        if not passed:
            all_passed = False
            print(f"  {status} {f.name}: {w}×{h} ({orientation}) — 期望 {expected}")
        else:
            print(f"  {status} {f.name}: {w}×{h} ({orientation})")

    # Summary
    passed_count = sum(1 for r in results if r["passed"])
    failed_count = len(results) - passed_count
    print(f"\n{'='*60}")
    print(f"结果: {passed_count} 达标 / {failed_count} 不达标 / {len(results)} 总计")
    if all_passed:
        print("✅ 全部达标！")
    else:
        print("⚠️  有不达标文件！")
    print(f"{'='*60}\n")

    return results


def main():
    parser = argparse.ArgumentParser(description="Turnaround 方向自动检测")
    parser.add_argument(
        "--workdir", type=str,
        help="episode assets 目录（含 turnaround_sheets/ 子目录）"
    )
    parser.add_argument(
        "--oss-dir", type=str,
        help="直接指定 turnaround_sheets 目录"
    )
    parser.add_argument(
        "--expected", type=str, default="portrait",
        choices=["portrait", "landscape"],
        help="期望方向（默认 portrait）"
    )
    parser.add_argument(
        "--pattern", type=str, default="turnaround_*.png",
        help="文件匹配模式（默认 turnaround_*.png）"
    )
    args = parser.parse_args()

    if args.oss_dir:
        search_dir = args.oss_dir
    elif args.workdir:
        search_dir = os.path.join(args.workdir, "turnaround_sheets")
    else:
        print("❌ 需要指定 --workdir 或 --oss-dir")
        return 2

    results = validate_turnaround(search_dir, args.expected, args.pattern)

    if not results:
        return 0  # No files found, not a failure

    all_passed = all(r["passed"] for r in results)
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
