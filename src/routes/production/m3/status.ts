/**
 * m3 status — MiniMax-Music3 状态轮询别名路由
 *
 * 薄封装复用 music3/status (同一 express Router 实例):
 *   GET /api/production/m3/status/:taskId ≡ GET /api/production/music3/status/:taskId
 */
import express from "express";
import music3Status from "../music3/status";

const router = express.Router();
router.use(music3Status);

export default router;
