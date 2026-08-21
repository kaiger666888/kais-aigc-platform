# Phase 54: Gate 中心 (Gate Center + Blocking-State UX) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-21
**Phase:** 54-Gate 中心 (Gate Center + Blocking-State UX)
**Areas discussed:** 真值源与同步 (GATE-01)

**Mode:** Interactive discuss(用户经 /gsd-manager Continue 进入;要求全程应用 /frontend-design;仅选 1/4 灰区)

---

## 灰区选择

4 个灰区 offered(真值源与同步/阻塞态呈现+落位/协议缺口+通道/审批语义映射),用户仅选「真值源与同步」;其余三区转 Claude's Discretion(附 scout 发现的既定模式与硬约束)。

## 真值源与同步 (GATE-01)

### 状态真值源

| Option | Description | Selected |
|--------|-------------|----------|
| review-platform REST | GET /api/v1/reviews(content_ref 客户端侧过滤,Phase 49 已审计契约) | ✓ |
| kmc 工件 | 读 episodes/*/ gate_result 落盘 | |
| 双源合并 | platform 状态 + kmc 工件交叉验证 | |

**User's choice:** review-platform REST (Recommended)
**Notes:** review-platform 是运行时状态唯一发生地;khs gates.yaml 是定义非状态。

### 定义真值源

| Option | Description | Selected |
|--------|-------------|----------|
| 快照+契约测试 | 16 gate 定义固化为 kap zod 契约 + contract test 守一致(v2.0 模式) | ✓ |
| 运行时读文件 | kap 服务端直接读 khs 仓库路径 | |
| 手工维护 | UI 文案手工维护不守契约 | |

**User's choice:** 快照+契约测试 (Recommended)

### 同步机制

| Option | Description | Selected |
|--------|-------------|----------|
| 服务端轮询+socket推 | kap 定时轮询(15-30s)+ diff + canvas socket 广播 gate:state;前端不直连 | ✓ |
| 前端直连轮询 | 前端直连 review-platform API | |
| webhook 回调 | review-platform 回调 kap(跨三仓库改造) | |

**User's choice:** 服务端轮询+socket推 (Recommended)

### 状态口径

| Option | Description | Selected |
|--------|-------------|----------|
| 四态折叠 | 中间态折叠为 pending「等你决策」;approve/reject/waive 为终态 | ✓ |
| 全态透传 | 平台 6 态全展示 | |
| Claude 定 | researcher 依平台状态机实测定 | |

**User's choice:** 四态折叠 (Recommended)

---

## Claude's Discretion

- 画布阻塞态呈现形态(GATE-02):泳道高亮 vs 节点角标 vs 顶部横幅;gate 面板落位——受 G15 嵌入位协议与 frontend-design 纪律约束
- GATE-03 协议缺口关闭方案(49-D11 到期):改 kmc poller 词汇 vs 改平台终态 vs 双向兼容
- 审批语义映射:reject↔QualityGateRejection、waive↔degraded_pass、approve 载荷(choose:<id> 通道沿用)
- 操作通道是否复用 53-D15 G15 操作桥模式
- 轮询间隔数值、gate:state payload shape、快照缓存策略

## Deferred Ideas

None — 讨论未超出 phase 范围。
