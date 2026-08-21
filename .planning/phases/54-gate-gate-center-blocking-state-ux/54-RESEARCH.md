# Phase 54: Gate 中心 (Gate Center + Blocking-State UX) - Research

**Researched:** 2026-08-21
**Domain:** kmc 16-gate 审核状态接入 review-platform → kap 轮询/广播 → 画布阻塞态 UX + 画布内审批回写闭环(跨三仓:kais-aigc-platform / kais-hermes-skills / kais-review-platform)
**Confidence:** HIGH(双端源码逐行审计 + 活体实例验证;关键结论全部带 file:line 引用)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions(D-01..D-04,LOCKED——planner 不得重开)

- **D-01:** 运行时状态真值源 = review-platform REST——`GET /api/v1/reviews`(status/type/source 过滤,content_ref 客户端侧过滤,Phase 49 reviewBridge 已审计该契约:envelope `{data:{items,next_cursor,has_more}}`、limit 截断须翻页)。review-platform 是运行时状态唯一发生地;khs `gates.yaml` 是**定义**非状态
- **D-02:** gate 定义进 kap = 快照 + 契约测试——16 gate 定义(含 p13 三条红线子门结构)固化为 kap 侧 zod 契约 + contract test 守一致(khs 改 gates.yaml 时测试变红);复刻 v2.0 平行声明零漂移模式
- **D-03:** 同步机制 = 服务端轮询 + socket 推——kap 服务端定时轮询 review-platform(建议 15-30s,数值 planner 定)+ diff 后经既有 canvas socket 广播 `gate:state` 事件;前端不直连 review-platform(不暴露内部服务拓扑);新会话打开画布即拉全量快照
- **D-04:** 展示口径 = 四态折叠——平台中间态(PENDING/POLICY_EVAL/APPROVING)折叠为 pending「等你决策」;approve/reject/waive 为展示终态,与 GATE-03 操作目标态对齐;用户不需要知道 POLICY_EVAL

### Claude's Discretion(research 已定,planner 采信)

- 画布阻塞态呈现(GATE-02)——锁定约束:①新会话打开画布即可定位当前阻塞门(待办通知入口必须有);②Phase 53 D-13 已埋 G15 分诊面板嵌入位,gate 中心面板按该嵌入协议复用而非另起炉灶;③呈现形态依 frontend-design 纪律出 token 层设计后再实现
- GATE-03 协议缺口关闭路径(本期必做,不是可选优化)
- 审批语义映射(reject ↔ QualityGateRejection;waive ↔ degraded_pass 候选;approve 载荷 comment + `choose:<id>`;批量审批依真实 gate 密度定)
- 操作通道(候选:Phase 53 D-15 G15 操作桥同构扩展 vs 新 gate-ops 端点;是否与 select-winner manifest hook 合流)
- 轮询间隔数值、gate:state 事件 payload shape、快照缓存策略

### Deferred Ideas (OUT OF SCOPE)

None——讨论未超出 phase 范围。
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GATE-01 | 16 gate 状态模型接入平台——读 kmc gates.yaml / review-outcomes,同步 pending/approve/reject/waive 状态 | D-02 快照契约(§A:gates.yaml 全量审计 + derive 规则移植)+ D-03 轮询/socket(§D)+ D-04 四态折叠表(§E);运行时状态实来自 review-platform(D-01),review-outcomes 是 kmc 侧消费落点(§C round-trip 链) |
| GATE-02 | 画布阻塞态一等呈现——"管线停在哪道门等你决策"画布高亮 + gate 面板 + 待办通知 | §F:PhaseColumns 阶段列叠加层 + topbar 待办 chip + focusAssetNodeId 跳焦 + 主题 token 清单 + 单一签名元素设计 |
| GATE-03 | 画布内 gate 操作闭环——approve/reject/waive 直接回写 kmc,替代 telegram/CLI | §C:协议缺口全清单 + 三仓协同关闭方案(精确到 file:line 变更点)+ §H 操作通道建议 |
</phase_requirements>

## Summary

本期横跨三仓,核心是一个**文档在案的消费侧协议缺口**(reviewBridge.ts 头注释 L35-57):kmc poller 等待 `state ∈ {"resolved","closed"}` 而平台终态是 `COMPLETE`,且平台的 approve/reject **决策值根本不在 review 记录上**(reject 的 reason 只进 audit trail,GET /reviews 返回的 `disposition` 是路由 disposition AUTO/HUMAN/AI_AUDIT/BLOCK 而非决策)。本期源码审计还发现了 reviewBridge 头注释未记录的**第二个缺口**:`choose:v{N}` comment 走不进任何 kmc 可读通道(comment 只落 audit payload),真正的机器可读通道是 `result.selected`(approve 原子写进 `metadata_json.review_result`)。因此 GATE-03 关闭 = review-platform 三处小改(approve 恒写 decision / reject 补写 review_result / 新增 waive 端点)+ khs 两处契约层对齐(query_review_status 提取 review_result;Path 2 终态词汇对齐 COMPLETE)——全部落在授权的契约层,不碰 22-phase 内部算法。

kap 侧是纯新增:gate 目录快照契约(复刻 canvasAssetSchema ↔ _manifest.py 模式,gates.yaml 用 js-yaml 直接可解析,无需 spawn pytest)、服务端 20s 轮询 + diff + 既有 `broadcastToProject` 广播 `gate:state`(事件命名与 node:state/variant:selected 完全同构)、`POST /api/canvas/v2/gate-ops` 操作通道(reviewBridge 同位扩展 + select-winner L151-158 双 backstop 模式)。UX 按"一处发光"签名元素设计:topbar 待办 chip(入口)+ 阻塞 phase 列高亮(定位)+ gate 面板(操作),全部复用 catppuccin 既有 token。**另发现一个环境级断点:`REVIEW_PLATFORM_URL` 在生产 .env 未配置,默认 `http://review-platform:8090` 从宿主机不可解析(实测 10588 端口 proxy 返回 502 fetch failed)——Phase 49 bridge 在生产从未真正生效过,本期必须先补这条 env**。

**Primary recommendation:** 按 §C 的三仓最小变更清单关闭协议缺口(khs poller 词汇对齐 COMPLETE + 平台 decision 落 review_result + 新增 waive 端点),kap 侧新建 gate 目录契约 + 20s 轮询/gate:state 广播 + 独立 gate-ops 端点(不合流 select-winner),UX 走 topbar chip + PhaseColumns 高亮 + D-13 嵌入位面板三层,先修 REVIEW_PLATFORM_URL env。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Gate 运行时状态真值 | review-platform(DB) | — | D-01 锁定;状态机唯一发生地(state_machine.py L36-41) |
| Gate 定义(16 条) | khs gates.yaml | kap 快照(D-02 契约测试守护) | 定义 SSoT 在 khs;kap 平行声明 + drift 测试 |
| 状态聚合/轮询/diff/广播 | kap 服务端 | — | 前端不直连 review-platform(D-03);broadcastToProject 既有 |
| 阻塞态定位/高亮/待办入口 | kap 前端(infinite-canvas) | — | 画布一等呈现;PhaseColumns/canvasStore 既有 |
| 审批操作(approve/reject/waive) | kap gate-ops 端点 → review-platform | — | 画布内直接回写平台;kmc 消费平台状态 |
| 决策消费(kmc 恢复管线) | khs runner_hooks Path 2 poller | review-outcomes 落档 | 30s 轮询既定;协议缺口关闭点 |
| reject→rollback / waive→放行 | khs 既有机器(不动) | — | QualityGateRejection/逃生门是 runner 内部机制,非契约层 |

