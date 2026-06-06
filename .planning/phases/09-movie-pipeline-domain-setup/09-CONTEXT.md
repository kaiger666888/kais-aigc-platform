# Phase 9: Movie-Pipeline Domain Setup - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous mode)

<domain>
## Phase Boundary

注册 movie-pipeline 域到 hermes-agent 服务，迁移 14 专家知识为 hermes 技能，注入 HERMES_DEFAULTS 参数默认值作为初始记忆。
域注册后，hermes-agent 可以为 movie-pipeline 管线任务提供基于专家知识的决策建议。

</domain>

<decisions>
## Implementation Decisions

### Expert Knowledge Mapping
- 14 专家技能选取：13 个 data/skills/ 根级技能文件（production_agent_decision, production_agent_supervision, production_execution_derive_assets, production_execution_director_plan, production_execution_generate_assets, production_execution_storyboard_gen, production_execution_storyboard_panel, production_execution_storyboard_table, script_agent_decision, script_agent_supervision, script_execution_adaptation, script_execution_script, script_execution_skeleton）+ production_skills/storyboard_prompt_techniques = 14
- 技能格式：复制/适配原始 .md 文件作为 hermes 技能 — 已包含结构化专家指令，hermes-agent 可直接用作上下文
- art_skills (11 个艺术风格目录) 和 story_skills (11 个故事类型目录) 注册为 skills_manifest 中的样式指南引用，不计入 14 核心专家技能
- 命名规范：snake_case，与原始文件名一致（如 production_agent_decision, script_execution_script）

### HERMES_DEFAULTS Initial Memory
- 记忆格式：结构化 JSON，按 task 分组 — `{"soul-visual": {"flux": {"steps": 28, "guidance": 7.5}}, "video-gen": {"wan": {"motion": 6}}}`
- 注入方式：直接写入 `memory/audit_history.json` 作为 seed 记录 — DomainMemory 已能读取，无需新代码
- FLUX 参数范围：核心生成参数 — steps, guidance_scale, sampler, scheduler, width, height, denoise, seed

### SOUL.md Domain Identity
- Persona 范围：通用电影管线决策顾问 — 一个 SOUL.md 定义域的决策哲学和专业知识，hermes-agent 通过 skills 获取 task-specific 知识
- 语言：双语 — 中文为主（匹配团队工作流），英文关键术语
- 注册机制：Python 注册脚本（register_movie_pipeline.py）— 读取 data/skills/ 构建技能，调用 POST /v1/register API，可复现、可测试

### Claude's Discretion
- FLUX 参数默认值的具体数值
- 10 个 task 名称的精确映射（从 pipeline.js 的 PHASES 定义）
- SOUL.md 的具体措辞和风格

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docker/hermes-agent/src/core/domain_registry.py` — DomainRegistry.register() 已实现域注册、目录创建、SOUL.md 初始化
- `docker/hermes-agent/src/core/agent_factory.py` — AgentFactory 加载 SOUL.md 作为 ephemeral_system_prompt
- `docker/hermes-agent/src/core/domain_memory.py` — DomainMemory 管理 audit_history.json，支持 EWMA confidence
- `docker/hermes-agent/src/api/routes.py` — REST API 端点已就绪
- `docker/hermes-agent/src/api/models.py` — RegisterRequest/DecideRequest/AuditRequest Pydantic 模型
- `data/skills/` — 14 个专家技能 .md 文件 + art/story 风格指南
- `docker/movie-agent/lib/pipeline.js` — PHASES 数组定义 10+ 管线阶段

### Established Patterns
- 域目录结构：`~/.hermes/domains/{domain}/skills/` + `memory/` + `SOUL.md`
- 技能以 .md 文件存储，DomainRegistry.get_skills() 读取文件名列表
- AgentFactory 通过 ephemeral_system_prompt 注入 SOUL.md
- DomainMemory 管理 audit_history.json 按 task 分组的审计记录

### Integration Points
- DomainRegistry.register() — 注册域，创建目录结构
- DomainRegistry.get_skills() — 返回 skills/ 目录下的 .md 文件名列表
- AgentFactory.get_agent() — 加载 SOUL.md 为 AIAgent 上下文
- DecisionEngine.decide() — 使用域技能和记忆做决策
- POST /v1/register API — 接受 {domain, description, tasks, skills_manifest}

</code_context>

<specifics>
## Specific Ideas

1. 注册脚本放在 `docker/hermes-agent/scripts/register_movie_pipeline.py` — 与 hermes-agent 代码共存
2. 10 个 tasks 从 pipeline.js PHASES 数组映射：requirement, art-direction, character, scenario, voice, storyboard, scene, camera-preview, camera-final, post-production
3. HERMES_DEFAULTS 至少包含 soul-visual (FLUX), video-gen (Wan2.2), voice (CosyVoice3) 三类任务的参数默认值
4. SOUL.md 定义角色为"电影管线智能决策顾问"，具备剧本、美术、摄影、后期全流程决策能力

</specifics>

<deferred>
## Deferred Ideas

- art_skills 和 story_skills 的完整注册（可在后续迭代中作为动态技能加载）
- 从 auto-learn 触发自动提取技能（Phase 8 已设置 auto_learn_triggered 标记）
- 客户端适配和旧服务替换（Phase 10）

</deferred>
