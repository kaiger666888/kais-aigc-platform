import { broadcastToProject } from "@/utils/ws";
import { listNodes, upsertNode } from "@/lib/canvasRelationalStore";
import { submitEngineTask, pollEngineTask, type TaskType } from "./_engine";

/**
 * Phase 36 (revised in v1.8) — 节点执行 helper。
 *
 * 由 execute.ts 和 orchestrate.ts 共用。当 `GOLD_TEAM_URL` 已配置时调用真实
 * gold-team 引擎;否则降级为 setTimeout 模拟,保持 v1.7 行为不变。
 *
 * 节点类型 → TaskType 映射覆盖 v1.7 的 5 种节点 + 59-01 扩展的 V3 Stage:
 *   - script       → (无引擎任务;纯文本节点,立即标记成功)
 *   - asset        → image_draw
 *   - storyboard   → image_draw(ref 化的 image_draw_ipadapter 是 storyboardPreview
 *                    专用路径,A4 裁定不解析上游参考,最小实现)
 *   - video        → video_final(65-02:必须携带首帧 imageRef,引擎
 *                    executor.py:508-511 对 VIDEO_* 硬性要求 params.image)
 *   - audio/voice  → tts(65-02:台词走 params.text 通道,引擎读 text 非 prompt)
 *   - global       → image_draw(59-01:面板重生成主力资产,Pitfall 6)
 *   - keyframe     → image_draw(59-01:V3 Stage 映射补齐)
 *   - mix/composite → 有意不进表(59-01 A2 裁定:引擎无混音/合成 TaskType,
 *                    维持 simulateOnly 守批量路径稳定)
 *   - bgm/foley    → 65-02 (REA-04) 从表移除:引擎 v1.5 起 MUSIC/SFX 直接拒收
 *                    (executor.py:591-594)。65-04 接线:改走 kap 自家音频端点
 *                    ——bgm→/api/v1/ace/generate(ACE-Step,异步+轮询 status),
 *                    foley→/api/v1/stableaudio/generate(SA3,同步)。不走引擎。
 *
 * 59-01 行为变化声明:
 *   - readNode 关系表化:v2 项目改走 canvasRelationalStore.listNodes(旧
 *     canvasGraph JSON blob 读取删除——v2 项目 readNode 恒 null → 恒
 *     simulateOnly 的根因,D-06③)。legacy-blob-only 项目此后落 simulateOnly
 *     兜底(它们本就无关系表真值)。
 *   - 引擎调用失败 rethrow,不再 catch 后 simulateOnly 假成功(D-06③ 断点③);
 *     execute.ts L72-73 / orchestrate.ts L102-108 既有 error 广播接管。
 *     唯一合法保留的 simulateOnly 降级:GOLD_TEAM_URL 未配置分支 + 无 prompt 分支。
 *   - 成功产物 filePath 落库:outputUrl 非 null 时把 /oss/ web 路径写回节点 data,
 *     reload 可见(A1 钉)。
 *   - orchestrate.ts 共享本函数,其执行载荷随之变真——Pitfall 5 裁定:orchestrate
 *     自身目标筛选读法本 phase 不动,SC3「零变化」限定为 stale 级联零触发 +
 *     无 regen 通道结构保证。
 */
const NODE_TYPE_TO_TASK_TYPE: Record<string, TaskType> = {
  script: "image_draw", // script 节点不会真正调引擎;在 runner 里短路
  asset: "image_draw",
  storyboard: "image_draw",
  video: "video_final",
  audio: "tts",
  // 59-01 V3 Stage 映射补齐(字面量风格照既有五行);bgm/foley 有意不进表
  // (REA-04:引擎 MUSIC/SFX 直接拒收,见 simulateExecution 显式报错分支)
  global: "image_draw",
  keyframe: "image_draw",
  voice: "tts",
};

/**
 * 59-fix CR-01: 客户端 params 白名单 — 仅 Phase 58 §14 全配方窄通道
 * (GenerationParams 九键)中可经 params 袋透传的配方标量键放行;白名单外键
 * (如伪造的 ref_images/model_preference/nodeId/prompt)静默丢弃,不 500
 * (e2e 流保持绿)。prompt 走 execute 请求体顶层专用通道
 * (overrides.prompt → submitEngineTask input.prompt → params.prompt),
 * 不经 params 袋;服务端保留键的第二道防线在 _engine.ts RESERVED_PARAM_KEYS。
 */
