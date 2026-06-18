import { broadcastToProject } from "@/utils/ws";
import u from "@/utils";
import { submitEngineTask, pollEngineTask, type TaskType } from "./_engine";

/**
 * Phase 36 (revised in v1.8) — 节点执行 helper。
 *
 * 由 execute.ts 和 orchestrate.ts 共用。当 `GOLD_TEAM_URL` 已配置时调用真实
 * gold-team 引擎;否则降级为 setTimeout 模拟,保持 v1.7 行为不变。
 *
 * 节点类型 → TaskType 映射覆盖 v1.7 的 5 种节点:
 *   - script       → (无引擎任务;纯文本节点,立即标记成功)
 *   - asset        → image_draw
 *   - storyboard   → image_draw
 *   - video        → video_final
 *   - audio        → tts
 */
const NODE_TYPE_TO_TASK_TYPE: Record<string, TaskType> = {
  script: "image_draw", // script 节点不会真正调引擎;在 runner 里短路
  asset: "image_draw",
  storyboard: "image_draw",
  video: "video_final",
  audio: "tts",
};

function randomDelay(): number {
  return 5000 + Math.floor(Math.random() * 10000);
}

/**
 * 读取节点数据,从 o_agentWorkData.canvasGraph JSON blob 中按 nodeId 找节点。
 */
async function readNode(
  projectId: number,
  episodesId: number,
  nodeId: string,
): Promise<{ node: Record<string, any> | null; episodesId: number }> {
  const row = await u
    .db("o_agentWorkData")
    .where("projectId", String(projectId))
    .andWhere("episodesId", String(episodesId))
    .andWhere("key", "canvasGraph")
    .first();

  if (!row?.data) return { node: null, episodesId };
  try {
    const graph = JSON.parse(row.data) as { nodes?: Record<string, any>[] };
    const node = (graph.nodes ?? []).find((n) => n.id === nodeId) ?? null;
    return { node, episodesId };
  } catch {
    return { node: null, episodesId };
  }
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
 */
export async function simulateExecution(
  projectId: number,
  nodeId: string,
  episodesId = 0,
): Promise<void> {
  const { node } = await readNode(projectId, episodesId, nodeId);
  const nodeType = (node?.type ?? "").replace(/^(movie_skill|skill)::/, "").split("::").pop() ?? "";
  const taskType = NODE_TYPE_TO_TASK_TYPE[nodeType];

  // script 节点没有引擎任务 — 直接走完进度条
  if (nodeType === "script" || !taskType) {
    return simulateOnly(projectId, nodeId);
  }

  // GOLD_TEAM_URL 未配置 → 降级模拟,保持 v1.7 行为
  if (!process.env.GOLD_TEAM_URL) {
    console.log(`[_simulate] GOLD_TEAM_URL 未配置,nodeId=${nodeId} 降级为模拟`);
    return simulateOnly(projectId, nodeId);
  }

  const prompt = extractPrompt(node ?? {});
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
      metadata: { nodeType, originalNodeId: nodeId },
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
    }
  } catch (err: any) {
    console.error(`[_simulate] nodeId=${nodeId} 引擎调用失败,降级模拟:`, err.message);
    return simulateOnly(projectId, nodeId);
  }
}

/** Phase 36 — 节点类型执行拓扑序 */
export const NODE_TYPE_TOPOLOGY = ["script", "asset", "storyboard", "video", "audio"] as const;
