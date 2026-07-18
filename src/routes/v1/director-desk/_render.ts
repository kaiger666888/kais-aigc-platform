/**
 * Director Desk — Playwright 渲染引擎
 *
 * 打开 director-desk SPA → 注入场景 JSON → 等待 3D canvas 渲染 → 截图
 *
 * 使用全局安装的 playwright (npx playwright) + 系统 Chromium
 */

import { chromium, type Browser, type Page } from "playwright";

/**
 * Pose preset → controls 映射
 *
 * 从 mannequinPosePresets.ts 复制 — replaceProject() 不会自动展开 posePresetId，
 * 必须在注入前把 controls 填好，否则角色保持 T-pose。
 */
const POSE_PRESETS: Record<string, Record<string, number>> = {
  "stand": {},
  "t-pose": {
    "leftShoulder.spread": -70, "rightShoulder.spread": 70,
    "leftShoulder.pitch": 15, "rightShoulder.pitch": 15,
    "leftElbow.bend": 10, "rightElbow.bend": 10,
  },
  "walk": {
    "leftShoulder.pitch": 20, "rightShoulder.pitch": -20,
    "leftHip.pitch": -20, "rightHip.pitch": 20,
    "leftKnee.bend": 12, "rightKnee.bend": 4,
  },
  "run": {
    "leftShoulder.pitch": 42, "rightShoulder.pitch": -42,
    "leftHip.pitch": -35, "rightHip.pitch": 40,
    "leftKnee.bend": 28, "rightKnee.bend": 18,
  },
  "sit": {
    "torso.pitch": -10,
    "leftHip.pitch": 80, "rightHip.pitch": 80,
    "leftKnee.bend": 90, "rightKnee.bend": 90,
  },
  "crouch": {
    "body.offsetY": -0.43, "body.pitch": -26, "torso.pitch": -24, "head.pitch": 22,
    "leftHip.pitch": 92, "rightHip.pitch": 92,
    "leftKnee.bend": 112, "rightKnee.bend": 112,
    "leftShoulder.pitch": 52, "rightShoulder.pitch": 50,
    "leftShoulder.spread": -10, "rightShoulder.spread": 10,
    "leftElbow.bend": 80, "rightElbow.bend": 76,
  },
  "kneel-one": {
    "body.offsetY": -0.42, "body.pitch": -16, "torso.pitch": -10, "head.pitch": 12,
    "leftHip.pitch": 68, "leftKnee.bend": 86, "leftFoot.pitch": 20,
    "rightHip.pitch": -15, "rightKnee.bend": 80, "rightFoot.pitch": 60,
    "leftShoulder.pitch": 5, "leftShoulder.spread": 10, "leftShoulder.twist": -10, "leftElbow.bend": 30,
    "rightShoulder.pitch": -18, "rightShoulder.spread": 10, "rightElbow.bend": 18,
  },
  "kneel-two": {
    "body.offsetY": -0.4, "body.pitch": 2, "torso.pitch": 8, "head.pitch": -2,
    "leftShoulder.pitch": -10, "rightShoulder.pitch": -10,
    "leftShoulder.spread": -5, "rightShoulder.spread": 5,
    "leftElbow.bend": 8, "rightElbow.bend": 8,
    "leftHip.pitch": -8, "rightHip.pitch": -8,
    "leftKnee.bend": 126, "rightKnee.bend": 126,
    "leftFoot.pitch": -20, "rightFoot.pitch": -20,
  },
  "hands-on-hips": {
    "leftShoulder.pitch": -36, "rightShoulder.pitch": -36,
    "leftShoulder.spread": 0, "rightShoulder.spread": 0,
    "leftShoulder.twist": 80, "rightShoulder.twist": -80,
    "leftElbow.bend": 86, "rightElbow.bend": 86,
    "leftHand.roll": -35, "rightHand.roll": 35,
  },
  "lean": {
    "body.roll": -10,
    "leftHip.spread": -8, "rightHip.spread": 8,
    "head.roll": 6,
  },
  "bow": {
    "body.pitch": -46, "torso.pitch": -10, "head.pitch": 20,
    "leftHip.pitch": 49, "rightHip.pitch": 49,
    "leftShoulder.pitch": 5, "rightShoulder.pitch": 5,
    "leftShoulder.spread": 10, "rightShoulder.spread": -10,
    "leftElbow.bend": 12, "rightElbow.bend": 12,
  },
  "think": {
    "rightShoulder.pitch": 8, "rightShoulder.spread": 0, "rightShoulder.twist": -40,
    "rightElbow.bend": 90, "rightHand.roll": -40, "rightHand.pitch": 15, "rightHand.twist": -10,
    "leftShoulder.pitch": 8, "leftShoulder.spread": 0, "leftShoulder.twist": 40,
    "leftElbow.bend": 90,
  },
  "fight": {
    "body.yaw": -10, "body.pitch": 5, "torso.yaw": 8, "head.yaw": 8,
    "leftShoulder.pitch": 48, "leftShoulder.spread": -16, "leftShoulder.twist": 22,
    "rightShoulder.pitch": 30, "rightShoulder.spread": 0, "rightShoulder.twist": -22,
    "leftElbow.bend": 86, "rightElbow.bend": 84,
    "leftHip.spread": -18, "rightHip.spread": 22,
    "leftHip.pitch": 4, "rightHip.pitch": -6,
    "leftKnee.bend": 12, "rightKnee.bend": 18,
  },
  "kick": {
    "leftHip.pitch": -8, "rightHip.pitch": 58, "rightKnee.bend": 35,
    "leftShoulder.pitch": 18, "rightShoulder.pitch": -24,
  },
  "throw": {
    "body.offsetY": -0.12, "body.pitch": 5, "body.yaw": 14, "torso.yaw": -10, "head.yaw": 8,
    "rightShoulder.pitch": 76, "rightShoulder.spread": -14, "rightShoulder.twist": 28,
    "rightElbow.bend": 86, "rightHand.roll": 18, "rightHand.pitch": -12,
    "leftShoulder.pitch": 34, "leftShoulder.spread": 10, "leftShoulder.twist": 8,
    "leftElbow.bend": 54, "leftHand.pitch": -10,
    "leftHip.spread": -12, "rightHip.spread": 18,
    "leftHip.pitch": 24, "rightHip.pitch": -10,
    "leftKnee.bend": 30, "rightKnee.bend": 14,
    "leftFoot.pitch": -8, "rightFoot.roll": 6,
  },
  "push": {
    "body.offsetY": -0.16, "body.pitch": 5, "body.yaw": 38, "torso.pitch": -4, "head.pitch": 6,
    "leftShoulder.pitch": 92, "rightShoulder.pitch": 92,
    "leftShoulder.spread": -11, "rightShoulder.spread": 11,
    "leftShoulder.twist": 6, "rightShoulder.twist": -6,
    "leftElbow.bend": 6, "rightElbow.bend": 6,
    "leftHand.pitch": -14, "rightHand.pitch": -14,
    "leftHip.spread": -12, "rightHip.spread": 14,
    "leftHip.pitch": 38, "rightHip.pitch": -20,
    "leftKnee.bend": 42, "rightKnee.bend": 20,
    "leftFoot.pitch": -6, "rightFoot.roll": 8,
  },
  "wave": {
    "rightShoulder.pitch": 60, "rightShoulder.spread": 0, "rightShoulder.twist": 30,
    "rightElbow.bend": 90, "rightHand.roll": -20, "rightHand.pitch": 12, "rightHand.twist": 10,
    "leftShoulder.pitch": -10, "leftShoulder.spread": 8, "leftElbow.bend": 18, "leftHand.pitch": -8,
  },
  "reach": {
    "rightShoulder.pitch": 50, "rightElbow.bend": 12, "body.pitch": 0,
  },
  "cross-arms": {
    "leftShoulder.pitch": 50, "leftShoulder.spread": -55, "leftShoulder.twist": 75,
    "leftElbow.bend": 50, "leftHand.roll": 0, "leftHand.pitch": -10,
    "rightShoulder.pitch": 90, "rightShoulder.spread": 55, "rightShoulder.twist": -45,
    "rightElbow.bend": 50, "rightHand.roll": 18, "rightHand.pitch": -10,
  },
  "phone": {
    "head.pitch": 18,
    "rightShoulder.pitch": 20, "rightShoulder.spread": -4, "rightShoulder.twist": -30,
    "rightElbow.bend": 82, "rightHand.roll": -30, "rightHand.pitch": 14, "rightHand.twist": 60,
    "leftShoulder.pitch": -10, "leftShoulder.spread": 8, "leftElbow.bend": 16, "leftHand.pitch": -8,
  },
};

