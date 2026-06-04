# Requirements: KAIS AIGC Platform — Engine Integration

**Defined:** 2026-06-04
**Core Value:** 让 AI 短剧制作流程跑通——从角色设计到成片的完整管线能自动执行并产出可交付成片

## v1 Requirements

Requirements for AI 短剧引擎补全 (ComfyUI 优先). Each maps to roadmap phases.

### 口型同步 (Lip Sync)

- [ ] **LIPS-01**: ComfyUI Worker 安装 LatentSync custom node 及依赖模型 (latentsync_unet, whisper_tiny, arcface)
- [ ] **LIPS-02**: workflow_builder.py 新增 build_lip_sync_workflow，支持 image+audio → lip-synced video 的 ComfyUI 节点链
- [ ] **LIPS-03**: TaskType 枚举新增 LIP_SYNC = "lip_sync"
- [ ] **LIPS-04**: Executor._execute_task 新增 lip_sync 分支，自动构建 workflow 并提交 ComfyUIEngine
- [ ] **LIPS-05**: 通过 gold-team /api/v1/tasks 提交 lip_sync 任务，submit → poll → callback 端到端测试通过

### 角色一致性 (Character Consistency)

- [ ] **CHAR-01**: ComfyUI Worker 安装 IP-Adapter Plus + InstantID + PhotoMaker 节点及模型
- [ ] **CHAR-02**: workflow_builder.py 新增 build_ipadapter_face_workflow，支持参考图面部锁定生成
- [ ] **CHAR-03**: workflow_builder.py 新增 build_instantid_workflow，支持零样本面部保持
- [ ] **CHAR-04**: workflow_builder.py 新增 build_photomaker_workflow，支持多参考图角色生成
- [ ] **CHAR-05**: Executor IMAGE_DRAW 分支通过 params.extra.character_consistency.mode 路由到对应 workflow
- [ ] **CHAR-06**: 三种角色一致性 workflow 在 ComfyUI 中端到端执行测试通过

### 后处理 (Post-Processing)

- [ ] **POST-01**: workflow_builder.py 新增 build_upscale_workflow (Real-ESRGAN 超分辨率)
- [ ] **POST-02**: workflow_builder.py 新增 build_face_restore_workflow (GFPGAN/CodeFormer 人脸修复)
- [ ] **POST-03**: Executor 路由支持已有的 UPSCALE 和 FACE_RESTORE TaskType，自动构建对应 workflow
- [ ] **POST-04**: 超分辨率和人脸修复通过 gold-team API 端到端测试通过

### 帧插值 (Frame Interpolation)

- [ ] **FRAM-01**: ComfyUI Worker 安装 ComfyUI-Frame-Interpolation custom node (RIFE 模型)
- [ ] **FRAM-02**: workflow_builder.py 新增 build_frame_interp_workflow，支持 video → frame-multiplied video
- [ ] **FRAM-03**: TaskType 枚举新增 FRAME_INTERPOLATE = "frame_interpolate"
- [ ] **FRAM-04**: Executor 路由支持 frame_interpolate 类型，自动构建 workflow
- [ ] **FRAM-05**: 帧插值端到端测试通过

### Pipeline 集成

- [ ] **PIPE-01**: 新增 talking_head pipeline 模板 (image_gen → lip_sync → face_restore → upscale)
- [ ] **PIPE-02**: 新增 character_scene pipeline 模板 (ipadapter → video_gen → lip_sync → postprocess)

## v2 Requirements

Deferred to future milestone.

### 音效生成

- **SFX-01**: FoleyCrafter Docker 容器封装，实现 DockerAPIEngine
- **SFX-02**: workflow_builder 或 engine 支持 video → foley audio 生成

### 多语言

- **LANG-01**: GPT-SoVITS 声音克隆翻译引擎集成
- **LANG-02**: 多语言配音 pipeline 模板

## Out of Scope

| Feature | Reason |
|---------|--------|
| 视频风格迁移 (V2V Style) | 现有 Wan2.2 + prompt 够用，非短剧必需 |
| 全自动剪辑 | 需要人工创作决策介入 |
| 移动端审批 | 属于 review-platform 功能，非引擎范畴 |
| LoRA fine-tuning | 角色一致性方案已够用，LoRA 训练周期长 |
| 云端 Lip Sync | 当前无成熟云端 API，本地 ComfyUI 方案优先 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIPS-01 | Phase 1 | Pending |
| LIPS-02 | Phase 4 | Pending |
| LIPS-03 | Phase 4 | Pending |
| LIPS-04 | Phase 4 | Pending |
| LIPS-05 | Phase 4 | Pending |
| CHAR-01 | Phase 1 | Pending |
| CHAR-02 | Phase 3 | Pending |
| CHAR-03 | Phase 3 | Pending |
| CHAR-04 | Phase 3 | Pending |
| CHAR-05 | Phase 3 | Pending |
| CHAR-06 | Phase 3 | Pending |
| POST-01 | Phase 2 | Pending |
| POST-02 | Phase 2 | Pending |
| POST-03 | Phase 2 | Pending |
| POST-04 | Phase 2 | Pending |
| FRAM-01 | Phase 1 | Pending |
| FRAM-02 | Phase 5 | Pending |
| FRAM-03 | Phase 5 | Pending |
| FRAM-04 | Phase 5 | Pending |
| FRAM-05 | Phase 5 | Pending |
| PIPE-01 | Phase 6 | Pending |
| PIPE-02 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-06-04*
*Last updated: 2026-06-04 after roadmap creation*
