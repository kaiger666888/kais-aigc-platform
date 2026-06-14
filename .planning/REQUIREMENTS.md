# Requirements: kais-aigc-platform v1.5

**Defined:** 2026-06-14
**Core Value:** 让 AI 短剧制作流程跑通——从角色设计到成片的完整管线能够自动执行并产出可交付成片

## v1.5 Requirements — Architecture Hardening + Code Hygiene

**Scope:** 关闭 ACE 路由收敛(commit e3d649e/e817e18)后暴露的工程配合问题。不引入新功能,聚焦加固和清理。

### SCHED — GpuScheduler 多进程协调

- [ ] **SCHED-01**: GpuScheduler 状态(locks、services、idleTimers)从模块级单例迁移到 Redis 后端,使多个 Node 进程(dev + prod 并行、cluster worker、test runner)共享一致的 GPU 锁与服务状态
- [ ] **SCHED-02**: 保留单进程内存模式作为 fallback(当 REDIS_URL 不可用时退回模块单例),并加日志告警避免静默降级

### GOLD — gold-team Python 代码退役

- [ ] **GOLD-01**: 删除 `docker/gold-team/src/v6/engines/acestep.py`(子进程引擎死代码)、`docker_polling.py` 中的 `_build_acestep_payload`、`engine_registry.py` 的 acestep 条目、`executor.py` 的 `extra.acestep` 路由、`main.py` 的 ACESTEP_ENABLED 注册块 — 共 5 处死代码
- [ ] **GOLD-02**: 删除 `docker/gold-team/Dockerfile` 中的 `ENV ACESTEP_API_HOST=127.0.0.1`(line 100)和无用的 ACESTEP 依赖安装步骤,镜像重建后验证启动无 ACESTEP 相关日志

### PATH — 输出路径变量统一

- [ ] **PATH-01**: 在 `src/lib/paths.ts` 定义统一的输出路径约定(`OUTPUT_ROOT`、各引擎子目录如 `output/ace/`、`output/flux/`、`output/tts/`),所有新代码强制使用,旧代码通过 lint 规则或迁移指南渐进切换
- [ ] **PATH-02**: 把 `OUTPUT_DIR` / `COMFYUI_OUTPUT_DIR` / `FLUX_OUTPUT_DIR` / `INDEXTTS2_OUTPUT_DIR` / `LTX_OUTPUT_DIR` 等 6+ 个独立环境变量统一到 `OUTPUT_ROOT` + 引擎子目录约定,旧变量保留为 alias 避免破坏现有部署

### HERMES — hermes-agent 内嵌项目类型卫生

- [ ] **HERMES-01**: 主工程 `tsconfig.json` 添加 `exclude: ["docker/hermes-agent/_hermes_source/**"]`,使 `yarn lint`/`yarn build` 不再扫描内嵌的 React 项目,消除 41 个主工程编译噪声

### CORE — router.ts 自动生成机制

- [ ] **CORE-01**: 修改 `src/core.ts` 的 fast-glob 扫描规则,跳过文件名匹配 `config.ts`、`_shared/**`、`_lib/**` 等纯配置/共享模块,从源头避免把它们注册为空 route handler
- [ ] **CORE-02**: 同时清理已经被错误注册的现有 config-only 文件(从 `export default router` 退回到不导出 default),并验证 `yarn dev` 启动后 `app.use` 注册的路由列表不含 config 文件

## Out of Scope

| Feature | Reason |
|---------|--------|
| GpuScheduler 接入其他 32 个 ComfyUI 路由 | 工作量大,需要逐个改路由。本 milestone 只做后端基础设施(Redis-backed state),接入扩展留下个 milestone |
| gold-team 服务本身退役(只清 Python 代码) | gold-team 还在托管 Hunyuan3D、pipeline render 等其他引擎,服务不能删 |
| 输出路径强制迁移所有 33 个路由 | 与上面同理。本 milestone 建立约定和迁移指南,逐路由切换留下个 milestone |
| 修改 hermes-agent 内嵌 React 项目本身的 TS 配置 | 它是 vendored 的 React 项目,有自己的 tsconfig.json;主工程应该排除扫描而非修改它 |
| 验证 v1.4 VERIFY-03(E2E 音乐生成 hardware-blocked) | 需要更高显存 GPU,本 milestone 不解决硬件问题 |
| 完成 v1.4 REPO-04(9 个 repo 归档) | 是 dirty working tree 阻塞,不属于 v1.5 范围 |
| 前端改动 | v1.5 是后端/基础设施治理,前端不动 |

## Traceability

| Requirement | Phase | Status | Evidence |
|-------------|-------|--------|----------|
| SCHED-01 | Phase 23 | ⏳ Pending | TBD |
| SCHED-02 | Phase 23 | ⏳ Pending | TBD |
| GOLD-01 | Phase 24 | ⏳ Pending | TBD |
| GOLD-02 | Phase 24 | ⏳ Pending | TBD |
| PATH-01 | Phase 25 | ⏳ Pending | TBD |
| PATH-02 | Phase 25 | ⏳ Pending | TBD |
| HERMES-01 | Phase 26 | ⏳ Pending | TBD |
| CORE-01 | Phase 27 | ⏳ Pending | TBD |
| CORE-02 | Phase 27 | ⏳ Pending | TBD |

**Coverage:**
- v1.5 requirements: 9 total
- Categories: 5 (SCHED/GOLD/PATH/HERMES/CORE)
- All ⏳ Pending — to be executed in Phases 23-27

---

## Previous Milestones

### v1.4 — Production Verification + Repo Governance (2026-06-13)

13 requirements (FIX-04/05/06, VERIFY-01/02/03/04, REPO-01..06):
- ✅ Complete: 9 (FIX-04/05/06, VERIFY-01/02/04, REPO-01/02/03/05/06)
- ⚠️ Hardware-Blocked: 1 (VERIFY-03 — ACE-Step inference OOMs on 24GB GPU)
- 🟡 Partial: 1 (REPO-04 — 1/10+ repos marked DEPRECATED, others blocked on dirty trees)

### v1.3 — Architecture Alignment: Engine Consolidation (2026-06-13)

26 requirements across FIX/CLN/MERGE/WFB/ENG/TASK. 102/102 tests passing. Details in `.planning/v1.3-MILESTONE-AUDIT.md`.

### v1.2 — Integration Testing: Hermes-Agent (2026-06-07)

22 requirements. 42+ tests across 14 files. GitHub Actions CI.

### v1.1 — Hermes Intelligent Decision Engine (2026-06-06)

21 requirements. Domain-agnostic decision API + EWMA self-learning.

---

*Requirements defined: 2026-06-14 for v1.5 milestone kickoff*
