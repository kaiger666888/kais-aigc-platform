# 首尾帧生成流水线 — 设计文档

> **日期**：2026-08-02
> **状态**：设计定稿 + 前端连续性判定已实现（`packages/infinite-canvas/src/utils/continuity.ts`）
> **基于**：项目《她从深渊回来》(ID `1785508691757`) · P09 分镜数据（15 镜 S01_B01~S05_B01）
> **范围**：本设计在 `kais-aigc-platform` 前端（无限画布 / 资产管理中心）落地——**不改管线代码**（管线在 `kais-movie-pipeline` / `kais-movie-agent`），只做设计文档 + 连续性判定 + 分镜级首尾帧可视化。

---

## 0. 一句话目标

把「角色设定图 → 每个分镜的首尾帧」这条链路拆成 **6 步可追溯流水线**，并在资产管理中心用 `FramePipelineView` 可视化每两镜之间的**连续性判定**——决定下一镜首帧是「复用上一镜尾帧」还是「独立生成」。

---

## 1. 六步流水线概览

```
① 角色设计图 (P04) — 选定后
  └─→ ② 灰色紧身衣 turnaround (标准化多角度参考，消除服化道干扰)
        │
③ 场景设计图 (P07) — 选定后
  └─→ ④ 三视角场景图 (front / angle_left / angle_right)
        │
⑤ 分镜设计 (P09)
  │   Per Shot (S01_B01, S01_B02, ...):
  │   ⑤a 根据 shot 的 camera angle → 从 ④ 选场景角度图
  │   ⑤b 根据 ②(紧身衣 tr) + ⑤a(场景角度) + shot prompt → 生成该分镜的人物服化道 turnaround
  │   ⑤c 根据 ⑤a(场景角度) + ⑤b(人物 tr) + start_frame_prompt → 生成首帧
  │   ⑤d 根据 ⑤c(首帧) + ⑤a + ⑤b + end_frame_prompt → 生成尾帧
  │   ⑤e 连续性判定: 如果 next.first == cur.last → 复用；否则独立生成
```

整条链的**核心思想**：用「灰色紧身衣 turnaround」锁死角色身份与体型（与服装无关），把「服装 / 场景 / 镜头」三类变量逐层叠加，最终在每个分镜上汇成确定的首尾帧。连续的两镜共享尾→首，省一次生成、同时保证视觉连贯。

---

## 2. 每一步的输入 / 输出 / 参考引用

| 步骤 | 阶段 | 输入 | 输出 | 被谁引用 |
|------|------|------|------|----------|
| ① 角色设计图 | P04 | 角色设定 prompt | 角色身份图（concept） | ② 的基底 |
| ② 灰色紧身衣 turnaround | P04 派生 | ① | 标准化多角度参考图（front/side/back/3q） | ⑤b 的人物基底 |
| ③ 场景设计图 | P07 | 场景设定 prompt | 场景基础图 | ④ 的基底 |
| ④ 三视角场景图 | P07 派生 | ③ | front / angle_left / angle_right 三张 | ⑤a 选取、⑤c/⑤d 背景底版 |
| ⑤a 选场景角度 | P09 | ④ + shot.camera_angle | 该镜场景角度图（`scene_ref`） | ⑤b/⑤c/⑤d |
| ⑤b 分镜服化道 turnaround | P09 | ② + ⑤a + shot.prompt | 该镜人物 turnaround（含服装状态） | ⑤c/⑤d |
| ⑤c 首帧 | P09/P11 | ⑤a + ⑤b + start_frame_prompt | 首帧图 | ⑤d 的基底、下一镜可复用 |
| ⑤d 尾帧 | P09/P11 | ⑤c + ⑤a + ⑤b + end_frame_prompt | 尾帧图 | 下一镜 ⑤e 判定可否复用 |
| ⑤e 连续性判定 | P09 | prev.尾帧 + curr 镜头元数据 | 复用 / 独立生成决策 | 驱动 ⑤c 是否跳过 |

> **引用关系是树形的，不是线性的**：② 被「每个分镜」的 ⑤b 共享（同一角色的紧身衣参考在全剧恒定）；④ 的三视角被该场景下所有分镜的 ⑤a 按角度选取。这就是为什么资产管理中心要按 **Show → Scene → Shot** 三级组织（见 §6）。

---

## 3. 灰色紧身衣 turnaround 的用途（②）

**问题**：角色设计图（①）通常带着完整服化道（沈知意的「银白色鱼尾礼服裙」）。如果直接拿它当每镜人物参考，服装会被**焊死**——同一角色在不同场景换装、湿身、破损都无法表达；且模型会把「服装」当成「角色身份」的一部分，导致跨镜头一致性漂移。

