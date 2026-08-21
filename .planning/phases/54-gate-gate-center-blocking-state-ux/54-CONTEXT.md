# Phase 54: Gate 中心 (Gate Center + Blocking-State UX) - Context

**Gathered:** 2026-08-21
**Status:** Ready for planning
**Mode:** Interactive discuss — 1 领域 × 4 决策(用户单选真值源与同步;呈现/协议缺口/审批语义交 researcher+planner)

<domain>
## Phase Boundary

kmc 16 道 gate 的 pending/approve/reject/waive 状态接入平台并在画布一等呈现——用户一眼看到"管线停在哪道门等你决策",且审批操作在画布内直接回写 kmc,替代 telegram/CLI 审批。

Requirements: GATE-01, GATE-02, GATE-03

</domain>

<decisions>
## Implementation Decisions

### 真值源与同步 (GATE-01)
- **D-01:** 运行时状态真值源 = review-platform REST——`GET /api/v1/reviews`(status/type/source 过滤,content_ref 客户端侧过滤,Phase 49 reviewBridge 已审计该契约:envelope `{data:{items,next_cursor,has_more}}`、limit 截断须翻页)。review-platform 是运行时状态唯一发生地;khs `gates.yaml` 是**定义**非状态
- **D-02:** gate 定义进 kap = 快照 + 契约测试——16 gate 定义(含 p13 三条红线子门结构)固化为 kap 侧 zod 契约 + contract test 守一致(khs 改 gates.yaml 时测试变红);复刻 v2.0 平行声明零漂移模式
- **D-03:** 同步机制 = 服务端轮询 + socket 推——kap 服务端定时轮询 review-platform(建议 15-30s,数值 planner 定)+ diff 后经既有 canvas socket 广播 `gate:state` 事件;前端不直连 review-platform(不暴露内部服务拓扑);新会话打开画布即拉全量快照
- **D-04:** 展示口径 = 四态折叠——平台中间态(PENDING/POLICY_EVAL/APPROVING)折叠为 pending「等你决策」;approve/reject/waive 为展示终态,与 GATE-03 操作目标态对齐;用户不需要知道 POLICY_EVAL

### Claude's Discretion
- **画布阻塞态呈现(GATE-02 未深讨)**——研究/规划时定,但受以下已锁约束:①新会话打开画布即可定位当前阻塞门(待办通知入口必须有);②Phase 53 D-13 已埋 G15 分诊面板嵌入位,gate 中心面板须按该嵌入协议复用而非另起炉灶;③呈现形态候选:泳道/zone 高亮 vs 节点角标 vs 顶部阻塞横幅,gate 面板落位候选:画布侧栏 vs 独立面板——依 frontend-design 纪律出 token 层设计后再实现(见 specifics)
- **GATE-03 协议缺口关闭路径**——reviewBridge.ts 头注释文档在案的 consumer-side gap(kmc poller 等 `resolved/closed` 而平台终态是 `COMPLETE`;`chosen_variant_id`/`resume_from_callback` 字段两侧不存在)必须在本期关闭,否则 GATE-03 成功标准 3("kmc 恢复/继续管线时消费到该决策")不成立。Phase 49 D-11 的"kmc + review-platform 双只读"冻结在本期到期——两侧(至少 khs runner_hooks.py 词汇对齐;必要时 review-platform callback 字段)属契约层修改,依 COORD-01 授权范围。具体方案(改 poller 词汇 vs 改平台终态 vs 双向兼容)researcher 对两侧源码调研后定
- **审批语义映射**——reject ↔ khs `QualityGateRejection`(→ runner rollback/retry 机器,`_gate_guard.raise_if_rejected` 既有);waive ↔ 逃生门 `degraded_pass=True` 语义候选映射(scoring-gates.md);approve 载荷 comment + `choose:<id>` 前向兼容通道沿用(Phase 49 bridge 既有写法);批量审批是否需要——researcher 依真实 gate 密度定
- **操作通道**——候选:复用 Phase 53 D-15 G15 操作桥模式(reviewBridge 扩展 waive/requeue 的同构扩展)作为 gate 三操作的统一通道;是否与 select-winner 的 manifest hook 合流 planner 定
- 轮询间隔数值、gate:state 事件 payload shape、快照缓存策略

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Gate 定义与语义(khs 侧)
- `//data/workspace/kais-hermes-skills/plugins/review_gates/gates.yaml` — 16 gate 清单真值源(p01/p02/p03/p04/p06/p07/p10c/p09c/p11a0/p11a/p11b/p11c/p13×4 含三条红线子门);D-02 快照源
- `//data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/docs/scoring-gates.md` — gate 分层设计(Tier 1/2/3、阈值、逃生门 degraded_pass、双重计费消除)——审批语义映射的领域文档
- `//data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_gate_guard.py` — reject → QualityGateRejection → runner rollback/retry 的既有机器

