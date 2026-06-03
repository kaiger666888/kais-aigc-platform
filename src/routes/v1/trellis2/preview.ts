import express from "express";
import path from "path";
import fs from "fs";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

const OUTPUT_DIR = process.env.OUTPUT_DIR || "/mnt/agents/output";

interface AngleConfig {
  azimuth: number;
  polar: number;
  suffix: string;
}

const ANGLES: AngleConfig[] = [
  { azimuth: 0, polar: Math.PI / 4, suffix: "preview1" },
  { azimuth: (2 * Math.PI) / 3, polar: Math.PI / 4, suffix: "preview2" },
  { azimuth: (4 * Math.PI) / 3, polar: Math.PI / 4, suffix: "preview3" },
];

const HTML_TEMPLATE = (glbUrl: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>body{margin:0;overflow:hidden;background:#1a1a2e}canvas{display:block}</style>
</head><body>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
  }
}
</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
camera.position.set(0, 0.5, 2);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(512, 512);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(2, 3, 2);
scene.add(dirLight);
const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
dirLight2.position.set(-2, 1, -2);
scene.add(dirLight2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = false;

const loader = new GLTFLoader();
loader.load('${glbUrl}', (gltf) => {
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 1.5 / maxDim;
  model.scale.setScalar(scale);
  model.position.sub(center.multiplyScalar(scale));
  scene.add(model);

  window.__modelReady = true;
  window.__takeScreenshot = (azimuth, polar) => {
    const radius = camera.position.length();
    camera.position.x = radius * Math.sin(polar) * Math.sin(azimuth);
    camera.position.y = radius * Math.cos(polar);
    camera.position.z = radius * Math.sin(polar) * Math.cos(azimuth);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  };
}, undefined, (err) => {
  document.title = 'ERROR:' + err.message;
});
</script></body></html>`;

export default router.post("/:filename", async (req, res) => {
  const { filename } = req.params;
  const safeName = path.basename(filename);
  const ext = path.extname(safeName).toLowerCase();

  if (ext !== ".glb") {
    return res.status(400).send(error("Preview only supports GLB files"));
  }

  const glbPath = path.join(OUTPUT_DIR, safeName);

  // Ensure GLB file exists locally
  if (!fs.existsSync(glbPath)) {
    try {
      const { execSync } = await import("child_process");
      execSync(`docker cp comfyui-trellis:/app/ComfyUI/output/${safeName} "${glbPath}"`, {
        timeout: 15_000,
      });
    } catch {
      return res.status(404).send(error(`GLB file '${safeName}' not found`));
    }
  }

  const screenshots: string[] = [];

  try {
    const pw: any = require("/home/kai/.openclaw/workspace/node_modules/playwright");
    const chromium: { launch: (opts: any) => Promise<any> } = pw.chromium;
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 512, height: 512 },
    });
    const page = await context.newPage();

    // Serve the GLB file via a local file URL
    const glbFileUrl = `file://${glbPath}`;
    const htmlContent = HTML_TEMPLATE(glbFileUrl);

    // Write temp HTML
    const tmpHtml = path.join(OUTPUT_DIR, `_preview_${Date.now()}.html`);
    fs.writeFileSync(tmpHtml, htmlContent);

    await page.goto(`file://${tmpHtml}`, { waitUntil: "load", timeout: 30_000 });

    // Wait for model to load
    await page.waitForFunction(() => (window as any).__modelReady, { timeout: 60_000 }).catch(() => {});

    const modelReady = await page.evaluate(() => (window as any).__modelReady);
    if (!modelReady) {
      await browser.close();
      fs.unlinkSync(tmpHtml);
      return res.status(500).send(error("Failed to load GLB model in browser"));
    }

    // Take screenshots from 3 angles
    for (const angle of ANGLES) {
      const dataUrl = await page.evaluate(
        ({ azimuth, polar }: { azimuth: number; polar: number }) => (window as any).__takeScreenshot(azimuth, polar),
        { azimuth: angle.azimuth, polar: angle.polar },
      );

      const baseName = path.basename(safeName, ".glb");
      const shotName = `${baseName}_${angle.suffix}.png`;
      const shotPath = path.join(OUTPUT_DIR, shotName);

      // Remove data URL prefix and save
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      fs.writeFileSync(shotPath, Buffer.from(base64Data, "base64"));
      screenshots.push(shotName);
    }

    await browser.close();
    fs.unlinkSync(tmpHtml);
  } catch (err: any) {
    return res.status(500).send(error(`Preview generation failed: ${err.message}`));
  }

  return res.status(200).send(success({
    filename: safeName,
    screenshots,
    message: "Preview screenshots generated",
  }));
});
