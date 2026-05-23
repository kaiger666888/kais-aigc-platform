import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 从画布节点创建资产
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    nodeId: z.string(),
    name: z.string(),
    type: z.string(), // role | scene | tool
    describe: z.string().optional(),
    prompt: z.string().optional(),
    seedLock: z.string().optional(),
    loraPath: z.string().optional(),
    stylePrompt: z.string().optional(),
  }),
  async (req, res) => {
    const { projectId, nodeId, name, type, describe, prompt, seedLock, loraPath, stylePrompt } = req.body;

    const id = Date.now();
    await u.db("kv_nodeAsset").insert({
      id,
      projectId,
      nodeId,
      name,
      type,
      describe: describe || "",
      prompt: prompt || "",
      seedLock: seedLock || "",
      loraPath: loraPath || "",
      stylePrompt: stylePrompt || "",
      createTime: Date.now(),
    });

    res.status(200).send(success({ id, message: "资产创建成功" }));
  },
);
