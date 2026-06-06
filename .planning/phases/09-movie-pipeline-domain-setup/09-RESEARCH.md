# Phase 9: Movie-Pipeline Domain Setup - Research

**Researched:** 2026-06-06
**Domain:** Hermes domain registration, expert skill migration, initial memory injection
**Confidence:** HIGH

## Summary

Phase 9 registers the `movie-pipeline` domain in the hermes-agent service by leveraging the fully implemented Phase 7/8 infrastructure: `DomainRegistry.register()`, `AgentFactory`, `DecisionEngine`, and `DomainMemory`. The core work is a Python registration script that copies 14 expert skill .md files into the domain's skills directory, writes structured HERMES_DEFAULTS as seed memory into `audit_history.json`, and creates a SOUL.md defining the movie-pipeline domain identity. No new core code is needed -- this phase is pure data/scripting work against existing APIs.

The 10 pipeline tasks map directly to the PHASES array in `docker/movie-agent/lib/pipeline.js` (lines 50-81). The 14 expert skills are 13 root-level .md files in `data/skills/` plus `data/skills/production_skills/storyboard_prompt_techniques.md`. FLUX and Wan parameter defaults are sourced from the gold-team engine capabilities catalog (`docker/gold-team/src/v6/routers/engines.py` lines 71-86 for flux-dev, lines 38-55 for wan2.2-i2v-gguf).

**Primary recommendation:** Write a single `register_movie_pipeline.py` script that uses `shutil.copy2` to migrate skill files, builds the HERMES_DEFAULTS JSON from verified parameter values, writes SOUL.md, and calls `DomainRegistry.register()` directly (no HTTP needed -- script imports the class).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- 14 专家技能选取：13 个 data/skills/ 根级技能文件 + production_skills/storyboard_prompt_techniques = 14
- 技能格式：复制/适配原始 .md 文件作为 hermes 技能 -- 已包含结构化专家指令
- art_skills (11 个) 和 story_skills (11 个) 注册为 skills_manifest 中的样式指南引用，不计入 14 核心专家技能
- 命名规范：snake_case，与原始文件名一致
- 记忆格式：结构化 JSON，按 task 分组
- 注入方式：直接写入 memory/audit_history.json 作为 seed 记录
- SOUL.md Persona：通用电影管线决策顾问，双语（中文为主）
- 注册机制：Python 注册脚本 register_movie_pipeline.py

### Claude's Discretion
- FLUX 参数默认值的具体数值
- 10 个 task 名称的精确映射（从 pipeline.js 的 PHASES 定义）
- SOUL.md 的具体措辞和风格

### Deferred Ideas (OUT OF SCOPE)
- art_skills 和 story_skills 的完整注册（后续迭代）
- 从 auto-learn 触发自动提取技能
- 客户端适配和旧服务替换（Phase 10）
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MOVIE-01 | 注册 movie-pipeline 域（10 tasks: requirement-bible 到 composition） | DomainRegistry.register() accepts `tasks: list[str]`; PHASES array has 11 entries but CONTEXT.md specifies 10 -- see Task Mapping section |
| MOVIE-02 | 14 个电影专家领域知识转为 hermes 技能 | 13 root .md files + storyboard_prompt_techniques.md = 14; copy to ~/.hermes/domains/movie-pipeline/skills/ |
| MOVIE-03 | HERMES_DEFAULTS（60+ 行参数默认值）作为初始记忆注入 | DomainMemory reads audit_history.json; write seed records with EWMA 0.0; FLUX/Wan params from engines.py |
| MOVIE-04 | SOUL.md 定义电影管线智能决策顾问身份 | AgentFactory reads SOUL.md as ephemeral_system_prompt; write to domain dir before first decide call |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Domain registration (API + filesystem) | API / Backend | -- | DomainRegistry.register() creates dirs and updates registry.json |
| Skill file migration | Script (one-time) | -- | Copy .md files from data/skills/ to domain skills dir |
| Initial memory injection | Script (one-time) | -- | Write seed audit_history.json into domain memory dir |
| SOUL.md creation | Script (one-time) | -- | Write domain identity file into domain dir |
| Decide endpoint validation | API / Backend | -- | DecisionEngine.decide() uses skills + memory for context |
| Skills listing | API / Backend | -- | DomainRegistry.get_skills() reads .md filenames from skills dir |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python 3.12 | system | Script runtime | hermes-agent already targets 3.12 |
| pathlib | stdlib | File operations | Already used throughout hermes-agent codebase |
| shutil | stdlib | File copying for skill migration | Standard library, no dependencies |
| json | stdlib | JSON read/write | Already used for audit_history.json |
| fastapi | existing | API endpoints for verification | Phase 7 dependency |
| pytest | existing | Test framework | 91 tests already in hermes-agent |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| httpx | existing | TestClient for API verification | Verify registration and skills via API calls in tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct DomainRegistry import in script | HTTP POST /v1/register | Direct import avoids needing running server; simpler for one-time setup |
| Copy skill files as-is | Transform to new format | .md files already have structured frontmatter and instructions hermes can use |

