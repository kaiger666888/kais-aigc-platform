# kais-aigc-platform 联调开发指南

## 1. 服务拓扑 & 接口契约

```
                    ┌─────────────────┐
                    │  core-backend   │ :8000
                    │  (Toonflow后端) │
                    │  SQLite + PG    │
                    └────────┬────────┘
                             │ ① getProject / getNovel / getEvents
                             ▼
┌──────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Toonflow   │◄───│  movie-agent    │───►│  gold-team      │
│  (前端SPA)   │    │  :8001 (调度)   │    │  :8002 (GPU)    │
└──────────────┘    └───────┬─────────┘    └───────┬─────────┘
       ⑧                   │ ③ submitReview        │ ② submitTask
                            ▼                       ▼
                    ┌─────────────────┐    ┌─────────────────┐
                    │ review-platform │    │   ComfyUI       │
                    │  :8090 (审核)   │    │   :8188 (渲染)  │
                    └─────────────────┘    └─────────────────┘
                           ④                      ⑤
                    ┌─────────────────┐    ┌─────────────────┐
                    │  PostgreSQL     │    │    Redis        │
                    │  :5432          │    │    :6379        │
                    └─────────────────┘    └─────────────────┘
```

### 接口编号 & 契约摘要

| # | 调用方 | 被调方 | 接口 | 方法 | 关键字段 |
|---|--------|--------|------|------|----------|
| ① | movie-agent | core-backend | `/api/projects/:id` | GET | project config, style, aspect_ratio |
| ① | movie-agent | core-backend | `/api/novels/:id` | GET | 返回 `{data:{data:[...]}}` 双层嵌套 |
| ① | movie-agent | core-backend | `/api/projects/:id/events` | GET | pipe分隔表格，**无header行** |
| ② | movie-agent | gold-team | `/api/v1/tasks` POST | submitTask | type, priority(字符串!), params, callback_url |
| ② | movie-agent | gold-team | `/api/v1/tasks/:id` GET | getTask | status, output_url, progress |
| ② | movie-agent | gold-team | `/api/v1/tasks/:id/events` GET(SSE) | waitForTask | 实时进度 |
| ③ | movie-agent | review-platform | `/api/v1/reviews` POST | submitReview | type, content_ref, metadata, callback_url |
| ③ | movie-agent | review-platform | `/api/v1/shots` POST | createShotCard | project_id, phase, image_url |
| ④ | review-platform | PostgreSQL | 读写 | - | review logs, audit trail |
| ⑤ | gold-team | ComfyUI | `/prompt` POST | workflow执行 | workflow JSON |
| ⑥ | gold-team | Redis | Streams | 任务队列 | task lifecycle events |
| ⑦ | gold-team | 外部API | 即梦/可灵/seedance | 云渲染 | API keys from .env |
| ⑧ | Toonflow前端 | core-backend | REST + SSE | 项目/分镜管理 | via API gateway |

### 已知陷阱（踩坑记录）

1. **gold-team priority 必须是字符串** `"normal"/"high"/"critical"`，不是数字
2. **gold-team task_type** 是 `"tts"/"image_draw"/"video_gen"`，不是 `tts_generation`
3. **gold-team API 路径** 是 `/api/v1/tasks`，不是 `/api/tasks`
4. **core-backend novel 数据双层嵌套** `{data:{data:[...]}}` 需要2次unwrap
5. **core-backend events 表格无header行**，不能 `rows.slice(1)`
6. **review-platform 需要 API key 认证**，header `X-API-Key`
7. **ComfyUI 地址** Docker 内用 `172.17.0.1:8188`，不是 `comfyui:8188`（除非在 compose 网络内）

---

## 2. 联调开发流程

### 2.1 环境启动

```bash
# 开发模式（mock GPU 服务，不需要真实 GPU）
cd /home/kai/workspace/kais-aigc-platform
docker compose -f docker-compose.v6.yml --profile mock up -d

# 生产模式（需要 RTX 3090 + ComfyUI）
docker compose -f docker-compose.v6.yml up -d

# 检查所有服务健康
docker compose -f docker-compose.v6.yml ps
curl http://localhost:8000/health  # core-backend
curl http://localhost:8001/health  # movie-agent
curl http://localhost:8002/health  # gold-team
curl http://localhost:8090/health  # review-platform
curl http://localhost:8188/system_stats  # ComfyUI
```

### 2.2 修改代码 → 部署到容器

**标准流程（推荐）：**

