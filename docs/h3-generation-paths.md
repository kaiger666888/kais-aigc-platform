# MiniMax H3 视频生成路径全景 + KMC 分用途契约

> 2026-08-14 深度调研定稿;**2026-08-17 API 精简更新**(白名单/动态路由/tts-only 混音,见 §3/§6)。
> 真源:`src/routes/production/minimax-h3/config.ts`(模型/profile/useCase)。
> 本文回答三个问题:① KAP 里 H3 有几种生成路径;② 每条路径用了什么工作流/插件/LoRA;③ API 层如何分用途暴露给 KMC。

## 0. 一句话答案

**4 种核心生成拓扑 + 1 种独立二采重绘放大 + 1 条音频后处理轴**,固化成 **8 个 profile 档位**,
通过 **2 种接入模式**暴露,**3 种输入 mode** 复用。底层是同一个模型(MiniMax H3,单 forward
出视频+原生立体声音频)。

- **拓扑层(工作流级)**:T8 插件链 / Native KSampler 链 / LightX2V LoRA 链 / LineartAnime LoRA 链 = **4**。
- **档位层**:`H3_PROFILES` 8 档(见 §3)。
- **2026-08-17 API 精简**:暴露面收窄到白名单 **2 profile(`turbo`/`native-sage`)× 2 useCase
  (`preview-lock`/`final-shot`)**,其余档位定义保留但 POST 一律 400;新增 `GET /workflows`
  能力清单端点。KMC 已同步迁移到 useCase 入口。

## 1. 底层模型与固化约束

| 项 | 值 |
|---|---|
| 模型 | MiniMax H3,单 forward 出 video + audio |
| CFG | **1.0**(CFG-distilled,不可改;负面提示词不生效) |
| FPS / 音频 | 24 fps;32 kHz 立体声 |
| 画布 | 宽高须 ×32,短边基准 768,面积上限 768×1344 |
| 帧数网格 | `n % 17 == 5`(4s=101 / 5s=124 / … / 15s=362) |
| 统一权重 | `minimax_h3_fl2va_int8_convrot.safetensors`(32GB,**非剪枝** INT8+ConvRot,全 task_type) |

> 关键决策(config.ts:26-29):**砍掉了独立的 pruned ref2va 权重** —— 剪枝 ref2va int8 无法
> 完整施加 Turbo LoRA。`REF2VA_MODEL` 仅为向后兼容别名,指向同一文件。
> 例外:`workflows/h3-redraw-upscale/` 工具仍用 pruned ref2va(20GB,省显存,不走 LoRA)。

配套权重(磁盘 `/data/models/comfyui/`):
- Text encoder:`qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`(15GB,Qwen3-VL 32B NVFP4+AWQ)
- VAE:`minimax_h3_video_vae_fp16.safetensors`(4.9GB)+ `minimax_h3_audio_vae_fp32.safetensors`(578MB)

## 2. 接入层:两种 access pattern

```
                       ┌─ POST /t2va   (async, fire-and-poll)
POST /api/production/  ┼─ POST /i2va   (async)          ──→ 仅 T8 + Native 两拓扑
  minimax-h3/          ┼─ POST /ref2va (async)                无 LightX2V/LineartAnime
                       └─ POST /generate (sync, ≤45min) ──→ 全 8 档 + 串 LTX Foley 音频管线
   GET /status/:promptId  ← 所有 async 路径的轮询口
```

| 模式 | 文件 | 行为 | 支持拓扑 |
|---|---|---|---|
| 薄异步路由 | `t2va.ts`/`i2va.ts`/`ref2va.ts` | POST 进 ComfyUI 立即返回 `promptId`+`pollUrl` | T8、Native |
| 同步编排器 | `generate.ts` | 3 步同步管线(见下),返回成品 mp4 | **全部 8 档** |

