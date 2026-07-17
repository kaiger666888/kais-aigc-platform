/**
 * 缩略图生成核心逻辑 — 图片用 sharp，视频用 ffmpeg
 *
 * 设计目标：
 * - 输入：OSS URL（如 /oss/scifi-epic/assets/scene_refs/EP1-S01.png）
 * - 输出：压缩 WebP 缩略图路径（如 /oss/_thumbs/scifi-epic/assets/scene_refs/EP1-S01.webp）
 * - 缩略图规格：max width 400px, quality 80, WebP（典型 ~30-80KB，原图 3-6MB）
 * - 幂等：若缩略图已存在且 mtime >= 源文件 mtime，直接返回缓存
 *
 * 目录约定：
 * - 源文件位于 `${ossDir}/<project>/...`
 * - 缩略图位于 `${ossDir}/_thumbs/<project>/...`（_thumbs 前缀避免和项目目录冲突）
 * - Express 已挂 /oss → ossDir，所以 _thumbs 自动可通过 /oss/_thumbs/ 访问
 */

import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import u from "@/utils";

const execFileAsync = promisify(execFile);

const MAX_WIDTH = 400;
const QUALITY = 80;

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv"]);

/** 判断是否是已知媒体扩展名 */
export function isMediaPath(sourcePath: string): boolean {
  const ext = path.extname(sourcePath).toLowerCase();
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}

export function isImagePath(sourcePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(sourcePath).toLowerCase());
}

export function isVideoPath(sourcePath: string): boolean {
  return VIDEO_EXTS.has(path.extname(sourcePath).toLowerCase());
}

/**
 * 将 OSS URL 转换为缩略图 OSS URL。
 * 例如 /oss/scifi-epic/assets/EP1-S01.png → /oss/_thumbs/scifi-epic/assets/EP1-S01.webp
 * 已是 _thumbs 的则原样返回。
 */
export function toThumbnailUrl(sourcePath: string): string | null {
  if (!sourcePath || !sourcePath.startsWith("/oss/")) return null;
  const rel = sourcePath.slice("/oss/".length); // scifi-epic/assets/EP1-S01.png
  if (rel.startsWith("_thumbs/")) return sourcePath; // 已是缩略图
  const ext = path.extname(rel);
  const base = rel.slice(0, -ext.length || undefined);
  return `/oss/_thumbs/${base}.webp`;
}

/**
 * 将 OSS URL 转换为本地文件系统绝对路径。
 * /oss/scifi-epic/x.png → ${ossDir}/scifi-epic/x.png
 */
function ossUrlToFs(ossUrl: string): string {
  const ossDir = u.getPath("oss");
  if (!ossUrl.startsWith("/oss/")) return ossUrl;
  return path.join(ossDir, ossUrl.slice("/oss/".length));
}

function thumbnailFsPath(sourcePath: string): string | null {
  const thumbUrl = toThumbnailUrl(sourcePath);
  if (!thumbUrl) return null;
  return ossUrlToFs(thumbUrl);
}

async function isNewer(thumbFs: string, srcFs: string): Promise<boolean> {
  try {
    const [thumbStat, srcStat] = await Promise.all([fsp.stat(thumbFs), fsp.stat(srcFs)]);
    return thumbStat.mtimeMs >= srcStat.mtimeMs && thumbStat.size > 0;
  } catch {
    return false;
  }
}

async function generateImageThumbnail(srcFs: string, thumbFs: string): Promise<void> {
  await fsp.mkdir(path.dirname(thumbFs), { recursive: true });
  await sharp(srcFs)
    .rotate() // 自动根据 EXIF 旋转
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(thumbFs);
}

async function generateVideoThumbnail(srcFs: string, thumbFs: string): Promise<void> {
  await fsp.mkdir(path.dirname(thumbFs), { recursive: true });
  // 尝试第 1 秒首帧；若视频短于 1s，ffmpeg 会失败 → 退到第 0 秒
  const args = (seek: string) => [
    "-y",
    "-ss", seek,
    "-i", srcFs,
    "-frames:v", "1",
    "-vf", "scale=400:-1",
    "-f", "webp",
    thumbFs,
  ];
  try {
    await execFileAsync("ffmpeg", args("1"), { timeout: 30_000 });
  } catch {
    // fallback: 第 0 秒
    await execFileAsync("ffmpeg", args("0"), { timeout: 30_000 });
  }
}

