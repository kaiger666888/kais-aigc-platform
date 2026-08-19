# Phase 49: Selection Write-back (Canvas Endpoint + Asset-Center Linkage + kmc Bridge) - Context

**Gathered:** 2026-08-19
**Status:** Ready for planning
**Source:** Orchestrator express path (双侧代码调查 + review-platform 源码核实 2026-08-19)

<domain>
## Phase Boundary

把"选定 winner"从纯前端本地状态升级为持久化、可回写的闭环：新增画布层 select-winner 后端端点（事务化写 `canvas_variant_groups.winner_node_id` + 组内节点 winner 状态）；前端 `canvasStore.selectWinner` 接后端（失败回滚）；资产中心 `handleSelect` 与画布 variant group 联动；kap 侧选定桥接到 review-platform resolve（`chosen_variant_id`），使 kmc 30s 轮询能读到画布换选。不做存量回填（Phase 50）、不改 ingest（Phase 48 已交付）。

</domain>

<decisions>
## Implementation Decisions

### select-winner 后端端点 (SELECT-01)
- [LOCKED] D-01: 新端点挂 canvas v2 路由族 `src/routes/canvas/v2/`，形如 `POST /api/canvas/v2/variant-groups/:groupId/select-winner`，body `{ winnerNodeId: string }`。事务化：①`canvas_variant_groups.winner_node_id = winnerNodeId`；②组内 `variant_node_ids` 对应 `canvas_nodes.is_winner` 置位（winner=true，其余=false）。错误语义：group 不存在→404；winnerNodeId 不在组内→409
- [LOCKED] D-02: 写入路径复用 `src/lib/canvasRelationalStore.ts` 既有持久化函数风格（:314-353 groups、:480-511 落库）——不绕过 store 直写 SQL；路由注册走 `src/router.ts` 既有挂载点
- [LOCKED] D-03: 幂等：重复 select 同一 winner → 200 no-op（不抛 409）

### 前端接线 (SELECT-02)
- [LOCKED] D-04: `packages/infinite-canvas/src/store/canvasStore.ts:524-571` 的 `selectWinner` 保持现有本地乐观行为，追加后端调用（`canvasApi.ts` 新增函数）；失败时回滚——复用 `variantOps.ts:66-164` 的 prevSnapshot/rollback 机制，UI 不出现"已换选但库里没写"假象
- [LOCKED] D-05: 纯接线，**零新视觉设计**（不新增组件/样式；现有 VariantBadge/交互不变）

### 资产中心 ↔ 画布联动 (SELECT-03)
- [LOCKED] D-06: 联动方向 registry→canvas：`assets-registry` 的选定操作（`PATCH /:id` 置 `isPrimaryView`，`index.ts:190`）成功后，若该资产能映射到 canvas 节点，则同步更新对应 variant group 的 winner。**映射机制必须先核实**（`src/routes/canvas/v2/sync-assets.ts` 建立 o_assets→canvas node 的对应关系——执行者须查明映射字段：canvas node data 里的 asset 引用/uuid，读 sync-assets.ts 与 canvasRelationalStore.ts 确认），映射不到 → 静默跳过 + logger.info（不阻塞 registry 主流程）
- [LOCKED] D-07: 反向（画布 select-winner → o_assets.isPrimaryView）在 D-01 端点内顺带处理：winner 节点若映射到 o_assets 资产且同组有其他资产候选，同步置换 isPrimaryView（旧 primary 置 false）。映射不到则只写 canvas。失败不回滚 canvas 主写入（canvas 是本端点的真值源），只 warn

### kmc review 桥接 (SELECT-04)
- [LOCKED] D-08: 桥接触发点 = D-01 端点选定成功后（异步/尽力而为，不阻塞响应）。查 review-platform 有无该内容对应的 **open review**：kmc 提交的 review body 带 `source_system: "kais-movie-agent"`、`content_ref: "<ep>/<phase>"`、`type: <gate_id>`（`kais-hermes-skills/plugins/kais_aigc/review_platform.py:249-269`）。kap 侧按 content_ref/type 查 open（APPROVING 态）review
- [LOCKED] D-09: resolve 动作 = `POST /api/v1/reviews/{id}/approve`，body `{ comment, result: { selected: [<1-based variant N>], feedback } }`（`app/models/schemas.py:286-296` ReviewResult；review 必须处于 APPROVING 态，否则 409——409 视为"已被别处 resolve"，warn 后跳过）。**执行者必须先核实** GET /api/v1/reviews/{id} 响应中 `chosen_variant_id`/`suggested_action` 的生成位置（kmc 轮询读这两个字段，`runner_hooks.py:640-678`）——若 approve/result.selected 不产生 chosen_variant_id 字段，需按 review-platform 实际字段调整桥接写法（如 metadata 通道），**禁止改 kais-review-platform 仓库**（桥接只读其 API；若 API 能力缺口实在绕不过，降级为 comment 内嵌 `choose:<variant_id>` 让 kmc `_chosen_from_suggested` 兼容路径解析——执行者验证该函数格式）
- [LOCKED] D-10: 通信走 kap 既有代理 `src/routes/proxy/reviewPlatform.ts`（REVIEW_PLATFORM_URL 默认 `http://review-platform:8090`）或服务端直连 env；无 open review → 只落本地 + 日志（常态：大多数换选没有挂起的 gate）
- [LOCKED] D-11: kmc 侧零修改；kais-review-platform 仓库零修改

