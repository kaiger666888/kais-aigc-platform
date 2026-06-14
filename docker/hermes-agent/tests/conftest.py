"""
Shared test fixtures for Hermes Agent test suite.

Provides:
- tmp_hermes_dir: temp directory for domain storage
- registry: DomainRegistry backed by temp directory
- mock_agent: MagicMock AIAgent with chat() returning fixed string
- agent_factory: mock AgentFactory returning mock_agent
- decision_engine: DecisionEngine with registry and agent_factory
- client: FastAPI TestClient with dependency overrides
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

# Ensure src/ is importable
SYS_PATH_ENTRY = str(Path(__file__).resolve().parent.parent)
if SYS_PATH_ENTRY not in sys.path:
    sys.path.insert(0, SYS_PATH_ENTRY)

from src.config import Settings
from src.core.agent_factory import AgentFactory
from src.core.decision_engine import DecisionEngine
from src.core.domain_registry import DomainRegistry
from src.api import deps
from src.main import app


# ---------------------------------------------------------------------------
# Filesystem fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def tmp_hermes_dir(tmp_path: Path) -> Path:
    """Provide a temporary directory for hermes domain storage."""
    hermes_dir = tmp_path / "hermes"
    hermes_dir.mkdir()
    return hermes_dir


@pytest.fixture()
def registry(tmp_hermes_dir: Path) -> DomainRegistry:
    """Provide a DomainRegistry backed by a temp directory."""
    domains_dir = tmp_hermes_dir / "domains"
    domains_dir.mkdir()
    return DomainRegistry(base_dir=domains_dir)


# ---------------------------------------------------------------------------
# Mock agent fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_agent() -> MagicMock:
    """Provide a mock AIAgent with chat() returning a fixed string."""
    agent = MagicMock(spec=["chat"])
    agent.chat.return_value = "Test recommendation from mock agent"
    return agent


@pytest.fixture()
def agent_factory(mock_agent: MagicMock) -> MagicMock:
    """Provide a mock AgentFactory whose get_agent returns mock_agent."""
    factory = MagicMock(spec=AgentFactory)
    factory.get_agent.return_value = mock_agent
    return factory


@pytest.fixture()
def decision_engine(
    registry: DomainRegistry, agent_factory: MagicMock
) -> DecisionEngine:
    """Provide a DecisionEngine with registry and mock agent_factory."""
    return DecisionEngine(registry=registry, agent_factory=agent_factory)


# ---------------------------------------------------------------------------
# FastAPI TestClient fixture with dependency overrides
# ---------------------------------------------------------------------------


@pytest.fixture()
def client(
    registry: DomainRegistry,
    agent_factory: MagicMock,
    decision_engine: DecisionEngine,
) -> TestClient:
    """Provide a FastAPI TestClient with dependency overrides.

    Builds a fresh FastAPI app per test (mirroring src/main.py's
    construction) instead of reusing the module-level singleton. This is
    required because src/main.py now mounts a FastMCP ASGI app whose
    StreamableHTTPSessionManager can only run() once per instance —
    reusing the same app across multiple TestClient lifespan entries
    raises "StreamableHTTPSessionManager.run() can only be called once".

    Overrides get_registry, get_agent_factory, get_decision_engine to
    return the fixture instances instead of production singletons.
    """
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    from src.api.routes import router as v1_router
    from src.mcp.server import create_mcp_app

    # Wire the deps module singletons so the MCP tools (which look them
    # up via get_registry() / get_decision_engine() at call time) see the
    # fixture instances. Same trick as test_mcp_server.py.
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

    # Also wire REST dependency overrides (the routes use Depends(get_*))
    test_app.dependency_overrides[deps.get_registry] = lambda: registry
    test_app.dependency_overrides[deps.get_agent_factory] = lambda: agent_factory
    test_app.dependency_overrides[deps.get_decision_engine] = (
        lambda: decision_engine
    )

    with TestClient(test_app) as test_client:
        yield test_client

    # Clean up module-level singleton overrides after test
    deps._registry_instance = None
    deps._factory_instance = None
    deps._engine_instance = None
