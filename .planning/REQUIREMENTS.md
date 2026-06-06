# Requirements — v1.2 Integration Testing: Hermes-Agent

## Overview

为 hermes-agent 服务构建完整的集成测试体系，覆盖独立服务测试、movie-agent 联合测试、压力/稳定性测试和 CI 流水线自动化。

---

## Functional Requirements

### FR-01: 独立服务集成测试

hermes-agent 容器 + 真实 LLM 的全 API 端点测试。

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01.1 | 启动真实 hermes-agent Docker 容器，验证 /v1/health 返回正确状态 | Must |
| FR-01.2 | POST /v1/register 注册 movie-pipeline 域，验证 201/422 幂等 | Must |
| FR-01.3 | POST /v1/decide 对 10 个 pipeline task 逐一调用，验证返回结构 (decision_id, recommendation, confidence, domain, task, timestamp) | Must |
| FR-01.4 | POST /v1/decide 使用 context 上下文参数，验证 LLM 接收并利用 context 生成差异化推荐 | Must |
| FR-01.5 | POST /v1/audit 记录决策反馈，验证 audit_history.json 写入和 auto_learn 触发阈值 | Must |
| FR-01.6 | GET /v1/domains 列出已注册域，GET /v1/domains/{domain}/skills 列出技能 | Should |
| FR-01.7 | GET /v1/domains/{domain}/memory 返回 task_stats 和 confidence 数值 | Should |
| FR-01.8 | 域隔离验证：注册两个域，对域 A 操作不影响域 B 的 memory/ 和 skills/ | Must |
| FR-01.9 | 完整学习循环：decide(conf=0) → audit × N → decide(conf>0) → audit(auto_learn=true) → memory 验证 | Must |

### FR-02: Movie-Agent 联合集成测试

hermes-client.js + hermes-agent 容器的端到端链路测试。

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-02.1 | Node.js 子进程调用 hermes-client.js decide()，连接真实 hermes-agent，返回非降级结果 | Must |
| FR-02.2 | Node.js 子进程调用 hermes-client.js audit()，记录反馈成功 | Must |
| FR-02.3 | movie-pipeline 域注册后，从 movie-agent 侧验证 10 个 task 的 decide 通路 | Must |
| FR-02.4 | 降级测试：hermes-agent 不可达时，hermes-client.js 返回 degraded=true 和 HERMES_DEFAULTS 参数 | Must |
| FR-02.5 | 超时测试：hermes-agent 响应超过 5s 时，hermes-client.js 正确降级 | Should |
| FR-02.6 | 重试测试：首次请求失败后自动重试一次 | Should |

### FR-03: 压力与稳定性测试

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-03.1 | 并发 10 个 decide 请求同时发送，全部返回 200 | Must |
| FR-03.2 | 并发 20 个 mixed decide+audit 请求，无数据损坏或 500 错误 | Must |
| FR-03.3 | 单次 decide 请求 LLM 响应延迟 > 30s 时不阻塞其他请求 | Should |
| FR-03.4 | 连续 100 次 decide+audit 循环，无内存泄漏（RSS 增长 < 50MB） | Should |
| FR-03.5 | hermes-agent 容器重启后，持久化数据 (domains/, memory/) 完整恢复 | Must |
| FR-03.6 | 错误域/任务请求返回 4xx，不影响后续正常请求 | Must |

### FR-04: CI 流水线

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-04.1 | docker-compose.test.yml 一键启动 hermes-agent 测试环境 | Must |
| FR-04.2 | GitHub Actions workflow：PR 触发 → 启动容器 → 运行集成测试 → 报告结果 → 销毁环境 | Must |
| FR-04.3 | 本地可运行：`make test-integration` 一键执行完整集成测试套件 | Must |
| FR-04.4 | 测试报告生成：通过/失败计数、失败详情、LLM 响应延迟统计 | Should |
| FR-04.5 | 测试失败时自动收集容器日志和健康状态 | Should |

---

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | 测试套件总运行时间 < 10 分钟（不含镜像构建） |
| NFR-02 | 集成测试可重复运行，无残留状态污染（每次测试清理或使用隔离 namespace） |
| NFR-03 | CI 中 LLM API 调用失败不产生误报（重试 + 超时合理配置） |
| NFR-04 | 测试脚本兼容 macOS + Linux |

---

## Out of Scope

- 单元测试（已有 conftest.py + mock agent 覆盖）
- movie-agent 内部管线逻辑测试（非 hermes 集成范畴）
- LLM 推荐质量评估（主观评判，非自动化范畴）
- 性能基准测试（benchmarking）— 后续里程碑

---

## Success Criteria

1. 所有 FR-01 ~ FR-04 Must 项全部通过
2. CI 流水线可在 PR 上自动触发并报告结果
3. 本地 `make test-integration` 可一键执行全部集成测试
4. 压力测试揭示的问题已修复或有明确的 follow-up 计划

---

*Created: 2026-06-06*
*Milestone: v1.2 Integration Testing — Hermes-Agent*
