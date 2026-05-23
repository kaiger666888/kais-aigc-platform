# kais-gold-team 深度审计报告

**审计日期**: 2026-05-23
**审计范围**: kais-gold-team 仓库全量代码 vs Notion V6.0 Final Architecture
**审计人**: Clawd (subagent)

---

## 0. 执行摘要

kais-gold-team 当前代码是一个**功能丰富但架构分裂**的系统。存在两套并行、未统一的执行管线：

1. **kais-hub 双机分布式系统**（Control Node + Worker Node）—— 生产可用，已部署运行
2. **GPU Hypervisor/Topology Router 编排层**（单机双卡编排）—— 设计完整，代码骨架已写，但未与 kais-hub 集成

V6.0 目标要求将两者合并为**统一执行 Agent**，以单机 Docker Compose 方式运行 REST API 端口 8002。当前两套系统的重叠度约 40%，整合工作量中等偏高。

**总体评估**: 代码质量高，模块化好，测试覆盖到位。主要问题是**架构统一**而非功能缺失。

---

## 1. 当前代码与 V6.0 目标的 Gap 清单

### 1.1 架构层面 Gap

| # | Gap | 现状 | V6.0 目标 | 严重度 |
|---|-----|------|-----------|--------|
| G-01 | **双系统未统一** | kais-hub (双机分布式) 与 hypervisor/orchestrator (单机双卡) 是两套独立代码 | 统一执行 Agent (kais-gold-team) | 🔴 Critical |
| G-02 | **无统一 REST API 入口** | kais-hub control_node 用 FastAPI 8900 端口；hypervisor 无 REST 入口 | 统一 REST API 端口 8002 | 🔴 Critical |
| G-03 | **无 ComfyUI 集成** | 现有引擎通过 Docker 容器独立运行 (FaceFusion/ACE-Step/TTS/Woosh/Parallax/Blender) | Local Pool → OpenClaw → ComfyUI @ 3090 | 🟡 High |
| G-04 | **无云端降级路由** | 所有任务仅走本地 GPU，无 fallback 到可灵/即梦/Seedance/Runway/Luma | Cloud Pool 降级路由 + Jellyfish API 复用 | 🟡 High |
| G-05 | **无统一回调格式** | kais-hub 有 HMAC 签名回调 (`callback_client.py`)，但格式非 V6.0 标准 | `{task_id, status, engine_used, outputs, metadata}` | 🟡 High |
| G-06 | **单卡拓扑** | hypervisor 设计为双卡 (3090+3060Ti)，V6.0 简化为单卡 3090 | Engine Router 默认本地 3090 | 🟠 Medium |
| G-07 | **部署方式** | 双机分布式 (Syncthing/SFTP/HTTP Callback) | Docker Compose 单机部署 | 🟠 Medium |

### 1.2 功能缺失

| # | 缺失功能 | 说明 |
|---|---------|------|
| F-01 | **Wan2.2 支持** | routing_table 中只有 wan13b/wan14b，无 Wan2.2 模型 |
| F-02 | **LTX-Video 更新** | 只有 ltx_i2v，缺少 LTX-Video 最新版本 |
| F-03 | **FLUX 模型** | models_registry 有 flux_kontext 但无独立 FLUX 推理管线 |
| F-04 | **ACE-Step 集成** | routing_table/hypervisor 无 ACE-Step（kais-hub 有 Docker 适配器） |
| F-05 | **Real-ESRGAN/GFPGAN** | 模型注册表和路由表中完全缺失后处理管线 |
| F-06 | **TRELLIS** | models_registry 有 trellis 但无独立 worker/执行逻辑 |
| F-07 | **Hunyuan3D** | routing_table 有 hunyuan3d2 但 kais-hub 无 Docker 引擎适配器 |
| F-08 | **统一 Engine Router** | 无 `engine_router` 模块决定 Local vs Cloud 路径 |

### 1.3 接口不匹配

