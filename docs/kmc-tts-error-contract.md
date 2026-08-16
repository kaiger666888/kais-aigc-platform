# KMC→KAP TTS 错误契约 (v1)

> 2026-08-15 · 源于 ep-demo-pixar P10 31/31 clip 劣化事故（分析报告 C.1/C.3/D#2/D#10）。
> KAP 侧已落地；本文档供 KMC 侧（`plugins/kais_aigc/tts_engine.py` + `p10_voice.py`）修复对接。

## 1. Health 端点（preflight 用）

```
GET /api/v1/tts/health
```

- HTTP 恒返 **200**（健康端点不报 5xx，语义在 body.status）
- 响应体（KAP 标准 `{code, data, message}` 包装，`data` 内容如下）：

```json
{
  "status": "ok" | "degraded",
  "comfyui_reachable": true,
  "plugin_loaded": true,
  "voice_design_node_registered": true,
  "registered_nodes": ["AILab_Qwen3TTSVoiceDesign", "AILab_Qwen3TTSVoiceClone", "AILab_Qwen3TTSCustomVoice"],
  "missing_nodes": [],
  "detail": "",
  "config": { "comfyui_url": "http://172.17.0.1:8188", "speak_route": "/api/v1/tts/speak" }
}
```

**KMC 消费建议**：P10 开始前（或 `tts_engine` 首次调用前）做一次 preflight：

- `data.status !== "ok"` → **fail-fast**，fix_hint 指向引擎修复（容器重建/插件挂载/venv），
  **不要**进入 delegate 重试、**不要**静默丢弃 clips。
- `status === "degraded"` 时 `detail` 字段给出具体原因（ComfyUI 不可达 / 节点未注册）。

注意 health 只证明**节点已注册**，不证明推理依赖完整（venv 丢失时节点仍注册，
运行期才报 `qwen_tts is not available`）。所以 health 通过后 speak 仍可能 500
synthesis_failed —— 见下面错误分类，KMC 仍需处理。

## 2. speak 结构化错误

```
POST /api/v1/tts/speak
```

错误时 body 均为 `{code, data, message}` 包装；**HTTP 状态码 + `data.error.kind`**
共同分类：

| 场景 | HTTP | data.error.kind | 说明 |
|---|---|---|---|
| 节点未注册（引擎缺失） | **503** | `engine_unavailable` | submitPrompt 前 object_info 探测失败；KMC 应 fail-fast |
| ComfyUI 网络不可达/超时 | **502** | `engine_unavailable` | 旧版折成 400 `"fetch failed"` 的 bug 已修 |
| workflow 执行失败 | **500** | `synthesis_failed` | 节点在、引擎在，但推理报错（含依赖缺失如 `qwen_tts is not available`） |
| 请求参数不合法（Zod） | 400 | 无（data=null） | 请求侧问题，KMC 不应产生 |

错误体示例（503）：

```json
{
  "code": 400,
  "data": {
    "error": {
      "kind": "engine_unavailable",
      "engine": "qwen_tts",
      "detail": "node AILab_Qwen3TTSVoiceDesign not registered in ComfyUI (plugin dir missing or import failed)",
      "node_type": "AILab_Qwen3TTSVoiceDesign",
      "comfyui_url": "http://172.17.0.1:8188"
    }
  },
  "message": "node AILab_Qwen3TTSVoiceDesign not registered in ComfyUI"
}
```

> ⚠️ `code` 字段是包装层历史遗留（error() helper 固定 400），**机判请用 HTTP 状态码
> + `data.error.kind`**，不要用 `body.code`。

**KMC 消费建议**（对应分析报告 B.2 修复建议 1/2）：

1. `tts_engine._post` 保留 response body（对齐现有 4xx 分支做法），解析
   `data.error.kind`；
2. `_degrade` envelope 增加 `kind` 字段：HTTP 502/503 或 `kind=engine_unavailable`
   → `"engine_unavailable"`；volume gate → `"quality"`；
3. 门控（mute hard-gate）对 `engine_unavailable` 占比 ≥ 阈值时直接 fail-fast
   （fix_hint=修引擎），不走 delegate 重试、绝不静默丢 clip；
4. fix-required.json 写入处按真实 error_type 分流话术（引擎故障 ≠ JSON 解析失败）。

## 3. 超时边界（分析报告 C.3）

KAP `pollTimeoutMs = 300_000`（5 min）与 KMC `DEFAULT_TIMEOUT = 300.0` 精确相等，
存在 KMC 先超时的边界竞态。KMC 侧建议 ≥ 360s。

## 4. 引擎侧基础设施（背景）

- ComfyUI-QwenTTS（AILab 版，注册 `AILab_Qwen3TTS*` 节点）已从容器可写层
  docker cp 入卷：`/data/workspace/comfyui-incremental-nodes/ComfyUI-QwenTTS`，
  compose 挂载为顶层 custom_node（2026-08-15）。
- venv/6 patches/:5111 server 重建脚本：`install-qwen-tts-deps.sh`（幂等）+
  `pre-start-qwen-tts.sh`（启动），挂载于容器 `/root/user-scripts/`。
- 容器重建后验收：`curl http://127.0.0.1:10588/api/v1/tts/health` 应 `status=ok`。