**做法**：从 ① 再生成一张**灰色紧身衣（grey leotard）多角度 turnaround**——同一张脸 / 同一体型 / 同一发型，但通体灰色紧身衣、零服化道信息。它只承载**身份 + 体型**两个锁：

- **身份锁**：脸、五官比例、发型、肤色——全剧恒定，作为一致性基准。
- **体型锁**：身高比例、肩宽、四肢长度——保证 ⑤b 给角色「穿不同衣服」时身材不变形。
- **视角锁**：front / side / back / three_quarter 四列横向排列的整图（与现有 `CharacterWardrobe` 的 turnaround 四宫格同构，复用 `data.viewLayout` 契约）。

⑤b 在此基底上「穿」上当前分镜的服装（礼服 / 便装 / 湿身 / 破损），生成**分镜级服化道 turnaround**。服化道变了，身份与体型不变——这就是 ② 的全部价值。

> 数据契约建议：`type='turnaround_grey'`，`data.viewLayout=['front','three_quarter','side','back']`，`filePath=/oss/{proj}/p04/grey_turnaround_{characterId}.png`（1440×2560 整图，与现有 turnaround sheet 同几何，可直接复用 `CharacterWardrobe` 的 CSS 裁切）。

---

## 4. 分镜级服化道 turnaround 的设计（⑤b）

同一个角色在不同分镜里，服装状态会变化。⑤b 的产物是 **per-shot** 的 turnaround：

```
角色 shenzhiyi
 ├─ ② 灰色紧身衣 turnaround（全剧唯一，身份/体型锁）
 ├─ ⑤b@S01_B02  turn：银白色鱼尾礼服裙（宴会厅，盛装）
 ├─ ⑤b@S04_B02  turn：银白色礼服裙 + 撕裂的协议纸屑在手（情绪高潮，状态破损）
 └─ ⑤b@S05_B01  turn：同礼服 + 逆光半剪影（门口，光影变化）
```

**设计要点**：

1. **以 ② 为基底叠加**：⑤b = ②（紧身衣）+ 当前分镜服装 prompt + ⑤a（场景角度，决定光影基调）。绝不用 ①（带服化道的设定图）当基底——否则换装时身份会漂。
2. **服装状态是连续性锁**：一旦某镜确立了「银白色鱼尾礼服裙」，该场景内后续分镜必须继承（P09 `shot_intent.continuity.locks` 里已显式声明，如 `"shenzhiyi 银白色鱼尾礼服裙"`）。换装 = 一条新的 ⑤b 记录。
3. **资产层级 = Shot 级**：⑤b 的 `inferLevel()='shot'`，挂在对应分镜下；同一角色的 ② 是 Show 级（全剧唯一）。两者通过 `characterId` 关联。
4. **数据契约建议**：`type='turnaround_costume'`，`data.characterId`、`data.shotId`、`data.costumeState`（如 `gala_dress_torn`）、`filePath=/oss/{proj}/p09/{shotId}/turnaround_costume_{characterId}.png`。

---

## 5. 连续性判定规则（⑤e）

### 5.1 判定逻辑（按优先级，命中即返回）

对于 shot[n] 的首帧是否复用 shot[n-1] 的尾帧：

```
1. prevShot === null                         → 首镜          （不复用）
2. 场景号或摄影角度不同（extractSceneId 不等）   → 场景/角度切换   （不复用）
3. 前后镜任一含硬转场/时间跳跃信号              → 硬转场        （不复用）
4. 角色集合无交集                              → 角色变化       （不复用）
5. 否则                                       → 连续          （复用尾帧）
```

✅ **连续（复用尾帧）**：同一场景 + 同一摄影角度 + 时间未跳跃 + 无硬转场 + 至少一个相同角色。
❌ **断裂（独立生成首帧）**：场景切换 / 角度切换 / 时间跳跃 / 硬转场 / 首镜 / 角色完全不同。

### 5.2 判定信号来源（现有 P09 数据中已有，无需新增字段）

| 信号 | 来源字段 | 示例 |
|------|----------|------|
| 场景/角度相同？ | `params.scene_ref` | `assets/S07/S01_front.png` → 标识 `S01_front`（含角度） |
| 转场 / 时间跳跃？ | `start_frame_description` / `dialogue_note` | `"画面全黑 → 闪白过渡"`、`"前世闪回冷色调"` |
| 角色相同？ | `character_refs[].name` | `["shenzhiyi"]` |

**关于「角度」**：`extractSceneId` 返回 **场景号 + 摄影角度**（如 `S01_front`），而非仅场景号 `S01`。因为场景角度图就是首尾帧的**背景底版**——`front` 与 `angle_right` 是不同底版，跨角度复用尾帧会得到错误背景。故角度变了即视为断裂。粗粒度场景号 `S01`（仅供分组/展示）由 `extractSceneBase` 提供。

