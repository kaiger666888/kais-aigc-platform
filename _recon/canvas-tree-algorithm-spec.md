# Canvas Tree-Building Algorithm Specification

Extracted from `canvas_sync.py` + `canvas_graph.py` and the live project 9999 canvas data.

## Overview

The canvas produces a **3-level tree** for each pipeline phase:

```
Zone (ellipse)      — phase header bar
  └→ Summary        — phase summary card with artifact count
        └→ Artifact — individual output items (one per list element)
```

All three levels exist within the same React Flow canvas, linked by explicit edges.

---

## 1. Node Types & ID Patterns

### Zone Node
- **ID**: `{phase_prefix}` (e.g., `"p01"`, `"p04"`)
- **type**: `"zone"`
- **position**: `{x: laneIndex * 1300, y: 0}`
- **size**: `{width: 1200, height: 80}`
- **data**: `{label, phase, state: "success"}`

### Summary Node
- **ID**: `sum-{phase_prefix}` (e.g., `"sum-p01"`)
- **type**: phase-specific canvas type (`"script"` | `"asset"` | `"storyboard"` | `"audio"` | `"video"`)
- **position**: `{x: laneIndex * 1300, y: 80}`
- **size**: `{width: 260, height: 120}`
- **data**: `{label, description: "N artifacts", assetType, state: "success", tags: ["phase"]}`

### Artifact Node
- **ID**: `a-{phase_prefix}-art{N}` (e.g., `"a-p01-art0"`, `"a-p01-art1"`)
- **type**: same canvas type as the phase's summary node
- **position**: `{x: baseX + col * 270, y: 200 + row * 290}` where `col = N % 4`, `row = N // 4`
- **size**: `{width: 240, height: 260}`
- **data**: `{label, state: "success", assetType, tags: [], output_key, name?, description?, thumbnailUrl?, filePath?, ...extra}`

---

## 2. Link Patterns

### Zone → Summary
- **id**: `zl2-{zone_id}-sum-{zone_id}` (e.g., `"zl2-p01-sum-p01"`)
- **source**: zone id, **target**: summary id
- **dataType**: `"output"`

### Zone → Artifact
- **id**: `zc-{zone_id}-{artifact_node_id}` (e.g., `"zc-p01-a-p01-art0"`)
- **source**: zone id, **target**: artifact node id
- **dataType**: `"output"`

### Zone → Zone (chain)
- **id**: `zl-{src_zone}-{tgt_zone}` (e.g., `"zl-p01-p02"`)
- **source**: previous zone, **target**: next zone
- **dataType**: `"output"`
- Only drawn between consecutive phases that both exist.

---

## 3. Phase Definitions (ZONE_PHASES)

| Prefix | Label                    | Canvas Type | Asset Type     | Phase Group |
|--------|--------------------------|-------------|----------------|-------------|
| p01    | P01 · 选题+钩子          | script      | topic          | research    |
| p02    | P02 · 大纲               | script      | outline        | research    |
| p03    | P03 · 剧本+审计          | script      | script_phase   | story       |
| p04    | P04 · 角色设计           | asset       | character      | story       |
| p05    | P05 · 痛点发现           | script      | script_phase   | story       |
| p06    | P06 · 运镜+终审          | script      | script_phase   | production  |
| p07    | P07 · 视觉+风格化        | asset       | scene          | production  |
| p08    | P08 · 场景选择           | asset       | scene          | production  |
| p09    | P09 · 分镜拆解           | storyboard  | storyboard     | production  |
| p10    | P10 · 语音               | audio       | voice          | post        |
| p11    | P11 · 视频渲染           | video       | video          | post        |
| p12    | P12 · 合成               | video       | clip           | post        |
| p13    | P13 · 交付               | video       | delivery       | post        |

---

## 4. Layout Constants

```
ZONE_X_STEP       = 1300   (lane spacing, matches 9999 data)
ZONE_HEIGHT       = 80
SUMMARY_Y         = 80
SUMMARY_HEIGHT    = 120
SUMMARY_WIDTH     = 260
ART_BASE_Y        = 200
ART_COL_SPACING   = 270    (240 width + 30 gap)
ART_ROW_SPACING   = 290    (260 height + 30 gap)
ART_WIDTH         = 240
ART_HEIGHT        = 260
MAX_COLS          = 4      (artifacts per row before wrap)
```