---

## A. D-02: gates.yaml 快照 + 零漂移契约测试

### A.1 gates.yaml 权威审计(khs 侧,2026-08-21 现值)

`/data/workspace/kais-hermes-skills/plugins/review_gates/gates.yaml`(331 行,`version: 2`,phase_id-keyed)。**16 条 entry**:

| # | yaml key | derived gate_id(review type) | mode | 备注 |
|---|----------|------------------------------|------|------|
| 1 | p01_hook_topic | p01-gate | blocking | 锁 hook-topic+outline |
| 2 | p02_outline | p02-gate | blocking | |
| 3 | p03_script_audit | p03-gate | blocking | 双 reviewer |
| 4 | p04_character_design | p04-gate | blocking | DIALOGUE-REFORM 后回 p04 |
| 5 | p06_spatio_temporal_script | p06-gate | blocking | |
| 6 | p07_scene_generation | p07-gate | blocking | |
| 7 | p11b_final_render | p11b-gate | **webhook** | 唯一 webhook 模式 |
| 8 | p13_delivery | p13-gate | blocking | 双 reviewer |
| 9-11 | p13_delivery_redline_{emotion,no_cold_open,unfinished} | 均派生 p13-gate | blocking(自动) | **不提交平台**——auto_detect_and_resolve 本地解析(runner_hooks.py L756-887),从不 submit_review |
| 12 | p09c_storyboard_board | p09c-gate | blocking | 2026-08-18 视觉门 |
| 13 | p11a0_iframe_qc | p11a0-gate | blocking | chosen_variant_id 通道门 |
| 14 | p11a_preview_clips | p11a-gate | blocking | |
| 15 | p11c_video_qc | p11c-gate | blocking | approve=waive failed shots 语义在案 |
| 16 | p10c_voice_audit | p10c-gate | blocking | 2026-08-19 音频门 |

**关键派生规则(必须随快照一起移植)**——gate_config.py:
- `_PHASE_PREFIX_RE = ^(p\d+[a-z0-9]*)` + `_REDLINE_SUFFIX_RE = _redline_[a-z_]+$`(L91-92);`derive_gate_id()`(L97-128):strip redline 后缀 → 取完整 sub-phase token + `-gate`(p11a0_iframe_qc → `p11a0-gate`,非 `p11-gate`)
- `_LEGACY_GATE_ID_TO_PHASE_ID`(L136-158):8 个旧式 gate_id 别名(topic-gate/outline-gate/script-gate/render-gate/delivery-gate/p11-gate→p11b_final_render/3 个 redline detector 名)
- `_EXPECTED_GATE_COUNT = 16`(L74)+ 加载时 count 断言(L275-278)+ `cross_validate_phase_gates`(L389)——khs 侧已有自检,kap 契约测试与之对偶
- **平台 review `type` = derived gate_id**(活体验证:live reviews type=`p13-gate`/`p11c-gate`),content_ref=`{episode_id}/{phase_id}`(runner_hooks.py L338)

**面板口径推论**:16 门中只有 **13 个 gate_id 会出现在平台**(红线 3 门本地亚秒自动解析、从不阻塞)。GATE-01"16 gate 各自呈现正确状态"落地为:13 个平台门显示 live 状态,3 个红线门显示静态「自动扫描」态(来自 D-02 快照定义,不期待 review 项)——planner 按此口径出 UI 文案。

### A.2 零漂移模式复刻(既有先例定位)

v2.0 平行声明模式在本仓的三个构件:
1. **kap 平行声明**:`src/lib/canvasAssetSchema.ts`(zod;头注释 L10-11/L181-182 显式指向 khs `_manifest.py MANIFEST_PARAM_SCHEMA L64`)
2. **生成桥**:`schema/generated/frontend-zod-extensions.ts`(由 `python schema/generate_mappings.py` 从 `pipeline-field-map.yaml` 生成——COORD-01 三层接缝之一)
3. **跨仓契约测试**:`scripts/verify-manifest-contract.ts`(npm `verify:manifest-contract`,L17 `KAIS_HERMES_SKILLS_PATH` 默认 `/data/workspace/kais-hermes-skills`,spawn pytest 跑 khs 侧 132 tests)

**D-02 落地建议**:`src/lib/gateCatalog.ts`——zod schema(gates.yaml entry:phase/asset_bus_slots_to_lock/reviewer_role/timeout_sec/callback_url/default_mode/retry_policy)+ 内嵌 derive_gate_id 正则移植 + _LEGACY 别名表 + 16 计数;契约测试 `scripts/verify-phase-54.ts` 内一节(S-gate-catalog):**用 js-yaml(kap 既有依赖 ^4.2.0,package.json L74)直接解析 khs gates.yaml,与快照逐字段 diff**——gates.yaml 是纯 YAML,无需像 manifest 那样 spawn pytest,纯 TS 即可,khs 改动即红。契约测试读同级仓路径复用 KAIS_HERMES_SKILLS_PATH 约定。

## B. review-platform 状态机 + 完整端点面(源码审计 + 活体验证)

### B.1 状态机(app/core/state_machine.py L36-41)

```
PENDING → POLICY_EVAL → {APPROVING, COMPLETE(AUTO/BLOCK)}
APPROVING → {COMPLETE, PENDING, POLICY_EVAL}   # 可回退重开
COMPLETE = 终态(空迁移集)
```

**`disposition` 字段是路由 disposition 而非决策**(schemas.py L11-22:AUTO/HUMAN/AI_AUDIT/BLOCK;submit 时 policy engine 写入 reviews.py L194)。**决策(approve/reject)只存在于 AuditEntry.action + metadata_json.review_result(approve 且带 result 时)**——这是 GATE-03 缺口的根。

### B.2 端点面(全部已审计)

