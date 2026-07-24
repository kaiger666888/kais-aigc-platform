#!/usr/bin/env bash
# 《小江湖》EP01 角色卡(4 视角 turnaround)+ 森林背景变体,用 Dreamina CLI 生成。
# ⚠️ 用 text2image(不要用 image2image——对 turnaround sheet 会无限 querying 卡死,见 memory reference_dreamina_cli)。
# 下载用官方 query_result --download_dir(签名 URL curl 并发会偶发 0 字节,串行最稳)。
# 角色卡规范见 docs/ltx-msr-input-guide.md §2.2(正面近照 + 全身正/侧/背,横排 4 格白底)。
set -uo pipefail
BIN=/home/kai/.local/bin/dreamina
REFS=/data/workspace/kais-aigc-platform/workflows/ltx-2.3/shot-timeline-ep01-output/refs
mkdir -p "$REFS"

PROMPT_CAT='角色设计参考图 character turnaround reference sheet,同一只毛毛虫小孩在纯白背景上横排展示四个不同角度:第1格正面头部近景特写;第2格全身正面;第3格全身侧面 profile;第4格全身背面。四格必须是完全相同的同一个角色、外观细节完全一致。毛毛虫小孩:圆滚滚胖嘟嘟的身材,橙黄色柔软绒毛,头顶扎着一个绿色小草辫,大而灵动的眼睛,萌系可爱。皮克斯级 3D 动画写实渲染,干净均匀影棚光,纯白背景,无文字无水印。four views in one horizontal row'
PROMPT_BEE='角色设计参考图 character turnaround reference sheet,同一只独角仙武士在纯白背景上横排展示四个不同角度:第1格正面头部近景特写(突出头顶双叉弯角);第2格全身正面;第3格全身侧面 profile;第4格全身背面。四格必须是完全相同的同一个角色、外观细节完全一致。独角仙武士:红棕色油亮甲壳,头顶一支巨大的双叉弯角,前臂缠着米色绑带,英武挺拔的武术家站姿。皮克斯级 3D 动画写实渲染,干净均匀影棚光,纯白背景,无文字无水印。four views in one horizontal row'
PROMPT_MAN='角色设计参考图 character turnaround reference sheet,同一只螳螂武士在纯白背景上横排展示四个不同角度:第1格正面头部近景特写;第2格全身正面;第3格全身侧面 profile;第4格全身背面。四格必须是完全相同的同一个角色、外观细节完全一致。螳螂武士:翠绿色身体,白色大复眼,橙色触角,锋利的镰刀前足如双刀,手持小刀刃,机警的武术站姿。皮克斯级 3D 动画写实渲染,干净均匀影棚光,纯白背景,无文字无水印。four views in one horizontal row'
PROMPT_CEN='角色设计参考图 character turnaround reference sheet,同一只巨型红蜈蚣在纯白背景上横排展示四个不同角度:第1格正面头部近景特写(突出毒牙与张开的颚钳);第2格全身正面;第3格全身侧面 profile;第4格全身背面。四格必须是完全相同的同一个角色、外观细节完全一致。巨型红蜈蚣:猩红色甲壳,多节身体,密布黄色长足,扁平头部,一对黑色毒牙与张开的大颚钳,凶猛可怖的节肢动物。皮克斯级 3D 动画写实渲染,干净均匀影棚光,纯白背景,无文字无水印。four views in one horizontal row'
PROMPT_BG_MOSSY='原始森林场景,粗壮的苔藓巨树与盘根错节的树根,蕨类植物丛生,丁达尔光束穿透林冠洒下,暖绿色调,电影感浅景深,皮克斯级 3D 动画写实渲染,无人,无文字无水印'
PROMPT_BG_MISTY='雾气弥漫的原始森林林间空地,巨树盘根,薄雾缭绕,林间柔和光线,湿润苔藓地面,电影感,皮克斯级 3D 动画写实渲染,无人,无文字无水印'

submit() { # name prompt -> stdout submit_id
  local name="$1" prompt="$2"
  local data; data=$("$BIN" text2image --prompt="$prompt" --ratio=16:9 --model_version=5.0 --resolution_type=2k --poll=0 2>&1)
  local sid; sid=$(echo "$data" | python3 -c "import json,sys;print(json.load(sys.stdin).get('submit_id',''))" 2>/dev/null)
  if [ -z "$sid" ]; then echo "[$name] 提交失败: $data" >&2; return 1; fi
  echo "[$name] submitted $sid" >&2; echo "$sid"
}
# 轮询到 success,用官方 --download_dir 下载(最稳),重命名
fetch() { # name sid outfile
  local name="$1" sid="$2" out="$3"
  for i in $(seq 1 50); do
    local st; st=$("$BIN" query_result --submit_id="$sid" 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get('gen_status','?'))" 2>/dev/null)
    if [ "$st" = "success" ]; then
      local TMP=/tmp/dreamina-dl-$$; mkdir -p "$TMP"
      "$BIN" query_result --submit_id="$sid" --download_dir="$TMP" >/dev/null 2>&1
      local src; src=$(ls "$TMP"/*.png "$TMP"/*.jpg 2>/dev/null | head -1)
      if [ -n "$src" ]; then mv "$src" "$out" && echo "[$name] ✓ $out ($(du -h "$out"|cut -f1))" && rm -rf "$TMP" && return 0; fi
      rm -rf "$TMP"
    fi
    [ "$st" = "failed" -o "$st" = "error" ] && { echo "[$name] ❌ failed ($st)" >&2; return 1; }
    sleep 5
  done
  echo "[$name] ❌ timeout" >&2; return 1
}

echo "=== 提交 ==="
S_CAT=$(submit caterpillar "$PROMPT_CAT")
S_BEE=$(submit beetle      "$PROMPT_BEE")
S_MAN=$(submit mantis      "$PROMPT_MAN")
S_CEN=$(submit centipede   "$PROMPT_CEN")
S_BGM=$(submit bg_mossy    "$PROMPT_BG_MOSSY")
S_BGS=$(submit bg_misty    "$PROMPT_BG_MISTY")

echo "=== 串行下载 ==="
fetch caterpillar "$S_CAT" "$REFS/char_caterpillar_card.png"
fetch beetle      "$S_BEE" "$REFS/char_beetle_card.png"
fetch mantis      "$S_MAN" "$REFS/char_mantis_card.png"
fetch centipede   "$S_CEN" "$REFS/char_centipede_card.png"
fetch bg_mossy    "$S_BGM" "$REFS/bg_forest_mossy.jpg"
fetch bg_misty    "$S_BGS" "$REFS/bg_forest_misty.jpg"
echo "=== done ==="; ls -la "$REFS"/*_card.png "$REFS"/bg_forest_*.jpg 2>/dev/null
