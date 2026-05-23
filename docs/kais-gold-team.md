# kais-gold-team V2 → V6.0 改造文档

> **版本**: 1.0  
> **日期**: 2026-05-23  
> **基于**: V6.0 Final Architecture (`docs/architecture.md`) + 审计报告 (`context/audit-gold-team.md`)  
> **总预估工作量**: 26-36 天 (约 5-7 周)

---

## 目录

1. [改造目标](#1-改造目标)
2. [新增模块清单](#2-新增模块清单)
3. [改造模块清单](#3-改造模块清单)
4. [删除模块清单](#4-删除模块清单)
5. [接口变更](#5-接口变更)
6. [迁移步骤](#6-迁移步骤)
7. [依赖关系](#7-依赖关系)

---

## 1. 改造目标

### 1.1 演进路径

```
V2 (当前)                              V6.0 (目标)
┌─────────────────────┐               ┌──────────────────────────┐
│ 双系统并行            │               │ 统一执行 Agent            │
│ ├─ kais-hub          │               │                          │
│ │  (Control Node +   │    ──→        │  FastAPI :8002           │
│ │   Worker Node)     │               │  ├─ Engine Router        │
│ ├─ hypervisor/       │               │  ├─ Local Engine Pool    │
│ │  orchestrator/     │               │  └─ Cloud Engine Pool    │
│ └─ combo/            │               │                          │
│                      │               │  Docker Compose 单机部署  │
│ 双机分布式部署         │    ──→        │  RTX 3090 单卡           │
│ (Syncthing/SFTP/     │               │  Redis Streams 内部队列   │
│  HTTP Callback)      │               │  V6.0 标准回调格式        │
│                      │               │                          │
│ RTX 3090 + 3060Ti    │    ──→        │  默认本地 3090            │
│ 双卡编排              │               │  降级云端 (可灵/即梦/      │
│                      │               │  Seedance/Runway/Luma)   │
└─────────────────────┘               └──────────────────────────┘
```

### 1.2 核心改造原则

| # | 原则 | 说明 |
|---|------|------|
| 1 | **默认本地，云端兜底** | Engine Router 优先 3090，VRAM 不足或模型缺失时降级 Cloud Pool |
| 2 | **3090 纯计算** | 24G 全部用于 AIGC 推理，无显示绑定 |
| 3 | **统一 REST API** | 端口 8002，替代 kais-hub 8900 + hypervisor 无入口的分裂状态 |
| 4 | **V6.0 标准回调** | `{task_id, status, engine_used, outputs, metadata}` |
| 5 | **大文件零 HTTP** | 产物走文件系统路径引用，不走 base64 |
| 6 | **端口绑定 127.0.0.1** | 不对外暴露，Tailscale VPN 提供远程访问 |

### 1.3 当前问题总结

审计发现 **2 个 Critical**、**4 个 High**、**2 个 Medium** 级别的 Gap：

| 严重度 | Gap | 核心问题 |
|--------|-----|---------|
| 🔴 Critical | G-01 | kais-hub 与 hypervisor/orchestrator 两套独立代码未统一 |
| 🔴 Critical | G-02 | 无统一 REST API 入口（8900 vs 无） |
| 🟡 High | G-03 | 无 ComfyUI 集成 |
| 🟡 High | G-04 | 无云端降级路由 |
| 🟡 High | G-05 | 回调格式非 V6.0 标准 |
| 🟡 High | G-06 | 双卡拓扑需简化为单卡 |
| 🟠 Medium | G-07 | 部署方式需从双机迁移到 Docker Compose |

---

## 2. 新增模块清单

### 2.1 P0 — 核心架构（必须，11-15 天）

| 模块 | 文件 | 预估工作量 | 优先级 | 说明 |
|------|------|-----------|--------|------|
| **统一 API Server** | `src/api_server.py` | 2-3d | P0 | FastAPI 统一入口，端口 8002。合并 kais-hub `control_node/api/tasks.py` 的 REST 接口。路由：`POST /api/v1/tasks`、`GET /api/v1/tasks/{id}`、`DELETE /api/v1/tasks/{id}`、`GET /api/v1/tasks/events/stream` (SSE)、`POST /api/v1/pipelines`、`GET /health` |
| **Engine Router** | `src/engine_router.py` | 3-5d | P0 | 核心路由决策：优先本地 3090 → VRAM/模型检查 → 降级云端。策略：(1) 检查本地 GPU 空闲且 VRAM 足够；(2) 检查所需模型是否在本地；(3) 本地可用 → Local Pool；(4) 不可用 → Cloud Pool (Jellyfish) |
| **统一回调格式** | `src/callback_standard.py` | 1d | P0 | V6.0 标准回调 `{task_id, status, engine_used, outputs, metadata}`。替换现有 `CallbackClient`（HMAC 签名回调）。保留 HMAC 签名作为安全层，在标准格式外层包装 |
| **Docker Compose** | `docker-compose.yml` + `Dockerfile` | 2d | P0 | 从双机部署迁移到单机 Docker Compose。定义 kais-gold-team 服务 + Redis 7 + 可选 ComfyUI sidecar |
| **Local Engine Pool** | `src/local_engine_pool.py` | 3-4d | P0 | 管理 ComfyUI/Docker 容器引擎生命周期。整合现有 `ToolAdapter` + `Executor`。接口：`acquire(model_id) → engine`、`release(task_id)`、`health_check() → status` |

### 2.2 P1 — 云端集成（重要，5-8 天）

| 模块 | 文件 | 预估工作量 | 优先级 | 说明 |
|------|------|-----------|--------|------|
| **Cloud Engine Pool** | `src/cloud_engine_pool.py` | 3-5d | P1 | 对接 Jellyfish 商业 API。云端引擎：可灵 (Kling)、即梦 (Jimeng)、Seedance、Runway、Luma。接口：`submit(request) → response`、`poll(external_task_id) → status`、`cancel(external_task_id) → bool` |
| **Jellyfish Adapter** | `src/jellyfish_adapter.py` | 2-3d | P1 | Jellyfish API 适配层。从 kais-core-backend 迁移商业 API 调用逻辑（可灵/即梦/Seedance 等的 HTTP 客户端、任务模型、引擎配置） |

### 2.3 P2 — 引擎扩充（增强，7-10 天）

| 模块 | 文件 | 预估工作量 | 优先级 | 说明 |
|------|------|-----------|--------|------|
| **ComfyUI Bridge** | `src/comfyui_bridge.py` | 3-5d | P2 | 将 ComfyUI workflow 暴露为统一引擎接口。支持 Wan2.2/FLUX/SD3.5/LTX-Video/ACE-Step/TTS 等模型通过 ComfyUI API 调用 |
| **后处理管线** | `src/postprocess_worker.py` | 2d | P2 | Real-ESRGAN 超分辨率 + GFPGAN/CodeFormer 人脸修复。对应 V6.0 显存预算：超分 2G，人脸修复 1.5G |
| **模型注册表更新** | `config/models_registry.py`（改造） | 1-2d | P2 | 新增 Wan2.2、FLUX 独立管线、ACE-Step、Real-ESRGAN、GFPGAN、TRELLIS、Hunyuan3D 模型条目 |
| **路由表更新** | `config/routing_table.json`（改造） | 1d | P2 | 更新为 V6.0 节点列表，去除 3060Ti 分区路由逻辑 |

---

## 3. 改造模块清单

### 3.1 hypervisor → 简化为单机 Docker Compose

| 文件 | 改造方向 | 预估工作量 |
|------|---------|-----------|
| `hypervisor/hypervisor.py` | 保留 11-state 状态机核心逻辑；去除双卡锁（OwnerLock 简化为单锁）；去除 Apptainer/SIF 执行路径（伪代码）；执行路径改为 Local Engine Pool 调用 | 2d |
| `hypervisor/vram_budget.py` | 保留 VRAM 预算管理；去除双卡分区逻辑；简化为单卡 3090 的 23.5G 可用硬边界 | 1d |
| `hypervisor/gpu_manager.py` | 简化为单卡管理；`CUDA_VISIBLE_DEVICES=0` 固定；去除 GPU1 相关逻辑 | 0.5d |
| `deploy/` 整个目录 | 废弃。用根目录 `docker-compose.yml` + `Dockerfile` 替代 | 0d（删除） |

**改造要点**：

```python
# hypervisor/hypervisor.py 改造示意
# BEFORE: 双卡 OwnerLock
# self._owner_locks = {0: None, 1: None}

# AFTER: 单卡简化
class GPUHypervisor:
    def __init__(self):
        self._gpu_index = 0                    # 固定 GPU0
        self._vram_hard_cap = 23504            # 23.5G MB
        self._current_owner = None             # 单锁
        self._state = HypervisorState.IDLE
```

### 3.2 kais-hub → 保留核心调度，去除双机分布式

| 文件 | 改造方向 | 预估工作量 |
|------|---------|-----------|
| `kais-hub/control_node/main.py` | 合并到 `src/api_server.py` 作为统一入口 | 1d |
| `kais-hub/control_node/api/tasks.py` | REST 接口迁移到 `src/api_server.py`，端口改为 8002 | 1d |
| `kais-hub/control_node/scheduler.py` | 保留核心调度逻辑（优先级队列、任务分配），去除双机分发 | 1d |
| `kais-hub/control_node/sync/` | **整个目录删除**（Syncthing + SFTP 不再需要） | 0d（删除） |
| `kais-hub/control_node/utils/sftp_client.py` | **删除** | 0d |
| `kais-hub/worker_node/daemon.py` | 合并到统一入口，去除双机独立 daemon 模式 | 1d |
| `kais-hub/worker_node/tool_adapter.py` | 保留 ToolAdapter 框架，统一到 Local Engine Pool | 1d |
| `kais-hub/worker_node/executor.py` | 保留 Docker 执行逻辑，去除双机回调 | 0.5d |
| `kais-hub/worker_node/callback_client.py` | 替换为 `src/callback_standard.py` 的 V6.0 标准格式 | 0.5d |
| `kais-hub/shared/` | 保留 Pydantic 模型和工具函数 | 0d |
| `kais-hub/engines/*.yaml` | 迁移到 `config/engines/`，去除双机参数 | 0.5d |
| `kais-hub/docker/` | Docker 配置迁移到根目录 Dockerfile | 0.5d |

### 3.3 workers → heavy_worker 合并为统一引擎接口

| 文件 | 改造方向 | 预估工作量 |
|------|---------|-----------|
| `workers/heavy_worker.py` | 改造为统一引擎接口，注册到 Local Engine Pool | 1d |
| `workers/light_worker.py` | **删除**（3060Ti 专用） | 0d |
| `workers/overflow_worker.py` | **删除**（双卡溢出） | 0d |
| `workers/worker_base.py` | 保留基类，简化为单机执行 | 0.5d |

### 3.4 journal → Redis Streams 保留，增加回调通知

| 文件 | 改造方向 | 预估工作量 |
|------|---------|-----------|
| `journal/redis_streams.py` | 保留多优先级流 + 消费者组 + 死信队列；新增任务完成事件发布（触发回调通知） | 1d |
| `journal/logger.py` | 保留，增加 V6.0 标准格式日志 | 0.5d |
| `journal/recovery.py` | 保留，简化为单机恢复 | 0.5d |

**新增回调通知流程**：

```
任务完成 → redis_streams.publish("task.completed", payload)
         → callback_standard.notify(callback_url, payload)
         → HMAC 签名 + V6.0 标准格式 POST
```

---

## 4. 删除模块清单

### 4.1 完全废弃 → 归档到 `legacy/`

所有废弃代码先移入 `legacy/` 目录（而非直接删除），保留历史可追溯。

| 路径 | 行数(估) | 废弃原因 |
|------|---------|---------|
| `orchestrator/dual_gpu_coordinator.py` | ~462 | 双卡协调器，V6.0 单卡 3090 不需要 |
| `orchestrator/combo_scheduler.py` | ~392 | 3060Ti Combo 调度器，V6.0 无 3060Ti |
| `orchestrator/gpu_health.py` | ~300 | 双卡健康检查，提取单卡版本后废弃 |
| `combo/combo_models.py` | ~400 | Combo 模型组合定义（6 个 Combo 硬编码） |
| `combo/combo_runtime.py` | ~350 | Combo 运行时 |
| `combo/combo_worker.py` | ~250 | Combo Worker |
| `workers/light_worker.py` | ~150 | 3060Ti 专用轻量 worker |
| `workers/overflow_worker.py` | ~100 | 双卡溢出 worker |
| `kais-hub/control_node/sync/syncthing.py` | ~200 | 双机 Syncthing 客户端 |
| `kais-hub/control_node/sync/sftp.py` | ~150 | 双机 SFTP 传输 |
| `kais-hub/control_node/utils/sftp_client.py` | ~100 | SFTP 工具类 |
| `kais-hub/worker_node/file_transport.py` | ~200 | 双机文件传输 |
| `deploy/dual_storage.py` | ~150 | 双机存储部署脚本 |
| `deploy/pcie_bandwidth.py` | ~100 | 双卡 PCIe 带宽计算 |
| `deploy/routing_table.json` | ~50 | deploy 目录旧路由表副本 |

**合计删除约 ~3,454 行代码**。

### 4.2 Combo 相关说明

V6.0 中 "Combo" 概念重新定义：

- **V2**: 3060Ti Combo — 利用 3060Ti 8G 运行轻量模型（如 SD3.5、TTS），与 3090 并行
- **V6.0**: 3060Ti 职责变更为 Toonflow 渲染 + NVENC 代理文件，**禁止 CUDA 推理**。Combo 概念不再存在
- 所有原 Combo 中的模型（SD3.5、TTS、后处理）统一由 3090 串行调度或降级云端

### 4.3 双机通信层废弃

| 通信方式 | 废弃原因 | 替代方案 |
|---------|---------|---------|
| Syncthing 文件同步 | 单机 Docker Compose 内共享 Docker volume | `volumes: /mnt/agents/output:/mnt/agents/output` |
| SFTP 文件传输 | 同上 | 同上 |
| HTTP Callback (双机间) | 单机内部通信走 Redis Streams + Docker bridge | `redis_streams.publish()` + FastAPI callback |

### 4.4 Control Node / Worker Node 分离架构废弃

| 分离模式 | V2 现状 | V6.0 替代 |
|---------|--------|----------|
| Control Node (低配机) | API 调度 + 任务分发 | `src/api_server.py`（统一入口） |
| Worker Node (高配机) | GPU 执行 + 引擎管理 | `src/local_engine_pool.py`（本地引擎池） |
| 双机网络 | Tailscale VPN + Syncthing | Docker bridge `kais-net` |

---

## 5. 接口变更

### 5.1 新增 REST API（端口 8002）

替换 kais-hub `control_node` 的 8900 端口，统一为 8002。

#### 任务管理

```
POST   /api/v1/tasks                  # 提交单任务
GET    /api/v1/tasks/{task_id}        # 查询任务状态
GET    /api/v1/tasks                  # 列出任务（支持 ?status=&limit= 过滤）
DELETE /api/v1/tasks/{task_id}        # 取消任务
GET    /api/v1/tasks/events/stream    # SSE 实时通知
```

#### Pipeline 管理

```
POST   /api/v1/pipelines              # 提交 Pipeline 批量任务
GET    /api/v1/pipelines/{id}         # 查询 Pipeline 状态
```

#### 健康检查

```
GET    /health                        # { status, gpu, engines, queue_depth }
```

#### 任务提交请求格式

```json
{
  "engine": "auto",                    // "auto" | "local" | "cloud"
  "model_id": "wan14b_i2v",           // 可选，指定模型
  "task_type": "image2video",          // text2image | image2image | image2video | text2video | text2audio | text2music | voice_clone | lip_sync | upscale | face_restore | text2_3d | composite
  "params": {
    "prompt": "...",
    "negative_prompt": "...",
    "width": 1280,
    "height": 720,
    "duration_sec": 5,
    "seed": 42,
    "num_frames": 41
  },
  "priority": 5,                       // 1-10，默认 5
  "callback_url": "http://kais-movie-agent:8001/api/v1/gpu/callback",
  "metadata": {
    "pipeline_id": "pipe_001",
    "phase": "video",
    "shot_id": "shot_003"
  }
}
```

#### 任务提交响应格式

```json
{
  "task_id": "gold_s03_02_v1",
  "status": "queued",
  "engine_assigned": "local",
  "estimated_vram_gb": 22.0,
  "queue_position": 1
}
```

### 5.2 统一生成接口设计

#### Engine Router 路由策略

```
任务进入 → Engine Router
  ├─ 1. 解析 task_type → 查找模型
  ├─ 2. 检查本地 GPU 空闲 + VRAM 足够？
  │    ├─ YES → Local Engine Pool (ComfyUI / Docker 容器)
  │    └─ NO → 继续判断
  ├─ 3. 检查所需模型是否在本地？
  │    ├─ YES → 排队等待 GPU 释放 → Local
  │    └─ NO → 继续判断
  ├─ 4. Cloud Pool 支持？→ 降级云端 (Jellyfish API)
  │    ├─ 可灵 → text2video / image2video
  │    ├─ 即梦 → text2image / image2image
  │    ├─ Seedance → text2video
  │    ├─ Runway → text2video / image2video
  │    └─ Luma → text2video / image2video
  └─ 5. 无可用引擎 → 返回错误
```

#### Pipeline 模板

| 模板 ID | 阶段组成 | 用途 |
|---------|---------|------|
| `short_film` | scene_gen → video_gen → postprocess | 短片完整流程 |
| `talking_head` | face_gen → lip_sync → postprocess | 虚拟人口型同步 |
| `voice_clone_video` | tts → face_gen → lip_sync | 声音克隆视频 |
| `foley_rvc` | sfx_gen → audio_mix → postprocess | 音效制作 |
| `image_to_video` | image_gen → video_gen | 图生视频 |
| `music_video` | music_gen → scene_gen → video_gen → composite | MV 制作（**新增**） |
| `3d_asset` | text_to_3d → postprocess_3d | 3D 资产生成（**新增**） |
| `full_postprocess` | upscale → face_restore → re_encode | 后处理全链路（**新增**） |

### 5.3 回调格式对齐

#### V2 回调（现有，废弃）

```json
{
  "event_id": "evt_xxx",
  "task_id": "xxx",
  "worker_id": "worker_3060ti",
  "data": { ... }
}
```

#### V6.0 标准回调（目标）

```json
{
  "task_id": "gold_s03_02_v1",
  "status": "completed",
  "engine_used": "local",
  "device": "cuda:0",
  "outputs": {
    "video": "/mnt/agents/output/gold_s03_02_v1/video.mp4",
    "proxy": "/mnt/agents/output/gold_s03_02_v1/proxy_720p.mp4",
    "thumbnail": "/mnt/agents/output/gold_s03_02_v1/thumbnail.jpg"
  },
  "metadata": {
    "seed": 42,
    "cost_usd": 0.00,
    "inference_time_sec": 145,
    "gpu_memory_peak_gb": 22.4,
    "model_used": "wan2.2-t2v-14b-fp16"
  },
  "error": null
}
```

**`engine_used` 取值**：
- `"local"` — 本地 3090 执行
- `"cloud:kling"` — 可灵云端
- `"cloud:jimeng"` — 即梦云端
- `"cloud:seedance"` — Seedance 云端
- `"cloud:runway"` — Runway 云端
- `"cloud:luma"` — Luma 云端

**HMAC 签名**：保留安全层，在 V6.0 标准 JSON 外层包装 HMAC-SHA256 签名 header。

### 5.4 接口变更对比

| 维度 | V2 (现有) | V6.0 (目标) |
|------|----------|-------------|
| API 端口 | kais-hub `:8900`，hypervisor 无端口 | 统一 `:8002` |
| 任务 Schema | `TaskSchema` 21 种 task_type 枚举 | V6.0 统一 `{task_type, engine, params}`，12 种 |
| 回调格式 | `CallbackClient` HMAC `{event_id, task_id, worker_id, data}` | V6.0 标准 `{task_id, status, engine_used, outputs, metadata}` |
| 引擎发现 | `engines/*.yaml` + `ToolAdapter` 注册表 | Engine Router 动态路由 |
| 显存管理 | 11-state VRAM + 双卡分区 | 简化：显存估算 + 优先级队列 + 单卡 |
| Pipeline 支持 | `PIPELINE_TEMPLATES` 6 个 | 扩展为 8 个（新增 music_video、3d_asset、full_postprocess） |
| SSE 实时通知 | 已有 | 保留 |
| 认证 | 无 | 待定（V6.0 架构未定义，建议 API Key） |

---

## 6. 迁移步骤

### Phase 0: 归档与基础（Week 1-2，3 天）

| 步骤 | 任务 | 产出 | 验证检查点 |
|------|------|------|-----------|
| 0.1 | 将废弃代码移入 `legacy/`（见第 4 节清单） | `legacy/` 目录，主分支干净 | `git diff --stat` 确认主分支无废弃代码引用 |
| 0.2 | 创建 `Dockerfile`（Python 3.11 + CUDA 基础镜像） | 可构建的 Docker 镜像 | `docker build -t kais-gold-team .` 成功 |
| 0.3 | 创建基础 `docker-compose.yml`（gold-team + Redis） | 服务可启动 | `docker-compose up` 启动无报错，Redis 连接正常 |

### Phase 1: 核心 API + Engine Router（Week 3-5，11-15 天）

| 步骤 | 任务 | 产出 | 验证检查点 |
|------|------|------|-----------|
| 1.1 | 实现 `src/api_server.py` — FastAPI 统一入口 :8002 | REST API 可访问 | `curl http://localhost:8002/health` 返回 GPU 状态 |
| 1.2 | 合并 kais-hub `control_node/api/tasks.py` 接口 | 任务 CRUD API | `POST /api/v1/tasks` 提交测试任务，返回 task_id |
| 1.3 | 实现 `src/callback_standard.py` | V6.0 标准回调 | 单元测试：回调 JSON 结构符合 V6.0 schema |
| 1.4 | 实现 `src/engine_router.py` | Local/Cloud 路由决策 | 单元测试覆盖：(a) 本地可用→local；(b) VRAM 不足→cloud；(c) 模型缺失→cloud；(d) 都不可用→error |
| 1.5 | 实现 `src/local_engine_pool.py` | 本地引擎池 | 集成测试：通过 API 提交任务→本地执行→回调通知 |
| 1.6 | 改造 `hypervisor/hypervisor.py` 为单卡 | 简化后的 Hypervisor | `nvidia-smi` 确认仅使用 GPU0 |
| 1.7 | 改造 `journal/redis_streams.py` 增加回调通知 | 事件驱动回调 | 任务完成→Redis 事件→回调 POST→kais-movie-agent 收到 |
| 1.8 | Docker Compose 集成测试 | 完整服务编排 | `docker-compose up` → API + Redis + 任务流转正常 |

### Phase 2: 云端集成 + 引擎扩充（Week 5-7，8-13 天）

| 步骤 | 任务 | 产出 | 验证检查点 |
|------|------|------|-----------|
| 2.1 | 实现 `src/cloud_engine_pool.py` | 云端引擎池 | Mock 测试：任务降级到云端→返回预期响应 |
| 2.2 | 实现 `src/jellyfish_adapter.py` | Jellyfish API 适配层 | 对接 Jellyfish 环境可用（可灵/即梦至少一个） |
| 2.3 | 实现 `src/comfyui_bridge.py` | ComfyUI 桥接 | ComfyUI sidecar 启动→text2video workflow 调通 |
| 2.4 | 更新 `config/models_registry.py` | 新增 V6.0 模型条目 | 模型注册表包含 Wan2.2/FLUX/ACE-Step/Real-ESRGAN/GFPGAN/TRELLIS/Hunyuan3D |
| 2.5 | 更新 `config/routing_table.json` | V6.0 路由表 | 无 3060Ti 分区，所有模型指向 GPU0 或云端 |
| 2.6 | 实现 `src/postprocess_worker.py` | 后处理管线 | 超分+人脸修复端到端测试通过 |
| 2.7 | Local/Cloud 路由端到端测试 | 完整路由链路 | 自动降级测试：本地满载→自动切云端→任务完成 |

### Phase 3: 清理与文档（Week 7-8，3 天）

| 步骤 | 任务 | 产出 | 验证检查点 |
|------|------|------|-----------|
| 3.1 | 清理所有 `legacy/` 引用，确保主代码无 import | 干净的代码库 | `grep -r "from legacy" src/` 无结果 |
| 3.2 | 环境变量统一（见下方配置） | `.env.example` | `docker-compose up --env-file .env` 正常启动 |
| 3.3 | API 文档（OpenAPI/Swagger） | `/docs` 端点可用 | Swagger UI 可交互测试所有端点 |
| 3.4 | 部署文档 + 运维手册 | `docs/deploy.md` | 新人按文档可独立部署 |

---

## 7. 依赖关系

### 7.1 与其他项目改造的先后依赖

```
                    ┌─────────────────────┐
                    │  Phase 0: 归档基础   │ (无外部依赖)
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
              ┌─────│  Phase 1: gold-team  │─────┐
              │     │  统一 API + Router   │     │
              │     └─────────┬───────────┘     │
              │               │                 │
    ┌─────────▼──────┐  ┌────▼──────────────┐  │
    │ kais-core-     │  │ kais-movie-agent   │  │
    │ backend 改造    │  │ Docker 化          │  │
    │ (Phase 2)      │  │ (Phase 3)          │  │
    │                │  │                    │  │
    │ 依赖:          │  │ 依赖:              │  │
    │ • gold-team    │  │ • gold-team API    │  │
    │   API :8002    │  │   :8002 可用       │  │
    │ • 共享 DB      │  │ • core-backend     │  │
    │   schema       │  │   API :8000 可用   │  │
    └────────────────┘  └────────────────────┘  │
                              │                 │
                    ┌─────────▼───────────┐     │
                    │  Phase 4: 集成完善   │◄────┘
                    │  (全栈测试)          │
                    └─────────────────────┘
```

### 7.2 具体依赖关系

| 本项目阶段 | 依赖的外部项目 | 依赖内容 | 阻塞风险 |
|-----------|--------------|---------|---------|
| **Phase 0** (归档基础) | 无 | 无外部依赖 | ✅ 无阻塞 |
| **Phase 1** (API + Router) | 无 | gold-team 自包含改造 | ✅ 无阻塞 |
| **Phase 1.5** (Cloud Pool) | **kais-core-backend** (Jellyfish) | 需要从 core-backend 迁移商业 API 调用逻辑（可灵/即梦/Seedance 的 HTTP 客户端代码） | 🟡 中等：可用 mock 适配器先行开发 |
| **Phase 2** (引擎扩充) | **ComfyUI Docker 镜像** | ComfyUI sidecar 容器可用，API 端口 8188 | 🟡 中等：ComfyUI 社区镜像可直接使用 |
| **Phase 2** (引擎扩充) | **kais-aigc-integration** | gold-team-worker 模块需合并到 gold-team | 🟠 低：可并行处理 |
| **Phase 3** (集成测试) | **kais-movie-agent** | movie-agent 需实现 `POST /api/v1/gpu/callback` 回调接收端 | 🟠 低：先用 mock server |
| **Phase 3** (集成测试) | **kais-core-backend** | gold-team 的 control-node API 需融入 core-backend | 🟡 中等：core-backend Phase 2 需先完成 |

### 7.3 并行工作机会

| 并行轨道 A (gold-team) | 并行轨道 B (其他项目) | 依赖点 |
|----------------------|---------------------|--------|
| Phase 0-1: 归档 + API + Router | kais-core-backend Phase 0: Audit DB 共享 + Init SQL | 无交叉 |
| Phase 1: Local Engine Pool | kais-core-backend Phase 1: Canvas Sync API | 无交叉 |
| Phase 2: Cloud Pool + Jellyfish Adapter | kais-movie-agent Phase 1: server.js REST API | movie-agent 需实现回调接收端 |
| Phase 2: ComfyUI Bridge | kais-review-platform: 审核扩展合并 | 无交叉 |
| Phase 3: 全栈测试 | kais-movie-agent Phase 2: QualityGateV2 | movie-agent 需调通 gold-team API |

### 7.4 关键路径

```
Phase 0 (归档) → Phase 1 (API+Router) → Phase 2 (Cloud Pool+ComfyUI) → Phase 3 (集成测试)
                    │                          │                              │
                    │                          │                              │
                    ▼                          ▼                              ▼
             core-backend Phase 0-1      core-backend Phase 2         movie-agent Phase 1-2
             (可并行)                    (依赖 gold-team API)          (依赖 gold-team API)
```

**总关键路径**: Phase 0 → Phase 1 → Phase 2 → Phase 3 ≈ **7-8 周**

---

## 附录 A: 目标目录结构

```
kais-gold-team/
├── docker-compose.yml              # 新增：统一编排
├── Dockerfile                      # 新增：统一构建
├── .env.example                    # 新增：环境变量模板
├── src/
│   ├── api_server.py               # 新增：V6.0 REST API :8002
│   ├── engine_router.py            # 新增：Local/Cloud 路由决策
│   ├── local_engine_pool.py        # 新增：本地引擎池
│   ├── cloud_engine_pool.py        # 新增：云端引擎池
│   ├── jellyfish_adapter.py        # 新增：Jellyfish API 适配层
│   ├── comfyui_bridge.py           # 新增：ComfyUI 桥接
│   ├── callback_standard.py        # 新增：V6.0 标准回调
│   ├── postprocess_worker.py       # 新增：后处理管线
│   └── pipeline_registry.py        # 新增：Pipeline 模板注册
├── config/
│   ├── models_registry.py          # 改造：新增 V6.0 模型
│   ├── routing_table.json          # 改造：V6.0 节点列表
│   └── engines/                    # 迁移：kais-hub 引擎配置
├── hypervisor/                     # 改造：简化为单卡
│   ├── hypervisor.py               # 改造：单锁、去除双卡
│   └── vram_budget.py              # 改造：单卡 23.5G
├── workers/
│   └── heavy_worker.py             # 改造：统一引擎接口
├── journal/                        # 改造：增加回调通知
│   ├── redis_streams.py            # 改造
│   └── logger.py                   # 改造
├── storage/
│   └── tier_manager.py             # 简化：Docker volume + 模型缓存
├── legacy/                         # 归档：废弃代码
│   ├── orchestrator/
│   ├── combo/
│   ├── deploy/
│   ├── workers/light_worker.py
│   ├── workers/overflow_worker.py
│   └── kais-hub/control_node/sync/
├── tests/                          # 测试
└── docs/
    └── deploy.md                   # 新增：部署文档
```

## 附录 B: 环境变量配置

```bash
# ═══ 核心配置 ═══
KAIS_API_PORT=8002
KAIS_GPU_INDEX=0
KAIS_VRAM_HARD_CAP_MB=23504
REDIS_URL=redis://redis:6379

# ═══ Local Engine Pool ═══
KAIS_WORKSPACE=/mnt/agents
KAIS_DOCKER_SOCKET=/var/run/docker.sock

# ═══ Cloud Engine Pool (Jellyfish) ═══
JELLYFISH_API_URL=https://api.jellyfish.ai
JELLYFISH_API_KEY=***
JELLYFISH_ENABLED=true

# ═══ ComfyUI Bridge ═══
COMFYUI_URL=http://comfyui-worker:8188
COMFYUI_ENABLED=false

# ═══ 回调安全 ═══
KAIS_CALLBACK_SECRET=***
KAIS_EXTERNAL_URL=http://kais-gold-team:8002

# ═══ 产物路径 ═══
KAIS_OUTPUT_DIR=/mnt/agents/output
KAIS_MODELS_DIR=/mnt/agents/models
```

## 附录 C: Docker Compose 目标配置

```yaml
services:
  kais-gold-team:
    build: .
    container_name: kais-gold
    ports:
      - "127.0.0.1:8002:8002"
    volumes:
      - /mnt/agents/output:/mnt/agents/output
      - /mnt/agents/models:/models:ro
      - /opt/kais/cloud-cache:/cloud-cache
      - /opt/kais/secrets:/run/secrets:ro
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - COMFYUI_HOST=comfyui-worker
      - COMFYUI_PORT=8188
      - REDIS_URL=redis://redis:6379
      - CLOUD_API_KEYS=/run/secrets/cloud_keys.json
      - JELLYFISH_BACKEND_URL=http://kais-core-backend:8000
      - NVIDIA_VISIBLE_DEVICES=0
      - CUDA_VISIBLE_DEVICES=0
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8002/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
    networks:
      - kais-net

  redis:
    image: redis:7-alpine
    container_name: kais-redis
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --maxmemory 2gb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - kais-net

  # 可选 ComfyUI sidecar
  comfyui-worker:
    build: ./comfyui-docker
    container_name: comfyui
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=0
      - CUDA_VISIBLE_DEVICES=0
    volumes:
      - /mnt/agents/output:/mnt/agents/output
      - /mnt/agents/models:/models:ro
    deploy:
      resources:
        limits:
          memory: 48G
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    profiles:
      - comfyui
    networks:
      - kais-net

volumes:
  redis-data:

networks:
  kais-net:
    driver: bridge
```
