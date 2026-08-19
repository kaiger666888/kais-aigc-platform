# KAP 引擎集成规范（强制）

> 2026-08-19 起生效。历史背景：GPU 队列三期修复（docs/gpu-unified-scheduling-plan.md）
> 收编了 12 个绕过路由，但收编清单靠人工排查得出——wan/wan21/trellis2/postprocess
> 家族（10 个裸提交路由）直到规范门禁建立时才暴露。**本规范的存在意义就是把
> "必须过队列"从口头约定变成机器门禁。**

## 0. 强制机制

```bash
npx tsx scripts/verify-engine-integration.ts   # 接入验收门禁，EXIT 0 = 合规
```

- 新引擎接入的 PR **必须**附本脚本绿色输出
- 脚本扫描三类违规并 FAIL：①调用了队列但 engineKey 未注册 ②有 ComfyUI 提交特征
  却未过队列且不在豁免清单 ③豁免清单条目已失效（文件不存在）
- 豁免清单维护在本规范 §4 和脚本 `EXEMPT` 常量中，**必须成对更新、写明理由**

## 1. 适用范围

判定"引擎路由"的标准：**会直接或间接触发本机 GPU 作业**的路由。典型特征：

- 向 ComfyUI `POST /prompt` 提交 workflow（含经 `comfyuiUrl`/`COMFYUI_URL` 配置）
- 驱动本机引擎 server（H3 pipeline / IndexTTS2 / qwen_tts / qwen_eye / qwen_ear / music3 / sa3 / ace / rtx_vsr …）
- 触发 GPU 后处理（超分/插值/分割/3D 重建）

不适用（默认豁免形态）：纯 CPU（ffmpeg 剪辑/mux）、纯云 API 代理（dreamina 等）、
config/status/models 查询、canvas/资产 CRUD。

## 2. 强制清单（MUST）

### M1 注册表登记
`src/lib/gpuVramManager.ts` 两处登记缺一不可：
```ts
ENGINE_VRAM_REQUIREMENTS: { my_engine: 8192 },  // 显存需求 MiB (实测值, 非拍脑袋)
ENGINE_GPU_INDEX: { my_engine: 1 },             // GPU 归属 (新引擎默认 1)
```

### M2 队列接入
所有「提交 + 等待完成」段必须过队列，engineKey 与注册表一致：
- 提交后即返 taskId 的异步路由 → `withGpuQueue` 包**提交段**
- 同步等结果的 → `withGpuQueueTimed` 包**提交+轮询段**，并把 `queueWaitMs` 传入轮询预算
  （排队等待不计入作业预算——2026-08-16 P10 双重超时事故的教训）

### M3 显存预检
opts 传 `comfyuiUrl`（ensureVram 可 `/free` 驱逐时）；常驻 server 引擎用
`requireVramMiB` 按生成增量预检，并在 `registerResidentEngine` 登记（KAP_VRAM_RESIDENT_AWARE）。

### M4 客户端断连取消
```ts
const ac = new AbortController();
res.on("close", () => { if (!res.writableFinished) ac.abort(); });
withGpuQueueTimed(ENGINE, fn, { signal: ac.signal, ... });
```
⚠️ 用 `req.on("close")` 是错的——Node≥16 下请求体读完即触发，每个请求都会被秒取消。

### M5 错误映射（body 必须含 kind 字段）
| 错误 | 状态码 | kind |
|---|---|---|
| VramInsufficientError | 503 | vram_insufficient |
| QueueTimeoutError | 504 | queue_timeout |
| QueueAbortedError | 499 | queue_aborted |
| QueuePurgedError | 503 | queue_purged |

调用方（kmc video_engine D-09 契约）按 5xx/timeout 统一降级重试——**不要**抛裸 500。

### M6 锁外前置
multipart 解析、文件下载、纯 CPU 计算不进锁。持锁期间只做「提交 + 等结果」。

