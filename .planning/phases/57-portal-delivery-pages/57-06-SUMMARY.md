---
phase: 57-portal-delivery-pages
plan: 06
subsystem: ui
tags: [portal, delivery, g8-terminal-review, gate-ops, 54-vocabulary, react-19]
requires: [57-05（终审卡状态面 + display:none 占位；portalApi.loadDelivery）]
provides:
  - gateOpsFlow.ts 终审操作状态机（planOp 前置判定 / runTerminalOp 三分支事件流：乐观翻转·409 幂等·失败回滚；REASON_LIMITS 1-500 + validateReason 双侧同源）+ 13 vitest
  - ReasonDialog.tsx（54 C-4 逐字复刻：驳回理由必填 1-500 + 二次确认 + Esc；阶段名取 p13 注册表「交付」）
  - DeliveryPage 终审动作条（[放行] 冷白单点击 / [驳回] 玫开对话框）+ 行级处理中 + toast（成功/幂等/回滚 54 词表逐字）+ 降级 fail-closed 禁用与 [重试]
affects: [57-08 聚合验证（/deliver/:ep 探活 + gate-ops 路径复用 54 verify 口径）]
key-files:
  created: [packages/portal/src/lib/gateOpsFlow.ts, packages/portal/src/__tests__/gateOpsFlow.test.ts, packages/portal/src/components/ReasonDialog.tsx]
  modified: [packages/portal/src/pages/DeliveryPage.tsx]
key-decisions:
  - decision: 乐观翻转在 await 前（真乐观 UI），非 54 GateCenterBlock 的响应后翻转
    rationale: plan 测试用例明示时序「调 approve → 乐观翻 approve → resolved {applied:true}」且失败用例要求「状态回 pending」——回滚分支只有 pre-await 翻转才有实义；54 语义（409 不当错误弹/回滚/fail-closed）全套保真，翻转时机按 plan 字面。
  - decision: degrade=true（陈旧快照）同样禁动作条
    rationale: plan truth 只点名 gateState null；degrade 快照的 reviewId 可能已过期，fail-closed 读法下不发起写操作（54 工作台靠 gate-ops 502 兜底，交付页选择不发起），横幅 [重试] 先行恢复新鲜态。
  - decision: gateState null 时动作条渲染但禁用（非消失）
    rationale: plan「动作条禁用 + 降级横幅」字面——比消失诚实（用户可见操作存在但被状态源不可达挡住）。
  - decision: ReasonDialog 标题字号 var(--cv-fs-t1)（14px）而非 54 C-4 的 13px
    rationale: 57-UI-SPEC §Typography 契约严格 t1..t4（本期绑定）；54 复刻取结构/copy/交互逐字，字号从 57 契约。
  - decision: toast 为 portal 本地实现（画布 useToast 视觉语言 token 化：--cv-bg-elevated 底 + 四态色边 + 3s 自散）
    rationale: portal 无 canvasStore（不引 zustand 入 bundle）；tone→色映射全走 v3theme.signal，零新 hex。
  - decision: 动作条退场 = CSS animation forwards 隐藏（保持挂载、pointer-events none）
    rationale: --cv-d-unhighlight 220ms 纯 CSS 播放 + reduced-motion 直接 visibility:hidden，零 JS 计时器、零节拍新值；卸载时机的不可动画问题一并回避。
duration: 50 min
completed: 2026-08-22T09:40:00+08:00
---

# Phase 57 Plan 06: G8 终审操作面 Summary

/deliver/:ep 终审卡从状态显示面升级为完整操作面：[放行]/[驳回] 经 54 GATE-03 通道（POST /api/canvas/v2/gate-ops，D-10 一套通道三处消费）回写 kmc gate 状态——全程交付页内完成，无 telegram/CLI，零新建后端。57-05 留下的 `data-reserved="57-06-gate-actions"` display:none 占位转正为动作条。

**Tasks:** 1/1 · **Commits:** 3（3bdbc59a 状态机+测试 / 2674c645 对话框+接线 / 本 SUMMARY）· **Files:** 3 created + 1 modified

## 验证证据

