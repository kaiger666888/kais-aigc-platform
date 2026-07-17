# Canvas Node Schema — 管线与画布的结构化字段共同契约

> **版本:** v1.0 | **更新:** 2026-06-28
> **原则:** 每个 pipeline phase 的 expert output schema → canvas node data 字段 → 前端 StructuredFieldPanel 三层对齐。

## 架构概览

```
Expert SKILL.md (定义 output schema)
    ↓ 产出 JSON (管线执行)
Canvas Node Data (data.field → 结构化字段)
    ↓ 读取
StructuredFieldPanel (自动渲染 enum/text/number/bar)
    ↓ 配置来源
constants.ts NODE_SCHEMA (字段定义 + 枚举映射 + 渲染类型)
```

## 节点类型 → Expert 映射

| 节点类型 | 对应 Expert | 主输出 Artifact | Skill 版本 |
|----------|------------|----------------|-----------|
| `script` | screenplay + hook_retention | `script.json` + `hook_design.json` | screenplay v1.1.0 |
| `asset` (role) | character_designer | `character_bible.json` | v2.0.0 |
| `asset` (scene/style) | style_genome + colorist | `style_genome.json` + `color_intent.json` | style_genome v1.0 |
| `storyboard` | cinematographer + continuity_auditor | `shot_intent.json` / `shot_list.json` | cinematographer v3.0 |
| `video` | visual_executor | LTX/Wan/Jimeng I2V output | visual_executor v1.0 |
| `audio` (voice) | audio_pipeline (voicer) | `voice_clips.json` | audio_pipeline v1.0 |
| `audio` (bgm/sfx) | audio_pipeline (composer/foley) | WAV stems + `bgm_cues.json` | audio_pipeline v1.0 |

---

## Storyboard Schema (cinematographer P09)

### 核心镜头意图 (MetadataEditor)

| 字段 | 类型 | 枚举值 | 来源 |
|------|------|--------|------|
| `cameraMovement` | enum | `static` `zoom_in` `zoom_out` `pan_left` `pan_right` `tilt_up` `tilt_down` `dolly` `tracking` | cinematographer §12 camera moves |
| `framing` | enum | `wide` `medium` `close_up` `extreme_close_up` `over_the_shoulder` `aerial` | Mascelli 8-level (简化映射) |
| `composition` | enum | `rule_of_thirds` `centered` `golden_ratio` `symmetrical` `leading_lines` | Arijon composition rules |
| `pacing` | enum | `slow` `medium` `fast` `montage` | editor cut-density |

### 扩展镜头特性 (StructuredFieldPanel)

| 字段 | 类型 | 说明 | 来源 |
|------|------|------|------|
| `timeline` | enum | `1975` `2000` `2025` `dream` `flashback` — 时间线标签 | shot_list.timeline |
| `axisLine` | enum | `L2R` `R2L` `Up` `Down` `neutral` — 180°轴线方向 | cinematographer editor_handoff |
| `emotion` | text | 情感意图描述（如"孤独·等待·神秘"） | shot_list.emotion |
| `audioCue` | text | 声音提示（如"低频环境音+雾气声"） | shot_list.audio_cue |
| `ltxPrompt` | text | 视频生成模型 prompt（英文） | shot_list.ltx_prompt |

### 未映射但存在于 expert 中的字段

| Expert 字段 | 状态 | 说明 |
|------------|------|------|
| `shot_scale` (8级: EWS/WS/FS/MS/MCU/CU/BCU/INSERT) | 合并到 framing | 前端用6级简化枚举 |
| `headroom_pct` | 待实现 | 需 number slider |
| `screen_direction` | 合并到 axisLine | L2R/R2L 覆盖 |
| `30°_rule` | editor 消费 | 不在画布展示 |
| `e_konte` 5-layer | 待实现 | 东方分镜格式，条件触发 |

---

## Script Schema (screenplay P03 + hook_retention P01)

| 字段 | 类型 | 枚举值/格式 | 来源 |
|------|------|------------|------|
| `mcmahonArc` | enum | `Cinderella` `Tragedy` `Man_in_a_Hole` `Icarus` `Rags_to_Riches` `Kafkaesque` `Two_Halves` | McMahon 7 story shapes |
| `genre` | text | 自由文本（如"品牌微电影/家庭情感"） | screenplay |
| `format` | text | 自由文本（如"16:9 horizontal brand film"） | screenplay |
| `totalDuration` | text | 时长（如"3:00"） | screenplay |
| `hookType` | enum | `情感钩` `悬念钩` `冲突钩` `反差钩` `情绪爆点钩` | hook_retention 5-type taxonomy |
| `hookIntensity` | number | 1-5 整数 | hook_retention intensity scale |

### 未映射的 screenplay schema 字段

| Expert 字段 | 状态 | 说明 |
|------------|------|------|
| `emotion_curve.samples[]` | 待实现 | 需折线图组件 |
| `hooks[]` / `payoffs[]` / `cliffhangers[]` | 待实现 | 需 timeline 组件 |
| `value_shifts[]` | 待实现 | McMahon value shift |
| `beat_count` | 待实现 | McKee 3-beat scene |
| `dialogue_density` | 待实现 | 对白密度指标 |

