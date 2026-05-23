# KAIS AIGC Platform — 系统架构设计文档

> **版本**: V6.0 Final  
> **日期**: 2026-05-23  
> **基于**: Notion V6.0 Final Architecture + 四仓库审计报告  
> **技术栈**: FastAPI / Node.js / Electron / PostgreSQL / Redis / Docker / ComfyUI / Telegram

---

## 目录

1. [系统全景图](#1-系统全景图)
2. [接口契约](#2-接口契约)
3. [数据模型](#3-数据模型)
4. [状态机设计](#4-状态机设计)
5. [部署拓扑](#5-部署拓扑)
6. [迁移策略](#6-迁移策略)
7. [风险评估](#7-风险评估)

---

## 1. 系统全景图

### 1.1 系统关系拓扑

```mermaid
graph TB
    subgraph "前端层 (宿主机 3060Ti 显示域)"
        TF["Toonflow Desktop<br/>(Electron)"]
        RPF["kais-review-platform<br/>(HTMX/Alpine Web)"]
    end

    subgraph "Docker Compose 服务层 (RTX 3090)"
        KCB["kais-core-backend<br/>(Jellyfish FastAPI)<br/>:8000"]
        KMA["kais-movie-agent<br/>(Node.js 调度中枢)<br/>:8001"]
        KGT["kais-gold-team<br/>(统一执行 Agent)<br/>:8002"]
        CUI["ComfyUI Worker<br/>(GPU 推理)<br/>:8188"]
        ADB[("audit-db<br/>(PostgreSQL 15)<br/>:5432")]
        RED[("Redis 7<br/>:6379")]
    end

    subgraph "IO 层 (宿主机 3060Ti)"
        FFM["ffmpeg NVENC/NVDEC<br/>代理文件 / 缩略图 / 波形"]
    end

    subgraph "云端引擎"
        KL["可灵 Kling"]
        JM["即梦 Jimeng"]
        SD["Seedance"]
        RW["Runway"]
        LM["Luma"]
    end

    subgraph "治理通知"
        TG["Telegram Bot"]
    end

    TF -->|"HTTP/WS<br/>localhost:8000"| KCB
    TF -->|"SQLite 本地缓存<br/>防抖同步"| TF
    RPF -->|"只读 Audit DB"| ADB
    RPF -->|"治理审批 API<br/>:8090"| RPF_API["review-platform<br/>API"]

    KMA -->|"REST<br/>Docker bridge"| KCB
    KMA -->|"统一生成 API<br/>Docker bridge"| KGT
    KMA -->|"审核回调<br/>REST"| RPF

    KGT -->|"ComfyUI API<br/>Docker bridge"| CUI
    KGT -->|"商业 API<br/>HTTPS"| KL
    KGT -->|"商业 API<br/>HTTPS"| JM
    KGT -->|"商业 API<br/>HTTPS"| SD
    KGT -->|"商业 API<br/>HTTPS"| RW
    KGT -->|"商业 API<br/>HTTPS"| LM

    KCB -->|"SQL"| ADB
    KCB -->|"Pub/Sub"| RED
    KGT -->|"Redis Streams"| RED

    KGT -->|"产物写入<br/>/mnt/agents/output/"| FFM
    FFM -->|"代理文件<br/>缩略图/波形"| TF
    FFM -->|"代理文件<br/>缩略图/波形"| RPF

    KMA -->|"审核通知"| TG
    RPF_API -->|"审批回调"| KMA

    style TF fill:#4A90D9,color:#fff
    style RPF fill:#4A90D9,color:#fff
    style KCB fill:#E8A838,color:#fff
    style KMA fill:#E8A838,color:#fff
    style KGT fill:#E8A838,color:#fff
    style CUI fill:#C0392B,color:#fff
    style ADB fill:#2ECC71,color:#fff
    style RED fill:#2ECC71,color:#fff
    style FFM fill:#9B59B6,color:#fff
```

### 1.2 数据流与控制流

```mermaid
flowchart LR
    subgraph "数据流 (产物路径)"
        D1["ComfyUI 生成<br/>video.mp4"] -->|"/mnt/agents/output/"| D2["ffmpeg NVENC<br/>proxy_720p.mp4<br/>thumbnail.jpg<br/>waveform.png"]
        D2 -->|"代理文件引用"| D3["Toonflow 画布<br/>悬停预览"]
        D2 -->|"代理文件引用"| D4["review-platform<br/>卡片流"]
    end

    subgraph "控制流 (任务编排)"
        C1["movie-agent<br/>PHASE 状态机"] -->|"submit task"| C2["gold-team<br/>Engine Router"]
        C2 -->|"local"| C3["ComfyUI Worker"]
        C2 -->|"cloud fallback"| C4["商业 API"]
        C3 -->|"callback"| C1
        C4 -->|"callback"| C1
        C1 -->|"quality gate"| C5["review-platform<br/>审核闸门"]
        C5 -->|"approve/reject"| C1
    end

    subgraph "同步流 (画布数据)"
        S1["Toonflow SQLite<br/>本地缓存"] -->|"Push 500ms<br/>batch"| S2["core-backend<br/>Canvas Sync API"]
        S2 -->|"Pull 2s<br/>WebSocket push"| S1
    end

    style D1 fill:#3498DB,color:#fff
    style D2 fill:#9B59B6,color:#fff
    style C1 fill:#E67E22,color:#fff
    style C2 fill:#E67E22,color:#fff
    style S1 fill:#2ECC71,color:#fff
    style S2 fill:#2ECC71,color:#fff
```

### 1.3 硬件拓扑

```mermaid
graph TB
    HOST["宿主机<br/>AMD Ryzen 7 5800X3D<br/>128GB DDR4<br/>ASUS B550M-PLUS"]

    subgraph "GPU0: RTX 3090 24G (PCIe 4.0 x16, CPU 直连)"
        GPU0["Persistence Mode ON<br/>无显示绑定<br/>显存硬边界: 23.5G 可用"]
        GPU0_CFG["职责: 全部 AIGC 推理<br/>队列: 串行调度, 防显存碎片<br/>Offload: 仅极端保底"]
    end

    subgraph "GPU1: RTX 3060Ti 8G (PCIe 3.0 x4, 芯片组引出)"
        GPU1["接物理显示器<br/>X Server / Wayland"]
        GPU1_CFG["职责: Toonflow 渲染 + NVENC/NVDEC<br/>ffmpeg 代理文件/缩略图/波形<br/>显存: 6G 锁死预留, 2G 显示+编解码<br/>CUDA 推理: 禁止"]
    end

    STORAGE["/mnt/agents/<br/>output/ (产物)<br/>projects/ (项目)<br/>models/ (模型)<br/>assets/ (资产)<br/>git-snapshots/ (版本)"]

    NET["Tailscale 内网 (异地)<br/>Docker bridge (本地)"]

    HOST --- GPU0 --- GPU0_CFG
    HOST --- GPU1 --- GPU1_CFG
    HOST --- STORAGE
    HOST --- NET

    style GPU0 fill:#C0392B,color:#fff
    style GPU1 fill:#3498DB,color:#fff
    style STORAGE fill:#2ECC71,color:#fff
```

---

## 2. 接口契约

### 2.1 kais-core-backend ↔ Toonflow（Canvas Sync API）

**传输协议**: HTTP REST + WebSocket  
**端口**: localhost:8000  
**同步策略**: 本地优先 (Local-First)

#### Canvas Sync API

```
POST /api/v1/sync/batch
```

**请求体**:

```json
{
  "project_id": "string (UUID)",
  "client_seq": 42,
  "events": [
    {
      "type": "node_moved | node_created | node_updated | node_deleted | audit_submitted",
      "node_id": "string",
      "payload": { "x": 1200, "y": 800 },
      "timestamp": 1716472800000
    }
  ]
}
```

**响应体**:

```json
{
  "server_seq": 43,
  "conflicts": [],
  "acknowledged": true
}
```

```
POST /api/v1/sync/pull/{project_id}?last_seq=42
```

**响应体**:

```json
{
  "events": [
    {
      "type": "audit_decision",
      "node_id": "n_789",
      "payload": { "decision": "approved", "reviewer": "admin" },
      "server_seq": 43,
      "timestamp": 1716472801000
    }
  ],
  "has_more": false
}
```

```
WebSocket /ws/projects/{project_id}
```

**服务端推送消息**:

```json
{
  "event": "generation_complete | audit_decision | state_change",
  "data": { "...": "..." }
}
```

#### Asset 绑定 API

```
POST /api/v1/assets/from_node
```

```json
// 请求
{
  "name": "林夏",
  "description": "25岁短发女性，红色风衣",
  "project_id": "proj_123",
  "is_global": false
}

// 响应
{
  "asset_id": "char_001",
  "seed_lock": 42,
  "lora_path": "/models/lora/linxia_v1.safetensors",
  "style_prompt": "25yo short hair woman, red trench coat, ..."
}
```

#### Shot 翻译 API

```
POST /api/v1/shots/from_graph
```

```json
// 请求
{
  "project_id": "proj_123",
  "event_graph": { "nodes": [], "edges": [] },
  "character_assets": ["char_001", "char_002"]
}

// 响应
[
  {
    "shot_id": "shot_001",
    "sequence": 1,
    "duration_sec": 5.0,
    "camera": { "type": "medium_shot", "angle": "eye_level" },
    "characters": ["char_001"],
    "scene_asset": "scene_001",
    "dialogue": "我不能再这样下去了。",
    "action_description": "林夏站在窗边，背对镜头",
    "asset_refs": { "character_refs": [], "scene_ref": null }
  }
]
```

#### Project / Node CRUD API

```
GET    /api/v1/projects                    # 列出项目
POST   /api/v1/projects                    # 创建项目
GET    /api/v1/projects/{id}               # 获取项目详情
PUT    /api/v1/projects/{id}               # 更新项目
DELETE /api/v1/projects/{id}               # 删除项目

GET    /api/v1/projects/{id}/nodes         # 列出节点
POST   /api/v1/projects/{id}/nodes         # 创建节点
PUT    /api/v1/projects/{id}/nodes/{nid}   # 更新节点
DELETE /api/v1/projects/{id}/nodes/{nid}   # 删除节点

GET    /api/v1/projects/{id}/shots         # 列出分镜
POST   /api/v1/shots/from_graph            # 事件图谱 → 分镜
PUT    /api/v1/shots/{shot_id}             # 更新分镜
```

---

### 2.2 kais-movie-agent ↔ kais-core-backend（REST）

**传输协议**: HTTP REST  
**网络**: Docker bridge (容器间)

```
POST /api/v1/pipelines
```

```json
// 请求: 启动管线
{
  "project_id": "proj_123",
  "config": {
    "phases": ["requirement", "art-character", "script-voice", "storyboard-scene", "video", "post-production", "quality-gate", "delivery"],
    "engine_preference": "auto",
    "review_mode": "hybrid"
  },
  "metadata": {}
}

// 响应
{
  "pipeline_id": "pipe_001",
  "status": "running",
  "current_phase": "requirement",
  "phases": [
    { "id": "requirement", "status": "running" },
    { "id": "art-character", "status": "pending" }
  ]
}
```

```
GET /api/v1/pipelines/{pipeline_id}
```

```json
{
  "pipeline_id": "pipe_001",
  "status": "running | paused | completed | failed",
  "current_phase": "video",
  "progress": 0.55,
  "phases": [
    { "id": "requirement", "status": "completed" },
    { "id": "art-character", "status": "completed", "review_result": "approved" },
    { "id": "video", "status": "running", "tasks": ["task_001", "task_002"] }
  ],
  "created_at": "2026-05-23T10:00:00Z",
  "updated_at": "2026-05-23T14:30:00Z"
}
```

```
POST /api/v1/pipelines/{pipeline_id}/resume
POST /api/v1/pipelines/{pipeline_id}/cancel
GET  /api/v1/pipelines/{pipeline_id}/phases
```

#### 资产接口

```
GET  /api/v1/assets/{asset_id}
POST /api/v1/assets
PUT  /api/v1/assets/{asset_id}
```

#### 快照接口

```
POST /api/v1/snapshots
```

```json
{
  "project_id": "proj_123",
  "trigger": "final_audit_approved",
  "version_tag": "v1.0"
}
```

---

### 2.3 kais-movie-agent ↔ kais-gold-team（统一生成 API）

**传输协议**: HTTP REST  
**端口**: Docker bridge → 8002

```
POST /api/v1/tasks
```

```json
// 请求: 提交单任务
{
  "engine": "auto",
  "model_id": "wan14b_i2v",
  "task_type": "image2video",
  "params": {
    "prompt": "A woman standing by the window...",
    "negative_prompt": "blurry, low quality",
    "width": 1280,
    "height": 720,
    "duration_sec": 5,
    "seed": 42,
    "num_frames": 41
  },
  "priority": 5,
  "callback_url": "http://kais-movie-agent:8001/api/v1/gpu/callback",
  "metadata": {
    "pipeline_id": "pipe_001",
    "phase": "video",
    "shot_id": "shot_003"
  }
}

// 响应
{
  "task_id": "gold_s03_02_v1",
  "status": "queued",
  "engine_assigned": "local",
  "estimated_vram_gb": 22.0,
  "queue_position": 1
}
```

```
POST /api/v1/pipelines
```

```json
// 请求: Pipeline 批量任务
{
  "pipeline": "short_film",
  "params": {
    "scenes": [
      { "prompt": "...", "duration": 5 },
      { "prompt": "...", "duration": 3 }
    ],
    "output_dir": "/mnt/agents/output/proj_123"
  },
  "callback_url": "http://kais-movie-agent:8001/api/v1/gpu/callback"
}

// 响应
{
  "pipeline_id": "gp_pipe_001",
  "tasks": [
    { "task_id": "gold_s01_01_v1", "status": "queued" },
    { "task_id": "gold_s02_01_v1", "status": "pending" }
  ]
}
```

```
GET  /api/v1/tasks/{task_id}
GET  /api/v1/pipelines/{pipeline_id}
DELETE /api/v1/tasks/{task_id}
GET  /api/v1/tasks/events/stream   # SSE
GET  /health
```

#### 统一回调格式（V6.0 标准）

gold-team 完成任务后回调 movie-agent:

```
POST {callback_url}
```

```json
{
  "task_id": "gold_s03_02_v1",
  "status": "completed | failed | cancelled",
  "engine_used": "local | cloud:kling | cloud:jimeng | cloud:seedance | cloud:runway | cloud:luma",
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

#### Pipeline 模板定义

| 模板 ID | 阶段组成 | 用途 |
|---------|---------|------|
| `short_film` | scene_gen → video_gen → postprocess | 短片完整流程 |
| `talking_head` | face_gen → lip_sync → postprocess | 虚拟人口型同步 |
| `voice_clone_video` | tts → face_gen → lip_sync | 声音克隆视频 |
| `foley_rvc` | sfx_gen → audio_mix → postprocess | 音效制作 |
| `image_to_video` | image_gen → video_gen | 图生视频 |
| `music_video` | music_gen → scene_gen → video_gen → composite | MV 制作 |
| `3d_asset` | text_to_3d → postprocess_3d | 3D 资产生成 |
| `full_postprocess` | upscale → face_restore → re_encode | 后处理全链路 |

---

### 2.4 kais-review-platform ↔ Audit DB ↔ Toonflow

**数据共享**: PostgreSQL (audit-db 容器, 数据库 `kais`)  
**权限隔离**: Schema 级 + 角色级

#### Schema 设计

```sql
-- 公共 schema (core-backend 写入, review-platform 读取)
-- public.reviews
-- public.shot_cards
-- public.audit_entries
-- public.shots
-- public.projects

-- review 专属 schema (review-platform 写入)
-- review.governance_decisions
-- review.policy_versions
-- review.webhook_configs
```

#### review-platform API（治理入口）

```
GET  /api/v1/shot-cards?project_id={id}&status=pending
GET  /api/v1/shot-cards/{id}
POST /api/v1/shot-cards/{id}/approve
POST /api/v1/shot-cards/{id}/reject
POST /api/v1/shot-cards/batch-approve
POST /api/v1/shot-cards/batch-reject
GET  /api/v1/analytics/radar?project_id={id}
GET  /api/v1/analytics/scores?project_id={id}&start={date}&end={date}
GET  /api/v1/audit/merkle/verify
```

**审批请求**:

```json
// POST /api/v1/shot-cards/{id}/approve
{
  "reviewer_id": "user_001",
  "role": "review_gov",
  "comment": "画面质量达标",
  "dimensions_scores": {
    "aesthetics": 85,
    "consistency": 90,
    "compliance": 95,
    "technical_quality": 88,
    "audio_match": 82
  }
}

// POST /api/v1/shot-cards/{id}/reject
{
  "reviewer_id": "user_001",
  "role": "review_gov",
  "reason": "character_drift",
  "comment": "角色面部与参考图不一致",
  "suggested_action": "regenerate",
  "reject_dimensions": ["consistency"]
}
```

#### 权限矩阵

| 操作 | TOONFLOW_DEEP | REVIEW_GOV | ADMIN | AUDITOR |
|------|:---:|:---:|:---:|:---:|
| 查看审核列表 | ✅ | ✅ | ✅ | ✅ |
| 帧级批注 | ✅ | ❌ | ✅ | ❌ |
| 五维评分 (写) | ✅ | ❌ | ✅ | ❌ |
| 五维评分 (读) | ✅ | ✅ | ✅ | ✅ |
| 治理审批 | ❌ | ✅ | ✅ | ❌ |
| 批量审批 | ❌ | ✅ | ✅ | ❌ |
| 移动端审批 | ❌ | ✅ | ✅ | ❌ |
| 策略管理 | ❌ | ❌ | ✅ | ❌ |
| 触发重新生成 | ✅ | ❌ | ✅ | ❌ |
| Merkle 验证 | ✅ | ✅ | ✅ | ✅ |

---

### 2.5 kais-movie-agent ↔ review-platform（审核回调）

**触发场景**: Phase 完成后质量闸门评估 → 需人工审核时

#### 提交审核

```
POST /api/v1/reviews
```

```json
{
  "pipeline_id": "pipe_001",
  "phase": "video",
  "items": [
    {
      "shot_id": "shot_003",
      "task_id": "gold_s03_02_v1",
      "type": "shot_review",
      "assets": {
        "video_proxy": "/mnt/agents/output/gold_s03_02_v1/proxy_720p.mp4",
        "thumbnail": "/mnt/agents/output/gold_s03_02_v1/thumbnail.jpg"
      },
      "ai_scores": {
        "overall": 78,
        "dimensions": {
          "aesthetics": 82,
          "consistency": 70,
          "compliance": 90,
          "technical_quality": 75,
          "audio_match": 73
        }
      },
      "context": {
        "scene_description": "...",
        "dialogue": "...",
        "character_refs": ["char_001"]
      }
    }
  ],
  "callback_url": "http://kais-movie-agent:8001/api/v1/reviews/callback",
  "priority": "normal"
}
```

#### 审核回调（review-platform → movie-agent）

```
POST http://kais-movie-agent:8001/api/v1/reviews/callback
```

```json
{
  "review_id": "rev_001",
  "pipeline_id": "pipe_001",
  "phase": "video",
  "decision": "approved | rejected | needs_revision",
  "items": [
    {
      "shot_id": "shot_003",
      "decision": "approved",
      "reviewer": "user_001",
      "reviewed_at": "2026-05-23T15:00:00Z",
      "scores": {
        "aesthetics": 85,
        "consistency": 80
      },
      "annotations": [],
      "reject_reason": null
    }
  ],
  "signature": "HMAC-SHA256 signature"
}
```

#### 降级策略

```mermaid
flowchart TD
    A["Phase 完成"] --> B["Quality Gate V2<br/>自动评估"]
    B -->|"score >= 85"| C["自动通过"]
    B -->|"30 < score < 85"| D["提交人工审核"]
    B -->|"score <= 30"| E["自动驳回<br/>触发重试/降级"]
    D --> F["review-platform<br/>审核中"]
    F -->|"超时 2h"| G["降级: 本地审核页<br/>interactive-review"]
    G -->|"超时 30min"| H["AUTO 通过<br/>(记录日志)"]
    F -->|"审核回调"| I{"decision?"}
    I -->|"approved"| J["进入下一 Phase"]
    I -->|"rejected"| K["重试/降级引擎<br/>最多 3 次"]
    K -->|"重试耗尽"| L["管线失败<br/>通知 Telegram"]
    I -->|"needs_revision"| M["修改参数<br/>重新生成"]

    style C fill:#2ECC71,color:#fff
    style E fill:#E74C3C,color:#fff
    style J fill:#2ECC71,color:#fff
    style L fill:#E74C3C,color:#fff
```

---

## 3. 数据模型

### 3.1 实体关系图

```mermaid
erDiagram
    Project ||--o{ Node : contains
    Project ||--o{ Shot : contains
    Project ||--o{ Asset : owns
    Project ||--o{ Snapshot : has_versions
    Project ||--|| EventGraph : defines

    Node ||--o{ Node : connected_to
    Node }o--|| NodeType : typed_as

    Shot }o--o| Asset : references_characters
    Shot }o--o| Asset : references_scene
    Shot ||--o{ ShotVersion : has_versions

    Asset ||--|| AssetType : typed_as

    Project ||--o{ AuditEntry : audited_in
    Shot ||--o{ AuditEntry : reviewed_by

    AuditEntry ||--|| AuditEntry : chains_to

    Project {
        uuid id PK
        string name
        string description
        jsonb script
        jsonb event_graph
        jsonb materials
        enum status
        timestamp created_at
        timestamp updated_at
    }

    Node {
        uuid id PK
        uuid project_id FK
        enum node_type
        string label
        jsonb data
        float position_x
        float position_y
        float width
        float height
        timestamp created_at
        timestamp updated_at
    }

    Asset {
        uuid id PK
        uuid project_id FK
        enum asset_type
        string name
        string description
        integer seed_lock
        string lora_path
        jsonb style_params
        string reference_image_path
        boolean is_global
        timestamp created_at
        timestamp updated_at
    }

    Shot {
        uuid id PK
        uuid project_id FK
        integer sequence_number
        float duration_sec
        jsonb camera
        string dialogue
        string action_description
        jsonb character_refs
        uuid scene_asset_id FK
        string proxy_path
        string thumbnail_path
        enum status
        timestamp created_at
        timestamp updated_at
    }

    ShotVersion {
        uuid id PK
        uuid shot_id FK
        integer version_number
        string task_id
        string video_path
        string proxy_path
        jsonb generation_params
        jsonb metadata
        timestamp created_at
    }

    AuditEntry {
        uuid id PK
        uuid project_id FK
        uuid target_id FK
        enum target_type
        enum action
        string actor_id
        enum actor_role
        jsonb payload
        string prev_hash
        string own_hash
        timestamp created_at
    }

    Snapshot {
        uuid id PK
        uuid project_id FK
        string version_tag
        string git_commit_hash
        jsonb project_data
        timestamp created_at
    }
```

### 3.2 Schema 定义 (JSON Schema)

#### Project

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Project",
  "type": "object",
  "required": ["name"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "name": { "type": "string", "minLength": 1, "maxLength": 200 },
    "description": { "type": "string" },
    "script": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "content": { "type": "string" },
        "bible_ref": { "type": "string" }
      }
    },
    "event_graph": {
      "type": "object",
      "properties": {
        "nodes": { "type": "array", "items": { "$ref": "#/definitions/EventNode" } },
        "edges": { "type": "array", "items": { "$ref": "#/definitions/EventEdge" } }
      }
    },
    "materials": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "file_path": { "type": "string" },
          "type": { "type": "string", "enum": ["audio", "video", "image", "document"] },
          "duration": { "type": "number" }
        }
      }
    },
    "status": {
      "type": "string",
      "enum": ["draft", "in_production", "in_review", "completed", "archived"],
      "default": "draft"
    },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" }
  }
}
```

#### Node

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Node",
  "type": "object",
  "required": ["project_id", "node_type", "position_x", "position_y"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "project_id": { "type": "string", "format": "uuid" },
    "node_type": {
      "type": "string",
      "enum": ["script", "character", "scene", "event", "shot", "material", "audit", "version"]
    },
    "label": { "type": "string" },
    "data": { "type": "object" },
    "position_x": { "type": "number" },
    "position_y": { "type": "number" },
    "width": { "type": "number", "default": 200 },
    "height": { "type": "number", "default": 100 },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" }
  }
}
```

#### Asset

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Asset",
  "type": "object",
  "required": ["project_id", "asset_type", "name"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "project_id": { "type": "string", "format": "uuid" },
    "asset_type": {
      "type": "string",
      "enum": ["character", "scene", "prop", "style", "audio", "3d_model"]
    },
    "name": { "type": "string" },
    "description": { "type": "string" },
    "seed_lock": { "type": "integer", "description": "锁定种子值，确保角色一致性" },
    "lora_path": { "type": "string", "description": "LoRA 模型文件路径" },
    "style_params": {
      "type": "object",
      "properties": {
        "style_prompt": { "type": "string" },
        "negative_prompt": { "type": "string" },
        "cfg_scale": { "type": "number" },
        "sampler": { "type": "string" }
      }
    },
    "reference_image_path": { "type": "string" },
    "is_global": { "type": "boolean", "default": false, "description": "全局资产可跨项目引用" },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" }
  }
}
```

#### Shot

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Shot",
  "type": "object",
  "required": ["project_id", "sequence_number"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "project_id": { "type": "string", "format": "uuid" },
    "sequence_number": { "type": "integer", "minimum": 1 },
    "duration_sec": { "type": "number", "minimum": 0.5, "maximum": 30 },
    "camera": {
      "type": "object",
      "properties": {
        "type": { "type": "string", "enum": ["extreme_close_up", "close_up", "medium_shot", "medium_long_shot", "long_shot", "extreme_long_shot"] },
        "angle": { "type": "string", "enum": ["eye_level", "high_angle", "low_angle", "birds_eye", "dutch_angle"] },
        "movement": { "type": "string", "enum": ["static", "pan", "tilt", "dolly", "tracking", "crane", "handheld"] }
      }
    },
    "dialogue": { "type": "string" },
    "action_description": { "type": "string" },
    "character_refs": { "type": "array", "items": { "type": "string", "format": "uuid" } },
    "scene_asset_id": { "type": "string", "format": "uuid" },
    "proxy_path": { "type": "string" },
    "thumbnail_path": { "type": "string" },
    "status": {
      "type": "string",
      "enum": ["draft", "generating", "generated", "in_review", "approved", "rejected", "final"],
      "default": "draft"
    },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" }
  }
}
```

#### Task（统一生成任务）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "GenerationTask",
  "type": "object",
  "required": ["task_type", "params"],
  "properties": {
    "task_id": { "type": "string" },
    "task_type": {
      "type": "string",
      "enum": ["text2image", "image2image", "image2video", "text2video", "text2audio", "text2music", "voice_clone", "lip_sync", "upscale", "face_restore", "text2_3d", "composite"]
    },
    "engine": { "type": "string", "enum": ["auto", "local", "cloud"], "default": "auto" },
    "model_id": { "type": "string" },
    "params": { "type": "object" },
    "priority": { "type": "integer", "minimum": 1, "maximum": 10, "default": 5 },
    "callback_url": { "type": "string", "format": "uri" },
    "metadata": { "type": "object" },
    "status": {
      "type": "string",
      "enum": ["queued", "running", "completed", "failed", "cancelled"],
      "default": "queued"
    }
  }
}
```

### 3.3 枚举类型汇总

| 枚举 | 值 | 用途 |
|------|-----|------|
| **NodeType** | script, character, scene, event, shot, material, audit, version | Toonflow 画布节点类型 |
| **AssetType** | character, scene, prop, style, audio, 3d_model | 资产类型 |
| **ShotStatus** | draft → generating → generated → in_review → approved/rejected → final | 分镜状态 |
| **TaskType** | text2image, image2image, image2video, text2video, text2audio, text2music, voice_clone, lip_sync, upscale, face_restore, text2_3d, composite | 生成任务类型 |
| **TaskStatus** | queued → running → completed/failed/cancelled | 任务状态 |
| **AuditAction** | deep_review_pass, deep_review_reject, governance_approve, governance_reject, ai_auto_score, snapshot_created | 审计操作类型 |
| **ActorRole** | toonflow_deep, review_gov, admin, auditor, ai_service | 操作者角色 |
| **EngineMode** | auto, local, cloud | 引擎路由模式 |

---

## 4. 状态机设计

### 4.1 管线状态机（PHASE 0~7）

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> Phase0_Requirement: start_pipeline
    
    state Phase0_Requirement {
        [*] --> P0_Analyzing
        P0_Analyzing --> P0_Reviewing: analysis_done
        P0_Reviewing --> P0_Approved: human_approve
        P0_Reviewing --> P0_Revising: human_reject
        P0_Revising --> P0_Analyzing: revise_complete
        P0_Approved --> [*]
    }

    Phase0_Requirement --> Phase1_ArtCharacter: phase_0_approved

    state Phase1_ArtCharacter {
        [*] --> P1_Generating
        P1_Generating --> P1_Reviewing: generation_done
        P1_Reviewing --> P1_Approved: review_pass
        P1_Reviewing --> P1_Regenerating: review_reject
        P1_Regenerating --> P1_Generating: retry
        P1_Approved --> [*]
    }

    Phase1_ArtCharacter --> Phase2_ScriptVoice: phase_1_approved
    Phase2_ScriptVoice --> Phase3_StoryboardScene: phase_2_approved
    Phase3_StoryboardScene --> Phase4_VideoGeneration: phase_3_approved

    state Phase4_VideoGeneration {
        [*] --> P4_Preview
        P4_Preview --> P4_PreviewReview: preview_done
        P4_PreviewReview --> P4_Final: preview_approved
        P4_PreviewReview --> P4_PreviewRetry: preview_rejected
        P4_PreviewRetry --> P4_Preview: retry_params_adjusted
        P4_Final --> P4_FinalReview: final_done
        P4_FinalReview --> P4_Approved: final_approved
        P4_FinalReview --> P4_FinalRetry: final_rejected
        P4_FinalRetry --> P4_Final: retry
        P4_Approved --> [*]
    }

    Phase4_VideoGeneration --> Phase5_PostProduction: phase_4_approved
    Phase5_PostProduction --> Phase6_QualityGate: phase_5_done

    state Phase6_QualityGate {
        [*] --> Q6_AutoEvaluate
        Q6_AutoEvaluate --> Q6_Pass: score_ge_85
        Q6_AutoEvaluate --> Q6_HumanReview: score_30_85
        Q6_AutoEvaluate --> Q6_Fail: score_lt_30
        Q6_HumanReview --> Q6_Pass: human_approve
        Q6_HumanReview --> Q6_Fail: human_reject
        Q6_Pass --> [*]
        Q6_Fail --> [*]
    }

    Phase6_QualityGate --> Phase7_Delivery: quality_passed
    Phase6_QualityGate --> Phase4_VideoGeneration: quality_failed_retry\n(max 3 times)
    Phase6_QualityGate --> Failed: quality_failed_max_retry

    Phase7_Delivery --> Completed: delivery_done
    Completed --> [*]
    Failed --> [*]
```

### 4.2 单 Shot 生命周期

```mermaid
stateDiagram-v2
    [*] --> Draft: 创建分镜

    Draft --> Generating: submit_to_gold_team
    Generating --> Generated: callback(success)
    Generating --> GenFailed: callback(failure)
    
    GenFailed --> Generating: retry\n(max 3)
    GenFailed --> DegradedEngine: local_failed\ntry_cloud
    DegradedEngine --> Generated: cloud_success
    DegradedEngine --> GenFailed: cloud_failed

    Generated --> InReview: submit_to_review
    InReview --> Approved: governance_approve
    InReview --> Rejected: governance_reject
    InReview --> InReview: timeout → escalation

    Rejected --> Generating: regenerate\n(params adjusted)
    Rejected --> Draft: fundamental_change

    Approved --> Final: final_audit_approved
    Final --> Archived: snapshot_created

    Archived --> [*]
```

### 4.3 审核状态机

```mermaid
stateDiagram-v2
    [*] --> NoReview: Phase 开始

    NoReview --> AwaitingAI: phase_output_ready
    AwaitingAI --> AIScored: ai_eval_done
    
    AIScored --> AutoApproved: score_ge_85
    AIScored --> AwaitingHuman: score_30_85
    AIScored --> AutoRejected: score_lt_30

    AwaitingHuman --> HumanApproved: reviewer_approve
    AwaitingHuman --> HumanRejected: reviewer_reject
    AwaitingHuman --> Escalated: timeout_2h
    
    Escalated --> LocalReview: fallback_to_local
    LocalReview --> HumanApproved: local_approve
    LocalReview --> AutoApproved: timeout_30m\n(auto_pass_with_log)

    AutoApproved --> [*]
    HumanApproved --> [*]
    
    HumanRejected --> AwaitingAI: regenerate
    AutoRejected --> AwaitingAI: regenerate\n(adjust_params)
    
    HumanRejected --> [*]: max_retry_exhausted\n→ Pipeline_Failed
```

### 4.4 Phase 映射表（当前 11 Phase → V6.0 8 Phase）

| V6.0 Phase | ID | 当前 Phase(s) | 审核门 | 内部子步骤 |
|------------|-----|--------------|--------|-----------|
| **0** | `requirement` | Phase 1 (requirement) | ❌ | 1st-director → audience-match → topic-generation |
| **1** | `art-character` | Phase 2 (art-direction) + Phase 3 (character) | ✅ | FLUX/即梦 → DNA卡注册 → pose-reference |
| **2** | `script-voice` | Phase 4 (scenario) + Phase 5 (voice) | ✅ | story-score → audience-analysis → CosyVoice/GLM-TTS |
| **3** | `storyboard-scene` | Phase 6 (storyboard) + Phase 7 (scene) | ✅ | shot-poses → 线稿管线 → DNA注册 |
| **4** | `video` | Phase 8 (camera-preview) + Phase 9 (camera-final) | ✅ | WAN preview → review → WAN final + PromptInjector |
| **5** | `post-production` | Phase 10 (post-production) | ❌ | BGM (ACE-Step) → SFX → 合成 |
| **6** | `quality-gate` | Phase 11 (quality-gate) | 自动 | 6维度评分 → story-score → 三级闸门 |
| **7** | `delivery` | **新增** | ❌ | 编码 → 元数据 → 多平台适配 → Git 快照 |

---

## 5. 部署拓扑

### 5.1 Docker Compose 服务编排

```yaml
# /opt/kais/docker-compose.yml
version: '3.8'

services:
  # ═══ 核心后端 (Jellyfish FastAPI 深度改造) ═══
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
      - REDIS_URL=redis://redis:6379
      - GIT_REPO_PATH=/git-snapshots
      - GOLD_TEAM_URL=http://kais-gold-team:8002
      - COMFYUI_HOST=comfyui-worker
      - COMFYUI_PORT=8188
    depends_on:
      audit-db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
    networks:
      - kais-net

  # ═══ 管线调度中枢 (Node.js) ═══
  kais-movie-agent:
    build: ./movie-agent
    container_name: kais-movie
    ports:
      - "127.0.0.1:8001:8001"
    environment:
      - CORE_BACKEND_URL=http://kais-core-backend:8000
      - GOLD_TEAM_URL=http://kais-gold-team:8002
      - REVIEW_PLATFORM_URL=http://kais-review-platform:8090
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - LLM_API_KEY=${LLM_API_KEY}
    volumes:
      - /var/run/openclaw:/var/run/openclaw
    depends_on:
      - kais-core-backend
      - kais-gold-team
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
    networks:
      - kais-net

  # ═══ 统一执行 Agent (FastAPI) ═══
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

  # ═══ ComfyUI GPU 推理 Worker ═══
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
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8188/system_stats"]
      interval: 60s
      timeout: 15s
      retries: 3
    restart: unless-stopped
    networks:
      - kais-net

  # ═══ 审核治理平台 (FastAPI + HTMX) ═══
  kais-review-platform:
    build: ./review-platform
    container_name: kais-review
    ports:
      - "127.0.0.1:8090:8090"
    environment:
      - DATABASE_URL=postgresql://kais:kais@audit-db:5432/kais
      - REDIS_URL=redis://redis:6379
      - HMAC_SECRET=${HMAC_SECRET}
      - TELEGRAM_BOT_TOKEN=${REVIEW_TELEGRAM_BOT_TOKEN}
    depends_on:
      audit-db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8090/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
    networks:
      - kais-net

  # ═══ PostgreSQL (共享数据库) ═══
  audit-db:
    image: postgres:15-alpine
    container_name: kais-audit-db
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - audit-data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init.sql:ro
    environment:
      - POSTGRES_USER=kais
      - POSTGRES_PASSWORD=kais
      - POSTGRES_DB=kais
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kais"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - kais-net

  # ═══ Redis (共享缓存/队列) ═══
  redis:
    image: redis:7-alpine
    container_name: kais-redis
    ports:
      - "127.0.0.1:6379:6379"
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

volumes:
  audit-data:
    driver: local
  redis-data:
    driver: local

networks:
  kais-net:
    driver: bridge
```

### 5.2 宿主机配置

#### 3090 GPU 配置

```bash
# /etc/systemd/system/kais-gpu-setup.service
[Unit]
Description=KAIS GPU0 Setup (RTX 3090)
After=multi-user.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash -c '\
  nvidia-smi -i 0 -pm 1 && \
  nvidia-smi -i 0 --compute-mode=EXCLUSIVE_PROCESS'

[Install]
WantedBy=multi-user.target
```

#### 3060Ti IO Pipeline (systemd timer)

```bash
# /etc/systemd/system/kais-io-pipeline.service
[Unit]
Description=KAIS IO Pipeline (ffmpeg NVENC proxy generation)
After=docker.service

[Service]
Type=oneshot
ExecStart=/opt/kais/scripts/io-pipeline.sh

# /etc/systemd/system/kais-io-pipeline.timer
[Unit]
Description=Run IO Pipeline every 2 minutes

[Timer]
OnBootSec=30s
OnUnitActiveSec=120s

[Install]
WantedBy=timers.target
```

```bash
# /opt/kais/scripts/io-pipeline.sh
#!/bin/bash
# Watch /mnt/agents/output/ for new video.mp4 files
# Generate proxy_720p.mp4, thumbnail.jpg, waveform.png using 3060Ti NVENC

INOTIFY_EVENTS=$(inotifywait -q -e create --format '%w%f' /mnt/agents/output/ 2>/dev/null)

for video in $INOTORY_EVENTS; do
  dir=$(dirname "$video")
  
  if [ -f "$dir/video.mp4" ] && [ ! -f "$dir/proxy_720p.mp4" ]; then
    # 代理文件 (NVENC H.264)
    ffmpeg -hwaccel cuda -hwaccel_device 1 \
      -i "$dir/video.mp4" \
      -c:v h264_nvenc -preset p4 -b:v 2M -vf scale=1280:720 \
      "$dir/proxy_720p.mp4" -y 2>/dev/null
    
    # 首帧缩略图
    ffmpeg -hwaccel cuda -hwaccel_device 1 \
      -i "$dir/video.mp4" -vframes 1 \
      -vf scale=320:180 \
      "$dir/thumbnail.jpg" -y 2>/dev/null
    
    # 音频波形
    ffmpeg -i "$dir/video.mp4" -vn -ac 1 \
      "$dir/temp_audio.wav" -y 2>/dev/null && \
    audiowaveform -i "$dir/temp_audio.wav" -o "$dir/waveform.png" \
      --width 600 --height 80 2>/dev/null && \
    rm "$dir/temp_audio.wav"
  fi
done
```

#### 产物文件系统

```
/mnt/agents/
├── output/                          # 生成产物
│   └── {project_id}/
│       ├── {task_id}/
│       │   ├── video.mp4            # 原始高码率 (3090)
│       │   ├── proxy_720p.mp4       # 代理预览 (3060Ti NVENC)
│       │   ├── thumbnail.jpg        # 首帧缩略图 (3060Ti)
│       │   ├── waveform.png         # 音频波形 (3060Ti)
│       │   └── report.json          # generation-report
│       ├── assets/
│       │   └── {asset_id}/
│       │       ├── reference.jpg
│       │       ├── seed.lock
│       │       └── style.json
│       └── snapshots/
│           └── v{version}.json      # Git 友好快照
├── models/                          # 模型文件 (只读挂载)
│   ├── checkpoints/
│   ├── lora/
│   ├── vae/
│   └── tts/
├── assets/                          # 共享资产
└── git-snapshots/                   # 项目版本快照
```

### 5.3 网络架构

```mermaid
graph TB
    subgraph "宿主机网络"
        subgraph "Docker bridge: kais-net"
            KCB[":8000<br/>core-backend"]
            KMA[":8001<br/>movie-agent"]
            KGT[":8002<br/>gold-team"]
            CUI[":8188<br/>ComfyUI"]
            RPF[":8090<br/>review-platform"]
            ADB[":5432<br/>PostgreSQL"]
            RED[":6379<br/>Redis"]
        end

        TF["Toonflow<br/>(Electron)"]
        FFM["ffmpeg IO<br/>(systemd)"]
        USER["用户浏览器<br/>(review-platform)"]
    end

    subgraph "外部"
        CLOUD["云端 API<br/>可灵/即梦/Seedance"]
        TG["Telegram"]
        TS["Tailscale<br/>(异地访问)"]
    end

    TF -->|"localhost:8000"| KCB
    USER -->|"localhost:8090"| RPF
    TS -->|"Tailscale VPN"| RPF
    KGT -->|"HTTPS"| CLOUD
    KMA -->|"HTTPS"| TG

    KCB --- ADB
    KCB --- RED
    KGT --- RED
    KGT --- CUI
    KMA --- KCB
    KMA --- KGT
    KMA --- RPF
    RPF --- ADB

    FFM -.->|"/mnt/agents/output/"| TF
    FFM -.->|"/mnt/agents/output/"| RPF
    KGT -.->|"/mnt/agents/output/"| FFM

    style CLOUD fill:#E74C3C,color:#fff
    style TG fill:#3498DB,color:#fff
```

**端口分配**:

| 端口 | 服务 | 绑定 | 说明 |
|------|------|------|------|
| 8000 | kais-core-backend | 127.0.0.1 | Toonflow 直连 |
| 8001 | kais-movie-agent | 127.0.0.1 | API 入口 |
| 8002 | kais-gold-team | 127.0.0.1 | 生成任务 API |
| 8090 | kais-review-platform | 127.0.0.1 | 治理 Web |
| 8188 | ComfyUI | 127.0.0.1 | GPU 推理 |
| 5432 | PostgreSQL | 127.0.0.1 | 数据库 |
| 6379 | Redis | 127.0.0.1 | 缓存/队列 |

所有端口绑定 `127.0.0.1`，外部访问通过 Tailscale VPN。

---

## 6. 迁移策略

### 6.1 Gap 分析汇总

基于四仓库审计报告，核心差距如下：

```mermaid
graph LR
    subgraph "🔴 Critical"
        G1["G-01: kais-gold-team<br/>双系统未统一"]
        G2["G-02: movie-agent<br/>OpenClaw Skill → Docker"]
        G3["G-03: 无统一 REST API<br/>端口 8002"]
        G4["G-04: core-backend<br/>Jellyfish 尚未深度改造"]
    end

    subgraph "🟡 High"
        G5["G-05: movie-agent<br/>无 Skill Router"]
        G6["G-06: gold-team<br/>无 ComfyUI 集成"]
        G7["G-07: gold-team<br/>无云端降级路由"]
        G8["G-08: review-platform<br/>Audit DB 共享未实施"]
    end

    subgraph "🟠 Medium"
        G9["G-09: aigc-integration<br/>4模块需拆分归入各项目"]
        G10["G-10: movie-agent<br/>11→8 Phase 映射"]
        G11["G-11: review-platform<br/>五维雷达图可视化"]
        G12["G-12: 权限隔离<br/>角色扩展"]
    end

    G1 --> G3
    G2 --> G5
    G4 --> G6
    G8 --> G12

    style G1 fill:#E74C3C,color:#fff
    style G2 fill:#E74C3C,color:#fff
    style G3 fill:#E74C3C,color:#fff
    style G4 fill:#E74C3C,color:#fff
    style G5 fill:#F39C12,color:#fff
    style G6 fill:#F39C12,color:#fff
    style G7 fill:#F39C12,color:#fff
    style G8 fill:#F39C12,color:#fff
```

### 6.2 分阶段迁移路径

#### Phase 0: 归档与基础 (Week 1-2)

| 任务 | 目标项目 | 工作量 | 产出 |
|------|---------|--------|------|
| kais-gold-team 旧代码归档到 `legacy/` | gold-team | 1d | `legacy/` 目录，主分支干净 |
| 创建 `Dockerfile` + 基础 `docker-compose.yml` | gold-team | 1d | 可构建的 Docker 镜像 |
| review-platform-extension 合并到 kais-review-platform | review-platform | 4d | 多候选审核+评分+批量 API |
| Audit DB 共享方案实施 (Schema 级隔离) | review-platform + core-backend | 2d | 共享 PostgreSQL `kais` 库 |
| Init SQL 脚本 (schema + 权限) | 全局 | 1d | `init-db.sql` |

**验收标准**: `docker-compose up` 启动 PostgreSQL + Redis，review-platform 可连接共享 DB。

#### Phase 1: kais-gold-team 统一 (Week 3-5)

| 任务 | 工作量 | 依赖 |
|------|--------|------|
| `api_server.py` — FastAPI 统一入口, 端口 8002 | 2-3d | Phase 0 |
| `engine_router.py` — Local/Cloud 路由决策 | 3-5d | api_server |
| `callback_standard.py` — V6.0 标准回调格式 | 1d | api_server |
| `local_engine_pool.py` — ComfyUI 桥接 + 现有引擎整合 | 3-4d | engine_router |
| `cloud_engine_pool.py` — Jellyfish 商业 API 复用 | 3-5d | engine_router |
| gold-team-worker 引擎适配器对比合并 | 3d | local_engine_pool |
| Docker Compose 集成测试 | 1d | 全部 |

**验收标准**: `POST /api/v1/tasks` 可提交任务，回调格式符合 V6.0 标准，Local/Cloud 路由可切换。

#### Phase 2: kais-core-backend 改造 (Week 5-7)

| 任务 | 工作量 | 依赖 |
|------|--------|------|
| Canvas Sync API (batch/pull/WebSocket) | 3d | Phase 0 DB |
| Project/Node/Asset CRUD API | 3d | Canvas Sync |
| Shot/Timeline API + from_graph | 2d | Asset API |
| Audit Service (审核记录中心) | 2d | DB Schema |
| Snapshot Service (Git 标签) | 1d | Audit Service |
| gold-team-control API 融入 | 3d | Phase 1 |

**验收标准**: Toonflow 可通过 Canvas Sync API 双向同步，Shot 可从事件图谱生成。

#### Phase 3: kais-movie-agent Docker 化 (Week 7-10)

| 任务 | 工作量 | 依赖 |
|------|--------|------|
| `server.js` — REST API 包装 (run/resume/status/cancel) | 2d | Phase 1 |
| 合并 callback-server.js 到主服务 | 1d | server.js |
| Skill Router 实现 + 路由表 | 2-3d | server.js |
| PHASE 0~7 映射 (11→8) | 2d | 无 |
| QualityGateV2 (三级闸门) | 2d | Phase 2 |
| JellyfishAdapter (资产/状态/审核) | 3d | Phase 2 |
| 子 Skill 解耦 (Layer 1/2/3) | 3d | Skill Router |
| Phase 7 (导出交付) 新增 | 1d | Phase 映射 |
| Dockerfile + 集成测试 | 1d | 全部 |

**验收标准**: `POST /api/v1/pipeline/run` 启动完整 PHASE 0~7 管线，审核闸门正常工作。

#### Phase 4: 集成与治理完善 (Week 10-12)

| 任务 | 工作量 | 依赖 |
|------|--------|------|
| review-platform 五维雷达图仪表盘 (HTMX + ECharts) | 3-5d | Phase 3 AI 评分数据流 |
| 权限隔离角色扩展 (TOONFLOW_DEEP / REVIEW_GOV) | 1-2d | Phase 2 |
| 移动端增强 (审批原因模板、批量操作) | 3-5d | 权限扩展 |
| movie-agent-integration 客户端库合并 | 2d | Phase 3 |
| 全栈 docker-compose 端到端测试 | 2d | 全部 |
| kais-aigc-integration 仓库清理 (移除 modules/) | 1d | 全部 |

**验收标准**: 全栈 docker-compose up → 端到端管线运行 → 审核 → 导出 → 快照。

### 6.3 迁移依赖图

```mermaid
gantt
    title KAIS AIGC Platform 迁移甘特图
    dateFormat YYYY-MM-DD
    axisFormat %m/%d

    section Phase 0: 归档基础
    gold-team 旧代码归档           :p0a, 2026-06-01, 1d
    review-extension 合并          :p0b, 2026-06-01, 4d
    Audit DB 共享方案              :p0c, after p0b, 2d
    Init SQL 脚本                  :p0d, after p0c, 1d

    section Phase 1: gold-team 统一
    api_server (8002)              :p1a, after p0d, 3d
    engine_router                  :p1b, after p1a, 5d
    callback_standard              :p1c, after p1a, 1d
    local_engine_pool              :p1d, after p1b, 4d
    cloud_engine_pool              :p1e, after p1b, 5d
    Docker Compose 测试            :p1f, after p1d, 1d

    section Phase 2: core-backend
    Canvas Sync API                :p2a, after p0d, 3d
    Project/Node/Asset API         :p2b, after p2a, 3d
    Shot/Timeline API              :p2c, after p2b, 2d
    Audit + Snapshot Service       :p2d, after p2c, 3d
    control-node 融入              :p2e, after p1f, 3d

    section Phase 3: movie-agent
    server.js REST API             :p3a, after p1f, 2d
    Skill Router                   :p3b, after p3a, 3d
    Phase 0~7 映射                 :p3c, after p3a, 2d
    QualityGateV2                  :p3d, after p2d, 2d
    JellyfishAdapter               :p3e, after p2d, 3d
    子 Skill 解耦                  :p3f, after p3b, 3d

    section Phase 4: 集成完善
    五维雷达图仪表盘               :p4a, after p3d, 5d
    权限隔离扩展                   :p4b, after p2d, 2d
    移动端增强                     :p4c, after p4b, 5d
    全栈端到端测试                 :p4d, after p3f, 2d
    aigc-integration 清理          :p4e, after p4d, 1d
```

### 6.4 kais-aigc-integration 拆分归向

| 现有模块 | 迁入目标 | 迁移动作 | 预估工时 |
|---------|---------|---------|---------|
| `gold-team-control/` | kais-core-backend | 重构：Control Node → Jellyfish TaskRouter | 3d |
| `gold-team-worker/` | kais-gold-team | 合并：引擎适配器 → Guardian/Executor 层 | 5d |
| `movie-agent-integration/` | kais-movie-agent | 拆分：客户端库 → lib/；Express 层 → server.js | 4d |
| `review-platform-extension/` | kais-review-platform | 合并：多候选/评分/批量 → 已有代码库 | 4d |
| `crew.js` + `tests/` | kais-aigc-integration (保留) | 保留为集成测试 + CI | — |
| `docs/` | 各项目 + kais-aigc-platform | 分发：ADR 归入对应项目 | 1d |

**总拆分工时**: ~20 天

---

## 7. 风险评估

### 7.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| **ComfyUI 集成复杂度** | gold-team 的 Local Engine Pool 依赖 ComfyUI API 桥接，ComfyUI workflow 格式复杂且文档不足 | 中 | 先实现最基础的 text2video/image2video workflow，逐步扩展；参考 ComfyUI 社区现有 workflow |
| **movie-agent 子 Skill 解耦** | 14 个子 Skill 调用方式各异（LLM/Python/Blender/HTTP），统一为 3 层架构需逐一验证 | 高 | 按优先级分批解耦：先 Layer 1（纯 JS 库），再 Layer 2（Python 子进程），最后 Layer 3（远程 HTTP） |
| **显存管理** | RTX 3090 24G 需承载 Wan2.2 14B（~22G）等大模型，串行调度防碎片策略未经验证 | 中 | 保留 Hypervisor 11-state 状态机的核心逻辑；实现模型卸载队列；极端情况 offload 到内存 |
| **异步执行改造** | movie-agent 当前同步阻塞执行，改 Docker 异步需 Worker threads / 子进程 | 中 | Phase A 先保持同步（HTTP 包装），Phase B 引入异步；双模式运行降低风险 |
| **SQLite → PostgreSQL 迁移** | Toonflow 本地 SQLite 防抖同步策略在数据量大时性能未验证 | 低 | 单机单用户场景，SQLite 够用；同步是增量的，不需要全量对比 |

### 7.2 依赖风险

| 依赖 | 风险 | 缓解措施 |
|------|------|---------|
| **Jellyfish (kais-core-backend) 未完成** | core-backend 是所有系统的基础，其 API spec 不稳定会阻塞 Phase 2-4 | Phase 0-1 不依赖 core-backend；提前锁定 API spec 并用 mock 验证 |
| **ComfyUI 版本更新** | ComfyUI 更新频繁，API 可能变化 | 锁定 ComfyUI 镜像版本；桥接层做版本适配 |
| **云端 API 变更** | 可灵/即梦/Seedance 等商业 API 可能随时变更 | Cloud Engine Pool 做统一适配层，API 变更只影响单个适配器 |
| **OpenClaw 运行时** | movie-agent 当前深度依赖 OpenClaw agent 调度，Docker 化后需保持兼容 | 保持 Pipeline 类的库调用方式不变，Docker server 是 HTTP 包装层 |
| **Python/Node.js 双栈** | gold-team (Python) + movie-agent (Node.js) 双语言栈增加维护成本 | 接口严格 REST 化，语言差异不出容器边界 |

### 7.3 兼容性风险

| 场景 | 风险 | 缓解措施 |
|------|------|---------|
| **HTMX vs React** | V6.0 目标要求 React Web，但 review-platform HTMX 方案已成熟且更适合治理场景 | **保持 HTMX/Alpine**，仅在五维雷达图仪表盘引入 ECharts（HTMX 原生集成）；Toonflow 才用 React + Electron |
| **回调格式变更** | gold-team 现有 HMAC 签名回调 → V6.0 标准格式，可能影响已有集成 | 保留 HMAC 签名机制，在标准格式外层包装；双写过渡期验证 |
| **数据库 Schema 变更** | review-platform 独立 `reviewdb` → 共享 `kais` 库，需数据迁移 | Schema 级隔离（`review` schema + `public` schema），不破坏现有表结构 |
| **Docker 网络隔离** | 从双机分布式 → 单机 Docker bridge，服务发现方式变化 | 所有服务名作为 DNS 主机名（Docker Compose 内置）；环境变量配置服务 URL |
| **文件系统路径** | 产物路径 `/mnt/agents/output/` 需跨容器一致挂载 | Docker volume 统一挂载点；环境变量配置根路径 |

### 7.4 风险矩阵

```mermaid
quadrantChart
    title 风险矩阵
    x-axis 影响低 --> 影响高
    y-axis 概率低 --> 概率高
    quadrant-1 优先处理
    quadrant-2 密切关注
    quadrant-3 监控即可
    quadrant-4 应急预案

    "子 Skill 解耦复杂度": [0.8, 0.7]
    "Jellyfish 未完成": [0.9, 0.6]
    "ComfyUI 集成": [0.7, 0.5]
    "显存管理": [0.6, 0.4]
    "异步执行改造": [0.5, 0.5]
    "HTMX vs React": [0.3, 0.3]
    "回调格式变更": [0.4, 0.3]
    "数据库迁移": [0.5, 0.3]
    "云端 API 变更": [0.6, 0.6]
    "双语言栈": [0.3, 0.4]
```

### 7.5 不可妥协的设计原则（底线检查）

| # | 原则 | 验证方法 |
|---|------|---------|
| 1 | **3090 纯计算** — 24G 全部用于 AIGC 推理 | `nvidia-smi` 确认无 Xorg/Wayland 进程 |
| 2 | **3060Ti 零推理** — CUDA 推理禁止分配 | ComfyUI `CUDA_VISIBLE_DEVICES=0`，3060Ti 无 CUDA 分配 |
| 3 | **Agent 权唯一** — 只有 movie-agent 做流程编排 | 代码审查：Toonflow/Jellyfish/gold-team 无编排逻辑 |
| 4 | **默认本地，云端兜底** — 优先 3090，降级复用商业 API | Engine Router 单元测试覆盖降级路径 |
| 5 | **大文件零 HTTP** — 产物走文件系统路径引用 | API 审查：所有端点只传元数据，无文件 base64 |
| 6 | **前端本地优先** — Toonflow SQLite 为主存储，60fps | 画布操作性能测试：任何操作 < 16ms |
| 7 | **审核与创作分离** — 深度审片 vs 治理审批权限隔离 | 权限矩阵测试：TOONFLOW_DEEP 不能 governance_approve |
| 8 | **Git 审计** — 终审通过自动 Git 标签 | Snapshot Service 集成测试：Git log 包对应标签 |
| 9 | **端口绑定 127.0.0.1** — 所有服务不对外暴露 | Docker Compose 审查 + netstat 验证 |

---

## 附录 A: 仓库现状 → 目标映射

| 仓库 | 现状 | V6.0 目标 | 主要改造 |
|------|------|-----------|---------|
| kais-gold-team | 双系统并行（kais-hub + hypervisor），双机分布式 | 统一执行 Agent，单机 Docker | 合并双系统，新增 Engine Router + Cloud Pool |
| kais-review-platform | HTMX/Alpine SSR，独立 reviewdb | 治理 Web 平台，共享 kais DB | Audit DB 共享，五维雷达图，权限扩展 |
| kais-movie-agent | OpenClaw skill（14 子 skill），11 Phase | 独立 Docker 服务，8 Phase | HTTP 包装，Skill Router，Jellyfish 集成 |
| kais-aigc-integration | 4 模块 Mock 集成，docker-compose v1 | 集成测试 + CI 仓库 | 模块拆分归入各项目，保留 tests/ |

## 附录 B: 工作量估算

| Phase | 周数 | 关键交付物 |
|-------|------|-----------|
| Phase 0: 归档基础 | 2 周 | 干净代码库 + 共享 DB + review-extension 合并 |
| Phase 1: gold-team 统一 | 3 周 | REST API 8002 + Engine Router + Cloud Pool |
| Phase 2: core-backend 改造 | 2-3 周 | Canvas Sync + Shot API + Audit Service |
| Phase 3: movie-agent Docker 化 | 3-4 周 | REST API 8001 + Skill Router + PHASE 0~7 |
| Phase 4: 集成与治理 | 2-3 周 | 五维雷达图 + 全栈测试 + 仓库清理 |
| **总计** | **12-15 周** | **V6.0 Final Architecture** |

## 附录 C: 显存预算表

| 任务 | 模型 | 估算显存 | 路由目标 |
|------|------|---------|---------|
| 图像生成 (1920×1080) | FLUX-dev | 18.5G | 3090 |
| 图像生成 (1024×1024) | FLUX-Schnell | 6.5G | 3090 |
| 视频 T2V (720p) | Wan2.2-T2V 14B | 22.0G | 3090 |
| 视频 T2V (480p) | Wan2.2-T2V 14B | 14.0G | 3090 |
| 视频 I2V (720p) | LTX-Video | 12.0G | 3090 |
| 音乐生成 | ACE-Step v1.5 | 6.0G | 3090 |
| 语音合成 | CosyVoice 300M | 3.0G | 3090 |
| 超分辨率 | Real-ESRGAN | 2.0G | 3090 |
| 人脸修复 | GFPGAN/CodeFormer | 1.5G | 3090 |
| 3D 生成 | TRELLIS/Hunyuan3D | 8.0G | 3090 |
| 云端任务 | 可灵/即梦/Seedance | N/A | Cloud Pool |
