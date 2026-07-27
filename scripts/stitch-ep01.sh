#!/usr/bin/env bash
# 《小江湖》EP01 成片拼接:93 镜 concat + 原片 AAC 音轨对齐 → 完整带声成片。
# 用法: scripts/stitch-ep01.sh [TAG=rt1]
# 前置:全 93 镜 stlep01_shotNNN_<TAG>.mp4 已生成(gen-from-shot-timeline.ts)。
set -euo pipefail
TAG="${1:-rt1}"
ROOT="/data/workspace/kais-aigc-platform"
OUT="$ROOT/workflows/ltx-2.3/shot-timeline-ep01-output"
ORIG="/data/home/kai/下载/bilibili_xiaojianghu/虫虫武侠小故事《小江湖》第01话：爸爸去哪儿？（ 画面只是工具，情绪才是目的。.mp4"
LIST="$OUT/concat_${TAG}.txt"

echo "=== [1/4] 检查 93 镜齐全 + 生成 concat list ==="
MISS=0
> "$LIST"
for n in $(seq -f "%03g" 1 93); do
  f="$OUT/stlep01_shot${n}_${TAG}.mp4"
  if [ ! -f "$f" ]; then echo "✗ 缺 $f"; MISS=$((MISS+1)); continue; fi
  printf "file '%s'\n" "$f" >> "$LIST"
done
[ "$MISS" -gt 0 ] && { echo "❌ 缺 $MISS 镜,先跑全量生成"; exit 1; }
echo "✓ 93 镜齐全"

echo "=== [2/4] concat 93 镜(无声) ==="
# 先试 -c copy(同编码快),失败回退重编码
if ! ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "$LIST" -c copy "$OUT/ep01_full_${TAG}_silent.mp4" 2>/dev/null; then
  echo "(concat copy 失败,回退重编码)"
  ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "$LIST" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -an "$OUT/ep01_full_${TAG}_silent.mp4"
fi

GEN_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/ep01_full_${TAG}_silent.mp4")
ORIG_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$ORIG")
echo "生成片长=${GEN_DUR}s  原片长=${ORIG_DUR}s"

echo "=== [3/4] 音轨 atempo 对齐 + [4/4] 混音成片 ==="
# atempo 把原片音轨拉伸/压缩到生成片长(93 镜各自 8k+1 取整会累积微小偏差)
FACTOR=$(python3 -c "print(round($GEN_DUR/$ORIG_DUR,4))")
echo "atempo factor=$FACTOR"
ffmpeg -y -hide_banner -loglevel error \
  -i "$OUT/ep01_full_${TAG}_silent.mp4" -i "$ORIG" \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -b:a 192k \
  -af "atempo=$FACTOR" \
  -shortest -movflags +faststart "$OUT/ep01_full_${TAG}.mp4"

echo "✅ 带声成片: $OUT/ep01_full_${TAG}.mp4"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/ep01_full_${TAG}.mp4" | xargs -I{} echo "时长: {}s"
ls -la "$OUT/ep01_full_${TAG}.mp4"
