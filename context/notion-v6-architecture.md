User: 给我最终架构
Kimi:  KAIS AIGC 短剧生产管线 V6.0 Final Architecture
---
## 一、硬件拓扑与双卡契约

```plain text
┌─────────────────────────────────────────────────────────────┐
│  宿主机: AMD Ryzen 7 5800X3D + ASUS B550M-PLUS + 128GB DDR4  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  GPU0: RTX 3090 24G OC (PCIe 4.0 x16, CPU 直连)       │   │
│  │  • Persistence Mode ON                                │   │
│  │  • 无显示绑定 (nvidia-smi 无 Xorg/Wayland 进程)        │   │
│  │  • 显存硬边界: 23.5G 可用 (预留 0.5G 系统缓冲)          │   │
│  │  • 职责: 所有 AIGC 推理 + 后处理 + 音视频生成           │   │
│  │  • 队列: OpenClaw 串行调度，防显存碎片                   │   │
│  │  • offload: 极端情况下允许 offload 到内存/磁盘          │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  GPU1: RTX 3060Ti 8G (PCIe 3.0 x4, 芯片组引出)         │   │
│  │  • 接物理显示器，跑 X Server / Wayland                │   │
│  │  • Toonflow Electron 前端在此渲染                      │   │
│  │  • NVENC/NVDEC 硬件编解码专用                         │   │
│  │  • ffmpeg 缩略图/代理文件/波形图生成 (后台异步)          │   │
│  │  • 显存策略: 6G 锁死预留，仅 2G 用于显示+编解码缓冲      │   │
│  │  • CUDA 推理: 禁止分配，零 AIGC 任务                    │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                             │
│  存储: /mnt/agents/output/ (产物) /projects/ (项目)          │
│        /models/ (模型) /assets/ (资产) /git-snapshots/ (版本) │
│  网络: Tailscale 内网 (异地) + Docker bridge (本地)          │
└─────────────────────────────────────────────────────────────┘
```

---
## 二、软件架构总览

