# Roadmap

## Current Milestone

### [v1.2 — Hermes-Agent Integration Testing](phases/)

构建 hermes-agent 服务的完整集成测试体系，覆盖独立 API 测试、movie-agent 联合测试、压力稳定性测试和 CI 流水线自动化。

**Goal:** 验证 hermes-agent 在真实运行环境（Docker + 真实 LLM）下的功能正确性、稳定性和容错能力，并建立自动化测试基础设施。

---

## Phase 11: Test Infrastructure & Standalone Integration

**Type:** testing
**Estimate:** 2 plans

构建测试基础设施，编写 hermes-agent 独立服务的集成测试。

| Plan | Title | Description |
|------|-------|-------------|
| 11.1 | Test Infrastructure | docker-compose.test.yml、测试配置、共享 fixture、Makefile target |
| 11.2 | Standalone API Integration Tests | 6 个端点的真实 LLM 集成测试、域隔离、学习循环完整验证 |

**Requirements:** FR-01.1 ~ FR-01.9, NFR-01 ~ NFR-04
**Exit Criteria:** 全部 FR-01 Must 项通过；docker compose up → pytest 自动执行并报告

---

## Phase 12: Movie-Agent Joint Integration

**Type:** testing
**Estimate:** 2 plans

测试 hermes-client.js 与 hermes-agent 的联合链路，验证降级和重试机制。

| Plan | Title | Description |
|------|-------|-------------|
| 12.1 | Client Integration Tests | hermes-client.js decide/audit 真实链路、10 个 task 覆盖 |
| 12.2 | Degradation & Retry Tests | 降级、超时、重试的端到端验证 |

**Requirements:** FR-02.1 ~ FR-02.6
**Exit Criteria:** 全部 FR-02 Must 项通过；降级场景正确返回 HERMES_DEFAULTS

---

## Phase 13: Stress & Stability Testing

**Type:** testing
**Estimate:** 2 plans

并发压力测试、长时运行稳定性、故障恢复验证。

| Plan | Title | Description |
|------|-------|-------------|
| 13.1 | Concurrency & Mixed Load Tests | 并发 decide/audit、混合负载、错误输入容错 |
| 13.2 | Stability & Fault Recovery Tests | 连续循环、内存监控、容器重启恢复、数据持久化验证 |

**Requirements:** FR-03.1 ~ FR-03.6
**Exit Criteria:** 全部 FR-03 Must 项通过；无内存泄漏；容器重启后数据完整

---

## Phase 14: CI Pipeline & Reporting

**Type:** infrastructure
**Estimate:** 2 plans

GitHub Actions CI 流水线、测试报告、本地一键测试。

| Plan | Title | Description |
|------|-------|-------------|
| 14.1 | GitHub Actions Workflow | PR 触发 → compose up → 测试 → 报告 → teardown |
| 14.2 | Reporting & Developer Experience | 测试报告生成、失败日志收集、make test-integration |

**Requirements:** FR-04.1 ~ FR-04.5
**Exit Criteria:** CI 可在 PR 上自动触发；本地一键测试可用

---

## Completed Milestones

### [v1.1 — Hermes Intelligent Decision Engine](milestones/v1.1-ROADMAP.md)

以 NousResearch/hermes-agent 为底座，构建通用智能决策引擎，4 个阶段全部完成 (2026-06-06)。
21 个需求全部满足，跨阶段集成验证通过。
