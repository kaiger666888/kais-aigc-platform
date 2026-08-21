---
phase: 54-gate-gate-center-blocking-state-ux
plan: 02
subsystem: review-platform-r1
tags: [gate-03, r1, decision-persistence, waive-endpoint, deploy-smoke]

# Dependency graph
requires:
  - phase: 54-gate-gate-center-blocking-state-ux/54-01
    provides: 尾斜杠纪律 + REVIEW_PLATFORM_URL 环境断点修复(冒烟前置)
provides:
  - review-platform R1:approve 恒写 metadata.review_result.decision / reject 补写 {decision:'reject',reason} / POST /{id}/waive 端点(APPROVING→COMPLETE,reason 1-500)
  - 已部署活体平台(image 重建,id=4 waive / id=5 approve 冒烟数据为证)
  - kmc poller(54-03 R2)可消费的 decision 数据面:khs query_review_status 从此有 review_result 键可提取
affects: [54-03 khs R2 提取 result 键, 54-05 kap gate-ops 调用 waive 端点]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "决策双写:decision 落 review 记录(metadata_json.review_result,extra_updates 原子通道)+ audit timeline action 条目——T-54-02-01 repudiation 缓解"
    - "waive = reject 全镜像(_resolve_actor/404/409 守卫/StateConflict 处理逐行同构),差异仅 action 名与 decision 值——additive 不破坏 audit stats"
    - "docker compose 服务名≠容器名:service `api`(container review-api);compose 重建后 nginx 持旧 IP 502,`docker compose restart nginx` 刷新 upstream DNS"

key-files:
  created:
    - kais-review-platform:tests/test_approve_reject.py TestDecisionPersistenceAndWaive(7 新用例)
  modified:
    - kais-review-platform:app/api/v1/actions.py(approve 恒写 / reject 补写 / waive_review 端点 + 头注释清单)
    - kais-review-platform:app/models/schemas.py(WaiveRequest)
    - kais-review-platform:tests/conftest.py(Settings env_file=None 全局守卫)

key-decisions:
  - decision: deploy 命令为 `docker compose build api && docker compose up -d api`
    rationale: compose 服务名是 `api`(容器名 review-api);`build review-api` 报 no such service。RESEARCH §I.3 的"review-api rebuild"以实读 compose 文件为准落成此命令。
  - decision: 重建后必须 `docker compose restart nginx`
    rationale: review-nginx 容器(11 天未动)缓存 api 容器旧 IP;api recreate 换 IP 后 nginx 仍打旧地址 → 502。重启 nginx 刷新 DNS 后 health 200。此坑记档供下次部署复用。
  - decision: alembic DuplicateObjectError warning(audit_status type already exists → migration skipped)不阻断
    rationale: 既有幂等性怪癖,app 正常 startup;与本 plan 零依赖关系(无 schema 迁移)。

requirements-completed: [GATE-03]

duration: 38 min
completed: 2026-08-21T23:18:00+08:00
---

# Phase 54 Plan 02: review-platform R1 决策持久化 + waive 端点 Summary

G2/G5 缺口关闭:approve 恒写 decision、reject 补写 review_result、waive 端点上线;pytest 20/20 + docker 重建部署 + 活体 round-trip 冒烟(waive/approve 双证)。

**Duration:** 38 min · **Tasks:** 3/3(TDD ×1)· **Files:** 4(review-platform 仓)

## What Was Built

- **approve_review**:恒构造 `metadata["review_result"] = {"decision": "approve", ...(result.model_dump() 或 {})}` —— 不带 result 也落 decision(此前空 approve 在记录上不可区分)
- **reject_review**:补 `extra_updates` 原子写 `review_result={decision:'reject', reason}`(镜像 approve;audit payload 通道不变)
- **waive_review 端点**:`POST /api/v1/reviews/{id}/waive`,reject 全镜像(APPROVING 前置 409 / reason 1-500 必填),`review_result={decision:'waive', reason}`;头注释端点清单已注册
- **测试**:TestDecisionPersistenceAndWaive 7 用例(恒写/合并不丢/reject 回读/waive round-trip/空 reason 422/非 APPROVING 409/audit timeline action=waive);conftest Settings env_file=None 守卫(本地 .env compose 键炸 import 的根治)

## Self-Check: PASSED

- 平台仓 pytest:`tests/test_approve_reject.py` 20/20(含 7 新);全量套件无 R1 回归(既有 3 失败经 git stash 基线确证 PRE-EXISTING:gold_team api_key 漂移/web_auth/token_endpoint redis 态)
- 部署:`docker compose build api && docker compose up -d api` → 容器 healthy;health `{"status":"ok","version":"2.0.0","redis":true,"db":true}`
- 存量数据完好:id=1/2/3 仍在且状态不变(APPROVING×3)

## 活体 Round-Trip 冒烟(证据)

1. **waive**(review **id=4**):`POST /api/v1/reviews/` 尾斜杠最小提交(source=kap-phase54-smoke,type=smoke-gate-54,content_ref=ep-phase54-smoke/p13_delivery)→ `{"review_id":4,"state":"APPROVING","routing":"HUMAN"}`;随后 `POST /api/v1/reviews/4/waive {"reason":"phase54 deploy smoke"}` → `state="COMPLETE"`、`metadata.review_result={"decision":"waive","reason":"phase54 deploy smoke"}` ✅
2. **approve**(review **id=5**,加测):approve 后 `state="COMPLETE"`、`review_result.decision="approve"` ✅(R1 核心主张活体确证)
3. 冒烟数据保留平台(source=kap-phase54-smoke,不命中 kais-movie-agent 过滤器,不污染 gate 面板)

## Deviations from Plan

**[Rule 2 - 环境] compose 服务名是 `api` 非 `review-api`** — Found during: Task 3 | Issue: `docker compose build review-api` → no such service | Fix: 实读 `docker compose config --services` 后用 `build api && up -d api` | Verification: 容器重建 healthy
**[Rule 2 - 环境] 重建后 nginx 502(旧 IP 缓存)** — Found during: Task 3 | Issue: api recreate 换 IP,review-nginx 持旧 upstream → 502(容器自身 internal /health 200) | Fix: `docker compose restart nginx` 刷新 DNS → health 200 | Verification: curl 三段冒烟全通
**[Rule 1 - 测试环境] Settings env_file=None 需全局守卫** — Found during: Task 1 | Issue: fixture 内 patch 泄漏炸 TestJWTAuth | Fix: 挪到 conftest.py 全局(带 teardown 语义)+ 遗留 3 失败 stash 基线确证 PRE-EXISTING | Verification: 套件无 R1 回归

**Total deviations:** 3 auto-fixed。**Impact:** 无行为影响;部署双坑(服务名/nginx DNS)已固化 key-decisions。

## Issues Encountered

None blocking。

---

Ready for 54-03(khs R2+R3:poller 提取 result 键 + COMPLETE 词汇)。
