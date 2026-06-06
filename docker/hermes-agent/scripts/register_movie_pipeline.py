#!/usr/bin/env python3
"""Register movie-pipeline domain with hermes-agent.

Creates the domain with 10 pipeline tasks, writes SOUL.md defining the
domain identity as a film production decision advisor, and injects
HERMES_DEFAULTS parameter defaults as seed memory into audit_history.json.

Usage:
    python3 scripts/register_movie_pipeline.py

Idempotent: re-running preserves existing SOUL.md and appends to memory.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------

# Project root: scripts/ -> docker/hermes-agent/ -> docker/ -> workspace root
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
HERMES_ROOT = Path(__file__).resolve().parent.parent  # docker/hermes-agent/

# Make hermes-agent src importable via 'from src.core...'
_hermes_root_str = str(HERMES_ROOT)
if _hermes_root_str not in sys.path:
    sys.path.insert(0, _hermes_root_str)

from src.core.domain_registry import DomainRegistry  # noqa: E402
from src.config import Settings  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# 10 pipeline tasks from pipeline.js PHASES (excluding quality-gate)
TASKS = [
    "requirement",
    "art-direction",
    "character",
    "scenario",
    "voice",
    "storyboard",
    "scene",
    "camera-preview",
    "camera-final",
    "post-production",
]

# Skills manifest: art/story styles are references only (not copied in this plan)
SKILLS_MANIFEST = {
    "art_styles": {"count": 11, "path": "data/skills/art_skills/"},
    "story_types": {"count": 11, "path": "data/skills/story_skills/"},
}

DOMAIN = "movie-pipeline"
DESCRIPTION = "AI short film production pipeline - intelligent decision engine"

# 14 expert skill files: 13 root-level + 1 from production_skills
SKILL_FILES = [
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
    "storyboard_prompt_techniques.md",
]

SKILLS_SOURCE = PROJECT_ROOT / "data" / "skills"

SOUL_MD_CONTENT = """\
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
"""

SEED_MEMORY: dict = {
    "soul-visual": {
        "records": [
            {
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
                    },
                },
                "timestamp": "2026-06-06T00:00:00+00:00",
            }
        ],
        "ewma_confidence": 0.0,
    },
    "video-gen": {
        "records": [
            {
                "decision_id": "seed-wan-001",
                "outcome": "seed",
                "metrics": {
                    "task": "video-gen",
                    "score": 7,
                    "params": {
                        "wan": {
                            "width": 832,
                            "height": 480,
                            "num_frames": 81,
                            "fps": 16,
                            "cfg": 3.5,
                            "shift": 5.0,
                            "total_steps": 20,
                        }
                    },
                },
                "timestamp": "2026-06-06T00:00:00+00:00",
            }
        ],
        "ewma_confidence": 0.0,
    },
    "voice": {
        "records": [
            {
                "decision_id": "seed-tts-001",
                "outcome": "seed",
                "metrics": {
                    "task": "voice",
                    "score": 7,
                    "params": {
                        "tts": {
                            "voice": "default",
                            "speed": 1.0,
                        }
                    },
                },
                "timestamp": "2026-06-06T00:00:00+00:00",
            }
        ],
        "ewma_confidence": 0.0,
    },
}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    """Register movie-pipeline domain with hermes-agent."""
    settings = Settings()
    domains_dir = settings.hermes_home / "domains"

    registry = DomainRegistry(base_dir=domains_dir)

    # Step 1: Register domain with 10 tasks
    registry.register(
        domain=DOMAIN,
        description=DESCRIPTION,
        tasks=TASKS,
        skills_manifest=SKILLS_MANIFEST,
    )
    print(f"[OK] Registered domain '{DOMAIN}' with {len(TASKS)} tasks")

    domain_dir = domains_dir / DOMAIN

    # Step 2: Copy 14 expert skill files to domain skills directory
    domain_skills_dir = domain_dir / "skills"
    copied = 0
    for filename in SKILL_FILES[:13]:
        src = SKILLS_SOURCE / filename
        dst = domain_skills_dir / filename
        shutil.copy2(src, dst)
        print(f"  [COPY] {filename}")
        copied += 1
    # 14th skill from production_skills/
    shutil.copy2(
        SKILLS_SOURCE / "production_skills" / "storyboard_prompt_techniques.md",
        domain_skills_dir / "storyboard_prompt_techniques.md",
    )
    print(f"  [COPY] storyboard_prompt_techniques.md (from production_skills/)")
    copied += 1
    print(f"[OK] Copied {copied} skill files to {domain_skills_dir}")

    # Step 3: Write SOUL.md only if it does not already exist
    soul_path = domain_dir / "SOUL.md"
    if not soul_path.exists():
        soul_path.write_text(SOUL_MD_CONTENT, encoding="utf-8")
        print(f"[OK] Written SOUL.md to {soul_path}")
    else:
        existing = soul_path.read_text(encoding="utf-8").strip()
        if not existing:
            # DomainRegistry created an empty SOUL.md -- write actual content
            soul_path.write_text(SOUL_MD_CONTENT, encoding="utf-8")
            print(f"[OK] Written SOUL.md content to {soul_path}")
        else:
            print(f"[SKIP] SOUL.md already exists with content, not overwriting")

    # Step 4: Write seed memory to audit_history.json
    memory_dir = domain_dir / "memory"
    history_path = memory_dir / "audit_history.json"

    if history_path.exists():
        try:
            existing_data = json.loads(history_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing_data = {}
    else:
        existing_data = {}

    # Merge seed data: only add tasks that don't already have records
    for task, seed_entry in SEED_MEMORY.items():
        if task not in existing_data:
            existing_data[task] = seed_entry

    # Atomic write
    memory_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = history_path.with_suffix(".tmp")
    tmp_path.write_text(
        json.dumps(existing_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    tmp_path.replace(history_path)

    seeded_tasks = [t for t in SEED_MEMORY if t in existing_data]
    print(f"[OK] Seed memory written for {len(seeded_tasks)} tasks: {', '.join(seeded_tasks)}")

    # Summary
    print(f"\n=== Registration Summary ===")
    print(f"Domain: {DOMAIN}")
    print(f"Tasks: {len(TASKS)} ({', '.join(TASKS)})")
    print(f"Skills: {copied} files in {domain_skills_dir}")
    print(f"SOUL.md: {soul_path}")
    print(f"Seed memory: {len(seeded_tasks)} tasks in {history_path}")


if __name__ == "__main__":
    main()
