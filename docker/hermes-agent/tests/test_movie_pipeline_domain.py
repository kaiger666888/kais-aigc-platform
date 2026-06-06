"""
Tests for movie-pipeline domain registration, SOUL.md, and seed memory.

Covers MOVIE-01 (10 tasks), MOVIE-03 (seed memory), MOVIE-04 (SOUL.md identity).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.core.domain_memory import DomainMemory
from src.core.domain_registry import DomainRegistry

import shutil

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

# SOUL.md content for movie-pipeline domain identity
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

# Seed memory data for three generation tasks
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


class TestMoviePipelineDomain:
    """Verify movie-pipeline domain registration, SOUL.md, and seed memory."""

    def test_register_movie_pipeline(self, registry: DomainRegistry) -> None:
        """Register movie-pipeline domain with exactly 10 tasks."""
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

        assert registry.domain_exists("movie-pipeline") is True
        entry = registry.get("movie-pipeline")
        assert entry is not None
        assert entry["tasks"] == TASKS
        assert len(entry["tasks"]) == 10

    def test_soul_md_exists(
        self, registry: DomainRegistry, tmp_hermes_dir: Path
    ) -> None:
        """After registration, SOUL.md file exists in domain directory."""
        registry.register(
            domain="movie-pipeline",
            description="AI short film pipeline",
            tasks=TASKS,
            skills_manifest={},
        )

        soul_path = tmp_hermes_dir / "domains" / "movie-pipeline" / "SOUL.md"
        assert soul_path.exists(), "SOUL.md should be created by DomainRegistry.register()"

    def test_soul_md_content(
        self, registry: DomainRegistry, tmp_hermes_dir: Path
    ) -> None:
        """Write and verify SOUL.md content for movie-pipeline domain."""
        registry.register(
            domain="movie-pipeline",
            description="AI short film pipeline",
            tasks=TASKS,
            skills_manifest={},
        )

        soul_path = tmp_hermes_dir / "domains" / "movie-pipeline" / "SOUL.md"

        # Write the actual SOUL.md content (as the registration script does)
        soul_path.write_text(SOUL_MD_CONTENT, encoding="utf-8")

        content = soul_path.read_text(encoding="utf-8")
        assert "movie-pipeline" in content
        assert "决策顾问" in content  # Chinese: decision advisor
        # Must reference at least one engine
        assert any(
            kw in content for kw in ("FLUX", "Wan2.2", "CosyVoice")
        ), "SOUL.md must reference at least one generation engine"

    def test_seed_memory_content(
        self, registry: DomainRegistry, tmp_hermes_dir: Path
    ) -> None:
        """Write seed audit_history.json and verify DomainMemory reads it."""
        registry.register(
            domain="movie-pipeline",
            description="AI short film pipeline",
            tasks=TASKS,
            skills_manifest={},
        )

        memory_dir = tmp_hermes_dir / "domains" / "movie-pipeline" / "memory"
        domain_memory = DomainMemory(memory_dir)

        # Write seed memory (as the registration script does)
        domain_memory._save_history(SEED_MEMORY)

        # Verify via DomainMemory._load_history()
        history = domain_memory._load_history()

        # soul-visual
        assert "soul-visual" in history
        sv_records = history["soul-visual"]["records"]
        assert len(sv_records) == 1
        assert sv_records[0]["metrics"]["params"]["flux"]["steps"] == 20
        assert sv_records[0]["metrics"]["params"]["flux"]["guidance_scale"] == 3.5

        # video-gen
        assert "video-gen" in history
        vg_records = history["video-gen"]["records"]
        assert len(vg_records) == 1
        assert vg_records[0]["metrics"]["params"]["wan"]["width"] == 832
        assert vg_records[0]["metrics"]["params"]["wan"]["total_steps"] == 20

        # voice
        assert "voice" in history
        v_records = history["voice"]["records"]
        assert len(v_records) == 1
        assert v_records[0]["metrics"]["params"]["tts"]["voice"] == "default"
        assert v_records[0]["metrics"]["params"]["tts"]["speed"] == 1.0

    def test_seed_memory_confidence_zero(
        self, registry: DomainRegistry, tmp_hermes_dir: Path
    ) -> None:
        """After seeding with 1 record per task, EWMA confidence is 0.0."""
        registry.register(
            domain="movie-pipeline",
            description="AI short film pipeline",
            tasks=TASKS,
            skills_manifest={},
        )

        memory_dir = tmp_hermes_dir / "domains" / "movie-pipeline" / "memory"
        domain_memory = DomainMemory(memory_dir)
        domain_memory._save_history(SEED_MEMORY)

        # With only 1 seed record (< MIN_AUDITS_FOR_CONFIDENCE=3),
        # confidence must be 0.0
        assert domain_memory.get_confidence("soul-visual") == 0.0
        assert domain_memory.get_confidence("video-gen") == 0.0
        assert domain_memory.get_confidence("voice") == 0.0

    def test_api_domain_registered(self, client: TestClient) -> None:
        """Register movie-pipeline via API and verify domain list."""
        resp = client.post(
            "/v1/register",
            json={
                "domain": "movie-pipeline",
                "description": "AI short film production pipeline - intelligent decision engine",
                "tasks": TASKS,
                "skills_manifest": {
                    "art_styles": {"count": 11, "path": "data/skills/art_skills/"},
                    "story_types": {"count": 11, "path": "data/skills/story_skills/"},
                },
            },
        )
        assert resp.status_code == 201

        # Verify domain appears in domain list
        resp = client.get("/v1/domains")
        assert resp.status_code == 200
        assert "movie-pipeline" in resp.json()

        # Verify skills endpoint works (returns empty list since no skill files copied)
        resp = client.get("/v1/domains/movie-pipeline/skills")
        assert resp.status_code == 200
        data = resp.json()
        assert "skills" in data

    # --- 14 skill file migration tests (Plan 02 / MOVIE-02) ---

    # 14 skill files: 13 root + 1 from production_skills
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

    PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
    SKILLS_SOURCE = PROJECT_ROOT / "data" / "skills"

    def _copy_skill_files(self, dest_dir: Path) -> None:
        """Copy 14 skill .md files to the given directory (mirrors registration script)."""
        dest_dir.mkdir(parents=True, exist_ok=True)
        for filename in self.SKILL_FILES[:13]:
            shutil.copy2(self.SKILLS_SOURCE / filename, dest_dir / filename)
        shutil.copy2(
            self.SKILLS_SOURCE / "production_skills" / "storyboard_prompt_techniques.md",
            dest_dir / "storyboard_prompt_techniques.md",
        )

    def test_skills_count_14(
        self, registry: DomainRegistry, tmp_hermes_dir: Path
    ) -> None:
        """After copying 14 skill files, get_skills() returns 14 names."""
        registry.register(
            domain="movie-pipeline",
            description="AI short film pipeline",
            tasks=TASKS,
            skills_manifest={},
        )
        skills_dir = tmp_hermes_dir / "domains" / "movie-pipeline" / "skills"
        self._copy_skill_files(skills_dir)

        skills = registry.get_skills("movie-pipeline")
        assert len(skills) == 14

    def test_skills_names(
        self, registry: DomainRegistry, tmp_hermes_dir: Path
    ) -> None:
        """The 14 skill names match the expected list (no storyboard_table_techniques)."""
        registry.register(
            domain="movie-pipeline",
            description="AI short film pipeline",
            tasks=TASKS,
            skills_manifest={},
        )
        skills_dir = tmp_hermes_dir / "domains" / "movie-pipeline" / "skills"
        self._copy_skill_files(skills_dir)

        expected_names = sorted([
            "production_agent_decision",
            "production_agent_supervision",
            "production_execution_derive_assets",
            "production_execution_director_plan",
            "production_execution_generate_assets",
            "production_execution_storyboard_gen",
            "production_execution_storyboard_panel",
            "production_execution_storyboard_table",
            "script_agent_decision",
            "script_agent_supervision",
            "script_execution_adaptation",
            "script_execution_script",
            "script_execution_skeleton",
            "storyboard_prompt_techniques",
        ])
        skills = registry.get_skills("movie-pipeline")
        assert sorted(skills) == expected_names

    def test_skills_api(
        self, client: TestClient, tmp_hermes_dir: Path
    ) -> None:
        """GET /v1/domains/movie-pipeline/skills returns 14 skills via API."""
        resp = client.post(
            "/v1/register",
            json={
                "domain": "movie-pipeline",
                "description": "AI short film production pipeline",
                "tasks": TASKS,
                "skills_manifest": {},
            },
        )
        assert resp.status_code == 201

        skills_dir = tmp_hermes_dir / "domains" / "movie-pipeline" / "skills"
        self._copy_skill_files(skills_dir)

        resp = client.get("/v1/domains/movie-pipeline/skills")
        assert resp.status_code == 200
        data = resp.json()
        assert data["domain"] == "movie-pipeline"
        assert len(data["skills"]) == 14

    def test_decide_soul_visual(self, client: TestClient) -> None:
        """POST /v1/decide for movie-pipeline soul-visual returns valid response."""
        client.post(
            "/v1/register",
            json={
                "domain": "movie-pipeline",
                "description": "AI short film production pipeline",
                "tasks": TASKS,
                "skills_manifest": {},
            },
        )

        resp = client.post(
            "/v1/decide",
            json={
                "domain": "movie-pipeline",
                "task": "soul-visual",
                "context": {"action": "generate_character_image"},
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "decision_id" in data
        assert "recommendation" in data
        assert "confidence" in data
        assert data["confidence"] == 0.0
        assert data["domain"] == "movie-pipeline"
        assert data["task"] == "soul-visual"

    def test_skill_files_exist_on_disk(
        self, registry: DomainRegistry, tmp_hermes_dir: Path
    ) -> None:
        """All 14 .md files physically exist in the domain skills directory."""
        registry.register(
            domain="movie-pipeline",
            description="AI short film pipeline",
            tasks=TASKS,
            skills_manifest={},
        )
        skills_dir = tmp_hermes_dir / "domains" / "movie-pipeline" / "skills"
        self._copy_skill_files(skills_dir)

        for filename in self.SKILL_FILES:
            assert (skills_dir / filename).exists(), f"Missing: {filename}"
