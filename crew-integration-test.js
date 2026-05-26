module.exports = {
  name: "kais-integration-test",
  goal: "全自动化联调集成测试：启动环境 → 健康检查 → 接口契约验证 → 全链路 Pipeline 测试 → 结果报告",
  workdir: "/home/kai/workspace/kais-aigc-platform",
  project: { lang: "node" },
  github: "kais-aigc-platform",

  steps: [
    // ─── Phase 0: 环境准备 ───
    {
      id: "env-bootstrap",
      skill: "coding-agent",
      params: {
        task: `环境准备与基线确认。

## 工作目录
/home/kai/workspace/kais-aigc-platform

## 步骤

1. **检查所有服务运行状态**
   运行 \`docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"\` 确认以下服务在运行：
   - kais-core-backend (:8000)
   - kais-movie-agent (:8001)
   - kais-gold-team (:8002)
   - kais-review-platform (:8090 映射到容器 8090)
   - postgres (:5490 映射到容器 5432)
   - redis (:6390 映射到容器 6379)

2. **健康检查** — 逐个 curl health 端点，记录响应状态码和响应体
   - \`curl -s http://localhost:8000/health\`
   - \`curl -s http://localhost:8001/health\`
   - \`curl -s http://localhost:8002/health\`
   - \`curl -s http://localhost:8090/health\`

3. **检查 ComfyUI** — \`curl -s http://localhost:8188/system_stats\` (systemd 管理，非 Docker)

4. **记录基线** — 将所有服务状态写入 /tmp/integration-test-results/00-env-bootstrap.md，格式：
   \`\`\`
   | 服务 | 端口 | 状态 | 响应 |
   |------|------|------|------|
   | core-backend | 8000 | UP/DOWN | {...} |
   ...
   \`\`\`

如果有服务没运行，先尝试 \`docker compose -f docker-compose.v6.yml up -d\` 启动。如果启动失败，记录失败原因并继续（后续测试标记为 SKIP）。`,
      },
      output: "/tmp/integration-test-results/00-env-bootstrap.md"
    },

    // ─── Phase 1: gold-team 接口契约测试 ───
    {
      id: "test-gold-team",
      skill: "coding-agent",
      params: {
        task: `gold-team API 接口契约验证。

## 前置条件
- 读取 /tmp/integration-test-results/00-env-bootstrap.md 确认 gold-team 运行中
- 参考 OpenAPI spec: specs/gold-team.openapi.yaml

## 测试用例

### T1: Health 端点
\`\`\`bash
curl -s http://localhost:8002/health | python3 -m json.tool
\`\`\`
验证：status 字段存在，gpu 信息包含 2 张卡

### T2: 引擎列表
\`\`\`bash
curl -s http://localhost:8002/api/v1/engines | python3 -m json.tool
\`\`\`
验证：至少有 mock 引擎，检查 comfyui/tts 引擎状态

### T3: 提交图片任务（正常路径）
\`\`\`bash
curl -s -X POST http://localhost:8002/api/v1/tasks \\
  -H "Content-Type: application/json" \\
  -d '{
    "task_id": "itest-img-'$(date +%s)'",
    "type": "image_draw",
    "priority": "normal",
    "params": {"prompt": "integration test image", "width": 512, "height": 512}
  }' | python3 -m json.tool
\`\`\`
验证：返回 202，status="queued"，有 task_id

### T4: 提交 TTS 任务
\`\`\`bash
curl -s -X POST http://localhost:8002/api/v1/tasks \\
  -H "Content-Type: application/json" \\
  -d '{
    "task_id": "itest-tts-'$(date +%s)'",
    "type": "tts",
    "priority": "normal",
    "params": {"text": "集成测试语音", "voice": "zh-CN-XiaoxiaoNeural"}
  }' | python3 -m json.tool
\`\`\`
验证：返回 202

### T5: 查询任务状态
用 T3 或 T4 返回的 task_id：
\`\`\`bash
curl -s http://localhost:8002/api/v1/tasks/{task_id} | python3 -m json.tool
\`\`\`
验证：有 status 字段 (queued/running/completed/failed)

### T6: 错误路径 — 重复 task_id
用 T3 相同的 task_id 再提交一次：
验证：返回 400 duplicate_task_id

### T7: 错误路径 — priority 类型
提交 priority 为数字 5：
验证：应该被拒绝（FastAPI Pydantic 校验）

### T8: 任务列表
\`\`\`bash
curl -s "http://localhost:8002/api/v1/tasks?limit=5" | python3 -m json.tool
\`\`\`
验证：返回数组，包含刚才的任务

## 输出
将所有测试结果写入 /tmp/integration-test-results/01-gold-team.md，格式：
\`\`\`
| 测试 | 端点 | 期望 | 实际 | 结果 |
|------|------|------|------|------|
| T1 | GET /health | 200 + gpu info | ... | PASS/FAIL |
...
\`\`\`

如果有 FAIL，详细记录请求和响应。`,
      },
      output: "/tmp/integration-test-results/01-gold-team.md"
    },

    // ─── Phase 2: core-backend 接口测试 ───
    {
      id: "test-core-backend",
      skill: "coding-agent",
      params: {
        task: `core-backend API 接口验证。

## 前置条件
- 读取 /tmp/integration-test-results/00-env-bootstrap.md 确认 core-backend 运行中
- 参考 OpenAPI spec: specs/core-backend.openapi.yaml

## 测试用例

### T1: Health
\`\`\`bash
curl -s http://localhost:8000/health | python3 -m json.tool
\`\`\`

### T2: 项目列表
\`\`\`bash
curl -s http://localhost:8000/api/v1/projects | python3 -m json.tool
\`\`\`
验证：返回项目数组，记录第一个项目的 id

### T3: 获取单个项目
用 T2 的项目 id：
\`\`\`bash
curl -s http://localhost:8000/api/v1/projects/{id} | python3 -m json.tool
\`\`\`
验证：有 style, aspect_ratio 等字段

### T4: 获取小说内容（关键 — 双层嵌套验证）
\`\`\`bash
curl -s http://localhost:8000/api/v1/projects/{id}/novel | python3 -m json.tool
\`\`\`
验证：检查返回结构是否是 {data:{data:[...]}} 双层嵌套，还是已修复为单层

### T5: 获取事件列表（关键 — 无 header 行验证）
\`\`\`bash
curl -s http://localhost:8000/api/v1/projects/{id}/events | python3 -m json.tool
\`\`\`
验证：检查事件数据格式（pipe 分隔表格？JSON 数组？有无 header 行？）

### T6: 分镜列表
\`\`\`bash
curl -s http://localhost:8000/api/v1/shots/list/{id} | python3 -m json.tool
\`\`\`

### T7: WebSocket 连接测试（如果支持）
尝试连接 ws://localhost:8000/ws 看是否能握手

## 输出
将所有测试结果写入 /tmp/integration-test-results/02-core-backend.md
特别标注 T4 和 T5 的实际返回结构（这两个是已知坑点）。`,
      },
      output: "/tmp/integration-test-results/02-core-backend.md"
    },

    // ─── Phase 3: movie-agent Pipeline 测试 ───
    {
      id: "test-movie-agent",
      skill: "coding-agent",
      params: {
        task: `movie-agent Pipeline 接口验证。

## 前置条件
- 读取 /tmp/integration-test-results/00-env-bootstrap.md 确认 movie-agent 运行中
- 读取 /tmp/integration-test-results/02-core-backend.md 获取可用项目 id
- 参考 OpenAPI spec: specs/movie-agent.openapi.yaml

## 测试用例

### T1: Health
\`\`\`bash
curl -s http://localhost:8001/health | python3 -m json.tool
\`\`\`

### T2: Pipeline 列表
\`\`\`bash
curl -s http://localhost:8001/api/pipeline/list | python3 -m json.tool
\`\`\`
验证：返回已有的 pipeline 列表

### T3: 启动新 Pipeline（全链路测试核心）
用 core-backend 中找到的项目 id：
\`\`\`bash
curl -s -X POST http://localhost:8001/api/pipeline/start \\
  -H "Content-Type: application/json" \\
  -d '{"project_id": "{从T2获取的id}"}' | python3 -m json.tool
\`\`\`
验证：返回 pipeline_id，状态为 running

### T4: 查询 Pipeline 状态
\`\`\`bash
curl -s http://localhost:8001/api/pipeline/{pipeline_id}/status | python3 -m json.tool
\`\`\`
验证：返回各 phase 的状态（pending/running/completed/failed）

### T5: 等待 Pipeline 完成
轮询 T4（每 10 秒一次，最多 5 分钟），直到所有 phase 为 completed 或有 failed
记录每个 phase 的完成时间和输出

### T6: Pipeline 产出物验证
检查 /mnt/agents/output/ 下是否有对应 pipeline 的产出文件（图片、音频等）

### T7: 错误路径 — 不存在的项目
\`\`\`bash
curl -s -X POST http://localhost:8001/api/pipeline/start \\
  -H "Content-Type: application/json" \\
  -d '{"project_id": "9999999999999"}' | python3 -m json.tool
\`\`\`
验证：返回 404 或错误信息

## 输出
将所有测试结果写入 /tmp/integration-test-results/03-movie-agent.md
特别记录 Pipeline 全链路的每个 phase 耗时和状态。`,
      },
      output: "/tmp/integration-test-results/03-movie-agent.md"
    },

    // ─── Phase 4: review-platform 接口测试 ───
    {
      id: "test-review-platform",
      skill: "coding-agent",
      params: {
        task: `review-platform API 接口验证。

## 前置条件
- 读取 /tmp/integration-test-results/00-env-bootstrap.md 确认 review-platform 运行中
- 参考 OpenAPI spec: specs/review-platform.openapi.yaml
- 注意：当前 review-platform 映射端口是 8091（宿主机）→ 8090（容器）

## 测试用例

### T1: Health
\`\`\`bash
curl -s http://localhost:8091/health | python3 -m json.tool
\`\`\`

### T2: 提交审核（需要 API key）
从 .env 文件读取 REVIEW_API_KEY，或尝试默认值：
\`\`\`bash
# 先检查 .env 中的配置
grep REVIEW /home/kai/workspace/kais-aigc-platform/.env 2>/dev/null

# 提交审核
curl -s -X POST http://localhost:8091/api/v1/reviews \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: {api_key}" \\
  -d '{
    "type": "shot_review",
    "content_ref": "itest-shot-1",
    "metadata": {"phase": "storyboard", "source": "integration-test"},
    "callback_url": "http://kais-movie-agent:8001/api/callbacks/review",
    "priority": "normal"
  }' | python3 -m json.tool
\`\`\`
验证：返回 review_id 或 401（认证问题 — 这是已知 bug #6）

### T3: 查询审核状态
用 T2 返回的 review_id（如果成功）：
\`\`\`bash
curl -s http://localhost:8091/api/v1/reviews/{review_id} \\
  -H "X-API-Key: {api_key}" | python3 -m json.tool
\`\`\`

### T4: 创建 Shot Card
\`\`\`bash
curl -s -X POST http://localhost:8091/api/v1/shots \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: {api_key}" \\
  -d '{
    "project_id": "itest-project",
    "phase": "storyboard",
    "status": "pending",
    "image_url": "https://example.com/test.jpg",
    "metadata": {"source": "integration-test"}
  }' | python3 -m json.tool
\`\`\`

### T5: Canvas 页面
\`\`\`bash
curl -s http://localhost:8091/canvas | head -20
\`\`\`
验证：返回 HTML（Alpine.js + SVG 画布页面）

### T6: 401 认证测试（已知 bug 验证）
不带 API key 请求：
\`\`\`bash
curl -s http://localhost:8091/api/v1/reviews | python3 -m json.tool
\`\`\`
验证：应该返回 401/403

## 输出
将所有测试结果写入 /tmp/integration-test-results/04-review-platform.md
特别标注 401 认证问题的当前状态。`,
      },
      output: "/tmp/integration-test-results/04-review-platform.md"
    },

    // ─── Phase 5: 跨服务集成测试 ───
    {
      id: "test-e2e-flow",
      skill: "coding-agent",
      params: {
        task: `跨服务端到端集成测试。

## 前置条件
- 读取 Phase 1-4 的测试结果，确认所有服务基本可用
- 这是最关键的测试：验证服务间的接口调用链路

## 测试用例

### E2E-1: movie-agent → gold-team 调用链
1. 通过 movie-agent 提交一个包含图片渲染的 pipeline
2. 检查 gold-team 是否收到任务：\`curl http://localhost:8002/api/v1/tasks?limit=3\`
3. 验证任务参数是否正确传递（priority 是字符串、task_type 正确）
4. 等待任务完成，检查产出物

### E2E-2: movie-agent → core-backend 数据拉取
1. 启动 pipeline
2. 查看 movie-agent 日志：\`docker logs --tail 50 kais-movie-agent 2>&1 | grep -E "core-backend|novel|events"\`
3. 验证：
   - novel 数据是否正确 unwrap（没有双层嵌套问题）
   - events 数据是否正确解析（没有 skip header 行问题）

### E2E-3: movie-agent → review-platform 提交审核
1. 如果 E2E-1 产出了图片，尝试提交到 review-platform
2. 验证 API key 认证是否通过（或记录 401 问题）

### E2E-4: ComfyUI 调用链
1. 如果 ComfyUI 可用：\`curl -s http://localhost:8188/system_stats\`
2. 通过 gold-team 提交一个 image_draw 任务
3. 等待 ComfyUI 处理（通过 gold-team 任务状态轮询）
4. 验证输出文件存在

### E2E-5: 已知 Bug 回归测试
验证以下已知问题是否已修复：
- [ ] Bug #1: gold-team priority 字符串 vs 数字
- [ ] Bug #2: task_type 命名 (tts vs tts_generation)
- [ ] Bug #3: API 路径 /api/v1/tasks vs /api/tasks
- [ ] Bug #4: novel 双层嵌套 unwrap
- [ ] Bug #5: events 表格无 header 行
- [ ] Bug #6: review-platform 401 认证
- [ ] Bug #7: ComfyUI 地址 172.17.0.1 vs comfyui

## 输出
将所有 E2E 测试结果写入 /tmp/integration-test-results/05-e2e-flow.md
包含：
- 每个调用链的请求/响应截图
- 已知 Bug 的回归状态
- 发现的新问题`,
      },
      output: "/tmp/integration-test-results/05-e2e-flow.md"
    },

    // ─── Phase 6: 汇总报告 ───
    {
      id: "summary-report",
      skill: "coding-agent",
      params: {
        task: `汇总所有集成测试结果，生成最终报告。

## 步骤

1. 读取 /tmp/integration-test-results/ 下的所有测试文件：
   - 00-env-bootstrap.md
   - 01-gold-team.md
   - 02-core-backend.md
   - 03-movie-agent.md
   - 04-review-platform.md
   - 05-e2e-flow.md

2. 生成汇总报告 /tmp/integration-test-results/SUMMARY.md，包含：

   a. **总览**
   - 测试时间
   - 环境状态（哪些服务在跑）
   - 总通过/失败/跳过数

   b. **各服务测试结果摘要**
   - gold-team: X/Y passed
   - core-backend: X/Y passed
   - movie-agent: X/Y passed
   - review-platform: X/Y passed
   - E2E flow: X/Y passed

   c. **已知 Bug 状态**
   | Bug | 描述 | 状态 |
   |-----|------|------|
   | #1 | priority 字符串 | FIXED/OPEN |
   ...

   d. **新发现的问题**
   每个问题包含：
   - 严重程度 (P0-P3)
   - 描述
   - 复现步骤
   - 建议修复方案

   e. **建议的下一步**
   基于测试结果，列出需要优先修复的问题和改进建议

3. 将报告内容追加到 /home/kai/workspace/kais-aigc-platform/docs/integration-test-report.md（按日期归档）

4. 输出到标准输出供 Telegram 通知`,
      },
      output: "/home/kai/workspace/kais-aigc-platform/docs/integration-test-report.md"
    }
  ]
};
