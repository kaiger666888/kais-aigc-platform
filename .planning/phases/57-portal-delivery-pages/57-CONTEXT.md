# Phase 57: 平台页面与门户 (Portal & Delivery Pages) - Context

**Gathered:** 2026-08-21
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 4 灰区 × 16 决策全部按推荐接受

<domain>
## Phase Boundary

消除四套前端孤岛并补齐 22-phase 终点的交付面——Toonflow 替换评估出结论与门户壳原型、项目页→画布深链互链、p13 成片交付页(master.mp4 + 交付清单 + G8 终审)、movie-v1.manifest taxonomy 重对齐 22 phase/16 gate。

Requirements: PORTAL-01, PORTAL-02, PORTAL-03, PORTAL-04

</domain>

<decisions>
## Implementation Decisions

### Toonflow 评估口径 (PORTAL-01)
- **D-01:** 评估结论默认倾向 = 混合路线——自有门户壳为主入口,Toonflow 降级为嵌入页共存,终态替换;依据:26MB 无源码不可维护,但 ~179 路由有真实消费者(agent-sync.js 调 getProject/addProject 等,docs/plan-toonflow-reduction.md 已验证依赖图),激进砍会断
- **D-02:** 门户壳技术形态 = kap 内新前端路由——复用既有 express + 前端构建链,不另起部署单元
- **D-03:** 评估维度 = 五维对比(可维护性/迁移成本/功能覆盖对照 22-phase/体验/长期路线)+ person-day 工作量估算;产出书面结论(成功标准 1)
- **D-04:** 原型范围 = 三件套可运行——路由/导航/项目入口,可访问即可;不搬功能、不做静态 mock

### 互链机制 (PORTAL-02)
- **D-05:** 深链格式 = URL 参数式 `/canvas?project=X&ep=Y&focus=<nodeId>&zone=<phase>`——复用 `focusAssetNodeId` + 55-D04 zone 词汇;项目页→画布指定节点/泳道
- **D-06:** 统一导航 = 共享 navbar 组件——四套前端各嵌同款,顶部一致入口;任一页可抵其余三套(成功标准 2)
- **D-07:** 孤岛接入 = 注入式导航条——story-map/director-desk 静态站由部署脚本注入共享 navbar(deploy-story-map.sh 既有链);Toonflow 无源码,以 iframe 嵌门户壳
- **D-08:** 深链状态传递 = 只带定位参数(项目/节点/泳道),各页面自拉数据;无会话耦合

### p13 交付页 (PORTAL-03)
- **D-09:** 位置 = 门户壳内页面 `/deliver/:ep`——22-phase 终点属门户交付面,与 D-02 门户壳一体
- **D-10:** G8 终审接线 = 复用 54 GATE-03 gate 操作通道(approve/reject 经 review-platform 桥回写 kmc)——一套通道三处消费(53 选定/54 gate/57 G8)
- **D-11:** 交付清单数据源 = p13 交付工件经契约透传(canvas_sync 交付清单 → 53 契约链 → 交付页消费);不直扫文件系统不手工配置
- **D-12:** master.mp4 播放 = video 元素 + resolveMediaUrl(与 53 变体墙同链)+ Range 支持(成片大文件流播)

### taxonomy 对齐 (PORTAL-04)
- **D-13:** 真值源链 = 55-D04 zone 单一注册表(22 phase)+ 54-D02 gates 快照(16 gate)为唯一来源,manifest phase_taxonomy 由此生成/对齐;manifest 不自维护
- **D-14:** drift 断言 = 三方 contract test——manifest phase_taxonomy ↔ zone 注册表 ↔ gates 快照一致(扩 55/54 既有 contract test 同链;成功标准 4 的 drift 断言)
- **D-15:** review 点标注 = taxonomy 条目加 `review_gate` 字段标真实 gate ID(与 gates.yaml 对齐;无 gate 的 phase 留空);机器可读,不做文案描述
- **D-16:** 旧 12 阶段迁移 = 直接切换不留 adapter——PROJECT.md 既有 Key Decision"破坏性变更允许,无 legacy adapter"(单参考 skill,升级面小)