| Endpoint | 位置 | 关键行为 |
|----------|------|---------|
| `POST /api/v1/reviews/` | reviews.py L73-206 | 202;PENDING→POLICY_EVAL→路由;注意**必须带尾斜杠**(nginx 307,khs client 注释 L281-283) |
| `GET /api/v1/reviews/{id}` | reviews.py L214-231 | 返回 ReviewResponse 含 `metadata`(→ review_result 可见) |
| `GET /api/v1/reviews/` | reviews.py L239-302 | 过滤:**status/type/source/priority/sort(id_desc|priority)/cursor/limit≤100**;**无 content_ref 过滤**(D-01 已知);envelope `{data:{items,next_cursor,has_more}}` |
| `POST .../reviews/{id}/approve` | actions.py L324-391 | **须 APPROVING 否则 409**(L350-354);body `{comment?, result?{selected,scores,feedback}}`;`if request.result:` 才原子写 `metadata_json.review_result`(L359-374);comment 只进 audit payload(L373) |
| `POST .../reviews/{id}/reject` | actions.py L399-458 | reason 必填(1-500);**reason 只进 audit payload(L441),不写 metadata——COMPLETE 后 approve/reject 经 REST 不可分辨** |
| `POST .../reviews/batch/approve` / `batch/reject` | actions.py L106-216 / L217-319 | 批量已存在(BatchApproveRequest items[{review_id,reason?,comment?}]) |
| `POST .../reviews/{id}/waive` | **不存在** | 需本期新增(§C R1) |
| `GET /api/v1/audit/timeline` | audit_api.py L320+ | action 过滤含 approve/reject——决策的旁路读取通道(不推荐主用) |
| `GET /api/v1/health` | main.py | 活体 OK:`{"status":"ok","redis":true,"db":true}` |

**Auth 已摘除**(`get_current_client` 无条件返回 "api",auth.py L80-86)——kap 服务端调用无需 token(reviewBridge 审计一致)。

**路由策略活体**:kmc submit 默认 risk_score=0.5 → 不命中 default.yaml 三条规则(risk<0.3 AUTO / >0.7 HUMAN / flagged BLOCK)也不命中 movie_agent_phases.yaml 6 条旧 phase 规则 → 实测 disposition=HUMAN(policies 引擎缺省路由,活体 3/3 HUMAN)。即 **kmc gate 提交今天恒走人工审核**——与"16 道门等你决策"的产品预期一致,无需动策略。

**Callback 通道(worker)**:tasks.py `deliver_review_callback` payload = `{review_id, old_state, new_state, timestamp, source_system, disposition(路由!), result}`(L362-369)——**无 gate_id/decision/event**;contracts/callback-schemas/review-callback.json 声明的 `event: review.approved|rejected` 字段**未实现(契约文件过期)**;且 emit_state_change 只在 `review.callback_url` 存在时投递(events.py L217-234),而 gates.yaml 里 blocking 门 callback_url 全 null → **callback 路对 13 门中的 12 门是死路,poller 是唯一活通道**(p11b webhook 门除外)。

### B.3 活体数据(2026-08-21,GET /api/v1/reviews?limit=100)

全库 **3 条**:id=3 `p13-gate` APPROVING(ep-ccport-test01/p13_delivery,2026-08-19)、id=2 `p11c-gate` APPROVING(带 best_fails/dims 富 metadata)、id=1 `smoke_test`。**真实 review 体量 = 个位数,gate 串行阻塞(一次一门)** → 轮询/翻页压力可忽略;批量审批 UI **不需要**(平台 batch 端点已存在,如日后多集并发可直接用,不建 UI)。

## C. GATE-03 协议缺口关闭(核心交付,精确到 file:line)

### C.1 缺口全清单(全部源码验证)

| # | 缺口 | 位置 | 证据 |
|---|------|------|------|
| G1 | poller 等待 `{"resolved","closed"}`,平台终态 `COMPLETE` | runner_hooks.py L649-651(Path 2)、L539(poll_until_terminal) | 平台 state_machine 只到 COMPLETE |
| G2 | 决策值不在 review 记录:reject reason 只进 audit;approve 仅在带 result 时写 review_result | actions.py L441 / L359-362 | GET /{id} 的 disposition 是路由值 |
| G3 | `choose:v{N}` comment 走不进任何 kmc 可读通道(comment 只落 audit payload L373;callback 不带;GET 不回) | actions.py L373 | **reviewBridge 头注释未记录的新发现**;机器通道 = result.selected |
| G4 | khs client `query_review_status` 只提取 `{review_id,state,disposition,version}`,丢弃 metadata/review_result | review_platform.py L294-311 | suggested_action/chosen 永远无源 |
| G5 | 无 waive 端点 | actions.py 全文 | 只有 approve/reject |
| G6 | callback 契约文件声明的 `event` 字段未实现(过期契约) | tasks.py L362-369 vs review-callback.json | 对 blocking 门 irrelevant(callback_url=null) |

### C.2 推荐关闭方案(三仓最小协同,bidirectional compat)

**设计原则**:决策统一落 `metadata_json.review_result.decision`(approve 已有此袋,补齐 reject/waive 即可全通道统一);kmc 侧只动 plugins 两个契约文件;平台侧只动 actions.py。全部在授权变更面内。

**R1 — kais-review-platform(app/api/v1/actions.py,~25 行)**:
1. `approve_review`(L324):把 L359-362 的条件写改为**恒写** `metadata["review_result"] = {"decision":"approve", ...(request.result.model_dump() if request.result else {})}`(extra_updates 原子通道已在,只改构造)
2. `reject_review`(L399):补 `extra_updates={"metadata_json": metadata}` 写 `{"decision":"reject","reason":request.reason}`(镜像 approve 的原子写法 L364-375)
3. **新增** `POST /{review_id}/waive`:整体镜像 reject(action="waive",`review_result={"decision":"waive","reason":reason}`,reason 必填)+ 注册进本文件头注释端点清单;audit timeline 自然收录 action="waive"(audit stats L178 的 `action.in_(["approve","reject"])` 统计不破坏——additive)
4. (可选卫生)更新 contracts/callback-schemas/review-callback.json 补 decision 字段描述——非功能项,planner 酌情

**R2 — khs(plugins/kais_aigc/review_platform.py,~6 行)**:
`query_review_status`(L294-311)返回 dict 增加 `"result": (data.get("metadata") or {}).get("review_result")`——保持旧四键不动(向后兼容),新增 result 键。

**R3 — khs(plugins/review_gates/runner_hooks.py,~20 行)**:
1. Path 2 终态判定(L649-651):`{"resolved","closed"}` → `{"COMPLETE"} | {"resolved","closed"}`(并集保守兼容)
2. decision 来源(L652-656):优先 `status.get("result",{}).get("decision")` 映射 `{"approve":"approve","reject":"reject","waive":"approve"}`(waive→approve 见 C.4);无 decision 键时保留旧 disposition 兜底映射(degrade envelope 场景)
3. chosen 通道(L661-664):`status.get("chosen_variant_id") or _chosen_from_suggested(outcome.get("suggested_action"))` 之后**再补一路**:`result.selected?.[0]` → 构造 `choose:v{N}` 喂给 `_chosen_from_suggested`(G3/G4 关闭;`_chosen_from_suggested` L612-615 解析器零改动)
4. `poll_until_terminal` L539 同步 COMPLETE 对齐(次要路径,顺手)

**C.3 Round-trip 断言链(planner 直接引用为成功标准 3 的验收叙事)**:

