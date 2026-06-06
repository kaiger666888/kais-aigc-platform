# KAIS AIGC Platform — Engine Integration

## What This Is

AI 短剧全链路制作平台，通过 kais-gold-team 统一执行引擎编排 ComfyUI 本地推理和云端商业 API，实现从剧本到成片的一站式 AI 制作。服务于内容创作者和影视团队。

## Core Value

让 AI 短剧制作流程跑通——从角色设计、剧本生成、分镜、视频生成到后期制作的完整管线能够自动执行并产出可交付的成片。

## Requirements

### Validated

<!-- Shipped and confirmed. -->

- ✓ 视频生成 (Wan2.2 T2V/I2V via ComfyUI GGUF) — gold-team v6
- ✓ 图片生成 (FLUX via ComfyUI) — gold-team v6
- ✓ 语音合成 (CosyVoice3 TTS) — gold-team v6
- ✓ 音乐生成 (ACE-Step) — gold-team v6
- ✓ 3D 生成 (TRELLIS2 + Hunyuan3D) — kais-aigc-platform routes
- ✓ 云端降级 (Kling/Jimeng/Seedance) — gold-team cloud pool
- ✓ 统一任务 API (gold-team :8002 REST) — gold-team v6
- ✓ 图片描述 (JoyCaption) — gold-team v6
- ✓ 域无关智能决策 API (hermes-agent REST :8080) — v1.1
- ✓ 自学习循环 (audit → EWMA confidence → auto-learn) — v1.1
- ✓ movie-pipeline 域注册 + 14 专家技能迁移 — v1.1
- ✓ hermes-client.js + HERMES_DEFAULTS 降级 + Docker 部署 — v1.1
- ✓ hermes-agent 集成测试体系 (42+ tests, CI pipeline) — v1.2

### Active

<!-- Current milestone scope. -->

- [ ] 口型同步引擎 (Lip Sync) — LatentSync via ComfyUI
- [ ] 角色面部一致性 (IP-Adapter FaceID)
- [ ] 角色零样本保持 (InstantID)
- [ ] 角色多参考图生成 (PhotoMaker)
- [ ] 超分辨率 (Real-ESRGAN workflow)
- [ ] 人脸修复 (GFPGAN/CodeFormer workflow)
- [ ] 视频帧插值 (RIFE via ComfyUI)

### Out of Scope

- 多语言配音/语音翻译 — 不阻塞短剧核心流程，后续里程碑
- 视频风格迁移 (V2V Style Transfer) — 非必须，现有 Wan2.2 + prompt 足够
- 全自动剪辑 — 需要人工介入创作决策，AI 仅辅助
- 移动端审批 — 属于 review-platform 功能，非引擎范畴

## Context

### 技术架构

- **kais-gold-team** (FastAPI :8002): 统一执行引擎，管理所有本地/云端引擎
- **ComfyUI Worker** (RTX 3090 24GB): GPU 推理执行器，承载 ComfyUI 模型
- **引擎注册模式**: BaseEngine 抽象类 → submit/poll/get_output/cancel/health 生命周期
- **Workflow Builder**: Python 函数构建 ComfyUI API-format JSON workflow dict
- **Executor 路由**: 按 TaskType 枚举自动匹配引擎和构建 workflow
- **云端降级**: ComfyUIEngine 本地执行 → CloudXxxEngine API 调用

### 现有引擎组织模式

1. **ComfyUI 路径** — ComfyUIEngine + workflow_builder.py (Wan2.2, FLUX, JoyCaption)
2. **独立容器路径** — DockerAPIEngine 子类 (FaceFusion, CosyVoice TTS)
3. **云端 API 路径** — CloudXxxEngine (Kling, Jimeng, Seedance)

### 关键文件

- `docker/gold-team/src/v6/models/task.py` — TaskType 枚举
- `docker/gold-team/src/v6/engines/workflow_builder.py` — ComfyUI workflow 构建
- `docker/gold-team/src/v6/engines/comfyui.py` — ComfyUI 引擎
- `docker/gold-team/src/v6/executor.py` — 任务执行和路由
- `docker/gold-team/src/v6/main.py` — 引擎注册入口

### 显存约束

RTX 3090 24GB 串行调度，重模型 (Wan2.2 ~22GB) 和轻模型 (Real-ESRGAN ~2GB) 分时复用。短剧 pipeline 建议执行顺序：角色图 → 视频 → 口型同步 → 超分 + 人脸修复 → 帧插值。

## Constraints

- **GPU**: RTX 3090 24GB VRAM，串行调度，单模型独占
- **ComfyUI 优先**: 有 ComfyUI 节点的方案优先，无节点的才考虑独立容器
- **引擎接口**: 所有新引擎必须遵循 BaseEngine 接口 (submit/poll/get_output/cancel/health)
- **Python 3.11**: gold-team 运行时
- **模型存储**: /data/models/ 挂载到 ComfyUI Worker

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| ComfyUI 节点优先 | 减少 Docker 容器管理开销，复用已有 ComfyUIEngine | — Pending |
| LatentSync 选型 | 已有 ComfyUI 社区节点，基于 Whisper + diffusion，效果经过验证 | — Pending |
| 角色 3 方案组合 | IP-Adapter FaceID (高保真) + InstantID (零样本) + PhotoMaker (多图) 覆盖不同场景 | — Pending |
| 角色一致性不新增 TaskType | 扩展 IMAGE_DRAW/IMAGE_REFINE 的 params.extra 字段，避免枚举膨胀 | — Pending |
| hermes-agent Python 库内嵌 | 免独立服务管理，直接 import 使用 | ✓ Good |
| 域无关 API (domain/task/context) | 任何管线复用同一接口，不绑定电影业务 | ✓ Good |
| EWMA alpha=0.3 | 适中的时间衰减权重 | ✓ Good |
| Hardcoded 14 skill list | 避免动态 glob 的不确定性 | ✓ Good |
| 集成测试用真实 LLM | 不 mock，验证完整链路 | ✓ Good |
| 测试端口 8090 | 避免与开发环境 8080 冲突 | ✓ Good |
| Node.js 子进程测试客户端 | 复刻 test_e2e.py 模式，跨语言验证 | ✓ Good |

## Current Milestone: (Planning next)

**Goal:** TBD — start with `/gsd:new-milestone`

### Shipped: v1.2 Integration Testing — Hermes-Agent (2026-06-07)

- docker-compose.test.yml 隔离测试环境 + conftest_integration.py 共享 fixture
- 14 个测试文件，42+ 测试用例覆盖 FR-01 ~ FR-04 全部 Must 项
- hermes-client.js 端到端链路测试 + 降级/重试验证
- 并发压力测试 (10 concurrent, 20 mixed) + 100-cycle 稳定性 + 容器重启恢复
- GitHub Actions CI workflow (PR 触发) + run-integration-tests.sh + make test-integration

### Shipped: v1.1 Hermes Intelligent Decision Engine (2026-06-06)

- 域无关 REST API (decide / audit / register / health) — hermes-agent Python 库模式
- 自学习循环 (audit → EWMA confidence → auto-learn trigger)
- movie-pipeline 首个域注册，14 专家技能 + 10 阶段参数知识迁移
- hermes-client.js 适配 + HERMES_DEFAULTS 降级 + Docker 容器部署
- 替代旧 hermes-worker-agent (:3100) 和 kais-hermes Decision API (:8080)

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-07 after v1.2 milestone completion*
