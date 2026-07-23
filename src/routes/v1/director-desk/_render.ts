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
    "torso.pitch": 12, "head.pitch": -5,
    "leftShoulder.pitch": 65, "rightShoulder.pitch": -65,
    "leftElbow.bend": 80, "rightElbow.bend": 80,
    "leftHip.pitch": -45, "rightHip.pitch": 50,
    "leftKnee.bend": 55, "rightKnee.bend": 25,
    "body.offsetY": -0.05, "body.pitch": 8,
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

/**
 * 规范化 project JSON：接受 Agent 简写的扁平格式，补全为完整 DirectorProject 结构。
 *
 * Agent 可以发送：
 *   { objects: [{ type: "character", position: [0,0,0], pose: "wave" }] }
 * 函数会自动补全为：
 *   { version: 1, scene: {...}, assets: [], objects: [{ kind: "character", transform: {...}, characterRig: {...} }] }
 */
function normalizeProject(input: any): any {
  // 构建 scene：如果 input.scene 已有完整结构就直接用，否则从 input.settings 或默认值构建
  const settings = input.scene || {};
  const inputSettings = input.settings || {};
  
  const project: any = {
    version: 1,
    scene: {
      scale: settings.scale ?? 1,
      position: settings.position ?? [0, 0, 0],
      rotation: settings.rotation ?? [0, 0, 0],
      backgroundColor: settings.backgroundColor ?? inputSettings.background ?? "#1a1a2e",
      panoramaYaw: settings.panoramaYaw ?? 0,
      panoramaRadius: settings.panoramaRadius ?? 60,
      showLabels: settings.showLabels ?? true,
      snapToGrid: settings.snapToGrid ?? false,
      showGround: settings.showGround ?? inputSettings.groundVisible ?? true,
      groundOpacity: settings.groundOpacity ?? 0.4,
      groundHeight: settings.groundHeight ?? 0,
    },
    assets: input.assets || [],
    objects: [],
    cameras: [],
    activeCameraId: input.activeCameraId || null,
    panoramaAssetId: input.panoramaAssetId || null,
  };

  // 合并 input.characters 到 objects（Agent 常用 characters 简写）
  const allObjects = [
    ...(Array.isArray(input.characters) ? input.characters : []),
    ...(Array.isArray(input.objects) ? input.objects : []),
  ];

  // 规范化 objects
  if (allObjects.length > 0) {
    project.objects = allObjects.map((obj: any, i: number) => {
      // 如果已经是完整格式，直接用
      if (obj.kind && obj.transform) {
        return obj;
      }

      // 扁平格式 → 完整格式
      const pos = obj.position || [0, 0, 0];
      // Agent sends degrees; Three.js Euler needs radians
      const deg2rad = (d: number) => (d * Math.PI) / 180;
      const rot: [number, number, number] = (() => {
        if (typeof obj.rotation === "number") return [0, deg2rad(obj.rotation), 0];
        if (Array.isArray(obj.rotation)) return obj.rotation.map(deg2rad) as [number, number, number];
        return [0, 0, 0];
      })();
      const scl = typeof obj.scale === "number" ? [obj.scale, obj.scale, obj.scale] : (obj.scale || [1, 1, 1]);

      const kind = obj.kind || obj.type || "character";
      const id = obj.id || `obj-${i + 1}`;

      // 缩放以身体中心为原点：模型脚底在 y=0，标准身高约 1.8
      // 放大时上移 pos.y = height*(scale-1)/2 让中心不变
      let adjustedPos = pos;
      if (kind === "character") {
        const heightApprox = 1.8; // UE4 mannequin ≈180cm
        const yOffset = (scl[1] - 1) * heightApprox / 2;
        adjustedPos = [pos[0], pos[1] + yOffset, pos[2]];
      }

      const result: any = {
        id,
        name: obj.name || (kind === "character" ? `角色${String(i + 1).padStart(2, "0")}` : id),
        kind,
        visible: obj.visible ?? true,
        locked: obj.locked ?? false,
        transform: { position: adjustedPos, rotation: rot, scale: scl },
      };

      if (kind === "character") {
        result.characterRig = {
          rigType: obj.rigType || "ue4-mannequin",
          posePresetId: obj.posePresetId || obj.pose || "stand",
          controls: obj.controls || {},
        };
        if (obj.bodyType) result.bodyType = obj.bodyType;
      }

      if (obj.color) result.color = obj.color;

      return result;
    });
  }

  // 合并 input.camera（单数简写）到 cameras
  const allCameras = [
    ...(input.camera ? [input.camera] : []),
    ...(Array.isArray(input.cameras) ? input.cameras : []),
  ];

  // 规范化 cameras
  if (allCameras.length > 0) {
    project.cameras = allCameras.map((cam: any, i: number) => {
      // 如果已经是完整格式，直接用
      if (cam.transform && cam.targetMode) {
        return cam;
      }

      const pos = cam.position || [0, 1.2, 4];
      const id = cam.id || `cam-${i + 1}`;

      return {
        id,
        name: cam.name || `机位${String(i + 1).padStart(2, "0")}`,
        fov: cam.fov || 50,
        transform: {
          position: pos,
          rotation: cam.rotation || [0, 0, 0],
          scale: [1, 1, 1],
        },
        targetMode: "manual",
        target: cam.lookAt || cam.target || [0, 1, 0],
      };
    });
  }

  return project;
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
    headless: true,
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

    // 监听页面错误（用于调试 WebGL context loss）
    page.on("pageerror", (err) => {
      console.log(`[director-desk:render] pageerror: ${err.message.substring(0, 200)}`);
    });

    // 导航到 director-desk
    const url = `${PLATFORM_BASE}/director-desk/?theme=dark`;
    console.log(`[director-desk:render] navigating to ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });

    // 等待 canvas 出现
    await page.waitForSelector("canvas", { timeout: 15_000 });
    console.log("[director-desk:render] canvas found, waiting for init...");
    await page.waitForTimeout(1000);

    // 预处理：规范化 project 结构 → 展开 posePresetId → controls
    const normalizedProject = expandPosePresets(normalizeProject(opts.project));
    console.log(`[director-desk:render] normalized project keys:`, Object.keys(normalizedProject), `objects:`, normalizedProject.objects?.length, `first obj:`, JSON.stringify(normalizedProject.objects?.[0]?.characterRig || {}).substring(0, 100));

    // 注入场景 JSON
    console.log("[director-desk:render] injecting project JSON (poses expanded)...");
    await page.evaluate((project) => {
      const store = (window as any).__directorStore;
      if (!store?.getState) {
        throw new Error("__directorStore not available — check director-desk build");
      }
      store.getState().replaceProject(project);
    }, normalizedProject);

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

    // Auto-frame: 仅在 Agent 没有指定 camera 参数时自动取景
    // 如果 Agent 传了 camera 参数，直接应用到 Three.js camera 上
    const agentCameras = (normalizedProject as any)?.cameras;
    if (agentCameras && agentCameras.length > 0) {
      const cam = agentCameras[0]; // 用第一个 camera
      console.log(`[director-desk:render] applying agent camera: pos=${JSON.stringify(cam.transform.position)} lookAt=${JSON.stringify(cam.target)} fov=${cam.fov}`);
      await page.evaluate((camData: { pos: number[]; lookAt: number[]; fov: number }) => {
        const w = window as any;
        const camera = w.__threeCamera;
        if (!camera) throw new Error("__threeCamera not available");
        camera.position.set(camData.pos[0], camData.pos[1], camData.pos[2]);
        camera.lookAt(camData.lookAt[0], camData.lookAt[1], camData.lookAt[2]);
        camera.fov = camData.fov;
        camera.updateProjectionMatrix();
      }, {
        pos: cam.transform.position,
        lookAt: cam.target,
        fov: cam.fov,
      });
      await page.waitForTimeout(500);
    } else {
      const framed = await page.evaluate(() => {
        const fn = (window as any).__autoFrameCamera;
        if (typeof fn !== "function") return false;
        return fn();
      });

      if (framed) {
        console.log("[director-desk:render] auto-framed camera to fit all characters (no explicit camera)");
        await page.waitForTimeout(500);
      }
    }

    // 正式导出：用 SPA 内置的 capture 管线 (gl.render + canvas.toDataURL)
    // 而非 Playwright page.screenshot 截图
    const captureResult = await page.evaluate(async () => {
      const w = window as any;
      // 方式1: 优先用 SPA 正式的 captureBridge
      if (typeof w.requestViewportCapture === "function") {
        try {
          const results = await w.requestViewportCapture({
            preset: "current",
            source: "capture-panel",
          });
          if (results && results.length > 0 && results[0].dataUrl) {
            return {
              dataUrl: results[0].dataUrl,
              label: results[0].label,
              method: "captureBridge",
            };
          }
        } catch (e) {
          console.warn("captureBridge failed:", e);
        }
      }
      // 方式2: fallback — 直接 gl.render + toDataURL
      const gl = w.__threeGL;
      const scene = w.__threeScene;
      const camera = w.__threeCamera;
      if (gl && scene && camera) {
        gl.render(scene, camera);
        const canvas = gl.domElement as HTMLCanvasElement;
        return {
          dataUrl: canvas.toDataURL("image/png"),
          label: "direct-gl",
          method: "direct-toDataURL",
        };
      }
      return null;
    });

    if (!captureResult || !captureResult.dataUrl) {
      throw new Error("Capture failed — no dataUrl returned");
    }

    console.log(`[director-desk:render] captured via ${captureResult.method} (${captureResult.dataUrl.length} chars dataUrl)`);

    // dataURL → Buffer
    const base64Data = captureResult.dataUrl.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

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