```
画布 gate 面板 [放行/驳回/豁免]
  → kap POST /api/canvas/v2/gate-ops (fail-closed episode/phase 三维匹配)
  → review-platform COMPLETE + metadata_json.review_result.decision ∈ {approve,reject,waive}
  → kmc Path 2 poller ≤30s 读到 COMPLETE + decision
  → resolve_direct(gate_id, decision) → review-outcomes.json 追加(outcome 含 decision/attempt)
      + PipelineState.phases[phase] = approved/rejected
  → set_gate_resolved_hook → canvas_sync.on_gate_resolved(approve→g-{gate_id} 节点 reviewStatus=approved;
      reject→n-{phase_id} 节点 state=error+tags) (canvas_sync.py L1544-1633)
  → runner 恢复:approve 继续;reject → _gate_guard.raise_if_rejected → QualityGateRejection(rollback_to=自身 phase) → runner.py L3223+ rollback/retry
```

kmc 侧消费落档(回答"kmc 怎么持久化已消费决策"):AssetBus `review-outcomes` slot = `<episode_workdir>/.pipeline-assets/review-outcomes.json`,envelope `{"outcomes":[...],"version":1}` 追加式(runner_hooks.py L240-256;asset_bus.py L63-64)。活体 ep-ccport-test01 **尚无该文件**(两门从未被 resolve——缺口本身的可观测证据)。

**C.4 审批语义映射终版(定案)**:

| 平台操作 | kmc 语义 | 机器 | 理由 |
|---------|---------|------|------|
| approve | resolve("approve") → 管线继续 | 既有 | — |
| reject | resolve("reject") → status=rejected → `_gate_guard.raise_if_rejected`(L33-72)→ QualityGateRejection(rollback_to=调用 phase 自身)→ runner rollback/retry(预算 3/resume、9 累计) | 既有,零改动 | reject 不需要 suggested_action 回滚目标——gate guard 回滚到自身 phase 已是既定行为 |
| waive | resolve("approve") → 管线继续 | 决策 provenance 留在平台 review_result + kap 四态显示 | **degraded_pass 逃生门不可映射**:它是 runner 内部"重试预算烧尽"机制(runner.py L3233-3307,靠 fix-required 附 degraded_pass=True 驱动 phase 侧降级),从外部决策触达需深改 runner = 22-phase 内部算法 = 越权;且 gates.yaml 自身已注明 p11c/p10c "approve = waive listed failed shots"——kmc gate 层的 approve 本就承载豁免语义 |

approve 载荷(前向兼容通道沿用):`comment` 自由文本 + `result.selected=[variantIndex]`(机器通道);`choose:v{N}` comment 继续写(人类可读 + 未来 audit 通道),但**契约上以 result.selected 为准**。

## D. D-03: kap 服务端轮询 + gate:state 广播设计

### D.1 服务端(新增,无既有先例但构件全成熟)

- **GateStateService 单例**(`src/lib/gateStateService.ts` 建议):`setInterval` 20s(**推荐值**:kmc poller 自身粒度 30s——kap 20s 保证端到端最坏 ~50s 内可见,而 gate 决策是人尺度分钟/小时级,20s 已远超需求;活体 review 总量 3 条,单次全量列表成本可忽略;低于 15s 无收益纯噪音)
- 拉取:`GET {REVIEW_PLATFORM_URL}/api/v1/reviews?source=kais-movie-agent&limit=100` + next_cursor 翻页(上限 MAX_LIST_PAGES=10,照抄 reviewBridge L139-177 的 fail-closed 翻页)
- 客户端侧过滤(content_ref 无服务端过滤):复用 reviewBridge 的 `leadingPhaseToken` + episode segment 等值匹配(L103-106/L196-208)——**建议把这两个纯函数提取到共享模块**(reviewBridge L92-106 已是纯函数),gate 轮询与 gate-ops 共用,WR-01 前缀碰撞教训不重蹈
- diff 键:`review.id + state + version`(version 是乐观锁计数,state 变必伴 version+1);无变化不广播
- 广播:`broadcastToProject(projectId, "gate:state", {projectId, episodesId, blocking, gates:[...], fetchedAt})`(ws.ts L13-23;房间 `project:{id}`,socket/index.ts L26)。payload 带 episodesId 由客户端过滤(variant:selected 同法,useCanvasSocket.ts L45-51 先例)
- 轮询生命周期:按需启动(lazy:首个 gate-state GET 或 socket subscribe 时起 timer,空画布不空转);进程级单实例(systemd 单进程,无多副本竞争)

### D.2 客户端

- `useCanvasSocket` 增 `onGateState` 回调 + `socket.on('gate:state')`(命名与 node:state/graph:saved/variant:selected 完全同构,L143-221 插入点)
- **新会话全量快照**:新增 `GET /api/canvas/v2/gate-state?projectId&episodesId`(服务端从 GateStateService 缓存即时回,miss 时触发一次即时拉取)——FlowCanvas 载入流程(loadCanvasGraph L300 附近)并行 fetch,不阻塞画布首帧
- **前端不直连 review-platform**:也不走既有 `/api/proxy/reviewPlatform`(route77,router.ts L256)——该 proxy 是浏览器可达的裸转发,gate 中心一律走 canvas 域端点(建议后续单独评估收紧 route77,本期不动)
- gate:state payload shape 建议(四态折叠后的展示模型,别把平台原始态泄给前端——D-04 用户不需要知道 POLICY_EVAL):

```typescript
interface GateStatePayload {
  projectId: number; episodesId: number; fetchedAt: number
  blocking: { gateId: string; reviewId: number; phaseId: string; label: string } | null
  gates: Array<{
    gateId: string          // derived gate_id (p11c-gate)
    phaseId: string         // yaml key (p11c_video_qc)
    display: 'pending' | 'approve' | 'reject' | 'waive' | 'auto'   // auto=红线本地门
    reviewId?: number; updatedAt?: string; note?: string           // note: 驳回理由/豁免理由摘要
  }>
}
```

## E. D-04: 四态折叠全映射表(状态×disposition×decision → 展示态)

| 平台 state | disposition(路由) | review_result.decision | 展示态 | 中文 copy |
|-----------|-------------------|----------------------|--------|----------|
| PENDING | 任意 | — | **pending** | 等你决策 |
| POLICY_EVAL | 任意 | — | **pending** | 等你决策 |
| APPROVING | HUMAN/AI_AUDIT | — | **pending** | 等你决策(主路径——人工门停在此态) |
| COMPLETE | HUMAN | approve(或 R1 落地前无 decision 但有 review_result.selected) | **approve** | 放行 |
| COMPLETE | HUMAN | reject | **reject** | 驳回 |
| COMPLETE | HUMAN | waive | **waive** | 豁免 |
| COMPLETE | AUTO | —(auto_approve 无 review_result) | **approve** | 放行(自动) |
| COMPLETE | BLOCK | — | **reject** | 驳回(系统拦截)——note 标注策略拦截 |
| COMPLETE | HUMAN | 无 decision 无 result(R1 前的历史 approve,**活体 id=2/3 未来可能成此态**) | **approve** | 放行(兼容读法,note 标注 legacy) |
| —(khs 本地) | — | —(红线门,不提交平台) | **auto** | 自动扫描 |

