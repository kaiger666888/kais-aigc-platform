---
phase: 62-asset-hierarchy-selection
plan: "06"
subsystem: infinite-canvas/assetManager
tags: [redundancy-config, C8-rail, three-source-badge, clamp-dual-channel, write-state-badge, config-rail]
requires:
  - 62-02（GET/PUT /api/canvas/v2/generation-config 路由契约——rows 三源合并形状 + writeState 三态）
  - 62-01（generationConfigKeys 前端常量表：GENERATION_CONFIG_KEYS 14 键 tier/preCap1/unwired/
    gpuHint/note + LOCKED_CONFIG_KEYS 汇总口径 19 + clampRedundancy 钳制函数）
  - 62-04（AssetHierarchy 视图壳/toolbar/两列栅格位 + .am-hier 词汇）
  - 62-05（BatchActionBar 落位现状——本 plan 栅格改三列不动批量条）
provides:
  - RedundancyConfigRail.tsx（C8 右栏：14 行三源合并展示 + 写侧两段式编辑 + 不可配
    折叠区 19 口径 + loading/error/缺上下文三态；9 类 config-* testid 断言面）
  - canvasApi.ts fetchGenerationConfig（GET rows/fileState）+ putGenerationConfigOverride
    （PUT writeState 三态；400 message 承载服务端钳制文案供 toast）+ ConfigRow/
    GenerationConfigWriteState 类型导出
  - AssetHierarchy.tsx 第三栏挂载（config-toggle 开关默认收起 + .am-hier--cfg
    220px 1fr 340px 三列栅格 + ≤880px rail 整宽下挂）
  - am-cfg-* 样式族（rail 容器/行 divider/来源角标四态 chip/写徽标 600 字重/锁定区
    opacity .45——全既有 --cv-* 词汇，零新全局 token）
affects:
  - 62-07（e2e redundancy-config 断言面全套就绪：config-toggle/config-rail/config-row
    [data-phase-key][data-source][data-tier]/config-pre-input[disabled]/config-save/
    config-write-badge[data-write-state]/config-locked-section/config-row-locked/
    config-unwired-chip；14 行口径 + 锁定区 19 口径）
tech-stack:
  added: []（零新依赖）
  patterns:
    - updateAsset/fetchGateState 原生 fetch GET 范式（apiCall 仅支持 POST；判错看
      HTTP status——62-02 信封陷阱 body.code 恒 400 不作依据）
    - 62-01 键表驱动的 UI 门控（preCap1/unwired/gpuHint/note 查表，非逐行硬编码；
      服务端 rows 的 editable/lockReason 不参与门控——62-02 裁定 editable 恒 true）
    - clampRedundancy 同一函数驱动越界判定（钳后不等即越界），不写第二套边界判断
key-files:
  created:
    - packages/infinite-canvas/src/components/assetManager/RedundancyConfigRail.tsx
  modified:
    - packages/infinite-canvas/src/services/canvasApi.ts
    - packages/infinite-canvas/src/components/assetManager/AssetHierarchy.tsx
    - packages/infinite-canvas/src/components/assetManager/assetManager.css
decisions:
  - "写徽标「已同步 requirement.json」不带 ✓ 前缀——PLAN Task 1 硬门「文案三串逐字」
    权威于 UI-SPEC C8 视觉注「青 + ✓ 前缀」（e2e 逐字断言面保真）"
  - "来源角标 legacy 判定 = source==='legacy' || sourceLegacy===true（双形态覆盖：
    62-02 真服务端 source='legacy'；62-03 mock source='snapshot'+sourceLegacy 标注）"
  - "UI 门控完全由前端键表驱动，无视 mock rows 的 editable:false+lockReason 字段
    （62-03 mock 早于 62-02 终裁形——bgm/foley editable 仍 true 为裁定锁定项）"
  - "pre 输入 max=99 上界 hint（T-62-04 服务端 zod max 对齐）+ 越界判定加整数守卫
    （clampRedundancy 对非整数不拦截，如 2.5）——D-10 前端道加严"
  - "PUT 载荷恒发两旋钮数字值（null 清除语义后端已备，本 plan 未开清除入口——
    PLAN Task 1 未定义清除 UI，62-07 断言面不含）"
  - "三列过渡：grid 列数 2→3 属离散插值不可动画，rail 自带 am-cfg-in 滑入动画
    防跳变（PLAN「transition 防跳变」落地形态）"
