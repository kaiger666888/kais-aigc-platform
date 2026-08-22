---
phase: 57-portal-delivery-pages
plan: 05
subsystem: ui
tags: [portal, delivery, master-mp4, pipeline-ribbon, gate-state, react-19]
requires: [57-02（portal 壳/ribbon micro/portalApi 薄层）]
provides:
  - delivery.ts 纯函数层（pickMaster 三分支 / classifyDeliveryNodes 三型 / resolveProjectId 反查 / masterSrc / phaseCountsOf / formatBytes / P13+gate 词汇派生）+ 13 vitest
  - portalApi.loadDelivery（projects 反查 → load-v2 ∥ gate-state 并行；gate 失败不阻塞）
  - PipelineRibbon full 档（24px = 12px 段条 + 段下 10px gate 四态点；段为可聚焦 <button> zone 深链；红线 platformInvisible 不加点）
  - DeliveryPage 完整版面（成片 hero <video controls> / 交付清单三型徽章 / 管线带 full / 终审卡状态显示面 + 57-06 动作条占位）
affects: [57-06 终审操作面（占位注释接 gate-ops）, 57-08 聚合验证]
key-files:
  created: [packages/portal/src/lib/delivery.ts, packages/portal/src/__tests__/delivery.test.ts]
  modified: [packages/portal/src/pages/DeliveryPage.tsx, packages/portal/src/components/PipelineRibbon.tsx, packages/portal/src/services/portalApi.ts]
key-decisions:
  - decision: 交付分类匹配面含 node.id（名/路径 + id）
    rationale: canvas_sync 的 p13 工件节点 id 即 OUTPUT_SLOTS 词汇（a-delivery_package / a-master-qc-summary），DB 实测部分节点无 label/filePath——id 进匹配面才不漏分类；master 判定仍按 A4 名/路径。
  - decision: gateCatalog 跨包引用走相对路径 ../../../../src/lib/gateCatalog（不加新 vite/tsconfig alias）
    rationale: 计划 files_modified 只列 5 文件；相对跨包 import 是仓内既有先例（import-from-dir.ts:81 反向）；tsc/vite/vitest 三链解析通过。
  - decision: full 档段为 <button> + window.location.assign（非 <a>）
    rationale: PATTERNS P-5 裁定段 <button>（可聚焦、focus-visible token 环）；zone 深链经 ribbonHref 三参发码。
  - decision: ribbon full 计数 = phaseCountsOf(load-v2 图)（口径镜像 projects.ts RIBBON_TYPES）
    rationale: 服务端路由不能进前端 bundle，六类型词表镜像常量 + 注释指回真值源；排除 zone/phase/suggestion/variant（57-02 直方图口径同款，防每段恒 filled）。
  - decision: gate-state null 降级横幅用 54 原文减时段子句（无 fetchedAt 可显示）
    rationale: 54 原文含「正在显示 {N 分 N 秒前} 的快照」——fetchGateState 失败返回 null 时无时刻；degrade=true（有快照）时用完整原文。
duration: 55 min
completed: 2026-08-22T09:35:00+08:00
---

# Phase 57 Plan 05: 交付页数据面与版面 Summary

/deliver/:ep 从 57-02 空态壳升级为完整交付页：master.mp4 hero（resolveMediaUrl → /oss 与 /local-file 原生 Range，零新流播代码）+ 交付清单三型徽章（U-12）+ 管线带 full 档（gate 四态点 + 段级 zone 深链）+ 终审卡状态显示面（四态行/note 截断/redline 脚注/降级横幅；动作条留 57-06 display:none 占位）。零新建后端（U-10 三既有端点组装）。

**Tasks:** 2/2 · **Commits:** 2（9707e828 / 48cd76dc）· **Files:** 2 created + 3 modified

## 验证证据