const CLIENT_PARAM_KEYS = new Set([
  "seed", "negative", "modelVersion", "lora",
  "steps", "cfg", "quant", "sageAttention",
]);

function filterClientParams(
  params: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (CLIENT_PARAM_KEYS.has(k)) out[k] = v;
  }
  return out;
}

function randomDelay(): number {
  return 5000 + Math.floor(Math.random() * 10000);
}

// ─── 65-02/65-03 (REA-02/03/05): 任务参数推导 ─────────────────────────────

/**
 * 节点产物路径:优先 data.filePath(v2 真值,59-01 A1 成功落库位),回退
 * V3 media(thumbnail→original)。供 video 首帧 imageRef / refine 参考。
 */
function extractNodeAssetPath(node: Record<string, any> | null): string | null {
  if (!node) return null;
  const data = (node.data ?? {}) as Record<string, any>;
  if (typeof data.filePath === "string" && data.filePath) return data.filePath;
  const v3 = data.v3 as Record<string, any> | undefined;
  const media = v3?.media as Record<string, any> | undefined;
  const mediaPath = media?.original ?? media?.thumbnail;
  return typeof mediaPath === "string" && mediaPath ? mediaPath : null;
}

/** cloud-jimeng _VALID_RATIOS(cloud_jimeng.py:42)镜像 — 65 契约门锁同步。 */
const DREAMINA_VALID_RATIOS: ReadonlyArray<[string, number]> = [
  ["1:1", 1], ["16:9", 16 / 9], ["9:16", 9 / 16], ["3:2", 3 / 2],
  ["2:3", 2 / 3], ["4:3", 4 / 3], ["3:4", 3 / 4], ["21:9", 21 / 9],
];

/**
 * 节点像素几何 → dreamina 合法 ratio 串(相对误差最小者)。
 * 缺几何返回 null(引擎缺省 1:1——竖屏资产回方图的 REA-05 根因,有几何必送)。
 */
function pickDreaminaRatio(node: Record<string, any> | null): string | null {
  if (!node) return null;
  const data = (node.data ?? {}) as Record<string, any>;
  const w = Number(data.width ?? data.v3?.media?.width);
  const h = Number(data.height ?? data.v3?.media?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const target = w / h;
  let best: string | null = null;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const [label, r] of DREAMINA_VALID_RATIOS) {
    const err = Math.abs(Math.log(target / r));
    if (err < bestErr) { bestErr = err; best = label; }
  }
  return best;
}

/**
 * 59-01: readNode 关系表化 — v2 项目从 canvasRelationalStore.listNodes 读真值,
 * 返回完整行(供成功块 upsert 复用)。旧 canvasGraph JSON blob 查询删除:
 * v2 项目在该 blob 下 readNode 恒 null → 恒 simulateOnly,是 D-06③ 假成功的
 * 结构性根因之一。legacy-blob-only 项目此后落 simulateOnly 兜底(它们本就无
 * 关系表真值,行为对外无回归)。
 */
async function readNode(
  projectId: number,
  episodesId: number,
  nodeId: string,
): Promise<{ node: Record<string, any> | null; episodesId: number }> {
  const rows = await listNodes({ projectId, episodesId });
  const node = rows.find((n) => n.id === nodeId) ?? null;
  return { node: node as unknown as Record<string, any> | null, episodesId };
}

/**
 * 提取节点 prompt — 兼容多种字段命名 (prompt / text / description / data.prompt)。
 */
function extractPrompt(node: Record<string, any>): string {
  if (typeof node.prompt === "string") return node.prompt;
  if (typeof node.text === "string") return node.text;
  if (typeof node.description === "string") return node.description;
  if (node.data && typeof node.data.prompt === "string") return node.data.prompt;
  return "";
}