### Claude's Discretion
- 端点路径具体命名（对齐 `docs/canvas-next-steps.md:428-545` 规划的 selectWinner.ts 命名优先）
- 桥接的模块划分（lib 文件名、是否 fire-and-forget queue）
- 测试放 verify-phase-49 脚本（:memory: sqlite / fetch mock）——review-platform 交互用本地 mock server 或注入式 fetch stub，不打真实 :8090

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### kap 画布层（本 phase 主战场）
- `packages/infinite-canvas/src/store/canvasStore.ts:524-571` — 现行本地 selectWinner（改造对象）
- `packages/infinite-canvas/src/store/variantOps.ts:66-164` — applyWinnerSelection/rollback/syncWinnerToGroups + prevSnapshot（回滚机制）
- `packages/infinite-canvas/src/api/canvasApi.ts` — API 客户端（新增 selectWinner 调用）
- `src/lib/canvasRelationalStore.ts:94-136,314-353,480-511` — canvas_nodes/canvas_variant_groups 持久化（复用风格）
- `src/types/database.d.ts:39-74` — canvas_nodes(is_winner:46, variant_group_id:60, variant_of:61) / canvas_variant_groups(variant_node_ids:72, winner_node_id:73, select_mode:70)
- `src/types/flowgraph-v2-schema.ts:81-88` — VariantGroupV2 zod 契约
- `src/routes/canvas/v2/sync-assets.ts:95,194` — o_assets→canvas node 映射与 state 推导（D-06 映射机制核实点）
- `src/routes/v1/assets-registry/index.ts:190-220` — PATCH 选定操作（联动挂点）
- `src/router.ts:176-345` — 路由注册表（新端点挂载）

### kmc ↔ review-platform 协议（跨仓库只读）
- `kais-hermes-skills/plugins/kais_aigc/review_platform.py:64-92,249-269` — 提交协议（POST /api/v1/reviews, source_system, content_ref, JWT）
- `kais-hermes-skills/plugins/review_gates/runner_hooks.py:640-678` — 30s 轮询读回（state resolved/closed + disposition + suggested_action + chosen_variant_id + `_chosen_from_suggested`）
- `kais-review-platform/app/api/v1/actions.py:330-388` — approve 动作（APPROVING 态约束、result 存 metadata_json.review_result）
- `kais-review-platform/app/models/schemas.py:286-296` — ReviewResult{selected[], scores, feedback} / ApproveRequest
- `src/routes/proxy/reviewPlatform.ts` — kap 侧代理（REVIEW_PLATFORM_URL）

### 规划文档
- `docs/canvas-review-integration.md` — 方案B 变体节点 + 优胜路径选路机制（:80-100）
- `docs/canvas-next-steps.md:428-545` — Phase 3.2 selectWinner.ts 规划（本端点即其落地）
- `.planning/phases/48-*/48-01-SUMMARY.md` + `48-02-SUMMARY.md` — Phase 48 分组形状（本 phase 操作的对象）

</canonical_refs>

<specifics>
## Specific Ideas

- 前后端 VariantGroup 结构不一致是已知债务（RECON.md:262-266：前端按 parentNodeId 分组、后端按 phaseIndex+branchId + select_mode）——本 phase 端点以**后端 canvas_variant_groups 表为真值源**，前端结构不动
- canvas_nodes 已有 `review_status`/`reject_reason`/`ai_score` 列（database.d.ts:52,40）——winner 写入时可顺带维护 review_status（executor 视既有消费方决定，不强制）
- kmc 换选格式参考：p11a0 gate resolve 用 `"<sid>:<frame_type>:v<N>"`；`choose:<id>` 前缀经 `_chosen_from_suggested` 解析
- select_mode='multi' 组：v3 适配器目前对非 single 告警默认 single——本 phase 端点对 multi 组**拒绝选定**（409）而非错误地写单一 winner

</specifics>

<deferred>
## Deferred Ideas

- `POST create-variants`（批量生成 N 候选端点）→ 未排期（docs/canvas-review-integration.md:354 规划项）
- 存量回填 + verify-phase-50 守护 → Phase 50
- `o_asset_composition` / place 端点（canvasApi.ts:995-1017 TODO）→ 未排期

</deferred>

---

*Phase: 49-selection-write-back-canvas-endpoint-asset-center-linkage-km*
*Context gathered: 2026-08-19 via orchestrator express path*