```plain text
┌─────────────────────────────────────────────────────────────┐
│  前端层 (3060Ti 显示域，宿主机运行)                           │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ Toonflow Desktop (Electron)                           │   │
│  │  ├─ 创作画布: 剧本/角色/场景/事件/分镜/素材节点          │   │
│  │  ├─ 审核画布: 时间线 + 帧级批注 + 五维雷达图 + 决策面板   │   │
│  │  ├─ Agent UI: 状态展示/进度监控/人类确认点               │   │
│  │  ├─ SQLite (本地缓存，防抖同步)                         │   │
│  │  └─ 文件挂载: /mnt/agents/output/ (代理文件预览)         │   │
│  └────────────────────┬──────────────────────────────────┘   │
│                       │ HTTP/WebSocket (localhost:8000)      │
│                       ▼                                      │
├─────────────────────────────────────────────────────────────┤
│  服务层 (Docker @ 3090 主机)                                 │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ kais-core-backend (Jellyfish FastAPI 深度改造)          │   │
│  │  ├─ Canvas Sync API      ──► Toonflow 双向实时同步       │   │
│  │  ├─ Project/Node API     ──► 画布数据主存储              │   │
│  │  ├─ Asset API            ──► 角色/场景一致性治理         │   │
│  │  ├─ Shot/Timeline API    ──► 分镜元数据 + 粗剪序列        │   │
│  │  ├─ Audit Service        ──► 审核记录中心               │   │
│  │  ├─ Snapshot Service     ──► 项目 JSON → Git 标签        │   │
│  │  ├─ Local Adapter        ──► ComfyUI 接口 (新增)         │   │
│  │  └─ Cloud Providers      ──► 商业 API 代码库 (保留复用)   │   │
│  └────────────────────┬──────────────────────────────────┘   │
│                       │ REST (Docker bridge)                 │
│                       ▼                                      │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ kais-movie-agent (OpenClaw 调度中枢)                   │   │
│  │  ├─ PHASE 0~7 状态机 (剧本→分镜→生成→审核→剪辑→导出)     │   │
│  │  ├─ Skill Router                                        │   │
│  │  │   ├─ `toonflow/*`      画布操作                      │   │
│  │  │   ├─ `jellyfish/*`    数据服务                      │   │
│  │  │   ├─ `hermes-agent/*` 专家咨询                      │   │
│  │  │   └─ `gold-team/generate` 统一生成                   │   │
│  │  └─ 质量闸门 (审核触发/通过/驳回)                       │   │
│  └────────────────────┬──────────────────────────────────┘   │
│                       │ REST (Docker bridge)                 │
│                       ▼                                      │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ kais-gold-team (统一执行 Agent)                        │   │
│  │  ├─ Engine Router (默认本地，降级云端)                  │   │
│  │  ├─ Local Pool ──► OpenClaw → ComfyUI @ 3090          │   │
│  │  │   • Wan2.2 / LTX-Video / FLUX / ACE-Step / TTS     │   │
│  │  │   • Real-ESRGAN / GFPGAN / CodeFormer (后处理)       │   │
│  │  │   • TRELLIS / Hunyuan3D (3D)                        │   │
│  │  └─ Cloud Pool ──► 可灵/即梦/Seedance/Runway/Luma     │   │
│  │      (复用 Jellyfish 原生商业 API 代码，密钥/配额/成本)   │   │
│  └───────────────────────────────────────────────────────┘   │
│                       │                                      │
│                       │ 产物写入 /mnt/agents/output/          │
│                       ▼                                      │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ 3060Ti IO 流水线 (宿主机 ffmpeg，非 Docker)             │   │
│  │  ├─ NVENC 代理文件生成 (720p H.264)                     │   │
│  │  ├─ 首帧缩略图提取                                      │   │
│  │  └─ 音频波形渲染                                        │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         │
         │ Tailscale 内网
         ▼
┌─────────────────────────────────────────────────────────────┐
│  治理层 (任意设备)                                            │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ kais-review-platform (React Web)                      │   │
│  │  ├─ 卡片流轻量审核 (只读 Audit DB)                     │   │
│  │  ├─ 五维雷达图仪表盘                                    │   │
│  │  ├─ Git 审计追溯                                        │   │
│  │  └─ 移动端快速审批                                      │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---
## 三、分层职责（零重叠原则）
[TABLE - see Notion for full data]
---
## 四、Toonflow ↔ Jellyfish 整合契约
### 4.1 数据层：本地优先同步

```plain text
Toonflow 前端 (Electron)
├─ SQLite (本地缓存层)
│   ├─ projects_local (画布实时状态)
│   ├─ sync_queue_out (待推送到后端的事件)
│   ├─ sync_queue_in (待拉取的后端更新)
│   └─ proxy_cache (缩略图索引)
│
├─ Sync Engine (后台线程)
│   ├─ Push: 每 500ms 批量发送 sync_queue_out → Jellyfish
│   ├─ Pull: 每 2s 轮询 /sync/pull 获取后端变更
│   ├─ Merge: 冲突时以本地时间戳覆盖 (单机单用户)
│   └─ Offline: 后端不可用时本地全功能运行，恢复后自动补同步
│
└─ API Client
    ├─ REST: 项目/节点/资产 CRUD
    └─ WebSocket: 实时接收后端推送 (审核决策、生成完成)
```

### 4.2 画布节点 ↔ Jellyfish 数据映射
[TABLE - see Notion for full data]
### 4.3 新增 API 契约
Canvas Sync API

```plain text
POST /api/v1/sync/batch
{
  "project_id": "proj_123",
  "client_seq": 42,
  "events": [
    { "type": "node_moved", "node_id": "n_456", "payload": {"x":1200,"y":800}, "timestamp": 1716472800000 },
    { "type": "audit_submitted", "node_id": "n_789", "payload": {"decision":"regenerate","reason":"character_drift"} }
  ]
}

POST /api/v1/sync/pull/{project_id}?last_seq=42
WebSocket /ws/projects/{id}
```

Asset 绑定（角色节点创建时自动触发）

```plain text
POST /api/v1/assets/from_node
{
  "name": "林夏",
  "description": "25岁短发女性，红色风衣",
  "project_id": "proj_123",
  "is_global": false
}
# 返回: { "asset_id": "char_001", "seed_lock": 42, "lora_path": "/models/lora/..." }
```

Shot 翻译（事件图谱 → 分镜）

```plain text
POST /api/v1/shots/from_graph
{
  "project_id": "proj_123",
  "event_graph": { ... },
  "character_assets": ["char_001"]
}
# 返回标准化 Shot Schema 数组
```

---
## 五、生成层：默认本地，云端兜底
### 5.1 kais-gold-team 路由决策

```python
class EngineRouter:
    async def route(self, task: GenerationTask) -> GenerationResult:
        # 默认尝试本地
        if task.engine_preference in ("auto", "local"):
            can_local = await local_pool.check_capacity(
                required_vram=estimate_vram(task.model_key, task.resolution),
                queue_depth_limit=3
            )
            if can_local:
                return await local_pool.submit(task)

        # 降级云端（复用 Jellyfish 商业 API 代码）
        if task.engine_preference in ("auto", "cloud"):
            fallback_reason = local_pool.last_failure_reason
            return await cloud_pool.submit(task, fallback_reason=fallback_reason)

        raise NoEngineAvailable(task.task_id)
```

### 5.2 显存估算参考
[TABLE - see Notion for full data]
### 5.3 统一回调格式

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
  }
}
```

---
## 六、产物文件系统与可视化分流

```plain text
/mnt/agents/output/
├── {project_id}/
│   ├── {task_id}/
│   │   ├── video.mp4          # 原始高码率 (3090)
│   │   ├── proxy_720p.mp4     # 代理预览 (3060Ti NVENC)
│   │   ├── thumbnail.jpg      # 首帧缩略图 (3060Ti)
│   │   ├── waveform.png       # 音频波形 (3060Ti)
│   │   └── report.json        # generation-report
│   ├── assets/
│   │   └── {asset_id}/ (reference.jpg, seed.lock, style.json)
│   └── snapshots/
│       └── v{version}.json    # Git 友好快照
```

[TABLE - see Notion for full data]
---
## 七、Docker Compose 部署拓扑

```yaml
# /opt/kais/docker-compose.yml
version: '3.8'

services:
  kais-core-backend:
    build: ./core-backend
    container_name: kais-core
    ports:
      - "127.0.0.1:8000:8000"
    volumes:
      - /mnt/agents/output:/mnt/agents/output
      - /opt/kais/projects:/projects
      - /opt/kais/assets:/assets
      - /opt/kais/git-snapshots:/git-snapshots
      - /opt/kais/secrets:/run/secrets:ro
    environment:
      - DATABASE_URL=postgresql://kais:kais@audit-db:5432/kais
      - GIT_REPO_PATH=/git-snapshots
      - GOLD_TEAM_URL=http://kais-gold-team:8002
      - COMFYUI_HOST=comfyui-worker
      - COMFYUI_PORT=8188
    depends_on:
      - audit-db
    networks:
      - kais-net

  kais-movie-agent:
    build: ./movie-agent
    container_name: kais-movie
    ports:
      - "127.0.0.1:8001:8001"
    environment:
      - CORE_BACKEND_URL=http://kais-core-backend:8000
      - GOLD_TEAM_URL=http://kais-gold-team:8002
      - OPENCLAW_SOCKET=/var/run/openclaw.sock
    volumes:
      - /var/run/openclaw:/var/run/openclaw
    depends_on:
      - kais-core-backend
      - kais-gold-team
    networks:
      - kais-net

  kais-gold-team:
    build: ./gold-team
    container_name: kais-gold
    ports:
      - "127.0.0.1:8002:8002"
    volumes:
      - /mnt/agents/output:/mnt/agents/output
      - /opt/kais/models:/models:ro
      - /opt/kais/cloud-cache:/cloud-cache
      - /opt/kais/secrets:/run/secrets:ro
    environment:
      - COMFYUI_HOST=comfyui-worker
      - COMFYUI_PORT=8188
      - CLOUD_API_KEYS=/run/secrets/cloud_keys.json
      - JELLYFISH_BACKEND_URL=http://kais-core-backend:8000
    networks:
      - kais-net

  comfyui-worker:
    build: ./comfyui-docker
    container_name: comfyui
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=0
      - CUDA_VISIBLE_DEVICES=0
    volumes:
      - /mnt/agents/output:/mnt/agents/output
      - /opt/kais/models:/models:ro
      - /opt/kais/assets:/assets:ro
    deploy:
      resources:
        limits:
          memory: 48G
    networks:
      - kais-net

  audit-db:
    image: postgres:15-alpine
    container_name: kais-audit-db
    volumes:
      - audit-data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=kais
      - POSTGRES_PASSWORD=kais
      - POSTGRES_DB=kais
    networks:
      - kais-net

volumes:
  audit-data:

networks:
  kais-net:
    driver: bridge
```

宿主机配置 ：
- 3090 纯计算 ：
- 3060Ti IO 流水线 （宿主机 cron/systemd）：
---
## 八、审核与治理分离（最终形态）
[TABLE - see Notion for full data]
---
## 九、不可妥协设计原则
1. 3090 纯计算 ：24G 全部用于 AIGC 推理，offload 仅作极端保底。
1. 3060Ti 零推理 ：8G 中 6G 锁死预留，仅显示 + NVENC/NVDEC + 文件 IO。
1. Agent 权唯一 ：只有  kais-movie-agent  能做流程编排，Toonflow/Jellyfish/kais-gold-team 零决策权。
1. 默认本地，云端兜底 ： kais-gold-team  优先路由 3090，降级时复用 Jellyfish 商业 API 代码。
1. 大文件零 HTTP ：产物走文件系统路径引用，API 只传元数据。
1. 前端本地优先 ：Toonflow SQLite 缓存为主存储，后台异步同步，画布 60fps 零延迟。
1. 审核与创作分离 ：Toonflow 审核模式是「深度审片工作台」，review-platform 是「治理与移动端入口」，共享 Audit DB 但权限隔离。
1. Git 审计 ：每次终审通过， Snapshot Service  自动导出项目 JSON 并提交 Git 标签。
---
这是最终架构。可直接进入 MVP-0 开发。

---

## 表格数据（从 Notion API 提取）

### 表1：分层职责（零重叠原则）

| 层级 | 组件 | 核心职责 | 明确不做 |
|------|------|----------|----------|
| 前端层 | Toonflow | 无限画布交互、节点编辑、审核批注画布、本地 SQLite 缓存防抖同步、代理文件预览 | 不做 Agent 决策、不直接调用生成引擎、不存储原始大文件 |
| 前端层 | kais-review-platform | 卡片流轻量审核、雷达图仪表盘、Git 审计追溯、移动端审批 | 不修改画布、不触发生成任务、不直接读文件系统 |
| 服务层 | kais-core-backend | 项目/节点主存储、资产库（种子锁/风格参数/LoRA 引用）、分镜元数据、审核记录中心、批量同步、Git 快照、本地/云端生成接口 | 不做 Agent 调度、不直接操作 GPU |
| 调度层 | kais-movie-agent | 唯一流程编排（PHASE 0~7）、Skill Router、质量闸门触发、hermes-agent 专家咨询、任务队列管理 | 不直接操作画布像素、不直接操作 GPU |
| 执行层 | kais-gold-team | 统一生成接口、本地/云端引擎路由、密钥与配额管理、成本统计、失败降级 | 不做分镜设计、不做审核判断 |
| IO 层 | 3060Ti ffmpeg | 硬件编解码、缩略图提取、代理文件生成、音频波形渲染 | 零 CUDA 推理 |

### 表2：画布节点 ↔ Jellyfish 数据映射

| Toonflow 节点 | Jellyfish 存储 | 关键字段 |
|---------------|----------------|----------|
| script | projects.script | title, content, bible_ref |
| character | assets (type=character) | name, description, seed_lock, lora_path, style_prompt |
| scene | assets (type=scene) | env_prompt, lighting_params, seed |
| event | projects.event_graph | event_id, chapter_ref, timeline_position |
| shot | shots | shot_schema 全字段 + asset_refs + proxy_path |
| material | projects.materials | file_path, type, duration |
| audit | audit_records | dimensions, annotations, decision |
| version | shots.versions | version_id, parent_shot_id, diff_params |

### 表3：显存估算参考

| 任务 | 估算显存 | 路由目标 |
|------|----------|----------|
| FLUX-dev 1920×1080 | 18.5G | 3090 |
| FLUX-Schnell 1024×1024 | 6.5G | 3090 (3060Ti 禁止) |
| Wan2.2-T2V 14B 720p | 22.0G | 3090 |
| Wan2.2-T2V 14B 480p | 14.0G | 3090 |
| LTX-Video 720p | 12.0G | 3090 |
| ACE-Step v1.5 | 6.0G | 3090 |
| CosyVoice 300M | 3.0G | 3090 |
| 可灵/即梦/Seedance | N/A | Cloud Pool |

### 表4：产物可视化分流

| 产物 | Toonflow 画布 | kais-review-platform | 仅文件系统 |
|------|---------------|---------------------|------------|
| 分镜视频片段 | ✅ 首帧缩略图 + 悬停代理预览 | ✅ 卡片流缩略图 | ❌ 原始 mp4 |
| 角色/场景图 | ✅ 节点内嵌展示 | ⚠️ 审核时只读 | ❌ |
| 剧本/台词 | ✅ 文本卡片 | ❌ | ❌ |
| 音频 | ⚠️ 波形节点 | ✅ 播放器 | ❌ 原始音频 |
| 3D 预览 | ✅ 缩略图/动图 | ❌ | ❌ |
| 质量报告 JSON | ❌ | ✅ 雷达图可视化 | ✅ 源文件 |
| 中间层 (depth/mask) | ❌ | ❌ | ✅ debug/ |
| 最终成品 | ⚠️ 归档节点(折叠) | ✅ 成品展示页 | ✅ 源文件 |

### 表5：审核与治理分离（最终形态）

| 场景 | 入口 | 操作权限 | 数据流 |
|------|------|----------|--------|
| 创作者自审 | Toonflow 审核模式 | 可批注、可标记问题、不可终审通过 | 写入 Audit Service (status: reviewing) |
| 深度审片 | Toonflow 审核模式 | 帧级批注、五维评分、可驳回/要求重抽 | 写入 Audit Service (status: rejected/regenerate) |
| 移动端审批 | kais-review-platform | 只读预览 + 决策按钮 (通过/驳回) | 读取 Audit Service，决策写入后锁定 |
| AI 初审 | kais-movie-agent 自动触发 | 自动生成 AI 意见节点 | 写入 Audit Service (ai_hint) |
| 终审锁定 | Toonflow 或 review-platform | 通过后状态冻结，触发 Snapshot | Git 提交标签 + 进入 PHASE 7 |
