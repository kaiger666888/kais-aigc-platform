# Phase 57: 平台页面与门户 (Portal & Delivery Pages) - Research

**Researched:** 2026-08-22
**Domain:** 门户壳（新前端包 + express 路由）/ 四前端互链（navbar 注入 + 深链）/ p13 交付页 / manifest taxonomy 对齐（kap + 只读 khs）
**Confidence:** HIGH（四路并行代码库研究 + 本会话直读关键文件；所有关键结论有 file:line 证据；无外部库引入）

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Toonflow 评估默认倾向 = 混合路线（门户壳主入口 + Toonflow iframe 共存，终态替换）；基线 = docs/plan-toonflow-reduction.md 已验证依赖图
- **D-02:** 门户壳 = kap 内新前端路由，复用既有 express + 前端构建链，不另起部署单元
- **D-03:** 评估五维对比（可维护性/迁移成本/功能覆盖对照 22-phase/体验/长期路线）+ person-day 估算，书面结论
- **D-04:** 原型三件套可运行（路由/导航/项目入口），不搬功能不做静态 mock
- **D-05:** 深链 = URL 参数式 `/canvas?project=X&ep=Y&focus=<nodeId>&zone=<phase>`，复用 focusAssetNodeId + 55-D04 zone 词汇
- **D-06:** 统一导航 = 共享 navbar 组件，四套前端各嵌同款
- **D-07:** 静态孤岛 = 注入式导航条（deploy-story-map.sh 既有链）；Toonflow 以 iframe 嵌门户壳
- **D-08:** 深链只带定位参数，各页面自拉数据，无会话耦合
- **D-09:** 交付页 = 门户壳内 `/deliver/:ep`
- **D-10:** G8 终审复用 54 GATE-03 gate 操作通道（一套通道三处消费）
- **D-11:** 交付清单 = p13 工件经契约透传（不直扫文件系统不手工配置）
- **D-12:** master.mp4 = video 元素 + resolveMediaUrl + Range
- **D-13:** taxonomy 真值源链 = 55-D04 zone 注册表（22）+ 54-D02 gates 快照（16）；manifest 不自维护
- **D-14:** drift 断言 = 三方 contract test（manifest ↔ zone 注册表 ↔ gates 快照），扩 55/54 既有链
- **D-15:** taxonomy 条目加 `review_gate` 字段标真实 gate ID（无 gate 留空），机器可读
- **D-16:** 旧 12 阶段直接切换不留 adapter

### Claude's Discretion
门户壳路由结构/导航信息架构；Toonflow iframe 降级细节；注入机制（构建期 vs 部署期后处理）；交付清单字段 shape；person-day 颗粒度 → 已在 57-UI-SPEC.md Design Decisions Log（U-01..U-12）裁定。

### Deferred Ideas (OUT OF SCOPE)
Toonflow 本体改造、review-platform 消费侧改造、data/web bak 清理、kmc phases 内部算法（ROADMAP Deferred 节）。

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PORTAL-01 | Toonflow 替换评估结论 + 自有门户壳原型（路由/导航/项目入口） | §1 减法方案现状（254→172 已执行）、agent-sync 真实消费链、门户挂载三模式（§2）；评估基线数据齐 |
| PORTAL-02 | 四套前端互链——项目页→画布深链 + 统一导航 | §3 画布参数现状（projectId/episodesId 已读、focus/zone 缺）、focusAssetNodeId 全链、四岛服务拓扑与注入点（§4） |
| PORTAL-03 | p13 交付页（master.mp4 + 交付清单 + G8 终审） | §5 p13 工件落点（load-v2/canvas_nodes/o_assets）、§6 gate-ops/gate-state 通道与四态、Range 支持证据 |
| PORTAL-04 | movie-v1.manifest phase_taxonomy 12→22/16 + review_gate 标注 | §7 manifest 真值源（defaultSkill.ts 内联常量 + 生成脚本）、zod strict 链、12 条断言三处、三方断言缺口 |

</phase_requirements>

## Summary

Phase 57 是 kap 侧为主的门户/交付/契约面（khs 只读，零修改）。四路研究覆盖全部落点，最重要的六个发现：