### Claude's Discretion
- 门户壳具体路由结构/导航信息架构(依 frontend-design 纪律出 token 层设计)
- Toonflow iframe 嵌入的降级体验细节(postMessage 通信与否)
- 注入式 navbar 的注入机制细节(构建期 vs 部署期后处理)
- 交付页的交付清单字段 shape(依 p13 工件实际结构)
- person-day 估算的颗粒度

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 既有评估与孤岛实况
- `docs/plan-toonflow-reduction.md`(262 行,2026-06-27) — Toonflow 减法方案与**已验证依赖图**(~179 路由/~7000 行/Electron 层/7 空表/agent-sync.js 真实消费);D-01/D03 评估基线
- `data/web/story-map` + `scripts/deploy-story-map.sh` — story-map 静态站与部署链(D-07 注入点)
- `data/web/director-desk`(12M)+ `src/routes/v1/director-desk/*`(router L126-128, 299-301) — director-desk 站点与后端路由
- `data/vendor/toonflow.ts` + `data/toonflow.db` — Toonflow vendored 实体

### 上游契约(消费)
- `.planning/phases/55-navigation-scale/55-CONTEXT.md` — D-04 zone 单一注册表(PORTAL-04 真值源)
- `.planning/phases/54-gate-gate-center-blocking-state-ux/54-CONTEXT.md` — D-02 gates 快照 + GATE-03 操作通道(G8 复用)
- `.planning/phases/53-variant-contract-picker-upgrade/53-CONTEXT.md` — 契约链(交付清单透传/resolveMediaUrl 同链)
- `docs/skill-author-guide/movie-v1.manifest.json` — 现 12 阶段 phase_taxonomy(requirement/art-direction/…/delivery;L53 起),PORTAL-04 改造对象
- `src/skills/contract.ts` + registry 加载链 — manifest 消费端(drift 断言须过 registry 加载)

### 需求与路线
- `.planning/REQUIREMENTS.md` §PORTAL — PORTAL-01..04 定义
- `.planning/ROADMAP.md` §Phase 57 — 成功标准 4 条

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `focusAssetNodeId`(canvasStore)——深链聚焦(D-05)
- express 路由注册表(src/router.ts 254 路由自动生成机制)——门户壳路由挂载点
- reviewBridge/select-winner 桥模式——G8 终审通道(经 54 扩展后)
- resolveMediaUrl——master.mp4 解析(D-12)

### Established Patterns
- 契约测试三方一致(v2.0 模式,55/54 已铺)——D-14 直接扩展
- 静态站部署脚本链(deploy-story-map.sh)——D-07 注入点
- manifest ↔ registry 加载(v1.6,零漂移史)——PORTAL-04 落点

### Integration Points
- 画布前端(packages/infinite-canvas)——深链参数消费端(focus/zone)
- khs canvas_sync p13 交付工件——交付清单数据源(D-11,Wave B 契约同链)
- review-platform approve/reject——G8 终审回写(54 GATE-03 通道)

</code_context>

<specifics>
## Specific Ideas

- **前端设计纪律(用户要求全程应用 /frontend-design):** 门户壳是本期签名 UI——设计须先出 token 层决策(复用 cattpuccin 体系,kap 前端已有语言),门户的信息架构以"项目→画布/交付"动线为主轴;navbar 是四岛共脸,克制、低调、可注入(静态站也要能嵌);交付页面向"收片人"不是"操作员"——master.mp4 大播放器为主角,清单/终审为辅;plan 里 UI 任务含设计检查步
- 22-phase 终点当前无 UI——交付页是管线情感终点,copy 用交付 vernacular(「成片」「交付清单」「终审」)
- PORTAL-01 调研无编码依赖(ROADMAP 注),可先行;PORTAL-04 依赖 55 注册表落地
- 依赖注记:Depends on 55(词汇对齐)——若 55 未执行完,PORTAL-04 的 plan 可先写但 execute 排 55 后

</specifics>

<deferred>
## Deferred Ideas

None — 讨论未超出 phase 范围。

</deferred>

---

*Phase: 57-平台页面与门户 (Portal & Delivery Pages)*
*Context gathered: 2026-08-21*
