# kais-movie-agent 深度审计报告

> 审计日期: 2026-05-23  
> 仓库: `/home/kai/.openclaw/workspace/skills/kais-movie-agent` (v4.1.0)  
> 对比基准: Notion V6.0 Final Architecture 目标架构

---

## 一、现状概览

### 当前代码结构

```
kais-movie-agent/              # OpenClaw skill 形式
├── SKILL.md                   # skill 描述 + 完整文档（~500行）
├── package.json               # v4.1.0, ESM, 无 npm 依赖
├── lib/
│   ├── pipeline.js            # 核心编排器（~350行），PHASES 数组定义 11 Phase
│   ├── phases/index.js        # phaseHandlers（before/after 钩子 + Gold-Team 集成）
│   ├── review-platform-client.js  # 审核平台 HTTP 客户端（HMAC + 降级容错）
│   ├── gold-team-client.js    # GPU 集群客户端（submitTask/waitForTask/ping）
│   ├── asset-bus.js           # 跨 Phase 资产总线（.pipeline-assets/ 读写）
│   ├── quality-gate.js        # 质量门控（6维度 + 平台预设）
│   ├── git-stage-manager.js   # Git 版本管理（每 Phase checkpoint）
│   ├── interactive-review.js  # 本地 HTTP 审核页面
│   ├── jimeng-client.js       # 即梦 API 客户端
│   ├── prompt-injector.js     # 视觉约束注入器
│   ├── 1st-director.js        # 四维蓝图生成
│   ├── llm.js                 # LLM 调用封装
│   ├── hooks/                 # 8 个 hook 模块（blueprint/quality/dna/pose/story-score/topic/audience）
│   └── scripts/               # 4 个 Python 脚本（线稿/渲染/评价/解剖检测）
├── bin/
│   ├── callback-server.js     # 回调服务器（审核 + GPU 任务回调）
│   ├── pipeline.js            # CLI 入口
│   └── git-stage.js           # Git 管理 CLI
├── shared/
│   └── hmac_node.js           # HMAC 签名工具
└── references/                # 文档（pipeline-flow/scenario-schema/api-usage）
```

### 当前 11 Phase 管线

| # | Phase ID | 名称 | 审核门 | 主要集成 |
|---|----------|------|--------|---------|
| 1 | requirement | 需求确认 | ❌ | 1st-director, audience-match, topic-generation |
| 2 | art-direction | 美术方向 | ✅ | FLUX (Gold-Team) / 即梦 API |
| 3 | character | 角色设计 | ✅ | DNA 卡注册, pose-reference |
| 4 | scenario | 剧本编写 | ✅ | story-score, audience-analysis |
| 5 | voice | 配音 | ✅ | CosyVoice (Gold-Team) / GLM-TTS |
| 6 | storyboard | 分镜板 | ✅ | shot-poses |
| 7 | scene | 场景图 | ✅ | DNA 注册, 线稿管线 |
| 8 | camera-preview | 视频预览 | ✅ | WAN 2.1 preview (Gold-Team) / Seedance |
| 9 | camera-final | 正式视频 | ✅ | WAN 2.1 final (Gold-Team) / Seedance + PromptInjector |
| 10 | post-production | 后期合成 | ❌ | BGM (ACE-Step), SFX |
| 11 | quality-gate | 质量门控 | ❌ (auto) | 6维度 + story-score 注入 |

### 关键依赖关系

- **无 npm 依赖**：零外部包，全部用原生 `fetch` / `node:http` / `node:fs`
- **运行时依赖**：即梦 API（HTTP）、Gold-Team GPU 集群（HTTP）、智谱 GLM API（HTTP）、Telegram Bot API
- **文件系统耦合**：通过 `.pipeline-state.json` + `.pipeline-assets/` 做状态持久化和资产传递
- **子 Skill 14 个**：symlink 到 workspace skills/，由 OpenClaw agent 调度

---

## 二、V6.0 目标架构 vs 现状：6 大差距分析