async function simulateOnly(projectId: number, nodeId: string): Promise<void> {
  const steps = [0, 0.3, 0.6, 0.9, 1.0];
  const totalDuration = randomDelay();
  const stepDelay = Math.floor(totalDuration / steps.length);
  for (let i = 0; i < steps.length; i++) {
    await new Promise((r) => setTimeout(r, stepDelay));
    broadcastToProject(projectId, "execution:progress", {
      nodeId,
      state: "running",
      progress: steps[i],
    });
  }
}

/**
 * 成功产物落库+广播(59-01 A1 裁定,65-04 抽出复用):/oss/ 或端点 URL 写回
 * 节点 data.filePath,reload 可见(与 import 链 filePath 语义一致)。外裹
 * try/catch console.error,落库失败不得把成功翻成 error。
 */
async function persistOutput(
  projectId: number,
  episodesId: number,
  nodeId: string,
  node: Record<string, any> | null,
  outputUrl: string,
): Promise<void> {
  broadcastToProject(projectId, "node:preview", { nodeId, thumbnailUrl: outputUrl });
  if (!node) return;
  try {
    const data = { ...(node.data ?? {}), filePath: outputUrl };
    await upsertNode({ projectId, episodesId }, { ...(node as any), data });
  } catch (persistErr: any) {
    console.error(
      `[_simulate] nodeId=${nodeId} filePath 落库失败(成功态保留):`,
      persistErr?.message,
    );
  }
}

/**
 * 65-04 (REA-04 余量):bgm/foley 重生成走 kap 自家音频端点(HTTP 自调,
 * 复用端点的 GPU 串行队列语义)。
 *   - bgm  → POST /api/v1/ace/generate(202 异步)→ 轮询 /ace/status/:id
 *            至 completed → outputs[0].download_url;
 *   - foley→ POST /api/v1/stableaudio/generate(SA3 同步)→ data.audio_url。
 * 产物 URL 写回 data.filePath(与图像 /oss/ 同一落库通道)。失败 rethrow
 * (execute.ts error 广播接管——诚实失败,不假成功)。
 */
async function regenerateInternalAudio(
  projectId: number,
  nodeId: string,
  episodesId: number,
  node: Record<string, any> | null,
  nodeType: "bgm" | "foley",
  prompt: string,
): Promise<void> {
  // 自调基址:生产/开发同进程 PORT(serve-production.sh PORT=10588)
  const selfBase = `http://127.0.0.1:${process.env.PORT ?? "10588"}`;
  // 节点时长(data.duration 秒)可用则透传,否则走端点默认(bgm 60s / foley 30s)
  const duration = Number(node?.data?.duration);

  broadcastToProject(projectId, "execution:progress", { nodeId, state: "running", progress: 0.1 });

  let outputUrl: string | undefined;
  if (nodeType === "bgm") {
    // ACE-Step 音乐:instrumental(画布 BGM 无歌词);duration 1..600
    const body: Record<string, unknown> = { prompt, instrumental: true };
    if (Number.isFinite(duration) && duration >= 1 && duration <= 600) body.duration = duration;
    const submit = await fetch(`${selfBase}/api/v1/ace/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).then((r) => r.json() as Promise<{ code: number; data?: { task_id?: string }; message?: string }>);
    if (submit?.code !== 200 || !submit.data?.task_id) {
      throw new Error(`ACE 提交失败: ${submit?.message ?? "无 task_id"}`);
    }
    const taskId = submit.data.task_id;
    const deadline = Date.now() + 10 * 60_000;
    let elapsed = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 4_000));
      elapsed += 4;
      broadcastToProject(projectId, "execution:progress", {
        nodeId, state: "running", progress: Math.min(0.9, 0.1 + elapsed / 120),
      });
      const st = await fetch(`${selfBase}/api/v1/ace/status/${encodeURIComponent(taskId)}`, {
        signal: AbortSignal.timeout(8_000),
      }).then((r) => r.json() as Promise<{
        code: number;
        data?: { status?: string; error?: string; outputs?: Array<{ download_url?: string }> };
      }>);
      if (st?.data?.status === "completed") {
        const url = st.data.outputs?.[0]?.download_url;
        if (!url) throw new Error("ACE 完成但无音频输出");
        outputUrl = url;
        break;
      }
      if (st?.data?.status === "failed") {
        throw new Error(`ACE 生成失败: ${st.data.error ?? "未知错误"}`);
      }
      // queued/running/unknown → 继续轮询
    }
    if (outputUrl === undefined) throw new Error("ACE 轮询窗口耗尽(10 分钟)");
  } else {
    // Stable Audio 3 音效:同步端点(内部轮询至完成);seconds_total 1..380
    const body: Record<string, unknown> = { prompt };
    if (Number.isFinite(duration) && duration >= 1 && duration <= 380) body.seconds_total = duration;
    const gen = await fetch(`${selfBase}/api/v1/stableaudio/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60_000),
    }).then((r) => r.json() as Promise<{ code: number; data?: { audio_url?: string }; message?: string }>);
    if (gen?.code !== 200 || !gen.data?.audio_url) {
      throw new Error(`Stable Audio 生成失败: ${gen?.message ?? "无 audio_url"}`);
    }
    outputUrl = gen.data.audio_url;
  }

  broadcastToProject(projectId, "execution:progress", { nodeId, state: "running", progress: 1.0 });
  await persistOutput(projectId, episodesId, nodeId, node, outputUrl);
}