实现要点:折叠函数 = 纯函数 `foldDisplayState(state, disposition, reviewResult)` 放 gateCatalog.ts,单测覆盖全表;**R1 落地后新 review 恒有 decision,legacy 分支只为存量兼容**。注意 gate review 与画布节点级 reviewStatus(NodeBadgesDefault 右下点)是**两个正交轴**——gate 面向管线阻塞,节点 reviewStatus 面向单资产(WRITE-02),UI 不得混用同一角标位。

## F. GATE-02: 阻塞态 UX(呈现 + 嵌入位 + token + 待办入口)

### F.1 画布结构现状(及 Phase 55 兼容性)

- 画布 = 纵向模态泳道(v3/lanes.ts LANE_DEFS L24-40)× 横向阶段列;`PhaseColumns.tsx`(L1-20)**由 useLayout 从各阶段 laid-out 节点中心 x 的 median 投影计算**,读节点 phaseIndex/phaseName 而非硬编码 zone 表——**对 Phase 55 zone 表重构天然鲁棒**(列随节点走,55 重排节点列自动跟随)。阶段→节点数据键:`phaseIndex` + `phaseName`(import-from-dir.ts PHASE_DEFS L88-104 现 13 phase;canvas_sync 侧 `_PHASE_INDEX_MAP` L2321 已是 18 档 W6 编码)
- **gate → 画布定位**:derived gate_id 取 leading p-token(如 `p11c-gate`→`p11c`)→ 匹配节点 phaseName 前缀 / kmc 同步的 `n-{phase_id}` phase 节点 / `g-{gate_id}` review 节点(canvas_sync approve 时写入,L1587)。**不要新建 zone hack**——用 phase 列 + 既有节点键即可,55 无返工
- kmc 侧现状:**pending 态不落画布**(on_gate_resolved 只在 resolution 后触发)——阻塞态定位完全由 kap 侧 gate:state 驱动,不需要 khs 加 pending 节点(避免 khs 变更面扩大)

### F.2 三层呈现(单一签名元素 = 当前阻塞门,一处发光其余安静)

1. **Topbar 待办 chip(入口,必做——满足"新会话打开画布即可定位")**:画布顶栏(ProjectSelector 同区)一枚 `等你决策 · p11c 镜头质检` chip;点击 → ① `setFocusAssetNodeId`(canvasStore.ts L184/L1054-1055)跳焦到阻塞 phase 的代表节点(优先 g-{gate_id} → n-{phase_id} → 该 phase 首个资产节点)② 打开 gate 面板。无阻塞时 chip 隐藏(安静)
2. **PhaseColumns 阻塞列处理(画布内定位)**:阻塞门对应列的列标签 + 左边界线获得唯一的呼吸描边(签名发光位);该列竖带 opacity 从 0.04 提到 ~0.08。实现:PhaseColumns 增可选 `blockingPhaseIndex` prop(纯展示、pointer-events 保持 none),由 FlowCanvas 从 gate store 传入
3. **Gate 中心面板(操作面)**:按 **D-13 嵌入协议**复用 Phase 53 G15 分诊面板嵌入位——53-07 将建 `packages/infinite-canvas/src/components/g15/G15TriagePanel.tsx` + g15Bridge + `POST /api/canvas/v2/g15-ops`(53-07-PLAN L11/L33/L59;53-05 预埋 `canvasApi.g15Ops` sibling;53-06 L155 已注明"adapter 成员通道成为 Phase 54 gate 面板可复用的数据源";53-05 L22 注明"gate 精确过滤归 Phase 54")。**若 Phase 53 执行未完成而 54 先行**:按 D-13 协议文本自建 gate 面板(列表+动作+确认的工作台形态),留与 G15 互嵌的 seam,不另起炉灶——见 Open Questions Q1
4. 面板内容:16 门清单(§A.1 表)+ 各门四态 + 阻塞门展开(review 详情:metadata 的 best_fails/dims/verify_summary 等富字段,活体已验证在 list response 的 metadata 里)+ 三操作按钮(放行/驳回/豁免,驳回必填理由,豁免必填理由——与平台契约 reason min_length=1 对齐)

### F.3 主题 token 清单(复用 catppuccin,零新 palette)

| 用途 | Token | 值 | 出处 |
|------|-------|-----|------|
| 签名发光(阻塞 chip/列描边) | `v3theme.signal.running` + `theme.shadow.selectGlow` 模式 | #E0B665(金) | catppuccin.ts L79/L216;tokens.css L26/L57——金已是"待审"既定色(NodeBadgesDefault L30 pending=琥珀) |
| 放行 | `signal.approved` | #56B89A | L79 |
| 驳回 | `signal.rejected` | #DD6A82 | L79 |
| 豁免 | `signal.locked`(冷灰,安静的刻意动作) | #7A8290 | L78——**设计检查点**:豁免是否用灰待 UI 设计较验(备选 overlay2);不开新色相 |
| 呼吸动效 | `--cv-d-stale-pulse` 400ms 单次脉冲×2 的既有节奏 | — | tokens.css L174(动效语汇沿用,勿造新节拍);`prefers-reduced-motion` 已有降级 |
| 角标(若落节点) | 四角产权制右下点(NodeBadgesDefault 既有) | — | **不建议占用**——右下已被节点 reviewStatus 占用,gate 是管线轴不是资产轴 |
| 错误横幅样式参考 | `chrome.errorBar` #2A1620 | — | L194——驳回后如需横幅参考此法 |

UI 任务必须含设计检查步(用户 directive);copy 全部审片 vernacular:等你决策/放行/驳回/豁免。

## G. 审批语义/载荷/批量(依真实密度定案)

见 §C.4 定案表。补充:
- **批量审批:不需要**(§B.3 活体 3 条;gate 串行阻塞一次一门;多集并发的未来场景平台 batch 端点已备,无需 UI)
- reject 载荷:reason 必填(平台 RejectRequest min_length=1);reason 文案将经 audit → (R1 后) review_result.reason → kap 面板 note 显示;kmc 侧 reason 不参与机器决策(rollback 目标 = gate 自身 phase,固定)
- approve 载荷:`comment` + `result.selected`(p11a0 变体门场景;选片桥已有 choose:v{N} 写法沿用)

## H. 操作通道建议(定案)

**新建 `POST /api/canvas/v2/gate-ops`(独立端点),不合流 select-winner manifest hook。**

理由:
1. select-winner 是 manifest 写(画布真值源)+ 附带 best-effort review 桥;gate-ops 是 review-platform 直写主操作——语义、失败语义(409 = 已决)、幂等语义全不同,合流污染两侧
2. Phase 53 D-15 已为同构场景(G15 豁免/重渲)裁定"一桥收口、独立端点(语义不污染)"——gate-ops 是第三个同构实例,三桥(reviewBridge/g15Bridge/gateOpsBridge)共享纯函数(episode/phase 三维匹配、翻页)但不共享端点
3. 挂载模式照抄 select-winner L151-158:zod 严格入参 → 平台调用 → **双 backstop**(void + .catch)——但注意 gate-ops 的平台调用是**主操作非 fire-and-forget**:结果要回给面板(成功才翻四态),所以是 await + 明确 409(已被别处决策)/4xx 错误映射;fire-and-forget 的只是操作后的即时 re-poll 触发(加速 gate:state 刷新,不等 20s 周期)
4. 变体选定场景(p11a0 choose)继续走既有 select-winner→reviewBridge 通道,gate-ops 面板的放行不带 selected 时 result 只写 decision