### 差距 1：运行时形态 — OpenClaw Skill vs 独立 Docker 服务

| 维度 | 现状 | V6.0 目标 |
|------|------|-----------|
| 运行时 | OpenClaw skill，被 agent 通过 exec/browser 调用 | 独立 Docker 容器，REST API 端口 8001 |
| 入口 | `new Pipeline(config)` + agent 脚本编排 | HTTP API：`POST /api/v1/pipeline/run` |
| 状态存储 | 文件系统 `.pipeline-state.json` | 数据库（SQLite / PostgreSQL）或 Redis |
| 生命周期 | 由 OpenClaw agent 进程控制 | Docker 容器生命周期，systemd/K8s 编排 |
| 配置 | 构造函数传入 config 对象 | 环境变量 + 配置文件 + HTTP API |

**差距评估：大。** 整个运行时形态需要重构。pipeline.js 当前是库模式（`import + new Pipeline()`），需要包装成 HTTP 服务器。

### 差距 2：状态机 — 11 Phase vs PHASE 0~7

| 维度 | 现状 | V6.0 目标 |
|------|------|-----------|
| 阶段数 | 11 个 Phase，线性执行 | 8 个 Phase (0-7)，含条件分支和并行 |
| 状态模型 | `completed/failed/awaiting_review` 三个状态 | 完整状态机：`idle→running→reviewing→approved/rejected→completed→failed` |
| 分支逻辑 | 无分支，线性顺序执行 | 质量闸门可触发重试/降级/分支 |
| 并行 | 无（顺序执行） | 支持并行生成（多候选同时产出） |

**差距评估：中。** 阶段可以合并映射，但状态机需要从简单三态升级为完整 FSM。

### 差距 3：Skill Router — 不存在

| 维度 | 现状 | V6.0 目标 |
|------|------|-----------|
| 路由 | 无路由层，Gold-Team Client 硬编码 | Skill Router 路由到 toonflow/jellyfish/hermes/gold-team |
| 引擎选择 | `if (config.goldTeam?.enableFluxArt)` 条件判断 | 路由表 + 优先级 + 健康检查 + 自动降级 |
| 新引擎接入 | 需改 phaseHandlers 代码 | 新引擎注册到 Router 即可 |

**差距评估：大。** 完全不存在路由层，当前是分散在各 phaseHandler 中的 `if/else` 硬编码。

### 差距 4：审核系统 — ReviewPlatformClient 单体

| 维度 | 现状 | V6.0 目标 |
|------|------|-----------|
| 审核客户端 | 单一 ReviewPlatformClient | 集成到状态机，作为标准闸门 |
| 降级策略 | fail-open（不可用→AUTO 通过） | 分级降级：重试→本地审核→AUTO |
| 审核类型 | 单一类型（pipeline_phase） | 多类型（自动审核/人工审核/AI 审核） |
| 回调 | callback-server.js 独立进程 | 内置到主服务 |

**差距评估：中。** ReviewPlatformClient 功能完整，但需要升级为闸门模式并内置化。

### 差距 5：Jellyfish (kais-core-backend) 集成 — 不存在

| 维度 | 现状 | V6.0 目标 |
|------|------|-----------|
| 后端集成 | 无，纯文件系统 | 通过 Jellyfish（kais-core-backend）REST API |
| 资产管理 | AssetBus（本地文件系统） | Jellyfish 资产管理服务 |
| 任务队列 | 无队列，同步执行 | Jellyfish 任务队列 |

**差距评估：大。** 当前零集成，需要设计完整的 API 对接层。

### 差距 6：子 Skill 管理

| 维度 | 现状 | V6.0 目标 |
|------|------|-----------|
| 调度方式 | 14 个子 skill symlink，agent 调用 | Docker 环境内独立调度 |
| 依赖 | OpenClaw runtime | 独立运行 |

**差距评估：中。** 子 skill 需要从 OpenClaw 解耦，改为 HTTP API 调用或内嵌库。

---

## 三、迁移方案

### 3.1 从 OpenClaw Skill 到 Docker 服务的迁移路径