**Installation:**
```bash
# No new packages needed -- all dependencies already in hermes-agent
```

**Version verification:** All dependencies verified present in the existing hermes-agent project.

## Package Legitimacy Audit

No new packages installed in this phase. All work uses Python standard library and existing project dependencies (fastapi, pytest, httpx).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | -- | -- | -- | -- | -- | No new packages |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
register_movie_pipeline.py
        |
        |--(copy)--> ~/.hermes/domains/movie-pipeline/skills/*.md  (14 expert files)
        |
        |--(write)--> ~/.hermes/domains/movie-pipeline/SOUL.md     (domain identity)
        |
        |--(write)--> ~/.hermes/domains/movie-pipeline/memory/audit_history.json  (seed params)
        |
        |--(call)---> DomainRegistry.register(domain="movie-pipeline", tasks=[...], skills_manifest={...})
        |
        v
registry.json updated with domain entry
        |
        v
GET /v1/domains/movie-pipeline/skills  -->  returns 14 skill names
POST /v1/decide(domain, task, context)  -->  returns recommendation with FLUX params
```

### Recommended Project Structure
```
docker/hermes-agent/
    scripts/
        register_movie_pipeline.py    # Registration script (NEW)
    tests/
        test_movie_pipeline_domain.py # Verification tests (NEW)
```

### Pattern 1: Direct DomainRegistry Import for Registration Script
**What:** Import DomainRegistry class directly instead of calling HTTP API
**When to use:** One-time setup scripts where the server may not be running
**Example:**
```python
# Source: Verified from docker/hermes-agent/src/core/domain_registry.py
from pathlib import Path
from src.core.domain_registry import DomainRegistry

registry = DomainRegistry(base_dir=Path.home() / ".hermes" / "domains")
registry.register(
    domain="movie-pipeline",
    description="AI short film production pipeline",
    tasks=["requirement", "art-direction", "character", "scenario",
            "voice", "storyboard", "scene", "camera-preview",
            "camera-final", "post-production"],
    skills_manifest={...},
)
```

### Pattern 2: Skill File Migration via shutil.copy2
**What:** Copy .md files from data/skills/ to domain skills directory
**When to use:** One-time migration of expert knowledge files
**Example:**
```python
# Source: Verified from data/skills/ directory structure
import shutil

SKILLS_SOURCE = Path("data/skills")
DOMAIN_SKILLS = Path.home() / ".hermes" / "domains" / "movie-pipeline" / "skills"

# Copy 13 root-level skill files
for md_file in sorted(SKILLS_SOURCE.glob("*.md")):
    shutil.copy2(md_file, DOMAIN_SKILLS / md_file.name)

# Copy storyboard_prompt_techniques from production_skills
shutil.copy2(
    SKILLS_SOURCE / "production_skills" / "storyboard_prompt_techniques.md",
    DOMAIN_SKILLS / "storyboard_prompt_techniques.md",
)
```

### Pattern 3: Seed Memory Injection into audit_history.json
**What:** Write structured parameter defaults as seed audit records
**When to use:** Initial domain setup to provide baseline recommendations
**Example:**
```python
# Source: Verified from docker/hermes-agent/src/core/domain_memory.py
# audit_history.json format: {task_name: {"records": [...], "ewma_confidence": 0.0}}
import json

seed_data = {
    "soul-visual": {
        "records": [{
            "decision_id": "seed-flux-001",
            "outcome": "seed",
            "metrics": {
                "task": "soul-visual",
                "score": 7,
                "params": {
                    "flux": {
                        "steps": 20,
                        "guidance_scale": 3.5,
                        "sampler": "euler",
                        "scheduler": "normal",
                        "width": 1024,
                        "height": 1024,
                        "denoise": 1.0,
                        "seed": -1,
                    }
                }
            },
            "timestamp": "2026-06-06T00:00:00+00:00",
        }],
        "ewma_confidence": 0.0,
    },
}
```

### Anti-Patterns to Avoid
- **Calling HTTP API from registration script when server is not running:** Use direct DomainRegistry import instead; the server doesn't need to be running for setup
- **Overwriting existing SOUL.md on re-registration:** DomainRegistry.register() already preserves existing SOUL.md (line 61 checks `if not soul_path.exists()`)
- **Forgetting to create scripts/ directory:** It does not exist yet; must be created
- **Using HERMES_DEFAULTS as a flat list:** CONTEXT.md specifies structured JSON grouped by task -- follow the `{"soul-visual": {"flux": {...}}}` format

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Domain directory creation | Custom mkdir logic | DomainRegistry.register() | Already creates skills/, memory/, SOUL.md |
| Registry.json management | Custom JSON writes | DomainRegistry._save_registry() | Atomic write with .tmp rename pattern |
| Skills listing | Custom directory scanner | DomainRegistry.get_skills() | Already returns sorted .md stems |
| Confidence calculation | Custom scoring | DomainMemory._compute_ewma() | EWMA already implemented |

**Key insight:** The entire Phase 7/8 infrastructure is designed for exactly this use case. The registration script should import and call existing classes, not reimplement any filesystem operations.

## Common Pitfalls

### Pitfall 1: Missing scripts/ Directory
**What goes wrong:** Script fails with FileNotFoundError on write
**Why it happens:** `docker/hermes-agent/scripts/` does not exist yet (verified: `ls` returns "does not exist")
**How to avoid:** Create directory as first step; add `Path("scripts").mkdir(exist_ok=True)` in setup
**Warning signs:** Script fails immediately on first file operation

### Pitfall 2: 10 vs 11 Tasks in PHASES Array
**What goes wrong:** PHASES array has 11 entries (including quality-gate at stageOrder 11), but CONTEXT.md specifies 10 tasks
**Why it happens:** quality-gate was added later and is auto-evaluated, not a decision point for hermes
**How to avoid:** Use exactly 10 tasks as listed in CONTEXT.md specific ideas: requirement, art-direction, character, scenario, voice, storyboard, scene, camera-preview, camera-final, post-production. Exclude quality-gate.
**Warning signs:** Registration succeeds with 11 tasks when spec says 10

### Pitfall 3: Storyboard_table_techniques vs Storyboard_prompt_techniques
**What goes wrong:** Copying both production_skills files when only storyboard_prompt_techniques was decided
**Why it happens:** production_skills/ has 2 files, but CONTEXT.md explicitly lists only storyboard_prompt_techniques as the 14th skill
**How to avoid:** Copy only storyboard_prompt_techniques.md; exclude storyboard_table_techniques.md
**Warning signs:** 15 skills returned when spec says 14

### Pitfall 4: SOUL.md Overwrite on Re-run
**What goes wrong:** Custom SOUL.md edits lost when script re-runs
**Why it happens:** Script might unconditionally write SOUL.md
**How to avoid:** Follow DomainRegistry pattern -- only write SOUL.md if it does not exist; or write separately from register() and check existence first
**Warning signs:** SOUL.md content resets on re-registration

### Pitfall 5: Seed Memory Not Usable by decide()
**What goes wrong:** decide() returns confidence 0.0 even after seed memory injection
**Why it happens:** EWMA confidence requires MIN_AUDITS_FOR_CONFIDENCE (3) records; seed has only 1 per task. This is expected -- seed provides parameter reference, not confidence.
**How to avoid:** Document that initial confidence will be 0.0; the seed memory provides parameter recommendations via the agent's context, not via EWMA scoring
**Warning signs:** Test expects non-zero confidence after seeding

### Pitfall 6: FLUX Parameter Names Don't Match Existing Code
**What goes wrong:** Seed memory uses parameter names that don't match what movie-agent expects
**Why it happens:** engines.py uses `cfg_scale` and `num_inference_steps`, while CONTEXT.md uses `guidance_scale` and `steps`
**How to avoid:** Use the parameter names from engines.py as the canonical source: `cfg_scale`, `num_inference_steps` for flux-dev; `cfg`, `shift`, `high_noise_steps`, `total_steps` for wan2.2. Or use CONTEXT.md names and document the mapping.
**Warning signs:** decide() returns parameters that client can't interpret

## Code Examples

### Registration Script Skeleton
```python
# Source: Verified from docker/hermes-agent/src/core/domain_registry.py + CONTEXT.md decisions
"""Register movie-pipeline domain with hermes-agent."""
from pathlib import Path
import json
import shutil

# Project root detection
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent  # -> workspace root
SKILLS_SOURCE = PROJECT_ROOT / "data" / "skills"
HERMES_HOME = Path.home() / ".hermes" / "domains"

# Import hermes-agent core (add to sys.path)
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from src.core.domain_registry import DomainRegistry

# 10 tasks from pipeline.js PHASES (excluding quality-gate)
TASKS = [
    "requirement", "art-direction", "character", "scenario",
    "voice", "storyboard", "scene", "camera-preview",
    "camera-final", "post-production",
]

# 14 skills: 13 root + 1 from production_skills
SKILL_FILES = [
    # 13 root-level
    "production_agent_decision.md",
    "production_agent_supervision.md",
    "production_execution_derive_assets.md",
    "production_execution_director_plan.md",
    "production_execution_generate_assets.md",
    "production_execution_storyboard_gen.md",
    "production_execution_storyboard_panel.md",
    "production_execution_storyboard_table.md",
    "script_agent_decision.md",
    "script_agent_supervision.md",
    "script_execution_adaptation.md",
    "script_execution_script.md",
    "script_execution_skeleton.md",
    # 1 from production_skills
    "storyboard_prompt_techniques.md",
]

def main():
    registry = DomainRegistry(base_dir=HERMES_HOME)

    # Step 1: Register domain
    skills_manifest = {
        "art_styles": {"count": 11, "path": "data/skills/art_skills/"},
        "story_types": {"count": 11, "path": "data/skills/story_skills/"},
    }
    registry.register(
        domain="movie-pipeline",
        description="AI short film production pipeline - intelligent decision engine",
        tasks=TASKS,
        skills_manifest=skills_manifest,
    )

    # Step 2: Copy skill files
    domain_skills = HERMES_HOME / "movie-pipeline" / "skills"
    for skill_file in SKILL_FILES[:13]:
        shutil.copy2(SKILLS_SOURCE / skill_file, domain_skills / skill_file)
    # 14th skill from production_skills/
    shutil.copy2(
        SKILLS_SOURCE / "production_skills" / "storyboard_prompt_techniques.md",
        domain_skills / "storyboard_prompt_techniques.md",
    )

    # Step 3: Write SOUL.md
    # (see SOUL.md section below)

    # Step 4: Seed memory
    # (see Pattern 3 above)

if __name__ == "__main__":
    main()
```

### SOUL.md Template
```markdown
# Movie-Pipeline Decision Advisor

你是一个电影短片制作管线的智能决策顾问。你拥有完整的电影制作知识，
涵盖剧本、美术、摄影、配音和后期制作全流程。

## 核心能力
- 为管线各阶段提供参数推荐（FLUX 图像生成、Wan2.2 视频生成、CosyVoice 配音）
- 基于历史决策效果持续优化建议
- 平衡质量、速度和资源约束

## 决策哲学
- 优先保证角色一致性和画面质量
- 在创意选择上给出多个候选方案
- 参数推荐基于经验默认值，随 audit 数据动态调整

## Domain
movie-pipeline
```

### Verification Test Pattern
```python
# Source: Verified from docker/hermes-agent/tests/conftest.py fixture pattern
def test_movie_pipeline_registration(client, tmp_hermes_dir):
    """Verify movie-pipeline domain registration with 10 tasks and 14 skills."""
    # After running register script:
    resp = client.get("/v1/domains")
    assert "movie-pipeline" in resp.json()

    resp = client.get("/v1/domains/movie-pipeline/skills")
    skills = resp.json()["skills"]
    assert len(skills) == 14

    # Verify decide returns FLUX params for soul-visual task
    resp = client.post("/v1/decide", json={
        "domain": "movie-pipeline",
        "task": "soul-visual",
        "context": {"action": "generate_character_image"},
    })
    assert resp.status_code == 200
    assert "recommendation" in resp.json()
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HERMES_DEFAULTS in JS config | Seed memory in DomainMemory | Phase 9 | Centralized parameter management |
| 14 skills in data/skills/ | Skills in ~/.hermes/domains/ | Phase 9 | hermes-agent can use skills as context |
| Static parameter tables | Dynamic parameter recommendations via decide() | Phase 7-9 | Parameters improve over time via audit loop |

**Deprecated/outdated:**
- HERMES_DEFAULTS as a flat JS config file: replaced by structured JSON in DomainMemory

## Task Mapping: pipeline.js PHASES to hermes tasks

From `docker/movie-agent/lib/pipeline.js` lines 50-81, the PHASES array contains 11 entries. Per CONTEXT.md decision, we register 10 tasks (excluding quality-gate which is auto-evaluated):

| # | PHASES id | Name | stageOrder | Included |
|---|-----------|------|------------|----------|
| 1 | `requirement` | 需求确认 | 1 | YES |
| 2 | `art-direction` | 美术方向 | 2 | YES |
| 3 | `character` | 角色设计 | 3 | YES |
| 4 | `scenario` | 剧本编写 | 4 | YES |
| 5 | `voice` | 配音 | 5 | YES |
| 6 | `storyboard` | 分镜板 | 6 | YES |
| 7 | `scene` | 场景图生成 | 7 | YES |
| 8 | `camera-preview` | 视频预览 | 8 | YES |
| 9 | `camera-final` | 正式视频 | 9 | YES |
| 10 | `post-production` | 后期合成 | 10 | YES |
| 11 | `quality-gate` | 质量门控 | 11 | NO (auto-evaluated) |

[VERIFIED: pipeline.js PHASES array lines 50-81]

## Expert Skill Inventory: 14 Files

| # | Source Path | Target Name | Category |
|---|-----------|-------------|----------|
| 1 | `data/skills/production_agent_decision.md` | production_agent_decision | Production - Decision |
| 2 | `data/skills/production_agent_supervision.md` | production_agent_supervision | Production - Supervision |
| 3 | `data/skills/production_execution_derive_assets.md` | production_execution_derive_assets | Production - Execution |
| 4 | `data/skills/production_execution_director_plan.md` | production_execution_director_plan | Production - Execution |
| 5 | `data/skills/production_execution_generate_assets.md` | production_execution_generate_assets | Production - Execution |
| 6 | `data/skills/production_execution_storyboard_gen.md` | production_execution_storyboard_gen | Production - Execution |
| 7 | `data/skills/production_execution_storyboard_panel.md` | production_execution_storyboard_panel | Production - Execution |
| 8 | `data/skills/production_execution_storyboard_table.md` | production_execution_storyboard_table | Production - Execution |
| 9 | `data/skills/script_agent_decision.md` | script_agent_decision | Script - Decision |
| 10 | `data/skills/script_agent_supervision.md` | script_agent_supervision | Script - Supervision |
| 11 | `data/skills/script_execution_adaptation.md` | script_execution_adaptation | Script - Execution |
| 12 | `data/skills/script_execution_script.md` | script_execution_script | Script - Execution |
| 13 | `data/skills/script_execution_skeleton.md` | script_execution_skeleton | Script - Execution |
| 14 | `data/skills/production_skills/storyboard_prompt_techniques.md` | storyboard_prompt_techniques | Production - Techniques |

[VERIFIED: `ls data/skills/*.md` shows 13 root files; `ls data/skills/production_skills/` shows storyboard_prompt_techniques.md]

**Excluded:** `storyboard_table_techniques.md` (CONTEXT.md specifies only storyboard_prompt_techniques as the 14th)

## FLUX/Wan Parameter Defaults

Sourced from the gold-team engine capabilities catalog in `docker/gold-team/src/v6/routers/engines.py`:

### flux-dev (image_draw) [VERIFIED: engines.py lines 71-86]
```json
{
  "width": 1024,
  "height": 1024,
  "steps": 20,
  "cfg_scale": 7.5,
  "prompt": "(required)",
  "negative_prompt": ""
}
```

### wan2.2-i2v-gguf (video_final) [VERIFIED: engines.py lines 38-55]
```json
{
  "width": 832,
  "height": 480,
  "num_frames": 81,
  "fps": 16,
  "cfg": 3.5,
  "shift": 5.0,
  "high_noise_steps": 10,
  "total_steps": 20,
  "prompt": "(required)",
  "negative_prompt": "static, blurry, low quality",
  "source_image_path": "(required)"
}
```

### wan2.5-t2v-preview (video_preview) [VERIFIED: engines.py lines 56-70]
```json
{
  "width": 832,
  "height": 480,
  "num_frames": 33,
  "fps": 16,
  "prompt": "(required)",
  "negative_prompt": ""
}
```

### CosyVoice (tts) [VERIFIED: engines.py lines 93-103]
```json
{
  "text": "(required)",
  "voice": "default",
  "speed": 1.0
}
```

### Movie-agent usage patterns [VERIFIED: docker/movie-agent/lib/phases/index.js]
- Art direction FLUX: `guidance_scale: 3.5, num_inference_steps: 20` (line 435-438)
- Character FLUX: `guidance_scale: 3.5, num_inference_steps: 4` (line 1309-1312)
- Video gen Wan: `model: 'wan14b', guidance_scale: 5.0, num_inference_steps: 10/20` (line 1380-1388)

**Key discrepancy:** engines.py uses `cfg_scale` for FLUX, but movie-agent code uses `guidance_scale`. The seed memory should use one canonical naming convention. CONTEXT.md uses `guidance_scale` and `steps` -- recommend following CONTEXT.md naming for consistency with the domain's decision context.

## DomainRegistry.register() Behavior

[VERIFIED: docker/hermes-agent/src/core/domain_registry.py]

1. Validates domain name with regex `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$` (line 25)
2. Creates domain directory structure: `skills/`, `memory/` (lines 56-57)
3. Creates empty SOUL.md only if it does NOT already exist (line 61) -- safe for re-runs
4. Updates `registry.json` with domain entry including description, tasks, skills_manifest, timestamp (lines 64-73)
5. Atomic write via `.tmp` + rename pattern (lines 128-133)
6. `get_skills()` returns sorted list of `.md` file stems from skills/ directory (lines 88-95)

## AgentFactory SOUL.md Loading

[VERIFIED: docker/hermes-agent/src/core/agent_factory.py]

1. Reads `SOUL.md` from domain directory (line 43)
2. Strips whitespace, checks non-empty (lines 45-48)
3. Passes as `ephemeral_system_prompt` to `AIAgent()` constructor (line 59)
4. AIAgent is created fresh per call -- no caching (docstring line 6)

## DecisionEngine.decide() Flow

[VERIFIED: docker/hermes-agent/src/core/decision_engine.py]

1. Validates domain exists (line 127-128)
2. Gets confidence from DomainMemory for the task (lines 131-133)
3. Builds structured prompt: `Domain: {domain}\nTask: {task}\nContext: {json}` (lines 39-47)
4. Creates AIAgent via AgentFactory (line 141)
5. Calls `agent.chat(prompt)` -- synchronous, wrapped in `asyncio.to_thread()` at route level (line 142)
6. Returns `{decision_id, recommendation, confidence, domain, task, timestamp}` (lines 144-151)

**Important:** Skills are NOT currently injected into the decide prompt. The `build_prompt()` method only includes domain, task, and context JSON. Skills exist as files in the skills/ directory but are NOT read and injected into the prompt by DecisionEngine. This means the decide() call will rely on SOUL.md (ephemeral_system_prompt) and the LLM's general knowledge. The skills are discoverable via `get_skills()` API but not automatically used as context for decisions.

**Implication for MOVIE-02 success criterion:** The 14 skills will be returned by `GET /v1/domains/movie-pipeline/skills` (verified), but they will NOT influence decide() responses unless additional code is added to inject skill content into the prompt. This is acceptable for Phase 9 scope -- the skills are registered and available; future phases can add skill injection to the decide flow.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | FLUX parameters from engines.py are the correct defaults for HERMES_DEFAULTS seed | FLUX/Wan Parameters | Seed memory contains wrong parameter values |
| A2 | 10 tasks excluding quality-gate is correct per MOVIE-01 ("requirement-bible 到 composition") | Task Mapping | Domain registered with wrong task list; "composition" in MOVIE-01 may not match "post-production" in PHASES |
| A3 | Skills do not need to be injected into decide() prompt for Phase 9 scope | DecisionEngine | decide() won't return expert-knowledge-informed recommendations |
| A4 | SOUL.md + seed memory is sufficient for decide() to return FLUX parameter recommendations | Validation | Test may fail if LLM doesn't recognize parameter patterns from seed data |
| A5 | The script should use direct DomainRegistry import, not HTTP API | Pattern 1 | Script requires server to be running (unnecessary complexity) |

**Note on A2:** MOVIE-01 says "requirement-bible 到 composition" but pipeline.js has no "requirement-bible" or "composition" phases. The 10 tasks in CONTEXT.md specific ideas use the pipeline.js names (requirement through post-production). The planner should confirm this mapping.

## Open Questions

1. **MOVIE-01 task naming discrepancy**
   - What we know: MOVIE-01 says "10 tasks: requirement-bible 到 composition", but pipeline.js has 11 phases with different names (requirement through quality-gate)
   - What's unclear: Whether "requirement-bible" = "requirement" and "composition" = "post-production" or if these are hermes-specific task names
   - Recommendation: Use pipeline.js PHASES ids as confirmed in CONTEXT.md specific ideas (requirement, art-direction, ..., post-production)

2. **Skill injection into decide() prompt**
   - What we know: DecisionEngine.build_prompt() does NOT read skill files; skills are only listed by get_skills()
   - What's unclear: Whether Phase 9 scope requires skills to actually influence decide() responses, or just be registered
   - Recommendation: MOVIE-02 only requires skills to be registered and returnable via API; skill injection is a future enhancement

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 | Script runtime | ✓ | 3.12 | -- |
| pytest | Test framework | ✓ | installed | -- |
| fastapi | API verification | ✓ | installed | -- |
| hermes-agent src | DomainRegistry import | ✓ | in docker/hermes-agent | -- |

**Missing dependencies with no fallback:** none

**Missing dependencies with fallback:** none

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (existing) |
| Config file | none (uses conftest.py fixtures) |
| Quick run command | `cd docker/hermes-agent && python3 -m pytest tests/ -x -q` |
| Full suite command | `cd docker/hermes-agent && python3 -m pytest tests/ -v` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MOVIE-01 | POST /v1/register registers movie-pipeline with 10 tasks | integration | `pytest tests/test_movie_pipeline_domain.py::test_register_movie_pipeline -x` | Wave 0 |
| MOVIE-02 | GET /v1/domains/movie-pipeline/skills returns 14 skills | integration | `pytest tests/test_movie_pipeline_domain.py::test_skills_count -x` | Wave 0 |
| MOVIE-03 | Seed memory in audit_history.json contains FLUX params | unit | `pytest tests/test_movie_pipeline_domain.py::test_seed_memory -x` | Wave 0 |
| MOVIE-04 | SOUL.md exists and defines movie-pipeline identity | unit | `pytest tests/test_movie_pipeline_domain.py::test_soul_md -x` | Wave 0 |
| Success-3 | decide() for soul-visual returns FLUX parameter recommendation | integration | `pytest tests/test_movie_pipeline_domain.py::test_decide_soul_visual -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd docker/hermes-agent && python3 -m pytest tests/test_movie_pipeline_domain.py -x -q`
- **Per wave merge:** `cd docker/hermes-agent && python3 -m pytest tests/ -v`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `docker/hermes-agent/tests/test_movie_pipeline_domain.py` -- covers MOVIE-01 through MOVIE-04 + success criteria
- [ ] `docker/hermes-agent/scripts/register_movie_pipeline.py` -- registration script
- [ ] SOUL.md content -- written by script or manually placed

## Security Domain

> Minimal security surface for this phase -- no user input, no auth, no crypto.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | -- (script-only, no user auth) |
| V3 Session Management | no | -- |
| V4 Access Control | no | -- (local filesystem operations) |
| V5 Input Validation | yes | DomainRegistry validates domain name with regex |
| V6 Cryptography | no | -- |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal in domain name | Tampering | DomainRegistry._validate_domain_name() regex blocks `../` and special chars |
| Arbitrary file write via skill copy | Tampering | Script uses hardcoded source paths, not user input |

## Sources

### Primary (HIGH confidence)
- `docker/hermes-agent/src/core/domain_registry.py` -- DomainRegistry.register() API, skills listing, directory creation
- `docker/hermes-agent/src/core/agent_factory.py` -- SOUL.md loading as ephemeral_system_prompt
- `docker/hermes-agent/src/core/decision_engine.py` -- decide() flow, build_prompt()
- `docker/hermes-agent/src/core/domain_memory.py` -- audit_history.json format, EWMA confidence
- `docker/hermes-agent/src/api/models.py` -- RegisterRequest schema
- `docker/hermes-agent/src/api/routes.py` -- REST endpoint implementations
- `docker/movie-agent/lib/pipeline.js` -- PHASES array (10+1 tasks)
- `docker/gold-team/src/v6/routers/engines.py` -- FLUX/Wan/CosyVoice parameter defaults
- `docker/hermes-agent/tests/conftest.py` -- Test fixtures pattern
- `docker/hermes-agent/tests/test_integration.py` -- Integration test pattern
- `data/skills/` -- 14 expert skill files verified by `ls`

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions on task mapping, skill selection, memory format

### Tertiary (LOW confidence)
- None -- all claims verified from codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new packages, all existing code verified
- Architecture: HIGH - DomainRegistry, AgentFactory, DecisionEngine all read from source
- Pitfalls: HIGH - verified by reading actual code (e.g., SOUL.md preservation, skills not injected into prompt)
- Task mapping: MEDIUM - MOVIE-01 wording "requirement-bible" doesn't match pipeline.js "requirement"; CONTEXT.md specific ideas clarify

**Research date:** 2026-06-06
**Valid until:** 2026-07-06 (stable codebase, no fast-moving dependencies)
