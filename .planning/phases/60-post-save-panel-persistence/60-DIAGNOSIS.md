# Phase 60 Diagnosis — 真机保存后面板收起 根因裁定

**Date:** 2026-08-24
**Author:** 60-01 executor（诊断先行 plan, RESEARCH F-2/Pitfall 2 强制次序）
**Status:** FINAL（60-03 的分支选择器,逐字消费「Pinned cause」「Fix branch」两行）
**Evidence grade:** Prong 1 = HIGH（真机实测,:10588 部署产物）; Prong 2 = HIGH（vitest 行为证据 + 行级静态实读）

---

## 结论速览（60-03 executor 首读）

> **Pinned cause: ③其他@reload 链锚安全已被三层实证+静态钉死(①id 漂移/②loading 卸载均证伪);自保存后用户可感扰动来自自回声整图 reload 本身(60-02 D-01 自回声跳过即根除);残留低概率收起路径 = loadBackend 瞬时失败时 v3/fixtureSource.ts L99-111 decompose fixture 整图换入(锚必失,结构性在场但需 reload 期 load-v2 throw,非系统性症状源)**
>
> **Fix branch: A(setGraph 语义已对,零生产修复,仅锁)**

裁定依据（60-01-PLAN 裁定规则逐字执行）: Prong1 零漂移（三层差集全 0/0）+ Prong2 候选②不成立（行级静态证据）→ **Branch A**。60-03 任务形态 = 将 `reloadAnchor.test.ts` 扩为永久锁 + 静态锁（render sites 不挂 loading 门、hasData 不回退）,**零生产代码改动**;用户可感症状的根治在 60-02（D-01 自回声跳过,独立 workstream,不在本裁定分支内）。

---

## Prong 1: 真机 roundtrip id diff（实测,2026-08-24 07:3x）

**环境:** `:10588` 部署产物（canvas bundle build+deploy 2026-08-24 07:21 / server `data/serve/app.js` build 03:48 / 进程 122659 运行中）——部署产物与本仓源码同步（mtime 核对,唯一 newer 源文件是本 plan 新增测试文件,不进 bundle）,静态分析与实测作用于同一代码。

**探针:** `npx tsx scripts/diagnose-60-roundtrip.ts --strict`（probe-59-real 零足迹范式:捕获→roundtrip 写→读比对→finally 原图回存+stripUpdatedAt 深比对复核）。

**scope:** `2/1` 选定（31 节点,类型 asset×6/audio×3/script×11/storyboard×7/video×4,全 MIGRATE_SUPPORTED,零 evt_/eventChip 持久化节点;`2001/1` 预检同样通过,按 probe-59-real 选序未轮到）。

**三层结果（原样摘录自探针输出,exit code = 0）:**

| 层 | 对象 | 计数 | 双向差集 | 判定 |
|----|------|------|----------|------|
| 层1 V2（服务端重组稳定性） | loadA.nodes ids vs loadC.nodes ids | 31 vs 31 | loadA→loadC=**0** loadC→loadA=**0** | PASS |
| 层1 锚点抽检 | V2 首个非 evt 节点 | `n-p04`(type=asset) | 在 loadC 同 id 存在 | PASS |
| 层2 V3（完整客户端往返） | adaptedA vs adaptedC 全 id 集 | 62 vs 62（31 资产 + 31 合成事件） | A→C=**0** C→A=**0** | PASS |
| 层3 evt_*（事件重合成确定性） | adaptedA/adaptedC 中 evt_ 前缀子集 | 31 vs 31 | **0** | PASS |
| 层2 锚点抽检 | adaptedA 首个 kind='asset' 节点 | `n-p04` | 在 adaptedC 同 id 存在（detailNode 按 id 重锚可存活） | PASS |

**恢复核对结论:** `[PASS] 恢复(净足迹): 原图回存 HTTP 200;load-v2 深比对原图:全等(剔 meta.updatedAt,净足迹=0)`——:10588 数据零足迹。

**附注:** `adaptedA.warnings=34` 条,全部为 `global 资产 assetType 无法判定（…），默认 "role"` 类信息性回退（adapter 预归一层,id 无关）;`adaptedA.source=v2-migrated`。归因器（wire→loadC 服务端纯透传差集）在层1 非零时才会触发,本次未触发（层1 干净）。

**Prong 1 裁定: 候选①（vm/视图模型 id 派生往返不对称）在真机数据上被实证证伪**——服务端关系表（canvasRelationalStore `upsertNode`/`saveFullGraph`: `node.id` 原样作主键 ON CONFLICT 更新,load-v2 `rowToNode` 直读回）与客户端派生（migrate §14 evt 合成确定性,serialize 事件折叠后重合成同 id）三层全链 id 稳定。

---

## Prong 2: store 重锚 vitest + loading 卸载静态裁定

### 2a. store 重锚语义（vitest,`packages/infinite-canvas/src/store/__tests__/reloadAnchor.test.ts` 3/3 绿）

fixture = phase59 cascadeFixtureGraph 三节点裁剪（trig-1/mid-1/down-1,两条 image 边）,经生产 `adaptV2Graph` 生成 V3 graph——与真机 reload 链同源（loadGraphFromV2/loadInitialGraph 均以 adaptV2Graph 产物喂 setGraph）:

- **a. survive（D-02/D-07 正向）:** setGraph(g1) → 锚定 trig-1 → setGraph(g2)（同构新适配,对象全新）→ `detailNode.id === 'trig-1'`、`selectedNode.id === 'trig-1'`,且引用 `===` g2 派生 nodes 中该项（`!==` g1 旧引用）——锚刷新到新派生模型,非旧引用。
- **b. collapse（D-03/D-07 对称负向）:** 锚定 down-1 → setGraph(g3)（down-1 已删）→ `detailNode === null && selectedNode === null`——同一次 setGraph 内对称诚实收起。
- **c. other-anchor-untouched:** 锚定 trig-1 → setGraph(g3)（删的是 down-1）→ trig-1 锚保持且引用刷新。
- **原子性注记:** setGraph 是单次同步 zustand set（graph/nodes/edges/selectedNode/detailNode 同批落）——**原子 by construction**,无「先 null 后重锚」中间窗口（60-UI-SPEC §1「No intermediate null / no flash」的 store 侧保证）。

### 2b. 候选②（loading 卸载闪断）静态裁定: **不成立**,行级依据

| # | 证据 | 行级 | 结论 |
|---|------|------|------|
| 1 | NodeDetailPanel 两处渲染点 **不被 loading 条件包裹** | FlowCanvas.tsx L1048-1051（timeline 视图）/ L1265（canvas 视图）——仅 viewMode 三元分支,无 loading 门 | reload 期间面板不因 loading 卸载（60-UI-SPEC §1 同裁定,锁定「keep it that way」） |
| 2 | 全屏 LoadingOverlay 仅首载生效 | FlowCanvas.tsx L956 `if (loading && !hasData) return <LoadingOverlay />`;hasData 由 setGraph 置 true（canvasStore.ts L440）,**全仓无任何回退 false 的调用点**（grep: FlowCanvas L188 仅取 selector 零调用;canvasStore 仅 L440 置 true + L569 初始 false） | 首次成功加载后（面板能打开的前提）,reload 期间 `loading && !hasData` 恒假 → 永不再挂全屏 loading → 无卸载闪断 |
| 3 | loadInitialGraph 全程不清空 graph/detailNode | canvasStore.ts L477-493: setLoading(true) → resolveInitialGraph → setGraph（重锚,见 2a）→ finally setLoading(false)——无 setGraph(null)、无 setDetailNode(null) | reload 链不存在任何中间清锚动作 |
| 4 | 面板卸载的唯一触发 | NodeDetailPanel.tsx L85 `if (!node) return null`——仅 detailNode 为 null 时卸载;detailNode 置 null 的全部路径 = setGraph 重锚 miss（Prong 1 已证 id 全等,不会发生）或用户显式关闭（Escape L948 / onClose） | ②的「unmount 杀内部态」前提在 reload 链结构性不存在 |

### 2c. 候选③发现（记录在案,非 Branch B 触发）

- **fixture fallback 换图路径（结构性在场,低概率）:** v3/fixtureSource.ts L94-112——`loadBackend` throw（如 reload 期 load-v2 瞬时失败）→ 自动 fallback `decompose` fixture 整图换入 → id 全体不同 → 重锚必 miss → 面板收起 + 画布被 fixture 替换 + fallback toast。触发需 graph:saved 回声 reload 期 load-v2 恰好 throw（save 已提交、同源 fetch,常规无失败机制）;若真发生,症状必含「画布整体被替换」而非仅面板收起。**判定: 非「真机保存后面板收起」系统性症状源;证据等级 LOW-frequency/结构性在场。** 残留风险留给 60-03/60-05 知悉（若未来要治:hasData 后 reload 失败应保旧图+错误提示,不换 fixture——属新行为变更,超出本 plan A/B 框架,不在 60-03 Branch A 范围内）。
- **部署时效排除:** :10588 当前部署 bundle 与源码同步（2026-08-24 07:21 build+deploy）,症状不能归因于旧构建。
- **真机/mock 差异注记:** 真机 reload 通道仅有 graph:saved（FLAG-2: 真机 health 无 eventCount,health-poll 结构性失活）;mock 另有活跃 health-poll（save 计数 +30s 重复 reload）——mock 承受**更多** reload 仍表现正常,反向佐证 reload 链锚安全。

---

## 最终裁定（60-03 分支选择器,逐字两行）

「**Pinned cause: ③其他@reload 链锚安全已被三层实证+静态钉死(①id 漂移/②loading 卸载均证伪);自保存后用户可感扰动来自自回声整图 reload 本身(60-02 D-01 自回声跳过即根除);残留低概率收起路径 = loadBackend 瞬时失败时 v3/fixtureSource.ts L99-111 decompose fixture 整图换入(锚必失,结构性在场但需 reload 期 load-v2 throw,非系统性症状源)**」

「**Fix branch: A(setGraph 语义已对,零生产修复,仅锁)**」

**60-03 消费指引:**
1. Branch A = reload/re-anchor 链**零生产代码改动**;任务为验证面:reloadAnchor.test.ts 扩为永久锁（已含 survive/collapse/other-anchor-untouched 三 case 基底）+ 静态锁候选（FlowCanvas L1048/L1265 不挂 loading 门、hasData 无回退 false 调用点、loadInitialGraph 无清锚调用——防回归漂移）。
2. PANEL-01 的用户可感修复在 60-02（D-01 savedBy 自回声跳过:自保存根本不 reload）——与本裁定正交,不因 Branch A 减配。
3. fixture fallback 残留路径（Prong 2 §2c）登记知悉即可,本 phase 不修（修 = 新行为变更,越 A/B 框架）。
4. 探针 `scripts/diagnose-60-roundtrip.ts` 可重复运行（--strict 门/exit 2 SKIP 契约）,60-05 verify dispatch 段直接复用。
