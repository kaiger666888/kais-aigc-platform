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
 * 判断 thumbnailUrl 是否"已声明为缩略图但磁盘上文件缺失"——需要自愈。
 * 背景：同步管线有时把 data.thumbnailUrl 写成 /oss/_thumbs/...webp 形态却没真正生成文件，
 * 而 needsThumbnailing() 见 URL 含 /_thumbs/ 即返回 false → 旧 save-hook 跳过 → 永久 404。
 * 本函数补上"文件到底在不在"这一层判定，供自愈路径使用。
 */
export function isThumbnailMissing(thumbnailUrl: string): boolean {
  if (
    !thumbnailUrl ||
    !thumbnailUrl.startsWith("/oss/") ||
    !thumbnailUrl.includes("/_thumbs/")
  ) {
    return false;
  }
  return !fs.existsSync(ossUrlToFs(thumbnailUrl));
}

/**
 * 单节点缩略图自愈（幂等，原地修改 data，返回是否变更）。覆盖四种情况：
 *  A) thumbnailUrl 指向原图/原视频（needsThumbnailing）→ 生成 _thumbs webp 并改写 URL
 *     （保留原图路径到 filePath）。
 *  B) thumbnailUrl 已是 _thumbs 路径但文件缺失（isThumbnailMissing）→ 从 filePath
 *     （原图/原视频）重新生成；生成的实际路径若与现 URL 不一致则对齐。
 *  C) 无 thumbnailUrl，但 filePath 是可生成的媒体原图 → 补生成并填入 thumbnailUrl。
 *  D) 无 thumbnailUrl/filePath，但 scene_ref 是可生成的 /oss 媒体（storyboard 场景
 *     参考图，canvas_sync 未回填到 filePath 时）→ 从 scene_ref 生成并补 filePath。
 * 源文件缺失/非媒体则跳过（不抛错，保持 save 容错）。
 */
async function healNodeDataThumbnail(
  data: Record<string, unknown>,
): Promise<boolean> {
  const thumb = data.thumbnailUrl as string | undefined;
  const fp = data.filePath as string | undefined;
  const isGeneratableOriginal = (p: string | undefined): p is string =>
    !!p && p.startsWith("/oss/") && !p.includes("/_thumbs/") && isMediaPath(p);

  // A) 指向原图/原视频
  if (thumb && needsThumbnailing(thumb)) {
    const result = await ensureThumbnail(thumb);
    if (!result.skipped && result.thumbnailUrl !== thumb) {
      if (!data.filePath) data.filePath = thumb;
      data.thumbnailUrl = result.thumbnailUrl;
      return true;
    }
    return false;
  }

  // B) 已是 _thumbs 路径但文件缺失 → 从 filePath 重生成
  if (thumb && isThumbnailMissing(thumb) && isGeneratableOriginal(fp)) {
    const result = await ensureThumbnail(fp);
    if (!result.skipped) {
      if (result.thumbnailUrl !== thumb) data.thumbnailUrl = result.thumbnailUrl;
      return true;
    }
  }

  // C) 无 thumbnailUrl，但有可生成的 filePath → 补填
  if (!thumb && isGeneratableOriginal(fp)) {
    const result = await ensureThumbnail(fp);
    if (!result.skipped) {
      data.thumbnailUrl = result.thumbnailUrl;
      return true;
    }
  }

  // D) 无 thumbnailUrl/filePath，但 scene_ref 是可生成的 /oss 媒体（storyboard 场景
  // 参考图，canvas_sync 未回填到 filePath 时）→ 从 scene_ref 生成并补 filePath。
  // 仅 /oss/ 形态有效：相对路径需 workdir 解析（由补数据脚本处理），绝对 fs 路径
  // ensureThumbnail 会 skipped（其 toThumbnailUrl 要求 /oss/ 前缀）。
  const sceneRef = data.scene_ref as string | undefined;
  if (!thumb && isGeneratableOriginal(sceneRef)) {
    const result = await ensureThumbnail(sceneRef);
    if (!result.skipped) {
      if (!data.filePath) data.filePath = sceneRef;
      data.thumbnailUrl = result.thumbnailUrl;
      return true;
    }
  }

  return false;
}

/**
 * 处理单个 node payload（用于 node create/update）。
 * 原地修改 payload.data，返回是否变更。覆盖原图→缩略图改写 + 缺失文件自愈 + 空值补填。
 */
export async function processNodePayloadThumbnail(
  payload: Record<string, unknown>,
): Promise<boolean> {
  const data = payload.data as Record<string, unknown> | undefined;
  if (!data) return false;
  return healNodeDataThumbnail(data);
}

/**
 * 遍历 FlowGraph 节点，为每个节点确保缩略图存在（原图改写 + 缺失自愈 + 空值补填）。
 * 幂等。返回是否有任何修改。save-v2 在落库前调用——这是所有图进 DB 的总闸。
 */
export async function processGraphThumbnails(graph: {
  nodes?: Array<{ data?: Record<string, unknown> }>;
}): Promise<boolean> {
  let changed = false;
  if (!graph?.nodes) return changed;
  for (const node of graph.nodes) {
    const data = node.data;
    if (!data) continue;
    if (await healNodeDataThumbnail(data)) changed = true;
  }
  return changed;
}