---

## Asset Schema — 角色 (character_designer P04)

| 字段 | 类型 | 枚举值 | 来源 |
|------|------|--------|------|
| `archetype` | enum | `protagonist` `deuteragonist` `antagonist` `mentor` `catalyst` `guardian` `sidekick` `love_interest` `narrator` | character_designer |
| `ageRange` | enum | `child` `teen` `young_adult` `middle_aged` `elderly` `ageless` | character_designer |
| `clipITarget` | text | CLIP-i 一致性目标（如"≤ 0.65"） | cross_character_consistency |

### 未映射的 character schema 字段

| Expert 字段 | 状态 | 说明 |
|------------|------|------|
| `anchors.front/side/back/3quarter` | 通过 filePath/thumbnailUrl 展示 | 4-angle reference |
| `reference_library` | 待实现 | 8+ reference images with strength/angle/purpose |
| `family_resemblance_rules` | 在 description 中 | 家族遗传特征 |
| `l1_anchor_prompt` | 在 prompt 中 | LoRA/IP-Adapter anchor |

---

## Asset Schema — 风格 (style_genome P07)

### 5D Style Vector (bar sliders)

| 字段 | 维度 | 0.0 含义 | 1.0 含义 |
|------|------|---------|---------|
| `style_composition` | 构图 | 居中/浅景深 | 极端不对称/深焦 |
| `style_color` | 色彩 | 低饱和/冷调 | 高饱和/暖调 |
| `style_rhythm` | 节奏 | 慢/长镜头 | 快/碎片化 |
| `style_light` | 光影 | 柔光/平光 | 硬光/高反差 |
| `style_sound` | 声音 | 对白驱动/安静 | 音乐驱动/嘈杂 |

### Colorist 字段 (未映射)

| Expert 字段 | 状态 | 说明 |
|------------|------|------|
| `CxSxZ` 3D encoding | 待实现 | CIELAB 色彩空间 per-shot |
| `core_palettes` | 在 description 中 | 色板列表 |
| `LUT params` (lift/gamma/gain) | 待实现 | 调色参数 |
| 28 core color combos | 待实现 | C01-C28 emotion-color 映射 |

---

## Video Schema (visual_executor P11)

| 字段 | 类型 | 枚举值 | 来源 |
|------|------|--------|------|
| `engine` | enum | `ltx` `wan` `jimeng` `seedance` `runway` `kling` `veo` `sora` | GPU engine registry |
| `resolution` | enum | `360p` `480p` `540p` `720p` `1080p` `512` `1024` | 输出分辨率 |
| `clipModel` | text | CLIP 模型（如"DualCLIPLoader(type=ltxv)"） | engine-specific |
| `duration` | number | 秒 | timeline |
| `murchGrade` | enum | `excellent` `pass` `weak` `fail` | editor Murch Rule of Six |

---

## Audio Schema (audio_pipeline P10)

| 字段 | 类型 | 枚举值 | 来源 |
|------|------|--------|------|
| `audioType` | enum | `voice` `bgm` `sfx` `ambient` `stem` | audio_pipeline |
| `engine` | enum | `indextts2` `cosyvoice` `minimax` `elevenlabs` `edge` `chattts` `acestep` `suno` | TTS/BGM provider matrix |
| `emotion` | enum | `neutral` `happy` `sad` `angry` `fearful` `surprised` `contempt` `tender` `nostalgic` `determined` | Ekman 7 + extensions |
| `speaker` | text | 说话人/声线 | voice_character_mapping |
| `duration` | number | 秒 | voice_timeline |

---

## 扩展路线图

### Priority 1 — 高频使用
- [ ] Emotion Curve 折线图组件 (screenplay)
- [ ] Hooks/Payoffs/Cliffhangers timeline (hook_retention → screenplay)
- [ ] Character 4-angle 展示器 (character_designer anchors)

### Priority 2 — 审美增强
- [ ] 5D Style Radar Chart (style_genome)
- [ ] Color Palette 渲染器 (colorist CxSxZ)
- [ ] Murch Rule of Six 雷达图 (editor)

### Priority 3 — 高级功能
- [ ] E-Konte 5-layer 分镜标注 (条件触发)
- [ ] AI Score 5维评分卡 (compliance_gate)
- [ ] Emotion-to-Color 实时映射 (colorist + screenplay)
- [ ] Variant Group 候选对比 (visual_executor)

---

## 实现文件索引

| 文件 | 作用 |
|------|------|
| `packages/infinite-canvas/src/constants.ts` | NODE_SCHEMA + 所有枚举映射 |
| `packages/infinite-canvas/src/components/StructuredFieldPanel.tsx` | 通用结构化字段渲染+编辑 |
| `packages/infinite-canvas/src/components/NodeDetailPanel.tsx` | 各节点 Detail 组件集成 StructuredFieldPanel |
| `packages/infinite-canvas/src/types/canvas.ts` | TypeScript 类型定义 |