```bash
# 1. 修改代码（在 workspace 里直接改）
vim /home/kai/workspace/kais-aigc-platform/docker/movie-agent/src/lib/xxx.js

# 2. 重建并重启该服务
docker compose -f docker-compose.v6.yml up -d --build kais-movie-agent

# 3. 查看日志
docker compose -f docker-compose.v6.yml logs -f kais-movie-agent
```

**快速热更新（不改 Dockerfile 的情况）：**

```bash
# 仅复制变更文件到容器内（适合 JS 文件修改）
docker cp /home/kai/workspace/kais-aigc-platform/docker/movie-agent/src/lib/xxx.js \
  kais-movie-agent:/app/src/lib/xxx.js

# 重启服务
docker restart kais-movie-agent

# 验证
docker logs --tail 20 kais-movie-agent
```

### 2.3 各 repo 代码变更联动

| 改了哪个 repo | 需要联动操作 |
|---------------|-------------|
| kais-aigc-platform (movie-agent) | `docker compose up -d --build kais-movie-agent` |
| kais-gold-team | `docker compose up -d --build kais-gold-team` |
| kais-review-platform | `docker compose up -d --build kais-review-platform` |
| kais-aigc-platform (docker/gold-team/Dockerfile) | 需要重建 gold-team 镜像 |
| kais-aigc-platform (docker/review-platform/Dockerfile) | 需要重建 review-platform 镜像 |

**注意：kais-gold-team 和 kais-review-platform 的 Dockerfile 在 aigc-platform 里定义，
但 build context 指向各自的 repo 目录（`../kais-gold-team`, `../kais-review-platform`）。**

### 2.4 集成测试 Checklist

每次联调后按此清单验证：

```bash
# 1. 全服务健康
for port in 8000 8001 8002 8090 8188; do
  echo -n ":$port → "
  curl -s http://localhost:$port/health || curl -s http://localhost:$port/system_stats | head -1
done

# 2. gold-team 引擎状态
curl http://localhost:8002/api/v1/engines

# 3. 提交一个测试任务
curl -X POST http://localhost:8002/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "test-'$(date +%s)'",
    "type": "image_draw",
    "priority": "normal",
    "params": {"prompt": "test image", "width": 512, "height": 512}
  }'

# 4. Pipeline 触发（通过 movie-agent API）
curl -X POST http://localhost:8001/api/pipeline/start \
  -H "Content-Type: application/json" \
  -d '{"project_id": "1779688174552"}'

# 5. 检查 Pipeline 状态
curl http://localhost:8001/api/pipeline/pipe_XXX/status
```

---

## 3. 联调纪律（防踩坑）

### 3.1 接口变更必须同步

改了任何 API 字段/路径/类型，必须：
1. 更新本文档的「接口契约」表
2. 在 Telegram 群 #kais-aigc-platform 话题里通知
3. 如果是 breaking change，标注受影响的调用方

### 3.2 不要绕过管线

- ❌ 不要 `scp` 直推文件到 inbox
- ❌ 不要 `docker cp` 绕过 compose 直接改容器
- ✅ 走 docker compose build → up 流程
- ✅ 快速验证可以用 docker cp + restart，但事后必须 build

### 3.3 数据格式防坑

- API 返回先 `console.log(JSON.stringify(res))` 看真实结构
- 不假设返回格式，尤其嵌套层级
- 表格/列表数据检查是否有 header 行

### 3.4 GPU 相关

- ComfyUI 用 systemd 管理（不是 Docker），地址 `172.17.0.1:8188`
- gold-team Docker 容器需要 `nvidia-container-toolkit` 才能用 GPU
- 桌面环境占 ~1.3GB 显存，实际可用 ~22.7GB
- Flux Dev FP16 模型在 `/home/kai/models/flux1-dev-fp16`

---

## 4. 仓库位置速查

| Repo | 本地路径 | GitHub |
|------|---------|--------|
| kais-aigc-platform | `/home/kai/workspace/kais-aigc-platform` | `kaiger666888/kais-aigc-platform` |
| kais-gold-team | `/home/kai/workspace/kais-gold-team` | `kaiger666888/kais-gold-team` |
| kais-review-platform | `/home/kai/workspace/kais-review-platform` | `kaiger666888/kais-review-platform` |
| kais-movie-agent (skill) | `/home/kai/workspace/kais-movie-agent` | `kaiger666888/kais-movie-agent` |
| Toonflow (upstream) | `/home/kai/Toonflow-app` | `HBAI-Ltd/Toonflow-app` |

---

*最后更新：2026-05-26*
*下次更新：接口变更时*
