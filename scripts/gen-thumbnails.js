#!/usr/bin/env node
/**
 * 批量缩略图生成脚本（纯 JS，无 TS 编译依赖）
 *
 * 用法：
 *   cd /data/workspace/kais-aigc-platform && node scripts/gen-thumbnails.js
 *
 * 扫描 data/oss 下的图片/视频，为每个生成 data/oss/_thumbs/... WebP 缩略图。
 * 幂等：已生成且较新的跳过。
 *
 * 规格：max width 400px, quality 80, WebP（图片用 sharp，视频用 ffmpeg 首帧）。
 */

"use strict";

const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
let sharp;
try {
  sharp = require("sharp");
} catch (e) {
  console.error("未安装 sharp，请运行: npm install sharp");
  process.exit(1);
}

const OSS_DIR = path.join(__dirname, "..", "data", "oss");
const MAX_WIDTH = 400;
const QUALITY = 80;

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv"]);

const TARGET_DIRS = [
  { dir: "scifi-epic/assets/scene_refs", exts: ["png", "jpg", "jpeg", "webp"], label: "场景参考图" },
  { dir: "scifi-epic/assets/videos_trimmed", exts: ["mp4", "webm", "mov"], label: "视频" },
  { dir: "scifi-epic/assets/storyboards", exts: ["png", "jpg", "jpeg", "webp"], label: "分镜图" },
  { dir: "scifi-epic/assets/characters", exts: ["png", "jpg", "jpeg", "webp"], label: "角色图" },
  { dir: "scifi-epic/assets", exts: ["png", "jpg", "jpeg", "webp"], label: "其他资产" },
];

async function scanDir(relDir, exts) {
  const dir = path.join(OSS_DIR, relDir);
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).slice(1).toLowerCase();
      if (!exts.includes(ext)) continue;
      files.push(path.join(dir, e.name));
    }
    return files;
  } catch {
    return [];
  }
}

function toThumbFs(srcFs) {
  const rel = path.relative(OSS_DIR, srcFs);
  const base = rel.replace(/\.[^.]+$/, "");
  return path.join(OSS_DIR, "_thumbs", base + ".webp");
}

async function isNewer(thumbFs, srcFs) {
  try {
    const [ts, ss] = await Promise.all([fsp.stat(thumbFs), fsp.stat(srcFs)]);
    return ts.mtimeMs >= ss.mtimeMs && ts.size > 0;
  } catch {
    return false;
  }
}

async function genImage(srcFs, thumbFs) {
  await fsp.mkdir(path.dirname(thumbFs), { recursive: true });
  await sharp(srcFs)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(thumbFs);
}

async function genVideo(srcFs, thumbFs) {
  await fsp.mkdir(path.dirname(thumbFs), { recursive: true });
  const buildArgs = (seek) => [
    "-y", "-ss", seek, "-i", srcFs,
    "-frames:v", "1", "-vf", "scale=400:-1",
    "-f", "webp", thumbFs,
  ];
  try {
    await execFileAsync("ffmpeg", buildArgs("1"), { timeout: 30000 });
  } catch {
    await execFileAsync("ffmpeg", buildArgs("0"), { timeout: 30000 });
  }
}

async function ensureThumb(srcFs) {
  const ext = path.extname(srcFs).toLowerCase();
  const thumbFs = toThumbFs(srcFs);
  if (await isNewer(thumbFs, srcFs)) return "cached";
  if (IMAGE_EXTS.has(ext)) {
    await genImage(srcFs, thumbFs);
    return "generated";
  }
  if (VIDEO_EXTS.has(ext)) {
    await genVideo(srcFs, thumbFs);
    return "generated";
  }
  return "skipped";
}

async function main() {
  console.log("OSS 目录:", OSS_DIR);
  if (!fs.existsSync(OSS_DIR)) {
    console.error("OSS 目录不存在");
    process.exit(1);
  }

  const allFiles = [];
  for (const g of TARGET_DIRS) {
    const files = await scanDir(g.dir, g.exts);
    console.log(`[${g.label}] ${g.dir}: ${files.length} 个文件`);
    allFiles.push(...files);
  }

  if (allFiles.length === 0) {
    console.log("\n没有找到任何媒体文件，退出。");
    return;
  }

  console.log(`\n共 ${allFiles.length} 个文件待处理（已生成的会跳过）...\n`);

  let generated = 0, cached = 0, skipped = 0, failed = 0;
  const t0 = Date.now();

  for (let i = 0; i < allFiles.length; i++) {
    const srcFs = allFiles[i];
    try {
      const res = await ensureThumb(srcFs);
      if (res === "generated") generated++;
      else if (res === "cached") cached++;
      else skipped++;
    } catch (err) {
      console.error(`  失败 ${path.relative(OSS_DIR, srcFs)}:`, err.message || err);
      failed++;
      skipped++;
    }
    if ((i + 1) % 25 === 0 || i === allFiles.length - 1) {
      console.log(`  进度 ${i + 1}/${allFiles.length} (新=${generated} 缓存=${cached} 跳过=${skipped} 失败=${failed})`);
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ 完成 — 新生成 ${generated}，缓存 ${cached}，跳过 ${skipped}，耗时 ${dt}s`);
}

main().catch((err) => {
  console.error("批量缩略图生成失败:", err);
  process.exit(1);
});