metrics:
  duration: 567s（2026-08-24 14:13–14:22 UTC）
  completed: 2026-08-24
  tasks: 2/2
  tests: 488/488 零回归（基线 488；本 plan 无新单测——断言面为 62-07 e2e）
---

# Phase 62 Plan 06: C8 RedundancyConfigRail 冗余配置右栏 Summary

HIER-03 UI 半壁成真：khs v2.5 键面快照（14 键口径）读侧三源合并展示（来源角标
四态可辨 D-09）+ 写侧两段式编辑（钳制双道 D-10 + writeState 三态徽标 D-08 绝不
假成功）+ 不可配折叠区 19 口径显式标注（D-11），经「⚙ 冗余配置」开关挂载层级
视图第三栏（220px 1fr 340px，默认收起）。

## Tasks Completed

| Task | Name | Commit | Key Files |
| ---- | ---- | ------ | --------- |
| 1 | canvasApi 两封装 + RedundancyConfigRail 组件 | 71f8a4ea | canvasApi.ts, RedundancyConfigRail.tsx |
| 2 | 挂载层级视图第三栏 + 开合交互 + css | 875656a6 | AssetHierarchy.tsx, assetManager.css |

## What Was Built

### Task 1 · canvasApi 两封装 + C8 组件（commit 71f8a4ea）

- `canvasApi.ts` 追加（裁定形态：原生 fetch，判错看 HTTP status）：
  - `fetchGenerationConfig(projectId, episodesId)`：GET + querystring →
    `{ rows: ConfigRow[]; fileState: string }`；!ok → `ApiError(HTTP ${status},
    'network', status)`。
  - `putGenerationConfigOverride(projectId, episodesId, phaseKey, values)`：PUT 同
    范式 → `{ phaseKey, writeState }`；!ok 时优先取 body.message 作 ApiError.message
    （400 钳制文案「确定性派生 · pre 固定为 1」直达 toast，D-10 后端道同文案）。
  - `ConfigRow` / `GenerationConfigWriteState` 类型导出（字段同 62-02 rows 元素）。