路由注册:src/router.ts 按现行 route 编号顺延(参考 49-01 route167 先例);同文件注册 `GET gate-state`。

## I. COORD-01 基线 + 环境接线 + 风险

### I.1 khs 工作树基线(2026-08-21,按 53-D04 收窄口径 = 仅代码文件)

```
git -C /data/workspace/kais-hermes-skills status --porcelain
代码文件(计入): M pipeline/phases/p04_character_design.py
                M pipeline/phases/p09c_storyboard_board.py
其余: SKILL.md×多、templates/*.py、references、episodes/ 运行态、
      .pipeline-state.json —— 不计入(53-D04 口径)
```

**基线不干净**(khs2 v2.4 Phase 25 mid-flight:E2E 集成 + 2515 零回归执行中,khs STATE.md "Phase 25 — EXECUTING")。本期 khs 侧变更面 = `plugins/review_gates/runner_hooks.py` + `plugins/kais_aigc/review_platform.py`(+ 平台侧独立仓)——与 p04/p09c **零文件交集**,commit 时严禁 `git add -A`(只 add 具名文件)。每个涉 khs 的 plan 原文引用 COORD-01 checklist 复制块(specs/COORD-01-khs2-parallel-coordination.md L46-56)。变更面自查:review_gates plugin 契约缝 + review-platform 客户端提取 = 契约层 ✓;不碰 22-phase 内部算法 ✓;不涉 p04/p09 字段映射排序约束 ✓。

### I.2 环境接线(活体验证,本期 P0 前置)

| 项 | 实测 |
|----|------|
| review-platform 运行态 | review-nginx 0.0.0.0:8090 → review-api 8000(容器 healthy,GET /api/v1/health OK) |
| kap 生产态 | systemd `kais-aigc-platform.service` 宿主进程,端口 **10588**(ss 确认;/home/kai/workspace/kais-aigc-platform 是 → /data 的 symlink,同仓) |
| **REVIEW_PLATFORM_URL** | **生产 .env 未配置**(只有 REVIEW_PORT=8090)→ reviewBridge/proxy 默认 `http://review-platform:8090` 宿主不可解析 → **实测 `curl localhost:10588/api/proxy/reviewPlatform/...` 返回 502 "fetch failed"**;Phase 49 bridge 生产从未生效(静默 degrade——正是 best-effort 设计的盲区) |
| 修复 | `.env` 增 `REVIEW_PLATFORM_URL=http://localhost:8090` + `systemctl restart kais-aigc-platform`(宿主同机直连,不经 Tailscale;浏览器侧仍不暴露——D-03 前端不直连) |

### I.3 主要风险表

| 风险 | 缓解 |
|------|------|
| 平台侧改 actions.py 时 review-platform 无人值守(第三仓) | 变更极小(~25 行,镜像既有 reject);配 pytest(tests/ 既有 e2e/integration 目录);部署走既有 docker rebuild(review-api 容器);plan 内成对:kap/khs 变更与平台变更同 plan 或显式记录兼容窗口(COORD-01 ①尾段) |
| 存量 2 条 APPROVING review 在 R1 后仍无 decision(approve 恒写只对新决策生效) | §E legacy 兼容分支(无 decision 的 HUMAN-COMPLETE 读作 approve);或验收时手工 resolve 这两条活体 |
| khs2 Phase 25 与本期并行 commit 交错 | I.1 零文件交集 + 具名 add;contract test 只读 khs 文件 |
| 轮询把平台打挂 | 20s × 1 请求(总量 3 条)可忽略;fail-closed 翻页上限;平台故障 → gate 面板显示"状态源不可达"降级态(不白屏不误显示) |
| gate-ops 误操作他人 review | fail-closed 三维匹配复用(episode segment + phase token 等值,WR-01 教训);reviewId 必须属于当前 (projectId,episodesId) 的候选集 |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 状态真值存储 | kap 自建 gate 状态表/DB | review-platform 既有 reviews 表 + 轮询 | D-01 锁定;双写真值分裂 |
| 事件推送管道 | kap→review-platform webhook/SSE 订阅 | 20s 轮询 + diff + 既有 socket | 平台 SSE 是全局广播无过滤;webhook 需公网回调面;决策是人尺度,轮询足够 |
| gate 定义解析 | 自造 YAML 子集解析 | js-yaml ^4.2.0(既有依赖) | gates.yaml 是标准 YAML |
| 前端实时通道 | 新 WebSocket namespace | `/ws/projects` 既有 + `gate:state` 事件 | broadcastToProject/useCanvasSocket 成熟(variant:selected 先例) |
| 决策回写语义 | kap 直接写 khs review-outcomes 文件 | 平台端点 → kmc poller 消费 | 跨进程写文件 = 竞态;round-trip 走既定消费链 |

## Common Pitfalls

### P1: 把 disposition 当决策读
GET /reviews 的 `disposition` 是路由值(AUTO/HUMAN/AI_AUDIT/BLOCK)——COMPLETE 后恒为 HUMAN,读它会 100% 误判 approve。必须读 `metadata.review_result.decision`(R1 落地后恒存在)。警告信号:任何直接 `disposition === "APPROVED"` 代码(khs 旧 poller L641/L652 正是此错——degrade envelope 的 disposition="APPROVED" 是合成值,与真决策同名不同义)。

### P2: 平台 URL 尾斜杠与默认值
`POST /api/v1/reviews/` 必须带尾斜杠(nginx 307 丢端口,khs 注释 L281-283);kap 默认 `http://review-platform:8090` 在宿主进程不可解析(I.2)——新建任何出站调用都必须显式走 REVIEW_PLATFORM_URL 且先修 env。

### P3: gate_id ↔ phase_id 混淆
平台 review type = derived gate_id(`p11c-gate`),gates.yaml key = phase_id(`p11c_video_qc`),另有 8 个 legacy 别名 gate_id + 红线三键同派生 `p13-gate`。映射必须移植 derive 规则(A.1),用 `startsWith` 前缀匹配必踩 `p1` vs `p11a0` 碰撞(WR-01 在案)。

### P4: 409 当错误处理
approve/reject/waive 遇 409 = "已被别处 resolve"(telegram 先点了/另一 tab)——是幂等成功语义(warn + 跳过 + 触发 re-poll),不是失败弹错。

### P5: gate 轴与节点 reviewStatus 轴混渲
画布节点右下 reviewStatus 点(WRITE-02)是资产轴;gate 是管线阻塞轴。混用同一角标/同一 store 字段会在 Phase 55/56 节点改造时爆雷。gate 状态独立 store(selector),只经 PhaseColumns/面板/topbar chip 呈现。

### P6: 广播风暴
gate:state 每 20s 无脑广播会在大画布引发无谓重渲。必须 diff(id+state+version)后仅在变化时广播;客户端 payload 级 memo 比较(gates 数组浅比较)再 setState。

