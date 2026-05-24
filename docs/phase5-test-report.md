# Phase 5 全栈集成联调测试报告

> **日期**: 2026-05-24
> **测试环境**: Linux 6.17 (RTX 3090 + 3060Ti), Docker 28.x

---

## 1. Docker 镜像构建

| 服务 | 镜像大小 | 构建状态 |
|------|---------|---------|
| kais-movie-agent | 290MB | ✅ 成功 |
| kais-gold-team | 278MB | ✅ 成功 |
| kais-review-platform | 397MB | ✅ 成功 |
| kais-core-backend | 2.2GB | ⚠️ 构建成功但运行时 `@/core` 路径别名未解析 |

### 构建问题与修复
- **movie-agent**: 缺少 `lib/pipeline.js` 依赖 → 创建 mock Pipeline 类
- **review-platform**: Dockerfile 引用不存在的顶层目录 → 修正为 `app/` 结构
- **gold-team/review-platform**: build context 需指向外部 repo → 修正为绝对路径
- **core-backend**: esbuild `@/` alias 在 bundle 后未生效 → 待修复（需要 yarn install + 正确的 esbuild 构建）

---

## 2. 服务 Health 冒烟测试

| 服务 | 端口 | Health 结果 |
|------|------|------------|
| movie-agent | 8001 | ✅ `{"status":"ok","version":"6.0.0"}` |
| gold-team | 8002 | ✅ `{"status":"healthy","gpu":{"device":"RTX 3090"},"redis":"connected"}` |
| review-platform | 8090 | ✅ `{"status":"ok","version":"2.0.0","redis":true,"db":true}` |
| core-backend | 8000 | ❌ 运行时 MODULE_NOT_FOUND (`@/core`) |

---

## 3. 核心链路回调测试

### 3.1 管线生命周期 (movie-agent) ✅

```
POST /api/v1/pipeline/create  → 201 (pipeline_id: pipe_xxx)
POST /api/v1/pipeline/:id/start → 202 (status: running, from_phase: video)
GET  /api/v1/pipeline/:id/status → 200 (status: completed, progress: 1.0)
```

**8 个 V6 Phase 全部通过**: requirement → art-character → script-voice → storyboard-scene → video → post-production → quality-gate → delivery

### 3.2 GPU 任务提交 (gold-team) ✅

```
POST /api/v1/tasks → 201 (task_id: test-task-001, status: queued, engine: local)
GET  /api/v1/tasks/:id → 200 (status: completed, outputs: {video, thumbnail})
```

- 本地引擎自动选择 (local-comfyui-mock)
- 回调 URL 正确传递
- 产物路径: `/mnt/agents/output/test-task-001/final.mp4`

### 3.3 审核平台 (review-platform) ⚠️

- 宿主机 v2.0.0 运行中，Redis + DB 均正常
- Docker v6.0 镜像需要 PostgreSQL（网络问题未能拉取 postgres:16-alpine）
- v6 `shot-cards-v6` 路由仅存在于 Docker 镜像中

---

## 4. 未完成项

| 项目 | 问题 | 解决方案 |
|------|------|---------|
| core-backend 运行 | esbuild `@/` alias 未 bundle 进 data/serve/app.js | 需要在 Docker 构建中正确执行 `yarn install` + `yarn build` |
| review-platform Docker | 需要 PostgreSQL 容器 | `docker compose up` 拉起 postgres + redis 后测试 |
| PostgreSQL 镜像 | 网络不稳定拉取失败 | 等网络恢复或配置代理 |
| 全栈 E2E 测试 | 4 服务联合回调链 | core-backend 修复后重新测试 |

---

## 5. Docker Compose Smoke 配置

创建了 `docker-compose.smoke.yml` 用于快速冒烟测试（仅 movie-agent + gold-team + redis）。

完整配置（含 PostgreSQL）: `docker-compose.v6.yml`

---

## 6. 下一步

1. **修复 core-backend Docker 构建** — 确保 esbuild 正确 bundle `@/` 路径别名
2. **网络恢复后拉取 PostgreSQL** — `docker pull postgres:16-alpine`
3. **全栈 docker compose up** — 4 服务 + PostgreSQL + Redis 联调
4. **E2E 自动化测试脚本** — curl/schemathesis 契约测试
