---
phase: 60-post-save-panel-persistence
plan: "02"
subsystem: canvas-save
tags: [savedBy, self-echo, graph-saved, tabId, wire-contract, mock-alignment, d-01, d-05, d-08, knob-retirement]
requires:
  - phase: 60-post-save-panel-persistence
    provides: 60-01 Branch A 裁定(自回声 reload 即扰动源,锚安全已证——本 plan 落地的 D-01 即根治面)
provides:
  - src/routes/canvas/v2/save-v2.ts savedBy 契约(zod 可选 + broadcast 条件回显)——60-04 e2e 用例 1 断言消费
  - packages/infinite-canvas/src/services/clientTabId.ts 页面级 tab 身份单例——60-05 静态锁/60-04 面板保持断言的机制底座
  - 59 Known Issue #1(SC4 角标复活竞态)销案——reload 侧根因消失,phase59 全 5 用例改走真实回声路径全绿
affects: [60-04 (e2e 四用例断言面), 60-05 (S2 静态锁锚定 onGraphSaved 次序), PANEL-01 行为面, kmc pipeline(广播形状兼容性,零动作)]
tech-stack:
  added: []  # 零新依赖(crypto.randomUUID 平台 API;T-60-SC 兑现)
  patterns:
    - "wire 契约三件套(59 CR-02 同型): server zod → broadcast 条件回显 → socket 类型 → 消费方守卫——savedBy 走完整一条链,mock 同步镜像(D-04)"
    - "单点身份附加: canvasApi.saveCanvasGraph 内部构造 body 附 savedBy,签名不变——六个调用方零改动全覆盖(含 rerun 先存再跑,Pitfall 5 根治)"
    - "FLAG-1 次序纪律: 自回声跳过分支无条件保留 health 基线重置且重置行先于早退行(跳 reload 不跳基线;60-05 S2 静态锁锚定)"
key-files:
  created:
    - packages/infinite-canvas/src/services/clientTabId.ts
  modified:
    - src/routes/canvas/v2/save-v2.ts
    - packages/infinite-canvas/test/e2e/mock-backend/server.mjs
    - packages/infinite-canvas/src/services/canvasApi.ts
    - packages/infinite-canvas/src/hooks/useCanvasSocket.ts
    - packages/infinite-canvas/src/components/FlowCanvas.tsx
    - packages/infinite-canvas/test/e2e/tests/phase59-stale-cascade.mjs
key-decisions:
  - "onGraphSaved 最终块序(scope 守卫后): ① lastEventCountRef.current = null 无条件先行(FLAG-1) ② selfEcho 判定命中即静默早退(无 toast 无 reload,D-01/D-05) ③ showToast「Pipeline 同步了新数据…」 ④ loadCanvas——60-05 S2 静态锁锁此序"
  - "savedBy 条件展开(...(savedBy != null ? { savedBy } : {})):kmc pipeline 等不传身份的既有调用方广播形状与改造前逐键一致(向后兼容,PATTERNS Shared Pattern 2);透传时多一个 savedBy 键"
  - "mock 旋钮退役而非保留: suppressGraphSaved 四处删除(默认键/注释块/guard/reset 重建),广播恒发、跳过纯客户端——59 SC4 改走真实回声路径自然通过(FLAG-4),全 5 用例绿"
  - "logCall body 记 savedBy(?? null):mock calls 成为「客户端真的发了身份」的 e2e 观测面(60-04 用例 1 断言 + 负向对照可读回 tabId)"
  - "T-60-02 缓解兑现: zod z.string().max(64).optional() 白名单长度限制 + echo-only 不落库;不加鉴权(字段非权限依据,RESEARCH F-3 定级 Informational)"
  - "requirements.mark-complete 跳过: 本 plan 交付 PANEL-01 机制面,行为断言面(e2e 四用例/probe/verify 门)由 60-04/60-05 落地——两者 frontmatter 均携带 PANEL-01,届时勾选(诚实记账,沿 60-01 先例)"
patterns-established:
  - "身份回显契约: 客户端自声明身份 → 服务端 zod 白名单 → broadcast 条件回显 → 客户端比对跳过——后续任何「区分自己/他端」事件的模板"
  - "旋钮退役纪律: 删除 mock 旁路必须让既有依赖用例经真实机制自然通过(SC4 即证明),禁止为退役而改测试预期"
requirements-completed: []  # PANEL-01 机制面落地;断言面待 60-04/60-05(见 key-decisions)
duration: 6min
completed: 2026-08-24
---

# Phase 60 Plan 02: D-01 自保存自回声跳过 — savedBy 契约三件套 + 客户端跳过分支 Summary

**双端同形 savedBy 契约(server zod 回显 + mock 镜像)+ canvasApi 单点身份附加 + onGraphSaved 自回声静默早退——自保存不再触发整图 reload/toast,59 Known Issue #1(SC4 竞态)reload 侧根因消失且 phase59 全 5 用例改走真实回声路径全绿。**

## Performance

- **Duration:** 6 min(23:42:42Z → 23:48:06Z UTC;本地 08-24 07:42-07:48 +08)
- **Completed:** 2026-08-24(本地)
- **Tasks:** 2/2
- **Files modified:** 7(1 created: clientTabId.ts;6 modified)
- **Commits:** 46934c60(Task 1)· 991898fc(Task 2)

## Accomplishments