#### Phase 1：HTTP 包装层（最小改动）

```
当前:  agent → import Pipeline → new Pipeline(config).run()
目标:  HTTP client → POST /api/v1/pipeline/run → Docker:8001
```

**具体步骤：**

1. **创建 `server.js`**（基于 `node:http`，零依赖原则不变）：
   ```js
   // server.js — REST API 包装
   import { createServer } from 'node:http';
   import { Pipeline } from './lib/pipeline.js';
   
   const server = createServer(async (req, res) => {
     if (req.url === '/health' && req.method === 'GET') {
       res.writeHead(200); res.end('ok'); return;
     }
     if (req.url === '/api/v1/pipeline/run' && req.method === 'POST') {
       const config = await parseBody(req);
       const pipeline = new Pipeline(config);
       const result = await pipeline.run(config.phasesConfig);
       json(res, result); return;
     }
     if (req.url.startsWith('/api/v1/pipeline/resume') && req.method === 'POST') {
       // ... resume 逻辑
     }
     if (req.url === '/api/v1/pipeline/status' && req.method === 'GET') {
       // ... status 查询
     }
   });
   server.listen(8001);
   ```

2. **API 端点设计**：
   - `POST /api/v1/pipeline/run` — 启动新管线
   - `POST /api/v1/pipeline/resume` — 从断点恢复
   - `GET  /api/v1/pipeline/status` — 查询状态
   - `POST /api/v1/pipeline/cancel` — 取消管线
   - `GET  /api/v1/pipeline/phases` — 获取 Phase 列表
   - `POST /api/v1/reviews/callback` — 审核回调（合并 callback-server.js）
   - `POST /api/v1/gpu/callback` — GPU 任务回调

3. **Dockerfile**：
   ```dockerfile
   FROM node:22-slim
   WORKDIR /app
   COPY . .
   RUN apt-get update && apt-get install -y python3 ffmpeg git
   EXPOSE 8001
   CMD ["node", "server.js"]
   ```

4. **环境变量**：沿用现有环境变量，新增 `PORT=8001`

#### Phase 2：状态持久化升级

当前 `.pipeline-state.json` 替换方案：

| 选项 | 优点 | 缺点 | 推荐 |
|------|------|------|------|
| SQLite | 零依赖（better-sqlite3） | 需要额外依赖 | ✅ 推荐 |
| 文件系统（保持） | 零改动 | 并发安全性差 | 短期可行 |
| Redis | 高性能 | 新增依赖 | 后期可选 |

**推荐方案**：先保持文件系统（验证 API 可用），Phase 2 迁移到 SQLite。

#### Phase 3：异步执行 + 任务队列

当前 `pipeline.run()` 是同步阻塞的。Docker 服务需要支持：

```js
// 长任务 → 返回 jobId → 轮询/SSE/WebSocket 获取进度
POST /api/v1/pipeline/run
→ { jobId: "xxx", status: "running" }

GET /api/v1/pipeline/jobs/xxx
→ { jobId: "xxx", status: "running", currentPhase: "scene", progress: 63 }
```

**实现方案**：用 `node:worker_threads` 或子进程执行 pipeline，主线程处理 HTTP。

---

### 3.2 Skill Router 实现方案

#### 设计

```js
// lib/skill-router.js
class SkillRouter {
  constructor() {
    this.routes = new Map(); // taskType → [RouteEntry]
  }
  
  register(taskType, handler, { priority = 5, healthCheck, fallback }) {
    const entries = this.routes.get(taskType) || [];
    entries.push({ handler, priority, healthCheck, fallback });
    entries.sort((a, b) => b.priority - a.priority);
    this.routes.set(taskType, entries);
  }
  
  async route(taskType, params) {
    const entries = this.routes.get(taskType);
    if (!entries) throw new Error(`No route for: ${taskType}`);
    
    for (const entry of entries) {
      // 健康检查
      if (entry.healthCheck && !(await entry.healthCheck())) {
        console.warn(`[Router] ${taskType} → ${entry.handler.name} 不可用，尝试下一个`);
        continue;
      }
      try {
        return await entry.handler(params);
      } catch (err) {
        console.warn(`[Router] ${taskType} → ${entry.handler.name} 失败: ${err.message}`);
        if (entry.fallback) continue; // 尝试降级
        throw err;
      }
    }
    throw new Error(`All routes failed for: ${taskType}`);
  }
}
```