### M7 常驻引擎占用语义
拉起后常驻的引擎（服务横跨多个请求）：`acquireEngineOccupancy(key, gpu, { healthUrl })`
（看门狗自动释放孤儿占位）+ `/release` 显式配对。参考 `routes/production/llm/index.ts`。

### M8 测试
- 队列行为：`src/lib/__tests__/` 至少一个串行/超时用例（模板：gpuVramManager.test.ts）
- 路由接入：`scripts/verify-phase-49-core.ts` 的 adopted 清单加你的文件

### M9 长任务预算
作业可能 >10min 的（视频生成），确认调用链 poll 预算含 `queueWaitMs` 补偿，
且服务端持有锁期间客户端超时由 M4 的 signal 摘除 waiter 兜底（不留幽灵等待者）。

## 3. 最小接入模板

```ts
import { withGpuQueueTimed, VramInsufficientError, QueueTimeoutError, QueueAbortedError, QueuePurgedError } from "@/lib/gpuVramManager";
import { MY_CONFIG } from "./config";

router.post("/", upload.single("image"), async (req, res) => {   // multipart 在锁外
  const ac = new AbortController();                              // M4
  res.on("close", () => { if (!res.writableFinished) ac.abort(); });
  try {
    const { data } = await withGpuQueueTimed(                     // M2/M3
      "my_engine",
      async (queueWaitMs) => {
        const promptId = await submitWorkflow(payload);           // POST {comfyuiUrl}/prompt
        return await pollUntilDone(promptId, pollBudget + queueWaitMs); // M2 预算补偿
      },
      { gpuIndex: 1, comfyuiUrl: MY_CONFIG.comfyuiUrl, signal: ac.signal },
    );
    res.status(200).send(success(data));
  } catch (err) {                                                 // M5
    if (err instanceof VramInsufficientError) return res.status(503).send(error(err.message, { kind: err.kind }));
    if (err instanceof QueueTimeoutError)   return res.status(504).send(error(err.message, { kind: err.kind }));
    if (err instanceof QueueAbortedError)   return res.status(499).send(error(err.message, { kind: err.kind }));
    if (err instanceof QueuePurgedError)    return res.status(503).send(error(err.message, { kind: err.kind }));
    throw err;
  }
});
```

## 4. 豁免清单（与脚本 EXEMPT 常量成对维护）

| 路径 | 理由 |
|---|---|
| `*/config.ts` `*/status.ts` `*/models.ts` `*/prompt-guide.ts` `*/_shared/*` | 查询/配置，无作业提交 |
| `minimax-h3/replace-audio.ts` | 纯 CPU 音频替换 |
| `ltx/trim.ts` | 纯 CPU ffmpeg 剪辑 |
| `qwenTts/voiceId.ts` `v1/tts/health.ts` `ace/cancel.ts` `trellis2/delete.ts` | 查询/取消/删除 |
| `assets/addAssets.ts` `canvas/v2/import-from-dir.ts` | `/prompt` 命中为注释误报 |
| `shot-analysis/index.ts` | 代理外部 gold-team 任务服务（自带调度）；若 gold-team 落本机 GPU 需重新评估 |
| `gpu-queue/index.ts` | 观测/管理面本身 |

新增豁免 = 同时改本表和脚本 `EXEMPT`，写理由，否则门禁 FAIL。

## 5. 接入流程（checklist）

1. `ENGINE_VRAM_REQUIREMENTS` + `ENGINE_GPU_INDEX` 登记（M1）
2. 提交/轮询段过队列（M2/M3/M6），模板见 §3
3. 断连取消 + 错误映射（M4/M5）
4. 常驻引擎加占用+看门狗（M7）
5. 单测 + verify-phase-49-core 清单（M8）
6. `npx tsx scripts/verify-engine-integration.ts` → EXIT 0
7. `npx tsc --noEmit` → EXIT 0
