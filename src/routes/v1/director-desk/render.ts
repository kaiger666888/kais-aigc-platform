/**
 * Director Desk — 渲染 API
 *
 * POST /api/v1/director-desk/render
 *
 * 输入: { project: DirectorProject, width?, height?, cameraId? }
 *   或: { sceneId, projectId, episodesId }  → 从 DB 读取已保存的场景
 *
 * 输出: { imageUrl: "/oss/director-desk/xxx.png", width, height, timestamp }
 *
 * 流程:
 *   1. 解析场景 JSON（直接传入或从 DB 读取）
 *   2. 调用 Puppeteer 渲染截图
 *   3. 保存 PNG 到 OSS 目录
 *   4. 返回 web 可访问的 URL
 */

import express from "express";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { success, error } from "@/lib/responseFormat";
import { renderDirectorDeskScene, createDemoScene } from "./_render";

const router = express.Router();

/** OSS 输出目录 */
const OSS_DIR =
  process.env.OSS_DIR || "/data/workspace/kais-aigc-platform/data/oss";

/** OSS web 前缀 */
const OSS_WEB_PREFIX = "/oss";

router.post(
  "/",
  async (req, res) => {
    const body = req.body || {};

    // 解析场景 JSON
    let project: unknown;

    if (body.project) {
      // 直接传入场景 JSON
      project = body.project;
    } else if (body.sceneId) {
      // 从 DB 读取已保存的场景
      const u = (await import("@/utils")).default;
      const key = `director-desk-scene:${body.sceneId}`;
      const row = await u
        .db("o_agentWorkData")
        .where("projectId", String(body.projectId))
        .andWhere("episodesId", String(body.episodesId))
        .andWhere("key", key)
        .first();
      if (!row?.data) {
        return res
          .status(404)
          .send(error(`场景 ${body.sceneId} 不存在`));
      }
      try {
        const payload = JSON.parse(row.data);
        project = payload.project;
      } catch {
        return res.status(500).send(error("场景 JSON 解析失败"));
      }
    } else if (body.demo) {
      // 演示模式 — 使用内置 demo 场景
      project = createDemoScene();
    } else {
      return res
        .status(400)
        .send(error("需要提供 project (场景JSON), sceneId (已保存场景), 或 demo=true"));
    }

    const width = body.width || 1280;
    const height = body.height || 720;
    const waitFor = body.waitFor || 3000;
    const cameraId = body.cameraId;

    // 异步渲染 — 先返回 task 状态
    if (body.async) {
      const taskId = `dd-render-${Date.now()}`;
      res.status(200).send(success({ taskId, status: "rendering" }));

      setImmediate(async () => {
        try {
          const result = await renderDirectorDeskScene({
            project,
            width,
            height,
            waitFor,
            cameraId,
          });
          await saveRenderResult(taskId, result);
          console.log(`[director-desk:render] ${taskId} done`);
        } catch (err: any) {
          console.error(`[director-desk:render] ${taskId} failed:`, err.message);
          await saveRenderError(taskId, err.message);
        }
      });
      return;
    }

    // 同步渲染
    try {
      const result = await renderDirectorDeskScene({
        project,
        width,
        height,
        waitFor,
        cameraId,
      });

      // 保存到 OSS 目录
      const fileName = `director-desk-${Date.now()}.png`;
      const dir = path.join(OSS_DIR, "director-desk");
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, result.buffer);

      const imageUrl = `${OSS_WEB_PREFIX}/director-desk/${fileName}`;

      res.status(200).send(
        success({
          imageUrl,
          width: result.width,
          height: result.height,
          timestamp: result.timestamp,
          fileSize: result.buffer.length,
        }),
      );
    } catch (err: any) {
      console.error("[director-desk:render] error:", err.message);
      res.status(500).send(error("渲染失败: " + err.message));
    }
  },
);

/** 简单的内存任务状态（生产环境应换成 Redis/DB） */
const taskResults = new Map<string, unknown>();

async function saveRenderResult(
  taskId: string,
  result: { buffer: Buffer; width: number; height: number; timestamp: string },
) {
  const fileName = `director-desk-${Date.now()}.png`;
  const dir = path.join(OSS_DIR, "director-desk");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), result.buffer);

  const imageUrl = `${OSS_WEB_PREFIX}/director-desk/${fileName}`;
  taskResults.set(taskId, {
    status: "done",
    imageUrl,
    width: result.width,
    height: result.height,
    timestamp: result.timestamp,
  });

  // 清理旧任务（保留最近 100 个）
  if (taskResults.size > 100) {
    const firstKey = taskResults.keys().next().value;
    if (firstKey) taskResults.delete(firstKey);
  }
}

async function saveRenderError(taskId: string, message: string) {
  taskResults.set(taskId, { status: "error", error: message });
}

/** GET /render/status/:taskId — 查询异步渲染结果 */
router.get("/status/:taskId", (req, res) => {
  const { taskId } = req.params;
  const result = taskResults.get(taskId);
  if (!result) {
    return res.status(404).send(error("任务不存在或已过期"));
  }
  res.status(200).send(success(result));
});

export default router;
