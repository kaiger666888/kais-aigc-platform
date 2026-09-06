"""Engine abstraction layer — pluggable GPU engine interfaces."""
from src.v6.engines.base import BaseEngine, EngineStatus, EngineCapabilities
from src.v6.engines.comfyui import ComfyUIEngine
from src.v6.engines.color_grade import ColorGradeEngine
from src.v6.engines.hunyuan3d import Hunyuan3DEngine
from src.v6.engines.hunyuan3d_mv import Hunyuan3DMvEngine
from src.v6.engines.mock import MockEngine

# 三轨 TTS 引擎面已退役（2026-09-06）：TTSTracker/TTSTrack（engines/tts.py，
# in-process 三轨壳）与 TripleTrackTTSEngine（engines/tts_http.py，三轨 HTTP 面）
# 均已整体删除，不再对外导出。现役 TTS = Breeze :5130（宿主 systemd，不在本仓）
# + KAP qwenTts 路由。

__all__ = [
    "BaseEngine",
    "ColorGradeEngine",
    "ComfyUIEngine",
    "EngineStatus",
    "EngineCapabilities",
    "Hunyuan3DEngine",
    "Hunyuan3DMvEngine",
    "MockEngine",
]
