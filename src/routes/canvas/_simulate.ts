import { broadcastToProject } from "@/utils/ws";

/**
 * Phase 36 — 共享模拟执行 helper。
 *
 * execute.ts 和 orchestrate.ts 都用这个模拟"节点正在跑"的进度推送。
 * 真正接入 GpuScheduler / gold-team 后,这里替换为 await realEngine.run(node)。
 */
function randomDelay(): number {
  return 5000 + Math.floor(Math.random() * 10000);
}

export async function simulateExecution(
  projectId: number,
  nodeId: string,
): Promise<void> {
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

/** Phase 36 — 节点类型执行拓扑序 */
export const NODE_TYPE_TOPOLOGY = ["script", "asset", "storyboard", "video", "audio"] as const;
