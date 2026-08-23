---
phase: 59-narrow-trigger-stale-cascade
verified: 2026-08-24T04:35:00Z
status: human_needed
score: 13/13 must-haves verified
must_haves_verified: true
overrides_applied: 0
re_verification: false
human_verification:
  - test: "在引擎已配置环境(GOLD_TEAM_URL 指向 :8002)重跑 probe-59-real,确认面板重生成产物真实落画布"
    expected: "段一触发节点 data.filePath 本次新增(/oss/ web 路径)、node:preview 广播、真实引擎接受 ref_images(宿主路径)提交;级联断言同绿"
    why_human: "外部服务集成——本机 :10588 生产环境 GOLD_TEAM_URL 未配置(探针实测),引擎路径走 simulateOnly,无法在本环境程序化验证真实引擎产物落画布(A1);契约形状已由 fake 引擎三模式锁定(S2/S3),但真实 :8002 交互需引擎环境"
  - test: "在生产 :10588 配置 GOLD_TEAM_URL(或裁决保持 simulateOnly)"
    expected: "面板重生成走真实引擎链;若不配置,当前生产行为保持 simulateOnly(成功信号真实但无引擎产物)"
    why_human: "部署/运维裁决,非代码问题——代码链路已全部就位并有行为级证据"
  - test: "真机肉眼确认 stale 角标 UX(角标可见性 + 脉动效果)与重跑竞态的实际观感"
    expected: "面板重生成成功后下游角标实时出现;重跑完成后角标消失;偶发时序下角标短暂复活后由后续 success 收敛(Known Issue #1 已知边界)"
    why_human: "脉动为装饰性动画(UI-SPEC §8 明确不断言,flake-bait);写-写竞态窗口的时序观感需人眼判断是否可接受"
---

# Phase 59: 窄触发 stale 级联 (Narrow-Trigger Stale Cascade) Verification Report

**Phase Goal:** 生成-迭代闭环获得下游感知——仅面板编辑配方重生成与事件芯片换 seed 重跑两条路径,按 per-request 关联把下游节点自动标 stale,角标可见且可一键重跑;编排/批量路径零变化。+ execute 链四断点全修(D-06 ①②③④ + REGEN-02 seed 透传)——级联必须建立在真实成功信号上。
**Verified:** 2026-08-24T04:35:00Z
**Status:** human_needed(全部 must-have 已验证;3 项需人工/引擎环境确认)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