#### 路由表

| TaskType | 优先级路由 | 说明 |
|----------|-----------|------|
| `image_generate` | toonflow → gold-team/FLUX → 即梦 API | 美术方向/场景图 |
| `image_refine` | toonflow → gold-team/FLUX → 即梦 API | 图像精修 |
| `video_generate` | toonflow → gold-team/WAN → 即梦 Seedance | 视频生成 |
| `video_preview` | toonflow → gold-team/WAN-preview → 即梦 Seedance | 快速预览 |
| `tts_generate` | gold-team/CosyVoice → 智谱 GLM-TTS → 占位 | 语音合成 |
| `voice_clone` | gold-team/CosyVoice → 跳过 | 声音克隆 |
| `music_generate` | gold-team/ACE-Step → 跳过 | BGM 生成 |
| `sfx_generate` | gold-team → 跳过 | 音效生成 |
| `lip_sync` | gold-team → 跳过 | 口型同步 |
| `text_llm` | jellyfish → OpenClaw LLM | 文本生成 |
| `text_review` | jellyfish → 本地 AI scorer | AI 审核 |

#### 与现有代码的对应

当前 phaseHandlers 中的 `_makeGtClient(pipeline)` + 条件判断 → 替换为：

```js
// 当前（硬编码）
if (pipeline.config.goldTeam?.enableFluxArt) {
  const gtClient = _makeGtClient(pipeline);
  // ... Gold-Team FLUX 逻辑
}
// 即梦降级链内嵌在各 phaseHandler

// 目标（路由化）
const result = await router.route('image_generate', {
  prompt, style, numImages: 3, workdir: pipeline.workdir,
});
```

---

### 3.3 PHASE 0~7 与当前 11 Phase 的映射

| V6.0 Phase | 名称 | 映射到的当前 Phase | 合并/变更说明 |
|------------|------|-------------------|-------------|
| **0** | 需求确认 + 预研 | Phase 1 (requirement) | 保留。1st-director + audience-match + topic-generation |
| **1** | 美术方向 + 角色 | Phase 2 (art-direction) + Phase 3 (character) | **合并**。美术方向确立后立即设计角色，减少审核轮次 |
| **2** | 剧本 + 配音 | Phase 4 (scenario) + Phase 5 (voice) | **合并**。剧本完成后立即配音试听，统一审核 |
| **3** | 分镜 + 场景 | Phase 6 (storyboard) + Phase 7 (scene) | **合并**。分镜板和场景图互为约束，统一审核 |
| **4** | 视频生成 | Phase 8 (camera-preview) + Phase 9 (camera-final) | **合并**。预览→正式生成是一个连续流程 |
| **5** | 后期合成 | Phase 10 (post-production) | 保留。BGM + SFX + 合成 |
| **6** | 质量审核 | Phase 11 (quality-gate) | 保留。升级为正式闸门（触发/通过/驳回） |
| **7** | 导出交付 | **新增** | 当前无对应。需新增：编码、元数据、多平台适配、存储 |

**关键变更：**

1. **审核门从 9 个减少到 4-5 个**（Phase 0~3 各一个 + Phase 6 质量闸门）
2. **Phase 7（导出）完全新增**：当前管线到 quality-gate 就结束了，缺少正式的导出交付阶段
3. **每个 Phase 内部保持原子性**：合并只是审核粒度变化，内部子步骤不变

**映射代码改动：**

