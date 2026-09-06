"""kais-gold-team V6.0 — FastAPI application entry point."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI

from src.v6.engine.local_pool import get_local_pool
from src.v6.engine_pool import EnginePool, get_engine_pool
from src.v6.engines.base import BackendType
from src.v6.executor import get_executor
from src.v6.engines.mock import MockEngine
# 三轨 TTS 引擎面已退役（2026-09-06）：TripleTrackTTSEngine（tts_http.py）与
# TTSTracker（tts.py，纯三轨壳）已整体删除；现役 TTS = Breeze :5130
# （宿主 systemd，不在本仓）+ KAP qwenTts 路由。
from src.v6.engines.hunyuan3d import Hunyuan3DEngine
from src.v6.engines.hunyuan3d_mv import Hunyuan3DMvEngine
from src.v6.engines.color_grade import ColorGradeEngine
from src.v6.gpu_monitor import get_gpu_vram_usage
from src.v6.middleware.gpu_guard import GPUGuardMiddleware
from src.v6.routers import tasks, engines, events, health

# GPU management routes
from src.v6.routes.v1.gpu import router as gpu_router

# Unified TTS server 子进程托管已随三轨 TTS 退役移除（2026-09-06）——
# scripts/tts_unified_server.py 已删除，无需再管理其生命周期。

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# ComfyUI integration — controlled via env vars
COMFYUI_ENABLED = os.environ.get("COMFYUI_ENABLED", "false").lower() in ("true", "1", "yes")
COMFYUI_HOST = os.environ.get("COMFYUI_HOST", "127.0.0.1")
COMFYUI_PORT = int(os.environ.get("COMFYUI_PORT", "8188"))

# Dual ComfyUI instances (V9 MEGAPAK)
COMFYUI_PRIMARY_HOST = os.environ.get("COMFYUI_PRIMARY_HOST", "")
COMFYUI_PRIMARY_PORT = int(os.environ.get("COMFYUI_PRIMARY_PORT", "8188"))
COMFYUI_AUX_HOST = os.environ.get("COMFYUI_AUX_HOST", "")
COMFYUI_AUX_PORT = int(os.environ.get("COMFYUI_AUX_PORT", "8189"))


def _format_registration_summary(executor) -> str:
    """Build a grouped registration summary string organised by backend type.

    Returns a multi-line string like:
        [COMFYUI]
          comfyui-primary — ComfyUI (primary)
          comfyui-auxiliary — ComfyUI (auxiliary)
        [SUBPROCESS]
          facefusion-engine — FaceFusion (SUBPROCESS 示例)
        ...
    Empty sections are omitted.
    """
    section_order = [
        BackendType.COMFYUI,
        BackendType.SUBPROCESS,
        BackendType.CLOUD,
        BackendType.DOCKER,
        BackendType.MOCK,
    ]
    groups: dict[BackendType, list[tuple[str, str]]] = {bt: [] for bt in section_order}
    for engine in executor.list_engines():
        bt = engine.backend_type
        groups.setdefault(bt, []).append((engine.engine_id, engine.name))

    lines: list[str] = []
    for bt in section_order:
        entries = groups.get(bt, [])
        if not entries:
            continue
        lines.append(f"[{bt.value.upper()}]")
        for eid, name in entries:
            lines.append(f"  {eid} — {name}")

    return "\n".join(lines)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    executor = get_executor()

    # ── Mock ────────────────────────────────────────────────────────────
    # Always register mock engine for development
    executor.register_engine(MockEngine())

    # ── TTS 引擎注册已随三轨退役移除（2026-09-06）──────────────────────
    # 原 TripleTrackTTSEngine / TTSTracker 注册块与 tts_unified_server
    # 子进程拉起块整块删除；本仓不再托管 TTS 推理
    # （现役 TTS = Breeze :5130 宿主 systemd + KAP qwenTts 路由，均在仓外）。

    # Register Hunyuan3D-2 engine (image-to-3D via subprocess)
    try:
        hunyuan_engine = Hunyuan3DEngine()
        await hunyuan_engine.start()
        executor.register_engine(hunyuan_engine)
        logger.info("Hunyuan3D engine registered")
    except Exception as e:
        logger.warning("Hunyuan3D engine init failed: %s", e)

    # Register Hunyuan3D-2mv engine (multiview image-to-3D via subprocess)
    try:
        hunyuan_mv_engine = Hunyuan3DMvEngine()
        await hunyuan_mv_engine.start()
        executor.register_engine(hunyuan_mv_engine)
        logger.info("Hunyuan3D-2mv engine registered")
    except Exception as e:
        logger.warning("Hunyuan3D-2mv engine init failed: %s", e)

    # ── Color Grade engine (CPU-only ffmpeg + LUT) ─────────────────────
    try:
        color_grade_engine = ColorGradeEngine()
        await color_grade_engine.start()
        executor.register_engine(color_grade_engine)
        logger.info("Color Grade engine registered")
    except Exception as e:
        logger.warning("Color Grade engine init failed: %s", e)

    # ── Docker Backend ──────────────────────────────────────────────────
    # NOTE: ACE-Step standalone engine removed in v1.5 (commit history).
    # Music generation now runs entirely through ComfyUI workflows via the
    # Node-layer routes (/api/v1/ace/generate → ComfyUI /prompt). The
    # docker/gold-team/src/v6/engines/acestep.py module is deleted; this
    # block no longer attempts to register an ACE-Step engine.

    # ── ComfyUI Backend ─────────────────────────────────────────────────
    # Register ComfyUI engine(s)
    # Dual-engine mode when COMFYUI_PRIMARY_HOST is set; otherwise legacy single-engine fallback
    if COMFYUI_ENABLED:
        try:
            from src.v6.engines.comfyui import ComfyUIEngine

            if COMFYUI_PRIMARY_HOST:
                # ── Dual ComfyUI mode (V9 MEGAPAK) ──
                # Primary (RTX 3090)
                try:
                    comfyui_primary = ComfyUIEngine(
                        host=COMFYUI_PRIMARY_HOST, port=COMFYUI_PRIMARY_PORT,
                        engine_id="comfyui-primary",
                    )
                    await comfyui_primary.start()
                    primary_health = await comfyui_primary.health()
                    if primary_health.get("available"):
                        executor.register_engine(comfyui_primary)
                        logger.info("ComfyUI primary registered (online) → %s:%s",
                                    COMFYUI_PRIMARY_HOST, COMFYUI_PRIMARY_PORT)
                    else:
                        logger.warning("ComfyUI primary offline at %s:%s",
                                       COMFYUI_PRIMARY_HOST, COMFYUI_PRIMARY_PORT)
                except Exception as e:
                    logger.warning("ComfyUI primary init failed: %s", e)

                # Auxiliary (RTX 3060 Ti)
                if COMFYUI_AUX_HOST:
                    try:
                        comfyui_aux = ComfyUIEngine(
                            host=COMFYUI_AUX_HOST, port=COMFYUI_AUX_PORT,
                            engine_id="comfyui-auxiliary",
                        )
                        await comfyui_aux.start()
                        aux_health = await comfyui_aux.health()
                        if aux_health.get("available"):
                            executor.register_engine(comfyui_aux)
                            logger.info("ComfyUI auxiliary registered (online) → %s:%s",
                                        COMFYUI_AUX_HOST, COMFYUI_AUX_PORT)
                        else:
                            logger.warning("ComfyUI auxiliary offline at %s:%s",
                                           COMFYUI_AUX_HOST, COMFYUI_AUX_PORT)
                    except Exception as e:
                        logger.warning("ComfyUI auxiliary init failed: %s", e)
            else:
                # ── Legacy single-engine fallback ──
                comfyui = ComfyUIEngine(host=COMFYUI_HOST, port=COMFYUI_PORT)
                await comfyui.start()
                health = await comfyui.health()
                if health.get("available"):
                    executor.register_engine(comfyui)
                    logger.info("ComfyUI engine registered (online) → %s:%s", COMFYUI_HOST, COMFYUI_PORT)
                else:
                    logger.warning("ComfyUI engine offline at %s:%s, using mock only",
                                   COMFYUI_HOST, COMFYUI_PORT)
        except ImportError:
            logger.warning("ComfyUIEngine not available, skipping")
        except Exception as e:
            logger.warning("ComfyUI engine init failed: %s", e)

    # Register JoyCaption engine (image captioning via ComfyUI)
    try:
        from src.v6.engines.joycaption import JoyCaptionEngine
        _jc_host = os.environ.get("COMFYUI_URL", "").replace("http://", "").rsplit(":", 1)[0] or COMFYUI_HOST
        _jc_port = int(os.environ.get("COMFYUI_URL", "").rsplit(":", 1)[1].split("/")[0]) if ":" in os.environ.get("COMFYUI_URL", "") else COMFYUI_PORT
        joycaption = JoyCaptionEngine(host=_jc_host, port=_jc_port)
        await joycaption.start()
        jc_health = await joycaption.health()
        if jc_health.get("available"):
            executor.register_engine(joycaption)
            logger.info("JoyCaption engine registered (online) → %s:%s", _jc_host, _jc_port)
        else:
            logger.warning("JoyCaption engine offline at %s:%s", _jc_host, _jc_port)
    except ImportError:
        logger.warning("JoyCaptionEngine not available, skipping")
    except Exception as e:
        logger.warning("JoyCaption engine init failed: %s", e)

    # ── Cloud Backend ───────────────────────────────────────────────────
    # Register cloud engines (Jimeng/Kling/Seedance)
    try:
        from src.v6.engines.cloud_jimeng import JimengEngine
        from src.v6.engines.cloud_kling import KlingEngine
        from src.v6.engines.cloud_seedance import SeedanceEngine

        for cloud_cls in [JimengEngine, KlingEngine, SeedanceEngine]:
            try:
                cloud_engine = cloud_cls()
                await cloud_engine.start()
                executor.register_engine(cloud_engine)
                configured = "✓" if cloud_engine.is_configured else "✗"
                logger.info("Cloud engine registered: %s [%s configured]",
                            cloud_engine.engine_id, configured)
            except Exception as e:
                logger.warning("Cloud engine %s init failed: %s", cloud_cls.__name__, e)
    except ImportError as e:
        logger.warning("Cloud engines not available: %s", e)

    await executor.start()

    # ── Docker/YAML Backend ─────────────────────────────────────────────
    # Register local Docker engines from engines/*.yaml (routing table)
    try:
        from src.v6.config.engine_registry import VRAM_ESTIMATES, build_engine_registry
        from src.v6.engines.docker_base import DockerAPIEngine
        engines_dir = Path(__file__).resolve().parent.parent.parent / "engines"
        if engines_dir.exists():
            local_engines = build_engine_registry(
                engines_dir=engines_dir,
                workspace="/workspace",
            )
            seen_ids: dict[str, object] = {}
            for task_type, engine in local_engines.items():
                if engine.engine_id not in seen_ids:
                    seen_ids[engine.engine_id] = engine

            pool = get_engine_pool()
            for eid, engine_instance in seen_ids.items():
                vram_mb = 0
                for name_key, est in VRAM_ESTIMATES.items():
                    if name_key in eid.lower():
                        vram_mb = est
                        break
                if vram_mb == 0:
                    vram_mb = 4000

                async def _make_loader(eng=engine_instance):
                    async def _loader():
                        await eng.start()
                        return eng
                    return _loader

                async def _make_unloader(eng=engine_instance):
                    async def _unloader(_instance):
                        await eng.stop()
                    return _unloader

                pool.register(
                    engine_id=eid,
                    loader=await _make_loader(),
                    vram_mb=vram_mb,
                    unloader=await _make_unloader(),
                )

            for task_type, engine in local_engines.items():
                executor.register_engine(engine)

            logger.info("Registered %d local engines in EnginePool, %d task mappings from %s",
                        len(seen_ids), len(local_engines), engines_dir)
    except Exception as e:
        logger.warning("Local engine registry / pool failed: %s", e)

    local_pool = None
    has_real_engine = any(e.engine_id != "mock" for e in executor.list_engines())
    if not has_real_engine:
        local_pool = get_local_pool()
        await local_pool.start()
        logger.info("Started local_pool (mock fallback — no real engines)")
    else:
        logger.info("Real engines available, skipping local_pool mock worker")

    logger.info("kais-gold-team V6.0 started\n%s", _format_registration_summary(executor))
    yield
    # Shutdown
    await executor.stop()
    if local_pool:
        await local_pool.stop()
    # Unified TTS subprocess 已随三轨退役移除（2026-09-06），无需清理
    # Unload all engines from GPU
    try:
        pool = get_engine_pool()
        count = await pool.unload_all()
        if count:
            logger.info("EnginePool: unloaded %d engine(s) on shutdown", count)
    except Exception:
        pass

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
app.include_router(gpu_router)

# GPU guard middleware — auto-evict on OOM
app.add_middleware(GPUGuardMiddleware)


if __name__ == "__main__":
    uvicorn.run(
        "src.v6.main:app",
        host="127.0.0.1",
        port=8002,
        reload=True,
    )
