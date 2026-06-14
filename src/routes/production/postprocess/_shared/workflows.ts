import { POSTPROCESS_MODELS } from "./config";

export interface PostprocessWorkflowOpts {
  inputFilename: string;
  steps: string[];
  filenamePrefix: string;
  codeformerFidelity?: number;
  depthModel?: string;
  upscaleModel?: string;
}

/**
 * 构建后处理 workflow
 *
 * 支持步骤 (串行链路):
 *   1. codeformer — CodeFormer 面部修复
 *   2. depth      — DepthAnythingV2 深度图 (独立分支, 不修改主链路)
 *   3. ultrasharp — 4x-UltraSharp 锐化放大
 *   4. realesrgan — RealESRGAN_x4plus 超分放大 (备选)
 *
 * 链路: LoadImage → [CodeFormer] → [UltraSharp/RealESRGAN]
 *       LoadImage → [Depth] (独立输出)
 */
export function buildPostprocessWorkflow(opts: PostprocessWorkflowOpts) {
  const {
    inputFilename,
    steps,
    filenamePrefix,
    codeformerFidelity = 0.7,
    depthModel = "large",
    upscaleModel = POSTPROCESS_MODELS.ultrasharp,
  } = opts;

  const nodes: Record<string, any> = {};
  let nextId = 1;
  const nextNodeId = () => String(nextId++);

  // ─── LoadImage ─────────────────────────────
  const loadImgId = nextNodeId();
  nodes[loadImgId] = {
    class_type: "LoadImage",
    inputs: { image: inputFilename },
  };

  // 主链路: 当前图片引用 (会被 codeformer 更新)
  let mainImage: [string, number] = [loadImgId, 0];

  // ─── Step: CodeFormer 面部修复 ───────────────
  if (steps.includes("codeformer")) {
    const loaderId = nextNodeId();
    nodes[loaderId] = {
      class_type: "FaceRestoreModelLoader",
      inputs: { model_name: POSTPROCESS_MODELS.codeformer },
    };

    const cfId = nextNodeId();
    nodes[cfId] = {
      class_type: "FaceRestoreCFWithModel",
      inputs: {
        facerestore_model: [loaderId, 0],
        image: mainImage,
        facedetection: POSTPROCESS_MODELS.faceDetection,
        codeformer_fidelity: codeformerFidelity,
      },
    };

    const saveId = nextNodeId();
    nodes[saveId] = {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `${filenamePrefix}_codeformer`,
        images: [cfId, 0],
      },
    };

    // 更新主链路为 CodeFormer 输出
    mainImage = [cfId, 0];
  }

  // ─── Step: DepthAnythingV2 深度图 (独立分支) ──
  if (steps.includes("depth")) {
    const depthId = nextNodeId();
    nodes[depthId] = {
      class_type: "DepthAnythingV2Preprocessor",
      inputs: {
        image: [loadImgId, 0], // 深度图始终从原图生成
        model: depthModel,
      },
    };

    const saveId = nextNodeId();
    nodes[saveId] = {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `${filenamePrefix}_depth`,
        images: [depthId, 0],
      },
    };
  }

  // ─── Step: UltraSharp 锐化放大 ──────────────
  if (steps.includes("ultrasharp")) {
    const loaderId = nextNodeId();
    nodes[loaderId] = {
      class_type: "Upscale Model Loader",
      inputs: { model_name: POSTPROCESS_MODELS.ultrasharp },
    };

    const upscaleId = nextNodeId();
    nodes[upscaleId] = {
      class_type: "ImageUpscaleWithModel",
      inputs: {
        upscale_model: [loaderId, 0],
        image: mainImage,
      },
    };

    const saveId = nextNodeId();
    nodes[saveId] = {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `${filenamePrefix}_ultrasharp`,
        images: [upscaleId, 0],
      },
    };

    mainImage = [upscaleId, 0];
  }

  // ─── Step: RealESRGAN 超分 (备选) ────────────
  if (steps.includes("realesrgan")) {
    const loaderId = nextNodeId();
    nodes[loaderId] = {
      class_type: "Upscale Model Loader",
      inputs: { model_name: POSTPROCESS_MODELS.realesrgan },
    };

    const upscaleId = nextNodeId();
    nodes[upscaleId] = {
      class_type: "ImageUpscaleWithModel",
      inputs: {
        upscale_model: [loaderId, 0],
        image: mainImage,
      },
    };

    const saveId = nextNodeId();
    nodes[saveId] = {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `${filenamePrefix}_realesrgan`,
        images: [upscaleId, 0],
      },
    };
  }

  return nodes;
}

import express from "express";
const router = express.Router();
export default router;
