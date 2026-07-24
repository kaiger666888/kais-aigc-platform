# LTX 2.3 LiconMSR 入参格式指导

> **对象**：`POST /api/production/ltx/msr`(+ `/verified`) —— LTX 2.3 LiconMSR Multi-Subject-Reference(多主体参考)视频生成工作流。
>
> **谁该读**：任何要调用本端点的工具调用方——Claude / hermes-agent / `scripts/gen-from-shot-timeline.ts` / 其它 LLM 编排器。本端点不在任何 OpenAPI spec 里,也没有 MCP 层,所以这份文档 + 路由源码内联注释(`src/routes/production/ltx/msr.ts:1243`)就是唯一的"工具说明书"。
>
> **为什么需要它**：MSR 工作流对两张牌高度敏感——(1) 参考图怎么给,(2) 提示词怎么写。本文把 `~/文档/LTX/validition_v1/01-08` 里 8 个已验证范例提炼成可复用规则。
>
> **相关文档**：BGM 检测见 [`ltx-msr-bgm-detection.md`](./ltx-msr-bgm-detection.md);pose 双条件见 [`ltx-msr-pose-dual-conditioning-design.md`](./ltx-msr-pose-dual-conditioning-design.md)。

---

## 1. 端点速查

| 端点 | 行为 | 何时用 |
|---|---|---|
| `POST /api/production/ltx/msr` | **异步提交**,立即返回 `promptId`,自己轮询 ComfyUI `/history/{promptId}` | 批量/后台,5-stage、foley 等长管线 |
| `POST /api/production/ltx/msr/verified` | **同步**:提交 → 轮询 → 下载 → BGM 检测 → 命中就换 seed 重生 | 一步拿到"无 BGM 成片";长时间占用连接,用 `timeout:0` 客户端 |

**请求格式**:`multipart/form-data`。**必填**:`projectId`(number)、`prompt`(非空)、参考图(2-5 张)。

---

## 2. 参考图入参规范(敏感输入 #1)

### 2.1 `ref1..ref5` 的顺序与语义 —— 最容易踩的坑

```
ref1 = 主体 1(角色 A)
ref2 = 主体 2(角色 B)
ref3 = 主体 3(可选)
ref4 = 主体 4(可选)
refN(最后一张)= 背景 / 场景图      ← 最后一张进 background 槽
```

- **硬限制 2-5 张**:< 2 张 400,> 5 张 400。
- **顺序即语义**(源码 `msr.ts:329-332`):`refFilenames` 的**前 N-1 张**进 LiconMSR 主体槽 `slot1-4`,**最后一张**进独立的 `background` 槽。
- → **主体在前,背景放最后**。HTTP `ref1` 是第一个主体,不是背景。
- **张数影响帧数**:`msrFrameCount` 自动匹配到 `[17,25,33,41]`,不要自己传。

### 2.2 主体参考图必须是「角色卡」——一张图拼 4 视角(硬性规范)

LiconMSR 要求**每个主体**是**一张拼好的多视角角色卡**,不是单张照片。标准拼法:**横排 4 格、白底留白分隔**(源自 `文档/LTX/validition_v1/01/1.jpg`):

| 格位(从左到右) | 内容 |
|---|---|
| 第 1 格 | **正面近照**:脸部 + 上半身(发型/发饰/五官/领口) |
| 第 2 格 | **全身·正面** |
| 第 3 格 | **全身·侧面**(profile) |
| 第 4 格 | **全身·背面** |

要点:4 格同一角色同一套服饰;横排单行(模型按行扫);背景统一白底;无文字水印。**为什么必须拼**:给模型注入 identity,学"此人正/侧/背各角度长这样",只给单张正面照 → 侧/背/全身比例无约束,运镜翻车。

### 2.3 分辨率与画面引导

- `width`×`height` 默认 `1280×704`(16:9),**必须匹配参考图宽高比**(竖屏立绘改 720×1280),否则拉伸。
- `firstFrame`/`firstFramePath`(str 0.8)、`lastFrame`/`lastFramePath`(str 0.6)、`firstFrameIdx`、`poseVideoFrames`(JSON 数组,宿主白名单路径)、`poseGuideStrength`(0.7)。宿主路径白名单:`/data/workspace/kais-blender-docker/outputs/`、`/mnt/agents/output/`、`/tmp/comfyui-ltx-input/`。

---

## 3. 提示词入参规范(敏感输入 #2,核心)

