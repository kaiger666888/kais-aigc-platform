# SeedVR2 超分放大引擎集成

kais-aigc-platform 集成字节跳动 SeedVR2 扩散超分模型，支持单图与视频的高质量放大（4K/8K）、时序一致性处理、低质量素材修复。引擎基于 numz 的 `ComfyUI-SeedVR2_VideoUpscaler` ComfyUI 节点包，运行在 `comfyui-primary` 容器（RTX 3090, 24GB）。

## 与现有 enhance 路由的差异

| 维度 | `/api/production/postprocess/enhance` | `/api/production/postprocess/seedvr2` |
|------|---------------------------------------|---------------------------------------|
| 超分原理 | CNN（UltraSharp / RealESRGAN） | 扩散模型（DAPT 单步） |
| 输入 | 仅图片 | 图片 + 视频 |
| 时序一致性 | 无 | 有（视频帧间稳定） |
| 细节生成 | 复用原图纹理 | 可生成新细节（denoise 控制） |
| 显存占用 | 低（<4GB） | 高（7B FP16 ~16GB） |
| 速度 | 快 | 慢（扩散推理） |
| 最佳场景 | 含文字图、保守放大 | 老视频修复、AI 绘画放大、低质素材救星 |

## 模型放置

### 目录约定

numz 节点扫描 **统一的** `models/SEEDVR2/` 子目录（**不是** `diffusion_models/` 或 `vae/`），DiT 和 VAE 都放在同一目录下。

- 主机路径：`/data/models/comfyui/SEEDVR2/`
- 容器路径：`/root/ComfyUI/models/SEEDVR2/`（通过 `docker-compose.v9.yml` 挂载为 rw）

### 下载模型

```bash
# 推荐：7B FP16 完整版（~14GB），3090 24GB 首选
./scripts/download-seedvr2-models.sh

# 备选：sharp 变体（更锐利）
./scripts/download-seedvr2-models.sh --sharp

# 显存紧张：FP8 量化版（~7GB）
./scripts/download-seedvr2-models.sh --fp8

# 速度优先：3B 轻量版（~6GB）
./scripts/download-seedvr2-models.sh --3b

# 国内镜像加速
HF_ENDPOINT=https://hf-mirror.com ./scripts/download-seedvr2-models.sh
```

### 模型变体对照

| 文件 | 参数量 | 精度 | 大小 | 适用场景 |
|------|--------|------|------|----------|
| `seedvr2_ema_7b_fp16.safetensors` | 7B | FP16 | ~14GB | **3090 24GB 首选**，质量最佳 |
| `seedvr2_ema_7b_sharp_fp16.safetensors` | 7B | FP16 | ~14GB | 锐化版，细节更锐利 |
| `seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors` | 7B | FP8 | ~7GB | 12-16GB 显存可用 |
| `seedvr2_ema_3b_fp16.safetensors` | 3B | FP16 | ~6GB | 速度更快，质量略低 |
| `seedvr2_ema_3b_fp8_e4m3fn.safetensors` | 3B | FP8 | ~3GB | 8GB 显存可跑 |
| `seedvr2_ema_7b-Q4_K_M.gguf` / `seedvr2_ema_7b-Q8_0.gguf` | — | GGUF | 2-4GB | 量化，仅救急 |
| `ema_vae_fp16.safetensors` | — | FP16 | ~300MB-1GB | VAE（必须，所有变体共用） |

## API 使用

### 端点

```
POST /api/production/postprocess/seedvr2
```