export interface EnsureThumbnailResult {
  thumbnailUrl: string;
  generated: boolean; // true=新生成, false=命中缓存
  skipped?: boolean; // true=源文件不存在或非媒体类型
}

/**
 * 主入口：为给定的 OSS URL 确保缩略图存在，返回缩略图 URL。
 * 幂等——已存在且较新则直接返回。
 */
export async function ensureThumbnail(sourcePath: string): Promise<EnsureThumbnailResult> {
  const thumbUrl = toThumbnailUrl(sourcePath);
  if (!thumbUrl) {
    return { thumbnailUrl: sourcePath, generated: false, skipped: true };
  }

  const srcFs = ossUrlToFs(sourcePath);
  const thumbFs = thumbnailFsPath(sourcePath)!;

  // 源文件不存在 → 直接返回原 URL（可能还没下载完，下次再试）
  if (!fs.existsSync(srcFs)) {
    return { thumbnailUrl: sourcePath, generated: false, skipped: true };
  }

  // 缓存命中
  if (await isNewer(thumbFs, srcFs)) {
    return { thumbnailUrl: thumbUrl, generated: false };
  }

  try {
    if (isImagePath(sourcePath)) {
      await generateImageThumbnail(srcFs, thumbFs);
    } else if (isVideoPath(sourcePath)) {
      await generateVideoThumbnail(srcFs, thumbFs);
    } else {
      return { thumbnailUrl: sourcePath, generated: false, skipped: true };
    }
    return { thumbnailUrl: thumbUrl, generated: true };
  } catch (err) {
    console.error(`[thumbnail] 生成失败 ${sourcePath}:`, err);
    // 生成失败时返回原图路径（降级），不破坏现有功能
    return { thumbnailUrl: sourcePath, generated: false, skipped: true };
  }
}

/**
 * 判断一个 thumbnailUrl 是否"指向原图而非缩略图"——需要被替换。
 * 用于 save hook 中遍历节点。
 */
export function needsThumbnailing(thumbnailUrl: string): boolean {
  if (!thumbnailUrl || typeof thumbnailUrl !== "string") return false;
  if (!thumbnailUrl.startsWith("/oss/")) return false;
  if (thumbnailUrl.includes("/_thumbs/")) return false;
  return isMediaPath(thumbnailUrl);
}

/**
 * 处理单个 node payload（用于 node_upsert 事件）。
 * 若 payload.data.thumbnailUrl 指向原图则生成缩略图并替换，同时保留原路径到 filePath。
 * 原地修改 payload 并返回是否变更。
 */
export async function processNodePayloadThumbnail(
  payload: Record<string, unknown>,
): Promise<boolean> {
  const data = payload.data as Record<string, unknown> | undefined;
  if (!data) return false;
  const thumb = data.thumbnailUrl as string | undefined;
  if (!thumb || !needsThumbnailing(thumb)) return false;

  const result = await ensureThumbnail(thumb);
  if (result.skipped || result.thumbnailUrl === thumb) return false;

  if (!data.filePath) {
    data.filePath = thumb;
  }
  data.thumbnailUrl = result.thumbnailUrl;
  return true;
}

/**
 * 遍历 FlowGraph 节点，为每个指向原图的 thumbnailUrl 生成缩略图并替换。
 * 同时将原始路径保存到 filePath（若 filePath 为空）。
 * 幂等。返回是否有任何修改。
 */
export async function processGraphThumbnails(graph: {
  nodes?: Array<{ data?: Record<string, unknown> }>;
}): Promise<boolean> {
  let changed = false;
  if (!graph?.nodes) return changed;

  for (const node of graph.nodes) {
    const data = node.data;
    if (!data) continue;
    const thumb = data.thumbnailUrl as string | undefined;
    if (!thumb || !needsThumbnailing(thumb)) continue;

    const result = await ensureThumbnail(thumb);
    if (result.skipped) continue; // 源文件缺失或非媒体，跳过

    if (result.thumbnailUrl !== thumb) {
      // 保留原图路径到 filePath（若为空）
      if (!data.filePath) {
        data.filePath = thumb;
      }
      data.thumbnailUrl = result.thumbnailUrl;
      changed = true;
    }
  }
  return changed;
}