### 3.1 黄金契约:`refDescription` 写 identity,`prompt` 写动作

V2 PromptRelay 把提示词拆两路(`msr.ts:413-414`):
```
global_prompt = refDescription || prompt   → 角色/场景「身份」(全局条件)
local_prompts = prompt                    → 「动作」(按时间段用 | 分段)
```
- **`refDescription`** = **谁/什么**:每角色一段 + 场景一段,写外貌/服饰/身份,**不写动作**。**强烈建议必填**(漏填 → 用 prompt 当 identity → 漂移)。
- **`prompt`** = **发生什么**:动作/镜头/时间推进,可用 `|` 分段。

### 3.2 五种已验证写法(源自 `文档/LTX/validition_v1`)

- **A 中文人物描述+场景+动作叙述**(01/04):`refDescription` 逐角色写形象 + 场景;`prompt` 纯动作叙述。
- **B 英文电影感逐镜头**(02/07/08):精确镜头语言(`medium two-shot`/`dolly`/`low angle`/`one-shot`),结尾带质感约束。
- **C 对话/TTS:@角色+台词+音色+表演要求**(03):把"谁说话+台词+嘴型同步"放 **`stage2PromptSuffix`**(仅 5-stage Stage 2),**不进 `prompt`**;同时给 `audio`(TTS)+ `dialogueEndTime`。
- **D 多主体一致性+"do not change"约束句**(06):`maintain strong reference consistency ... Do not change faces/costumes/proportions`——多主体建议必加。
- **E 时间码分镜**(04):`【00-05】… 【05-10】… 【10-15】…`,或用 `|` 喂 PromptRelay。

### 3.3 ⚠️ 不要和系统对抗(最常见错误)

`audioMode` 自动往 prompt/negativePrompt 追加音频引导词(`msr.ts:248-276`):正向 `strictly diegetic ... no scored music`,负向穷举音乐要素 + **字幕压制**(`subtitles, captions, Chinese characters ...`)。所以:
- ❌ prompt 别写 "background music"/"soundtrack"/"epic music"(会和 `no scored music` 打架,反而诱发 BGM)。
- ❌ 中文对白别在正向提"字幕"(会被转录烧录进画面)。
- ✅ 想要环境音写具体声源:`footsteps on wet stone, rustling fabric, gentle wind`。

`negativePrompt` 默认值见 `msr.ts:1307`(`DEFAULT_NEGATIVE`),一般不改,要加风格负向在默认基础上追加。

---

## 4. 音频参数决策树

优先级 `audioStrategy` > `audioMode` > 智能默认(`resolveAudioMode`,`msr.ts:145-158`)。

| `audioStrategy` | 映射 mode | 需 `audio`? | 需 `dialogueEndTime`? | 说明 |
|---|---|---|---|---|
| `tts` | 有 endTime→`5stage_pipeline`;无→`dialogue+ambient` | ✅ | 5stage 必填 | TTS 对白保真,5stage 额外生成环境声(主推荐) |
| `foley` | `foley_v2a` | ✅ | 可选 | TTS 冻结只驱动口型 → Foley V2A 生成干净环境 → 混音。根治 BGM |
| `ambient` | `ambient_only` | ❌ | ❌ | 纯环境声无人声 |
| `silent` | `silent` | ❌ | ❌ | 无音轨 |

智能默认:有 `audio`+`dialogueEndTime`→5stage;仅 `audio`→dialogue+ambient;都没有→silent。`foleyPrompt`(仅 foley_v2a)缺省用 `LTX_MSR_FOLEY.defaultPrompt`。`/verified` 额外参数:`maxRegenAttempts`(3)、`bgmThreshold`(0.10)、`pollTimeoutMs`(600000)。

---

## 5. 完整字段参考表(默认值源自 `parseAndUploadAssets` `msr.ts:1313-1525` + `config.ts`)

**必填**:`projectId`(number)、`prompt`(非空)、`ref1..ref5`(2-5 张,主体在前背景在末位)。

**基础可选**:`refDescription`(强烈建议必填,identity)、`negativePrompt`(默认 `DEFAULT_NEGATIVE`)、`duration`(3)、`fps`(24)、`width/height`(1280/704)、`seed`(随机)、`outputFilename`、`outputDir`。

**V2 可选(默认启用)**:`useV2`(true)、`nagWeight`(0.25)、`nagLayers`(11)、`nagSigmaStart`(2.5)、`relayWeight`(0.0022)、`msrLoraVersion`(V2)。

