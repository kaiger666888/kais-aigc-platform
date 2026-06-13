# Requirements: kais-aigc-platform v1.4

**Defined:** 2026-06-13
**Core Value:** 让 AI 短剧制作流程跑通——从角色设计到成片的完整管线能自动执行并产出可交付成片

## v1.4 Requirements — Production Verification + Repo Governance

### VERIFY — Live Runtime Verification（关闭 v1.3 deferred gaps）

- [ ] **VERIFY-01**: `docker compose -f docker-compose.v9.yml up -d` 启动后，核心 7 服务（comfyui-primary, comfyui-auxiliary, kais-core-backend, kais-gold-team, audit-db, redis, hermes-agent）所有 healthcheck 在 start_period 内通过 *(pending gold-team image build)*
- [ ] **VERIFY-02**: `docker compose -f docker-compose.v9.yml --profile ace up -d kais-acestep` 启动后容器健康（`Status: healthy`），日志中无 `PermissionError` — 关闭 v1.3 FIX-02 *(pending stack startup)*
- [ ] **VERIFY-03**: 通过 `POST http://localhost:8002/api/v1/tasks {"task_type":"music", ...}` 触发 ACE-Step 生成可播放的 MP3 文件（非 mock 输出），端到端跑通 — 关闭 v1.3 FIX-03 *(pending stack startup)*
- [x] **VERIFY-04a**: `kais-core-backend` 镜像构建成功，依赖安装无错误 — image `kais-aigc-platform-kais-core-backend` built
- [ ] **VERIFY-04b**: `kais-gold-team` 镜像构建成功 — *build in progress (CUDA + ML deps, ~30min)*

### FIX — v1.3 ENG-04 代码 Bug 修复

- [x] **FIX-04**: `docker/gold-team/src/v6/engines/acestep.py` 的 `ACEStepEngine.backend_type` property 显式返回 `BackendType.DOCKER`（替代继承的 MOCK）— 关闭 v1.3 ENG-04 *(commit 1d5996a)*
- [x] **FIX-05**: ACEStepEngine 在生产 `main.py` 引擎注册表中显式注册（不依赖 YAML registry 兜底），`/api/v1/engines` 响应中 ACE-Step 归类为 `backend_type: "docker"` *(commit 1d5996a)*
- [x] **FIX-06**: 添加回归测试 `test_acestep_backend_type`，断言 `ACEStepEngine().backend_type == BackendType.DOCKER`，防止分类回退 *(4 new TestACEStepBackendType assertions + updated test_02_backend_type_is_docker; 121/121 tests pass)*

### REPO — Sibling Repo 治理

- [x] **REPO-01**: 审计 19 个 sibling repo（`kais-*` 系列 + `ACE-Step-1.5` + `comfyui-incremental-nodes` + `comfyui-output`），按 **active / legacy / archived** 三态分类 *(commit 6c9c3b1)*
- [x] **REPO-02**: 为每个 repo 记录四项元数据：角色描述、最后 git commit 日期、是否被 `docker-compose.v9.yml` 引用、是否被其他 repo 依赖 *(in REPO-INVENTORY.md)*
- [x] **REPO-03**: 在 `.planning/REPO-INVENTORY.md` 输出完整 repo 清单表格（含三态分类、元数据、依赖关系图） *(commit 6c9c3b1)*
- [ ] **REPO-04**: 确认死亡的 repo 归档：`git mv` 到 `.archive/repos/` 目录，或在 repo 内 README 顶部加 `DEPRECATED` 标记（**不删除**，保留 git 历史） *(1/11 done: kais-movie-agent marked; 9 blocked on dirty working trees; 3 LEGACY pending user verification)*
- [x] **REPO-05**: 输出 Service ↔ Repo 依赖地图：每个 compose service 的 `build.context` 来自哪个 repo 或 in-tree 路径，明确边界 *(in REPO-INVENTORY.md, all paths verified)*
- [x] **REPO-06**: 在 `docs/REPO-MAP.md` 输出新加入者 5 分钟读懂的仓库布局文档（含 active repo 列表 + 调用关系图 + 部署入口） *(commit 6c9c3b1)*

