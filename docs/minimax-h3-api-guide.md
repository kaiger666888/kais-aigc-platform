# MiniMax H3 API 使用手册

> 适用于 kais-aigc-platform 内置的 MiniMax H3 视频生成引擎。
> H3 生成带**原生立体声音频**的视频，一个 forward pass 出视频+音频。

## 端点列表

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/production/minimax-h3/t2va` | POST | 纯文本 → 视频+音频 |
| `/api/production/minimax-h3/i2va` | POST | 首帧/尾帧 → 视频+音频 |
| `/api/production/minimax-h3/ref2va` | POST | 参考图/视频/音频 → 视频+音频 |
| `/api/production/minimax-h3/status/:promptId` | GET | 轮询任务状态 |

## 四种模式选择

| 场景 | 端点 | 模式 | 何时使用 |
|---|---|---|---|
| 纯文本描述 → 视频 | `/t2va` | T2VA | 无参考图 |
| 一张图 → 视频 | `/i2va` (firstFrame) | I2VA | 从首帧生成后续动作 |
| 尾帧 → 视频 | `/i2va` (lastFrame) | L2VA | 推导前因，落在尾帧 |
| 首尾帧 → 视频 | `/i2va` (both) | FL2VA | 首尾帧间插值 |
| 角色锁定/视频编辑 | `/ref2va` | Ref2VA | 用参考图/视频/音频控制角色身份、风格、声音 |

## 固化参数（不可变更）

以下参数来自官方源码，**任何修改都会破坏模型**：

| 参数 | 值 | 说明 |
|---|---|---|
| FPS | 24 | 帧率固定 |
| 音频采样率 | 32 kHz | 立体声 |
| CFG | 1.0 | CFG-distilled 模型，必须 1.0 |
| 画布倍数 | 32 | 宽高必须 32 倍数 |
| 短边基准 | 768px | 分辨率短边 |
| 最大面积 | 768×1344 | 面积上限 |
| 帧数网格 | n%17==5 | 帧数必须满足此约束 |

## 可变参数（有默认值，可覆盖）

| 参数 | T2V/I2V 默认 | R2V 默认 | 说明 |
|---|---|---|---|
| steps | 50 | 20 | 官方 lossless/R2V 模板推荐 |
| sampler | euler | res_multistep | ⚠️ R2V 必须用 res_multistep |
| scheduler | simple | simple | |
| shiftVideo | 12.0 | 12.0 | ⚠️ 不建议变更 |
| shiftAudio | 3.0 | 3.0 | ⚠️ 不建议变更 |

## 分辨率预设

| 比例 | 尺寸 | 适用 |
|---|---|---|
| 16:9 | 1344×768 | 横屏（默认） |
| 9:16 | 768×1344 | 竖屏（短剧） |
| 1:1 | 768×768 | 方形 |
| 4:3 | 1024×768 | 传统 |
| 3:4 | 768×1024 | 竖屏 4:3 |
| 21:9 | 1344×576 | 超宽 |

## 时长→帧数预设

| 时长 | 帧数 |
|---|---|
| 4s | 101 |
| 5s | 124（默认） |
| 6s | 141 |
| 8s | 175 |
| 10s | 229 |
| 12s | 292 |
| 15s | 362 |

## T2VA 接口

### 请求

```bash
curl -X POST http://localhost:10588/api/production/minimax-h3/t2va \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": 1,
    "prompt": "integrated_multimodal_description: [Shot 1] Cinematic...\noverall_soundscape: ...\nnon_diegetic_music: ...",
    "aspectRatio": "16:9",
    "duration": 5,
    "seed": 42
  }'
```

### 入参

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `prompt` | string | ✅ | — | 结构化三字段 prompt |
| `projectId` | number | ✅ | — | |
| `aspectRatio` | string | | "16:9" | "16:9"/"9:16"/"1:1"/"4:3"/"3:4"/"21:9" |
| `duration` | number | | 5 | 秒 (4-15) |
| `width` | number | | 1344 | 直接指定（覆盖 aspectRatio） |
| `height` | number | | 768 | 直接指定（覆盖 aspectRatio） |
| `length` | number | | 124 | 帧数（覆盖 duration） |
| `seed` | number | | random | |
| `steps` | number | | 50 | |
| `shiftVideo` | number | | 12.0 | ⚠️ 不建议变更 |
| `shiftAudio` | number | | 3.0 | |
| `negativePrompt` | string | | 默认负面词 | cfg=1.0 实际不生效 |
| `filenamePrefix` | string | | auto | |

## I2VA 接口

### 请求

```bash
curl -X POST http://localhost:10588/api/production/minimax-h3/i2va \
  -F "projectId=1" \
  -F "prompt=For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nintegrated_multimodal_description: ..." \
  -F "firstFrame=@character_scene.png" \
  -F "aspectRatio=auto" \
  -F "duration=8"