### P7: tsx 脚本 import @/utils 卡死(项目在案陷阱)
verify/gate 脚本若需 DB 或工具函数:自包含模式(STATE.md B5 在案);gateCatalog/折叠函数是纯函数,验证脚本直接 import 源文件 + js-yaml 即可,不碰 barrel。

## Code Examples

### gate-ops 端点骨架(select-winner L151-158 模式 + await 主操作)

```typescript
// Source: src/routes/canvas/v2/select-winner.ts L151-158(双 backstop 模式)+
//         src/lib/reviewBridge.ts L196-208(fail-closed 匹配)
router.post("/gate-ops", auth, async (req, res) => {
  const { projectId, episodesId, reviewId, action, reason, selected } =
    gateOpsSchema.parse(req.body);           // zod: action enum, reason min(1) on reject/waive
  // 1. fail-closed: reviewId 必须在当前 (projectId,episodesId) 的平台候选集内
  //    (leadingPhaseToken 等值匹配 + episode segment 等值 —— 共享 reviewBridge 纯函数)
  // 2. await 平台调用:approve → {comment, result:{selected:[N]}}
  //    reject/waive → {reason};409 → 200 {applied:false, cause:"already-resolved"}
  // 3. void gateStateService.pollNow(projectId).catch(() => {});   // 即时刷新,fire-and-forget
  // 4. broadcastToProject(projectId, "gate:state", next)           // 或交给 pollNow 的 diff 广播
});
```

### 折叠纯函数(§E 全表)

```typescript
// Source: 本期新增;状态/disposition 枚举据 app/models/schemas.py L11-37
export function foldDisplayState(
  state: string, disposition: string | null, result: { decision?: string } | null,
): "pending" | "approve" | "reject" | "waive" {
  if (state !== "COMPLETE") return "pending";              // PENDING/POLICY_EVAL/APPROVING → 等你决策
  const d = result?.decision;
  if (d === "reject") return "reject";
  if (d === "waive") return "waive";
  if (d === "approve") return "approve";
  if (disposition === "BLOCK") return "reject";            // 系统拦截
  return "approve";                                        // AUTO / legacy(无 decision)
}
```

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| telegram/CLI 审批(events.py L127-189 telegram 通知链) | 画布 gate 面板直写(本期) | telegram 链不动不拆——平台侧并行存在,409 幂等语义兜底双通道竞速 |
| kmc 等 `resolved/closed`(死词汇) | COMPLETE + review_result.decision(本期 R1-R3) | GATE-03 round-trip 首次成立 |
| reviewBridge comment=choose 主通道 | result.selected=机器通道,comment=人类可读 | G3 关闭;bridge 本体零改动即点亮 |

## Validation Architecture

(Nyquist validation:config.json 无 `workflow.nyquist_validation` 键 → 视为启用)

### Test Framework

| Property | Value |
|----------|-------|
| kap 前端单元 | vitest(packages/infinite-canvas,`npm test`,package.json L12) |
| kap 集成/契约 | verify-phase-*.ts 模式(`npx tsx scripts/verify-phase-54.ts`,注册 npm script;mkdtemp 隔离照 53-01 骨架) |
| khs 侧 | pytest(plugins/review_gates/tests、plugins/kais_aigc/tests 既有;`python3 -m pytest`,STATE 在案 3.12.3) |
| 平台侧 | pytest(tests/e2e、tests/integration 既有) |
| Quick run | `cd packages/infinite-canvas && npm test`(秒级)+ `npx tsc --noEmit` |

### Phase Requirements → Test Map(成功标准 → 采样点)

| Req/SC | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| SC1(GATE-01) | gates.yaml 快照 ↔ khs 现值零漂移 | contract | `npx tsx scripts/verify-phase-54.ts`(S-catalog:js-yaml 解析 khs gates.yaml 逐字段 diff + derive 规则 round-trip + 16 计数) | ❌ Wave 0 |
| SC1 | 平台 review → 展示态折叠(§E 全表) | unit | `npm test -- foldDisplayState`(vitest 全表枚举,含 legacy/BLOCK/AUTO 分支) | ❌ Wave 0 |
| SC1 | 轮询列表解析 + fail-closed 过滤 + diff | unit(deps 注入 fetch,53 同法) | `npm test -- gateStateService` | ❌ Wave 0 |
| SC1(端到端) | kap 快照 vs 活体平台一致 | live smoke | verify S-live:GET gate-state 与直查平台列表按折叠表逐条比对(需 I.2 env 先修) | ❌ Wave 0 |
| SC2(GATE-02) | blocking 推导(每 episode 最新 pending 门)+ 无阻塞=null | unit | `npm test -- gateStore/blocking` | ❌ Wave 0 |
| SC2 | 新会话快照拉取 + socket 增量 | unit(mock socket)+ 手工 | `npm test -- useCanvasSocket`(既有 test 文件扩展 gate:state case,hooks/__tests__/ 既有) | ✅ 扩展 |
| SC2(可视) | topbar chip/列高亮/面板渲染 | 手工 + headless 探针 | 项目既有 headless canvas 探针法(LOD 排障在案);截图签收 | 手工 |
| SC3(GATE-03) | R3 poller 词汇对齐:COMPLETE+decision → resolve/write | unit(khs) | `python3 -m pytest plugins/review_gates/tests -k complete`(mock client 返 COMPLETE+review_result) | ❌ Wave 0(khs) |
| SC3 | R1 平台:approve 恒写 decision / reject 写 review_result / waive 端点 | integration(平台仓) | 平台仓 pytest(tests/integration 既有 approve/reject 用例扩展) | ❌ Wave 0(平台仓) |
| SC3 | gate-ops 端点:三维匹配 fail-closed + 409 幂等 + zod 边界 | integration | verify S-ops(spawn 子进程 dispatch,49-01 在案模式:勿与 app-db 同进程) | ❌ Wave 0 |
| SC3(全链) | 画布 approve → kmc 消费 round-trip | E2E 手工 | 真实 episode run 停在门上 → 画布放行 → 断言 review-outcomes.json 追加 + PipelineState approved + 管线续跑 | 手工(HUMAN-UAT) |

### Sampling Rate