`generate.ts` 三步管线:
1. **Step 1** H3 视频生成(按 `mode` + `profile` 选拓扑)→ 轮询 ≤15min → 下载 mp4
2. **Step 2** LTX Foley 环境音(`buildLtxAmbientWorkflow`,复用自 replace-audio.ts)+
   BGM FFT 检测 + 换 seed 重试(≤2 次)
3. **Step 3** 合并:TTS(loudnorm I=-16)+ ambient(I=-24)amix → 合回 H3 原分辨率视频

> 注意:`generate.ts` **不调用**另外三个路由 —— 三套 H3 拓扑内联重写了一份(拓扑与源文件一致),
> 仅复用 replace-audio.ts 的音频辅助函数。`skipFoley=true` 的档位在 Step 1 后直接返回(跳过 2/3)。

`replace-audio.ts` 是独立的音频替换端点(LTX-2.3 dev int8 + Foley LoRA,`SolidMask=0` 冻结视频
latent 只采样音频,cfg 2.05 / `euler_ancestral_cfg_pp` / 30 步 / 固定 1280×704)。

## 3. 八档 profile × 拓扑矩阵(2026-08-17 起分「暴露/内部」两层)

**暴露层(白名单 `H3_EXPOSED_PROFILES`,POST 可用,GET /workflows 可见):**

| # | profile | 拓扑 | 步数 | LoRA | Foley | 定位 |
|---|---|---|---|---|---|---|
| 2 | `turbo` ✅ | T8 | 动态 4/8(getTurboSteps) | T8 Turbo(EMA) | 按 useCase(preview-lock=tts-only) | 预览主力 |
| 5 | `native-sage` ✅ | Native | t2v/i2v 50 / ref2v 20(useCase 可固化 15/36) | — | 按 useCase(preview-high=tts-only,final-shot=full) | 预览高动态 + 成片 |

**内部层(定义保留在 `H3_PROFILES`,POST 传它们 400;重新开放 = 改 `H3_EXPOSED_PROFILES`):**

| # | profile | 拓扑 | 步数 | LoRA | Foley | 定位 | 时长 |
|---|---|---|---|---|---|---|---|
| 1 | `preview` 🔒 | T8 | 15 | — | skip | 最快有质预览(被 turbo 取代) | ~6min |
| 3 | `production` 🔒 | T8 | 50 | — | full | 最高画质+完整音频管线 | ~20min |
| 4 | `native` 🔒 | Native | t2v/i2v 50 / ref2v 20 | — | full | 原生链+TESpeed 节点(有质量损失风险) | — |
| 6 | `lightx2v-4` 🔒 | LightX2V | 5(4+1) | LightX2V v1.0 768p | skip | shift=6 | ~72s |
| 7 | `lightx2v-8` 🔒 | LightX2V | 9(8+1) | LightX2V v1.0 544p | skip | shift=12,步数多画质更高 | ~120s |
| 8 | `lineart-anime` 🔒 | LineartAnime | 20 | LineartAnime | skip | 线稿→彩色动漫,仅 ref2va | — |

动态自适应步数(`getTurboSteps`,motion 参数;2026-08-17 调整):low=站立/对白/慢速→4;
medium=拥抱/行走→**8**(原 4,实测中动态偏软);high=追逐/赛车/打斗→8(直调 turbo 时)。
preview-lock useCase 下 high 不走 turbo,跳拓扑到 native-sage 15 步(见 §6 路由表)。

## 4. 每条路径的工作流 / 节点 / LoRA

### 4.1 T8 拓扑(`preview`/`turbo`/`production`)
插件 **`minimax-h3-audio-T8`**(14 节点,`comfyui-minimax-h3-audio-T8` @ T8mars):
- `MiniMaxH3AudioConditioningT8`(node 20,`task_type="auto"` 自动判 t2va/i2va/fl2va/l2va/ref2va/hybrid)
- `MiniMaxH3DualClockSamplerT8`(node 30,Dual-Clock Euler,内置 12/3 shift + flow sigma 网格;
  修复原生 KSampler 低步数音频白噪 bug;**外部 sampler/scheduler 在 T8 下不生效**)