```js
// 当前 PHASES 数组（11 个）→ V6.0 PHASES 数组（8 个）
const PHASES_V6 = [
  { id: 'requirement', name: '需求确认', stages: ['requirement'], review: false },
  { id: 'art-character', name: '美术方向与角色', stages: ['art-direction', 'character'], review: true },
  { id: 'script-voice', name: '剧本与配音', stages: ['scenario', 'voice'], review: true },
  { id: 'storyboard-scene', name: '分镜与场景', stages: ['storyboard', 'scene'], review: true },
  { id: 'video', name: '视频生成', stages: ['camera-preview', 'camera-final'], review: true },
  { id: 'post-production', name: '后期合成', stages: ['post-production'], review: false },
  { id: 'quality-gate', name: '质量审核', stages: ['quality-gate'], review: false, autoEvaluate: true },
  { id: 'delivery', name: '导出交付', stages: ['delivery'], review: false },
];
```

---

### 3.4 与 kais-core-backend（Jellyfish）的集成接口

#### 需要对接的 Jellyfish API

| 功能 | 当前实现 | Jellyfish API | 优先级 |
|------|---------|--------------|--------|
| 资产存储 | AssetBus（本地文件） | `POST /api/v1/assets` / `GET /api/v1/assets/:id` | P0 |
| 任务队列 | 无（同步执行） | `POST /api/v1/tasks` / WebSocket 通知 | P1 |
| 管线状态 | `.pipeline-state.json` | `PUT /api/v1/pipelines/:id/state` | P0 |
| 审核流程 | ReviewPlatformClient | `POST /api/v1/reviews` + 回调 | P1 |
| 生成引擎路由 | GoldTeamClient 硬编码 | Jellyfish Skill Router | P0 |

#### 集成层设计

```js
// lib/jellyfish-adapter.js
class JellyfishAdapter {
  constructor({ baseUrl, apiKey }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }
  
  // 替代 AssetBus
  async writeAsset(name, data) { /* POST /api/v1/assets */ }
  async readAsset(name) { /* GET /api/v1/assets/:name */ }
  
  // 替代直接 GoldTeamClient 调用
  async submitTask(taskType, params) { /* POST /api/v1/tasks */ }
  async waitForTask(taskId) { /* 轮询 /api/v1/tasks/:id 或 WebSocket */ }
  
  // 替代 .pipeline-state.json
  async saveState(pipelineId, state) { /* PUT /api/v1/pipelines/:id/state */ }
  async loadState(pipelineId) { /* GET /api/v1/pipelines/:id/state */ }
  
  // 替代 ReviewPlatformClient
  async submitReview(params) { /* POST /api/v1/reviews */ }
}
```

#### 迁移策略

1. **Adapter 模式**：创建 JellyfishAdapter，与现有 AssetBus/ReviewPlatformClient 实现相同接口
2. **渐进替换**：pipeline.js 中注入 adapter，通过配置选择本地模式或 Jellyfish 模式
3. **双写阶段**：初期同时写本地文件 + Jellyfish API，验证一致性

---

### 3.5 审核流程升级

#### 当前架构

```
Phase 完成 → Pipeline._runRemoteReview() → ReviewPlatformClient.submitReview()
  → 保存 awaiting_review 状态 → 退出进程
  → callback-server.js 收到回调 → 验证 HMAC → spawn 新进程恢复管线
```

#### V6.0 目标架构

```
Phase 完成 → 质量闸门(Gate)评估
  → 自动审核通过？→ 直接进入下一 Phase
  → 需要人工审核？→ 暂停 → 通知审核人 → 等待回调
  → 审核驳回？→ 重试/降级/终止
```

#### 升级方案

