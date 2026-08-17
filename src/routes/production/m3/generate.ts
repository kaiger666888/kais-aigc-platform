/**
 * m3 generate — MiniMax-Music3 生成别名路由
 *
 * 薄封装复用 music3/generate (同一 express Router 实例, 无状态可安全共享):
 *   POST /api/production/m3/generate ≡ POST /api/production/music3/generate
 * statusUrl 用 req.baseUrl 动态前缀, m3 入口返回 /api/production/m3/status/...。
 */
import express from "express";
import music3Generate from "../music3/generate";

const router = express.Router();
router.use(music3Generate);

export default router;