/**
 * 预处理 project JSON：展开所有角色的 posePresetId → controls
 *
 * replaceProject() 不会自动查找 preset controls，必须手动填充。
 * 同时确保 rigType 为 "ue4-mannequin" 以加载真实骨骼模型。
 */
function expandPosePresets(project: any): any {
  if (!project || !Array.isArray(project.objects)) return project;

  const objects = project.objects.map((obj: any) => {
    if (obj.kind !== "character" || !obj.characterRig) return obj;

    const rig = { ...obj.characterRig };
    // 强制使用 UE4 mannequin（真实骨骼模型，不是几何体）
    rig.rigType = "ue4-mannequin";

    // 展开 posePresetId → controls
    const poseId = rig.posePresetId;
    if (poseId && POSE_PRESETS[poseId]) {
      rig.controls = { ...POSE_PRESETS[poseId] };
    } else if (!rig.controls) {
      rig.controls = {};
    }

    return { ...obj, characterRig: rig };
  });

  return { ...project, objects };
}

/** Chrome for Testing 二进制路径 */
const CHROME_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  process.env.CHROME_PATH ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;

/** Platform 的 base URL */
const PLATFORM_BASE =
  process.env.PLATFORM_BASE_URL || "http://localhost:10588";

export interface RenderOptions {
  /** DirectorProject JSON */
  project: unknown;
  width?: number;
  height?: number;
  /** 截图前等待 ms */
  waitFor?: number;
  /** 指定 camera shot ID */
  cameraId?: string;
  /** 切换到 camera 视角（而非 director 视角）。默认 false = director 视角截图效果更好 */
  cameraMode?: boolean;
}

