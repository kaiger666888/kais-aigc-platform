# Roadmap

## Current Milestone

### [v1.2 — Hermes-Agent Integration Testing](phases/) ✅ Complete

构建 hermes-agent 服务的完整集成测试体系，覆盖独立 API 测试、movie-agent 联合测试、压力稳定性测试和 CI 流水线自动化。

**Goal:** 验证 hermes-agent 在真实运行环境（Docker + 真实 LLM）下的功能正确性、稳定性和容错能力，并建立自动化测试基础设施。

---

## Phase 11: Test Infrastructure & Standalone Integration ✅

**Type:** testing
**Status:** Complete
**Requirements:** FR-01.1 ~ FR-01.9, NFR-01 ~ NFR-04

| Plan | Title | Status |
|------|-------|--------|
| 11.1 | Test Infrastructure | ✅ Complete |
| 11.2 | Standalone API Integration Tests | ✅ Complete |

**Deliverables:** docker-compose.test.yml, conftest_integration.py, Makefile, 6 test files (23 tests)

---

## Phase 12: Movie-Agent Joint Integration ✅

**Type:** testing
**Status:** Complete
**Requirements:** FR-02.1 ~ FR-02.6

| Plan | Title | Status |
|------|-------|--------|
| 12.1 | Client Integration Tests | ✅ Complete |
| 12.2 | Degradation & Retry Tests | ✅ Complete |

**Deliverables:** 3 test files (12 tests) — decide/audit/degradation via hermes-client.js

---

## Phase 13: Stress & Stability Testing ✅

**Type:** testing
**Status:** Complete
**Requirements:** FR-03.1 ~ FR-03.6

| Plan | Title | Status |
|------|-------|--------|
| 13.1 | Concurrency & Mixed Load Tests | ✅ Complete |
| 13.2 | Stability & Fault Recovery Tests | ✅ Complete |

**Deliverables:** 2 test files (7 tests) — concurrency, 100-cycle stability, restart recovery

---

## Phase 14: CI Pipeline & Reporting ✅

**Type:** infrastructure
**Status:** Complete
**Requirements:** FR-04.1 ~ FR-04.5

| Plan | Title | Status |
|------|-------|--------|
| 14.1 | GitHub Actions Workflow | ✅ Complete |
| 14.2 | Reporting & Developer Experience | ✅ Complete |

**Deliverables:** GitHub Actions workflow, run-integration-tests.sh, Makefile targets

---

## Completed Milestones

### [v1.1 — Hermes Intelligent Decision Engine](milestones/v1.1-ROADMAP.md)

以 NousResearch/hermes-agent 为底座，构建通用智能决策引擎，4 个阶段全部完成 (2026-06-06)。
21 个需求全部满足，跨阶段集成验证通过。
