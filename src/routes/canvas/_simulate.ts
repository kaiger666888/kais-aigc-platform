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
 *   - video        → video_final
 *   - audio        → tts
 *   - global       → image_draw(59-01:面板重生成主力资产,Pitfall 6)
 *   - keyframe     → image_draw(59-01:V3 Stage 映射补齐)
 *   - voice        → tts(59-01:V3 Stage 映射补齐)
 *   - foley        → sfx(59-01:V3 Stage 映射补齐)
 *   - bgm          → music(59-01:V3 Stage 映射补齐)
 *   - mix/composite → 有意不进表(59-01 A2 裁定:引擎无混音/合成 TaskType,
 *                    维持 simulateOnly 守批量路径稳定)
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
  // 59-01 V3 Stage 映射补齐(字面量风格照既有五行)
  global: "image_draw",
  keyframe: "image_draw",
  voice: "tts",
  foley: "sfx",
  bgm: "music",
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
  try {
    const taskId = await submitEngineTask({
      taskType,
      prompt,
      projectId,
      episodesId,
      nodeId,
      metadata: {
        nodeType,
        originalNodeId: nodeId,
        // 59-01 REGEN-02:seed 经 metadata 平铺即达 params.seed(59-02 接线)
        ...(overrides?.seed != null ? { seed: overrides.seed } : {}),
        // 59-fix CR-01:overrides.params 经白名单过滤后平铺(配方袋,59-02 接线
        // panel-edit-regen;白名单外键静默丢弃——ref_images 穿越白名单/model_preference
        // 伪造/身份键篡改在 _simulate 与 _engine(RESERVED_PARAM_KEYS)两道防线拦截)
        ...filterClientParams(overrides?.params),
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
      broadcastToProject(projectId, "node:preview", {
        nodeId,
        thumbnailUrl: result.outputUrl,
      });
      // 59-01 A1 裁定:成功产物 filePath 落库——/oss/ web 路径写回节点 data,
      // reload 可见(与 import 链 filePath 语义一致)。外裹 try/catch
      // console.error,落库失败不得把成功翻成 error。
      if (node) {
        try {
          const data = { ...(node.data ?? {}), filePath: result.outputUrl };
          await upsertNode(
            { projectId, episodesId },
            { ...(node as any), data },
          );
        } catch (persistErr: any) {
          console.error(
            `[_simulate] nodeId=${nodeId} filePath 落库失败(成功态保留):`,
            persistErr?.message,
          );
        }
      }
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