- `RedundancyConfigRail.tsx`（新，根 `[data-testid="config-rail"]`，props
  { projectId, episodesId }）：
  - **头部**：「冗余配置」+ sub「PRE/FINAL CANDIDATES」（.am-title__sub 式）+
    fileState mono 灰 chip（文件面状态码可视化）；列头行「阶段/档位/pre/final」。
  - **14 行配置**（server rows × 前端键表联合驱动）：每行
    `[data-testid="config-row"][data-phase-key][data-source][data-tier]`——
    阶段列中文显示名 + mono phase_key 灰小字 + note 副文案（shot_list
    「转场随分镜表候选整体」键表注入）；档位徽标四文案（确定性派生玫弱底警示）；
    p11_video ⚠ title「GPU 成本护栏 · 谨慎调高」；bgm/foley
    `[data-testid="config-unwired-chip"]`「占位未接线」title「键面占位 · 运行时暂
    不消费」（editable 保持 true）；pre/final stepper + 来源角标四态 chip
    （override 青弱底「覆盖层」/ requirement 金弱底「文件值」/ snapshot 中性
    「快照默认」/ legacy 虚线边「无 v2.5 键」，tooltip 四串逐字）；**preCap1 五键
    pre input disabled 钉 1 + 行内灰字「确定性派生 · pre 固定为 1」由键表驱动**。
  - **钳制前端道**（D-10）：`clampRedundancy(p, f)` 钳后不等即越界（+ 整数守卫）→
    保存禁用 + 行内「数值越界：pre ≥ 1，final 需在 1..pre 之间」逐字；final max =
    当前 pre 输入值。
  - **写侧两段式**（D-08）：编辑 → 「未保存」灰字 + 「保存」按钮（有改动时出现）→
    PUT → 写徽标 `[data-testid="config-write-badge"][data-write-state]` 三串逐字
    （已存覆盖层 / 已同步 requirement.json / 文件面寻址失败——覆盖层已保存），
    青 ok/玫 warn 既有徽标词汇 + 600 字重；再次编辑旧徽标即失效移除；400 →
    toast 同 message 文案。保存成功本地行同步（pre/final/source='override'）。
  - **锁定区**（D-11）：`<details data-testid="config-locked-section">` summary
    「不可配键 · 19」（LOCKED_KEYS_TOTAL=1+18，checker 裁定 30→19 漂移修正）；
    两禁用行 `config-row-locked[data-phase-key][data-reason]`（p10_voice.tts +
    `__report_audit_aggregate__` 汇总行「18 键」副文案），整行 opacity .45 +
    not-allowed，不隐藏。
  - 三态拉取面：loading（.am-loading skeleton）/ error（「配置加载失败：{error}」+
    重试）/ 缺上下文（projectId/episodesId null 时提示）。

### Task 2 · 第三栏挂载 + 开合 + css（commit 875656a6）

- `AssetHierarchy.tsx`：`configOpen` state（**默认 false**，UI-SPEC 默认收起评审锚）；
  toolbar「⚙ 冗余配置」`[data-testid="config-toggle"]`（.am-btn--ghost；开态同文案 +
  is-on + aria-expanded）；configOpen 时主区后按需挂载
  `<RedundancyConfigRail projectId episodesId />`（收起时零渲染；episodesId 取
  useCanvasStore）；根类 `am-hier--cfg`（开态三列）。62-05 BatchActionBar 位于
  toolbar 与滚动区之间，不受第三列影响（零改动验证）。
- `assetManager.css` append：`.am-hier--cfg`（220px minmax(0,1fr) 340px +
  transition）/ `.am-hier__config-toggle.is-on` / `.am-cfg-rail` 列容器（am-cfg-in
  滑入动画）/ `.am-cfg__cols`/`__row` 同栅格（minmax(0,1fr) 72px 56px 56px，meta 行
  跨全列）/ 来源角标四态 / stepper input / 写徽标 600 字重 / 锁定区沉底——
  **全既有 --cv-* 词汇，零新全局 token**；≤880px rail 整宽下挂（border-top 替
  border-left，沿既有断点词汇）。

## Deviations from Plan

无实质偏差。两处契约内裁决（详见 decisions）：

1. **写徽标无 ✓ 前缀**：UI-SPEC C8 视觉注「已同步 requirement.json（青 + ✓ 前缀）」
   与 PLAN Task 1 硬门「文案三串逐字（已存覆盖层/已同步 requirement.json/文件面
   寻址失败——覆盖层已保存）」冲突——取 PLAN 逐字（后出裁定 + e2e 断言面保真）。
2. **来源角标 legacy 双形态判定**：`source==='legacy' || sourceLegacy===true`——
   62-02 真服务端与 62-03 mock（source='snapshot'+sourceLegacy 标注）两形状同覆盖，
   PLAN 接口段两描述并存的融合实现。

执行环境备注：62-03 mock rows 对 preCap1/unwired 键发 editable:false+lockReason
（早于 62-02 终裁形的 mock 侧旧形状）——本 plan UI 门控按裁定完全由前端键表驱动、
不消费该两字段，真/mock 两后端下行为一致（unwired 键 editable 仍 true 为裁定锁定项）。

## Verification Results

