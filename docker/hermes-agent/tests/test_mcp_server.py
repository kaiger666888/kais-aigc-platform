"""Smoke tests for the MCP server exposing the Hermes decision engine.

Covers all 7 tools (domain_register / domain_list / domain_skills /
domain_memory / domain_decide / domain_audit / health_check) via the
FastMCP tool dispatcher directly — fast, no HTTP layer, no JSON-RPC.

For end-to-end JSON-RPC over streamable-http, see the integration test
at the bottom of this file (TestMCPOverStreamableHTTP). It mounts the
MCP app onto FastAPI and posts raw initialize/tools/call requests, the
same shape a real OpenClaw client would send.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

# Ensure src/ is importable (mirrors conftest.py)
SYS_PATH_ENTRY = str(Path(__file__).resolve().parent.parent)
if SYS_PATH_ENTRY not in sys.path:
    sys.path.insert(0, SYS_PATH_ENTRY)

from src.config import Settings
from src.core.agent_factory import AgentFactory
from src.core.decision_engine import DecisionEngine
from src.core.domain_registry import DomainRegistry
from src.api import deps
from src.main import app
from src.mcp import server as mcp_server


# ---------------------------------------------------------------------------
# Fixtures -- mirror conftest.py's pattern but for MCP tests
# ---------------------------------------------------------------------------


@pytest.fixture()
def tmp_hermes_dir(tmp_path: Path) -> Path:
    hermes_dir = tmp_path / "hermes"
    hermes_dir.mkdir()
    return hermes_dir


@pytest.fixture()
def registry(tmp_hermes_dir: Path) -> DomainRegistry:
    domains_dir = tmp_hermes_dir / "domains"
    domains_dir.mkdir()
    return DomainRegistry(base_dir=domains_dir)


@pytest.fixture()
def mock_agent() -> MagicMock:
    agent = MagicMock(spec=["chat"])
    agent.chat.return_value = "Test recommendation from mock agent"
    return agent


@pytest.fixture()
def agent_factory(mock_agent: MagicMock) -> MagicMock:
    factory = MagicMock(spec=AgentFactory)
    factory.get_agent.return_value = mock_agent
    return factory


@pytest.fixture()
def decision_engine(
    registry: DomainRegistry, agent_factory: MagicMock
) -> DecisionEngine:
    return DecisionEngine(registry=registry, agent_factory=agent_factory)


@pytest.fixture()
def wired_singletons(
    registry: DomainRegistry,
    agent_factory: MagicMock,
    decision_engine: DecisionEngine,
):
    """Wire the fixture instances into the deps module-cached singletons.

    mcp/server.py calls get_registry()/get_decision_engine() at tool-call
    time, so we override the cached singletons in src.api.deps directly.
    Restored after each test.
    """
    deps._registry_instance = registry
    deps._factory_instance = agent_factory
    deps._engine_instance = decision_engine
    yield
    deps._registry_instance = None
    deps._factory_instance = None
    deps._engine_instance = None


@pytest.fixture()
def call_tool():
    """Call an MCP tool by name and return its structured result.

    FastMCP in mcp 1.26.0 returns a list[TextContent] from call_tool()
    (newer SDKs wrap it in CallToolResult with structuredContent).
    We unwrap the single text item and JSON-parse it back to the dict
    the tool actually returned. Tools in this server always return a
    dict, so this is well-defined.
    """

    async def _call(name: str, **arguments):
        import json

        result = await mcp_server.mcp.call_tool(name, arguments)
        # result is list[TextContent]; first text item is the JSON payload
        if not result:
            raise RuntimeError(f"Tool {name} returned empty content")
        text = result[0].text
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"Tool {name} returned non-JSON content: {text!r}"
            ) from exc

    return _call


# ---------------------------------------------------------------------------
# Tool smoke tests
# ---------------------------------------------------------------------------


class TestDomainRegisterTool:
    """Tests for the domain_register MCP tool."""

    @pytest.mark.asyncio
    async def test_register_returns_registered_status(
        self, wired_singletons, call_tool
    ) -> None:
        result = await call_tool(
            "domain_register",
            domain="movie-pipeline",
            description="Test domain",
            tasks=["requirement", "scene"],
            skills_manifest={"skill1": {}},
        )
        assert result["domain"] == "movie-pipeline"
        assert result["status"] == "registered"
        assert "registered successfully" in result["message"]

    @pytest.mark.asyncio
    async def test_register_rejects_invalid_name(
        self, wired_singletons, call_tool
    ) -> None:
        with pytest.raises(Exception):
            # "../bad" fails the domain-name regex
            await call_tool(
                "domain_register",
                domain="../bad",
                description="bad",
                tasks=[],
            )


class TestDomainListTool:
    """Tests for the domain_list MCP tool."""

    @pytest.mark.asyncio
    async def test_list_empty_initially(self, wired_singletons, call_tool) -> None:
        result = await call_tool("domain_list")
        assert result == {"domains": []}

    @pytest.mark.asyncio
    async def test_list_after_register(self, wired_singletons, call_tool) -> None:
        await call_tool(
            "domain_register",
            domain="domain-a",
            description="A",
            tasks=["t1"],
        )
        await call_tool(
            "domain_register",
            domain="domain-b",
            description="B",
            tasks=["t2"],
        )
        result = await call_tool("domain_list")
        assert set(result["domains"]) == {"domain-a", "domain-b"}


class TestDomainSkillsTool:
    """Tests for the domain_skills MCP tool."""

    @pytest.mark.asyncio
    async def test_skills_empty_for_new_domain(
        self, wired_singletons, call_tool
    ) -> None:
        await call_tool(
            "domain_register",
            domain="d1",
            description="d",
            tasks=["t1"],
        )
        result = await call_tool("domain_skills", domain="d1")
        assert result == {"domain": "d1", "skills": []}

    @pytest.mark.asyncio
    async def test_skills_lists_md_files(
        self, wired_singletons, call_tool, registry
    ) -> None:
        await call_tool(
            "domain_register",
            domain="d1",
            description="d",
            tasks=["t1"],
        )
        # Drop skill files directly into the registry (mimics what
        # scripts/register_movie_pipeline.py does at install time)
        skills_dir = registry.base_dir / "d1" / "skills"
        (skills_dir / "storyboard.md").write_text("# storyboard")
        (skills_dir / "scene.md").write_text("# scene")
        result = await call_tool("domain_skills", domain="d1")
        assert set(result["skills"]) == {"storyboard", "scene"}

    @pytest.mark.asyncio
    async def test_skills_404_for_unknown_domain(
        self, wired_singletons, call_tool
    ) -> None:
        with pytest.raises(Exception):
            await call_tool("domain_skills", domain="never-registered")


class TestDomainDecideTool:
    """Tests for the domain_decide MCP tool."""

    @pytest.mark.asyncio
    async def test_decide_returns_full_decision_dict(
        self, wired_singletons, call_tool
    ) -> None:
        await call_tool(
            "domain_register",
            domain="d1",
            description="d",
            tasks=["scene"],
        )
        result = await call_tool(
            "domain_decide",
            domain="d1",
            task="scene",
            context={"scene_description": "night exterior"},
        )
        assert result["domain"] == "d1"
        assert result["task"] == "scene"
        assert result["recommendation"] == "Test recommendation from mock agent"
        assert "decision_id" in result
        assert isinstance(result["confidence"], float)
        assert "timestamp" in result

    @pytest.mark.asyncio
    async def test_decide_rejects_unknown_domain(
        self, wired_singletons, call_tool
    ) -> None:
        with pytest.raises(Exception):
            await call_tool(
                "domain_decide",
                domain="never-registered",
                task="x",
                context={},
            )


class TestDomainAuditTool:
    """Tests for the domain_audit MCP tool."""

    @pytest.mark.asyncio
    async def test_audit_writes_record_and_returns_recorded(
        self, wired_singletons, call_tool, registry
    ) -> None:
        await call_tool(
            "domain_register",
            domain="d1",
            description="d",
            tasks=["scene"],
        )
        # Decide first to get a decision_id
        decide = await call_tool(
            "domain_decide",
            domain="d1",
            task="scene",
            context={},
        )
        decision_id = decide["decision_id"]

        result = await call_tool(
            "domain_audit",
            domain="d1",
            decision_id=decision_id,
            outcome="completed",
            metrics={"task": "scene", "score": 8},
        )
        assert result["recorded"] is True
        assert result["decision_id"] == decision_id
        # audit_history.json should now exist on disk
        history_path = registry.base_dir / "d1" / "memory" / "audit_history.json"
        assert history_path.exists()


class TestHealthCheckTool:
    """Tests for the health_check MCP tool."""

    @pytest.mark.asyncio
    async def test_health_reports_zero_domains_initially(
        self, wired_singletons, call_tool
    ) -> None:
        result = await call_tool("health_check")
        assert result["status"] == "ok"
        assert result["engine"] == "hermes-agent"
        assert result["domains_count"] == 0
        assert result["domains"] == []


# ---------------------------------------------------------------------------
# End-to-end JSON-RPC over streamable-http
# ---------------------------------------------------------------------------


class TestMCPOverStreamableHTTP:
    """Verify the MCP app actually serves tools/call over HTTP.

    Mirrors what an OpenClaw client would do: POST initialize, capture
    session_id, POST tools/list and tools/call with that session.
    """

    @pytest.fixture()
    def http_client(
        self,
        registry: DomainRegistry,
        agent_factory: MagicMock,
        decision_engine: DecisionEngine,
    ):
        """Build a fresh FastAPI app per test so the MCP lifespan is clean.

        We can't reuse src.main.app because its captured mcp_app's lifespan
        can only fire once across the process (StreamableHTTPSessionManager
        enforces single .run()). Each test rebuilds a tiny FastAPI app
        wired to the test fixtures, mirroring src/main.py's mount strategy.
        """
        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware

        from src.api.routes import router as v1_router
        from src.mcp.server import create_mcp_app

        # Wire deps module singletons so mcp/server.py tools pick them up
        deps._registry_instance = registry
        deps._factory_instance = agent_factory
        deps._engine_instance = decision_engine

        mcp_app = create_mcp_app()
        test_app = FastAPI(lifespan=mcp_app.router.lifespan_context)
        test_app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        test_app.include_router(v1_router, prefix="/v1")
        test_app.mount("/", mcp_app)

        with TestClient(test_app) as client:
            yield client

        deps._registry_instance = None
        deps._factory_instance = None
        deps._engine_instance = None

    @staticmethod
    def _post_mcp(client: TestClient, payload: dict, session_id: str | None = None):
        headers = {"Accept": "application/json, text/event-stream"}
        if session_id:
            headers["mcp-session-id"] = session_id
        return client.post("/mcp", json=payload, headers=headers)

    def test_initialize_returns_session(self, http_client) -> None:
        """POST /mcp initialize returns 200 and an mcp-session-id header."""
        resp = self._post_mcp(
            http_client,
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "pytest", "version": "0.1"},
                },
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("mcp-session-id")

    def test_tools_list_includes_hermes_tools(self, http_client) -> None:
        """tools/list returns all 7 hermes decision tools."""
        init = self._post_mcp(
            http_client,
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "pytest", "version": "0.1"},
                },
            },
        )
        session_id = init.headers["mcp-session-id"]
        resp = self._post_mcp(
            http_client,
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            session_id=session_id,
        )
        assert resp.status_code == 200
        # SSE: extract first data: line and parse
        data_line = next(
            (l for l in resp.text.splitlines() if l.startswith("data:")), None
        )
        assert data_line, f"No data line in response: {resp.text!r}"
        import json

        payload = json.loads(data_line[len("data:") :].strip())
        tool_names = {t["name"] for t in payload["result"]["tools"]}
        assert tool_names == {
            "domain_register",
            "domain_list",
            "domain_skills",
            "domain_memory",
            "domain_decide",
            "domain_audit",
            "health_check",
        }

    def test_rest_still_works_alongside_mcp(self, http_client) -> None:
        """Existing REST endpoint /v1/health is not broken by MCP mount."""
        resp = http_client.get("/v1/health")
        assert resp.status_code == 200
        assert resp.json()["engine"] == "hermes-agent"