### 请求（multipart/form-data）

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `file` | File | *必填* | 图片（png/jpg/webp/bmp）或视频（mp4/webm/mov/mkv） |
| `mode` | string | 按 MIME 自动判断 | `image` 或 `video` |
| `model` | string | `seedvr2_ema_7b_fp16.safetensors` | DiT 模型文件名 |
| `resolution` | int | 1080 | 目标短边像素（自动保持长宽比） |
| `maxResolution` | int | 1920 | 长边上限，防极端长宽比爆显存 |
| `batchSize` | int | 21（video）/ 1（image） | **必须 4n+1**：1, 5, 9, 13, 17, 21... |
| `temporalOverlap` | int | 4 | 视频批次重叠帧（0-16），消除接缝 |
| `uniformBatchSize` | bool | false | 末批填充至 batch_size |
| `colorCorrection` | string | `lab` | `lab`/`wavelet`/`wavelet_adaptive`/`hsv`/`adain`/`none` |
| `frameRate` | number | 自动探测 | 仅视频；不传则用 ffprobe 读源视频 |
| `device` | string | `cuda:0` | `cuda:0` 或 `cuda:1` |
| `blocksToSwap` | int | 0 | 0-36；显存不足时配合 `offloadDevice=cpu` 使用 |
| `encodeTiled` | bool | false | VAE 编码分块（处理 4K+ 时打开） |
| `decodeTiled` | bool | false | VAE 解码分块 |
| `seed` | int | 42 | 复现性种子 |
| `filenamePrefix` | string | `seedvr2_<mode>_<ts>` | 输出文件名前缀 |

### 响应

```json
{
  "code": 200,
  "data": {
    "promptId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "status": "pending",
    "mode": "image",
    "inputFilename": "uuid.png",
    "filenamePrefix": "seedvr2_image_1737000000000",
    "model": "seedvr2_ema_7b_fp16.safetensors",
    "resolution": 1080,
    "message": "SeedVR2 image upscale submitted"
  }
}
```

### 状态查询（复用现有 status 路由）

```
GET /api/production/postprocess/status?promptId=<promptId>
```

返回结构同 `enhance`：`status` 为 `pending` / `running` / `done`，`done` 时附带 `images[]`（含 `url`、`filename`、`width`、`height`）。视频的 `url` 在 `images` 数组中包含 VHS 输出的 `filename`。

## 示例

### 单图超分（1080→1440）

```bash
curl -X POST http://localhost:8000/api/production/postprocess/seedvr2 \
  -F "file=@input.png" \
  -F "mode=image" \
  -F "resolution=1440" \
  -F "colorCorrection=lab"
```

### 视频超分（720p→1080p）

```bash
curl -X POST http://localhost:8000/api/production/postprocess/seedvr2 \
  -F "file=@input.mp4" \
  -F "mode=video" \
  -F "resolution=1080" \
  -F "batchSize=21" \
  -F "temporalOverlap=4"

# 轮询状态
curl "http://localhost:8000/api/production/postprocess/status?promptId=<id>"
```

### 低质量素材救星（先降采样再放大）

老视频压缩严重时，先用 ffmpeg 降采样去块，再交给 SeedVR2：

```bash
ffmpeg -i noisy.mp4 -vf "scale=iw*0.5:ih*0.5" downscaled.mp4

curl -X POST http://localhost:8000/api/production/postprocess/seedvr2 \
  -F "file=@downscaled.mp4" \
  -F "resolution=1080"
```

## RTX 3090 24GB 推荐参数

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| `model` | `seedvr2_ema_7b_fp16.safetensors` | 完整精度，质量最佳 |
| `blocksToSwap` | 0 | 24GB 不需要 offload |
| `encodeTiled` / `decodeTiled` | false | 4K 以下无需分块 |
| `resolution` | 1080 / 1440 / 2160 | 目标短边 |
| `maxResolution` | 1920 / 2560 | 防极端长宽比爆显存 |
| `batchSize`（视频） | 21 | 4n+1，1080p 稳定 |
| `temporalOverlap` | 4 | 消除批次间接缝 |
| `colorCorrection` | `lab` | 修正扩散色偏 |
| `device` | `cuda:0` | 3090 主 GPU |

## 关键参数说明

### batchSize（视频）— 必须遵守 4n+1

合法值：1, 5, 9, 13, 17, 21, 25...（脚本内会自动对齐到最近的 4n+1）

- **越大**：时序一致性越好，吞吐越高，但显存占用越大
- **越小**：显存友好，但可能在批次边界出现闪烁
- **24GB 处理 1080p**：21 是甜点

### temporalOverlap

批次间重叠帧数（0-16）。视频被切分为多个批次处理时，重叠帧通过 blending 消除可见接缝。建议 4；闪烁严重时调到 8。

### colorCorrection

扩散过程可能引起色偏，节点内置 5 种校正算法：

