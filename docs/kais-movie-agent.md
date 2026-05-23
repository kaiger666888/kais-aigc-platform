# kais-movie-agent 改造方案

> **版本**: 1.0  
> **日期**: 2026-05-23  
> **基于**: V6.0 Final Architecture (`docs/architecture.md`) + 审计报告 (`context/audit-movie-agent.md`)  
> **目标**: 从 OpenClaw Skill → 独立 Docker 服务（V6.0 调度中枢，端口 8001）

---

## 目录

1. [改造目标](#1-改造目标)
2. [服务化改造](#2-服务化改造)
3. [集成接口](#3-集成接口)
4. [子 Skill 管理](#4-子-skill-管理)
5. [审核流程升级](#5-审核流程升级)
6. [LLM 调用迁移](#6-llm-调用迁移)
7. [迁移步骤与依赖关系](#7-迁移步骤与依赖关系)

---

## 1. 改造目标

### 1.1 变更概要

| 维度 | 现状 (v4.1.0) | V6.0 目标 |
|------|----------------|-----------|
| **运行时** | OpenClaw Skill，被 agent 通过 exec/browser 调用 | 独立 Docker 容器，REST API 端口 8001 |
| **入口** | `new Pipeline(config)` + agent 脚本编排 | `POST /api/v1/pipeline/run` |
| **状态存储** | 文件系统 `.pipeline-state.json` | PostgreSQL（通过 Jellyfish）+ 本地 SQLite 缓存 |
| **管线阶段** | 11 Phase，线性顺序执行 | 8 Phase (0~7)，含条件分支和质量闸门 |
| **引擎路由** | phaseHandler 内 `if/else` 硬编码 | Skill Router（优先级 + 健康检查 + 自动降级） |
| **审核** | ReviewPlatformClient 单体 + callback-server.js | 内置三级闸门 + 主服务回调端点 |
| **子 Skill** | 14 个 symlink，OpenClaw agent 调度 | 三层架构：内嵌库 / 子进程 / 远程 HTTP |
| **LLM** | 直接调用智谱 GLM API（`lib/llm.js`） | 通过 Hermes Agent（Jellyfish LLM 路由） |
| **生命周期** | OpenClaw agent 进程控制 | Docker 容器，健康检查 + 自动重启 |

### 1.2 不变的部分（降低迁移风险）

- **Pipeline 类核心逻辑**保持库模式不变，Docker server 只是 HTTP 包装层
- **零 npm 依赖原则**延续：基于 `node:http` / `node:fs` / `node:crypto`
- **phaseHandlers 模块结构**不变，仅改路由调用方式
- **HMAC 签名机制**保留，与 V6.0 标准回调格式兼容
- **降级容错设计**继承并扩展

### 1.3 目标架构定位

```
┌──────────────────────────────────────────────────────────────┐
│                    Docker Compose (kais-net)                  │
│                                                              │
│  ┌─────────────────┐    ┌─────────────────┐                  │
│  │ kais-core-backend│◄───│ kais-movie-agent│──► Telegram      │
│  │  (Jellyfish)     │    │  (本改造目标)    │                  │
│  │  :8000           │    │  :8001          │                  │
│  └────────┬─────────┘    └────────┬─────────┘                │
│           │                       │                          │
│           ▼                       ▼                          │
│  ┌─────────────────┐    ┌─────────────────┐                  │
│  │ audit-db (PG15)  │    │ kais-gold-team  │──► ComfyUI       │
│  │  :5432           │    │  :8002          │──► 云端 API       │
│  └─────────────────┘    └─────────────────┘                  │
│           ▲                                                  │
│  ┌────────┴─────────┐                                       │
│  │ review-platform   │◄── 审核回调                           │
│  │  :8090            │                                       │
│  └──────────────────┘                                        │
└──────────────────────────────────────────────────────────────┘
```

**movie-agent 是唯一编排者**（Agent 权唯一原则）：Toonflow / Jellyfish / gold-team 均不包含流程编排逻辑。

---

## 2. 服务化改造

### 2.1 REST API 端点设计

基于 `node:http` 零依赖实现，合并现有 `callback-server.js` 功能。

#### 管线控制 API

```
POST   /api/v1/pipeline/run              # 启动新管线（异步，返回 jobId）
POST   /api/v1/pipeline/resume            # 从断点恢复管线
GET    /api/v1/pipeline/status            # 查询当前管线状态
POST   /api/v1/pipeline/cancel            # 取消管线
GET    /api/v1/pipeline/phases            # 获取 Phase 0~7 列表
GET    /api/v1/pipeline/jobs/:jobId       # 查询异步任务进度
```

#### 回调端点（内置，替代独立 callback-server.js）

```
POST   /api/v1/reviews/callback           # review-platform 审核回调
POST   /api/v1/gpu/callback               # gold-team 任务完成回调
```

#### 健康检查

```
GET    /health                            # 服务存活探测
```

#### API 契约示例

**启动管线**：

```json
// POST /api/v1/pipeline/run
// 请求
{
  "project_id": "proj_123",
  "config": {
    "phases": ["requirement", "art-character", "script-voice",
               "storyboard-scene", "video", "post-production",
               "quality-gate", "delivery"],
    "engine_preference": "auto",
    "review_mode": "hybrid"
  },
  "metadata": {}
}

// 响应 (202 Accepted)
{
  "pipeline_id": "pipe_001",
  "job_id": "job_abc",
  "status": "running",
  "current_phase": "requirement",
  "phases": [
    { "id": "requirement", "status": "running" },
    { "id": "art-character", "status": "pending" }
  ]
}
```

**查询状态**：

```json
// GET /api/v1/pipeline/status?pipeline_id=pipe_001
{
  "pipeline_id": "pipe_001",
  "status": "running",
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

**GPU 任务回调**：

```json
// POST /api/v1/gpu/callback
{
  "task_id": "gold_s03_02_v1",
  "status": "completed",
  "engine_used": "local",
  "outputs": {
    "video": "/mnt/agents/output/gold_s03_02_v1/video.mp4",
    "proxy": "/mnt/agents/output/gold_s03_02_v1/proxy_720p.mp4",
    "thumbnail": "/mnt/agents/output/gold_s03_02_v1/thumbnail.jpg"
  },
  "metadata": {
    "seed": 42,
    "inference_time_sec": 145,
    "gpu_memory_peak_gb": 22.4
  }
}
```

**审核回调**：

```json
// POST /api/v1/reviews/callback
{
  "review_id": "rev_001",
  "pipeline_id": "pipe_001",
  "phase": "video",
  "decision": "approved",
  "items": [
    {
      "shot_id": "shot_003",
      "decision": "approved",
      "reviewer": "user_001",
      "reviewed_at": "2026-05-23T15:00:00Z",
      "scores": { "aesthetics": 85, "consistency": 80 }
    }
  ],
  "signature": "HMAC-SHA256 signature"
}
```

### 2.2 server.js 骨架

```js
// server.js — REST API 包装层（零 npm 依赖）
import { createServer } from 'node:http';
import { Pipeline } from './lib/pipeline.js';
import { SkillRouter } from './lib/skill-router.js';
import { JellyfishAdapter } from './lib/jellyfish-adapter.js';
import { QualityGateV2 } from './lib/quality-gate-v2.js';

const router = new SkillRouter();
const jellyfish = new JellyfishAdapter({
  baseUrl: process.env.CORE_BACKEND_URL || 'http://kais-core-backend:8000',
  apiKey: process.env.JELLYFISH_API_KEY,
});
const qualityGate = new QualityGateV2({ jellyfish, router });

// 任务管理（Worker thread 执行长管线）
const jobs = new Map();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS + JSON helper
  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // 路由分发
  if (req.method === 'GET' && url.pathname === '/health') {
    return json({ status: 'ok', uptime: process.uptime() });
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/pipeline/run') {
    const body = await parseBody(req);
    const jobId = `job_${Date.now()}`;
    // Worker thread 执行管线
    spawnPipelineJob(jobId, body);
    return json({ job_id: jobId, status: 'running' }, 202);
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/pipeline/status') {
    const pipelineId = url.searchParams.get('pipeline_id');
    const state = await jellyfish.loadState(pipelineId);
    return json(state);
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/pipeline/resume') {
    const body = await parseBody(req);
    // 从断点恢复
    return json({ status: 'resumed' });
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/pipeline/cancel') {
    const body = await parseBody(req);
    // 取消管线
    return json({ status: 'cancelled' });
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/reviews/callback') {
    const body = await parseBody(req);
    // HMAC 验证 + 恢复等待审核的管线
    await handleReviewCallback(body);
    return json({ acknowledged: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/gpu/callback') {
    const body = await parseBody(req);
    await handleGpuCallback(body);
    return json({ acknowledged: true });
  }

  res.writeHead(404);
  res.end('Not Found');
});

const PORT = process.env.PORT || 8001;
server.listen(PORT, () => console.log(`[movie-agent] listening :${PORT}`));
```

### 2.3 Skill Router 实现

**设计目标**：替换当前 phaseHandler 中的 `if/else` 硬编码路由，统一所有生成引擎的调度。

```js
// lib/skill-router.js
class SkillRouter {
  constructor() {
    this.routes = new Map(); // taskType → [RouteEntry{ handler, priority, healthCheck }]
  }

  /**
   * 注册路由
   * @param {string} taskType - 任务类型（image_generate / video_generate / tts_generate 等）
   * @param {Function} handler - async (params) => result
   * @param {Object} opts - { priority: 5, healthCheck: async () => bool, fallback: bool }
   */
  register(taskType, handler, opts = {}) {
    const { priority = 5, healthCheck, fallback = false } = opts;
    const entries = this.routes.get(taskType) || [];
    entries.push({ handler, priority, healthCheck, fallback });
    entries.sort((a, b) => b.priority - a.priority); // 高优先级在前
    this.routes.set(taskType, entries);
  }

  /**
   * 路由调度：按优先级尝试，失败自动降级
   */
  async route(taskType, params) {
    const entries = this.routes.get(taskType);
    if (!entries || entries.length === 0) {
      throw new Error(`No route registered for: ${taskType}`);
    }

    const errors = [];
    for (const entry of entries) {
      // 健康检查
      if (entry.healthCheck) {
        try {
          const healthy = await entry.healthCheck();
          if (!healthy) {
            console.warn(`[Router] ${taskType} → ${entry.handler.name} unhealthy, skipping`);
            continue;
          }
        } catch (err) {
          console.warn(`[Router] health check failed: ${err.message}`);
          continue;
        }
      }

      try {
        const result = await entry.handler(params);
        return result;
      } catch (err) {
        console.warn(`[Router] ${taskType} → ${entry.handler.name} failed: ${err.message}`);
        errors.push(err);
        if (!entry.fallback && entries.indexOf(entry) < entries.length - 1) continue;
        if (entry.fallback) continue; // 尝试下一个降级
        throw err;
      }
    }

    throw new Error(`All routes failed for ${taskType}: ${errors.map(e => e.message).join('; ')}`);
  }
}
```

#### 路由表

| TaskType | 优先级路由 | 说明 |
|----------|-----------|------|
| `image_generate` | gold-team/FLUX → gold-team/ComfyUI → 即梦 API | 美术方向 / 场景图生成 |
| `image_refine` | gold-team/FLUX → 即梦 API | 图像精修 |
| `video_preview` | gold-team/WAN-preview → Seedance API | 快速视频预览 |
| `video_generate` | gold-team/WAN-final → Seedance → 可灵 | 正式视频生成 |
| `tts_generate` | gold-team/CosyVoice → 智谱 GLM-TTS → 占位音频 | 语音合成 |
| `voice_clone` | gold-team/CosyVoice → 跳过 | 声音克隆 |
| `music_generate` | gold-team/ACE-Step → 跳过 | BGM 生成 |
| `sfx_generate` | gold-team → 跳过 | 音效生成 |
| `lip_sync` | gold-team → 跳过 | 口型同步 |
| `text_llm` | jellyfish/Hermes → 直接 GLM API | 文本生成 |
| `text_review` | jellyfish/Hermes → 本地 AI scorer | AI 审核 |

#### 路由注册示例

```js
// 在 server.js 启动时注册
const goldTeamUrl = process.env.GOLD_TEAM_URL || 'http://kais-gold-team:8002';

// 图像生成路由
router.register('image_generate', async (params) => {
  return await submitToGoldTeam(goldTeamUrl, {
    engine: 'auto', model_id: 'flux_dev', task_type: 'text2image', params,
    callback_url: `http://kais-movie-agent:8001/api/v1/gpu/callback`,
  });
}, { priority: 10, healthCheck: () => pingService(goldTeamUrl) });

router.register('image_generate', async (params) => {
  return await submitToJimeng(params); // 即梦降级
}, { priority: 5, fallback: true });
```

#### 与现有代码的对应

| 当前实现 | V6.0 替换 |
|---------|----------|
| `_makeGtClient(pipeline)` + 条件判断 | `router.route('image_generate', params)` |
| phaseHandler 内嵌即梦降级逻辑 | Router 降级链自动处理 |
| `jimeng-client.js` 直接调用 | 注册为 Router fallback handler |
| `gold-team-client.js` 直接调用 | 注册为 Router primary handler |

### 2.4 状态机：Phase 0~7

#### 映射表

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

#### 状态模型

每个 Phase 内部的状态流转：

```
idle → running → [reviewing → approved/rejected] → completed
                                      ↓
                                   failed (max retry exhausted)
```

完整状态枚举：

```
idle | running | paused | reviewing | approved | rejected | completed | failed
```

#### 合并策略

11→8 的合并**不修改底层 phaseHandlers**，仅在编排层做逻辑合并：

```js
// lib/pipeline-v6.js
const PHASES_V6 = [
  {
    id: 'requirement',
    name: '需求确认与预研',
    stages: ['requirement'],    // 对应原 phaseHandlers['requirement']
    review: false,
  },
  {
    id: 'art-character',
    name: '美术方向与角色',
    stages: ['art-direction', 'character'],  // 顺序执行两个 handler
    review: true,
  },
  {
    id: 'script-voice',
    name: '剧本与配音',
    stages: ['scenario', 'voice'],
    review: true,
  },
  {
    id: 'storyboard-scene',
    name: '分镜与场景',
    stages: ['storyboard', 'scene'],
    review: true,
  },
  {
    id: 'video',
    name: '视频生成',
    stages: ['camera-preview', 'camera-final'],
    review: true,
  },
  {
    id: 'post-production',
    name: '后期合成',
    stages: ['post-production'],
    review: false,
  },
  {
    id: 'quality-gate',
    name: '质量审核',
    stages: ['quality-gate'],
    review: false,
    autoEvaluate: true,
  },
  {
    id: 'delivery',
    name: '导出交付',
    stages: ['delivery'],
    review: false,
  },
];
```

**合并效果**：
- 审核门从 9 个减少到 4 个（Phase 1~4 各一个 + Phase 6 自动闸门）
- 每个 V6 Phase 内部子阶段保持原子性，审核粒度变化不影响执行逻辑
- Phase 7（导出交付）为全新阶段，需新增 `delivery` phaseHandler

#### Phase 7（导出交付）设计

```js
// lib/phases/delivery.js — 新增
export const deliveryHandler = {
  async run(pipeline, context) {
    // 1. 编码：ffmpeg 统一输出格式（H.264/AAC MP4）
    // 2. 元数据：写入项目元信息（分辨率/时长/创建日期/引擎信息）
    // 3. 多平台适配：竖版/横版/方形裁切（可选）
    // 4. Git 快照：调用 Jellyfish Snapshot Service
    const snapshot = await pipeline.jellyfish.createSnapshot({
      project_id: pipeline.projectId,
      trigger: 'final_audit_approved',
      version_tag: `v${pipeline.version}`,
    });

    return { snapshot, outputs: pipeline.collectOutputs() };
  }
};
```

### 2.5 Dockerfile

```dockerfile
FROM node:22-slim

WORKDIR /app

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    ffmpeg \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖（story-score / anatomy-guard）
COPY lib/scripts/requirements.txt /app/lib/scripts/requirements.txt
RUN pip3 install --no-cache-dir -r /app/lib/scripts/requirements.txt

# 应用代码
COPY . .

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:8001/health || exit 1

CMD ["node", "server.js"]
```

### 2.6 异步执行设计

当前 `pipeline.run()` 是同步阻塞的。Docker 服务需要支持异步执行：

```js
// server.js 内的异步管线执行
import { Worker } from 'node:worker_threads';

function spawnPipelineJob(jobId, config) {
  const job = { id: jobId, status: 'running', worker: null, result: null };
  jobs.set(jobId, job);

  const worker = new Worker('./lib/pipeline-worker.js', {
    workerData: { jobId, config },
  });

  worker.on('message', (msg) => {
    if (msg.type === 'progress') {
      job.currentPhase = msg.phase;
      job.progress = msg.progress;
    }
    if (msg.type === 'complete') {
      job.status = 'completed';
      job.result = msg.result;
    }
    if (msg.type === 'error') {
      job.status = 'failed';
      job.error = msg.error;
    }
  });

  worker.on('error', (err) => {
    job.status = 'failed';
    job.error = err.message;
  });

  job.worker = worker;
}
```

```js
// lib/pipeline-worker.js (Worker thread)
import { workerData, parentPort } from 'node:worker_threads';
import { Pipeline } from './pipeline.js';

const { jobId, config } = workerData;
const pipeline = new Pipeline(config);

try {
  const result = await pipeline.run(config.phasesConfig);
  parentPort.postMessage({ type: 'complete', result });
} catch (err) {
  parentPort.postMessage({ type: 'error', error: err.message });
}
```

---

## 3. 集成接口

### 3.1 与 kais-core-backend (Jellyfish) 的 REST 接口

**网络**：Docker bridge，`http://kais-core-backend:8000`

#### JellyfishAdapter 设计

```js
// lib/jellyfish-adapter.js
class JellyfishAdapter {
  constructor({ baseUrl, apiKey }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  // ═══ 资产管理（替代 AssetBus） ═══
  async writeAsset(name, data) {
    return this._post('/api/v1/assets', { name, ...data });
  }

  async readAsset(assetId) {
    return this._get(`/api/v1/assets/${assetId}`);
  }

  async updateAsset(assetId, data) {
    return this._put(`/api/v1/assets/${assetId}`, data);
  }

  // ═══ 管线状态（替代 .pipeline-state.json） ═══
  async saveState(pipelineId, state) {
    return this._put(`/api/v1/pipelines/${pipelineId}/state`, state);
  }

  async loadState(pipelineId) {
    return this._get(`/api/v1/pipelines/${pipelineId}`);
  }

  // ═══ 任务队列（替代直接调用 gold-team） ═══
  async submitTask(taskType, params) {
    return this._post('/api/v1/tasks', { task_type: taskType, ...params });
  }

  async waitForTask(taskId) {
    // 轮询或 WebSocket 监听
    const poll = async () => {
      const task = await this._get(`/api/v1/tasks/${taskId}`);
      if (task.status === 'completed' || task.status === 'failed') return task;
      await new Promise(r => setTimeout(r, 2000));
      return poll();
    };
    return poll();
  }

  // ═══ 快照（新增） ═══
  async createSnapshot({ project_id, trigger, version_tag }) {
    return this._post('/api/v1/snapshots', { project_id, trigger, version_tag });
  }

  // ═══ 审核（替代直接 ReviewPlatformClient） ═══
  async submitReview(params) {
    return this._post('/api/v1/reviews', params);
  }

  // ═══ 内部 HTTP 方法 ═══
  async _get(path) { /* fetch wrapper */ }
  async _post(path, body) { /* fetch wrapper */ }
  async _put(path, body) { /* fetch wrapper */ }
}
```

#### 对接的 Jellyfish API 端点

| 功能 | API | 优先级 | 替代对象 |
|------|-----|--------|---------|
| 资产读写 | `POST/GET/PUT /api/v1/assets` | P0 | AssetBus |
| 管线状态 | `GET/PUT /api/v1/pipelines/:id` | P0 | `.pipeline-state.json` |
| 任务队列 | `POST/GET /api/v1/tasks` | P1 | 直接调用 gold-team |
| 审核提交 | `POST /api/v1/reviews` | P1 | ReviewPlatformClient |
| 快照创建 | `POST /api/v1/snapshots` | P2 | GitStageManager |
| Shot 查询 | `GET /api/v1/projects/:id/shots` | P1 | 本地文件 |

#### 迁移策略

1. **Adapter 模式**：JellyfishAdapter 与现有 AssetBus / GoldTeamClient 实现相同接口
2. **配置选择**：通过环境变量 `STORAGE_MODE=file|jellyfish` 切换后端
3. **双写过渡**：初期同时写本地文件 + Jellyfish API，验证一致性后关闭本地写入

```js
// lib/asset-store.js — 统一接口
class AssetStore {
  constructor(config) {
    this.backend = config.storageMode === 'jellyfish'
      ? new JellyfishAdapter(config.jellyfish)
      : new FileAssetBus(config.workdir);
  }

  async write(name, data) { return this.backend.writeAsset(name, data); }
  async read(id) { return this.backend.readAsset(id); }
}
```

### 3.2 与 kais-gold-team 的统一生成 API

**网络**：Docker bridge，`http://kais-gold-team:8002`

#### 任务提交

```json
// POST http://kais-gold-team:8002/api/v1/tasks
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
    "seed": 42
  },
  "priority": 5,
  "callback_url": "http://kais-movie-agent:8001/api/v1/gpu/callback",
  "metadata": {
    "pipeline_id": "pipe_001",
    "phase": "video",
    "shot_id": "shot_003"
  }
}
```

#### 批量管线提交

```json
// POST http://kais-gold-team:8002/api/v1/pipelines
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
```

#### 回调处理

```js
// server.js 内的 GPU 回调处理
async function handleGpuCallback(body) {
  const { task_id, status, outputs, error } = body;

  // 1. 查找对应的管线任务
  const job = findJobByTaskId(task_id);
  if (!job) {
    console.warn(`[GPU Callback] Unknown task: ${task_id}`);
    return;
  }

  // 2. 更新任务状态
  if (status === 'completed') {
    // 更新资产引用
    await jellyfish.writeAsset(task_id, { outputs });
    // 通知 worker thread 继续执行
    job.worker.postMessage({ type: 'task_complete', task_id, outputs });
  } else if (status === 'failed') {
    job.worker.postMessage({ type: 'task_failed', task_id, error });
  }
}
```

#### 通过 Skill Router 路由

```js
// 注册 gold-team 为主要生成路由
router.register('video_generate', async (params) => {
  const response = await fetch(`${goldTeamUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      engine: params.engine || 'auto',
      model_id: params.model_id || 'wan14b_i2v',
      task_type: 'image2video',
      params,
      priority: params.priority || 5,
      callback_url: `http://kais-movie-agent:8001/api/v1/gpu/callback`,
      metadata: params.metadata || {},
    }),
  });
  return response.json();
}, {
  priority: 10,
  healthCheck: async () => {
    try {
      const r = await fetch(`${goldTeamUrl}/health`);
      return r.ok;
    } catch { return false; }
  }
});

// 注册云端 API 为降级路由
router.register('video_generate', async (params) => {
  return await submitToSeedance(params);
}, { priority: 5, fallback: true });
```

### 3.3 与 review-platform 的审核回调

**网络**：Docker bridge，`http://kais-review-platform:8090`

#### 提交审核

movie-agent 在 Phase 完成后，通过 review-platform API 提交审核：

```json
// POST http://kais-review-platform:8090/api/v1/reviews
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
      }
    }
  ],
  "callback_url": "http://kais-movie-agent:8001/api/v1/reviews/callback",
  "priority": "normal"
}
```

#### 接收审核回调

```js
// server.js 内的审核回调处理
async function handleReviewCallback(body) {
  const { review_id, pipeline_id, phase, decision, items } = body;

  // 1. HMAC 签名验证
  if (!verifyHmac(body, process.env.HMAC_SECRET)) {
    throw new Error('Invalid HMAC signature');
  }

  // 2. 查找等待审核的管线
  const job = findJobByPipelineId(pipeline_id);
  if (!job) {
    console.warn(`[Review Callback] Unknown pipeline: ${pipeline_id}`);
    return;
  }

  // 3. 通知 worker thread 审核结果
  job.worker.postMessage({
    type: 'review_result',
    review_id,
    phase,
    decision,
    items,
  });
}
```

---

## 4. 子 Skill 管理

### 4.1 现状：14 个 OpenClaw 子 Skill

| # | Skill | 当前调用方式 | 依赖 |
|---|-------|------------|------|
| 1 | deep-research | agent 调度 | LLM API |
| 2 | kais-topic-selector | agent 调度 | LLM API |
| 3 | kais-audience | agent 调度 | LLM API |
| 4 | kais-art-direction | agent 调度 | LLM API + FLUX |
| 5 | kais-character-designer | agent 调度 | LLM API |
| 6 | kais-blender-pose | agent + Blender API | 高配机 GPU |
| 7 | kais-scenario-writer | agent 调度 | LLM API |
| 8 | kais-voice | phaseHandler 内 | CosyVoice / GLM-TTS |
| 9 | kais-storyboard-designer | agent 调度 | LLM API |
| 10 | kais-scene-designer | agent 调度 | LLM API |
| 11 | kais-camera | phaseHandler 内 | WAN / Seedance |
| 12 | kais-story-score | Python CLI | Python + ML |
| 13 | kais-anatomy-guard | Python CLI | Python + ML |
| 14 | kais-review-page | HTML 生成 | 无 |

### 4.2 三层架构方案

#### Layer 1 — 内嵌库（纯 JS / LLM 调用）

**适用**：无特殊依赖，纯逻辑处理

| Skill | 改造方式 |
|-------|---------|
| kais-topic-selector | 直接 import 核心函数 |
| kais-audience | 直接 import 核心函数 |
| kais-art-direction | 直接 import 核心函数 |
| kais-character-designer | 直接 import 核心函数 |
| kais-scenario-writer | 直接 import 核心函数 |
| kais-storyboard-designer | 直接 import 核心函数 |
| kais-scene-designer | 直接 import 核心函数 |
| kais-review-page | 直接 import HTML 生成函数 |
| deep-research | 改为通过 Hermes Agent 调用（见 §6） |

**改造要点**：
- 提取各 skill 的核心逻辑为独立 JS 模块（`export function / class`）
- 移除 OpenClaw SKILL.md 依赖，改为直接 `import`
- LLM 调用统一走 Hermes Agent（见 §6）

```js
// lib/skills/topic-selector.js
export async function selectTopic(context, options) {
  const prompt = buildTopicPrompt(context);
  const result = await hermes.chat(prompt, { model: 'glm-4-flash' });
  return parseTopicResult(result);
}
```

#### Layer 2 — 子进程（Python 脚本）

**适用**：需要 Python 运行时和 ML 依赖

| Skill | 改造方式 |
|-------|---------|
| kais-story-score | `child_process.execFile('python3', [...])` |
| kais-anatomy-guard | `child_process.execFile('python3', [...])` |

**改造要点**：
- Python 脚本和 `requirements.txt` 打包进 Docker 镜像
- 通过 `child_process.execFile` 调用，解析 JSON 输出
- 超时保护（默认 60s）

```js
// lib/skills/story-score.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execFile);

export async function evaluateStory(inputPath, options = {}) {
  const args = ['-m', 'src.cli', '--input', inputPath, '--output-dir', '/tmp/score', '--language', options.language || 'zh'];
  const { stdout } = await execAsync('python3', args, {
    cwd: '/app/lib/scripts/story-score',
    timeout: 60000,
  });
  return JSON.parse(stdout);
}
```

#### Layer 3 — 远程 HTTP（需要 GPU 或特殊环境）

**适用**：需要 GPU 或独立服务

| Skill | 改造方式 |
|-------|---------|
| kais-blender-pose | HTTP 调用高配机 Blender API |
| 所有 gold-team 引擎 | 通过 Skill Router 路由到 gold-team 服务 |

**改造要点**：
- kais-blender-pose：保持 HTTP 调用高配机（通过 Tailscale 内网），注册为 Router handler
- gold-team 引擎：已由 Skill Router 统一调度，无需单独处理

```js
// 注册 Blender pose 为远程技能
router.register('pose_reference', async (params) => {
  const blenderUrl = process.env.BLENDER_API_URL || 'http://192.168.71.166:8080';
  const response = await fetch(`${blenderUrl}/api/pose`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return response.json();
}, {
  priority: 10,
  healthCheck: async () => {
    try {
      const r = await fetch(`${process.env.BLENDER_API_URL}/health`);
      return r.ok;
    } catch { return false; }
  }
});
```

### 4.3 SkillExecutor 统一调度

```js
// lib/skill-executor.js
class SkillExecutor {
  constructor(router) {
    this.router = router;
    this.registry = new Map();
  }

  /**
   * 注册 skill
   * @param {string} name - skill 名称
   * @param {Function} handler - 执行函数
   * @param {'lib'|'process'|'remote'} type - 层级类型
   */
  register(name, handler, type = 'lib') {
    this.registry.set(name, { type, handler });
  }

  async execute(name, params) {
    const skill = this.registry.get(name);
    if (!skill) throw new Error(`Unknown skill: ${name}`);

    switch (skill.type) {
      case 'lib':
        return skill.handler(params);
      case 'process':
        return this._execProcess(skill.handler, params);
      case 'remote':
        return this.router.route(name, params);
    }
  }

  async _execProcess(handler, params) {
    // child_process 封装，带超时和错误处理
  }
}
```

---

## 5. 审核流程升级

### 5.1 现状 vs 目标

| 维度 | 现状 | V6.0 目标 |
|------|------|-----------|
| 审核闸门 | 二态：通过 / 等待审核 | 三级：自动通过 / 人工审核 / 自动驳回 |
| 回调机制 | 独立 `callback-server.js` 进程 | 内置到主服务 `/api/v1/reviews/callback` |
| 降级策略 | fail-open（不可用 → AUTO 通过） | 分级降级：重试 → 本地审核 → AUTO 通过 |
| 审核类型 | 单一 `pipeline_phase` | 多类型：AI 自动审核 / 人工审核 / 混合 |
| 质量评分 | 6 维度固定 | 6 维度 + story-score + 可配置权重 |

### 5.2 QualityGateV2 设计

```js
// lib/quality-gate-v2.js
class QualityGateV2 {
  constructor(config) {
    this.rules = config.rules || {};
    this.reviewClient = config.reviewClient;     // ReviewPlatformClient 或 JellyfishAdapter
    this.jellyfish = config.jellyfish;           // JellyfishAdapter
    this.router = config.router;                 // SkillRouter
    this.localReviewFallback = config.localReview; // interactive-review.js

    // 默认闸门阈值
    this.autoPassThreshold = config.autoPassThreshold ?? 85;
    this.autoFailThreshold = config.autoFailThreshold ?? 30;
  }

  /**
   * 评估 Phase 输出，决定通过/审核/驳回
   * @returns {{ action: 'pass'|'review'|'fail', score, reviewId?, reason? }}
   */
  async evaluate(phase, result) {
    // 1. 自动评估（AI scorer + story-score + 规则引擎）
    const autoScore = await this._autoEvaluate(phase, result);

    // 2. 检查 Phase 级别的自定义阈值
    const passThreshold = this.rules[phase.id]?.autoPassThreshold ?? this.autoPassThreshold;
    const failThreshold = this.rules[phase.id]?.autoFailThreshold ?? this.autoFailThreshold;

    // 3. 三级路由
    if (autoScore.overall >= passThreshold) {
      return { action: 'pass', score: autoScore };
    }

    if (autoScore.overall <= failThreshold) {
      return {
        action: 'fail',
        score: autoScore,
        reason: `Auto-fail: score ${autoScore.overall} <= ${failThreshold}`,
      };
    }

    // 4. 中间分数 → 提交人工审核
    const reviewId = await this._submitReview(phase, result, autoScore);
    return { action: 'review', score: autoScore, reviewId };
  }

  async _autoEvaluate(phase, result) {
    // 6 维度评分 + story-score 注入
    const dimensions = await this._scoreDimensions(result);
    const storyScore = phase.id === 'script-voice'
      ? await this.router.route('text_review', { text: result.script })
      : null;

    const overall = this._weightedAverage(dimensions, storyScore);
    return { overall, dimensions, storyScore };
  }

  async _submitReview(phase, result, autoScore) {
    // 通过 review-platform API 提交
    return this.reviewClient.submitReview({
      pipeline_id: result.pipelineId,
      phase: phase.id,
      items: this._buildReviewItems(result, autoScore),
      callback_url: `http://kais-movie-agent:8001/api/v1/reviews/callback`,
      priority: 'normal',
    });
  }

  /**
   * 处理审核回调结果
   */
  async handleCallback(callbackData) {
    const { decision, items } = callbackData;

    switch (decision) {
      case 'approved':
        return { action: 'pass', items };
      case 'rejected':
        return {
          action: 'fail',
          items,
          reason: items[0]?.reject_reason || 'Human rejected',
        };
      case 'needs_revision':
        return {
          action: 'retry',
          items,
          adjustedParams: this._extractRevisionHints(items),
        };
      default:
        return { action: 'fail', reason: `Unknown decision: ${decision}` };
    }
  }
}
```

### 5.3 审核降级链

```
Phase 完成
  → QualityGateV2 自动评估
    → score >= 85 → 自动通过
    → score <= 30 → 自动驳回（重试/降级引擎）
    → 30 < score < 85 → 提交 review-platform
      → 审核人在 2h 内响应？
        → 是 → 按审核结果处理
        → 否 → 降级到本地审核页面（interactive-review.js）
          → 30min 内响应？
            → 是 → 按审核结果处理
            → 否 → AUTO 通过（记录日志，标记需复检）