| # | 不匹配点 | 现状 | V6.0 目标 |
|---|---------|------|-----------|
| I-01 | **任务 Schema** | `TaskSchema` (Pydantic) 含 `task_type` 枚举 (21 种) | V6.0 统一 `{task_id, engine, params}` |
| I-02 | **回调格式** | `CallbackClient` 发 `{event_id, task_id, worker_id, data}` | V6.0 `{task_id, status, engine_used, outputs, metadata}` |
| I-03 | **引擎发现** | kais-hub `engines/*.yaml` + `ToolAdapter` 注册表 | V6.0 通过 Engine Router 动态路由 |
| I-04 | **显存管理** | hypervisor 有 11-state VRAM 管理 + tier storage | V6.0 简化为显存估算 + 优先级队列 |

---

## 2. 需要新增/改造的模块列表

### P0 — 核心架构（必须）

| 模块 | 工作类型 | 预估工作量 | 说明 |
|------|---------|-----------|------|
| `engine_router.py` | **新增** | 3-5天 | 统一 Engine Router：Local → 3090, Cloud → Jellyfish API。核心路由逻辑：优先本地，VRAM 不足或模型缺失时降级云端 |
| `api_server.py` | **新增** | 2-3天 | FastAPI 统一入口，端口 8002。合并 kais-hub `control_node/api/tasks.py` 的 REST 接口 |
| `callback_standard.py` | **新增** | 1天 | V6.0 标准回调格式 `{task_id, status, engine_used, outputs, metadata}`。替换现有 `CallbackClient` |
| `docker-compose.yml` | **新增** | 2天 | 从双机部署迁移到单机 Docker Compose。定义所有服务编排 |
| `local_engine_pool.py` | **新增** | 3-4天 | Local Engine Pool：管理 ComfyUI/Docker 容器引擎生命周期。整合现有 `ToolAdapter` + `Executor` |

### P1 — 云端集成（重要）

| 模块 | 工作类型 | 预估工作量 | 说明 |
|------|---------|-----------|------|
| `cloud_engine_pool.py` | **新增** | 3-5天 | Cloud Pool：复用 Jellyfish 商业 API 代码，对接可灵/即梦/Seedance/Runway/Luma |
| `jellyfish_adapter.py` | **新增** | 2-3天 | Jellyfish API 适配层，从 kais-core-backend 迁移商业 API 调用逻辑 |

### P2 — 引擎扩充（增强）

| 模块 | 工作类型 | 预估工作量 | 说明 |
|------|---------|-----------|------|
| `models_registry.py` | **改造** | 1-2天 | 新增 Wan2.2/FLUX/ACE-Step/Real-ESRGAN/GFPGAN/TRELLIS/Hunyuan3D 模型条目 |
| `routing_table.json` | **改造** | 1天 | 更新为 V6.0 节点列表，去除双卡路由逻辑 |
| `comfyui_bridge.py` | **新增** | 3-5天 | ComfyUI 桥接模块：将 ComfyUI workflow 暴露为统一引擎接口 |
| `postprocess_worker.py` | **新增** | 2天 | Real-ESRGAN + GFPGAN 后处理管线 |

### P3 — 简化/清理（优化）

| 模块 | 工作类型 | 预估工作量 | 说明 |
|------|---------|-----------|------|
| `topology_router.py` | **简化** | 1天 | 从双卡路由简化为单卡 + 云端降级 |
| `dual_gpu_coordinator.py` | **删除/归档** | 0.5天 | V6.0 单卡不需要双卡协调器 |
| `combo_scheduler.py` + `combo/` | **删除/归档** | 0.5天 | 3060Ti Combo 概念在单卡 3090 下不再适用 |
| `kais-hub/control_node/sync/` | **删除** | 0.5天 | Syncthing/SFTP 双机同步在单机 Docker 下不再需要 |
| `storage/tier_manager.py` | **简化** | 1天 | 三层存储简化为 Docker volume + 模型缓存 |

**总预估工作量**: P0 约 11-15天, P1 约 5-8天, P2 约 7-10天, P3 约 3天。**合计约 26-36 天**

---

## 3. 需要删除/废弃的旧代码

### 3.1 完全废弃（V6.0 不需要）

