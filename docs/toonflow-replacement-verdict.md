# Toonflow 替换评估结论(Portal & Delivery,Phase 57-01)

> **日期**: 2026-08-22
> **对象**: PORTAL-01 书面结论(成功标准 1 前半)
> **基线**: `docs/plan-toonflow-reduction.md`(2026-06-27,262 行已验证依赖图)+ `57-RESEARCH.md` 现状实况 + `57-CONTEXT.md` D-01..D-04 决策

---

## 结论（TL;DR）

**推荐路径 = 混合路线三段式(D-01 倾向固化):**

1. **原型期(本期 57-02 落地)**:门户壳 `/portal` 上线;Toonflow 原位 `/` 共存,降级为嵌入页 `/toonflow`(iframe/SPA fallback 前置注册)。
2. **迁移期**:agent-sync.js / pipeline-results.ts 六端点消费者逐一切到画布/门户 API;Toonflow 降为只读(双写窗口)。
3. **终态**:`/` 接管为门户(root takeover,checklist 见 §终态切换条件)。

**理由**:Toonflow = 26MB 无源码单文件 Vue bundle(`data/web/index.html`,26,865,063 bytes,2026-05-26 构建)——不可维护、无 p09c/p11a0/p12a/p12b/p14/p15 新 phase 面;但 ~179 工作台路由有真实外部消费者(agent-sync.js 经 `/api/project/getProject`、`/api/project/addProject` 等六端点,plan-toonflow-reduction.md L23-49 已验证),激进砍断链。混合路线 = 先立门户共存、再逐端点迁移、后接管根。

---

## 基线事实

| 事实 | 数值/形态 | 出处 |
|------|-----------|------|
| 路由总数(减法前) | 254 | plan-toonflow-reduction.md L11-19 |
| 挂载现状 | 172(减法已大部执行) | 57-RESEARCH.md §Sources(L41,现状实况) |
| Toonflow 工作台路由 | ~179 个(~7,000 行) | plan-toonflow-reduction.md L11-19 |
| Toonflow 单文件 | 26,865,063 bytes(data/web/index.html) | 57-RESEARCH.md §Summary-1 |
| Toonflow 数据库 | data/toonflow.db 0 字节未使用 | 57-RESEARCH.md §Summary-1 |
| 真实外部消费者 | agent-sync.js 六端点(getProject/addProject/addScript/addAssets/addAudioAssets/save-v2) | plan-toonflow-reduction.md L23-49 |
| 静态段顺序 | 静态段全部在 JWT 之前(app.ts:254-298);全局 SPA fallback 吞无扩展名 GET(app.ts:238-252) | 57-RESEARCH.md §Summary-1 |
| 四岛拓扑 | 画布 React 19 源码 / story-map+director-desk 预构建 bundle / Toonflow 无源码 | 57-RESEARCH.md §Summary-2 |

> **黑盒注记**:Toonflow bundle 内部行为未验证(无源码)。功能覆盖对照仅基于其路由清单与依赖图(plan-toonflow-reduction.md),黑盒处显式标注「未验证」。

---

## 五维对比

四方案 × 五维打分(1-5,5=优):

| 维度 | A 保留原样 | B 混合路线(推荐) | C 立即全砍自建 | D 第三方框架重写 |
|------|-----------|------------------|----------------|------------------|
| **可维护性** | 1(无源码,改不动) | 4(门户源码在仓) | 4 | 3(框架依赖) |
| **迁移成本** | 5(零成本) | 4(渐进共存) | 1(断六端点消费者) | 1(重写大工程) |
| **功能覆盖(22-phase/16-gate)** | 1(旧 12 阶段词汇,无 p09c/p11a0/p12a/b/p14/p15) | 5(画布/门户按 22-phase 单一注册表) | 5 | 4 |
| **体验** | 2(26MB 单文件,无深链) | 5(深链发码/管线带签名元素) | 5 | 4 |
| **长期路线** | 1(死面) | 5(接管路径清晰) | 3(一次性大爆炸风险) | 2(框架锁定) |
| **合计** | 10 | **23(推荐)** | 18 | 14 |

**B 行总分最高成立**:混合路线在迁移成本与长期路线两维完胜 A/C/D,功能覆盖与体验持平 C 且避开其断链风险。

---

## 工作量估算（person-day）

| 工作分解 | 乐观 | 悲观 | 依据 |
|----------|------|------|------|
| agent-sync.js 六端点迁移 | 2 | 3 | plan-toonflow-reduction.md L23-49(六端点已知) |
| pipeline-results.ts 迁移 | 1.5 | 2.5 | 同上六端点同族 |
| 工作台高频功能覆盖缺口(逐项) | 2 | 4 | 覆盖清单见下;未验证项悲观加档 |
| root takeover 切换(app.ts 静态段 + fallback) | 0.5 | 1 | app.ts:238-252 改指门户构建 |
| 回归验证(画布/门户/四岛) | 1 | 2 | e2e + headless 探针 |
| **合计** | **7** | **12.5** | — |