- `MiniMaxH3AVDecodeT8`(node 40,联合 AV latent 解码)
- 加 `turbo` 时插 `LoraLoaderBypassModelOnly`(node 14;**INT8 量化模型必须用 Bypass 不合并**)
  挂 T8 Turbo LoRA,strength 1.0

构建器:`generate.ts` `buildH3WorkflowT8`(mode 参数化);薄路由各有 `buildH3T2va/I2va/Ref2vaWorkflowT8`。

### 4.2 Native 拓扑(`native`/`native-sage`)
原生 ComfyUI MiniMax H3 节点链:
- `MiniMaxH3ImageToVideo`(node 20 正 / 16 负)/ `MiniMaxH3ReferenceToVideo`(ref2va)
- `MiniMaxH3SigmaShift`(node 21,shift_video 12 / shift_audio 3)
- `TESpeedMiniMaxH3`(node 35,仅 `native` 档;残差缓存 -42% wall-clock)
- `KSampler`(sampler `euler`(t2v/i2v)或 `res_multistep`(ref2v),scheduler `normal`)
- `VAEDecode` + `VAEDecodeAudio` + `CreateVideo` + `SaveVideo`

### 4.3 LightX2V 拓扑(`lightx2v-4`/`lightx2v-8`)
**与 T8 完全独立**,不用 T8 节点也不用 T8 Turbo LoRA:
- `MiniMaxH3SigmaShift`(node "14_shift",字符串 ID 避让 LoadImage 的 14)
- `LoraLoaderModelOnly`(node 15,**bf16 全幅 LoRA 用合并式而非 Bypass**)
- `KSamplerSelect` + `BasicScheduler`(simple) + `RandomNoise` + `BasicGuider` + `SamplerCustomAdvanced`
- 4-step 变体 shift_video **6.0**(768p 训练);8-step 变体 shift_video 12.0(544p)

构建器:`generate.ts` `buildH3WorkflowLightX2V`。薄路由**不支持**此拓扑。

### 4.4 LineartAnime 拓扑
复用 4.3 的壳 + LineartAnime LoRA + `LoadVideo`(60)+ `GetVideoComponents`(61)把线稿参考视频
注入 `ref_videos.ref_video_0`。仅 ref2va。

### 4.5 二采重绘放大(独立工具,未接入 /generate)
`workflows/h3-redraw-upscale/`。两采样器 pass:pass1 低分辨率全去噪 →
`MiniMaxH3LatentUpscaleCombined` 空间放大+重噪 → pass2 高分辨率低去噪(0.35)重绘。
H3 的 latent 是 packed NestedTensor AV latent,标准 `LatentUpscaleBy`/`AddNoise` 会损坏,故需专用节点。
用 pruned ref2va 20GB 权重。详见该目录 README。

### 4.6 音频后处理轴(replace-audio / generate Step2-3)
LTX-2.3 全栈(非 H3):`ltx-2.3-22b-dev_transformer_only_int8_convrot.safetensors` +
Foley LoRA `ltx-2.3-foley-400-steps.safetensors`(`LTX2LoraLoaderAdvanced` video=0/video_to_audio=1/audio=1)。

## 5. 插件清单(comfyui-primary @ 3090)

