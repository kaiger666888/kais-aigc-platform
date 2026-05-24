# KAIS AIGC Platform V6.0

> 全栈 AI 短剧自动化生产平台 — MVP-0

**架构**: 4 服务微服务 + GPU 引擎 + PostgreSQL + Redis

| 服务 | 技术栈 | 端口 | GPU |
|------|--------|------|-----|
| kais-core-backend | Node.js + Express | 8000 | - |
| kais-movie-agent | Node.js + Express | 8001 | - |
| kais-gold-team | Python + FastAPI | 8002 | RTX 3090 |
| kais-review-platform | Python + FastAPI | 8090 | - |

---

## 快速开始

### 前置要求

- Docker 29.4.3+
- NVIDIA GPU + nvidia-docker (RTX 3090 24GB)
- Node.js v24.13.0 (本地开发)

### Docker Compose 一键启动

```bash
# 克隆仓库
git clone https://github.com/kaiger666888/kais-aigc-platform.git
cd kais-aigc-platform

# 启动全栈（smoke test）
docker compose -f docker-compose.smoke.yml up -d

# 验证健康
curl http://localhost:8000/health  # core-backend
curl http://localhost:8001/health  # movie-agent
curl http://localhost:8002/health  # gold-team
curl http://localhost:8091/health  # review-platform

# 停止
docker compose -f docker-compose.smoke.yml down
```

### 本地开发

```bash
# 安装依赖 (core-backend)
cd services/core-backend
yarn install

# 启动开发服务器
yarn dev

# 安装依赖 (movie-agent)
cd services/movie-agent
yarn install
yarn dev
```

---

## 架构

### 服务通信流

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   用户/Web  │ ───> │core-backend  │ ───> │movie-agent  │
└─────────────┘      └──────────────┘      └─────────────┘
                            │                      │
                            v                      v
                     ┌──────────────┐      ┌─────────────┐
                     │ PostgreSQL   │      │ gold-team   │ ──> GPU (RTX 3090)
                     │   + Redis    │      └─────────────┘
                     └──────────────┘              │
                            ▲                      │
                            │                      v
                     ┌──────────────┐      ┌─────────────┐
                     │review-platform│ <──── │  ComfyUI   │
                     └──────────────┘      └─────────────┘
```

### 核心组件

- **kais-core-backend**: 项目管理、角色管理、分镜管理、SQLite 同步
- **kais-movie-agent**: 工作流编排、任务调度、状态机管理、Telegram 通知
- **kais-gold-team**: 统一执行 Agent，调用 ComfyUI/云端引擎
- **kais-review-platform**: 人工审核界面 (HTMX/Alpine)、治理审批 API

---

## Docker 镜像

| 镜像 | 大小 | 说明 |
|------|------|------|
| `kais-core-backend:latest` | 2.2GB | Toonflow Express Server |
| `kais-movie-agent:latest` | 290MB | 调度中枢 |
| `kais-gold-team:latest` | 278MB | GPU 执行引擎 |
| `kais-review-platform:latest` | ~500MB | 审核平台 |
| `postgres:latest` | 650MB | PostgreSQL 18 |
| `redis:7-alpine` | 57.8MB | Redis 缓存 |

---

## 环境变量

创建 `.env` 文件：

```bash
# Core Backend
NODE_ENV=production
CORE_PORT=8000

# Database
POSTGRES_USER=kais
POSTGRES_PASSWORD=***
POSTGRES_DB=kais_audit
POSTGRES_PORT=5432

# Redis
REDIS_PORT=6379

# Movie Agent
MOVIE_AGENT_PORT=8001
CORE_BACKEND_URL=http://kais-core-backend:8000
GOLD_TEAM_URL=http://kais-gold-team:8002
REVIEW_PLATFORM_URL=http://kais-review-platform:8090

# Gold Team
GOLD_TEAM_PORT=8002
COMFYUI_URL=http://comfyui-worker:8188

# Review Platform
REVIEW_PORT=8090
API_KEY=***
JWT_SECRET=***

# GPU
CUDA_VISIBLE_DEVICES=0
```

---

## GPU 分配

- **GPU 0 (RTX 3090 24GB)**: 所有 AIGC 推理 + 后处理
- **GPU 1 (RTX 3060Ti 8GB)**: 显示 + NVENC/NVDEC + ffmpeg IO（宿主机，非 Docker）

---

## 测试

### 单元测试

```bash
# Core Backend
cd services/core-backend
yarn test

# Movie Agent
cd services/movie-agent
yarn test
```

### 集成测试

```bash
# E2E 测试
docker compose -f docker-compose.smoke.yml up -d
./scripts/test-e2e.sh
```

---

## 文档

- [Phase 5 Test Report](./docs/phase5-test-report.md)
- [API Specs](./docs/api-specs.md)
- [Architecture](./docs/architecture.md)
- [Deployment Guide](./docs/deployment.md)

---

## 贡献

欢迎提交 Issue 和 Pull Request。

---

## 许可证

Apache License 2.0

---

## MVP 状态

- ✅ Phase 0-4: OpenAPI specs + 4 service APIs
- ✅ Phase 5: Full-stack Docker Compose integration
- ⏳ Phase 6: Migration cleanup (进行中)

**Current Version**: 6.0.0-mvp.0
**Latest Commit**: `06a1a7c`
