import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { execSync, spawnSync } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { TRELLIS2_CONFIG } from "./config";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-trellis-input";

if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}

const upload = multer({ dest: LOCAL_STAGING_DIR });

export default router.post("/", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send(error("No image file uploaded"));
  }

  const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
  const resolution = req.body.resolution || "512";
  const maxTokens = req.body.max_tokens ? Number(req.body.max_tokens) : 262144;
  const ssGuidanceStrength = req.body.guidance_strength ? Number(req.body.guidance_strength) : 6.5;
  const samplingSteps = req.body.sampling_steps ? Number(req.body.sampling_steps) : 12;
  const textureSize = req.body.texture_size ? Number(req.body.texture_size) : 2048;
  const targetFaceCount = req.body.target_face_count ? Number(req.body.target_face_count) : 500000;
  const filenamePrefix = req.body.filename_prefix || `trellis2_${Date.now()}`;
  const fileFormat = req.body.file_format || "glb";

  const ext = path.extname(req.file.originalname || ".png") || ".png";
  const inputFilename = `${uuidv4()}${ext}`;
  const localPath = req.file.path;
  const containerInputPath = `${TRELLIS2_CONFIG.comfyuiInputDir}/${inputFilename}`;
  const containerName = TRELLIS2_CONFIG.containerName;

  try {
    execSync(`docker cp "${localPath}" ${containerName}:"${containerInputPath}"`, {
      timeout: 30_000,
    });
  } catch {
    // Fallback: pipe via stdin (needed if input dir is volume-mounted)
    try {
      const fileContent = fs.readFileSync(localPath);
      const child = spawnSync("docker", ["exec", "-i", containerName, "bash", "-c", `cat > "${containerInputPath}"`], {
        input: fileContent,
        timeout: 30_000,
      });
      if (child.status !== 0) {
        throw new Error(child.stderr?.toString() || "docker exec failed");
      }
    } catch (err: any) {
      fs.unlinkSync(localPath);
      return res.status(502).send(error(`Failed to upload image to ComfyUI container: ${err.message}`));
    }
  }

  // Cleanup local staging file
  try { fs.unlinkSync(localPath); } catch {}

  const prompt = buildPrompt({
    inputFilename,
    seed,
    resolution,
    maxTokens,
    ssGuidanceStrength,
    samplingSteps,
    textureSize,
    targetFaceCount,
    filenamePrefix,
    fileFormat,
  });

  try {
    const comfyRes = await axios.post(`${TRELLIS2_CONFIG.comfyuiUrl}/prompt`, { prompt }, {
      timeout: 30_000,
      validateStatus: (s) => s < 500,
    });

    if (comfyRes.status !== 200) {
      // Cleanup container input on failure
      try {
        execSync(`docker exec ${containerName} rm -f ${containerInputPath}`, { timeout: 5_000 });
      } catch {}
      return res.status(502).send(error(`ComfyUI rejected prompt: ${JSON.stringify(comfyRes.data)}`));
    }

    const promptId = comfyRes.data.prompt_id;
    return res.status(200).send(success({
      promptId,
      inputFilename,
      status: "pending",
      message: "Image-to-3D task submitted to ComfyUI",
    }));
  } catch (err: any) {
    // Cleanup container input on failure
    try {
      execSync(`docker exec ${containerName} rm -f ${containerInputPath}`, { timeout: 5_000 });
    } catch {}
    const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
    return res.status(502).send(error(`ComfyUI request failed: ${msg}`));
  }
});

function buildPrompt(opts: {
  inputFilename: string;
  seed: number;
  resolution: string;
  maxTokens: number;
  ssGuidanceStrength: number;
  samplingSteps: number;
  textureSize: number;
  targetFaceCount: number;
  filenamePrefix: string;
  fileFormat: string;
}) {
  const {
    inputFilename, seed, resolution, maxTokens,
    ssGuidanceStrength, samplingSteps, textureSize,
    targetFaceCount, filenamePrefix, fileFormat,
  } = opts;

  const guidanceRescale = 0.05;

  return {
    "1": {
      class_type: "LoadImage",
      inputs: { image: inputFilename },
    },
    "11": {
      class_type: "InvertMask",
      inputs: { mask: ["1", 1] },
    },
    "68": {
      class_type: "LoadTrellis2Models",
      inputs: {
        resolution,
        precision: "auto",
        attn_backend: "auto",
      },
    },
    "69": {
      class_type: "Trellis2GetConditioning",
      inputs: {
        model_config: ["68", 0],
        image: ["1", 0],
        mask: ["11", 0],
        background_color: "black",
      },
    },
    "82": {
      class_type: "Trellis2ImageToShape",
      inputs: {
        model_config: ["68", 0],
        conditioning: ["69", 0],
        seed,
        ss_guidance_strength: ssGuidanceStrength,
        ss_guidance_rescale: guidanceRescale,
        ss_sampling_steps: samplingSteps,
        shape_guidance_strength: ssGuidanceStrength,
        shape_guidance_rescale: guidanceRescale,
        shape_sampling_steps: samplingSteps,
        max_tokens: maxTokens,
      },
    },
    "97": {
      class_type: "Trellis2ProcessMesh",
      inputs: {
        trimesh: ["82", 0],
        remesh: "on",
        "remesh.remesh_band": 1,
        "remesh.remove_inner_faces": true,
        target_face_count: targetFaceCount,
        floater_threshold: 0.001,
        weld_vertices: true,
        weld_digits: 4,
        chart_cone_angle: 90,
        chart_refine_iterations: 1,
        chart_global_iterations: 1,
        chart_smooth_strength: 1,
      },
    },
    "83": {
      class_type: "Trellis2ShapeToTexturedMesh",
      inputs: {
        model_config: ["68", 0],
        conditioning: ["69", 0],
        shape_slat: ["82", 1],
        subs: ["82", 2],
        seed,
        tex_guidance_strength: 3.0,
        tex_guidance_rescale: 0.2,
        tex_sampling_steps: samplingSteps,
      },
    },
    "98": {
      class_type: "Trellis2RasterizePBR",
      inputs: {
        trimesh: ["97", 0],
        voxelgrid: ["83", 0],
        original_mesh: ["82", 0],
        texture_size: textureSize,
      },
    },
    "86": {
      class_type: "Trellis2ExportTrimesh",
      inputs: {
        trimesh: ["98", 0],
        filename_prefix: filenamePrefix,
        file_format: fileFormat,
      },
    },
  };
}
