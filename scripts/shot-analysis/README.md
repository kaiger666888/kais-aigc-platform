# 逐镜头运镜解构 driver (`shot_analysis_driver.py`)

把一支成片的 `shots.json` 逐镜头送进 ComfyUI，跑【几何层】+ 可选【语义层】+ 可选【主体层】三路分析，最终由 `ShotJSONMerge` 节点把每镜头的解构结果合并落盘成 `shot_XXX.json`。

这是 2026-07-23 **三层全部端到端验证过**（几何 + 语义 + 主体）的原型 driver，vendor 进仓库供平台调用。平台侧通过 `POST /api/v1/production/shot-analysis` 调用它；本文件是给运维 / 手动排查用的 operator 文档。

> driver 含一处相对 Kimi 原稿的必要适配：`SAM3Segment` 用 `output_mode="Merged"`（非 `Separate`）—— Separate 模式按每帧实例数返回 4D/3D 混合张量，批处理 `torch.cat` 会报形状错（见「已知限制」#1）。这是 validated baseline 的一部分。

---

## 它做什么

读取 `shots.json`（格式见 `kais-shot-timeline` 产出的 `[{id, start_sec, end_sec, duration}, ...]`），对每个镜头：

1. 用 `VHS_LoadVideoPath` 按 `start_sec/fps` 跳帧、按 `(end_sec-start_sec)*fps` 截帧加载。
2. **几何层（始终开启）** — `ShotGeometryLK` 在 `grid_n` 网格上做 Lucas-Kanade 光流，输出 `pan_left/pan_right/tilt/...` 等运镜原语 + 速度（`slow/medium/fast`）+ 像素位移量。
3. **语义层（可选，`--semantic`）** — `AILab_QwenVL_Advanced` 用 `Qwen3-VL-8B-Instruct` 对帧序列做摄影指导分析，输出 `shot_scale / camera_primitive / camera_speed / subject_motion / lens_feel / lighting`。
4. **主体层（可选，`--subject`）** — `SAM3Segment` 文本提示分割出主体 mask，`SubjectMotionResidual` 在 mask 内做残差光流，输出主体相对运动。
5. `ShotJSONMerge` 把以上三层结果合并，写到 `<save_dir>/shot_XXX.json`。

driver 自己只负责构建 workflow dict、`POST /prompt`、轮询 `/history`，**不做任何图像处理**。

---

## 前置条件

- **ComfyUI 运行中**，默认 `http://localhost:8188`（可用 `COMFYUI_URL` 环境变量覆盖）。
- **三个镜头分析节点已部署**（通过 `kais-incremental` aggregator 安装到 ComfyUI 的 `custom_nodes`）：
  - `ShotGeometryLK` — 几何层光流分析
  - `SubjectMotionResidual` — 主体层残差光流
  - `ShotJSONMerge` — 三层结果合并 + 落盘
- **`AILab_QwenVL_Advanced` 节点**（语义层，`--semantic` 时需要）。
- **`SAM3Segment` 节点**（主体层，`--subject` 时需要）+ 权重 `sam3.pt` 放在容器内 `/root/ComfyUI/models/sam3/sam3.pt`。
- **`Qwen3-VL-8B-Instruct` 模型**（语义层，`--semantic` 时需要）已下载到 ComfyUI 的模型目录。
- **VHS 插件**（`VHS_LoadVideoPath`）已安装 — ComfyUI-VideoHelperSuite。
- driver 在**宿主机**跑（不在容器内），通过 HTTP 调容器里的 ComfyUI。`shots.json` 在宿主机读取；`--video` 必须是**容器内可见**的路径（见下方已知限制）。

---

## CLI 用法

```bash
python3 shot_analysis_driver.py --shots shots.json --video <container-visible-clip> \
    [--shot-id-range LO HI] [--semantic] [--subject] [--grid-n N] [--fps F] \
    [--qwen-model Qwen3-VL-8B-Instruct] [--quant "8-bit (Balanced)"]
```

### 参数说明

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `--shots` | path | **必填** | `shots.json` 路径（宿主机侧读取，格式 `[{id, start_sec, end_sec, ...}]`） |
| `--video` | path | **必填** | 视频路径，**必须是 ComfyUI 容器内可见的路径**（喂给 `VHS_LoadVideoPath`） |
| `--shot-id-range` | `LO HI` | 全部 | 只处理 id 在 `[LO, HI]` 闭区间内的镜头 |
| `--semantic` | flag | off | 开启语义层（`AILab_QwenVL_Advanced` + `Qwen3-VL-8B-Instruct`） |
| `--subject` | flag | off | 开启主体层（`SAM3Segment` + `SubjectMotionResidual`，需要 `sam3.pt`） |
| `--grid-n` | int | `20` | 几何层光流网格密度（`ShotGeometryLK.grid_n`） |
| `--fps` | float | `24.0` | 跳帧 / 截帧计算用的帧率 |
| `--qwen-model` | str | `Qwen3-VL-8B-Instruct` | 语义层 VLM 模型名 |
| `--quant` | str | `8-bit (Balanced)` | 语义层量化档位 |