| 插件 | 关键节点 | 状态 |
|---|---|---|
| `minimax-h3-audio-T8` | ConditioningT8/DualClockSamplerT8/AVDecodeT8(14节点) | ✅ T8 拓扑(**须顶层挂载**,见 §7 已知问题) |
| `TE-Speed-MiniMaxH3-OSS` | TESpeedMiniMaxH3 | ✅ 仅 `native` 档 |
| `ComfyUI-INT8-Fast-Fork` | ConvRot 量化器(离线产出 `*_int8_convrot` 权重) | ✅ 离线 |
| ComfyUI 核心 MiniMax 节点 | ImageToVideo/SigmaShift/ReferenceToVideo | ✅ v0.30.0 内置 |
| `ComfyUI-Spectrum-MiniMax-H3` | SpectrumApplyMiniMaxH3(频谱预测跳层) | ⚠️ 已装未接线 |
| `ComfyUI_UniBlockSwap` | UniBlockSwap(极限低显存 ~4.5GB) | ⚠️ 已装未接线 |
| `ComfyUI-ReservedVRAM` | ReservedVRAMSetter | ⚠️ 已装未接线 |
| `ComfyUI-SolAttn_triton` | SolAttnPatch(Triton 稀疏注意力) | ⚠️ 仅 redraw 工具 |
| `ComfyUI-MiniMaxH3_LatentUpscaler` | LatentUpscaleCombined | ⚠️ 仅 redraw 工具 |
| `ComfyUI-PT_H3ConcatAVLatent` | PT_H3ConcatAVLatent | ⚠️ 仅 redraw 工具 |

LoRA(`config.ts` 注册):
- **T8 Turbo**:`minimax_h3_turbo_4step_ema_original_comfyui.safetensors`(motion 自适应 4/4/8,Bypass 加载)
- **LightX2V v1.0**:`minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16` / `…_8step…`(strength 1.0,合并加载)
- **LineartAnime**:`minimax_h3_lineart_anime_ref2va_comfyui.safetensors`(rank=32,仅 ref2va)

## 6. KMC 分用途契约(2026-08-17 精简重写)

### 现状(2026-08-17 迁移后)
KMC(`kais-hermes-skills/skills/kais-movie-pipeline`)调唯一端点
`POST /api/production/minimax-h3/generate`,发 `useCase`(+`motion`/`ttsAudio`);
Python 侧的 `h3_profile→profile/turbo/native/tespeed/steps` 平铺解析已删除。

### useCase 入口(暴露 2 档,`H3_EXPOSED_USE_CASES` 白名单)
`generate` 的一等 `useCase` 参数(config.ts `H3_USE_CASES`)**只提供默认值**;
显式传 `mode/profile/motion/steps/audioMix` 仍可覆盖(显式优先)。
白名单外的旧 useCase(broll/keyframe-interp/portrait-dialogue/motion-board/lineart-color)
POST 一律 400,定义保留在 config.ts。

| useCase | motion | 路由 → profile / 步数 | 音频 | 场景 |
|---|---|---|---|---|
| `preview-lock` | low | turbo (T8) / 4 步 | **tts-only** | P11a 预览:站立/对白/慢速 |
| `preview-lock` | medium(默认) | turbo (T8) / 8 步 | tts-only | P11a 预览:行走/轻微动作 |
| `preview-lock` | high | **native-sage (T2) / 15 步** | tts-only | P11a 预览:追逐/打斗(T8 低步崩坏,跳拓扑) |
| `final-shot` | — | native-sage (T2) / **36 步** @1344×768 | **full**(Foley+TTS) | P11b 成片 |
| `final-motion`(预留) | — | 待设计 | — | 连续 motion 专用工作流,未暴露 |

**动态路由表**(`H3_PREVIEW_MOTION_ROUTES`,preview-lock 专用,取代旧 4/4/8 全 T8 映射):
low→turbo 4 步 / medium→turbo 8 步 / high→native-sage 15 步;显式 `profile`/`steps` 可覆盖。

**音频三态**(2026-08-17 新增,`H3UseCasePreset.audio` 覆盖 `profile.skipFoley` 语义):
- `full` —— Step2 LTX Foley 环境音 + Step3 TTS 混音(完整管线,final-shot)
- `tts-only` —— 跳 LTX Foley,TTS 对白与 H3 原生音轨混音(预览档:快且对白不丢)
- `native` / 不传 useCase —— H3 原生音轨直出(legacy 行为)