| 路径 | 原因 | 备注 |
|------|------|------|
| `orchestrator/dual_gpu_coordinator.py` | 双卡协调器，V6.0 单卡 | 462 行，可归档到 `legacy/` |
| `orchestrator/combo_scheduler.py` | 3060Ti Combo 调度，V6.0 无 3060Ti | 392 行 |
| `orchestrator/gpu_health.py` | 双卡健康检查，V6.0 简化 | 可提取单卡版本 |
| `combo/` 整个目录 | Combo 运行时仅用于 3060Ti | combo_models.py + combo_runtime.py + combo_worker.py |
| `workers/light_worker.py` | 3060Ti 专用轻量 worker | V6.0 只需 heavy_worker |
| `workers/overflow_worker.py` | 双卡溢出 worker | 单卡不需要 |
| `kais-hub/control_node/sync/syncthing.py` | 双机 Syncthing 客户端 | Docker Compose 不需要 |
| `kais-hub/control_node/sync/sftp.py` | 双机 SFTP 传输 | Docker Compose 不需要 |
| `kais-hub/control_node/utils/sftp_client.py` | SFTP 工具类 | 同上 |
| `kais-hub/worker_node/file_transport.py` | 双机文件传输 | 同上 |
| `deploy/dual_storage.py` | 双机存储部署脚本 | 同上 |
| `deploy/pcie_bandwidth.py` | 双卡 PCIe 带宽计算 | 单卡不需要 |
| `deploy/routing_table.json` | deploy 目录的旧路由表副本 | 用 config/ 下的替代 |

### 3.2 简化后保留

| 路径 | 简化方向 |
|------|---------|
| `orchestrator/topology_router.py` | 去除双卡路由逻辑，改为 Local/Cloud 路由 |
| `hypervisor/hypervisor.py` | 11-state 状态机保留，去除双卡锁（OwnerLock 简化为单锁） |
| `hypervisor/vram_budget.py` | VRAM 预算管理保留，去除双卡分区逻辑 |
| `config/routing_table.json` | 更新为 V6.0 节点列表（去除 3060Ti 分区） |
| `config/models_registry.py` | 新增 V6.0 模型，去除 3060Ti 专用参数 |
| `kais-hub/worker_node/tool_adapter.py` | 保留 ToolAdapter 框架，统一到 Local Engine Pool |
| `kais-hub/worker_node/executor.py` | 保留 Docker 执行逻辑，去除双机回调 |
| `kais-hub/worker_node/callback_client.py` | 替换为 V6.0 标准回调格式 |

---

## 4. 与 kais-core-backend (Jellyfish 改造) 的集成接口设计建议

### 4.1 集成架构

```
kais-gold-team (执行 Agent)
    │
    ├── Local Engine Pool ──→ Docker 容器 (3090)
    │   ├── ComfyUI Bridge (Wan2.2/FLUX/SD3.5/LTX-Video/ACE-Step/TTS)
    │   └── Direct Engines (Blender/FaceFusion/Woosh/Parallax)
    │
    └── Cloud Engine Pool ──→ Jellyfish API
        ├── 可灵 (Kling)
        ├── 即梦 (Jimeng)
        ├── Seedance
        ├── Runway
        └── Luma
```

### 4.2 接口契约

```python
# cloud_engine_pool.py — 与 Jellyfish 的集成接口

class CloudEngineRequest(BaseModel):
    """发送到 Jellyfish 的请求格式"""
    task_id: str
    engine: str                # "kling" | "jimeng" | "seedance" | "runway" | "luma"
    task_type: str             # "text2video" | "image2video" | "text2image" | ...
    params: dict[str, Any]     # 引擎特定参数
    callback_url: str          # 回调地址
    priority: int = 5
    metadata: dict[str, Any] = {}

class CloudEngineResponse(BaseModel):
    """Jellyfish 返回的响应格式"""
    task_id: str
    external_task_id: str      # 云端任务 ID
    status: str                # "submitted" | "processing" | "done" | "failed"
    outputs: list[OutputFile]  # 输出文件 URL
    metadata: dict[str, Any]   # 引擎元数据（耗时、分辨率等）

class JellyfishAdapter:
    """Jellyfish API 适配器"""
    
    def __init__(self, base_url: str, api_key: str):
        self._base_url = base_url
        self._api_key = api_key
    
    async def submit(self, request: CloudEngineRequest) -> CloudEngineResponse:
        """提交任务到 Jellyfish"""
        ...
    
    async def poll(self, external_task_id: str) -> CloudEngineResponse:
        """轮询任务状态"""
        ...
    
    async def cancel(self, external_task_id: str) -> bool:
        """取消云端任务"""
        ...
```