- vitest **21/21** 绿（delivery 13 新增 + ribbon 8 既有回归）；`tsc -p packages/portal --noEmit` 0 错；根 `npm run lint`（tsc --noEmit）0 错
- 护栏 grep 全过：delivery.ts `=== 16|== 16` = 0、`node:fs|fetch(` = 0（phaseIndex 全经 PHASE_REGISTRY p13 条目）；DeliveryPage `成片交付|P13 · 交付` = 0（显示名经 GATE_DISPLAY_NAMES import）；`masterSrc|resolveMediaUrl` ≥ 2；全域 `readdir|/api/delivery` = 0（零 fs 扫描零新端点）
- `bash scripts/deploy-portal.sh` → `curl /deliver/2` 与 `/deliver/1` 均返回 `<title>制片门户</title>`（DELIVER-OK）；部署 bundle 含 cv-rib-btn / 成片终审 / 交付清单为空（新代码已上线）
- 实数据探针：gate-state ep1 返回 16 门、p13-gate = `{display:"pending", label:"成片交付"}`（服务端 fold）；p13 富集项目 load-v2 8 个 p13 节点实shape（a-master_mp4 video /oss/.../master.mp4、a-delivery_package、a-master-qc-* 三族与 U-12 三型一一对应）
- 设计自查（frontend-design 纪律，逐条对 UI-SPEC）：零新 hex（唯一 alpha 衍生 `${v3theme.signal.rejected}66` 为 54 GateCenterBlock 同款先例；focus 环 `var(--cv-select)`）；accent 冷白只出现在原生播放键/已播段与焦点环（终审放行按钮 57-06 才有）；mono 规则（ep 号/gate id/文件名/尺寸 tabular-nums）；hero 2xl=48px 上下；full 档规格 24px=12px 段+10px 点、sub 60%、hover brightness(1.15) 120ms；进场 hero→管线带→清单 --cv-d-panel 240ms + --cv-d-ancestor-step 40ms 一次编排 + pending 点呼吸 --cv-d-running-spin 2.4s（54 同拍），reduced-motion 全静止；无场景维度色

## Deviations

1. **ep=1 反查命中项目 2（消失的外卖，无 p13 节点）而非 66 节点富集项目**：Q5「一集属一项目」在存量库不严格——多项目共享 episodes_id=1。resolveProjectId 取列表序第一个命中（行为诚实：该页渲染空态 + gate 卡正常）；富集项目经 /portal 集行进入即正确。57-08 聚合验证可注记此数据现实。
2. **分类匹配面含 node.id**（名/路径外）：DB 实测部分 p13 工件节点无 label/filePath，id 即 OUTPUT_SLOTS 词汇；不进 id 会漏分类。
3. **gate-state null 横幅省略时段子句**：54 原文的「正在显示 {N 分 N 秒前} 的快照」依赖 fetchedAt；null（拉取失败）时无时刻可用，degrade=true 时用完整原文。
4. **三处文案无 copy 表先例**（未列表格自由裁量）：no-episode（未找到该集/回门户）、页加载失败（交付页加载失败/重试）、hero video error（成片加载失败/直开文件）。
5. **ribbon.ts 未改**（计划 read_first 列为基座）：full 档数据派生 phaseCountsOf 落在 delivery.ts（页面数据层），保持 files_modified 精确；ribbonHref 三参 57-02 已预留。
6. **micro 段边框规则原样保留**：segBarStyle 抽取时发现初版把空 sub 段边框漏了（filled||sub 跳过），已修正回 57-02 语义（仅 filled 跳过侧/底边框）——micro 行为零改动。

## 运维注记

- 部署链不变：`bash scripts/deploy-portal.sh`（本轮已跑，/deliver/:ep 服务新 bundle index-DIMuoMRf.js）。
- hero 播放的 Range：/oss 与 /local-file 均原生（app.ts 既有），绝对 FS 路径（kais-hermes-skills 白名单）经 /local-file?path= 兜底可播。
- 终审动作条/理由框/409 幂等在 57-06：DeliveryPage 终审卡 `data-reserved="57-06-gate-actions"` display:none 占位注释处接 gate-ops（reviewId 取 gate-state p13-gate 条目）。

---

Ready for 57-06（终审操作面）。
