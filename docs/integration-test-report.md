# kais-aigc-platform 集成测试报告

**时间**: 2026-05-27 00:22 CST  
**环境**: 全部服务 UP (7 个服务/容器)

---

## 总览

| 服务 | 测试数 | 通过 | 失败 | 跳过/N/A |
|------|--------|------|------|----------|
| gold-team (8002) | 5 | 5 | 0 | 0 |
| core-backend (8000) | 4 | 3 | 0 | 1 |
| movie-agent (8001) | 5 | 2 | 0 | 3 |
| review-platform (8091) | 6 | 5 | 0 | 1 |
| E2E 跨服务流 | 3 | 1 | 1 | 1 |
| **总计** | **23** | **16** | **1** | **6** |

**通过率**: 69.6% (16/23)；排除 N/A/Skip 后: 94.1% (16/17)

---

## 服务状态基线

| 服务 | 端口 | 状态 | 版本 |
|------|------|------|------|
| core-backend | 8000 | ✅ UP | 6.0.0 (Toonflow SPA) |
| movie-agent | 8001 | ✅ UP | 6.0.0 |
| gold-team | 8002 | ✅ UP | 6.0.0 (2 GPU, 2/3 engines online) |
| review-platform | 8091 | ✅ UP | 6.0.0 |
| ComfyUI | 8188 | ✅ UP | 0.22.0 |
| Redis | 6390 | ✅ UP | — |
| PostgreSQL | 5490 | ✅ UP | — |

---

## 各服务测试详情

### gold-team (8002) — 5/5 PASS
- ✅ GET /api/v1/engines → 200, 返回 2 引擎 (mock + tts-local)
- ✅ POST /api/v1/tasks (image_draw) → 202, 任务入队
- ✅ POST /api/v1/tasks (tts) → 202, 任务入队
- ✅ GET /api/v1/tasks → 200, 任务列表正常
- ✅ POST /api/v1/tasks (priority=5) → 422, 验证错误正确

**注意**: TTS 任务提交成功但执行失败（引擎问题，非 API 问题）

### core-backend (8000) — 3/4 PASS, 1 N/A
- ✅ GET /health → 200
- ✅ GET /docs → 200 (Swagger UI)
- ✅ GET /project → 200 (Toonflow SPA)
- ⚠️ GET /api/v1/projects → 404 (端点不存在，core-backend 是 SPA 应用非 REST API)

### movie-agent (8001) — 2/5 PASS, 3 SKIP
- ✅ GET /health → 200, 下游全通
- ✅ 容器日志正常
- ⚠️ Pipeline 列表/启动/状态 → 404（Worker 架构，无 HTTP Pipeline API）

### review-platform (8091) — 5/6 PASS, 1 N/A
- ✅ GET /health → 200
- ✅ JWT 认证流程正常 (POST /api/v1/auth/token → Bearer token)
- ✅ POST /api/v1/reviews/ → 201 (需 JWT + source_system)
- ✅ POST /api/v1/v6/shot-cards/ → 创建成功
- ✅ 无认证请求 → 401 (正确拒绝)
- ⚠️ /canvas 页面 → 303 重定向

### E2E 跨服务流 — 1/3 PASS, 1 FAIL, 1 部分
- ✅ movie-agent → core-backend: Toonflow 数据流正常，各 phase 同步成功
- ❌ movie-agent → review-platform: 401 认证不匹配（见下方 Critical Bug）
- ⚠️ movie-agent → gold-team: 图片任务成功，TTS 任务执行失败

---

## 已知 Bug 状态

| Bug | 描述 | 状态 |
|-----|------|------|
| #1 | gold-team priority 必须是字符串 | ✅ FIXED — 传数字返回 422 + 明确提示 |
| #2 | task_type 命名 (tts) | ⚠️ 部分 — 提交成功但执行失败 |
| #3 | API 路径 /api/v1/tasks | ✅ FIXED — 所有 CRUD 正常 |
| #4 | novel 双层嵌套 | ✅ N/A — toonflow-handler 正确同步 |
| #5 | events 无 header 行 | ✅ N/A — 标准 JSON fetch |
| #6 | review-platform 401 | ✅ FIXED — JWT Bearer 认证流程完善 |
| #7 | ComfyUI 地址可达性 | ✅ FIXED — gold-team 可正常访问 |

---

## 新发现的问题

### 🔴 Critical: movie-agent review 提交全部 401
- **影响**: 所有 pipeline review 环节被静默跳过，无法进入人工审核
- **原因**: `review-platform-client.js` 未实现 JWT 认证，仍假设 "no auth required"
- **修复**: movie-agent 需添加 JWT token 获取逻辑
  1. 启动时 POST /api/v1/auth/token 获取 token
  2. 所有请求携带 Authorization: Bearer header
  3. Token 过期时自动刷新
- **文件**: `/app/lib/review-platform-client.js`

### 🟡 Medium: TTS 引擎任务执行失败
- **影响**: 所有 TTS 类型任务提交成功但执行失败
- **引擎**: tts-local (CosyVoice/edge-tts)
- **需排查**: CosyVoice 模型文件、Python 依赖、引擎日志

### 🟢 Info: movie-agent 端口配置
- `REVIEW_PLATFORM_URL=http://review-platform:8090`
- 容器外部映射端口 8091，但 Docker 内部网络可能使用不同端口
- 需确认 docker-compose 中 review-platform 的内部端口

---

## 建议的下一步

1. **🔴 优先修复 movie-agent review 认证** — 这是阻断性问题，影响所有 pipeline 的人工审核流程
2. **🟡 排查 TTS 引擎故障** — 检查 gold-team 的 tts-local 引擎日志和 CosyVoice 依赖
3. **🟢 补充 E2E 自动化测试** — 添加 movie-agent → gold-team/review-platform 的端到端测试脚本
4. **🟢 完善 core-backend API 文档** — 记录实际可用的 API 端点（非 SPA 路由）
5. **🟢 统一认证方案** — 各服务间认证方式不一致（API Key / JWT / 无认证），建议统一