```js
// lib/quality-gate-v2.js
class QualityGateV2 {
  constructor(config) {
    this.rules = config.rules || {}; // 每个 Phase 的闸门规则
    this.reviewClient = new ReviewPlatformClient(config.reviewPlatform);
    this.jellyfish = new JellyfishAdapter(config.jellyfish);
  }
  
  async evaluate(phase, result) {
    // 1. 自动评估（AI scorer + story-score + 规则引擎）
    const autoScore = await this._autoEvaluate(phase, result);
    
    // 2. 根据分数决定路由
    if (autoScore.score >= this.rules[phase.id]?.autoPassThreshold ?? 85) {
      return { action: 'pass', score: autoScore };
    }
    
    if (autoScore.score < this.rules[phase.id]?.autoFailThreshold ?? 30) {
      return { action: 'fail', score: autoScore, reason: 'auto-fail threshold' };
    }
    
    // 3. 中间分数 → 人工审核
    return { action: 'review', score: autoScore, reviewId: await this._submitReview(phase, result) };
  }
}
```

**关键改进：**
- **三级闸门**：自动通过 → 人工审核 → 自动驳回（当前只有二态：通过/等待）
- **闸门内置**：不再需要独立 callback-server.js，审核回调直接走主服务 API
- **降级链升级**：重试(3次) → 本地审核页面 → AUTO 通过（当前只有直接 AUTO）

---

### 3.6 子 Skill 在 Docker 环境下的方案

#### 当前 14 个子 Skill

| Skill | 调用方式 | Docker 方案 |
|-------|---------|------------|
| deep-research | agent 调度 | HTTP API 包装 或 内嵌为库 |
| kais-topic-selector | agent 调度 | 内嵌为库（纯 LLM 调用） |
| kais-audience | agent 调度 | 内嵌为库 |
| kais-art-direction | agent 调度 | 内嵌为库 |
| kais-character-designer | agent 调度 | 内嵌为库 |
| kais-blender-pose | agent 调度 + Blender API | 保持 HTTP 调用（本机 192.168.71.166） |
| kais-scenario-writer | agent 调度 | 内嵌为库 |
| kais-voice | Gold-Team / GLM API | 已在 phaseHandler 中，无需单独 skill |
| kais-storyboard-designer | agent 调度 | 内嵌为库 |
| kais-scene-designer | agent 调度 | 内嵌为库 |
| kais-camera | Gold-Team / 即梦 API | 已在 phaseHandler 中 |
| kais-story-score | Python CLI | 内嵌为子进程调用 |
| kais-anatomy-guard | Python CLI | 内嵌为子进程调用 |
| kais-review-page | HTML 生成 | 内嵌为库 |

#### 方案：三层分类

**Layer 1 — 内嵌库**（纯 JS/LLM 调用，无特殊依赖）：
- topic-selector, audience, art-direction, character-designer, scenario-writer, storyboard-designer, scene-designer, review-page
- 方式：直接 import，不通过 OpenClaw agent 调度

**Layer 2 — 子进程**（Python 脚本）：
- story-score, anatomy-guard
- 方式：`child_process.execFile('python3', ['lib/scripts/xxx.py', ...])`

**Layer 3 — 远程 HTTP**（需要 GPU 或特殊环境）：
- blender-pose（本机 192.168.71.166 Blender API）
- gold-team engines（FLUX/WAN/CosyVoice/ACE-Step）
- 方式：通过 Skill Router 路由到对应服务

#### 从 OpenClaw 解耦的关键改动

当前 skill 通过 `SKILL.md` 描述 + OpenClaw agent 解析调度。Docker 服务模式下：

```js
// lib/skill-executor.js
class SkillExecutor {
  constructor(router) {
    this.router = router;
    this.registry = new Map(); // skillName → { type: 'lib'|'process'|'remote', handler }
  }
  
  register(name, handler, type = 'lib') {
    this.registry.set(name, { type, handler });
  }
  
  async execute(name, params) {
    const skill = this.registry.get(name);
    if (!skill) throw new Error(`Unknown skill: ${name}`);
    
    switch (skill.type) {
      case 'lib': return skill.handler(params);
      case 'process': return this._execProcess(skill.handler, params);
      case 'remote': return this.router.route(name, params);
    }
  }
}
```

---

## 四、实施路线图

### Phase A：HTTP 包装 + Docker 化（1-2 周）