| Gate | Result |
|------|--------|
| Task 1 automated verify（build + 9 类 testid grep + 「不可配键 · 19」grep） | PASS（build exit 0；testid 计 10 行在场；锁定串 2 处 pin 注在场，DOM 渲染 = LOCKED_KEYS_TOTAL=19） |
| Task 2 automated verify（build + npm test + config-toggle/am-cfg grep） | PASS（build exit 0；488/488；config-toggle=2；am-cfg=39） |
| `npx tsc --noEmit`（packages/infinite-canvas） | PASS（exit 0） |
| root `npx tsc --noEmit` | PASS（exit 0） |
| 全包 vitest | PASS（42 文件 488 用例全绿 = 基线 488，零回归） |
| 文案抽查（grep -F 逐字） | PASS（写徽标三串/钳制串/GPU 串/角标四串+tooltip 四串/档位四串/preCap1 与锁定三 reason/占位未接线两串/未保存/列头四串/标题+sub 全在场——reason 三串经 LOCKED_CONFIG_KEYS 常量注入，源串在 generationConfigKeys.ts 核实在场） |
| 默认收起锚 | PASS（`configOpen` useState(false)，:89） |
| 工作树卫生 | PASS（两 commit 恰触 files_modified 4 文件、零删除；pre-existing 脏文件 yarn.lock/ltx pngs 未触碰；e2e 新文件属并行 62-07 执行者未触碰） |

## Auth Gates

None.

## Known Stubs

None——读写全链路真实接线（GET 真 rows 渲染 / PUT 真写 + 三态徽标直映射）。
mock 后端 generation-config 端点（62-03）已就位，62-07 e2e 可直接消费；
dist 由并行执行者重建（vitest 不依赖 dist）。

## Notes for Downstream Plans

- 62-07 e2e 断言面：
  - 行口径 14（非 15）：transition 并入 shot_list note「转场随分镜表候选整体」；
    锁定区 summary「不可配键 · 19」+ 两行（tts + `__report_audit_aggregate__`）。
  - `config-pre-input` 在 preCap1 五键 disabled + 行内 reason「确定性派生 · pre 固定为 1」；
    越界（final>pre 或清空输入）→ 保存禁用 + 「数值越界：pre ≥ 1，final 需在 1..pre 之间」；
    mock 400 → toast 同文案（`failSelectWinner` 同款注入开关为
    `/__mock/config`，PUT 载荷在 `/__mock/calls` 过滤
    `PUT /api/canvas/v2/generation-config/overrides/`）。
  - 写徽标三态：mock `/__mock/config { genCfgWriteState: 'synced'|'file-fail' }`
    注入（62-03 已备）；默认 'override'。
  - legacy fixture：mock fileShape='legacy' 行 source='snapshot'+sourceLegacy →
    角标显示「无 v2.5 键」（config-source-chip[data-source=legacy]）——勿断
    行级 data-source='legacy'（mock 行属性透传 source='snapshot'，真后端才是
    'legacy'；角标 data-source 已归一为 'legacy'）。
  - unwired chip 断言 bgm/foley 两行 `config-unwired-chip` 在场 + 其 stepper
    可编辑（editable 仍 true，62-01 裁定）。
- 值得注意的实现细节：写徽标在再次编辑时移除（防旧状态误读）；保存成功后行
  source 本地置 'override'（与 GET 回读一致）；PUT 载荷恒两旋钮数字（null 清除
  后端已备但本 plan 无 UI 入口）。

## Self-Check: PASSED

- 文件存在性：RedundancyConfigRail.tsx FOUND（新建）；canvasApi.ts /
  AssetHierarchy.tsx / assetManager.css FOUND（修改）——files_modified 4 文件全覆盖。
- Commits：71f8a4ea / 875656a6 均在 git log FOUND。
- 无 files_modified 之外文件被本 plan 提交（git show --stat 核对：71f8a4ea=2 文件、
  875656a6=2 文件，零删除）。