**覆盖缺口清单**(对照 22-phase 单一注册表 + 16 gate,非 Toonflow 内部黑盒):

| 功能 | 状态 | 估算 |
|------|------|------|
| 项目入口/导航 | 已覆盖(57-02 门户壳) | — |
| 画布创作 | 已覆盖(packages/infinite-canvas) | — |
| 分镜浏览/G16 听审/Gate 中心 | 已覆盖(55/56/54) | — |
| 深链发码(/portal → /canvas 参数翻译) | 已覆盖(57-02) | — |
| story-map/director-desk 链接 | 已覆盖(57-04 navbar 注入) | — |
| 资产注册表管理页 | 部分(assetManager 有管理面,旧 Toonflow 侧栏形态未验证) | 1d |
| 用户/权限配置页 | 缺口(Toonflow 黑盒) | 1-2d(未验证) |
| 模型供应商配置页 | 部分(data/vendor/toonflow.ts 是适配器非 UI) | 1d |

---

## 终态切换条件(root takeover checklist)

**触发条件(全部满足):**
1. 功能覆盖缺口清零(上表「缺口」行归零或降级方案获批);
2. agent-sync.js / pipeline-results.ts 双写窗口结束(六端点全部指向画布/门户 API 且观察期 7 天零异常);
3. `/portal` 门户壳经一轮完整人工 UAT(导航/深链/交付页)。

**切换步骤:**
1. `app.ts:238-252` 全局 SPA fallback 改指门户构建(`data/web/portal/index.html`);`/` 根静态同指;
2. `data/web/index.html`(Toonflow 26MB)归档到 `data/web/archive/`(不删);
3. 静态段顺序复核:门户 SPA fallback 仍在全局 fallback 之前(注册序敏感,57-02 已钉);
4. `npm run verify:phase-57` 全绿 + 人工抽读门户三页面。

**回滚:**
1. fallback 指回 `data/web/index.html`(git revert 单提交);
2. 归档 Toonflow 归位;
3. 双写窗口如未结束,agent-sync 消费者回切旧端点。

---

## 本期已落地项

混合路线①(原型期)的执行证据:

- **57-02**:门户壳 `packages/portal`(vite base `/portal/`)——三路由 `/portal`/`/deliver/:ep`/`/toonflow` + `/canvas` 302 参数翻译 + KapNavbar vanilla custom element + 门户首页(管线带 micro + 深链发码);
- **57-04**:story-map/director-desk navbar 注入(express 响应后处理);
- **57-05/57-06**:`/deliver/:ep` 交付页版面 + G8 终审操作面。

以上四件均经本 phase 各 plan SUMMARY 记录;混合路线②③(迁移期/终态)归后续里程碑。

---

## 终态执行记录(2026-08-23,用户裁决提前切换)

用户裁决「无限画布侧 Toonflow 没有必要保留,彻底去掉」——§终态切换条件按用户指令提前执行(功能缺口按缺口行现状接受降级,双写观察期以 API 层保留替代):

1. **root takeover**:`app.ts` 全局 SPA fallback 改指 `data/web/portal/index.html`(portal 缺失时回退旧根 index);`/` 即制片门户。
2. **/toonflow 嵌入页下线**:`ToonflowEmbed.tsx` 删除,portal 路由收敛为 /portal + /deliver;服务端 `/toonflow*` 302 → /portal(书签兜底)。KapNavbar 词表去掉 Toonflow 项(P-1 词表同步,四项:门户/画布/剧核/3D导演台)。
3. **26MB bundle 归档**:`data/web/index.html` → `data/web/archive/toonflow-index-26mb.html`,连同仅被其引用的 4 个 `*.worker-*.js`(共 ~36MB,归档不删,可随时回滚归位)。
4. **API 层保留**(终态明确豁免):`/api/project/*`、`/api/script/addScript`、`/api/assets/*`、`/api/production/storyboard/addStoryboard` 维持原样——pipeline-results.ts / canvas_sync.py / project-manager.js 的生产写路径,与工作台 UI 无关。`data/vendor/toonflow.ts` 为模型适配器,同样保留。

部署:deploy-portal.sh + deploy-canvas.sh + build:server,10588 重启(canvas 部署 build 同时补齐了此前 ~20 commit 的滞后)。回滚:git revert 本提交 + archive 归位 + 三个 deploy 脚本重跑。
