import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增资产（补全字段版）
//
// 历史问题：本路由只写 name/describe/type/projectId/prompt，导致 o_assets 行
// 缺 uuid / imageId / characterId / viewAngle —— 资产管理中心无法跨项目寻址、
// 无法关联图片。现在补全这些字段，使 agent-sync.js 与画布管线都能经此路由注册
// 完整资产（与 /api/v1/assets-registry 的 create 对齐）。
//
// - uuid：未传则自动生成（与 registry 同格式 `ast-<b36>-<rand>`），保证全局可寻址。
// - imageId / characterId / viewAngle / assetsId / tags：透传（均可空）。
// - id：INTEGER PRIMARY KEY 自增（SQLite rowid 别名），无需显式赋值。
export default router.post(
  "/",
  validateFields({
    name: z.string(),
    describe: z.string(),
    type: z.string(),
    projectId: z.number(),
    remark: z.string().optional().nullable(),
    prompt: z.string().optional().nullable(),
    uuid: z.string().optional(),
    imageId: z.number().optional().nullable(),
    characterId: z.string().optional().nullable(),
    viewAngle: z.string().optional().nullable(),
    assetsId: z.number().optional().nullable(),
    tags: z.string().optional().nullable(),
    model: z.string().optional().nullable(),
  }),
  async (req, res) => {
    const {
      name, describe, type, projectId, remark, prompt,
      uuid, imageId, characterId, viewAngle, assetsId, tags, model,
    } = req.body;
    const now = Date.now();
    // 与 assets-registry create 同格式的全局 uuid（未提供时自动生成）。
    const assetUuid =
      uuid || `ast-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await u.db("o_assets").insert({
      name,
      describe,
      type,
      projectId,
      remark: remark ?? null,
      prompt: prompt ?? null,
      uuid: assetUuid,
      imageId: imageId ?? null,
      characterId: characterId ?? null,
      viewAngle: viewAngle ?? null,
      assetsId: assetsId ?? null,
      tags: tags ?? null,
      model: model ?? null,
      state: "active",
      startTime: now,
      createdAt: now,
      createdBy: "agent-sync",
    });
    res.status(200).send(success({ uuid: assetUuid, message: "新增资产成功" }));
  },
);
