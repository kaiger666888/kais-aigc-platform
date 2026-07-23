import { SEEDVR2_DEFAULTS, SEEDVR2_MODELS, SeedVR2ColorCorrection } from "./config";

export interface SeedVR2BaseOpts {
  filenamePrefix: string;
  ditModel?: string;
  vaeModel?: string;
  device?: string;
  offloadDevice?: string;
  blocksToSwap?: number;
  encodeTiled?: boolean;
  decodeTiled?: boolean;
  tileSize?: number;          // VAE 分块尺寸(默认 512)
  resolution?: number;
  maxResolution?: number;
  colorCorrection?: SeedVR2ColorCorrection;
  seed?: number;
}

export interface SeedVR2ImageOpts extends SeedVR2BaseOpts {
  inputFilename: string; // ComfyUI input/ 下的文件名
}

export interface SeedVR2VideoOpts extends SeedVR2BaseOpts {
  inputFilename: string;
  frameRate: number;
  batchSize?: number;     // 必须 4n+1
  temporalOverlap?: number;
  uniformBatchSize?: boolean;
}

// ─── 内部：DiT / VAE 加载器（图与视频共用） ──────────────
function addLoaders(
  nodes: Record<string, any>,
  nextId: () => string,
  opts: SeedVR2BaseOpts,
): { ditId: string; vaeId: string } {
  const ditId = nextId();
  nodes[ditId] = {
    class_type: "SeedVR2LoadDiTModel",
    inputs: {
      model: opts.ditModel || SEEDVR2_MODELS.dit,
      device: opts.device || SEEDVR2_DEFAULTS.device,
      blocks_to_swap: opts.blocksToSwap ?? SEEDVR2_DEFAULTS.blocksToSwap,
      offload_device: opts.offloadDevice || SEEDVR2_DEFAULTS.offloadDevice,
    },
  };

  const vaeId = nextId();
  nodes[vaeId] = {
    class_type: "SeedVR2LoadVAEModel",
    inputs: {
      model: opts.vaeModel || SEEDVR2_MODELS.vae,
      device: opts.device || SEEDVR2_DEFAULTS.device,
      encode_tiled: opts.encodeTiled ?? SEEDVR2_DEFAULTS.encodeTiled,
      decode_tiled: opts.decodeTiled ?? SEEDVR2_DEFAULTS.decodeTiled,
      ...(opts.encodeTiled ?? SEEDVR2_DEFAULTS.encodeTiled
        ? { encode_tile_size: opts.tileSize ?? SEEDVR2_DEFAULTS.tileSize, encode_tile_overlap: 64 }
        : {}),
      ...(opts.decodeTiled ?? SEEDVR2_DEFAULTS.decodeTiled
        ? { decode_tile_size: opts.tileSize ?? SEEDVR2_DEFAULTS.tileSize, decode_tile_overlap: 64 }
        : {}),
    },
  };

  return { ditId, vaeId };
}

// ─── 单图超分 workflow ────────────────────────────────
// LoadImage → SeedVR2LoadDiTModel → SeedVR2LoadVAEModel → SeedVR2VideoUpscaler(batch=1) → SaveImage
export function buildSeedVR2ImageWorkflow(opts: SeedVR2ImageOpts) {
  const {
    inputFilename,
    filenamePrefix,
    resolution = SEEDVR2_DEFAULTS.resolution,
    maxResolution = SEEDVR2_DEFAULTS.maxResolution,
    colorCorrection = SEEDVR2_DEFAULTS.colorCorrection,
    seed = SEEDVR2_DEFAULTS.seed,
  } = opts;

  const nodes: Record<string, any> = {};
  let nextNum = 1;
  const nextId = () => String(nextNum++);

  const loadImgId = nextId();
  nodes[loadImgId] = {
    class_type: "LoadImage",
    inputs: { image: inputFilename },
  };

  const { ditId, vaeId } = addLoaders(nodes, nextId, opts);

  const upscaleId = nextId();
  nodes[upscaleId] = {
    class_type: "SeedVR2VideoUpscaler",
    inputs: {
      image: [loadImgId, 0],
      dit: [ditId, 0],
      vae: [vaeId, 0],
      seed,
      resolution,
      max_resolution: maxResolution,
      batch_size: 1, // 单图强制 1（4n+1, n=0）
      uniform_batch_size: false,
      color_correction: colorCorrection,
    },
  };

  const saveId = nextId();
  nodes[saveId] = {
    class_type: "SaveImage",
    inputs: {
      filename_prefix: `${filenamePrefix}_seedvr2`,
      images: [upscaleId, 0],
    },
  };

  return nodes;
}

// ─── 视频超分 workflow ────────────────────────────────
// VHS_LoadVideo → SeedVR2LoadDiTModel → SeedVR2LoadVAEModel → SeedVR2VideoUpscaler(batch=21) → VHS_VideoCombine
export function buildSeedVR2VideoWorkflow(opts: SeedVR2VideoOpts) {
  const {
    inputFilename,
    filenamePrefix,
    frameRate,
    batchSize = SEEDVR2_DEFAULTS.batchSizeVideo,
    temporalOverlap = SEEDVR2_DEFAULTS.temporalOverlap,
    uniformBatchSize = SEEDVR2_DEFAULTS.uniformBatchSize,
    resolution = SEEDVR2_DEFAULTS.resolution,
    maxResolution = SEEDVR2_DEFAULTS.maxResolution,
    colorCorrection = SEEDVR2_DEFAULTS.colorCorrection,
    seed = SEEDVR2_DEFAULTS.seed,
  } = opts;

  // batch_size 必须 4n+1（节点校验），强制对齐
  const alignedBatch = Math.max(1, Math.floor((batchSize - 1) / 4) * 4 + 1);

  const nodes: Record<string, any> = {};
  let nextNum = 1;
  const nextId = () => String(nextNum++);

  const loadVidId = nextId();
  nodes[loadVidId] = {
    class_type: "VHS_LoadVideo",
    inputs: {
      video: inputFilename,
      force_rate: 0,
      custom_width: 0,
      custom_height: 0,
      frame_load_cap: 0,
      skip_first_frames: 0,
      select_every_nth: 1,
    },
  };

  const { ditId, vaeId } = addLoaders(nodes, nextId, opts);

  const upscaleId = nextId();
  nodes[upscaleId] = {
    class_type: "SeedVR2VideoUpscaler",
    inputs: {
      image: [loadVidId, 0],
      dit: [ditId, 0],
      vae: [vaeId, 0],
      seed,
      resolution,
      max_resolution: maxResolution,
      batch_size: alignedBatch,
      uniform_batch_size: uniformBatchSize,
      color_correction: colorCorrection,
      temporal_overlap: temporalOverlap,
    },
  };

  const saveId = nextId();
  nodes[saveId] = {
    class_type: "VHS_VideoCombine",
    inputs: {
      images: [upscaleId, 0],
      frame_rate: frameRate,
      loop_count: 0,
      filename_prefix: `${filenamePrefix}_seedvr2`,
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      save_metadata: true,
      trim_to_audio: false,
      pingpong: false,
      save_output: true,
    },
  };

  return nodes;
}