### 平台契约(已审计)
- `src/lib/reviewBridge.ts` — **必读**:review-platform REST 契约审计(approve 409 语义、列表翻页、content_ref 过滤规则)+ 文档在案的协议缺口(49-D11 冻结到期)——GATE-03 的核心障碍与契约基础都在这
- `//data/workspace/kais-review-platform/` — review-platform 源码仓库(状态机 PENDING/POLICY_EVAL/APPROVING/COMPLETE、callback worker、metadata_json.review_result)
- `src/routes/canvas/v2/select-winner.ts` — best-effort 桥挂载模式(reviewBridge 同位、fire-and-forget、双 backstop)

### 协调约束
- `.planning/specs/COORD-01-khs2-parallel-coordination.md` — khs/review-platform 契约层修改纪律(Phase 53 D-04 收窄版:工作树检查仅代码文件)
- `.planning/phases/53-variant-contract-picker-upgrade/53-CONTEXT.md` — D-13 G15 分诊面板嵌入位协议、D-15 G15 操作桥模式(GATE-03 通道候选复用)

### 需求与路线
- `.planning/REQUIREMENTS.md` §GATE — GATE-01..03 定义
- `.planning/ROADMAP.md` §Phase 54 — 成功标准 3 条(16 gate 状态正确+同步刷新/画布阻塞态+待办入口/审批回写 kmc 全程无 telegram CLI)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/reviewBridge.ts`(258 行)——依赖全注入(baseUrl/fetchImpl/logger)的 bridge 模式;approve 契约 + 分页 + fail-closed 候选过滤(CR-01/WR-01)已验证;GATE-03 通道的直接基座
- canvas socket 基建(`broadcastToProject` + useCanvasSocket)——`gate:state` 事件挂既有通道
- reviewBridge 的 `choose:<id>` comment 通道 + `result.selected` 机器可读通道——approve 载荷既有写法
- Phase 53 D-13 嵌入位协议——G15 分诊面板预留的 gate 中心嵌入接口
- khs runner.py 既有 `QualityGateRejection` handler(rollback/retry)+ 逃生门(降级重跑/预算 3 次/累计 9 次)

### Established Patterns
- 双端契约:kap zod ↔ khs YAML/Python 平行声明 + contract test(D-02 复刻 v2.0)
- 服务端轮询+diff+socket 广播——kap 侧无既有先例(新),但 socket 广播端成熟
- best-effort 桥 fire-and-forget + 双 backstop(select-winner L151-158)

### Integration Points
- review-platform 运行实例:review-nginx 0.0.0.0:8090(nginx)/review-api 8000(容器内);kap 服务端轮询目标
- khs 侧 runner_hooks.py Path 2 poller(30s)+ resume_from_callback——GATE-03 消费端,协议缺口所在
- 画布 zone/泳道结构(Phase 55 将重构 zone 表对齐 22 phase——GATE-02 的泳道高亮须考虑与 55 的衔接,勿做一次性 zone hack)

</code_context>

<specifics>
## Specific Ideas

- **前端设计纪律(用户要求全程应用 /frontend-design):** gate 中心/阻塞态 UI 须先出 token 层设计(复用 catppuccin 体系,不另起 palette);阻塞态是"警报"语义——签名元素候选:当前阻塞门的单一醒目指示(一处发光,其余安静),反对全画布到处红;copy 用审片 vernacular(「等你决策」「放行」「驳回」「豁免」);plan 里 UI 任务须含设计检查步
- **GATE-03 硬约束:** 不关 49-D11 协议缺口(kmc 读不到平台决议)则成功标准 3 不成立——缺口关闭是本期必做项,不是可选优化
- khs + review-platform 两仓库契约层修改已授权(ROADMAP Repo 行),遵守 COORD-01;工作树检查按 53-D04 收窄口径(仅代码文件)
- Phase 53 可并行(无强依赖);gate 面板复用变体选定数据时获益(ROADMAP 原注)

</specifics>

<deferred>
## Deferred Ideas

None — 讨论未超出 phase 范围。(阻塞态呈现/协议缺口方案/审批语义三区未深讨,已列 Claude's Discretion 交 researcher/planner,非新能力。)

</deferred>

---

*Phase: 54-Gate 中心 (Gate Center + Blocking-State UX)*
*Context gathered: 2026-08-21*