1. **门户挂载有现成模式，但有一个陷阱**：express 静态三模式已齐——硬编码岛挂载（app.ts:187-204）、manifest 驱动（app.ts:210-230）、根接管（app.ts:238-252 全局 SPA fallback 把一切无扩展名 GET 送 Toonflow `data/web/index.html`）。**陷阱**：`/portal`、`/deliver/:ep`、`/toonflow` 都是无扩展名路径，门户自己的 SPA fallback 必须注册在全局 fallback **之前**（app.ts 静态段顺序），否则被 Toonflow 吞掉。共存期 `/` 完全不动（U-01）。
2. **四岛是四种宿主形态，navbar 必须单源三态**：画布 = React 19 SPA（packages/infinite-canvas，无 router，FlowCanvas 即全应用）；story-map/director-desk = 预构建静态 bundle（无 React 环境可控）；Toonflow = 26MB 无源码 Vue 单文件。仓内**零 iframe 先例、零 navbar 组件**（全仓 grep 证实）——共享 navbar 只能是 vanilla custom element（U-02），静态站注入只能走 express serve 时响应后处理（U-03：director-desk 无部署脚本、story-map 每次 rm -rf 重部署，deploy 期注入覆盖不了）。story-map 自有站内 Navbar（kais-story-map/src/components/Navbar.tsx）保留共存，不吞不改。
3. **深链的服务端半边几乎免费，画布半边有一个参数既有事实**：画布已读 `?projectId/?episodesId`（FlowCanvas.tsx:105-114 `getInitialParams`，唯一 params.get 调用）并在加载后 replaceState 回写（:372-375）——`/canvas` 重定向只需翻译参数名；`focus/zone` 是新增消费，最省路径 = 图加载后调 `setFocusAssetNodeId`（canvasStore.ts:1090-1091；effect FlowCanvas.tsx:762-786 fitView/高亮/1.5s 清空/未放置 toast 语义 55 已锁「只复用不改」）。
4. **交付页零新建后端成立**：三个既有端点组页——`POST /api/canvas/projects`（projects.ts:23-89，episodes[{id,nodeCount}]）、`POST /api/canvas/v2/load-v2`（load-v2.ts:43-91，全图含 phaseName/isWinner）、`GET /api/canvas/v2/gate-state`（gate-state.ts:26-59，16 门四态 payload）。p13 工件已透传：khs p13_delivery OUTPUT_SLOTS = master-mp4/delivery-package/master-qc（p13_delivery.py:55），canvas_sync 经 save-v2 写 canvas_nodes（zod canvasAssetSchema 契约面）——这就是 D-11 的「契约透传」可用形态；结构化 envelope 是 53 Wave B（khs2 v2.4 门控未满足，2026-08-21 时点 Phase 25 未完）。Range 已由 `/oss`（app.ts:71 acceptRanges:true）与 `/local-file`（app.ts:166 sendFile）原生承担，D-12 无需任何新代码。**G8 = p13_delivery 门**：khs gates.yaml:173 注释「Gate 8: delivery (after p13_delivery)」；操作通道 `POST /api/canvas/v2/gate-ops`（gate-ops.ts:24-38 schema：reviewId + action + reason 1-500；409 幂等成功 :78-83）。
5. **PORTAL-04 是四处 lockstep + 三处旧断言改写**：manifest 真值源是 `src/skills/defaultSkill.ts:111-124` 内联常量（docs JSON 是生成物，gen-movie-v1-manifest.ts:13-18）；加 `review_gate` 字段要同改 contract.ts:98-104 + validator.ts:60-68（`.strict()` 拒新键）+ SKILL-CONTRACT.md:145-157 + skill-author-guide.md §2.2，否则 verify-phase-28 漂移测试变红。数 12 断言在 verify-phase-30.ts:263-290,420-422 与 verify-phase-31.ts:141-148（31 的 OLD_* 快照自declared不可改——需显式 supersede 裁决）。**运行时暗礁**：phase-complete.ts:53-55 `phaseDecl?.requires_review ?? false`——phase id 改名会静默丢失 review gating，新契约测试必须断言 review_gate ↔ requires_review 一致。
6. **管线带数据零新表**：canvas_nodes 已有 `phase_index/phase_name` 列（database.d.ts:39 起）——projects.ts 增量 GROUP BY 即得每集 phase 直方图（U-08），无需迁移。

**Primary recommendation:** 8 plans / 4 waves。Wave 1 = 评估文档（57-01）+ 门户壳骨架与 navbar 与门户首页（57-02）+ taxonomy 对齐与三方契约测试（57-07，仅依赖已完成的 55）；Wave 2 = 画布深链消费与 topbar 内嵌（57-03）+ 静态站注入（57-04）+ 交付页数据与版面（57-05）；Wave 3 = G8 终审操作面（57-06）；Wave 4 = 聚合验证（57-08，依赖 03/04/05/06/07 全部）。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 门户壳页面（/portal、/deliver、/toonflow） | 新前端包 packages/portal（浏览器） | kap 后端（仅静态挂载 app.ts） | D-02 复用 express；页面数据全走既有 /api |
| 共享 navbar | vanilla custom element 单源（packages/portal/src/nav） | esbuild 产物 → data/assets/kap-nav.{js,css} | 三宿主（React×2 + 静态注入）共脸的唯一可行形态 |
| /canvas 深链重定向 | kap 后端（app.ts 一条 302 路由） | — | 参数翻译 project→projectId、ep→episodesId |
| focus/zone 画布消费 | 浏览器（getInitialParams 扩展 + setFocusAssetNodeId） | — | 复用 55 锁定的 effect 语义 |
| 静态站 navbar 注入 | kap 后端（serve 时响应后处理中间件） | — | 覆盖无部署链的 director-desk 与 rm -rf 重部署的 story-map |
| 交付页数据 | 浏览器（load-v2 + gate-state + projects 组装） | kap 后端（零改动） | 既有端点契约面足够 |
| G8 终审操作 | 浏览器（gateOps 复用） | kap 后端 gate-ops.ts（零改动） | D-10 一套通道三处消费 |
| taxonomy 真值源 | src/skills/defaultSkill.ts（22 条 + review_gate） | phaseRegistry/gateCatalog（对齐源） | D-13 manifest 不自维护 |
| 三方 drift 断言 | kap scripts（verify-phase-57 扩展） | khs 文件（只读） | D-14 扩 55/54 链 |

