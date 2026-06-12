# Requirements: kais-aigc-platform v1.3

**Defined:** 2026-06-12
**Core Value:** 让 AI 短剧制作流程跑通——从角色设计到成片的完整管线能自动执行并产出可交付成片

## v1.3 Requirements — Architecture Alignment

### MERGE — v6 代码合并

- [ ] **MERGE-01**: 对比研发版 (kais-gold-team) 与部署版 (aigc-platform) v6 代码差异，生成变更清单
- [ ] **MERGE-02**: 将研发版新增引擎代码合并回部署版（Hunyuan3D-2mv, Wan2.1 GGUF 等）
- [ ] **MERGE-03**: 更新部署版 Dockerfile 和 Python 依赖以支持合并后代码
- [ ] **MERGE-04**: 回归测试验证合并后所有现有功能正常

### WFB — Workflow Builder 补全

- [x] **WFB-01**: 实现 `build_flux_dev_workflow`（FLUX Dev 文生图）
- [x] **WFB-02**: 实现 `build_flux_ipadapter_workflow`（FLUX + IP-Adapter 面部保持）
- [x] **WFB-03**: 实现 `build_hunyuan3d_workflow`（Hunyuan3D 3D 生成）
- [x] **WFB-04**: 实现 `build_trellis_image_to_3d_workflow`（TRELLIS2 图转 3D）
- [x] **WFB-05**: 实现 `build_flux_trellis_full_workflow`（FLUX + TRELLIS2 完整链）
- [x] **WFB-06**: 实现 `build_lipsync_workflow`（LatentSync 口型同步，params.extra.mode 路由）
- [x] **WFB-07**: 实现 `build_frame_interpolate_workflow`（RIFE 帧插值，params.extra.mode 路由）
- [x] **WFB-08**: 更新 workflow_builder 路由表，新增工作流注册到对应 TaskType

### TASK — TaskType 路由优化

- [x] **TASK-01**: 口型同步能力通过 VIDEO_FINAL 的 params.extra.mode = "lip_sync" 路由
- [x] **TASK-02**: 帧插值能力通过 UPSCALE 的 params.extra.mode = "frame_interp" 路由
- [x] **TASK-03**: 角色一致性（IP-Adapter/InstantID/PhotoMaker）通过 IMAGE_DRAW 的 params.extra 路由
- [x] **TASK-04**: 更新 executor/router 路由逻辑支持 params.extra 细分

### ENG — Engine Registration 统一

- [ ] **ENG-01**: 统一引擎注册为按后端类型（ComfyUI/独立API/云端/子进程）
- [ ] **ENG-02**: ComfyUI 模型不新增 Engine 类，全部走 ComfyUIEngine + workflow_builder
- [ ] **ENG-03**: 验证 ComfyUIEngine 双引擎自动路由（Primary/Auxiliary）
- [ ] **ENG-04**: 验证 DockerPollingAPIEngine (ACE-Step) 和 CloudEngine 正常

### CLN — movie-agent 清退

- [ ] **CLN-01**: 从 Docker Compose 文件移除 movie-agent 服务定义
- [ ] **CLN-02**: 从代码中移除 movie-agent 引用和配置
- [ ] **CLN-03**: 确认 OpenClaw Agent 完全覆盖 movie-agent 编排功能

### FIX — ACE-Step 权限修复

- [ ] **FIX-01**: 修复 ACE-Step 容器 checkpoints 目录 volume mount 权限
- [ ] **FIX-02**: 验证 ACE-Step 容器健康启动，不再持续重启
- [ ] **FIX-03**: 端到端验证音乐生成通过统一 API 正常工作

## Out of Scope

| Feature | Reason |
|---------|--------|
| 20 步管线实现 | 属于 OpenClaw Agent skill 开发，非引擎范畴 |
| 前端改动 | 核心后端和引擎对齐不影响前端 |
| 云端 API 新增 | Kling/Jimeng/Seedance 已有，不需新增 |
| 服务层重构 | 技术债务，非架构对齐核心需求 |
| review-platform 改动 | 可选服务，不影响引擎核心 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FIX-01 | Phase 15 | Pending |
| FIX-02 | Phase 15 | Pending |
| FIX-03 | Phase 15 | Pending |
| CLN-01 | Phase 15 | Pending |
| CLN-02 | Phase 15 | Pending |
| CLN-03 | Phase 15 | Pending |
| MERGE-01 | Phase 16 | Pending |
| MERGE-02 | Phase 16 | Pending |
| MERGE-03 | Phase 16 | Pending |
| MERGE-04 | Phase 16 | Pending |
| WFB-01 | Phase 17 | Complete |
| WFB-02 | Phase 17 | Complete |
| WFB-03 | Phase 17 | Complete |
| WFB-04 | Phase 17 | Complete |
| WFB-05 | Phase 17 | Complete |
| WFB-06 | Phase 17 | Complete |
| WFB-07 | Phase 17 | Complete |
| WFB-08 | Phase 17 | Complete |
| ENG-01 | Phase 18 | Pending |
| ENG-02 | Phase 18 | Pending |
| ENG-03 | Phase 18 | Pending |
| ENG-04 | Phase 18 | Pending |
| TASK-01 | Phase 18 | Complete |
| TASK-02 | Phase 18 | Complete |
| TASK-03 | Phase 18 | Complete |
| TASK-04 | Phase 18 | Complete |

**Coverage:**
- v1.3 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0

---
*Requirements defined: 2026-06-12*
*Last updated: 2026-06-12 after roadmap creation*