```

### 5.4 ReviewPlatformClient 适配

现有 `review-platform-client.js` 需要适配 V6.0 接口：

| 功能 | 现有实现 | V6.0 适配 |
|------|---------|----------|
| 提交审核 | `POST /api/submit` | `POST /api/v1/reviews` |
| 回调验证 | HMAC 验证 ✅ | 保持，新增 V6.0 标准字段 |
| 降级容错 | fail-open | 升级为分级降级链 |
| 批量审核 | 不支持 | 新增批量提交 |

```js
// lib/review-platform-client-v2.js — 适配层
class ReviewPlatformClientV2 {
  constructor(config) {
    this.baseUrl = config.reviewPlatformUrl || 'http://kais-review-platform:8090';
    this.hmacSecret = config.hmacSecret;
    this.timeout = config.timeout || 10000;
  }

  async submitReview(params) {
    const body = {
      pipeline_id: params.pipeline_id,
      phase: params.phase,
      items: params.items.map(item => ({
        shot_id: item.shot_id,
        task_id: item.task_id,
        type: 'shot_review',
        assets: item.assets,
        ai_scores: item.ai_scores,
        context: item.context,
      })),
      callback_url: params.callback_url,
      priority: params.priority || 'normal',
    };

    const response = await fetch(`${this.baseUrl}/api/v1/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HMAC-Signature': signHmac(body, this.hmacSecret),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Review submit failed: ${response.status}`);
    }
    return response.json();
  }
}
```

---

## 6. LLM 调用迁移

### 6.1 现状

当前 `lib/llm.js` 直接调用智谱 GLM API：

```js
// 现有实现（简化）
async function callLLM(prompt, options = {}) {
  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({
      model: options.model || 'glm-4-flash',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  return response.json();
}
```

**问题**：
- 硬编码 API 端点和模型
- 无法利用 Jellyfish 的 LLM 路由、缓存、降级能力
- API Key 直接暴露在环境变量

### 6.2 Hermes Agent 集成方案

V6.0 架构中，Jellyfish 提供 Hermes Agent 作为统一 LLM 入口：

```
movie-agent → Jellyfish /api/v1/llm/chat → Hermes Agent
                                                ├── 本地 GLM (优先)
                                                ├── 云端 API (降级)
                                                └── 缓存层 (去重)
```

#### HermesClient 实现

```js
// lib/hermes-client.js
class HermesClient {
  constructor(config) {
    this.baseUrl = config.jellyfishUrl || 'http://kais-core-backend:8000';
    this.timeout = config.timeout || 60000;
  }

  /**
   * 统一 LLM 调用入口
   * @param {string} prompt - 用户提示
   * @param {Object} options - { model, temperature, maxTokens, system }
   * @returns {Object} - { content, model, usage }
   */
  async chat(prompt, options = {}) {
    const body = {
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: prompt },
      ],
      model: options.model || 'auto',       // 'auto' 让 Hermes 自动选择
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    };

    const response = await fetch(`${this.baseUrl}/api/v1/llm/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      // 降级：直接调用 GLM API
      console.warn(`[Hermes] Fallback to direct API: ${response.status}`);
      return this._directCall(prompt, options);
    }

    const result = await response.json();
    return {
      content: result.choices[0].message.content,
      model: result.model,
      usage: result.usage,
    };
  }

  /**
   * 降级：直接调用 GLM API（保持向后兼容）
   */
  async _directCall(prompt, options) {
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) throw new Error('No LLM API key available');

    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || 'glm-4-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature ?? 0.7,
      }),
    });

    const result = await response.json();
    return {
      content: result.choices[0].message.content,
      model: result.model,
      usage: result.usage,
    };
  }
}
```

### 6.3 迁移路径

1. **Phase A**：创建 `HermesClient`，注册为全局单例。保持 `lib/llm.js` 不变，HermesClient 内部可降级到直接调用
2. **Phase B**：逐步替换各 phaseHandler 和子 skill 中的 LLM 调用为 `hermes.chat()`
3. **Phase C**：Jellyfish Hermes API 就绪后，移除直接 API 调用降级逻辑

#### 替换示例

```js
// 现有（直接调用）
import { callLLM } from '../llm.js';
const result = await callLLM(prompt, { model: 'glm-4-flash' });

// V6.0（通过 Hermes）
const hermes = new HermesClient({ jellyfishUrl: process.env.CORE_BACKEND_URL });
const result = await hermes.chat(prompt, { model: 'glm-4-flash' });
```

### 6.4 通过 Skill Router 路由 LLM

文本生成和文本审核任务也注册到 Skill Router：

```js
// 注册 Hermes 为主要 LLM 路由
router.register('text_llm', async (params) => {
  return hermes.chat(params.prompt, params.options);
}, { priority: 10 });

router.register('text_review', async (params) => {
  return hermes.chat(
    buildReviewPrompt(params.text),
    { model: 'glm-4-flash', temperature: 0.3 }
  );
}, { priority: 10 });
```

---

## 7. 迁移步骤与依赖关系

### 7.1 总览

```
Phase A: HTTP 包装 + Docker 化 ────────► 可运行的 Docker 容器
    │                                    （REST API 可用，管线同步执行）
    ▼
Phase B: Skill Router + Phase 映射 ────► 引擎路由化，11→8 Phase
    │                                    （路由表生效，Phase 合并完成）
    ▼
Phase C: Jellyfish 集成 + 审核升级 ────► 接入 Jellyfish 后端
    │                                    （资产/状态/审核走 Jellyfish）
    ▼
Phase D: 生产化 ──────────────────────► 异步执行 + 监控 + 结构化日志
```

### 7.2 Phase A：HTTP 包装 + Docker 化（1-2 周）

| # | 任务 | 工作量 | 依赖 | 产出 |
|---|------|--------|------|------|
| A1 | 创建 `server.js` REST API（run/resume/status/cancel/health） | 2d | 无 | 可启动的 HTTP 服务 |
| A2 | 合并 `callback-server.js` 到主服务（reviews/callback + gpu/callback） | 1d | A1 | 审核和 GPU 回调端点 |
| A3 | 编写 Dockerfile（node:22-slim + python3 + ffmpeg） | 0.5d | A1 | Docker 镜像 |
| A4 | docker-compose.yml 片段（movie-agent 服务定义） | 0.5d | A3 | 可 compose 启动 |
| A5 | 基本集成测试（curl 调用 API 端点） | 1d | A4 | 验证报告 |

**验收标准**：
- `docker-compose up kais-movie-agent` → 服务在 8001 端口就绪
- `POST /api/v1/pipeline/run` 可启动管线（同步模式）
- `GET /health` 返回 200

**依赖**：无外部依赖，可立即开始。

### 7.3 Phase B：Skill Router + Phase 映射（1-2 周）

| # | 任务 | 工作量 | 依赖 | 产出 |
|---|------|--------|------|------|
| B1 | 实现 `SkillRouter` 类 | 2d | 无 | `lib/skill-router.js` |
| B2 | 将 phaseHandler 中的条件路由迁移到 Router | 3d | B1 | 路由表注册完成 |
| B3 | 实现 `PHASES_V6` 数组（11→8 映射） | 2d | 无 | `lib/pipeline-v6.js` |
| B4 | 新增 Phase 7（delivery）phaseHandler | 1d | B3 | `lib/phases/delivery.js` |
| B5 | 回归测试（完整管线 PHASE 0~7） | 2d | B1-B4 | 测试报告 |

**验收标准**：
- `router.route('image_generate', params)` → 正确路由到 gold-team 或即梦
- 8 Phase 管线可顺序执行，审核门正确触发
- Phase 7 导出交付可生成 Git 快照

**依赖**：Phase A 完成（需要 HTTP 包装层）。

### 7.4 Phase C：Jellyfish 集成 + 审核升级（2-3 周）

| # | 任务 | 工作量 | 依赖 | 产出 |
|---|------|--------|------|------|
| C1 | 实现 `JellyfishAdapter`（资产/状态/任务/快照） | 3d | Jellyfish API spec | `lib/jellyfish-adapter.js` |
| C2 | AssetBus → Jellyfish 资产迁移 | 2d | C1 | 双写验证通过 |
| C3 | .pipeline-state.json → Jellyfish 状态迁移 | 1d | C1 | 状态持久化切换 |
| C4 | 实现 `QualityGateV2`（三级闸门） | 2d | C1 | `lib/quality-gate-v2.js` |
| C5 | `ReviewPlatformClientV2` 适配 | 1d | C4 | `lib/review-platform-client-v2.js` |
| C6 | 子 Skill 解耦（Layer 1：内嵌库） | 2d | B1 | 8 个 skill 改为 import |
| C7 | 子 Skill 解耦（Layer 2：Python 子进程） | 1d | A3 | story-score + anatomy-guard |
| C8 | HermesClient 实现 + LLM 迁移 | 2d | C1 | `lib/hermes-client.js` |
| C9 | 端到端测试 | 2d | C1-C8 | 全流程验证 |

**验收标准**：
- 管线状态通过 Jellyfish API 持久化，容器重启可恢复
- 三级审核闸门正常工作（自动通过/人工审核/自动驳回）
- 所有 14 个子 Skill 解耦为三层架构
- LLM 调用通过 Hermes 路由

**依赖**：
- Phase B 完成（需要 Router 和 Phase 映射）
- **Jellyfish API spec 已定义**（kais-core-backend Phase 2 完成）
- gold-team REST API 就绪（Phase 1 完成）

### 7.5 Phase D：生产化（1-2 周）

| # | 任务 | 工作量 | 依赖 | 产出 |
|---|------|--------|------|------|
| D1 | 异步执行（Worker threads） | 2d | Phase A | 长管线非阻塞执行 |
| D2 | SQLite 本地缓存层（防抖/离线） | 2d | C3 | 本地状态缓存 |
| D3 | 结构化日志（JSON → stdout） | 1d | 无 | 日志规范 |
| D4 | Prometheus metrics（可选） | 1d | 无 | `/metrics` 端点 |
| D5 | docker-compose 生产化（资源限制、健康检查） | 1d | D1-D4 | 生产级 compose |

**验收标准**：
- 长管线（30min+）不阻塞 HTTP 服务
- Docker 健康检查 + 自动重启
- 日志可通过 Docker logs 查看

**依赖**：Phase C 完成。

### 7.6 依赖关系图

```
Phase A ──────────────────────────────────────────────────────
  A1(server.js) ──► A2(合并callback) ──► A3(Dockerfile)
                                              │
                                              ▼
Phase B ──────────────────────────────────────────────────────
  B1(SkillRouter) ──► B2(路由迁移) ──────────► B5(回归测试)
  B3(Phase映射) ──► B4(delivery handler) ────────┘
                                              │
                                              ▼ (需要 Jellyfish API)
Phase C ──────────────────────────────────────────────────────
  C1(JellyfishAdapter) ──► C2(资产迁移) ──► C3(状态迁移)
       │                   C6(子Skill Layer1)
       │                   C7(子Skill Layer2)
       └──► C8(HermesClient) ──► C4(QualityGateV2) ──► C5(ReviewV2)
                                                                  │
                                                                  ▼
Phase D ──────────────────────────────────────────────────────
  D1(异步执行) ──► D2(SQLite缓存) ──► D5(生产化compose)
  D3(结构化日志)  D4(Prometheus) ──────────────┘
```

### 7.7 与全局迁移计划的对齐

根据 `docs/architecture.md` §6.2 全局迁移计划：

| 全局 Phase | 时间 | movie-agent 对应 |
|-----------|------|-----------------|
| **Phase 0** (Week 1-2) | 归档基础 | — （无需参与） |
| **Phase 1** (Week 3-5) | gold-team 统一 | movie-agent **Phase A** 可并行开始 |
| **Phase 2** (Week 5-7) | core-backend 改造 | movie-agent **Phase B** 可并行开始 |
| **Phase 3** (Week 7-10) | movie-agent Docker 化 | movie-agent **Phase C** 开始（依赖 Phase 1+2） |
| **Phase 4** (Week 10-12) | 集成完善 | movie-agent **Phase D** + 全栈测试 |

**movie-agent 改造总工期**：约 6-9 周（Week 3 ~ Week 12），与全局计划对齐。

### 7.8 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| Jellyfish API spec 延迟 | Phase C 阻塞 | 高 | Phase A/B 不依赖 Jellyfish，先行推进；用 mock 验证 Adapter 接口 |
| 子 Skill 解耦复杂度 | Phase C 延期 | 中 | 按优先级分批：先 Layer 1（简单），再 Layer 2/3 |
| 11→8 Phase 合并引入 bug | 管线中断 | 低 | 保持 phaseHandler 不变，仅在编排层合并；充分回归测试 |
| Worker threads 稳定性 | 异步执行异常 | 中 | Phase A 先保持同步，Phase D 再引入异步 |
| 审核回调可靠性 | 审核结果丢失 | 低 | HMAC 验证 + 重试机制 + 审核状态持久化 |

---

## 附录 A：文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| **新增** | `server.js` | REST API 入口 |
| **新增** | `Dockerfile` | Docker 镜像定义 |
| **新增** | `lib/pipeline-v6.js` | PHASE 0~7 定义和编排 |
| **新增** | `lib/pipeline-worker.js` | Worker thread 执行器 |
| **新增** | `lib/skill-router.js` | 生成引擎路由 |
| **新增** | `lib/skill-executor.js` | 子 Skill 统一调度 |
| **新增** | `lib/jellyfish-adapter.js` | Jellyfish 后端适配 |
| **新增** | `lib/hermes-client.js` | LLM 统一调用 |
| **新增** | `lib/quality-gate-v2.js` | 三级审核闸门 |
| **新增** | `lib/review-platform-client-v2.js` | 审核 API 适配 |
| **新增** | `lib/phases/delivery.js` | Phase 7 导出交付 |
| **新增** | `lib/asset-store.js` | 统一资产存储接口 |
| **新增** | `lib/skills/*.js` | 子 Skill 内嵌库模块 |
| **修改** | `lib/pipeline.js` | 注入 Router/Adapter/Gate，保持核心逻辑不变 |
| **修改** | `lib/phases/index.js` | 路由调用改为 Router.route() |
| **废弃** | `bin/callback-server.js` | 功能合并到 server.js |
| **保留** | `lib/review-platform-client.js` | 降级备用，直到 V2 验证通过 |
| **保留** | `lib/gold-team-client.js` | 注册为 Router handler，保留降级能力 |
| **保留** | `lib/asset-bus.js` | 降级备用（`STORAGE_MODE=file`） |

## 附录 B：环境变量

```bash
# 服务端口
PORT=8001

# Jellyfish (kais-core-backend)
CORE_BACKEND_URL=http://kais-core-backend:8000
JELLYFISH_API_KEY=xxx

# Gold-Team
GOLD_TEAM_URL=http://kais-gold-team:8002

# Review Platform
REVIEW_PLATFORM_URL=http://kais-review-platform:8090
HMAC_SECRET=xxx

# Telegram
TELEGRAM_BOT_TOKEN=xxx

# LLM (降级用，Hermes 不可用时)
LLM_API_KEY=xxx

# Blender (Layer 3 远程)
BLENDER_API_URL=http://192.168.71.166:8080

# 存储模式
STORAGE_MODE=file|jellyfish    # 默认 file，Phase C 后切 jellyfish

# GPU 回调（自动生成）
GPU_CALLBACK_URL=http://kais-movie-agent:8001/api/v1/gpu/callback
```