`audioMix` 混音策略(`mergeAudioAndVideo`,full 与 tts-only 混音时生效):
- `balanced`(默认):TTS I=-16 + 环境音 I=-24 volume=0.5
- `dialogue-priority`:环境音压到 I=-28 volume=0.3(口播/对白绝对优先)

### 能力发现
`GET /api/production/minimax-h3/workflows` 返回白名单 useCase(含动态路由表)、
profile 详情、分辨率预设、token 预算线、预留档位 —— KMC/前端可程序化发现可用工作流。

## 7. 已知问题与运维注记

1. **T8 挂载陷阱(2026-08-14 发现并修复 compose)**:T8 插件只暴露 `comfy_entrypoint`
   (io.ComfyNode API),kais-incremental 自动装载器认不出(同 SolAttn)→ 需顶层挂载。
   已在 docker-compose.v9.yml 加挂载行;**需 recreate comfyui-primary 生效**。
   症状:T8 档(preview/turbo/production,含默认档)全 400 `missing_node_type
   MiniMaxH3AudioConditioningT8`。
2. recreate 后按需 `docker update --memory 80g --memory-swap 88g comfyui-primary`
   (H3 int8 362 帧在 64g 下曾 OOM;当前实际 64g/72g)。
3. `fix-kornia.sh` pre-start 会 pin ComfyUI v0.30.0 + comfy_kitchen 0.2.28(T8 依赖),
   并覆盖 CLI_ARGS(丢 `--output-directory`/`--lowvram`,产物落容器可写层 `/root/ComfyUI/output/`,
   recreate 即失)—— 重要产物及时拷出。
4. gold-team `docker/gold-team/src/v6/engines/workflows/minimax_h3.py` 是 **dead legacy**
   (零调用、用弃用的 pruned 权重、无 profile/T8/LightX2V),仅作历史参考,勿再用。
5. `src/routes/v1/storyboard/index.ts` 等处 "p10b" 注释疑与 KMC 现阶段名(P09c?)不一致,
   待跨仓确认后统一修改(本仓无 p09c 佐证,未擅改)。
6. **已修复(2026-08-17):skipFoley 档静默丢弃 ttsAudio** —— 旧快速路径直接
   `safeUnlink(ttsAudio)` 返回原生音轨视频,而 KMC 注释预期 "H3 mixes the TTS dialogue",
   P11b(native-sage)+ttsAudio 的对白实际被丢。新增 `tts-only` 音频模式后由 KAP 统一混音。
7. **已修复(2026-08-17):thin routes 静默降级** —— `/t2va` `/i2va` 此前不校验 profile,
   传 `lightx2v-*` 等无对应 builder 的档会静默跑 T8;`/ref2va` 校验全 8 档但 lightx2v 放行后
   同样静默 T8。现三路由统一 `H3_EXPOSED_PROFILES` 白名单校验,白名单外一律 400。
8. **已修复(2026-08-17):`mergeAudioAndVideo` amix 截断** —— `loudnorm + amix duration=first`
   组合使混音在 ~1.1s 处截断(loudnorm lookahead flush 致首输入提前 EOF;实测 4s TTS +
   4.45s ambient 只出 1.12s,之后数字静音)。改为 `duration=longest`(对白结束后环境音延续,
   第二步 ffmpeg `-shortest` 以视频长度封顶)。此前未暴露:真实流量从不走混音路径
   (native-sage skipFoley 直出)。GPU 冒烟验证:turbo low 192s / native-sage high 439s,
   TTS 全程在场 + 环境床全程。

## 8. 相关文档

- `docs/minimax-h3-api-guide.md` —— 端点入参/prompt 写法权威指南
- `workflows/h3-redraw-upscale/README.md` —— 二采重绘放大工具
- `src/routes/production/minimax-h3/config.ts` —— 模型/LoRA/profile/useCase 真源