### 4.3 从 kais-core-backend 迁移的代码

| 迁移源 | 迁移内容 | 说明 |
|--------|---------|------|
| Jellyfish `api/` | 云端 API 调用逻辑 | 可灵/即梦/Seedance 等 API 的 HTTP 客户端 |
| Jellyfish `models/` | 任务模型定义 | CloudTask/CloudResult 等 Pydantic 模型 |
| Jellyfish `config/` | 云端引擎配置 | API endpoint/key/rate limit 配置 |

### 4.4 Engine Router 降级策略

```python
class EngineRouter:
    """决定任务走 Local 还是 Cloud"""
    
    def route(self, task: Task) -> RouteDecision:
        # 1. 检查本地 GPU 是否空闲且 VRAM 足够
        # 2. 检查所需模型是否在本地模型库
        # 3. 本地可用 → Local Pool
        # 4. 本地不可用 → Cloud Pool (Jellyfish)
        # 5. Cloud 也不支持 → 返回错误
        ...
```

---

## 5. 与 kais-movie-agent 的接口契约对齐分析

### 5.1 kais-movie-agent 的需求

kais-movie-agent 是上层编排 Agent，负责将电影/短视频项目分解为多个 GPU 任务（场景生成、视频合成、TTS、音效、后期处理等）。它需要：

1. **提交任务** → 接收 `task_id`
2. **查询状态** → 获取进度和结果
3. **批量编排** → pipeline 级别的依赖管理
4. **结果回调** → 任务完成后通知

### 5.2 现有接口 vs kais-movie-agent 需求

| kais-movie-agent 需求 | 现有 kais-hub 接口 | 对齐状态 |
|----------------------|-------------------|---------|
| 提交单个任务 | `POST /api/tasks/` | ✅ 已对齐 |
| 查询任务状态 | `GET /api/tasks/{id}` | ✅ 已对齐 |
| 列出任务 | `GET /api/tasks/` | ✅ 已对齐 |
| 取消任务 | `DELETE /api/tasks/{id}` | ✅ 已对齐 |
| SSE 实时通知 | `GET /api/tasks/events/stream` | ✅ 已对齐 |
| Pipeline 编排 | `topology_router.decompose()` + `PIPELINE_TEMPLATES` | ⚠️ 部分对齐，需要扩展 |
| 统一回调格式 | `CallbackClient` (HMAC 签名) | ❌ 需改为 V6.0 标准格式 |
| 引擎选择（指定 Local/Cloud） | 无，仅 Local | ❌ 需新增 |
| 批量任务提交 | 无，逐个提交 | ❌ 需新增 |

### 5.3 建议的接口契约

```python
# V6.0 标准 REST API (端口 8002)

# 提交单任务
POST /api/v1/tasks
{
    "engine": "auto",          # "auto" | "local" | "cloud" | "comfyui"
    "model_id": "wan14b_i2v",  # 可选，指定模型
    "task_type": "image2video",
    "params": {...},
    "priority": 5,
    "callback_url": "...",     # 可选，任务完成后回调
    "metadata": {}
}
→ { "task_id": "...", "status": "queued", "engine_assigned": "local" }

# 提交 Pipeline
POST /api/v1/pipelines
{
    "pipeline": "short_film",
    "params": { "scene_prompt": "...", "duration": 10 },
    "callback_url": "..."
}
→ { "pipeline_id": "...", "tasks": [...], "status": "queued" }

# 查询任务
GET /api/v1/tasks/{task_id}
→ { "task_id": "...", "status": "done", "engine_used": "local:wan14b_i2v", 
    "outputs": [...], "metadata": {"duration_ms": 45000} }

# 查询 Pipeline
GET /api/v1/pipelines/{pipeline_id}
→ { "pipeline_id": "...", "status": "running", "tasks": [...], "progress": 0.6 }

# 统一回调 (V6.0 标准格式)
POST {callback_url}
{
    "task_id": "...",
    "status": "done",          # "queued" | "running" | "done" | "failed"
    "engine_used": "local:wan14b_i2v",  # 或 "cloud:kling"
    "outputs": [
        {"url": "...", "type": "video/mp4", "size_bytes": 12345678}
    ],
    "metadata": {
        "duration_ms": 45000,
        "gpu_vram_peak_mb": 18000,
        "model_id": "wan14b_i2v"
    }
}

# 健康检查
GET /health
→ { "status": "ok", "gpu": {...}, "engines": {...}, "queue_depth": 5 }
```