- **`lab`**（推荐）：感知色彩匹配，保留细节
- **`wavelet`**：频域自然色，保留高频细节
- **`wavelet_adaptive`**：wavelet + 自适应饱和度修正
- **`hsv`**：色相条件饱和度匹配
- **`adain`**：统计风格迁移
- **`none`**：不校正

### blocksToSwap + offloadDevice（OOM 救命）

显存不足时的逃生通道。注意路由不直接暴露 `offloadDevice`，默认 `none`；要启用 offload，必须在路由代码层传 `blocksToSwap>0`，并在 `seedvr2Workflow.ts` 中改 `offloadDevice` 为 `cpu`。

| 场景 | blocksToSwap | offloadDevice | 速度影响 |
|------|--------------|---------------|----------|
| 24GB 稳跑 | 0 | none | 最快 |
| 16GB 紧张 | 8 | cpu | 慢 ~30% |
| 12GB 极限 | 16 | cpu | 慢 ~100% |

## 常见问题

### Q: OOM / CUDA out of memory

1. 降 `batchSize`（视频）：21 → 13 → 9 → 5
2. 降 `resolution`：2160 → 1440 → 1080
3. 开 `encodeTiled=true` + `decodeTiled=true`
4. 换 FP8 模型：`model=seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors`
5. 最终兜底：路由代码层加 `blocksToSwap=8` + `offloadDevice=cpu`

### Q: 视频闪烁/时序不一致

1. 确认 `batchSize` 是 4n+1（21、17、13...），不是偶数
2. 增大 `temporalOverlap`（4 → 8）
3. 开 `uniformBatchSize=true`（末批填充）

### Q: 含文字的图被 AI 改掉

SeedVR2 是扩散模型，对文字保真度不如 CNN 超分。含文字图请走 `/api/production/postprocess/enhance?steps=ultrasharp`。

### Q: 处理速度很慢

1. 确认 `blocksToSwap=0`（不为 0 会大幅变慢）
2. 确认 `model` 不是 GGUF 量化版（量化版慢且质量差）
3. 长视频考虑分段处理后用 ffmpeg 拼接

### Q: 节点 search 不到

ComfyUI-SeedVR2_VideoUpscaler 已预装在 `comfyui-primary` 容器的 `/root/ComfyUI/custom_nodes/` 下，重启容器即可：`docker compose -f docker-compose.v9.yml restart comfyui-primary`。

### Q: 路由 404

确认 `kais-gold-team` 容器已加载新路由：

```bash
docker compose -f docker-compose.v9.yml restart kais-gold-team
docker logs kais-gold-team 2>&1 | grep -i "seedvr2\|listening"
```

## 相关文件

| 文件 | 作用 |
|------|------|
| `src/routes/production/postprocess/seedvr2.ts` | 路由实现 |
| `src/routes/production/postprocess/_shared/seedvr2Workflow.ts` | ComfyUI workflow 构建器 |
| `src/routes/production/postprocess/_shared/config.ts` | 模型与默认值常量 |
| `src/router.ts` | 路由注册（搜 `route134`） |
| `scripts/download-seedvr2-models.sh` | 模型下载脚本 |
| `/data/models/comfyui/SEEDVR2/` | 模型存储目录 |

## 双 GPU 利用（高级）

RTX 3090 (cuda:0) + RTX 3060Ti (cuda:1) 可分别承担 DiT 与 VAE：

- `device=cuda:1`（VAE on 3060Ti）+ `offloadDevice=cuda:0`（DiT 在 3090）

但路由当前未暴露 VAE 独立设备选项。如需启用，修改 `seedvr2Workflow.ts` 的 `addLoaders()`，把 VAE 设备从 `opts.device` 改为独立参数。

## 技术背景

- **SeedVR2**：ByteDance-Seed 的视频超分扩散模型，使用 DAPT（Diffusion Adversarial Post-Training）实现单步推理
- **numz 包**：社区 ComfyUI 封装，将原版推理代码改造为节点，统一处理图像（batch=1）和视频
- **单步扩散**：`steps` 固定为 1（节点内部处理），API 不暴露。设多步不会提升质量
- **节点源码**：`/root/ComfyUI/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler/`（容器内）
