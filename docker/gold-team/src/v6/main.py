"""kais-gold-team V6.0 — FastAPI application entry point."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from src.v6.engine.local_pool import get_local_pool
from src.v6.executor import get_executor
from src.v6.engines.mock import MockEngine
from src.v6.routers import tasks, engines, events, health

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# ComfyUI integration — controlled via env vars
COMFYUI_ENABLED = os.environ.get("COMFYUI_ENABLED", "false").lower() in ("true", "1", "yes")
COMFYUI_HOST = os.environ.get("COMFYUI_HOST", "127.0.0.1")
COMFYUI_PORT = int(os.environ.get("COMFYUI_PORT", "8188"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    executor = get_executor()

    # Always register mock engine for development
    executor.register_engine(MockEngine())

    # Register ComfyUI engine if available
    if COMFYUI_ENABLED:
        try:
            from src.v6.engines.comfyui import ComfyUIEngine
            comfyui = ComfyUIEngine(host=COMFYUI_HOST, port=COMFYUI_PORT)
            await comfyui.start()
            health = await comfyui.health()
            if health.get("available"):
                executor.register_engine(comfyui)
                logger.info("ComfyUI engine registered (online) → %s:%s", COMFYUI_HOST, COMFYUI_PORT)
            else:
                logger.warning("ComfyUI engine offline at %s:%s, using mock only", COMFYUI_HOST, COMFYUI_PORT)
        except ImportError:
            logger.warning("ComfyUIEngine not available, skipping")
        except Exception as e:
            logger.warning("ComfyUI engine init failed: %s", e)

    await executor.start()

    # Also start legacy local_pool for backward compat
    local_pool = get_local_pool()
    await local_pool.start()

    logger.info("kais-gold-team V6.0 started (engines: %s)", [e.engine_id for e in executor.list_engines()])
    yield
    # Shutdown
    await executor.stop()
    await local_pool.stop()
    logger.info("kais-gold-team V6.0 stopped")


app = FastAPI(
    title="kais-gold-team",
    description="Unified Execution Agent for KAIS AIGC Platform V6.0",
    version="6.0.0",
    lifespan=lifespan,
)

# Register routers
app.include_router(health.router)
app.include_router(tasks.router)
app.include_router(engines.router)
app.include_router(events.router)


if __name__ == "__main__":
    uvicorn.run(
        "src.v6.main:app",
        host="127.0.0.1",
        port=8002,
        reload=True,
    )