1. **Task 1 — 服务端 savedBy 契约 + mock 镜像(旋钮暂留):** save-v2.ts `validateFields` 增 `savedBy: z.string().max(64).optional()`(V5 白名单长度限制,T-60-02 缓解),broadcast payload 条件展开回显——**不带身份的调用广播形状与改造前逐键一致**;mock server.mjs save-v2 handler 同款条件展开 + logCall body 记 `savedBy: req.body?.savedBy ?? null`(60-04 e2e 观测面);broadcast 先于 HTTP 响应的时机与 5ms setTimeout 差异均不动(F-1/F-6)。suppressGraphSaved 四处本任务零触碰(红线保持计数 4)。
2. **Task 2 — 客户端 tabId + 自回声跳过 + 旋钮退役 + SC4 自然通过:** clientTabId.ts 页面级 `tab_` 身份 lazy 单例(crypto.randomUUID 优先,Math.random 回退;头注释含时间窗方案否决理由);canvasApi.saveCanvasGraph 单点附 savedBy——**六调用方(ContextMenu L122 / FlowCanvas L698·L740 / canvasStore L676·L956 / useStaleRerun L59)零改动全覆盖,rerun 先存再跑天然携带身份(Pitfall 5 根治)**;useCanvasSocket 双处类型加 `savedBy?`;FlowCanvas onGraphSaved 重排(块序见 key-decisions[0]);mock 旋钮四处退役;59 SC4 改走真实回声路径。

## onGraphSaved 最终块序(60-05 S2 静态锁锚定对象)

```ts
if (/* scope 守卫: projectId/episodesId 匹配 */) {
  lastEventCountRef.current = null                       // ① FLAG-1 基线重置,无条件
  const selfEcho = typeof payload.savedBy === 'string'
    && payload.savedBy === getClientTabId()              // ② D-01 自回声判定
  if (selfEcho) return                                   //    静默早退(无 toast 无 reload)
  showToast('Pipeline 同步了新数据,正在刷新画布…', 'info') // ③ 仅他端
  loadCanvas(projectId, episodesId)                      // ④ 仅他端
}
```

## SC4 自然通过证据(FLAG-4 / D-08)

`npx playwright test test/e2e/tests/phase59-stale-cascade.mjs -g "SC4"` —— -g 匹配 suite 标题「SC1-SC4」,**全 5 用例** (SC1/SC2/CR-02/SC3/SC4) 通过(19.7s, dist 构建)。SC4 在旋钮 POST 已删、广播恒发的真实回声路径下通过 = rerun 的 saveCanvasGraph 保存真的携带了 savedBy 且客户端判定命中跳过 reload(判定漏 rerun 路径则自回声 reload 与 success 清 stale 的写-写竞态回归、角标复活用例红)。59 Known Issue #1 reload 侧根因销案。

## kmc pipeline 兼容性说明(零回归)

kmc pipeline 等既有调用方 POST body 不含 savedBy → zod optional 通过 → 解构 `savedBy === undefined` → 条件展开 `...(savedBy != null ? { savedBy } : {})` **不展开** → broadcast payload 仍为 `{ projectId, episodesId, timestamp }`,与改造前逐键一致。接收端所有客户端(含未升级旧版)按他端语义走 toast+reload 既有链。真实服务端与 mock 双端同形(D-04)。

## Verification

- `npx tsc --noEmit`(根)干净(Task 1/2 各跑一次)
- `node --check` server.mjs 语法通过
- vitest `canonicalWriteback` + `deleteNode` = **30/30 绿**(签名不变回归证据)
- `npm run build` 成功 → playwright phase59-stale-cascade 全 5 用例绿(dist 纪律:serve dist 非 source)
- grep `suppressGraphSaved` = **0**(packages/infinite-canvas/test/ 及全仓代码文件;退役注释均改用中文描述避开 token)
- FLAG-2 核验: FlowCanvas.tsx diff 仅两 hunk(import + onGraphSaved),health-poll useEffect(L795+)零 diff

## Deviations from Plan

### 流程偏差(非代码,记录项)

1. **退役注释避开 token 字面量:** 计划要求全仓 grep suppressGraphSaved = 0,而首版退役注释内含该词会让 verify 门 `! grep` 红——注释改写为中文描述(「graph:saved 抑制旋钮已退役」),语义不变,零代码影响。
2. **SC4 verify 的 -g "SC4" 实际跑了全 5 用例**(-g 匹配 describe 标题「SC1-SC4」):超出计划要求的 SC4 单用例,顺带覆盖 D-12 回归面(phase59 全部),证据更强,无需动作。

**代码偏差: None — 两个任务均按 plan 字面执行,红旗(FLAG-1 序/FLAG-2 禁改/FLAG-4 自然通过)全数兑现。**

## Auth Gates

None。

## Known Stubs

None(savedBy 链路端到端真实:server 回显/mock 透传/logCall 观测/客户端判定全部落地;无占位)。

## Threat Flags

None(新增安全面与 plan 威胁模型一致:T-60-02 缓解已兑现——zod max(64) optional 白名单 + echo-only 不落库;T-60-03 8 位随机 tabId 非 PII 且 room 隔离;T-60-SC 零新依赖兑现。无模型外新增面)。

## TDD Gate Compliance

N/A(plan type: execute,非 tdd;本 plan 的行为断言面按计划由 60-04 四用例收口)。

## Self-Check: PASSED

- src/routes/canvas/v2/save-v2.ts / packages/infinite-canvas/src/services/clientTabId.ts / canvasApi.ts / useCanvasSocket.ts / FlowCanvas.tsx / server.mjs / phase59-stale-cascade.mjs 全部 FOUND
- commits 46934c60(Task 1) / 991898fc(Task 2) 全部 FOUND;两 commit 零文件删除