- **Per task commit:** `cd packages/infinite-canvas && npm test` + `npx tsc --noEmit`(<30s);涉 khs 文件的 task 加对应 pytest 子集
- **Per wave merge:** `npm run verify:phase-54`(全 S 节)+ khs pytest 两 plugin 目录
- **Phase gate:** verify:phase-54 绿 + 活体 SC1 smoke 绿 + SC3 全链手工签收后才 `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `packages/infinite-canvas/src/lib/gateCatalog.ts`(+ foldDisplayState)——SC1 单元与契约测试地基
- [ ] `scripts/verify-phase-54.ts` 骨架 + `verify:phase-54` npm script(照 53-01 的 S-section map 模式)
- [ ] khs `plugins/review_gates/tests/test_poller_complete_state.py`(R3 用例,先行红)
- [ ] I.2 env 修复(REVIEW_PLATFORM_URL)——S-live 的前置

## Security Domain

(security_enforcement 未显式关闭 → 启用)

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | zod:action enum(approve/reject/waive)、reviewId int、reason min(1)/max(500)(对齐平台 RejectRequest L301)、selected int[] 限界 |
| V4 Access Control | yes(弱) | kap 端点走既有 auth 中间件;**平台 auth 已摘除**(auth.py L80-86)——网络位置即边界(内网);gate-ops 的对象级授权 = 三维 fail-closed 匹配(reviewId 必属当前 episode) |
| V6 Cryptography | no(新增面) | 平台 callback HMAC 既有(khs verify_callback),本期不新增密码学 |
| V2/V3 | no | 无新用户会话面 |

### Known Threat Patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|-----------|
| 错批他集 review(wrong-approve) | Tampering/Elevation | fail-closed 三维等值匹配(episode segment + leading phase token 等值,WR-01 在案);歧义(≥2 候选)拒操作 |
| 浏览器直连平台拓扑探测 | Information Disclosure | 前端只走 kap 域端点(D-03);不新增 route77 暴露面 |
| 重渲/审批误批量 | Tampering | 本期无批量 UI;驳回/豁免二次确认 + reason 必填 |
| 平台不可达时误显示"全放行" | Tampering | 轮询失败 → 面板"状态源不可达"降级态;fail-closed 不折叠为 approve |
| 决策审计缺口(Repudiation) | Repudiation | 平台 audit trail 自动收(action=approve/reject/waive)+ kmc review-outcomes 追加 + kap gate:state payload 带 reviewId/updatedAt |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| review-platform(REST) | D-03 轮询/gate-ops | ✓(localhost:8090 直连活体 OK)/✗(经默认 env URL 不可达) | 2.0.0 | 无——**I.2 env 修复是硬前置** |
| khs 仓(只读+2 文件写) | R2/R3 + 契约测试 | ✓ | v2.4 Phase 25 mid-flight | 变更面零交集(I.1) |
| node | 全部 | ✓ | v24.13.0 | — |
| js-yaml | 契约测试 | ✓ | ^4.2.0 既有依赖 | — |
| python3 + pytest | khs/平台测试 | ✓ | 3.12.3 | — |
| socket.io 既有基建 | gate:state | ✓ | /ws/projects 运行中 | — |

**Missing dependencies with no fallback:** REVIEW_PLATFORM_URL env(配置缺失,非服务缺失——修 env 即通)
**Missing dependencies with fallback:** 无

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | review-platform 仓新增 waive 端点 + decision 落 review_result 被授权且可部署(ROADMAP Repo 行授权三仓;deploy 走既有 review-api rebuild) | §C R1 | 若平台仓冻结:waive 可暂以 approve+comment 前缀降级(display 无法区分豁免),decision 缺失则 SC3 仍不成——R1 是硬依赖 |
| A2 | 轮询 20s 为合理缺省(planner 可在 15-30s 内调) | §D | 无风险,可配置化 |
| A3 | 红线 3 门以「自动扫描」静态态呈现(平台永无其 review 项) | §A/E | 若用户期待红线门也有 live 状态:需 khs 写 canvas 侧状态(扩变更面) |
| A4 | 豁免用 signal.locked 冷灰作展示色 | §F.3 | 纯视觉,设计检查步可改(备选 overlay2),零结构风险 |
| A5 | Phase 53 执行将在 54 动工前完成 G15 面板/嵌入位(53-01..07 PLAN 已在) | §F.2 | 若未完成:54 按 D-13 协议自建带 seam 的 gate 面板(见 Q1),不阻塞 |

## Open Questions

1. **Phase 53 执行进度与嵌入位时序**
   - What we know:53-01..53-07 PLAN 已写(53-07 含 G15TriagePanel/g15Bridge/g15-ops);STATE.md 当前在 Phase 52 执行中
   - What's unclear:53 面板落地时 54 是否已开工
   - Recommendation:planner 把"复用 G15 嵌入位"写成条件任务——53 已交付则接入,未交付则按 D-13 协议自建 seam;两者 UI 形态一致(工作台列表),零返工
2. **存量 2 条 APPROVING 活体 review 的处置**
   - What we know:ep-ccport-test01 的 p11c/p13 门 2026-08-19 起挂起;R1 只对新决策生效
   - Recommendation:验收期用新面板对这两条真实放行一次(天然 SC3 活体用例);legacy 折叠分支已兜底显示
3. **route77(/api/proxy/reviewPlatform)浏览器裸暴露面是否收紧**
   - What we know:平台 auth 已摘除,proxy 让浏览器可直写平台
   - Recommendation:本期不动(超范围),登记为后续 quick task 候选

## Sources

### Primary (HIGH confidence——本仓/邻仓源码逐行 + 活体 curl)
- khs: plugins/review_gates/{runner_hooks.py, gates.yaml, gate_config.py, gate.py}; plugins/kais_aigc/{review_platform.py, canvas_sync.py}; pipeline/runner.py L3223-3344; pipeline/phases/_gate_guard.py; docs/scoring-gates.md
- review-platform: app/api/v1/{reviews.py, actions.py}; app/core/{state_machine.py, events.py, auth.py}; app/workers/tasks.py; app/models/schemas.py; app/policies/*.yaml; contracts/callback-schemas/review-callback.json; INTEGRATION.md
- kap: src/lib/reviewBridge.ts; src/routes/canvas/v2/select-winner.ts; src/routes/proxy/reviewPlatform.ts; src/utils/ws.ts; src/socket/index.ts; src/routes/canvas/v2/import-from-dir.ts; scripts/verify-manifest-contract.ts; packages/infinite-canvas(src/hooks/useCanvasSocket.ts, src/theme/{catppuccin.ts,tokens.css}, src/v3/lanes.ts, src/store/canvasStore.ts, src/components/canvas/{PhaseColumns.tsx,NodeBadgesDefault.tsx})
- 活体:localhost:8090 reviews/health 列表;localhost:10588 proxy 502;ss 端口;systemd unit
- 计划文档:.planning/specs/COORD-01-*.md;53-CONTEXT.md(D-13/D-15);53-{01,05,06,07}-PLAN.md(只读)

### Secondary (MEDIUM)
- khs .planning/STATE.md(v2.4 Phase 25 状态)、kap .planning/STATE.md(执行位置)

## Metadata

**Confidence breakdown:**
- 协议缺口与关闭方案: HIGH——双侧源码逐行 + 活体数据佐证(缺口本身即证据:无 review-outcomes.json)
- kap 轮询/广播/UX 设计: HIGH——全部构件(gate:state 同构事件/PhaseColumns/token)源码定位
- 三仓变更面合规: HIGH——COORD-01 文本 + 工作树实测基线
- 环境接线: HIGH——活体 502 复现 + 修复路径验证(localhost:8090 直连 OK)

**Research date:** 2026-08-21
**Valid until:** 2026-09-21(三仓均活跃,khs v2.4 Phase 25 落地后建议复核工作树基线;gates.yaml 若随 v2.4 变更,契约测试设计正是为此)