/**
 * 执行单个节点。
 *
 * 当 `GOLD_TEAM_URL` 配置时,走真实引擎;否则降级为模拟。
 * script 节点直接标记成功 (无引擎任务)。
 *
 * 59-01: 新增第 4 参 overrides(prompt/seed/params/nodeType),为 59-02
 * reroll-seed / panel-edit-regen 接线预留;既有调用方(orchestrate、execute)
 * 不传零影响。
 */
export async function simulateExecution(
  projectId: number,
  nodeId: string,
  episodesId = 0,
  overrides?: {
    prompt?: string;
    seed?: number;
    params?: Record<string, unknown>;
    nodeType?: string;
  },
): Promise<void> {
  const { node } = await readNode(projectId, episodesId, nodeId);
  // 59-01: overrides.nodeType 优先(请求体 V3 Stage 是权威);store node.type
  // 剥 skill 前缀逻辑保留为兜底(Pitfall 6)。
  const fallbackType = (node?.type ?? "").replace(/^(movie_skill|skill)::/, "").split("::").pop() ?? "";
  const nodeType = overrides?.nodeType ?? fallbackType;
  const taskType = NODE_TYPE_TO_TASK_TYPE[nodeType];

  // script 节点没有引擎任务 — 直接走完进度条
  if (nodeType === "script" || !taskType) {
    return simulateOnly(projectId, nodeId);
  }

  // 59-01 A2 裁定:mix/composite 有意不进表——引擎无混音/合成 TaskType,
  // 维持 simulateOnly 守批量路径稳定;warn 明示该节点走了模拟通道。
  if (nodeType === "mix" || nodeType === "composite") {
    console.log(
      `[_simulate] nodeId=${nodeId} nodeType=${nodeType} 引擎无对应 TaskType(A2 裁定),走 simulateOnly`,
    );
    return simulateOnly(projectId, nodeId);
  }

  // 65-04 (REA-04 余量):bgm/foley 改走 kap 自家音频端点——引擎 v1.5 起
  // MUSIC/SFX 直接拒收(executor.py:591-594),不再投递必拒任务。65-02 时代的
  // 显式报错分支升级为真实接线:bgm→ACE-Step(异步 202+status 轮询),
  // foley→Stable Audio 3(同步)。两条端点自带 GPU 全局串行队列
  // (gpuVramManager gpuIndex=1),无需引擎 env。
  if (nodeType === "bgm" || nodeType === "foley") {
    const audioPrompt = overrides?.prompt ?? extractPrompt(node ?? {});
    if (!audioPrompt) {
      console.log(`[_simulate] nodeId=${nodeId} 音频节点无 prompt,降级为模拟`);
      return simulateOnly(projectId, nodeId);
    }
    return regenerateInternalAudio(projectId, nodeId, episodesId, node, nodeType, audioPrompt);
  }

  // GOLD_TEAM_URL 未配置 → 降级模拟,保持 v1.7 行为
  if (!process.env.GOLD_TEAM_URL) {
    console.log(`[_simulate] GOLD_TEAM_URL 未配置,nodeId=${nodeId} 降级为模拟`);
    return simulateOnly(projectId, nodeId);
  }

  // 59-01: overrides.prompt 优先(请求体权威),否则从 node 提取。
  const prompt = overrides?.prompt ?? extractPrompt(node ?? {});
  if (!prompt) {
    console.log(`[_simulate] nodeId=${nodeId} 无 prompt,降级为模拟`);
    return simulateOnly(projectId, nodeId);
  }

  // 提交任务 → 轮询完成 → 广播进度
  const steps = [0.1, 0.3, 0.5, 0.7, 0.9];
  // 59-fix IN-05: 专用 seed 通道优先——execute.ts 对 overrides.seed 走
  // typeof number 类型门,而 params 袋只做键白名单不做值形状校验(袋内
  // seed: "abc" 字符串可绕类型门直达引擎 params.seed,引擎侧行为未定义)。
  // 袋内 seed 先删除再平铺:专用通道值不可被袋值覆盖,与 _engine.ts
  // model_preference 服务端常量后置平铺同向(类型受控/服务端设置的键总是赢)。
  const clientParams = filterClientParams(overrides?.params);
  if (overrides?.seed != null) delete clientParams.seed;

  // 65-02 (REA-02):video 首帧 = 节点现有产物(extractNodeAssetPath)。引擎对
  // VIDEO_* 硬性要求 params.image;无产物节点在 _engine 侧 fail-fast 抛错。
  const isVideoTask = taskType === "video_final" || taskType === "video_preview";
  const imageRef = isVideoTask ? extractNodeAssetPath(node) ?? undefined : undefined;
  // 65-02 (REA-03):tts 台词 — 引擎读 params.text(executor.py:192),prompt
  // 通道继续并行携带(日志/未来本地栈)。
  const text = taskType === "tts" || taskType.startsWith("tts_") ? prompt : undefined;
  // 65-03 (REA-05):图像任务显式几何 — 有节点几何必送,缺省引擎恒 1:1 方图。
  const ratio = taskType.startsWith("image") ? pickDreaminaRatio(node) ?? undefined : undefined;

  try {
    const taskId = await submitEngineTask({
      taskType,
      prompt,
      projectId,
      episodesId,
      nodeId,
      imageRef,
      text,
      ratio,
      metadata: {
        nodeType,
        originalNodeId: nodeId,
        // 59-01 REGEN-02:seed 经 metadata 平铺即达 params.seed(59-02 接线)
        ...(overrides?.seed != null ? { seed: overrides.seed } : {}),
        // 59-fix CR-01:overrides.params 经白名单过滤后平铺(配方袋,59-02 接线
        // panel-edit-regen;白名单外键静默丢弃——ref_images 穿越白名单/model_preference
        // 伪造/身份键篡改在 _simulate 与 _engine(RESERVED_PARAM_KEYS)两道防线拦截)
        ...clientParams,
      },
    });

    for (const step of steps) {
      broadcastToProject(projectId, "execution:progress", {
        nodeId,
        state: "running",
        progress: step,
      });
    }

    const result = await pollEngineTask(taskId);
    broadcastToProject(projectId, "execution:progress", {
      nodeId,
      state: "running",
      progress: 1.0,
    });
    if (result?.outputUrl) {
      // 59-01 A1 裁定:成功产物 filePath 落库(65-04 起与音频端点共用 helper)
      await persistOutput(projectId, episodesId, nodeId, node, result.outputUrl);
    }
  } catch (err: any) {
    // 59-01 D-06③ 断点③:去 simulateOnly 假成功降级。console.error 保留
    // (去掉「降级模拟」字样)后 rethrow——execute.ts L72-73 与
    // orchestrate.ts L102-108 既有 error 广播接管,「成功」信号从此为真。
    console.error(`[_simulate] nodeId=${nodeId} 引擎调用失败:`, err?.message);
    throw err;
  }
}

/** Phase 36 — 节点类型执行拓扑序 */
export const NODE_TYPE_TOPOLOGY = ["script", "asset", "storyboard", "video", "audio"] as const;