```

### 模式自动判定

| 输入 | 模式 | 说明 |
|---|---|---|
| 仅 firstFrame | I2VA | 首帧→视频 |
| 仅 lastFrame | L2VA | 尾帧→视频 |
| 两者都有 | FL2VA | 首尾帧→视频 |
| 都没有 | 400 | 引导使用 /t2va |

### 入参

同 T2VA，额外：

| 参数 | 类型 | 说明 |
|---|---|---|
| `firstFrame` | File | 首帧图（multipart） |
| `lastFrame` | File | 尾帧图（multipart） |
| `aspectRatio` | "auto" | 跟随首帧比例自动适配 |

## Ref2VA 接口

### 请求

```bash
curl -X POST http://localhost:10588/api/production/minimax-h3/ref2va \
  -F "projectId=1" \
  -F "prompt=subject_definitions:\n<Subject 1> is...\n\nsummary:\n[reference generation]..." \
  -F "refImages=@turnaround_char1.png" \
  -F "refImages=@turnaround_char2.png" \
  -F "refAudios=@voice_sample.mp3" \
  -F "refImageSize=match" \
  -F "duration=5"
```

### 入参

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `refImages` | File[] | ✅ | 1-9 张参考图 |
| `refVideos` | File[] | | 0-3 个参考视频（帧序列） |
| `refVideoAudios` | File[] | | 0-3 个视频配对音轨 |
| `refAudios` | File[] | | 0-3 个独立参考音频 |
| `refImageSize` | "match"/"max" | | match=缩到生成分辨率（快），max=2048px（保真好但慢数倍） |
| 总文件数 | | | ≤ 12 |

## Status 轮询

```bash
# 提交后返回 pollUrl
GET /api/production/minimax-h3/status/:promptId
```

### 响应状态

| status | 说明 |
|---|---|
| `queued` | 排队中 |
| `executing` | 执行中 |
| `success` | 完成，outputs 含输出文件 |
| `error` | 失败 |

## Prompt 结构化编写

### 三字段格式（必须）

```
integrated_multimodal_description: [Shot 1] 描述视觉、动作、运镜、对话...

overall_soundscape: 环境音描述（1-4句）

non_diegetic_music: 非叙事 BGM 描述（1-3句，无则 N/A）
```

### 对话标记

```
The woman (S1) says: <d>[Chinese] 你好世界。</d>
```

### 运镜表达

```
The camera pushes in with small amplitude at slow speed toward the subject.
```

| 类型 | 值 |
|---|---|
| 运镜 | Push In/Out, Pan L/R, Truck L/R, Tilt Up/Down, Arc, Tracking, Static, Shake, POV |
| 幅度 | with small/large amplitude |
| 速度 | at slow/fast speed |

### I2VA/FL2VA 指令行

```
# I2VA:
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

# FL2VA:
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
```

### Ref2VA 六节结构

```
subject_definitions:
<Subject 1> is the character in <Picture 1>...
<Video 1> is the source video...
<Audio 1> is the voice reference...

summary:
[reference generation] The target video...

retention_analysis:
<Subject 1>: fully_preserved - ...
<Audio 1>: reference - ...

detailed_description:
The target video is in... [Shot 1]...

overall_soundscape: ...

non_diegetic_music: ...
```

## 注意事项

1. **shiftVideo 不要降！** 低于 12.0 会导致帧间像素微漂移（水流波动）
2. **R2V 用 res_multistep 采样器**，不是 euler
3. **R2V 用 ref2vaModel**，不是 fl2vaModel
4. **cfg 必须为 1.0**（CFG-distilled）
5. **帧数自动 snap** 到 n%17==5 网格
6. **首帧拉伸，尾帧 center-crop**（源码行为）
7. **BGM 去除**：正面 prompt 加 `strictly diegetic in-world sound, unscored scene, no scored music`
8. **竖屏短剧**：aspectRatio="9:16"，输出 768×1344