### 5.4 kais-movie-agent 需要的 Pipeline 模板

现有 `PIPELINE_TEMPLATES` 已定义了 6 个 pipeline，但对齐 kais-movie-agent 需要扩展：

| Pipeline | 现有 | 需要新增 |
|----------|------|---------|
| `short_film` | ✅ | 增加云端降级节点 |
| `talking_head` | ✅ | — |
| `voice_clone_video` | ✅ | — |
| `foley_rvc` | ✅ | — |
| `image_to_video` | ✅ | — |
| `music_video` | — | 新增：场景+视频+音乐+虚拟人 |
| `3d_asset` | — | 新增：文/图生3D + 后处理 |
| `full_postprocess` | — | 新增：超分+修复+编码 |

---

## 6. Docker 部署从双机分布式到单机 Docker Compose 的迁移路径

### 6.1 迁移策略：三阶段

#### Phase 1: 容器化统一 (1 周)

**目标**: 将 kais-hub 双机代码合并到单机 Docker Compose

```
docker-compose.yml:
  kais-gold-team:        # 统一 API 服务 (端口 8002)
    build: .
    ports: ["8002:8002"]
    volumes: [./workspace:/workspace]
    environment:
      - CUDA_VISIBLE_DEVICES=0
      - REDIS_URL=redis://redis:6379
    depends_on: [redis]
  
  redis:                  # 任务队列 + 事务日志
    image: redis:7-alpine
    volumes: [redis-data:/data]
```

**关键改造**:
1. 将 `kais-hub/control_node/main.py` + `kais-hub/worker_node/daemon.py` 合并为单一入口
2. 去除 Syncthing/SFTP 双机通信，改为 Docker volume 共享
3. 保留 Redis 作为内部队列（已有 `journal/redis_streams.py`）

#### Phase 2: Engine Router 集成 (1-2 周)

**目标**: 引入 Engine Router + Cloud Pool

```
docker-compose.yml (扩展):
  kais-gold-team:         # 统一 API 服务
    ports: ["8002:8002"]
  
  redis:                   # 内部队列
  
  comfyui:                 # ComfyUI 引擎 (可选)
    image: ghcr.io/ai-dock/comfyui:latest
    ports: ["8188:8188"]
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]
  
  nginx:                   # 反向代理 + 静态文件
    ports: ["80:80"]
```

**关键改造**:
1. `engine_router.py` 决定 Local/Cloud 路由
2. `cloud_engine_pool.py` 对接 Jellyfish API
3. ComfyUI 作为可选 Sidecar 容器

#### Phase 3: 生产就绪 (1 周)

**目标**: 添加监控、日志、健康检查

```
docker-compose.yml (生产):
  kais-gold-team:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8002/health"]
      interval: 30s
    
  prometheus:              # GPU/API 监控
  grafana:                 # 仪表盘
  
  volumes:
    model-cache:           # 模型缓存
    output-data:           # 输出文件
```

### 6.2 文件系统变更

```
kais-gold-team/
├── docker-compose.yml          # 新增：统一编排
├── Dockerfile                  # 新增：统一构建
├── src/
│   ├── api_server.py           # 新增：V6.0 REST API (端口 8002)
│   ├── engine_router.py        # 新增：Local/Cloud 路由
│   ├── local_engine_pool.py    # 新增：本地引擎池
│   ├── cloud_engine_pool.py    # 新增：云端引擎池
│   ├── callback_standard.py    # 新增：V6.0 标准回调
│   └── pipeline_registry.py    # 新增：Pipeline 模板注册
├── legacy/                     # 归档：双机分布式代码
│   ├── orchestrator/
│   ├── combo/
│   ├── kais-hub/control_node/sync/
│   └── deploy/
└── (保留现有 hypervisor/, workers/, storage/, journal/)
```

### 6.3 环境变量统一