## Standard Stack

### Core（全部既有，零新增安装）
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vite | 根仓 devDeps 既有 | portal 包构建（base '/portal/'） | canvas 同链（D-02）；版本随根仓 |
| express | 5.x | 静态挂载/302/注入中间件 | app.ts 既有三模式照抄 |
| react | ^19.1.0 | portal UI | 与 canvas 同版本，monorepo 一致 |
| esbuild | 根仓既有（build:server 同链） | kap-nav.js 产物构建 | 零新构建工具 |
| zustand | ^5.0.14 | portal 内页面状态（轻） | 仓内唯一 store 方案（如需；纯页面可 useState） |
| zod | ^3 | validator.ts 扩 review_gate | 契约链既有 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3（dev 探查） | 既有 | 验证 canvas_nodes phase_index 分布 / 换算 12→22 断言 fixture | verify 脚本与断言设计 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| 手写 3 路由 pathname switch | react-router | 新依赖违反零新增；3 条路由手写 < 30 行 |
| custom element navbar | React portal + iframe 注入静态站 | 静态站无 React；iframe 嵌 navbar 是嵌套地狱且高度同步难 |
| serve 时 HTML 注入 | deploy 脚本 sed / 构建期后处理 | director-desk 无部署脚本、story-map rm -rf 重部署会丢注入；serve 时单点幂等（U-03） |
| load-v2 组装交付页 | 新 /api/delivery/:ep 聚合端点 | 既有端点契约面已足够（episode 级图 < 几百节点）；新端点=新契约面无收益 |
| projects.ts 增量扩展 | 新 /api/portal/overview | additive 字段零破坏（ProjectSelector 不读新字段）；少一个路由注册面 |

**Installation:** 无——本期零新增依赖（portal 包 devDeps 复用根仓既有版本，不新增外部包）。

**Version verification:** react/zod 版本读自 packages/infinite-canvas/package.json（本会话验证）；vite/esbuild/express 读自根仓 package.json。

## Package Legitimacy Audit

本期不安装任何外部包。portal 新包 devDependencies 仅引根仓已有版本（vite/@types/react 等，workspace 内解析）。若 planner 后续引入新包须回补本节。

## Architecture Patterns

### System Architecture Diagram

```
浏览器四岛（同一 express :10588）                    kap 后端（src/app.ts 静态段顺序敏感）
┌───────────────┐  /portal /deliver/:ep /toonflow   ┌──────────────────────────────┐
│ packages/     │◄── data/web/portal (vite build) ──┤ app.use('/portal') + SPA fb   │
│ portal (NEW)  │                                  │ GET /deliver/{*} → portal idx │ ← 必须在全局
│  KapNavbar ◄──┼─ import 单源 kap-nav.ts           │ GET /toonflow/{*} → portal idx│   fallback 前
│  PortalHome   │                                  │ GET /canvas → 302 /infinite-  │
│  DeliveryPage │                                  │   canvas/?projectId&…&focus&z│
│  ToonflowEmbed│                                  │ 注入中间件(story-map/director- │
└──────┬────────┘                                  │   desk index.html 响应后处理) │
       │ 消费（全既有端点）                          └──────────────────────────────┘
       ├ POST /api/canvas/projects (+phases 直方图)   ┌──────────────────────────────┐
       ├ POST /api/canvas/v2/load-v2 ── canvas_nodes │ src/routes/canvas/*（既有）    │
       ├ GET  /api/canvas/v2/gate-state ──────────── │ src/lib/gateStateService.ts   │
       └ POST /api/canvas/v2/gate-ops ──────────────►│ → review-platform → kmc 回写  │
                                                     └──────────────────────────────┘
画布岛（packages/infinite-canvas，57-03 改）
 getInitialParams 扩 focus/zone → setFocusAssetNodeId（effect 762-786 只复用）
 topbar 左簇 = kap-nav compact（import 同源 custom element）
静态岛（57-04 改 app.ts 注入）
 /story-map /director-desk index.html + <kap-navbar> + /assets/kap-nav.{js,css}
taxonomy 链（57-07）
 PHASE_REGISTRY(22) ─┐
 GATE_CATALOG(16) ───┼→ defaultSkill.ts phase_taxonomy 22 条 + review_gate
                      └→ verify-phase-57 三方 drift 断言（manifest≡注册表≡快照）
```

