/**
 * Director Desk — 能力查询 API
 *
 * GET /api/v1/director-desk/capabilities
 *
 * 返回导演台支持的所有 bodyType、pose、道具类型，
 * 供 Agent 构造场景 JSON 时参考。
 */

import express from "express";
import { success } from "@/lib/responseFormat";

const router = express.Router();

router.get("/", (_req, res) => {
  res.status(200).send(
    success({
      bodyTypes: [
        { id: "mannequin", label: "标准男性" },
        { id: "female", label: "标准女性" },
        { id: "broad", label: "壮硕体型" },
        { id: "muscular", label: "肌肉体型" },
        { id: "slim", label: "纤瘦体型" },
        { id: "teen", label: "少年体型" },
        { id: "child", label: "儿童体型" },
        { id: "chibi", label: "Q版小人" },
      ],
      poses: [
        { id: "stand", label: "站立" },
        { id: "t-pose", label: "T型" },
        { id: "walk", label: "行走" },
        { id: "run", label: "跑步" },
        { id: "sit", label: "坐姿" },
        { id: "crouch", label: "蹲下" },
        { id: "kneel-one", label: "单膝跪" },
        { id: "kneel-two", label: "双膝跪" },
        { id: "hands-on-hips", label: "叉腰" },
        { id: "lean", label: "倚靠" },
        { id: "bow", label: "鞠躬" },
        { id: "think", label: "思考" },
        { id: "fight", label: "格斗" },
        { id: "kick", label: "踢球" },
        { id: "throw", label: "投掷" },
        { id: "push", label: "推进" },
        { id: "wave", label: "招手" },
        { id: "reach", label: "伸手" },
        { id: "cross-arms", label: "抱臂" },
        { id: "phone", label: "看手机" },
      ],
      propTypes: [
        { id: "box", label: "方盒" },
        { id: "cylinder", label: "圆柱" },
        { id: "sphere", label: "球体" },
        { id: "cone", label: "锥体" },
        { id: "chair", label: "椅子" },
        { id: "wall", label: "墙壁" },
      ],
      defaults: {
        rigType: "ue4-mannequin",
        cameraFov: 50,
        backgroundColor: "#1a1a2e",
      },
      notes: [
        "rigType 固定为 ue4-mannequin（render API 自动强制）",
        "posePresetId 自动展开为骨骼 controls（render API 自动处理）",
        "Agent 只需构造 objects + cameras，pose 自动生效",
      ],
    }),
  );
});

export default router;
