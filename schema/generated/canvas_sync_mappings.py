"""AUTO-GENERATED from pipeline-field-map.yaml — DO NOT EDIT.

Run `python schema/generate_mappings.py` to regenerate.
"""
from typing import Any

VERSION = "1.0.0"

ENUM_MAPS: dict[str, dict[str, str]] = {
    "camera_movement": {
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
    "axis_line": {
        "左→右": "L2R",
        "左到右": "L2R",
        "右→左": "R2L",
        "右到左": "R2L",
        "上升": "Up",
        "下降": "Down",
        "中立": "neutral"
    },
    "hook_type": {
        "情感钩": "emotional_hook",
        "悬念钩": "suspense_hook",
        "冲突钩": "conflict_hook",
        "反差钩": "contrast_hook",
        "情绪爆点": "emotional_peak"
    },
    "mcmahon_arc": {
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
    "audio_type": {
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
    "murch_grade": {
        "优秀": "excellent",
        "合格": "pass",
        "弱": "weak",
        "不合格": "fail"
    }
}

ENUM_DEFAULTS: dict[str, str] = {
    "camera_movement": "static",
    "framing": "medium",
    "composition": "rule_of_thirds",
    "pacing": "medium",
    "timeline": "day",
    "axis_line": "neutral",
    "hook_type": "emotional_hook",
    "mcmahon_arc": "Man_in_a_Hole",
    "audio_type": "voice",
    "emotion": "neutral",
    "murch_grade": "pass"
}

PHASE_META: dict[str, dict[str, str]] = {
    "p01": {
        "canvas_type": "script",
        "asset_type": "topic"
    },
    "p02": {
        "canvas_type": "script",
        "asset_type": "outline"
    },
    "p03": {
        "canvas_type": "script",
        "asset_type": "script_phase"
    },
    "p04": {
        "canvas_type": "asset",
        "asset_type": "role"
    },
    "p05": {
        "canvas_type": "script",
        "asset_type": "script_phase"
    },
    "p06": {
        "canvas_type": "script",
        "asset_type": "script_phase"
    },
    "p07": {
        "canvas_type": "asset",
        "asset_type": "scene"
    },
    "p08": {
        "canvas_type": "asset",
        "asset_type": "scene"
    },
    "p09": {
        "canvas_type": "storyboard",
        "asset_type": "storyboard"
    },
    "p10": {
        "canvas_type": "audio",
        "asset_type": "voice"
    },
    "p11": {
        "canvas_type": "video",
        "asset_type": "video"
    },
    "p12": {
        "canvas_type": "video",
        "asset_type": "clip"
    },
    "p13": {
        "canvas_type": "script",
        "asset_type": "delivery"
    },
    "p14": {
        "canvas_type": "script",
        "asset_type": "script_phase"
    }
}

PHASE_FIELDS: dict[str, dict[str, dict[str, Any]]] = {
    "p01": {
        "hook_type": {
            "python_key": "hook_type",
            "canvas_key": "hookType",
            "zod_type": "string",
            "enum": "hook_type",
            "required": False
        },
        "hook_strength": {
            "python_key": "hook_strength",
            "canvas_key": "hookIntensity",
            "zod_type": "number",
            "transform": "hook_intensity",
            "required": False
        },
        "total_duration": {
            "python_key": "duration_sec",
            "canvas_key": "totalDuration",
            "zod_type": "string",
            "transform": "to_string",
            "required": False
        },
        "genre": {
            "python_key": "genre",
            "canvas_key": "genre",
            "zod_type": "string",
            "required": False
        },
        "tone": {
            "python_key": "tone",
            "canvas_key": "tone",
            "zod_type": "string",
            "required": False
        },
        "total_duration_sec": {
            "python_key": "total_duration_sec",
            "canvas_key": "total_duration_sec",
            "zod_type": "string",
            "required": False
        }
    },
    "p02": {
        "hook_strength": {
            "python_key": "hook_strength",
            "canvas_key": "hookIntensity",
            "zod_type": "number",
            "transform": "hook_intensity",
            "required": False
        }
    },
    "p03": {
        "mcmahon_arc": {
            "python_key": "mcmahon_arc",
            "canvas_key": "mcmahonArc",
            "zod_type": "string",
            "enum": "mcmahon_arc",
            "required": False
        }
    },
    "p04": {
        "archetype": {
            "python_key": "role",
            "canvas_key": "archetype",
            "zod_type": "string",
            "transform": "derive_archetype",
            "required": False
        },
        "age_range": {
            "python_key": "age_range",
            "canvas_key": "ageRange",
            "zod_type": "string",
            "transform": "derive_age_range",
            "required": False
        },
        "era": {
            "python_key": "era",
            "canvas_key": "era",
            "zod_type": "string",
            "required": False
        }
    },
    "p05": {},
    "p06": {
        "camera_movement": {
            "python_key": "camera_movement",
            "canvas_key": "cameraMovement",
            "zod_type": "string",
            "enum": "camera_movement",
            "required": False
        },
        "framing": {
            "python_key": "framing",
            "canvas_key": "framing",
            "zod_type": "string",
            "enum": "framing",
            "required": False
        },
        "composition": {
            "python_key": "composition",
            "canvas_key": "composition",
            "zod_type": "string",
            "enum": "composition",
            "required": False
        },
        "pacing": {
            "python_key": "pacing",
            "canvas_key": "pacing",
            "zod_type": "string",
            "enum": "pacing",
            "required": False
        },
        "timeline": {
            "python_key": "timeline",
            "canvas_key": "timeline",
            "zod_type": "string",
            "enum": "timeline",
            "required": False
        },
        "axis_line": {
            "python_key": "axis_line",
            "canvas_key": "axisLine",
            "zod_type": "string",
            "enum": "axis_line",
            "required": False
        },
        "audio_cue": {
            "python_key": "audio_cue",
            "canvas_key": "audioCue",
            "zod_type": "string",
            "required": False
        },
        "ltx_prompt": {
            "python_key": "ltx_prompt",
            "canvas_key": "ltxPrompt",
            "zod_type": "string",
            "required": False
        },
        "video_prompt": {
            "python_key": "video_prompt",
            "canvas_key": "videoPrompt",
            "zod_type": "string",
            "required": False
        },
        "shot_type": {
            "python_key": "shot_type",
            "canvas_key": "shot_type",
            "zod_type": "string",
            "required": False
        },
        "duration_sec": {
            "python_key": "duration_sec",
            "canvas_key": "duration_sec",
            "zod_type": "number",
            "required": True
        }
    },
    "p07": {
        "style_composition": {
            "python_key": "composition",
            "canvas_key": "style_composition",
            "zod_type": "number",
            "transform": "coerce_float_0_1",
            "required": False
        },
        "style_color": {
            "python_key": "color",
            "canvas_key": "style_color",
            "zod_type": "number",
            "transform": "coerce_float_0_1",
            "required": False
        },
        "style_rhythm": {
            "python_key": "rhythm",
            "canvas_key": "style_rhythm",
            "zod_type": "number",
            "transform": "coerce_float_0_1",
            "required": False
        },
        "style_light": {
            "python_key": "light_shadow",
            "canvas_key": "style_light",
            "zod_type": "number",
            "transform": "coerce_float_0_1",
            "required": False
        },
        "style_sound": {
            "python_key": "sound",
            "canvas_key": "style_sound",
            "zod_type": "number",
            "transform": "coerce_float_0_1",
            "required": False
        },
        "era": {
            "python_key": "era",
            "canvas_key": "era",
            "zod_type": "string",
            "required": False
        }
    },
    "p08": {},
    "p09": {
        "camera_movement": {
            "python_key": "camera_movement",
            "canvas_key": "cameraMovement",
            "zod_type": "string",
            "enum": "camera_movement",
            "required": False
        },
        "framing": {
            "python_key": "framing",
            "canvas_key": "framing",
            "zod_type": "string",
            "enum": "framing",
            "required": False
        },
        "composition": {
            "python_key": "composition",
            "canvas_key": "composition",
            "zod_type": "string",
            "enum": "composition",
            "required": False
        },
        "pacing": {
            "python_key": "pacing",
            "canvas_key": "pacing",
            "zod_type": "string",
            "enum": "pacing",
            "required": False
        },
        "timeline": {
            "python_key": "timeline",
            "canvas_key": "timeline",
            "zod_type": "string",
            "enum": "timeline",
            "required": False
        },
        "axis_line": {
            "python_key": "axis_line",
            "canvas_key": "axisLine",
            "zod_type": "string",
            "enum": "axis_line",
            "required": False
        },
        "audio_cue": {
            "python_key": "audio_cue",
            "canvas_key": "audioCue",
            "zod_type": "string",
            "required": False
        },
        "ltx_prompt": {
            "python_key": "ltx_prompt",
            "canvas_key": "ltxPrompt",
            "zod_type": "string",
            "required": False
        },
        "video_prompt": {
            "python_key": "video_prompt",
            "canvas_key": "videoPrompt",
            "zod_type": "string",
            "required": False
        },
        "shot_type": {
            "python_key": "shot_type",
            "canvas_key": "shot_type",
            "zod_type": "string",
            "required": True
        },
        "shot_type_camel": {
            "python_key": "shot_type",
            "canvas_key": "shotType",
            "zod_type": "string",
            "required": False
        },
        "duration_sec_camel": {
            "python_key": "duration_sec",
            "canvas_key": "durationS",
            "zod_type": "number",
            "required": False
        },
        "duration_sec": {
            "python_key": "duration_sec",
            "canvas_key": "duration_sec",
            "zod_type": "number",
            "required": True
        }
    },
    "p10": {
        "audio_type": {
            "python_key": "audio_type",
            "canvas_key": "audioType",
            "zod_type": "string",
            "enum": "audio_type",
            "required": False
        },
        "engine": {
            "python_key": "engine",
            "canvas_key": "engine",
            "zod_type": "string",
            "required": False
        },
        "emotion": {
            "python_key": "emotion",
            "canvas_key": "emotion",
            "zod_type": "string",
            "enum": "emotion",
            "required": False
        },
        "speaker": {
            "python_key": "speaker",
            "canvas_key": "speaker",
            "zod_type": "string",
            "required": False
        },
        "duration": {
            "python_key": "duration_sec",
            "canvas_key": "duration",
            "zod_type": "number",
            "required": False
        }
    },
    "p11": {
        "engine": {
            "python_key": "engine",
            "canvas_key": "engine",
            "zod_type": "string",
            "required": False
        },
        "resolution": {
            "python_key": "resolution",
            "canvas_key": "resolution",
            "zod_type": "string",
            "required": False
        },
        "duration": {
            "python_key": "duration_sec",
            "canvas_key": "duration",
            "zod_type": "number",
            "required": False
        },
        "murch_grade": {
            "python_key": "murch_grade",
            "canvas_key": "murchGrade",
            "zod_type": "string",
            "enum": "murch_grade",
            "transform": "murch_numeric_to_string",
            "required": False
        }
    },
    "p12": {},
    "p13": {},
    "p14": {}
}
