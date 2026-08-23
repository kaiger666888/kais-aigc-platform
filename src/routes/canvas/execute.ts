import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { simulateExecution } from "./_simulate";
import { markStaleAndBroadcast } from "./_stale";
const router = express.Router();

/** 触发节点执行 */
export default router.post(
  "/",
  validateFields({
    // projectId: canvas-UI sends number; IterationEngine sends number OR string.
    projectId: z.union([z.number(), z.string()]),
    // episodesId: canvas-UI sends number; IterationEngine omits entirely.
    episodesId: z.number().optional(),
    nodeId: z.string().min(1),
    // nodeType: canvas-UI sends a string; IterationEngine omits (defaults to 'script').
    nodeType: z.string().optional(),
    // prompt + branchId: IterationEngine sends these for single-node regeneration.
    prompt: z.string().optional(),
    branchId: z.string().optional(),
    // 52-02: params(配方袋,REGEN-02 换 seed 提交通道)。validateFields 只校验不回写
    // (middleware safeParse 后 next(),extra key 本就原样穿透无行为变化)——此字段为
    // 契约诚实 + 防未来有人给 middleware 加 strip 回写踩雷。
    // 59-02 起 params 自本 phase 起被 handler 消费:随 overrides 透传
    // simulateExecution(metadata 平铺达引擎 params,含 params.seed → REGEN-02)。
    params: z.record(z.string(), z.unknown()).optional(),
    // 59-02: regenSource(窄触发重生成身份标识,Pattern 4)。validateFields 不
    // strip 未知键——此声明为契约诚实 + 类型提示 + zod 白名单枚举(Security V5:
    // 客户端可伪造信号,仅作标记依据绝不当权限依据;最坏语义=多显示一个 stale
    // 角标,重跑仍走既有通道)。orchestrate/CanvasContextMenu 永不携带 →
    // SC3 零波及是架构性保证而非行为过滤(D-01)。合法值仅两条窄路径:
    //   'panel-regen'(NodeDetailPanel 面板配方重生成)/'reroll-seed'(事件芯片换 seed 重跑)
    regenSource: z.enum(["panel-regen", "reroll-seed"]).optional(),
  }),
  async (req, res) => {
    const { projectId, episodesId, nodeId, nodeType, prompt, branchId, params, regenSource } = req.body;

    try {
      // IterationEngine path: caller omits episodesId (single-node regeneration
      // via _callEngine). Return a structured queued response — engine dispatch
      // will be wired in a follow-up. This closes the 400-validation-breakpoint
      // without disturbing the canvas-UI simulateExecution flow.
      // 59-fix WR-02: running 广播已下移过全部早退分支——本分支不发 running
      // (无终态跟进的 running 会让客户端节点卡「生成中」),queued 响应即终点。
      if (episodesId === undefined || episodesId === null) {
        return res.status(200).send(success({
          status: "queued",
          nodeId,
          branchId: branchId || null,
          message: `Regeneration queued for node ${nodeId}`,
        }));
      }

      const effectiveType = nodeType || "script";
      // 52-07(2026-08-22 真机实证):REGEN-01/02 提交的 nodeType 是 V3 asset.stage
      // (52-03 地雷 #4 裁定)——真实图含 'global'(p04 角色/p07 场景)、'voice' 等
      // Stage 值,原 allowlist 缺失 → 真机重生成 400(mock fixture 只有 storyboard,
      // e2e 测不出)。补齐 V3 Stage 全集(types.ts Stage union)+ 既有 V2 类型。
      const supportedTypes = [
        "asset", "storyboard", "video", "audio", "3d",
        "variant", "reference", "upscale", "face_restore", "script",
        "global", "keyframe", "voice", "foley", "bgm", "mix", "composite",
      ];
      if (!supportedTypes.includes(effectiveType)) {
        // 59-fix WR-02: 早退分支补终态事件——running 曾在本分支之前无条件广播,
        // 400 后无 success/error 跟进 → 客户端节点卡「生成中」。error 终态不清
        // stale(52-01 红线),安全。
        broadcastToProject(projectId, "node:state", { nodeId, state: "error" });
        console.log(`[canvas:execute] 未知节点类型: ${effectiveType}`);
        return res.status(400).send(error(`不支持的节点类型: ${effectiveType}`));
      }

      // 59-fix WR-02: running 广播仅在 setImmediate 派发真正武装时发(全部早退
      // 分支已过)——每个 running 必有 success/error 终态跟进,客户端不再卡态。
      broadcastToProject(projectId, "node:state", {
        nodeId,
        state: "running",
        progress: 0,
      });

      setImmediate(async () => {
        try {
          // 59-02: overrides 透传(REGEN-02 seed 不再丢弃——params.seed 数值直达
          // 引擎提交体 params.seed;params 配方袋 + prompt + nodeType 同袋)。
          await simulateExecution(projectId, nodeId, episodesId, {
            prompt,
            seed: typeof params?.seed === "number" ? params.seed : undefined,
            params,
            nodeType: effectiveType,
          });
          // 59-02 D-01:窄触发成功后服务端级联标记——仅 regenSource 在场才触发
          // (orchestrate/ContextMenu 无此通道 = SC3 架构性保证)。标记自身失败
          // 不把成功翻成 error(引擎任务已成功,级联标记是派生动作)。
          if (regenSource) {
            try {
              await markStaleAndBroadcast(projectId, episodesId, nodeId);
            } catch (e) {
              console.error("[canvas:execute] stale 标记失败:", e);
            }
          }
          broadcastToProject(projectId, "node:state", { nodeId, state: "success" });
        } catch (err) {
          // D-02:引擎失败(error 广播)结构性不进任何标记——catch 分支无
          // markStaleAndBroadcast 调用(59-02 S3-engine-fail 负向断言锁死)。
          broadcastToProject(projectId, "node:state", { nodeId, state: "error" });
        }
      });

      return res.status(200).send(success({ nodeId, status: "triggered" }));
    } catch (err) {
      console.error("[canvas:execute] 执行节点失败:", err);
      broadcastToProject(projectId, "node:state", { nodeId, state: "error" });
      return res.status(500).send(error("执行节点失败"));
    }
  },
);
