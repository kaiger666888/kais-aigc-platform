# Phase 59 Discussion Log

**Date:** 2026-08-23
**Mode:** default (interactive, 单轮两问)
**Areas selected:** 级联深度 / 落选变体交互 / 标记架构 / stale 持久化（全选）+ 派生区「假成功边界」

## Q1: 标记架构（header: 标记架构）

**Options presented:**
- 服务端标记（推荐）— executeNode(extra) 带 regen 身份；服务端任务成功处 markStaleDownstream 写库 + node:updated；客户端零改动复用既有级联链；编排零波及是架构性保证；风险=服务端 execute 链今天有 4 断点
- 客户端关联 — 记 regen-pending requestId，socket success 匹配时本地级联；不动服务端、今天能落地；但刷新即丢/多端不同步
- 双路混合 — 服务端真值 + 客户端乐观脉动；实现量最大

**User selection:** 服务端标记（推荐）

## Q2: 宪法已锁语义沿用确认（header: 沿用确认，multiSelect）

**Options presented (all confirmed):**
- 级联深度=传递闭包（宪法 §13）✓
- 落选/locked 边界沿用（isInactive 不传播、locked 终点——CR-01 姊妹边界）✓
- stale 字段复用不另开（data.stale + StaleInfo.trigger* 溯源）✓
- 失败不级联（error/failed 不标下游）✓

**User selection:** 全部四条沿用

## Q3: 假成功边界（header: 假成功边界，派生自 Q1 风险注记）

**Options presented:**
- 修假成功（推荐）— 只修断点③，最小 scope，其余记 deferred
- 容忍误标 — 断点全留给后续，STALE-01/02 故障场景语义为假
- 四断点全修 — output_url/oss 翻译/ref 参数名一并修，级联语义最完整，建议另开 phase

**User selection:** **四断点全修**（超出推荐项——用户裁决把 execute 链整体修复并入 Phase 59，理由：v3.1 主题即重生成闭环深化，级联建在假链上是空转。ROADMAP Phase 59 Goal/SC5 已同步补线。）

## Notes

- 讨论前 codebase scout 发现：级联机制全套已建（flowgraph-v3 stale.ts P13 纯函数 + useStale 脉冲 + useStaleRerun 出口），现有触发=变体切换/审核通过/human_edit/socket node:updated；缺口仅在 regen 成功路径（走 node:state 只清自身不级联）且编排批量同走 node:state 不可直接挂——架构选择因此聚焦「服务端 per-request 关联」。
- 派生决策 D-07（修真优先于接线）由 Q3 选择直接产生。