| 任务 | 工作量 | 依赖 |
|------|--------|------|
| 创建 `server.js` REST API（/run, /resume, /status, /health） | 2d | 无 |
| 合并 callback-server.js 到主服务 | 1d | server.js |
| 编写 Dockerfile | 0.5d | server.js |
| docker-compose.yml（movie-agent + callback） | 0.5d | Dockerfile |
| 基本集成测试 | 1d | 全部 |

### Phase B：Skill Router + Phase 映射（1-2 周）

| 任务 | 工作量 | 依赖 |
|------|--------|------|
| 实现 SkillRouter 类 | 2d | 无 |
| 将 phaseHandler 中的条件路由迁移到 Router | 3d | SkillRouter |
| PHASE 0~7 映射（合并 11→8） | 2d | 无 |
| 新增 Phase 7（导出交付） | 1d | Phase 映射 |
| 回归测试 | 2d | 全部 |

### Phase C：Jellyfish 集成 + 审核升级（2-3 周）

| 任务 | 工作量 | 依赖 |
|------|--------|------|
| JellyfishAdapter 实现 | 3d | Jellyfish API spec |
| AssetBus → Jellyfish 迁移 | 2d | JellyfishAdapter |
| QualityGateV2（三级闸门） | 2d | 无 |
| ReviewPlatformClient 升级 | 1d | QualityGateV2 |
| 子 Skill 解耦（Layer 1/2/3） | 3d | SkillRouter |
| 端到端测试 | 2d | 全部 |

### Phase D：生产化（1-2 周）

| 任务 | 工作量 | 依赖 |
|------|--------|------|
| SQLite 状态持久化 | 2d | Phase A |
| 异步执行（Worker threads） | 2d | Phase A |
| Prometheus metrics | 1d | Phase A |
| 日志结构化（JSON → 结构化日志） | 1d | Phase A |
| K8s manifests / docker-compose 生产化 | 1d | Phase A |

**总预估：5-9 周**

---

## 五、风险与建议

### 高风险项

1. **子 Skill 解耦复杂度**：14 个 skill 的调用方式各异（LLM、Python、Blender API、HTTP），统一为库/进程/远程三种模式需要逐一验证
2. **Jellyfish API 依赖**：kais-core-backend 的 API spec 尚未确定，Adapter 实现可能需要反复调整
3. **审核回调可靠性**：当前 callback-server.js 依赖进程 spawn 恢复管线，Docker 内需要用不同的恢复机制

### 建议

1. **渐进式迁移**：先完成 Phase A（HTTP 包装 + Docker），验证基本管线可用后再推进 Router 和 Jellyfish 集成
2. **保持 OpenClaw 兼容**：Docker API 设计应允许 OpenClaw agent 作为客户端调用，而不是完全替代
3. **双模式运行**：保持 `Pipeline` 类的库调用方式不变，Docker server 只是 HTTP 包装层，降低迁移风险
4. **Phase 合并谨慎推进**：11→8 的映射可以先在 API 层面做逻辑合并，不急于修改底层 phaseHandlers

---

## 六、代码质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码结构 | ⭐⭐⭐⭐ | pipeline.js 编排器职责清晰，phaseHandlers 模块化良好 |
| 错误处理 | ⭐⭐⭐⭐ | 全链路 try/catch，降级策略完善 |
| 降级容错 | ⭐⭐⭐⭐⭐ | Gold-Team/ReviewPlatform/即梦 三层降级，非常健壮 |
| 状态管理 | ⭐⭐⭐ | 文件系统状态简单有效，但并发安全性不足 |
| 可测试性 | ⭐⭐⭐ | 纯函数 + 依赖注入设计良好，但文件系统耦合降低可测试性 |
| 文档质量 | ⭐⭐⭐⭐⭐ | SKILL.md + references/ 文档非常完善 |
| Docker 就绪度 | ⭐ | 需要完整重构 |
| API 设计 | ⭐⭐ | 无 REST API，需从零建设 |

**总评**：代码质量高，架构设计合理。主要差距在运行时形态（skill→service）和路由层缺失，而非代码质量问题。迁移路径清晰，风险可控。
