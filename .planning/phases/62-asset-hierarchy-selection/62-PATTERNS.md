---
phase: 62-asset-hierarchy-selection
mapped: 2026-08-24
source: [62-CONTEXT.md, 62-UI-SPEC.md, 62-RESEARCH.md]
---

# Phase 62 Patterns — 新文件 → 既有最近似物映射

> planner/executor 契约：新代码必须按下表「近似物」的既有形态写，除非 RESEARCH 明示差异。
> 三份上游：CONTEXT（D-01..D-13 终裁）、UI-SPEC（approved，C1-C8 组件契约 + Copywriting +
> E2E Hooks 表）、RESEARCH（A-H 实证 + 三处漂移修正 + 构建顺序）。

## P1 · groupCanvasLinkage.ts（新，共享 util）→ assetManagerData.ts 纯函数族

- 近似物：`assetManagerData.ts` 的 `inferSubtype/inferLevel`——模块级纯函数 + 导出常量，无 React、无 store 依赖
- 内容：`findVariantGroupForAsset`（RESEARCH D 节提取提案签名，双前缀 `asset-{id}`/`a-oasset-{id}` 都查——RESEARCH 实测约定）、`getGroupKey`/`getGroupDisplayInfo`/`isSceneGroup`/`isVoiceGroup` 搬迁、三态判定式常量导出（RESEARCH E 节 499-507 原文）
- 红线：AssetLibrary 改为 import 消费（纯函数搬迁零行为差，UI-SPEC 回归锚点）；**判定式不得另造第二套**（D-04）

## P2 · generationConfigKeys.ts（新，键面常量表）→ assetManagerData.ts 常量区

- 近似物：`REAL_TYPE_GROUPS`（导出常量 + 类型注释形态）
- 内容：**RESEARCH F 节修正版口径**——11 嵌套键（transition 已并入 shot_list，非 12）+ 3 扁平键 + 18 报告/审计不可配 + `p10_voice.tts` 钉死 + bgm/foley「占位未接线」态 + 确定性派生类 pre 硬上限 1 五键 + `TYPE_DOMAIN` 域表 + `PHASE_BY_SUBTYPE` 阶段映射静态表（D-01）+ phase_key 显示名表（UI-SPEC Copywriting）
- 禁：照抄 27-CONTEXT 快照（已过时——khs Phase 26 + 27-01 已 shipped cdd12dd，runner 实码为权威）；D-12 e2e 契约测试锁本表

## P3 · AssetHierarchy.tsx（新，第 5 Tab 视图）→ AssetLibrary.tsx 结构形态

- 近似物：AssetLibrary.tsx——同 useRealAssets 数据源 + 同 patchLocal 乐观更新 + 同 toast 通道；UI-SPEC C1-C7 逐组件契约（域树/组卡/批量条/徽标/计数芯片 testid 已成表）
- renderCard 复用（checker FLAG D2）：非 100% 逐字——三态按钮由组件内 `tab` state 门控，层级视图需 per-card-state 模式参数（资产库路径传当前 tab → 行为字节等价；增量 = 模式参数 + singleton 徽标两处）
- 红线：HIER-04——默认视图 `'library'` 不动（canvasStore.ts:1150），既有三 tab 断言面（55-nav/61-debt）零改动

## P4 · generation-config 路由（新，src/routes/canvas/v2/）→ v2 系惯例 + review-gate.ts 文件写守卫

- 近似物：表 CRUD 沿 v2 zod + success/error 信封（RESEARCH A 节）；requirement.json 文件写沿 `review-gate.ts` 守卫模式（tmp + rename 原子写，路径白名单）
- 契约：GET 三源合并（覆盖层 > requirement.json > 键面默认，D-09）+ PUT 覆盖层（钳制 400——确定性派生类 pre>1 拒绝 + 原因文案 D-10）+ best-effort requirement.json 写回三态（RESEARCH B 节：pipe-* 恒 EACCES，本机「已同步」只能经 khs runs base——寻址失败必须如实报「文件面寻址失败——覆盖层已保存」）
- 陷阱（RESEARCH A）：error() 信封 body.code 恒 400，**判错看 HTTP status**；episodesId 来源见 RESEARCH C 节尾

## P5 · initDB.ts relationalCanvasTables append + canvasRelationalStore CRUD → canvas_graph_meta 惯例

- 近似物：复合 PK `(project_id, episodes_id, phase_key)`（RESEARCH A 节确切模式）；boot 时 hasTable 幂等建表，零独立迁移脚本
- 新表：`generation_config_overrides`（PK 三列 + n_candidates/final_candidates/updated_at）

## P6 · e2e 三文件 → phase61-debt.mjs 范式

- 近似物：`__mock` 面 + testMode=1 + `window.__kaisCanvas` + getCalls 三点一线（61 先例）；selector 全走 UI-SPEC E2E Hooks 表（hier-*/config-* + data-count-*/data-write-state 属性，非 innerText）
- 回归面：52-regen/reroll/stale-panel + 55-nav + 61-debt（17 用例，RESEARCH G 节列表）
- 特殊：D-04 一致性是**跨源契约测试**（o_assets search 派生 vs canvas 节点 curation 派生，双 mock 对齐——RESEARCH E 节明示非同源）；D-05 select-winner 断言**勿断 applied:true**（服务端 PATCH-linkage 已存在，客户端 POST 常为幂等 no-op）

## P7 · mock-backend 扩面 → 既有 assets-registry/search + POST /nodes/ 先例

- 缺口（RESEARCH G）：PATCH assets-registry、select-winner、覆盖层路由、多组可 reset 的 search fixture——61 已有的固定 2 条 fixture 形态上加「可 reset 多组」扩展
- 沿 logCall 全尝试记录惯例（409 可观测）

## P8 · 纯函数单测 → node:test（root）形态

- 近似物：`src/lib/__tests__/reviewBridge.test.ts`（node --import tsx --test）——groupCanvasLinkage / generationConfigKeys / 三源合并逻辑的纯函数测试；前端包内若有依赖 React 的用 v3 __tests__ vitest 形态（serialize.test.ts 先例）

## P9 · verify-phase-62.ts 聚合门 → verify-phase-61.ts 三连范式

- 近似物：S 静态锁（常量表口径/判定式单套/默认视图不动）+ B 行为门（e2e 断言）+ F forced-failure 变异样本（锁能红）——61 的 F1-F3 自检形态照搬

## 执行序（RESEARCH Implementation Guidance，planner 分 plan 依据）

util 提取(P1/P2) → 覆盖层表+路由(P4/P5) ∥ mock 扩面(P7) → 层级视图(P3) → 层级化选定 → 冗余配置 UI → e2e 三文件+全量回归(P6) → 聚合门(P9)
