"""V3.6 Configuration — Stage-Aware Scheduling for Dual GPU System.

RTX 3090 24G (PCIe 4.0 x16) + RTX 3060Ti 8G (PCIe 3.0 x4) + 32G RAM.

Core principles:
    1. 3090 VRAM dynamic partitioning: Heavy determines Light pool size
    2. 3060Ti = overflow pool with Combo Resident strategy
    3. CPU zero inference, only Blender + FFmpeg
    4. Atomic writes, Redis MULTI/EXEC, AOF everysec
"""

from __future__ import annotations

from .stage_config import STAGE_CONFIG, STAGE_CONFIG_INV
from .combo_config import COMBO_3060TI
from .models_registry import MODELS, LIGHT_MODELS, HEAVY_MODELS
from .routing_table import ROUTING_TABLE, build_routing_table

__all__ = [
    "STAGE_CONFIG",
    "STAGE_CONFIG_INV",
    "COMBO_3060TI",
    "MODELS",
    "LIGHT_MODELS",
    "HEAVY_MODELS",
    "ROUTING_TABLE",
    "build_routing_table",
]