```bash
# V6.0 Docker Compose 环境变量
KAIS_API_PORT=8002
KAIS_GPU_INDEX=0
KAIS_VRAM_HARD_CAP_MB=21504
REDIS_URL=redis://redis:6379

# Local Engine Pool
KAIS_WORKSPACE=/workspace
KAIS_DOCKER_SOCKET=/var/run/docker.sock

# Cloud Engine Pool (Jellyfish)
JELLYFISH_API_URL=https://api.jellyfish.ai
JELLYFISH_API_KEY=***
JELLYFISH_ENABLED=true

# ComfyUI Bridge
COMFYUI_URL=http://comfyui:8188
COMFYUI_ENABLED=false

# Callback
KAIS_CALLBACK_SECRET=***
KAIS_EXTERNAL_URL=http://192.168.71.166:8002
```

---

## 7. 代码质量评估

### 7.1 优点

- **模块化程度高**: hypervisor/orchestrator/workers/journal/storage 各模块边界清晰
- **测试覆盖好**: hypervisor 有 13 个测试文件，覆盖状态转换/锁竞争/紧急恢复等边界情况
- **文档完善**: `.planning/` 目录下有完整的 Phase 规划、ARCHITECTURE-V3.6.md 等
- **Pydantic 强类型**: `TaskSchema`/`TaskParams` 使用 Pydantic v2，类型安全
- **Docker 隔离**: ToolAdapter 框架支持 CLI/API 两种模式，引擎隔离干净
- **Redis Streams**: `journal/redis_streams.py` 实现了多优先级流 + 消费者组 + 死信队列

### 7.2 风险点

- **双系统维护成本**: kais-hub 和 hypervisor/orchestrator 功能重叠，新人容易混淆
- **Combo 硬编码**: 6 个 Combo 的模型组合写死在 `combo_models.py`，扩展性差
- **Hypervisor 未集成**: `GPUHypervisor` 的 Apptainer/SIF 执行路径是伪代码（`_run_inference` 返回 mock）
- **无速率限制**: REST API 没有 rate limiting
- **无认证**: FastAPI 端点无 JWT/API Key 认证（HMAC 仅用于 Worker→Control 回调）

---

## 8. 推荐实施优先级

```
Week 1-2:  Phase 0 — 归档旧代码，创建 legacy/ 目录
           新增 Dockerfile + docker-compose.yml (基础版)
           合并 control_node + worker_node 为单一入口

Week 3-4:  Phase 1 — engine_router.py + api_server.py (端口 8002)
           callback_standard.py (V6.0 格式)
           Local Engine Pool (复用现有 ToolAdapter + Executor)

Week 5-6:  Phase 2 — Cloud Engine Pool + Jellyfish Adapter
           更新 models_registry.py (新增 V6.0 模型)
           更新 routing_table.json

Week 7:    Phase 3 — Pipeline 模板扩展
           kais-movie-agent 接口联调
           Docker Compose 生产化 (监控/健康检查)
```

---

## 附录 A: 仓库文件统计

| 模块 | 文件数 | Python 行数 (估算) | 测试文件数 |
|------|--------|-------------------|-----------|
| `hypervisor/` | 14 | ~3500 | 13 |
| `orchestrator/` | 6 | ~1800 | 0 |
| `combo/` | 5 | ~1200 | 0 |
| `workers/` | 5 | ~600 | 1 |
| `config/` | 5 | ~800 | 1 |
| `journal/` | 6 | ~1200 | 0 |
| `storage/` | 2 | ~500 | 0 |
| `kais-hub/control_node/` | 12 | ~1500 | 0 |
| `kais-hub/worker_node/` | 12 | ~2500 | 0 |
| `kais-hub/shared/` | 3 | ~400 | 0 |
| `kais-hub/docker/` | 2 | ~400 | 0 |
| **合计** | **~72** | **~14400** | **15** |

## 附录 B: V6.0 显存估算 vs 现有模型注册

| V6.0 模型 | 估算 VRAM | 现有注册 | 差异 |
|-----------|----------|---------|------|
| video 14B fp16 | ~20G | `wan14b_i2v` (20G) | ✅ 匹配 |
| FLUX | ~12G | `flux_kontext` (19G) | ⚠️ 版本差异 |
| SD3.5 | ~10G | `sd35_large` (20G) | ⚠️ 注册值偏高 |
| TTS | ~4G | `cosyvoice` (6G) | ⚠️ 略高 |
| 后处理 | ~2G | 无注册 | ❌ 缺失 |
