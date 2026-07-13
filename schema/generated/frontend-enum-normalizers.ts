// AUTO-GENERATED from pipeline-field-map.yaml — DO NOT EDIT.
// Run `python schema/generate_mappings.py` to regenerate.

export const SCHEMA_ALIASES: Record<string, Record<string, string>> = {
  "script": {
    "hook_type": "hookType",
    "hook_strength": "hookIntensity",
    "duration_sec": "totalDuration",
    "mcmahon_arc": "mcmahonArc",
    "camera_movement": "cameraMovement",
    "axis_line": "axisLine",
    "audio_cue": "audioCue",
    "ltx_prompt": "ltxPrompt"
  },
  "asset": {
    "role": "archetype",
    "age_range": "ageRange"
  },
  "storyboard": {
    "camera_movement": "cameraMovement",
    "axis_line": "axisLine",
    "audio_cue": "audioCue",
    "ltx_prompt": "ltxPrompt"
  },
  "audio": {
    "audio_type": "audioType"
  },
  "video": {
    "duration_sec": "duration",
    "murch_grade": "murchGrade"
  }
};

export const ENUM_NORMALIZERS: Record<string, Record<string, string>> = {
  "hookType": {
    "情感钩": "emotional_hook",
    "悬念钩": "suspense_hook",
    "冲突钩": "conflict_hook",
    "反差钩": "contrast_hook",
    "情绪爆点": "emotional_peak"
  },
  "mcmahonArc": {
    "环形": "Rags_to_Riches",
    "白手起家": "Rags_to_Riches",
    "落井": "Man_in_a_Hole",
    "先降后升": "Man_in_a_Hole",
    "触底反弹": "Man_in_a_Hole",
    "先升后降": "Icarus",
    "悲剧": "Tragedy",
    "灰姑娘": "Cinderella",
    "逆袭": "Cinderella",
    "卡夫卡": "Kafkaesque",
    "两半": "Two_Halves"
  },
  "cameraMovement": {
    "固定": "static",
    "缓慢推进": "zoom_in",
    "快速推进": "zoom_in",
    "缓慢拉远": "zoom_out",
    "快速拉远": "zoom_out",
    "左摇": "pan_left",
    "右摇": "pan_right",
    "上仰": "tilt_up",
    "下俯": "tilt_down",
    "推移": "dolly",
    "跟随": "tracking",
    "手持": "tracking",
    "航拍": "tracking",
    "升降": "dolly",
    "摇臂": "crane",
    "斯坦尼康": "steadicam",
    "变焦推进": "zoom_in",
    "变焦拉远": "zoom_out"
  },
  "framing": {
    "大远景": "wide",
    "远景": "wide",
    "全景": "wide",
    "中景": "medium",
    "近景": "close_up",
    "特写": "extreme_close_up",
    "大特写": "extreme_close_up",
    "过肩": "over_the_shoulder",
    "航拍": "aerial"
  },
  "composition": {
    "三分法": "rule_of_thirds",
    "居中": "centered",
    "黄金": "golden_ratio",
    "黄金比": "golden_ratio",
    "黄金分割": "golden_ratio",
    "对称": "symmetrical",
    "引导线": "leading_lines",
    "框架": "framing"
  },
  "pacing": {
    "慢速": "slow",
    "慢": "slow",
    "中速": "medium",
    "中": "medium",
    "快速": "fast",
    "快": "fast",
    "蒙太奇": "montage"
  },
  "timeline": {
    "日": "day",
    "夜": "night",
    "黄昏": "dusk",
    "黎明": "dawn",
    "室内": "indoor",
    "室外": "outdoor"
  },
  "axisLine": {
    "左→右": "L2R",
    "左到右": "L2R",
    "右→左": "R2L",
    "右到左": "R2L",
    "上升": "Up",
    "下降": "Down",
    "中立": "neutral"
  },
  "audioType": {
    "人声": "voice",
    "旁白": "voice",
    "配音": "voice",
    "台词": "voice",
    "对话": "dialogue",
    "背景音乐": "bgm",
    "音乐": "bgm",
    "音效": "sfx",
    "效果": "sfx",
    "环境": "ambient",
    "环境音": "ambient"
  },
  "emotion": {
    "中性": "neutral",
    "快乐": "happy",
    "开心": "happy",
    "悲伤": "sad",
    "愤怒": "angry",
    "恐惧": "fearful",
    "害怕": "fearful",
    "惊讶": "surprised",
    "轻蔑": "contempt",
    "温柔": "tender",
    "怀旧": "nostalgic",
    "坚定": "determined"
  },
  "murchGrade": {
    "优秀": "excellent",
    "合格": "pass",
    "弱": "weak",
    "不合格": "fail"
  }
};