**音频**:`audioStrategy`(tts/foley/ambient/silent)、`audioMode`(dialogue+ambient/dialogue+ambient_v2/5stage_pipeline/ambient_only/silent/auto)、`audio`(file)、`dialogueEndTime`(5stage/v2 必填)、`stage2PromptSuffix`(仅 Stage2 对口型)、`foleyPrompt`(仅 foley_v2a)。

**画面引导**:`firstFrame`/`firstFramePath`(0.8)、`lastFrame`/`lastFramePath`(0.6)、`firstFrameIdx`、`poseVideoFrames`(JSON 数组)、`poseGuideStrength`(0.7)。

**`/verified` 专用**:`maxRegenAttempts`(3)、`bgmThreshold`(0.10)、`pollTimeoutMs`(600000)。

---

## 6. 端到端调用示例

### 6.1 单 pass silent(主体在前,背景最后)
```bash
curl -F "projectId=1" \
  -F "prompt=A woman in a jade-green hanfu walks down a rain-soaked stone alley; a man in a crimson robe stands ahead and smiles. Cinematic, shallow depth of field." \
  -F "refDescription=RN: man, crimson embroidered robe, black fur cloak. WV: woman, jade ornaments, jade-green dress. Scene: misty Jiangnan town, wet stone path, warm lanterns." \
  -F "ref1=@/path/rn_card.png" -F "ref2=@/path/wv_card.png" -F "ref3=@/path/bg.png" \
  -F "duration=5" -F "audioStrategy=silent" \
  http://localhost:3000/api/production/ltx/msr
```
> 注意:`ref1`/`ref2` 是角色卡(主体),`ref3`(最后一张)是背景。

### 6.2 5-stage 对话
```bash
curl -F "projectId=1" \
  -F "prompt=石板小路上,WV迎面走来。RN迎面站着微笑。两人并肩走向街道深处。" \
  -F "refDescription=RN:男人,酒红色长袍,黑狐毛大氅。WV:女人,暗绿鱼尾裙。场景:烟雨江南小镇。" \
  -F "stage2PromptSuffix=【@RN】说话,台词:这么巧。嘴型同步。" \
  -F "ref1=@rn_card.png" -F "ref2=@wv_card.png" -F "ref3=@bg.png" \
  -F "audio=@tts.wav" -F "dialogueEndTime=6" -F "audioStrategy=tts" -F "duration=10" \
  http://localhost:3000/api/production/ltx/msr
```

### 6.3 `/verified`(无 BGM 成片)
```bash
curl --max-time 0 -F "projectId=1" -F "prompt=..." -F "refDescription=..." \
  -F "ref1=@rn_card.png" -F "ref2=@bg.png" \
  -F "audioStrategy=ambient" -F "maxRegenAttempts=3" -F "bgmThreshold=0.1" \
  http://localhost:3000/api/production/ltx/msr/verified
```

> TS 调用形态参考 `scripts/gen-from-shot-timeline.ts`(用 `buildMSRWorkflow` 直接构工作流,或 `axios`/`FormData` 打 HTTP)。

---

## 7. 常见坑(Checklist)

| 症状 | 原因 | 对策 |
|---|---|---|
| 主体和背景错位/串味 | 把背景放进了 `ref1`(应是主体位),或把主体放在了最后(background 槽) | **主体在前(slot1-4),背景最后一张** |
| 人物 identity 漂移 | 漏填 `refDescription`;或主体只给单张正面照 | 必填 `refDescription`;主体用 4 视角角色卡(§2.2) |
| 输出带 BGM/音乐 | prompt 写了音乐词,或用 `auto` | 别写音乐词(§3.3);用 tts/foley/ambient;走 `/verified` |
| 底部出现对白字幕 | 中文对白被转录 | 系统已加字幕负向;确认正向没提"字幕";音频对白文本别太长 |
| 环境声渗出"第二种人声" | 对口型标注写进了 `prompt` 而非 `stage2PromptSuffix` | 标注只进 `stage2PromptSuffix` |
| 5-stage 报错缺参数 | 漏 `dialogueEndTime` 或 `audio` | 5stage 必须同时给 |
| 视频 400 "At least 2 references" | 只传 1 张 | 最少 2 张(1 主体 + 1 背景) |
| 画面拉伸 | `width/height` 没匹配参考图比例 | 竖屏用 720×1280 |
