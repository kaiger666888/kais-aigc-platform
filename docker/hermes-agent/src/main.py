"""
Hermes Agent API -- FastAPI application entrypoint.

Creates the FastAPI app with CORS middleware and mounts the /v1 router.
Run with: python -m src.main  or  uvicorn src.main:app
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import router
from src.config import get_settings

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------

settings = get_settings()
logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))

# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Hermes Agent API",
    version="1.0.0",
    description="Domain-agnostic intelligent decision engine",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/v1")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port)