**关于「转场扫描双镜」**：硬转场是镜间事件，信号常落在**上一镜的尾部描述**（如 B01 整镜即「闪回 / 闪白过渡」，其 `start_frame_description` 含 `画面全黑 → 闪白过渡`）。故 `hasTransitionSignal` 同时扫描 `prevShot` 与 `currShot` 的首帧描述 + 对白注释——这是判定 B01→B02 为断裂的关键。转场关键词：`闪白 / 黑屏 / 画面全黑 / 溶解 / 转场 / 闪回 / 次日 / 天后(=X天后) / 与此同时`。

### 5.3 数据结构

P09 分镜数据中每个 shot 增加连续性判定结果（前端计算，可写回 sidecar）：

```json
{
  "shot_id": "S01_B03",
  "continuity": {
    "type": "continuous",
    "reason": "same_scene_same_chars",
    "prev_shot_id": "S01_B02",
    "reuse_prev_last_frame": true
  }
}
```

对应 TypeScript 契约（见 `packages/infinite-canvas/src/utils/continuity.ts`）：

```typescript
interface ShotData {
  shotId: string           // "S01_B03"
  sceneRef: string         // "assets/S07/S01_front.png"
  characterNames: string[] // ["shenzhiyi", "shenzhiyao"]
  startFrameDesc: string   // P09 start_frame_description
  dialogueNote?: string    // P09 dialogue_note
}

interface ContinuityResult {
  type: 'continuous' | 'cut'
  reason: 'same_scene_same_chars' | 'scene_change' | 'transition' | 'first_shot' | 'character_change'
  prevShotId: string | null
  reusePrevLastFrame: boolean
}

function judgeContinuity(prevShot: ShotData | null, currShot: ShotData): ContinuityResult
```

---

## 6. 资产管理中心的资产类型扩展

资产管理中心已按 **Show → Scene → Shot** 三级组织（`assetManagerData.ts` 的 `inferLevel` / `inferSubtype`）。为承接本流水线，在现有 `AssetSubtype` 上扩展两类 turnaround，并细化场景/首尾帧：

| 流水线产物 | `type` | `AssetSubtype`（建议） | 层级 | 说明 |
|-----------|--------|------------------------|------|------|
| ① 角色身份定义图 | `character` | `character_concept` | Show | 已有。全剧角色设定图。 |
| ② 灰色紧身衣 turnaround | `turnaround_grey` | `turnaround_grey`（**新增**） | Show | **新增**。身份/体型锁，零服化道。 |
| ⑤b 分镜服化道 turnaround | `turnaround_costume` | `turnaround_costume`（**新增**） | Shot | **新增**。per-shot 服装状态。 |
| ④ 场景角度图 | `scene` | `scene_variant` → 细化为 `scene_angle` | Scene | 从 P07 三视角中按角度选取，`data.angle ∈ {front, angle_left, angle_right}`。 |
| ⑤c/⑤d 首尾帧 | `keyframe` | `keyframe_first` / `keyframe_last` | Shot | 已有。三态（选定/待选/淘汰）。 |

**与现有判定的衔接**（`inferSubtype` 扩展建议，纯前端推断，不改后端）：

```typescript
// assetManagerData.ts 现有 turnaround_sheet → 按 isGreyLeotard / shotId 二分
if (d.type === 'character' && hasViewAngle(d)) {
  if (d.data?.isGreyLeotard === true) return 'turnaround_grey'      // ② 全剧级紧身衣
  return 'turnaround_sheet'                                          // 既有 turnaround
}
if (d.type === 'turnaround_costume') return 'turnaround_costume'    // ⑤b 分镜级
// scene_variant → 带 angle 的细化为 scene_angle
if ((d.type === 'scene' || d.type === 'scene_variant') && d.data?.angle) return 'scene_angle'
```

> 本设计文档只约定类型扩展的**契约与判定**；是否落地到 `assetManagerData.ts` 取决于管线是否产出对应产物。当前 P09 数据已具备 `scene_ref`（→ `scene_angle`）与首尾帧，`turnaround_grey` / `turnaround_costume` 待管线 ②/⑤b 产出后挂载。

---

## 7. 现有数据映射 — 本项目 15 镜连续性判定结果表

数据源：`data/oss/1785508691757/p09/manifest.json`（episode `ep-shencongshenyuan-ep01`）。下表为 `judgeContinuity` 在真实数据上的逐镜结果（**已通过 `npx tsx` 实跑验证**）：全片 **15 镜 · 2 处复用 · 13 处独立生成**。

