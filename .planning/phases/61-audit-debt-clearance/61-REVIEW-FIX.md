---
phase: 61-audit-debt-clearance
round: 1+2
fixer: review-fix workflow (round 1 fixer subagent died on 503 post-WR-03-commit; round 2 applied inline)
commits:
  - "22987eb3 fix(61): WR-01 socket 断线降级补写"
  - "beef3d10 fix(61): WR-02 拖入节点 data 袋携带 assetId/assetUuid"
  - "7b4a78e2 fix(61): WR-03 e2e 恰-2 POST 断言前先 poll 到 2 条"
  - "7e67de58 fix(61): WR-01 补集 scope 守卫 (fix-r2)"
gates_after_fix: verify:phase-61 18/18 + tsc clean + build ok + phase61 e2e 3/3 + phase55-nav standalone 5/5
status: resolved
---

# Phase 61: Review Fix Report

## Fixes Applied

| ID | 严重度 | 问题 | 修复 | Commit | Gates |
|----|--------|------|------|--------|-------|
| WR-01 | WARNING | socket 断线时拖入节点已落库但广播不可达,图上不可见;重拖只得误导性 409 | drop 成功 2s 有界窗口后 canonical 图仍无该节点 → addNodeFromSocket 幂等补写(先查 graph 防 double-add,同 id 重播 store 内部亦去重) | 22987eb3 | ✅ |
| WR-02 | WARNING | 拖入节点 data 袋缺 assetId/assetUuid,StoryboardTimeline.assetIdOf 联动链断 | node.data 附带 assetId(payload.id)/assetUuid(payload.uuid),服务端 z.record 透传零契约风险;mock/e2e wire 断言同补 | beef3d10 | ✅ |
| WR-03 | WARNING | e2e 恰-2 POST 断言竞速在途 fetch(断言时第 2 条尚未入 /__mock/calls) | 断言前 expect.poll(getCalls → 2, timeout 10s) 有界等齐;超时即失败不悬挂,.toBe(2) 仍能抓超发 | 7b4a78e2 | ✅ |
| (r2) WR-01 追加 | WARNING (re-review 发现) | 2s 窗口内切换 episodes → setTimeout 对他集 st.graph 补写本集节点,幽灵节点随下次全图 save 落库(跨集数据污染) | 闭包捕获 drop 时 scope,触发时与 store 当前 projectId/episodesId 逐字段比对,不匹配静默弃(59-fix CR-02 同法) | 7e67de58 | ✅ |

## Re-review (quick depth, round 2)

- WR-02: ok——全链验证(类型校验、服务端 z.record 非 strict 透传、广播回声、adaptV2Node data 袋展开、assetIdOf 主路径 raw.assetId 命中、wire 断言与 fixture 一致)
- WR-03: ok——poll 有界(超时失败不悬挂),.toBe(2) 仍抓超发
- WR-01: 幂等/有界/先查 store 三点 ok;r2 发现的 scope 缺口已由 7e67de58 闭合,追加守卫后复跑全套门绿

## 死亡救援记录 (subagent quota)

round-1 fixer 在 WR-03 commit(7b4a78e2)后死于 503 所有供应商已熔断,三 commit 全部已在
reviewfix worktree(gsd-reviewfix/61-3763238)落盘,零丢失。恢复路径:worktree 内跑全套门
(18/18 + tsc + build + e2e 3/3 + nav 5/5)→ merge 回 master(8dbc7ab5)→ 清 worktree/分支/
recovery 标记。r2 追加守卫由主循环内联完成(fixer 池持续熔断)。