### Recommended Project Structure
```
packages/portal/                    # NEW（vite, base '/portal/'）
├── index.html                      # <div id="root"> + <kap-navbar> 由 React 渲染
├── vite.config.ts                  # alias ../infinite-canvas/src（tokens/UiIcon/services/utils/constants）
├── src/
│   ├── main.tsx                    # pathname switch: /portal | /deliver/:ep | /toonflow
│   ├── nav/kap-nav.ts              # NEW vanilla custom element（单源三宿主）
│   ├── nav/kap-nav.css             # nav 样式（引用 --cv-*）
│   ├── pages/PortalHome.tsx        # 项目入口 + 集行 + 管线带 micro
│   ├── pages/DeliveryPage.tsx      # hero + 交付清单 + 管线带 full（终审卡 57-06）
│   ├── pages/ToonflowEmbed.tsx     # iframe /
│   ├── components/PipelineRibbon.tsx
│   └── components/ReasonDialog.tsx # 54 C-4 模式（终审驳回理由）
scripts/
├── build-kap-nav.mjs               # NEW esbuild: kap-nav.ts + tokens.css concat → data/assets/
└── verify-phase-57.ts              # NEW 三方 drift + 页面探活聚合
src/app.ts                          # MODIFY: /portal 挂载 + /canvas 302 + 注入中间件（注册序敏感）
src/routes/canvas/projects.ts       # MODIFY: episodes[].phases 直方图（additive）
packages/infinite-canvas/src/components/FlowCanvas.tsx  # MODIFY: focus/zone 消费 + topbar 左簇 kap-nav
src/skills/defaultSkill.ts          # MODIFY: 12→22 + review_gate
src/skills/contract.ts / validator.ts # MODIFY: PhaseDecl.review_gate
docs/skill-author-guide/movie-v1.manifest.json          # REGEN（gen 脚本）
.planning/specs/SKILL-CONTRACT.md   # MODIFY: PhaseDecl 表
```

### Pattern 1: 岛挂载三模式（portal 照抄模式 1）
app.ts:187-204 硬编码岛挂载（static + `app.get("/<name>/{*path}")` SPA fallback，注册于 JWT 之前）；210-230 manifest 驱动；238-252 全局 fallback（Toonflow 兜底，排除表 :240）。portal 用模式 1 ×3 前缀（/portal、/deliver、/toonflow），且必须在 :238 之前注册。

### Pattern 2: custom element 单源多宿主
`kap-nav.ts` 定义 `<kap-navbar>`（light DOM、`data-active`/`compact` 属性驱动）；React 宿主 `import '../nav/kap-nav'` 即注册（bundler 副作用）；静态宿主吃 esbuild IIFE 产物。tokens 单源 = 构建期把 tokens.css concat 进 kap-nav.css（不复制值）。

### Pattern 3: 镜像 + 契约测试（第四次复刻，D-13/D-14）
55（_PHASE_INDEX_MAP ↔ PHASE_REGISTRY，verify-phase-55.ts:113-175 五断言组）与 54（gates.yaml ↔ GATE_CATALOG，verify-phase-54.ts:434-506 diffCatalogAgainst + forced-fail）既有链；57 加第三方：taxonomy ↔ PHASE_REGISTRY（khsPrefix/sortKey/group）↔ GATE_CATALOG（review_gate ↔ 门存在性）。

### Pattern 4: 乐观翻转 + 409 幂等（54 GateCenterBlock.runOp 原样）
GateCenterBlock.tsx:79-97：gateOps → 乐观翻转 → already-resolved 重拉 + toast → 失败回滚。终审卡照抄。

### Anti-Patterns to Avoid
- **门户路由注册在全局 SPA fallback 之后** → /portal /deliver /toonflow 全被 Toonflow 26MB 吞掉（最高频翻车点）。
- **另起 gate 操作通道或新词汇**（通过/打回直译上 UI）→ 违反 D-10 与 54 词表锁定。
- **内联 22 条 phase 中文表**（portal 里复制一份 registry）→ 55-D04 明令禁止的漂移源。
- **注入写磁盘 / deploy 期 sed**：director-desk 无脚本、story-map rm -rf 重部署即丢；且服务进程改 data/web 违反 UI-SPEC 红线 9。
- **taxonomy 只改 JSON 不改 TS**：docs JSON 是生成物（verify-phase-33:194-197 逐字断言），真源在 defaultSkill.ts。
- **改 phase id 而不核 phase-complete.ts:53-55**：requires_review 静默丢 gating。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 媒体流播 | 自写 Range/206 | `<video>` + resolveMediaUrl → /oss 或 /local-file | express.static/sendFile 原生 Range（app.ts:71/83/166） |
| viewport 聚焦 | 自写居中动画 | setFocusAssetNodeId（effect 762-786） | 55 已锁语义；只复用 |
| gate 决策 | 新端点/直连 review-platform | POST gate-ops（gate-ops.ts:42-92） | 54 建好的 fail-closed + 409 幂等通道 |
| phase 词汇 | 内联表 | import PHASE_REGISTRY（跨包先例 import-from-dir.ts:81） | D-04 单源 |
| manifest 生成 | 手编 JSON | scripts/gen-movie-v1-manifest.ts | verify-phase-33 逐字断言生成物 |
| 契约测试 harness | 自写 assert | verify-phase-55/54 脚本模式（自包含 assert + 退出码） | 仓内范式 |

