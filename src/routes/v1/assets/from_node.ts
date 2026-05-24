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
    project_id: z.string(),
    node_id: z.string().optional(),
    name: z.string(),
    type: z.string().optional(), // role | scene | tool
    description: z.string().optional(),
    prompt: z.string().optional(),
    seed_lock: z.string().optional(),
    lora_path: z.string().optional(),
    style_prompt: z.string().optional(),
    is_global: z.boolean().optional(),
  }),
  async (req, res) => {
    const { project_id, node_id, name, type, description, prompt, seed_lock, lora_path, style_prompt, is_global } = req.body;

    const id = Date.now();
    await u.db("kv_nodeAsset").insert({
      id,
      projectId: project_id,
      nodeId: node_id || "",
      name,
      type: type || "role",
      describe: description || "",
      prompt: prompt || "",
      seedLock: seed_lock || "",
      loraPath: lora_path || "",
      stylePrompt: style_prompt || "",
      createTime: Date.now(),
    });

    res.status(200).send(success({ id, message: "资产创建成功" }));
  },
);