(合并 ROADMAP 5 条 Success Criteria + 四个 PLAN must_haves,去重后 13 条)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1/STALE-01: 面板编辑配方重生成成功 → 下游自动 stale 角标(无需手动) | ✓ VERIFIED | e2e SC1 绿(重跑实证:badge 选择器断言 + getGraph triggerAssetId,全程无 page.reload);真机探针段一绿(4 下游级联、三字段、node:updated socket 直收) |
| 2 | SC2/STALE-02: 事件芯片换 seed 重跑成功 → 下游 stale + seed 真传 | ✓ VERIFIED | e2e SC2 绿(body.regenSource='reroll-seed' + params.seed 数字);S2/S3 dispatch 引擎捕获体 params.seed===777 行为级 |
| 3 | SC3/STALE-03: orchestrate/批量执行 → 零 stale(负向锁死) | ✓ VERIFIED | 三层负向:mock e2e(SC3-negative 含正向对照防假绿)+ 服务端 dispatch(S4-orchestrate 非空洞:200+目标真执行+零 stale;S4-orchestrate-legacy 兜底路径同)+ 真机探针段二(零新增);静态锁(orchestrate.ts 零级联 token) |
| 4 | SC4: stale 节点经既有出口重跑消除;无下游关系节点不受波及 | ✓ VERIFIED | e2e SC4 双出口(面板 stale-rerun-btn + 角标 click)→ orchestrate 子集 → success → 角标 toHaveCount(0);unrel-1 全程零角标;phase52 三件套回归绿(52-01 红线未破,5 文件 22/22 重跑实证) |
| 5 | SC5/D-06①②③④: execute 链四断点全修;引擎故障报 error 不假成功 | ✓ VERIFIED | 断点① `_engine.ts:208-221` 读 raw.outputs.{image,video,audio,thumbnail}(旧键兜底);断点② fsToOssUrl `/mnt/agents/output/` 分支 + ossToEnginePath 双根白名单防穿越;断点③ `_simulate.ts:243-248` catch 后 rethrow,execute/orchestrate error 广播接管;断点④ ref_images 键 + 宿主路径翻译;S3-engine-fail 四断言(error 广播/零 success/零 node:updated/零 stale) |
| 6 | pollEngineTask 对活体形状返回 /oss/ outputUrl,不再恒 null(D-06①②) | ✓ VERIFIED | S2 completed 模式断言 outputUrl==='/oss/jimeng_T6384/output.png';代码实读确认 |
| 7 | ref_images 键名+宿主路径 + image_* model_preference cloud + 保留键纵深防御(D-06④/A3/CR-01) | ✓ VERIFIED | S2(提交体 ref_images 宿主路径、无 reference_images 键、model_preference=cloud、video 无该键)+ S3-cascade CR-01(伪造 ref_images/model_preference/身份键被两道防线拦截) |
| 8 | 成功产物 data.filePath 落库 + node:preview 广播 /oss/ web 路径(A1) | ✓ VERIFIED | 代码 `_simulate.ts:220-241` 完整(outputUrl 非 null → preview 广播 + upsertNode filePath,try/catch 不翻 error);S3-cascade 全链执行(fake 引擎 completed);**注**:落库无直接门断言(见 W1),真机引擎环境确认归 human item 1 |
| 9 | regenSource 契约:execute zod 枚举 + 两窄路径发射 + 既有调用方零通道 | ✓ VERIFIED | execute.ts:37 `z.enum(["panel-regen","reroll-seed"])`;NodeDetailPanel:735 / EventParamsPopover:110 发射;CanvasContextMenu grep=0;canvasApi extra 类型两值联合 |
| 10 | 带标记成功 → DB stale 三字段 + node:updated 契约广播(D-01/D-03/D-05) | ✓ VERIFIED | S3-cascade:node:updated changedFields===["data.stale"] + triggerAssetId + DB down-1 三字段(同一 loadFullGraph 读即 reload 保真);真机探针:evt_ 前缀确定性 id 实证 |
| 11 | 引擎失败 → error 广播 + 零 stale(D-02) | ✓ VERIFIED | execute.ts catch 分支结构性无标记调用(代码实读);S3-engine-fail 负向四件套 |
| 12 | orchestrate 关系表优先读 + 谓词逐字冻结 + 零级联结构 | ✓ VERIFIED | loadFullGraph 优先(L45-48)、谓词 L82-83 逐字保留、零 markStaleDownstream/_stale/regenSource;S4-orchestrate 行为级(blob 从未写入仍 200 执行)。**注**:WR-01 评审修正恢复 legacy blob 兜底(见 Deviations Judged) |
| 13 | 客户端 node:updated → triggerStaleCascade 实时角标;非 stale 载荷静默忽略;scope 守卫;FLAG-3 红线 | ✓ VERIFIED | useCanvasSocket 订阅三件套(接口+两处 callbacksRef+独立 socket.on 注册,不经 normalizeSocketNodeState);FlowCanvas 轻校验(since number + triggerAssetId string)失败纯 return 零 store 写;CR-02 scope 守卫 + 专项 e2e;S5 静态断言 11 条 |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/routes/canvas/_stale.ts` | markStaleAndBroadcast 服务端接缝 | ✓ VERIFIED | 125 行实质实现;深链 stale/migrate(无 index.ts);增量写保最早 since;先落库后广播;WR-03 容错过滤 |
| `src/routes/canvas/_engine.ts` | 引擎适配层契约对齐 | ✓ VERIFIED | ossToEnginePath/submitEngineTask/pollEngineTask 全部导出且实质;RESERVED_PARAM_KEYS 纵深 |
| `src/routes/canvas/_simulate.ts` | 模拟器真化 | ✓ VERIFIED | listNodes 关系表读、扩表五键、rethrow、filePath 落库、CLIENT_PARAM_KEYS 白名单 |
| `src/routes/canvas/execute.ts` | regenSource 契约接线 | ✓ VERIFIED | zod 枚举 + overrides 透传 + 成功块条件标记(仅成功分支) |
| `src/routes/canvas/orchestrate.ts` | 关系表读 + 零级联结构 | ✓ VERIFIED | loadFullGraph 优先 + WR-01 legacy 兜底;谓词逐字冻结;零级联 token(gate 静态断言) |
| `src/routes/canvas/v2/import-from-dir.ts` | fsToOssUrl 导出 + mnt 翻译分支 | ✓ VERIFIED | L202 export + L207-209 分支;另含 r3 workdir 守卫(评审链) |
| `packages/infinite-canvas/.../useCanvasSocket.ts` | node:updated 订阅三件套 | ✓ VERIFIED | 接口+解构+两处 callbacksRef+注册转发(grep 5 处) |
| `packages/infinite-canvas/.../FlowCanvas.tsx` | onNodeUpdated → triggerStaleCascade | ✓ VERIFIED | scope 守卫 + 形状校验 + 级联派发;零 toast/选中/面板副作用 |
| `scripts/verify-phase-59.ts` | 聚合门 | ✓ VERIFIED | 89 断言 + 7 forced-failure 自检;本人重跑 exit 0 |
| `scripts/verify-59-dispatch.ts` | spawn dispatch harness | ✓ VERIFIED | express 真路由 + socket.io 捕获 + 隔离 sqlite;含六模式(含 r2 追加) |
| `packages/infinite-canvas/test/e2e/tests/phase59-stale-cascade.mjs` | SC1-SC4 e2e | ✓ VERIFIED | 5 用例(SC1/SC2/CR-02/SC3/SC4),本人重跑 5/5 绿 |
| `packages/infinite-canvas/test/e2e/probe-59-real.mjs` | :10588 零足迹探针 | ✓ VERIFIED | SKIP 条款+部署纪律头+stripUpdatedAt 深比对+finally 恢复;本人重跑全绿 exit 0 |
| `package.json` | verify:phase-59 注册 | ✓ VERIFIED | L52 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| execute.ts | _stale.ts | setImmediate 成功块 markStaleAndBroadcast | ✓ WIRED | 仅成功分支,try/catch 包裹;catch 分支零调用(代码实读) |
| _stale.ts | flowgraph-v3/ts/src/stale.ts | 相对深链 markStaleDownstream | ✓ WIRED | 无 index.ts 深链(gate 静态锁) |
| _stale.ts | canvasRelationalStore | loadFullGraph/listNodes/upsertNode | ✓ WIRED | 先落库后广播 |
| orchestrate.ts | canvasRelationalStore | loadFullGraph 优先(blob 兜底 WR-01) | ✓ WIRED | S4 双模式行为级 |
| NodeDetailPanel | canvasApi | executeNode extra panel-regen | ✓ WIRED | e2e getCalls 断言 |
| EventParamsPopover | canvasApi | executeNode extra reroll-seed | ✓ WIRED | e2e getCalls 断言 + WR-05 顶层 prompt |
| FlowCanvas | useStale.ts | triggerStaleCascade | ✓ WIRED | e2e 角标实时出现实证 |
| _engine.ts | import-from-dir | fsToOssUrl import | ✓ WIRED | S1/S2 断言 |
| mock server.mjs | socket /ws/projects | regenSource 条件回放 | ✓ WIRED | `if (regenSource) replayStaleCascade(...)`(L432),无条件分支零回放 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| FlowCanvas 角标链 | store stale | 服务端 node:updated → triggerStaleCascade → markStaleDownstream | 是(真机 socket 直收 + DB 落库) | ✓ FLOWING |
| _stale.ts | newlyStale | loadFullGraph → migrate → markStaleDownstream | 是(真机 4 下游级联实证) | ✓ FLOWING |
| _engine.ts | outputUrl | 引擎 GET outputs.* → fsToOssUrl | 是(fake 引擎活体形状;真机引擎待环境) | ✓ FLOWING(契约级) |
| _simulate.ts filePath | data.filePath | pollEngineTask outputUrl → upsertNode | 是(代码+S3 执行;无直接断言,见 W1) | ✓ FLOWING(断言缺口 W1) |

### Behavioral Spot-Checks / Probe Execution

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| 聚合门(本人重跑) | `npm run verify:phase-59` | 89/89 PASS exit 0;forced-failure 7/7 expected-FAIL | ✓ PASS |
| phase59 e2e(本人重跑) | `npx playwright test .../phase59-stale-cascade.mjs` | 5/5 passed (20.2s) | ✓ PASS |
| 5 文件回归(本人重跑) | phase59 + phase52×3 + phase58 | 22/22 passed (1.3m) | ✓ PASS |
| 真机探针(本人重跑) | `node test/e2e/probe-59-real.mjs`(:10588) | 全绿 exit 0:级联 16s/4 下游/三字段/node:updated 直收;段二零新增;净足迹深比对全等 | ✓ PASS |
| phase55-nav flake 佐证 | `npx playwright test .../phase55-nav.mjs`(standalone) | 5/5 passed (12.3s) | ✓ PASS(全量套件中的失败为负载相关 flake,先于本 phase,与本 phase 范围无关) |
| :10588 可达 | curl | HTTP 200 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| STALE-01 | 59-01/02/03/04 | 面板编辑配方重生成成功 → 下游自动标 stale | ✓ SATISFIED | Truth 1/9/10/13;e2e SC1 + 真机探针 |
| STALE-02 | 59-01/02/03/04 | 事件芯片换 seed 重跑 → 下游标 stale | ✓ SATISFIED | Truth 2;e2e SC2 + seed 行为级 |
| STALE-03 | 59-02/59-04 | 编排/批量不触发级联(负向锁死) | ✓ SATISFIED | Truth 3/11/12;三层负向 |

REQUIREMENTS.md 追溯表 STALE-01/02/03 → Phase 59 Complete,与实际相符。无 orphaned requirement(该 phase 映射的三个 ID 全部出现在 plan frontmatter)。

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| canvasApi.ts | 1142-1174 | TODO(前瞻接缝:assets-registry) | ℹ️ Info | **先于本 phase**(blame e0ac4313, 2026-07-31);phase 59 diff 仅触及 executeNode(L377-394)/createNode 注释区,非本 phase 债 |

全部 phase 修改文件零 TBD/FIXME/XXX/占位实现。simulateOnly 保留分支(GOLD_TEAM_URL 未配置/无 prompt/mix|composite)为计划内合法降级,非 stub。

### Deviations Judged as Accepted(有据可查,非 gap)

| Deviation | Judgement | Evidence |
|-----------|-----------|----------|
| WR-01: orchestrate.ts 重新含 o_agentWorkData(plan 59-02 静态锁曾要求 grep=0) | **接受** | 评审修正(59-02 换读后 legacy-blob-only 项目恒 404,与 _simulate 兜底声明矛盾);关系表优先 + blob 兜底,gate 静态锁翻转为「须含兜底」并新增 S4-orchestrate-legacy 行为模式(兜底路径零级联实证);REVIEW-FIX 链 + commit da40449b 记录在案 |
| mock suppressGraphSaved 旋钮(SC4 测试面) | **接受** | 测试仪器(默认 false,reset 复位);被剔除的产品级写-写竞态为 Pitfall 4 已知边界,planner 裁定不治,如实记录 Known Issue(见 W2) |
| simulateOnly 降级分支(GOLD_TEAM_URL 未配置/无 prompt) | **接受** | 计划内合法保留;真机探针如实记录本环境走 simulateOnly |
| cloud 路径 dreamina 不吃 seed(确定性仅本地 ComfyUI) | **接受** | REGEN-02 契约级满足(seed 到达引擎提交体 params.seed + metadata.seed);换 seed 语义靠非确定性达成,SUMMARY/VERIFICATION 措辞一致不伪装 |
| 真机 scope 1/2('phase' 型 legacy 图)级联不可用 | **接受(改善后)** | 原 59-04 发现整图 throw;WR-03 修复为过滤不支持类型、支持子集照常级联(S3-cascade 含 'phase' fixture 断言);该类图 V3 客户端本就不可加载,数据治理遗留 |

### Human Verification Required

见 frontmatter `human_verification`(3 项):
1. **引擎环境补跑 probe-59-real**(GOLD_TEAM_URL 配置环境)——真实引擎产物落画布(A1/SC5 产品侧)确认;本环境生产 :10588 未配置引擎,探针走 simulateOnly 如实记录。
2. **生产引擎配置裁决**——:10588 是否配置 GOLD_TEAM_URL(运维决策)。
3. **真机肉眼 UX 确认**——角标/脉动视觉与重跑竞态观感(脉动装饰性不断言)。

### Warnings(非阻塞)

- **W1(A1 断言缺口):** filePath 落库在聚合门无直接断言(grep verify-phase-59.ts / verify-59-dispatch.ts 零 filePath);代码完整且在 S3-cascade 全链执行,但 reload 可见性未被行为级锁定。低风险(同一 upsertNode 通路已被 D-05 stale 断言证明)。与引擎环境补跑(人检 1)一并闭环最经济。
- **W2(重跑写-写竞态,产品级已知边界):** rerunStaleChain save 自回声 reload 与 running/success 清 stale 的竞态窗口可使角标短暂复活(终态由后续 success 收敛);planner 裁定本 phase 不修,Known Issue 在案,无后续 phase 认领(Phase 60/61 均不覆盖)。
- **W3(legacy 图数据治理):** 'phase' 等不支持 V2 类型的图,级联对该图整体 no-op(WR-03 后支持子集仍级联);无后续 phase 认领,留待数据治理。

### Gaps Summary

无阻塞性 gap。13/13 must-have 全部 VERIFIED:四断点修复有 S1/S2/S3 行为级证据 + 代码实读双重确认;级联正/负向有 mock e2e + 服务端 dispatch + 真机探针三层证据;客户端实时链有 e2e(无 reload)实证;全部 14 个相关 commit 在 git log 中核实;评审链 3 轮修复后 0 critical / 0 warning(迭代 4 复审)。三处 accepted deviations 均有评审/commit 文档链支撑且 gate 已同步更新。剩余事项为环境/人工确认(引擎配置环境补跑 + 生产引擎配置裁决 + UX 肉眼确认),故 status = human_needed 而非 passed。

---

_Verified: 2026-08-24T04:35:00Z_
_Verifier: Claude (gsd-verifier)_