export interface RenderResult {
  buffer: Buffer;
  timestamp: string;
  width: number;
  height: number;
}

/**
 * 渲染 DirectorProject JSON 为 PNG
 */
export async function renderDirectorDeskScene(
  opts: RenderOptions,
): Promise<RenderResult> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const waitFor = opts.waitFor ?? 3000;

  const browser: Browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true as boolean | "shell",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      // WebGL via SwiftShader (software rendering)
      "--use-gl=angle",
      "--use-angle=swiftshader-webgl",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader",
      `--window-size=${width},${height}`,
    ],
  });

  try {
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width, height });

    // 导航到 director-desk
    const url = `${PLATFORM_BASE}/director-desk/?theme=dark`;
    console.log(`[director-desk:render] navigating to ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });

    // 等待 canvas 出现
    await page.waitForSelector("canvas", { timeout: 15_000 });
    console.log("[director-desk:render] canvas found, waiting for init...");
    await page.waitForTimeout(1000);

    // 预处理：展开 posePresetId → controls + 强制 UE4 mannequin
    const expandedProject = expandPosePresets(opts.project);

    // 注入场景 JSON
    console.log("[director-desk:render] injecting project JSON (poses expanded)...");
    await page.evaluate((project) => {
      const store = (window as any).__directorStore;
      if (!store?.getState) {
        throw new Error("__directorStore not available — check director-desk build");
      }
      store.getState().replaceProject(project);
    }, expandedProject);

    // 等 React/Three.js 重新渲染
    await page.waitForTimeout(800);

    // 切换到 camera 视角（仅在明确请求时）
    if (opts.cameraMode === true) {
      console.log("[director-desk:render] switching to camera view...");
      await page.evaluate((cameraId) => {
        const store = (window as any).__directorStore;
        const state = store.getState();
        if (cameraId) {
          state.setActiveCamera(cameraId);
        }
        state.setViewMode("camera");
      }, opts.cameraId || null);
    }

    // 等待渲染稳定
    console.log(`[director-desk:render] waiting ${waitFor}ms for render...`);
    await page.waitForTimeout(waitFor);

    // 计算角色 bounding box 的屏幕投影区域（由 SPA 内部计算，THREE 对象完整可用）
    const clipRegion = await page.evaluate(() => {
      const fn = (window as any).__computeCharacterClip;
      if (typeof fn !== "function") return null;
      return fn();
    });

    // 截取 Three.js canvas（裁剪到角色区域，或全画布）
    let buffer: Buffer;
    if (clipRegion && clipRegion.width > 50 && clipRegion.height > 50) {
      console.log(`[director-desk:render] clip region: ${JSON.stringify(clipRegion)}`);
      // 用 page.screenshot + clip 而非 elementHandle.screenshot + clip
      // (elementHandle.screenshot 的 clip 参数在某些版本不生效)
      buffer = (await page.screenshot({
        type: "png",
        clip: clipRegion as { x: number; y: number; width: number; height: number },
      })) as Buffer;
    } else {
      console.log("[director-desk:render] no clip region, full canvas");
      const canvas = await page.$("canvas");
      if (!canvas) throw new Error("Canvas not found after render");
      buffer = (await canvas.screenshot({ type: "png" })) as Buffer;
    }
    console.log(`[director-desk:render] screenshot captured (${buffer.length} bytes)`);

    return {
      buffer,
      timestamp: new Date().toISOString(),
      width,
      height,
    };
  } finally {
    await browser.close();
  }
}

/**
 * 构造一个默认的演示场景
 */
export function createDemoScene() {
  return {
    version: 1 as const,
    scene: {
      scale: 1,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      backgroundColor: "#1a1a2e",
      panoramaYaw: 0,
      panoramaRadius: 60,
      showLabels: false,
      snapToGrid: false,
      showGround: true,
      groundOpacity: 0.3,
      groundHeight: 0,
    },
    assets: [],
    objects: [
      {
        id: "char-1",
        name: "角色A",
        kind: "character",
        visible: true,
        locked: false,
        transform: {
          position: [-1.5, 0, 0],
          rotation: [0, 0.3, 0],
          scale: [1, 1, 1],
        },
        bodyType: "mannequin",
        color: "#4F8EF7",
        characterRig: {
          rigType: "mannequin",
          posePresetId: "standing-idle",
          controls: {},
        },
      },
      {
        id: "char-2",
        name: "角色B",
        kind: "character",
        visible: true,
        locked: false,
        transform: {
          position: [1.5, 0, 0],
          rotation: [0, -0.3, 0],
          scale: [1, 1, 1],
        },
        bodyType: "female",
        color: "#E0524D",
        characterRig: {
          rigType: "mannequin",
          posePresetId: "standing-idle",
          controls: {},
        },
      },
    ],
    cameras: [
      {
        id: "cam-1",
        name: "主机位",
        fov: 50,
        transform: {
          position: [0, 2.5, 6],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        targetMode: "manual",
        target: [0, 1, 0],
      },
    ],
    activeCameraId: "cam-1",
    panoramaAssetId: null,
  };
}