## Out of Scope

| Feature | Reason |
|---------|--------|
| v1.3 Nyquist VALIDATION.md 回填（phase 15/16/18/19） | 纯文档治理，不阻塞 v1.4 核心目标；后续可单独跑 `/gsd:validate-phase N` 补 |
| v1.3 SUMMARY.md frontmatter 补全 | 同上，纯文档整理 |
| 新功能开发（LatentSync 生产化、IP-Adapter FaceID、InstantID、PhotoMaker、Real-ESRGAN、GFPGAN、RIFE） | 属于 PROJECT.md Active 列表，留待 v1.5+ |
| 前端改动 | v1.4 是后端/基础设施治理，前端不动 |
| 真正物理删除死 repo | 风险过高，归档/标注 deprecated 即可（PROJECT.md 决策 #4） |
| OpenClaw Agent skill 开发 | 属于 agent 编排层，非引擎/治理范畴 |
| 新增 sibling repo | v1.4 是收敛而非扩张 |

## Traceability

| Requirement | Phase | Status | Evidence |
|-------------|-------|--------|----------|
| FIX-04 | Phase 20 | ✅ Complete | `engines/acestep.py:91` backend_type override; commit 1d5996a |
| FIX-05 | Phase 20 | ✅ Complete | `main.py` Docker Backend section + ACESTEP_ENABLED gate; commit 1d5996a |
| FIX-06 | Phase 20 | ✅ Complete | `TestACEStepBackendType` 4 assertions + updated `test_02_backend_type_is_docker`; 121/121 tests pass |
| VERIFY-01 | Phase 21 | ⏳ In Progress | Script ready: `scripts/verify-phase-21.sh`; awaiting gold-team build |
| VERIFY-02 | Phase 21 | ⏳ In Progress | Script ready; awaiting stack startup |
| VERIFY-03 | Phase 21 | ⏳ In Progress | Script ready; awaiting stack startup + ACE-Step profile |
| VERIFY-04 | Phase 21 | 🟡 Partial | `kais-core-backend` build ✓ (image `kais-aigc-platform-kais-core-backend`); `kais-gold-team` build running |
| REPO-01 | Phase 22 | ✅ Complete | 19 repos classified ACTIVE/LEGACY/ARCHIVED in `.planning/REPO-INVENTORY.md` |
| REPO-02 | Phase 22 | ✅ Complete | 4 metadata fields per repo (role / last commit / commits / compose ref) |
| REPO-03 | Phase 22 | ✅ Complete | `.planning/REPO-INVENTORY.md` created (commit 6c9c3b1) |
| REPO-04 | Phase 22 | 🟡 Partial | `kais-movie-agent` DEPRECATED ✓ (commit b4ae2b1 in that repo); 9 others blocked on dirty working trees (see inventory) |
| REPO-05 | Phase 22 | ✅ Complete | Service ↔ Repo dependency map in REPO-INVENTORY.md; all build.context paths verified |
| REPO-06 | Phase 22 | ✅ Complete | `docs/REPO-MAP.md` 5-min newcomer orientation (commit 6c9c3b1) |

**Coverage:**
- v1.4 requirements: 13 total
- ✅ Complete: 9
- 🟡 Partial: 2 (VERIFY-04 awaiting gold-team build; REPO-04 awaiting dirty-tree cleanup)
- ⏳ In Progress: 3 (VERIFY-01/02/03 awaiting live stack)
- Blocked: 0

**Phase distribution:**
- Phase 20 (ACEStepEngine Backend Type Fix): 3/3 ✅ — FIX-04, FIX-05, FIX-06
- Phase 21 (Live Runtime Verification): 0/4 ⏳ — verification script ready, awaiting gold-team image build
- Phase 22 (Sibling Repo Governance): 5/6 ✅ + 1 🟡 — REPO-04 partial (1/10+ repos marked)

---
*Requirements defined: 2026-06-13*
*Last updated: 2026-06-13 after Phase 20 completion + Phase 22 audit — Phase 21 live verification in flight*
