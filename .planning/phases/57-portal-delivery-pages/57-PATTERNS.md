# Phase 57: 平台页面与门户 (Portal & Delivery Pages) - Pattern Map

**Mapped:** 2026-08-22
**Files analyzed:** 18 (new + modified)
**Analogs found:** 16 / 18（2 项为「脚手架类比」——见 No Analog Found）

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/portal/`（NEW 包：vite.config.ts / index.html / package.json） | build + host | request-response | `packages/infinite-canvas/vite.config.ts`（alias/base/proxy 全套）+ `data/web/director-desk/index.html`（绝对 base 岛先例） | exact（结构同构、规模更小） |
| `packages/portal/src/main.tsx`（NEW：pathname switch 入口） | host | request-response | `packages/infinite-canvas/src/main.tsx:29-77`（createRoot + testMode 桥） | exact（挂载侧）；路由 switch 本身无先例（3 条手写） |
| `packages/portal/src/nav/kap-nav.ts`（NEW：vanilla custom element，单源三宿主） | component（框架无关） | transform（属性→DOM） | `packages/infinite-canvas/src/components/canvas/icons.tsx`（仓内唯一「非 React 依赖可移植」UI 源先例——同为自包含、token 驱动）；生命周期/hooks 手法参考 lit-less custom elements 惯例（无仓内先例，见 No Analog） | partial |
| `packages/portal/src/nav/kap-nav.css`（NEW） | style | transform | `packages/infinite-canvas/src/theme/tokens.css`（构建期 concat 进 kap-nav.css，token 单源不复制值） | exact（拼接关系） |
| `scripts/build-kap-nav.mjs`（NEW：esbuild 产物构建） | build script | file-I/O | `scripts/build.js:39-55`（根仓 esbuild server bundle 配置） | exact |
| `packages/portal/src/pages/PortalHome.tsx`（NEW） | component | request-response（fetchProjects） | `packages/infinite-canvas/src/components/ProjectSelector.tsx:20-36`（同一端点消费）+ `SceneShotBrowser.tsx`（55 新表面：行/分组/空态语法） | exact（数据）/ role-match（版面） |
| `packages/portal/src/components/PipelineRibbon.tsx`（NEW：签名元素） | component | transform（registry + counts → segments） | `packages/infinite-canvas/src/components/canvas/PhaseColumns.tsx`（phaseGroup 色带 + P0X 标签文法）+ `laneGeometry.ts:63-111`（phaseIndex→列几何映射思想） | role-match（维度同源、形态新） |
| `packages/portal/src/pages/DeliveryPage.tsx`（NEW） | component | request-response（load-v2 + gate-state 并行） | `packages/infinite-canvas/src/components/FlowCanvas.tsx:353-354`（并行首拉）+ `VariantWall.tsx`（53 全屏剧场：hero 主角 + 底部信息条的信息层级） | role-match |
| `packages/portal/src/components/ReasonDialog.tsx`（NEW：54 C-4 复刻） | component | event-driven | `packages/infinite-canvas/src/components/gate/GateCenterBlock.tsx`（confirming state + 必填理由 1-500 + 二次确认） | exact |
| `packages/portal/src/pages/ToonflowEmbed.tsx`（NEW） | component | — | 无仓内 iframe 先例（RESEARCH §State of the Art）；壳结构 = DeliveryPage 页壳 | scaffolding only |
| `packages/portal/src/services/portalApi.ts`（NEW：薄 re-export/组装层） | service | request-response | `packages/infinite-canvas/src/services/canvasApi.ts:53-120`（apiCall/fetchProjects/loadCanvasGraph/fetchGateState/gateOps 全部直接 import 复用） | exact（复用而非重写） |
| `src/app.ts`（MODIFY：/portal 挂载 + /canvas 302 + 注入中间件） | server wiring | file-I/O | `src/app.ts:187-204`（岛挂载模式 1——portal 三前缀照抄）+ `:236-252`（fallback 顺序敏感） | exact |
| `src/routes/canvas/projects.ts`（MODIFY：episodes[].phases 直方图） | route | transform（GROUP BY 扩展） | `projects.ts:37-49`（既有聚合同一位置加一维） | exact |
| `packages/infinite-canvas/src/components/FlowCanvas.tsx`（MODIFY：focus/zone 消费 + topbar 左簇 kap-nav） | component | event-driven | `FlowCanvas.tsx:105-114`（getInitialParams 扩展点）+ `:812-815`（左簇 logo+标题块出让位）+ `AssetLibrary.tsx:828`（setFocusAssetNodeId 调用方先例） | exact |
| `src/skills/defaultSkill.ts`（MODIFY：12→22 + review_gate） | config（契约常量） | transform | `defaultSkill.ts:111-124`（12 条字面量本身——同位重写）+ `phaseRegistry.ts:52-79`（22 条内容来源） | exact |
| `src/skills/contract.ts` + `src/skills/validator.ts`（MODIFY：PhaseDecl.review_gate） | contract | transform | `contract.ts:98-104` + `validator.ts:60-68`（.strict() 字段加一——同位扩展） | exact |
| `scripts/verify-phase-57.ts`（NEW：三方 drift + 探活聚合） | test | file-I/O（解析 + fetch） | `scripts/verify-phase-55.ts:37-175`（khs 解析 + 断言组）+ `verify-phase-54.ts:434-506`（gates.yaml diff + forced-fail）+ `verify-phase-53.ts`（探活/自包含 assert） | exact（三先例拼接） |
| `scripts/verify-phase-30.ts` / `verify-phase-31.ts`（MODIFY：12 条断言 supersede） | test | transform | 自身（expectedPhaseIds 清单替换；31 断言段迁移留指针） | exact |

## Pattern Assignments

### `packages/portal/`（NEW 包）— 照 infinite-canvas 的 vite 骨架缩一档

**Analogs:** `packages/infinite-canvas/vite.config.ts:7-35` + `package.json` + `index.html`。

```typescript
// vite.config.ts（infinite-canvas 同式,两处关键差异标 ★）
export default defineConfig({
  base: '/portal/',                       // ★ 绝对 base（/deliver 在前缀外;director-desk base:'/director-desk/' 先例）
  resolve: { alias: {
    '@': './src',
    '@ic': '../infinite-canvas/src',      // ★ 跨包复用 tokens/UiIcon/services/utils/constants（infinite-canvas alias @kais/flowgraph-v3 同式）
  }},
  server: { proxy: { '/api': 'http://localhost:10588', '/oss': ..., '/assets': ... } }, // dev 可选
})
```
- `index.html`：`<div id="root">` + `<script type="module" src="/src/main.tsx">`（infinite-canvas/index.html:15 同式），`<title>制片门户</title>`（探活断言标记——Pitfall 1 反向利用）。
- tsconfig 引 `../infinite-canvas/tsconfig` 同源配置；React 19 与 canvas 同版本（root/workspace 解析）。
- **import 面清单**（U-07）：`@ic/theme/catppuccin`（v3theme/theme）、`@ic/theme/tokens.css`、`@ic/components/canvas/icons`（UiIcon）、`@ic/services/canvasApi`、`@ic/utils/mediaUrl`、`@ic/constants/phaseRegistry`。跨包相对 import 先例：`src/routes/canvas/v2/import-from-dir.ts:81`。**注意**：canvasApi/mediaUrl 读 `import.meta.env.VITE_OSS_ORIGIN`——portal vite 须同样 define（RESEARCH Runtime State）。

### `kap-nav.ts` — 单源三宿主 custom element

**Analogs:** icons.tsx（自包含可移植源）；消费三态各有先例——React import 副作用注册（任意模块 import 即注册）、静态站 script 标签（`data/web/story-map/index.html:15-16` 资产引入式）、属性驱动形态（UiIcon `kind` 属性同思想）。

```typescript
// 只用平台 API：customElements.define + light DOM + MutationObserver 不需要
class KapNavbar extends HTMLElement {
  connectedCallback() { this.render(); /* attributeChangedCallback → render */ }
  private render() { /* items 由常量定义; data-active/compact 读 attribute; pathname 前缀自判 */ }
}
customElements.define('kap-navbar', KapNavbar)
```
- 项常量 `NAV_ITEMS = [{id:'portal',label:'门户',href:'/portal'},…]` 单处定义（UI-SPEC P-1 词表）。
- 样式注入：元素内 `<style>` 或外链 kap-nav.css——**选外链**（静态站已引 kap-nav.css；React 宿主在 index.html 引同文件，避免双份）。
- React 宿主用法：`main.tsx` 顶部 `import './nav/kap-nav'` + JSX 声明 `<kap-navbar data-active="portal">`（React 19 对 custom element 属性直传支持）。

### `scripts/build-kap-nav.mjs`

**Analog:** `scripts/build.js:39-55`（esbuild 根仓先例）。产物：`data/assets/kap-nav.js`（IIFE）+ `data/assets/kap-nav.css`（`tokens.css` 全文 concat + `kap-nav.css`——token 单源）。`/assets` 挂载已带 cache（app.ts:108 maxAge 1d——产物文件名建议带 hash 或构建时间戳防陈旧缓存，同岛资产惯例）。

### `PipelineRibbon.tsx` — 签名元素（维度同源于 PhaseColumns）

**Analogs:** `PhaseColumns.tsx`（phaseGroup 色 + `P0X` mono 标签 + laneLabel 文法——管线带的色/字词汇全部从这里借）+ `laneGeometry.ts:46-53`（PhaseColumn 形状：index/name/group）。
- 段几何：`PHASE_REGISTRY` 按 sortKey 升序 map → `{code, name, group, sub, khsPrefix, phaseIndex}`；count 直方图 `phases[phaseIndex] > 0` 决定填充。
- tooltip/aria：段 `<button>`（可聚焦、focus-visible 走 tokens.css 既有规则）；tooltip 复用 55 导航器场景头文法（mono P0X + 计数）。
- gate 点（full 档）：`GATE_PIPELINE_ORDER` + `deriveGateId` → gate-state payload 的 gates[] 按 gateId 查四态；红线条目（platformInvisible）不加点（54 U-06）。
- 纯派生函数 `ribbonSegments(registry, counts)` 单独导出——vitest 直测（55 placeNewAsset 纯函数测试同式）。

### `DeliveryPage.tsx` — 组装三既有端点

**Analogs:** 并行首拉 `FlowCanvas.tsx:353-354`（loadCanvas 与 gate-state 并行，互不阻塞首帧）；hero+信息条层级 `VariantWall.tsx`（53 全屏剧场：主角在上、胶片条/详情在下——交付页 hero 在上、管线带+清单在下同构）。
- master 判定纯函数 `pickMaster(p13Nodes)`：canvasType=video + /master/i 命中 → 唯一 video 兜底（A4；单测覆盖三分支）。
- projectId 反查：`fetchProjects()` → `projects.find(p => p.episodes.some(e => e.id === ep))`（Q5）。
- video src：`resolveMediaUrl(node.data.filePath)`（utils/mediaUrl.ts:89-103；/oss 与 /local-file 均原生 Range——app.ts:71/166，零新流播代码）。

### `ReasonDialog.tsx` — 54 C-4 原样复刻

**Analog:** `GateCenterBlock.tsx`（confirming state、textarea min-height 80、必填 1-500、[取消] ghost / [确认驳回] 玫填充、Esc 关闭、禁原生 confirm）。文案逐字用 54-UI-SPEC Copywriting Contract（驳回确认/placeholder）。

### `src/app.ts` 三处改动 — 挂载顺序敏感

**Analogs:** 岛挂载 `app.ts:187-204`（portal 三前缀 /portal /deliver /toonfile 照抄此式，物理插在 :187 岛段、即全局 fallback :238 之前）；302 参数翻译（RESEARCH Code Example——目标写死站内，白名单键，防开放重定向）；注入中间件（新形态：对 `GET /story-map`、`GET /story-map/{extensionless}`、同 director-desk 的 text/html 响应做字符串插入——幂等标记 `data-kap-nav` 已存在则跳过；内存缓存注入结果；不写磁盘）。**红线**：不改 `/` 与全局 fallback 行为（UI-SPEC Do-Not-Regress 6/9）。

### `FlowCanvas.tsx` 两处改动

**Analogs:** `getInitialParams`（:105-114——加 focus/zone 两个 get，同函数内）；加载后一次性消费（`ProjectSelector.tsx:38-42` auto-load 同时机，loadCanvas resolve 后）；topbar 左簇（:812-815 logo+标题块替换为 `<kap-navbar compact data-active="canvas">`，main.tsx 顶部 import 注册；48px topbar 与 :889 calc 不动）。zone→节点解析进 canvasStore 或 FlowCanvas 本地 helper（`PHASE_REGISTRY.find(p=>p.khsPrefix===zone)` → phaseIndex → 首个资产节点 → `setFocusAssetNodeId`）。

### taxonomy 链四处 lockstep + 生成物

**Analogs:** `defaultSkill.ts:111-124`（12 条字面量同位重写为 22 条——id 用 khsPrefix（p01/p02/p03/p035/p04/p06/p07/p08/p09/p09b/p09c/p10/p10c/p11a0/p11a/p11b/p11c/p12a/p12b/p13/p14/p15）、order=sortKey 序、label=注册表 name、requires_review=有门、review_gate=derivedGateId 或 ''）；字段扩展先例 = 53 candidateEnvelope 的 canvasAssetSchema 扩展（contract.ts + validator.ts + spec 文档三处同步节奏）。SKILL-CONTRACT.md:145-157 PhaseDecl 表加一行 `review_gate?: string`；skill-author-guide.md §2.2 同步。**生成物**：`npx tsx scripts/gen-movie-v1-manifest.ts` 再生 JSON（verify-phase-33:194-197 逐字断言就会绿）。

### `scripts/verify-phase-57.ts` — 三先例拼接

**Analogs:** khs YAML 解析 `verify-phase-54.ts:84-134`（js-yaml 读 gates.yaml + diffCatalogAgainst）；注册表等价断言 `verify-phase-55.ts:113-175`（A 集合等价/B 逐值/C 归组/D 顺序 四断言组式样）；forced-fail `verify-phase-54.ts:497-506`；HTTP 探活 fetch 断言（自包含 async main + assert 收集 + process.exit）。
- 三方断言组：T1 taxonomy id 集 ≡ PHASE_REGISTRY khsPrefix 集（双向 diff）；T2 order 单调 ≡ sortKey 序；T3 review_gate 非空 ⇔ requires_review，且值 ∈ GATE_CATALOG derivedGateId 集；T4 无门 phase review_gate 为空串/缺省；T5 registry 加载（loader 路径）后 `/api/v1/skills/phases` 端点口径 22 条（phase-complete.ts 暗礁的反向断言，Pitfall 4）。
- 探活组：/portal /deliver/1 /toonflow /canvas 302 目标 / 注入 HTML 含 `<kap-navbar`（Pitfall 1 断言）。
- npm 注册 `"verify:phase-57"`（package.json scripts，verify:phase-55 相邻）。

## Shared Patterns

### 岛挂载模式（app.ts:187-204）
**Source:** director-desk/story-map 挂载段
**Apply to:** /portal、/deliver、/toonflow 三前缀 + /canvas 302——全部注册于全局 SPA fallback（:238）之前与 JWT 段（:254）之前。

### 跨包相对 import（D-04 单源消费）
**Source:** `src/routes/canvas/v2/import-from-dir.ts:81`（后端引 packages/infinite-canvas/src/constants/phaseRegistry）；`packages/infinite-canvas/vite.config.ts:8-14`（alias 引 flowgraph-v3）
**Apply to:** portal 引 infinite-canvas 全部共享面（tokens/UiIcon/canvasApi/mediaUrl/phaseRegistry）；FlowCanvas 引 kap-nav 源。禁止复制值。

### 乐观翻转 + 409 幂等 + 回滚（54）
**Source:** `GateCenterBlock.tsx:79-97`（runOp）
**Apply to:** 交付页终审卡。Sequence: 取 p13-gate.reviewId → gateOps → 乐观翻态 → already-resolved 重拉 + toast / 失败回滚 + toast。

### 镜像 + 契约测试（第四次复刻）
**Source:** verify-phase-55.ts + verify-phase-54.ts
**Apply to:** verify-phase-57 三方断言（taxonomy ↔ registry ↔ gates）。脆弱解析即信号注释照抄（verify-schema-drift.ts:36-40 精神）。

### fail-loud 不崩（数据面）
**Source:** `canvasStore.ts:579-598`（guard + warn + early return）
**Apply to:** 管线带聚合失败整条隐藏；交付页 master 缺失走空态；注入中间件异常透传原 HTML。

### Catppuccin inline-style 组件
**Source:** ShotTree.tsx:153-169（overlay 卡）+ SceneShotBrowser（55 新表面语法）
**Apply to:** PortalHome/DeliveryPage/终审卡——inline `React.CSSProperties` + `v3theme`/`--cv-*`，无 CSS modules 无新依赖。

## No Analog Found

| File | Role | Data Flow | Reason / Scaffolding analog |
|------|------|-----------|------------------------------|
| `kap-nav.ts`（custom element 本体） | component（框架无关） | transform | 仓内无 framework-free 组件先例（全部 React）。Scaffolding: icons.tsx 的自包含纪律 + vanilla custom elements 平台 API；契约 = UI-SPEC P-1（属性/档位/项词表） |
| Toonflow iframe 嵌入 | composition | — | 全仓零 iframe 组合先例（RESEARCH 证实）。Scaffolding: DeliveryPage 页壳 + `<iframe src="/">`；降级 = UI-SPEC P-4 文案 + [直开旧版]；无 postMessage 协议（共存期刻意不做） |

## Metadata

**Analog search scope:** `packages/infinite-canvas/src/**`（components/hooks/store/services/theme/utils/constants）、`src/app.ts`、`src/routes/canvas/**`、`src/skills/**`、`scripts/**`（verify-phase-53/54/55、build.js、gen-movie-v1-manifest）、`data/web/*` 实况、khs 只读三文件（gates.yaml/p13_delivery.py/canvas_sync.py）。git 历史未需回溯（无删除复活项）。
**Files scanned:** ~30 源/脚本文件（四路研究报告 + 本会话直读复核）。
**Out of bounds honored:** 未读 56 phase 规划文档；khs 仓只读。
**Pattern extraction date:** 2026-08-22
