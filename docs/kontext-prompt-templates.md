# Flux Kontext Prompt 模板

## 角色锚定描述（Character Anchor）
每次生成都应包含，确保角色一致性：

```
short black bob hair with silver barrette on right side, oval face, high cheekbones, soft jawline, warm brown almond-shaped eyes with slight cat-eye tilt, thin arched black eyebrows, straight narrow nose, full lips with cupid's bow, fair cool-toned skin with subtle pink undertones, small beauty mark on left cheek near jawline, small silver cross earring on right ear
```

## 服装锚定描述（可选，根据场景选择）

### 默认造型（edgy streetwear）
```
black oversized hoodie with strappy cutout collar detail, black lace-up choker, black chunky platform boots with side zippers
```

### 休闲白T
```
white casual t-shirt, black shorts, minimal silver rings
```

### 赛博朋克
```
black oversized hoodie, black lace-up choker, black chunky boots, standing in neon-lit cyberpunk street at night
```

## 场景模板

### Studio 白底（证件照风格）
```
a photo of a woman, [CHARACTER_ANCHOR], [OUTFIT], [EXPRESSION], looking at camera, white background, studio lighting, high quality portrait, 8k uhd
```

### 街拍/户外
```
a photo of a woman, [CHARACTER_ANCHOR], [OUTFIT], [EXPRESSION], [SCENE_DESCRIPTION], natural lighting, candid photography, shallow depth of field
```

### 电影场景
```
a cinematic shot of a woman, [CHARACTER_ANCHOR], [OUTFIT], [EXPRESSION], [SCENE_DESCRIPTION], dramatic lighting, film grain, anamorphic lens
```

## 表情变体

| 表达 | Prompt 片段 |
|------|-----------|
| 中性 | neutral expression, calm direct gaze |
| 微笑 | gentle smile, warm expression, relaxed |
| 大笑 | big happy smile showing teeth, joyful expression |
| 愤怒 | angry fierce expression, furrowed brows, intense narrowed gaze |
| 忧郁 | melancholy expression, downcast eyes, somber mood |
| 惊讶 | surprised expression, slightly open mouth, wide eyes |
| 思考 | thoughtful expression, looking away, contemplative |

## 角度变体

| 角度 | Prompt 片段 |
|------|-----------|
| 正面 | front view, looking directly at camera |
| 左45° | three-quarter view from left |
| 右45° | three-quarter view from right |
| 左90°侧脸 | left side profile view, 90 degree |
| 右90°侧脸 | right side profile view, 90 degree |
| 仰视 | low angle shot, looking up, chin tilted upward |
| 俯视 | high angle shot, looking down, chin tilted downward |
| 背面 | from behind, showing back of head and short black hair |

## 完整示例

### 示例1: 微笑证件照
```
a photo of a woman, short black bob hair with silver barrette on right side, oval face, high cheekbones, warm brown almond-shaped eyes, thin arched eyebrows, straight nose, full lips with cupid's bow, fair cool-toned skin, small beauty mark on left cheek, small silver cross earring, black lace-up choker, gentle smile showing teeth, warm expression, front view, looking at camera, white background, studio lighting, high quality portrait
```

### 示例2: 赛博朋克街头
```
a cinematic shot of a woman, short black bob hair with silver barrette on right side, oval face, high cheekbones, warm brown almond-shaped eyes, thin arched eyebrows, fair cool-toned skin, small beauty mark on left cheek, small silver cross earring, black oversized hoodie with strappy cutout collar, black lace-up choker, black chunky platform boots, intense gaze, standing in neon-lit cyberpunk street at night, rain reflections on wet pavement, dramatic lighting, film grain
```

### 示例3: 阳光公园
```
a photo of a woman, short black bob hair with silver barrette on right side, oval face, high cheekbones, warm brown almond-shaped eyes, thin arched eyebrows, fair cool-toned skin, small beauty mark on left cheek, small silver cross earring, white casual t-shirt, gentle smile, relaxed expression, sunny park with green trees, golden hour warm lighting, bokeh background, candid photography
```

## Kontext 生成参数建议

| 参数 | 推荐值 | 说明 |
|------|-------|------|
| steps | 28 | 平衡质量和速度 |
| guidance | 3.5 | Kontext 推荐，不要太低（细节丢失）也不要太高（过度饱和） |
| width | 1024 | 正方形最佳（Kontext 设计用于正方形参考） |
| height | 1024 | 同上 |
| seed | 随机 | 每次不同 |
