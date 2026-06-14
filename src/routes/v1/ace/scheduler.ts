import express, { Router, Request, Response } from "express";
import { success } from "@/lib/responseFormat";
import { getGpuScheduler } from "@/services/gpu";
import { activeTrackerCount } from "./_shared/asyncCallback";

const router = express.Router();

/**
 * GET /api/v1/ace/scheduler
 *
 * GPU scheduler state - all services, VRAM usage, available modes.
 */
export default router.get("/", async (_req, res) => {
  const scheduler = getGpuScheduler();
  const state = await scheduler.getState();

  // Add VRAM details for each GPU
  const gpuDetails = await Promise.all(state.devices.map(async (gpu) => {
    const freeMb = await scheduler.getGpuVramFree(gpu.id);
    const usedMb = await scheduler.getGpuVramUsed(gpu.id);
    return {
      ...gpu,
      used_mb: usedMb,
      free_mb: freeMb,
      utilization_pct: Math.round((usedMb / gpu.totalMb) * 100),
    };
  }));

  return res.status(200).send(
    success({
      gpus: gpuDetails,
      services: state.services.map(s => ({
        id: s.profileId,
        variant: s.variantId,
        status: s.status,
        vram_mb: s.actualVramMb,
        last_transition: s.lastTransitionAt,
        last_request: s.lastRequestAt,
      })),
      locks: state.locks,
      async_callbacks_in_flight: activeTrackerCount(),
    })
  );
});

/**
 * POST /api/v1/ace/scheduler/release
 *
 * Force release a specific service or all services on a GPU.
 */
router.post("/release", async (req: Request, res: Response) => {
  const { serviceId, gpuId } = req.body || {};
  const scheduler = getGpuScheduler();

  if (serviceId) {
    await scheduler.release(serviceId, "manual");
    return res.status(200).send(success({ released: serviceId }));
  }

  if (gpuId !== undefined) {
    await scheduler.releaseAllOnGpu(Number(gpuId));
    return res.status(200).send(success({ released: `all-on-gpu-${gpuId}` }));
  }

  return res.status(400).send({ error: "Specify serviceId or gpuId" });
});