| # | 分镜 | scene_ref 标识 | 角色 | 判定 | 原因 | 首帧处置 |
|---|------|----------------|------|------|------|----------|
| 1 | S01_B01 | `S01_front` | shenzhiyi | ✂ 断裂 | `first_shot` | 全片首镜，独立生成 |
| 2 | S01_B02 | `S01_front` | shenzhiyi | ✂ 断裂 | `transition` | B01 整镜为「闪回 / 闪白过渡」，独立生成 |
| 3 | S01_B03 | `S01_front` | shenzhiyi + shenzhiyao | 🔗 **连续** | `same_scene_same_chars` | **复用 S01_B02 尾帧** |
| 4 | S01_B04 | `S01_angle_right` | shenzhiyi | ✂ 断裂 | `scene_change` | 角度 front→angle_right，独立生成 |
| 5 | S01_B05 | `S01_front` | shenzhiyi | ✂ 断裂 | `scene_change` | 角度 angle_right→front，独立生成 |
| 6 | S02_B01 | `S02_front` | shenzhiyi | ✂ 断裂 | `scene_change` | 场景 S01→S02，独立生成 |
| 7 | S02_B02 | `S02_front` | shenzhiyi | 🔗 **连续** | `same_scene_same_chars` | **复用 S02_B01 尾帧** |
| 8 | S02_B03 | `S02_angle_right` | shenzhiyi + shenzhiyao + luyanzhou | ✂ 断裂 | `scene_change` | 角度 front→angle_right，独立生成 |
| 9 | S03_B01 | `S03_front` | shenzhiyi | ✂ 断裂 | `scene_change` | 场景 S02→S03，独立生成 |
| 10 | S03_B02 | `S03_angle_left` | shenzhiyao + shenzhiyi + luyanzhou + shenzhengbang | ✂ 断裂 | `scene_change` | 角度 front→angle_left，独立生成 |
| 11 | S03_B03 | `S03_front` | shenzhiyi + shenmu | ✂ 断裂 | `scene_change` | 角度 angle_left→front，独立生成 |
| 12 | S04_B01 | `S04_front` | shenzhiyi | ✂ 断裂 | `scene_change` | 场景 S03→S04，独立生成 |
| 13 | S04_B02 | `S04_angle_left` | shenzhiyi | ✂ 断裂 | `scene_change` | 角度 front→angle_left，独立生成 |
| 14 | S04_B03 | `S04_front` | shenzhiyi | ✂ 断裂 | `scene_change` | 角度 angle_left→front，独立生成 |
| 15 | S05_B01 | `S05_angle_left` | shenzhiyi + shenmiren | ✂ 断裂 | `scene_change` | 场景 S04→S05，独立生成 |

**观察**：

- 本片为高度「切镜」叙事——INSERT / 角度切换频繁（签字仪式的多视角蒙太奇），导致 13/15 需独立生成，仅 2 处可复用（B03↔B02、S02_B02↔S02_B01）。
- 唯一的**时间跳跃**发生在 B01→B02（前世闪回 → 2025 现在），由 `transition` 捕获；其余断裂均为场景或角度切换。
- 这张表即 `FramePipelineView`（资产管理中心 → 「首尾帧流水线」Tab）渲染的内容：🔗 连续镜用 teal 实线相连并标注「复用上一镜尾帧」，✂ 断裂镜用 rose 虚线断开并标注原因。

### 验证用例（任务要求三例，均通过）

| 用例 | 期望 | 实际 |
|------|------|------|
| S01_B01 → S01_B02 | `cut` (transition) | ✅ `type=cut reason=transition` |
| S01_B02 → S01_B03 | `continuous` | ✅ `type=continuous reason=same_scene_same_chars reuse=true` |
| S01_B05 → S02_B01 | `cut` (scene_change) | ✅ `type=cut reason=scene_change` |

---

## 附录：实现落点

| 文件 | 作用 |
|------|------|
| `packages/infinite-canvas/src/utils/continuity.ts` | 纯函数 `judgeContinuity` + `extractSceneId`/`extractSceneBase`/`hasTransitionSignal` + 类型与标签 |
| `packages/infinite-canvas/src/components/assetManager/FramePipelineView.tsx` | 分镜级连续性链可视化（资产中心「首尾帧流水线」Tab） |
| `packages/infinite-canvas/src/components/assetManager/assetManager.css` | `am-pipe-*` 样式（复用 `--cv-*` 冷中性 + 模态色 token） |
| `packages/infinite-canvas/src/components/assetManager/AssetManager.tsx` | 新增「首尾帧流水线」Tab（additive，未动既有三视图） |
| `packages/infinite-canvas/src/store/canvasStore.ts` · `src/hooks/useNavHistory.ts` | `assetView` 联合类型扩展 `'pipeline'`（导航历史兼容） |
