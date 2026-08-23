# Phase 58: 全配方持久化 (Full Recipe Persistence) - Context

**Gathered:** 2026-08-23
**Status:** Ready for planning

<domain>
## Phase Boundary

§14 窄通道(现仅 prompt/seed/engine/modelVersion)扩展为全量高级配方——steps/cfg/sampler/lora/量化等字段经 `EventNodeV3.params` 全链路打通:详情面板可编辑、persistEventParams 持久化、serialize 往返、execute.ts 重生成请求体直接消费。编辑即真值,窄通道不再丢弃高级字段。

覆盖 RECIPE-01..04(REQUIREMENTS.md)。改动限 kap 仓画布侧(packages/infinite-canvas + packages/flowgraph-v3 + src/lib/canvasAssetSchema + src/routes/canvas/execute.ts)。

</domain>

<decisions>
## Implementation Decisions

### 编辑入口与形态
- 编辑落在**详情面板** PromptSection(52-03 三态范式扩展为配方编辑器);芯片 popover(EventParamsPopover)保持只读+换 seed——面板是 REGEN-01 主编辑面,popover 定位是快速查看
- 高级字段以折叠区「高级参数」呈现,默认**收起**(480px 审片面板 prompt 优先,高级字段低频)
- 控件按字段类型推导:steps/cfg → number input;quant/sageAttention → select;lora → 行级编辑(name + strength)
- 未知 catchall 字段(KNOWN_KEYS 之外的管线私有字段)**只读展示**,不提供编辑——防误伤

### 通道与真值
- 可编辑字段集白名单 = 导出 `RECIPE_EDITABLE_FIELDS` 单点常量;popover KNOWN_KEYS 与面板同源引用(一处定义两处消费)
- execute 请求体整袋 merge:`params: { ...源params, ...编辑patch }`——未编辑字段原值透传,天然满足 RECIPE-03 不被 nullish 清洗
- serialize 往返:migrate `recipeParams` 提取(v2 data → V3 params)扩到 GenerationParams 全集,lora 数组整袋深度透传,reload 读回完整配方
- 保存时机沿用 52-03 范式:本地编辑态,点「保存」一次 persistEventParams + saveCanvasGraph;不做字段级失焦自动保存

### 守护与验证
- RECIPE-04 防漂移 = verify-phase-58 聚合门:断言 canvasAssetSchema 字段集 ↔ `RECIPE_EDITABLE_FIELDS` ↔ migrate 提取集**三方一致** + nullish 计数锁 + forced-failure 自检
- e2e 新增 `phase58-recipe.mjs`:编辑 steps/cfg/lora → 保存 → reload 往返断言 → 重生成请求体断言(mock)
- 真机验证 `probe-58-real.mjs` 复用 probe-52-real Part B 零足迹模式(改 steps+cfg → 保存 → 重载往返 → 恢复)
- 回归基线:62 e2e 全量 + vitest 404/130 不降;流程末 build → deploy → 真机探针

### Claude's Discretion
- 折叠区组件实现细节、number input 步进/边界、select 选项来源、lora 行级编辑器具体交互
- RECIPE_EDITABLE_FIELDS 放哪个模块(倾向 flowgraph-v3 导出,schema/popover/panel 三处引用)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `EventParamsPopover.tsx` 已按 提示词/采样(seed·steps·cfg·modelVersion·quant·sageAttention)/LoRA/catchall 分组渲染(现为只读 KvRow),`KNOWN_KEYS` 白名单已存在(L27)——同源化改造点
- `canvasStore.persistEventParams(eventId, patch: Partial<GenerationParams>)`(L653)已是泛型 patch,store 侧无窄通道
- 52-03 PromptSection 三态(可编辑/落选只读/无事件只读)+ 保存按钮范式——直接扩展
- 52-04 handleRerollSeed 的守卫/pending/executeNode 通道范式可复用

### Established Patterns
- GenerationParams 类型(flowgraph-v3)是配方形状真值源
- serialize.ts L293-301:event→asset 反查折叠(role==='output'),eventToAsset 映射
- migrate.ts `recipeParams(v2)`(L155)是 §14 提取的窄通道所在——扩展点
- zod nullish leniency 范式(52-07):undefined/null 过,在场值保 shape floor

### Integration Points
- 面板保存链:persistEventParams → saveCanvasGraph → (真机 graph:saved reload)
- 重生成链:executeNode(projectId, episodesId, assetId, stage, { params: {...} }) → /canvas/execute
- verify 脚本范式:scripts/verify-phase-52.ts(51/52 传统)+ package.json 注册

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