---

## 三层 + flag 对照

| 层 | 始终开启? | flag | 依赖节点 | 输出字段 |
|----|----------|------|----------|----------|
| **几何层** | ✅ 是 | — | `ShotGeometryLK` | 运镜原语（`pan_left/pan_right/tilt_up/.../static`）+ `camera_speed` + 像素位移量 |
| **语义层** | ❌ 否 | `--semantic` | `AILab_QwenVL_Advanced` | `shot_scale`（大特写/特写/近景/中景/全景/远景）+ `camera_primitive` + `camera_speed` + `subject_motion` + `lens_feel`（wide/normal/telephoto）+ `lighting` |
| **主体层** | ❌ 否 | `--subject` | `SAM3Segment` + `SubjectMotionResidual` | 主体 mask 内残差运动 |

`ShotJSONMerge` 把三层结果合并写到 `<save_dir>/shot_XXX.json`。

---

## 已知限制

1. **主体层（`--subject`）需要 `sam3.pt`，且节点自动下载会失败 —— 必须用 aria2c 手动取。** `SAM3Segment` 首跑会尝试从 `huggingface.co/1038lab/sam3` 下 `sam3.pt`（3.45GB），但 HF xet CDN 从容器内不可达（TLS 错误），`hf-mirror` 又强制 xet 重定向，`HF_HUB_DISABLE_XET` 也救不了。**解法（已验证）**：在**宿主机**（能到 `cas-bridge.xethub.hf.co`）用 aria2c 从镜像重定向出的签名 URL 多连接下载，再 `docker cp` 进容器：
   ```bash
   SIGNED=$(curl -sI -m 10 "https://hf-mirror.com/1038lab/sam3/resolve/main/sam3.pt" | grep -i '^location:' | sed 's/^location: //I' | tr -d '\r\n')
   aria2c -x 16 -s 16 -k 1M --file-allocation=none -o sam3.pt -d /tmp/sam3dl "$SIGNED"
   docker cp /tmp/sam3dl/sam3.pt comfyui-primary:/root/ComfyUI/models/sam3/sam3.pt
   ```
   （签名 URL 1 小时过期，拿到后立刻下。）然后 `SAM3Segment` 会发现本地权重、跳过下载。
2. **`SAM3Segment` 必须用 `output_mode="Merged"`（driver 已如此设置）。** `Separate` 模式下，有实例的帧返回 4D `[K,H,W,C]`、空帧返回 3D `[H,W,C]`，节点末尾 `torch.cat(result_images, dim=0)` 维度不一致直接报错。`Merged` 每帧合并成一个 mask，维度一致 —— 也是 `SubjectMotionResidual` 想要的（每帧一个主体 mask）。
2. **`--video` 必须是 ComfyUI 容器内可见的路径。** driver 把这个字符串原样喂给 `VHS_LoadVideoPath`，后者在**容器内**执行 —— 所以宿主机路径（如 `/home/kai/...`）容器里看不到。`shots.json` 则相反，在宿主机读取。
   - 平台路由（`src/routes/production/shot-analysis/index.ts`）会自动 `docker cp` 把宿主机视频暂存进容器的 `/root/ComfyUI/input/`，然后把容器内路径传给 driver。
   - 如果视频本来就在 `/root/ComfyUI/...` 或 `/mnt/agents/...`（宿主机挂载进容器的卷）下，路由会原样透传，不做 `docker cp`。

---

## 验证过的样例

**shot_003**（2026-07-23 在测试 clip 上端到端验证）：

- **几何层**：`pan_right` / `fast` / 每帧约 **18px** 水平右移
- **语义层**：`近景` / `follow` / `刀飞向画面右侧` / 雾气幽暗神秘的 `lighting`
- **主体层**：扣除相机运动后主体 `向右上` / `fast` / 约 **30.5px/帧**（`SAM3Segment` Merged mask + `SubjectMotionResidual` 残差光流）

这组结果三层一致地指向「相机右甩跟随 + 主体（刀）向右上飞」—— 即为该 driver 的 validated baseline（`--semantic --subject` 全开）。

---

## 输出

每镜头一个文件：`<save_dir>/shot_XXX.json`（`XXX` 是 3 位补零的镜头 id，如 `shot_003.json`）。

`save_dir` 默认是绝对路径 **`/mnt/agents/output/gpu1/shot_analysis`** —— `ShotJSONMerge` 节点内部用 `os.path.join(_OUT_DIR, save_dir, ...)`，传**绝对** `save_dir` 会覆盖默认 `_OUT_DIR`，使输出落到主机挂载的可见存储上（容器内写的文件，宿主机能直接读到）。

driver 当前不把 `save_dir` 暴露成 CLI 参数，写死成上述默认值。需要换目录时改 `build_prompt()` 的 `save_dir` 参数默认值即可（但会偏离 validated baseline）。
