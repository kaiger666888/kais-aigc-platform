"""
Hermes Agent API -- FastAPI application entrypoint.

Creates the FastAPI app with CORS middleware, mounts the /v1 REST router,
and mounts the MCP ASGI app at "/" so the same process serves both
/v1/* REST endpoints and the /mcp streamable-http MCP endpoint.

Run with: python -m src.main  or  uvicorn src.main:app
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import router
from src.config import get_settings
from src.mcp.server import create_mcp_app

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------

settings = get_settings()
logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))

# ---------------------------------------------------------------------------
# MCP ASGI app -- constructed before FastAPI so we can adopt its lifespan
# ---------------------------------------------------------------------------

mcp_app = create_mcp_app()

# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------
#
# We pass mcp_app.router.lifespan_context as the FastAPI lifespan because
# FastMCP's streamable-http transport needs to initialize an asyncio task
# group at startup. Without it, every tools/call raises
# "Task group is not initialized. Make sure to use run()."
# (see modelcontextprotocol/python-sdk#1367). The existing app had no
# lifespan of its own, so adopting the MCP one is safe.
#
app = FastAPI(
    title="Hermes Agent API",
    version="1.0.0",
    description=(
        "Domain-agnostic intelligent decision engine. "
        "REST: /v1/*. MCP: /mcp (streamable-http)."
    ),
    lifespan=mcp_app.router.lifespan_context,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/v1")

# Mount MCP at "/" — internal FastMCP route is "/mcp", so the final
# externally-accessible URL is http://host:8080/mcp. Mounting at "/"
# lets MCP claim only /mcp while leaving FastAPI's own routes (/v1/*,
# /docs, /openapi.json, etc.) untouched.
app.mount("/", mcp_app)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port)