Position formulas:
- **Zone**: `x = laneIndex * ZONE_X_STEP`, `y = 0`
- **Summary**: `x = laneIndex * ZONE_X_STEP`, `y = 80`
- **Artifact**: `x = baseX + (index % 4) * 270`, `y = 200 + (index // 4) * 290`

---

## 5. Artifact Extraction Algorithm

The core algorithm flattens a phase's JSON output into artifact nodes.

### Input: `result.outputs` (a dict) or a raw JSON file

### Algorithm:
```
for each (key, value) in outputs:
    skip if key in SKIP_KEYS

    if value is a list:
        for each item in value:
            create artifact tagged with output_key = key

    elif value is a dict:
        for each (subKey, subVal) in value:
            skip if subKey in SKIP_KEYS
            if subVal is a list:
                for each item in subVal:
                    create artifact tagged with output_key = subKey
            elif subVal is a string (len > 5):
                create artifact with label="{key} · {subKey}", output_key = subKey

    elif value is a string (len > 5):
        create artifact with output_key = key
```

### SKIP_KEYS (metadata, not content):
```
expert, episode, created_at, skill_version, skill_versions,
methodology_note, type, version, format_note, metadata,
generation_notes, tts_engine, voice_quality_targets,
downstream_consumers, film_title, film_brand,
timeline_structure, snyder_validation, car_as_character, style,
engine, comfyui_url, resolution, total_shots,
total_duration_sec, default_duration_sec
```

### Per-item field extraction (itemToArtifact):

For each list element (dict):
1. **label**: `shot_id || name || label || title || scene_id || id || "{outputKey} item"`
2. **name**: `name || label || title || label`
3. **description**: `description || narrator || narrator_text || visual_description || logline || synopsis`
4. **filePath**: `filePath || filepath || path || audio_path || file_path || video_path || image_path`
5. **thumbnailUrl**: explicit `thumbnailUrl` → `views/crops` dict → if filePath is image
6. **extra fields**: duration_sec, scene_number, shot_id, character_id, view, prompt, score, era, location, mood, camera_movement, shot_type, color_palette, sfx_notes, ltx_prompt, ekonte, filename, level, strata, pain, role, age_range, etc.

---

## 6. File → Phase Mapping for import-from-dir

### JSON filename prefix → phase (longest match wins):
```
p01*.json → p01     p07*.json → p07
p02*.json → p02     p08*.json → p08
p03*.json → p03     p09*.json → p09
p04*.json → p04     p10_voice* → p10, p10* → p10
p05*.json → p05     p11_video* → p11, p11* → p11
p06*.json → p06     p12*.json → p12, p13*.json → p13
```

### Asset directory → phase:
```
scene_images/ → p07    video_clips/  → p11
ref_images/   → p07    P11/          → p11
narration/    → p10    P12_composite/→ p12
audio/        → p10    output/       → p12
voice/        → p10
```

### Filesystem → OSS URL conversion:
```
/data/workspace/kais-aigc-platform/data/oss/X → /oss/X
/oss/X (passthrough)
http(s)://... (passthrough)
other → passthrough (may not render in frontend)
```

---

## 7. canvas_sync.py Reference (for comparison)

The original `canvas_sync.py` produces a **more complex** structure with:
- Phase nodes (`n-{phase_id}`) instead of summary nodes (`sum-{phase_prefix}`)
- Artifact IDs derived from item content (`a-{out_key}-{item_id}`)
- V4 semantic grouping by characterId/sceneId
- Cross-phase reference links
- Provenance-based dependency links
- Thumbnail compression (WebP via PIL/ffmpeg)

The **9999 project** (and this rewrite) uses a **simpler, flatter** approach:
- Summary nodes (`sum-{phase_prefix}`) directly under zones
- Sequential artifact IDs (`a-{phase_prefix}-art{N}`)
- Simple grid layout (4 columns, sequential rows)
- No cross-phase reference links (can be added later)
- No thumbnail compression (filePath/thumbnailUrl passthrough)