- vitest **34/34** 绿（gateOpsFlow 13 新增 + delivery 13 / ribbon 8 回归）；`npx tsc -p packages/portal --noEmit` 0 错；根 `npm run lint`（tsc --noEmit）0 错
- 状态机 13 case 覆盖 plan 全部六断言：放行（approve 无 reason→乐观翻→applied:true 终态）/ 驳回前置校验（reason 空零请求零事件）/ 驳回合规（reject 携 trim 后 reason）/ 409 幂等（applied:false already-resolved→不回滚+refetch 指令+toast 逐字）/ 失败回滚（502 与 422 两形态归失败分支、原因透传）/ no-op（display 非 pending 与 reviewId 缺）+ terminalStates/isTerminal + validateReason 边界（500 合规 501 不合规）
- 护栏 grep 全过：DeliveryPage+ReasonDialog `通过|打回` = 0（54 词表断言）；ReasonDialog `confirm(|alert(` = 0（禁原生）；packages/portal/src `8090|review-platform|/api/v1/reviews` = 0（零直连，只经 gate-ops）；理由 1-500 契约在 gateOpsFlow（REASON_LIMITS 定义）与 ReasonDialog（REASON_LIMITS.max + validateReason 消费）双侧存在
- `bash scripts/deploy-portal.sh` → `/deliver/1` `/deliver/2` `/portal/` 全 200 `<title>制片门户</title>`（index-6weeWyXz.js）；部署 bundle 含 确认对话框标题模板/幂等 toast/回滚 toast/deliver-gate-actions·deliver-reason-dialog·deliver-gate-toast testid（新代码已上线）
- 活体探针：gate-state（proj 1/2/999 各集）degrade=false、无任何 pending+reviewId 门 → p13-gate 为 legacy pending（无 reviewId），交付页按 54 语义只显状态行不出动作条（Pitfall 3 实测吻合）；gate-ops 外来 reviewId 探针 → **422「review 不属于当前剧集」**（服务端 fail-closed scope 校验在位，T-57-06a 缓解确认）。活体放行不可演练（无 pending 平台 review）→ 按 plan fallback 以 mock 全分支 + UI 态验收（54 先例口径）
- 设计检查步（frontend-design 纪律）：零新 hex（dialog 遮罩 rgba(10,11,14,0.6) = --cv-bg-canvas alpha 衍生 54 同值；toast 三档色全走 v3theme.signal）；冷白 accent 新增仅 [放行] 主按钮（§Color reserved 第 3 处）+ 焦点环（既有 :focus-visible）；玫只进 [驳回] 按钮与驳回态（54 约束）；按钮本体 32px + 2px 边距 = 36px 行（UI-SPEC 例外值）；pending 点呼吸沿用 57-05 既有 2.4s（54 同拍）；动作条退场 --cv-d-unhighlight 220ms；toast 进场复用 --cv-d-panel；reduced-motion 全静止；文案全部 54 Copywriting 逐字（幂等/处理中/驳回确认/placeholder/降级）+ 成功 toast「「成片交付」已放行/已驳回」54 同构

## Deviations

1. **乐观翻转 pre-await**（54 源码实为响应后翻转）：按 plan 测试用例字面时序实现（见 key-decisions 1）；54 三断言（409 幂等不弹错/失败回滚/fail-closed）零漂移。
2. **degrade=true 也禁动作条**：plan truth 只点名 null；fail-closed 延伸（陈旧 reviewId 不可信），横幅 [重试] 先恢复新鲜态再操作。
3. **ReasonDialog 标题 14px**（54 源码 13px）：57-UI-SPEC §Typography t1..t4 绑定优先；结构/copy/交互逐字不变。
4. **toast 本地实现**（不复用画布 useToast 组件）：portal 不引 canvasStore；视觉语言同源（位置/图标/3s 自散/token 化配色）。
5. **退场动画 forwards 隐藏非卸载**：纯 CSS（220ms token + reduced-motion 静止），规避卸载不可动画与 JS 计时器双问题。
6. **成功后不后台重拉**（幂等才重拉）：54 源码同构（成功靠乐观态驻留）；plan 明示「幂等后重拉」单一触发。

## 运维注记

- 部署链不变：`bash scripts/deploy-portal.sh`（本轮已跑，/deliver/:ep 服务 index-6weeWyXz.js）。
- 活体放行/驳回演练前置条件：review-platform 有该集 pending p13 review（gate-state p13-gate 条目出现 reviewId）——当前库存全为 legacy pending，动作条按设计不渲染；有 pending review 后无需改动即可操作。
- STATE.md 未更新（按执行指令）。

---

Ready for 57-08（聚合验证）。