**Key insight:** 57 的「新」集中在**组装**（三个既有端点组交付页、既有 token 组新表面、既有注册表组管线带）；真正从零写的只有 kap-nav 元素与 portal 包骨架。

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `o_skillRegistry` 表里 seed 的 movie-v1 manifest（12 阶段，defaultSkill.ts:206-241 seedDefaultIfEmpty 只在空表跑） | **planner 必须显式裁决**：表已有旧 manifest 时新常量不重播——需一次性重播/更新路径（见 Open Questions Q2） |
| Stored data | db2.sqlite canvas_nodes.phase_index 现存分布（存量图 pre-W6 见 55 研究；55 已落地 fallback zone 承接） | 管线带只呈现注册表内 22 phaseIndex；未映射计数不进带（55 词汇不进门户） |
| Live service config | dev server 10588（nodemon src/** 自动重启）+ canvas vite 3001 | app.ts 改动即热重启；portal dev 可选（直接 build 后 10588 验证即可） |
| Secrets/env vars | `REVIEW_PLATFORM_URL`（gate-state 轮询，gateStateService.ts:160）、`KAIS_HERMES_SKILLS_PATH`（契约测试 env）、`VITE_OSS_ORIGIN`（mediaUrl，portal vite 须同样 define） | 无新增 |
| Build artifacts | data/web/portal（新）、data/assets/kap-nav.{js,css}（新）；data/web/index.html 不动 | deploy 脚本照 deploy-canvas.sh 模式（新 deploy-portal.sh 或并入） |

## Common Pitfalls

### Pitfall 1: 全局 SPA fallback 吞门户路由
app.ts:238-252 对一切无扩展名 GET（排除表 :240 之外）回 Toonflow index.html。/portal、/deliver/123、/toonflow 若在其后注册即 26MB Toonflow 冒充门户。**修法**：门户挂载代码物理写在全局 fallback 之前（同一静态段），verify 断言 `GET /deliver/1` 返回 portal index（title 含门户标记）而非 Toonflow。

### Pitfall 2: 画布 base './' 与 /deliver 路径
canvas vite `base:'./'`（vite.config.ts:7）使其可挂任意前缀；portal 因 /deliver 在 /portal 前缀**外**，必须用绝对 base '/portal/'（director-desk 先例 base:'/director-desk/'，vite.config.ts:5）——用相对 base 时 /deliver/1 页面资产 404。

### Pitfall 3: gate-ops 需要 reviewId 而非 gateId
gate-ops.ts:24-38 schema 是 `{projectId, episodesId, reviewId, action, reason}`——reviewId 从 gate-state payload 的 p13-gate 条目取（GateStatePayload gates[].reviewId，gateStateService.ts:47-54）。display=pending 但 reviewId 缺（legacy 无平台 review 项）时终审卡只显状态不给按钮（54 legacy 行语义），**不得**拿 gateId 硬凑。

### Pitfall 4: requires_review 静默丢 gating
phase-complete.ts:53-55 `phaseDecl?.requires_review ?? false` + inferAssetType(phase) 都吃 taxonomy id。22 条新 id 必须与 khsPrefix 词汇对齐（D-05 zone 参数同词汇），且契约测试断言 `review_gate 非空 ⇔ requires_review === true`。

### Pitfall 5: verify-phase-31 的 OLD_* 快照是「不可改」历史文档
verify-phase-31.ts:48-52 declared DO NOT EDIT（记录 pre-31 常量）。22 化后 31 的等价断言必然红——**supersede 裁决要写进 plan**（31 改为「新 taxonomy 与 55 注册表一致」或把 31 断言段迁移进 verify-phase-57 并在 31 留指针），不能静默改 OLD_*。

### Pitfall 6: story-map 注入与自有 Navbar 双层
story-map bundle 内已有 sticky Navbar（kais-story-map/src/components/Navbar.tsx，Layout.tsx:65 挂载）。kap-nav 注入后出现双层导航——**设计即如此**（全局层 vs 站内层，UI-SPEC P-1 已声明不吞不改）；注入位置放 `<body>` 首位避免与其 sticky top 重叠计算（kap-nav 40px + story-map navbar 会下推——注入用 `position:relative` 文档流置顶，不 fixed 覆盖）。

### Pitfall 7: iframe 嵌 `/` 的自引用
/toonflow 页面本身由 portal SPA fallback 服务（/toonflow 前缀）；iframe src="/" 加载的是根静态（Toonflow 直出）——不是递归。但 iframe 内 Toonflow 的路由跳转（pushState 到 /project 等）只影响 iframe 内部，不影响外层地址栏——共存期这是特性不是 bug（UI-SPEC P-4 注释行管理预期）。

### Pitfall 8: 门户集行「交付」按钮与无 P13 数据
多数存量集没有 p13 节点。交付按钮不置灰（UI-SPEC P-2：空态比禁用诚实）；交付页 load-v2 后 p13 节点为空 → 无成片空态 + [去画布看 P13]。

### Pitfall 9: projects.ts 扩展破坏 ProjectSelector
现消费者 ProjectSelector.tsx:20-36 只读 episodes[].id/nodeCount——新增 `phases` 字段 additive 安全；但**别改**既有字段语义/排序（episodes 按 id 升序，projects.ts:62-81）。

### Pitfall 10: skills registry 表里的旧 manifest 不自愈
loader.ts:48-106 从 o_skillRegistry 行 JSON.parse + validateManifest（invalid 跳过）。如果新常量加了 review_gate 而表内旧行没有——validate 通过（strict 只拒未知键，旧行少键 OK 若字段可选）；但如果 review_gate 必填则旧行全 invalid 被跳过 → registry 空。**裁决**：review_gate 可选字段（`review_gate?: string`，空=无门，D-15「留空」语义），且 plan 需含表内已 seed 行的更新路径。

## Code Examples

### 管线带数据扩展（projects.ts 增量）
```typescript
// src/routes/canvas/projects.ts:37-49 现状 GROUP BY (project_id, episodes_id)
// 扩展：再按 phase_index 聚合（列已存在 database.d.ts canvas_nodes.phase_index）
// episodes: [{ id, nodeCount, phases: Record<phaseIndex, count> }]  // additive
```

### /canvas 302（参数翻译）
```typescript
// src/app.ts 静态段（全局 fallback 之前）
app.get("/canvas", (req, res) => {
  const { project, ep, focus, zone } = req.query;
  const u = new URLSearchParams();
  if (project) u.set("projectId", String(project));
  if (ep) u.set("episodesId", String(ep));
  if (focus) u.set("focus", String(focus));
  if (zone) u.set("zone", String(zone));
  res.redirect(302, `/infinite-canvas/${u.size ? `?${u}` : ""}`);
});
```

### focus/zone 消费（getInitialParams 扩展，FlowCanvas.tsx:105-114 同源）
```typescript
// 图加载完成后（仅一次）：
const focusId = params.get("focus"); const zone = params.get("zone");
if (focusId) setFocusAssetNodeId(focusId);                    // 既有 action
else if (zone) {
  const def = PHASE_REGISTRY.find(p => p.khsPrefix === zone);  // 55 注册表
  const node = def && nodes.find(n => n.data?.phaseIndex === def.phaseIndex);
  if (node) setFocusAssetNodeId(node.id);                      // 复用同一 effect
}
```

### 终审操作（54 runOp 同构）
```typescript
// GateCenterBlock.tsx:79-97 模式照抄；payload 见 gate-ops.ts:24-38
await gateOps(projectId, episodesId, p13Gate.reviewId, "reject", { reason }); // reason 1-500 必填
// 409 → {applied:false, cause:"already-resolved"} → 重拉 state + 幂等 toast
```

## State of the Art

仓内无门户/多页面前端先例（唯一 SPA = infinite-canvas；story-map/director-desk 外部源仓）。navbar 注入与 iframe 共存在本仓为首次引入（全仓 grep 无 iframe 组合先例）；上游业界惯例（custom element 微前端壳、server-side include）与 U-02/U-03 裁决一致，无需外部库。

## Assumptions Log

| # | Assumption | Status |
|---|------------|--------|
| A1 | `/deliver/:ep` 的 `:ep` 用 kap 数字 episodesId（projects/load-v2/gate-ops 全链词汇） | RESOLVED——采纳；kmc ep-slug 由 gateStateService.ts:282-314 桥接不进 URL |
| A2 | G8 = p13_delivery 门（khs gates.yaml:173 「Gate 8: delivery」注释 + gateCatalog p13_delivery/derivedGateId p13-gate） | RESOLVED——U-06 |
| A3 | 交付清单 v1 = load-v2 的 p13 节点列表（成片/交付包/质检三型）；结构化 delivery-package envelope 属 53 Wave B | RESOLVED——U-10/UI-SPEC U-12；khs2 v2.4 Phase 25 未完（2026-08-21），Wave B 不在本期 |
| A4 | master 判定 = p13 节点 canvasType=video 且名/路径含 master（或唯一 video 兜底）；import-from-dir p13 节点 data.filePath 已 OSS 化（import-from-dir.ts:1068-1082 fsToOssUrl） | RESOLVED——判定规则进 57-05 must_haves；canvas_sync 直推节点 filePath 同构（save-v2 zod 面） |
| A5 | 静态注入 = serve 时响应后处理（非 deploy 脚本 sed） | RESOLVED——U-03（D-07 注入机制细节属 discretion；deploy-story-map.sh 部署链不改） |
| A6 | portal vite base '/portal/'（绝对），因 /deliver 在前缀外 | RESOLVED——Pitfall 2；director-desk base 先例 |

## Open Questions (RESOLVED 2026-08-22)

| # | Question | Resolution |
|---|----------|-----------|
| Q1 | 门户接管 `/` 吗？ | 不接管（U-01 共存零破坏）；终态切换属 PORTAL-01 结论执行，另行批准 |
| Q2 | o_skillRegistry 表内已 seed 的 12 阶段行如何更新？ | 57-07 显式任务：upgrade 路径（UPDATE 行 = 新常量 JSON；沿 seedDefaultIfEmpty 的幂等风格，verify 断言加载后 taxonomy 22 条） |
| Q3 | verify-phase-30/31 的 12 条断言怎么办？ | 30：expectedPhaseIds 换 22 前缀清单（源自 PHASE_REGISTRY）；31：OLD_* 快照保留为历史，等价断言段迁移/重指向 verify-phase-57 三方断言（Pitfall 5 supersede 裁决进 plan） |
| Q4 | review_gate 的值用哪个 id 形态？ | derivedGateId（`p03-gate` 形态）——gates.yaml 注释明示 derived gate_id 是 canonical SSoT（gates.yaml:45-52）；与 gateCatalog.deriveGateId 同源可直查 |
| Q5 | 交付页需要 projectId，:ep 只有 episodesId？ | projects 反查归属（episodes[] 含 id）；一集属一项目（canvas_nodes 聚合键），反查唯一 |
| Q6 | 画布 topbar 嵌 navbar 会不会挤？ | compact 档 26px 高、项字号 t3、5 项 + 品牌 ≈ 380px，左簇现有 logo+标题块 ≈ 120px 出让——57-03 验收含实宽截图/headless 探针断言（视图切换簇不被折行） |

## Environment Availability

| Item | Status |
|------|--------|
| dev server 10588 | 运行中（nodemon 热重启；app.ts 改动即生效） |
| review-platform（gate-state/gate-ops 下游） | review-nginx 8090 / review-api 8000（54 期已接线；交付页终审验收依赖其可达，不可达时走 54 降级横幅路径亦可验收 UI 态） |
| khs 仓 | 只读（verify-phase-57 契约测试解析 gates.yaml/canvas_sync.py；KAIS_HERMES_SKILLS_PATH env 可覆盖） |
| khs2 v2.4 Phase 25 | 未完成（2026-08-21）——53 Wave B 门控未满足，本期交付页不依赖 Wave B（A3） |

## Validation Architecture

### Test Framework
- 根仓：无测试框架——`verify-phase-NN.ts` 自包含 tsx 脚本 + npm script（package.json:46-47 verify:phase-54/55 先例）；57 注册 `verify:phase-57`。
- packages/infinite-canvas：vitest（portal 包同配 vitest 纯函数测试——PipelineRibbon 派生/参数翻译）。
- e2e：playwright 既有 test/e2e（packages/infinite-canvas）；portal 探活走 verify 脚本 HTTP 断言（fetch /portal、/deliver/1、/canvas 302、注入 HTML 含 kap-navbar）+ 可选 headless 截图（canvas-real-screenshot.mjs 先例）。

### Phase Requirements → Test Map
| Req | Verification |
|-----|--------------|
| PORTAL-01 | 评估文档存在性/五维/估算断言（57-01 grep 级）+ /portal 探活 + 项目入口渲染（57-02/57-08） |
| PORTAL-02 | /canvas 302 参数翻译断言；画布 focus/zone e2e（headless 断言 fitView 后 zoom/选中）；四岛 navbar HTML 断言（/portal、/infinite-canvas、/story-map、/director-desk、/toonflow 各含 kap-navbar 或其嵌入产物） |
| PORTAL-03 | /deliver/:ep 探活 + master video 元素 src 解析断言 + 清单行 ≥1（有 p13 数据集）+ gate-ops 409/成功路径（54 既有 verify 段复用口径） |
| PORTAL-04 | 三方 drift 断言（manifest taxonomy 22 条 ↔ PHASE_REGISTRY khsPrefix/sortKey/group ↔ GATE_CATALOG review_gate）+ forced-fail（改一条即红）+ registry 加载后 phases 端点返回 22 |

### Sampling Rate
每 plan 的 verify 均为全量确定性断言（无随机抽样）；e2e 冒烟跑真实 dev server（10588）。

### Wave 0 Gaps
无——四需求全部有直接证据链。

## Security Domain

### Applicable ASVS Categories
- V5 Validation（/canvas 302 参数白名单翻译——只重发已知键，防开放重定向：目标恒为站内 /infinite-canvas/）
- V14 Config（注入中间件只处理两个固定岛前缀的 text/html 响应；不做通用 HTML 改写）
- V12 File（/local-file 既有 allowlist 不动；交付页 [打开] 走 resolveMediaUrl 既有通道，不新增文件面）

### Known Threat Patterns
- 开放重定向：/canvas 重定向目标写死站内路径，query 只经白名单键翻译（防 ?next= 注入）。
- HTML 注入面：注入中间件插入的是静态标签串（无用户输入插值）；幂等标记防重复嵌套。
- 26MB iframe：同源（无跨源 postMessage 面）；共存期只读展示，无通信协议（UI-SPEC：postMessage 与否留空 = 不做）。
- gate-ops 通道：54 已含 fail-closed scope 校验（gate-ops.ts:52-60 reviewId 必属当前集候选集，422）——复用不重开。

## Sources

### Primary (HIGH confidence — 本会话直读源码/四路并行研究)
- src/app.ts:66-108（/oss /skills /assets 静态 + acceptRanges）、:169-204（web 根 + 三岛挂载）、:210-230（manifest 驱动）、:236-252（全局 SPA fallback + 排除表）、:254-298（auth 段与 /infinite-canvas 旁路）
- src/router.ts（自动生成 @routes-hash；172 挂载）、src/core.ts:79-154（generateRouter）
- packages/infinite-canvas/src/components/FlowCanvas.tsx:105-114（getInitialParams projectId/episodesId）、:372-375（replaceState 回写）、:762-786（focusAssetNodeId effect）、:809-873（topbar）、:889（calc(100vh-48px)）、:1215-1225（topBarStyle）
- packages/infinite-canvas/src/store/canvasStore.ts:187,1090-1091（focusAssetNodeId）；src/services/canvasApi.ts:510-575（gateState/gateOps）；src/utils/mediaUrl.ts:89-103（resolveMediaUrl）
- src/routes/canvas/projects.ts:23-89；src/routes/canvas/v2/load-v2.ts:43-91；src/routes/canvas/v2/gate-state.ts:18-59；src/routes/canvas/v2/gate-ops.ts:24-92；src/lib/gateCatalog.ts:24-165；src/lib/gateStateService.ts:47-54,160,350-422
- src/skills/defaultSkill.ts:55-152,206-241；src/skills/contract.ts:98-104,176-188；src/skills/validator.ts:60-68,97-111；src/skills/loader.ts:48-106；scripts/gen-movie-v1-manifest.ts:13-18；scripts/verify-phase-33.ts:194-197；scripts/verify-phase-30.ts:263-290,420-422；scripts/verify-phase-31.ts:48-52,141-148；src/routes/v1/pipeline/callback/phase-complete.ts:53-55
- packages/infinite-canvas/src/constants/phaseRegistry.ts:19-91（22 条注册表）；scripts/verify-phase-55.ts:37-175；scripts/verify-phase-54.ts:434-506
- docs/plan-toonflow-reduction.md:11-49,83-125,209-237；scripts/deploy-story-map.sh（20 行无注入步）；data/web/{index.html 26MB, story-map, director-desk, infinite-canvas} 实况
- /data/workspace/kais-hermes-skills/plugins/review_gates/gates.yaml:57-321（16 门；:173 Gate 8 delivery）；pipeline/phases/p13_delivery.py:52-56,286-296（OUTPUT_SLOTS master-mp4/delivery-package/master-qc）；plugins/kais_aigc/canvas_sync.py（save-v2 推送 + o_assets 直写 ~2160-2194）
- src/types/database.d.ts:39-64（canvas_nodes.phase_index/phase_name）；src/lib/assetTypes.ts:25-37（type 'delivery'）；packages/infinite-canvas/src/components/assetManager/assetManagerData.ts:381-382,1412-1413（master_mp4/delivery_package 词汇）

### Secondary (MEDIUM confidence)
- kais-story-map / storyai-3d-director-desk 外部源仓结构（Navbar.tsx、vite base）——只读参考，不改其仓
- 26MB bundle 内部行为（路由 pushState 形态）——黑盒；共存策略不依赖其内部

### Tertiary (LOW confidence)
- None

## Metadata

**Research mode:** 4 parallel codebase sweeps（前端架构/gate+交付数据/taxonomy 链/四岛拓扑）+ 本会话直读复核（gates.yaml Gate 8、assets 挂载、canvas_nodes 列）。
**Out of bounds honored:** khs 仓只读；未读 56 phase 规划文档（无关）；未改任何源文件。
**Research date:** 2026-08-22
