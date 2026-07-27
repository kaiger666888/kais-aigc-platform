/**
 * scripts/canvas/backfill-storyboard-media.ts — 为缺画面的 storyboard 节点回填媒体路径。
 *
 * 症状：画布上分镜(storyboard)节点显示空白占位卡，而 video/asset 都有缩略图。
 *
 * 根因：canvas_sync 的 _normalize_media_fields alias map 漏了 scene_ref 与嵌套的
 *   character_refs[].turnaround_path —— storyboard 的场景参考图路径原样穿透进 data，
 *   从未回填到画布渲染唯一认的 filePath/thumbnailUrl（migrate.ts: data.filePath →
 *   media.original）。文件本身真实存在，只是没被「翻译」成可访问 URL。
 *
 * 修法（本脚本，一次性）：DB 驱动 —— 遍历 type='storyboard' 节点，把 scene_ref（相对
 *   episode 根）解析成绝对路径，复刻 canvas_sync._fs_to_oss_url 的 md5-hash + symlink
 *   规则转成 /oss/pipeline/<hash>/<basename>，再用 sharp/ffmpeg 生成 _thumbs webp，
 *   回填 data.filePath + data.thumbnailUrl。与 video 节点路径形态完全一致，前端现有
 *   渲染逻辑直接生效。幂等：已有有效 /oss/ thumbnailUrl 的节点跳过。
 *
 * 自包含：不 import @/utils 或 @/lib/thumbnail（两者经 src/utils.ts 聚合 db/oss/ai
 *   等重模块，tsx 下 import 会卡死）。缩略图逻辑内联自 src/lib/thumbnail.ts。
 *
 * 用法（仓库根目录执行）：
 *   npx tsx scripts/canvas/backfill-storyboard-media.ts                          # 全部项目
 *   npx tsx scripts/canvas/backfill-storyboard-media.ts --project 1785042303476  # 仅指定项目
 *   npx tsx scripts/canvas/backfill-storyboard-media.ts --episode-root /path/to/ep
 *   npx tsx scripts/canvas/backfill-storyboard-media.ts --dry-run                # 只统计不写库
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
// @ts-expect-error — better-sqlite3 无独立类型声明；后端经 knex 用它，运行时正常
import Database from "better-sqlite3";

const execFileAsync = promisify(execFile);

const DATA_DIR = path.join(process.cwd(), "data");
const OSS_DIR = path.join(DATA_DIR, "oss");
const DB_PATH = path.join(DATA_DIR, "db2.sqlite");
const THUMB_MAX_WIDTH = 400;
const THUMB_QUALITY = 80;

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv"]);

/** 候选 episode 根目录（kais-movie-pipeline episodes/）。 */
const EPISODE_ROOTS = [
  "/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/episodes",
  "/home/kai/workspace/kais-hermes-skills/skills/kais-movie-pipeline/episodes",
];

interface Opts {
  project?: number;
  episodeRoot?: string;
  dryRun?: boolean;
}

function parseArgs(argv: string[]): Opts {
  const opts: Opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--project" && argv[i + 1]) opts.project = Number(argv[++i]);
    else if (a === "--episode-root" && argv[i + 1]) opts.episodeRoot = argv[++i];
    else if (a === "--dry-run") opts.dryRun = true;
  }
  return opts;
}

// ─── 内联缩略图逻辑（自 src/lib/thumbnail.ts，去掉 @/utils 依赖） ───

function toThumbnailUrl(ossUrl: string): string | null {
  if (!ossUrl || !ossUrl.startsWith("/oss/")) return null;
  const rel = ossUrl.slice("/oss/".length);
  if (rel.startsWith("_thumbs/")) return ossUrl;
  const ext = path.extname(rel);
  const base = rel.slice(0, -ext.length || undefined);
  return `/oss/_thumbs/${base}.webp`;
}

function ossUrlToFs(ossUrl: string): string {
  if (!ossUrl.startsWith("/oss/")) return ossUrl;
  return path.join(OSS_DIR, ossUrl.slice("/oss/".length));
}

async function isNewer(thumbFs: string, srcFs: string): Promise<boolean> {
  try {
    const [t, s] = await Promise.all([fsp.stat(thumbFs), fsp.stat(srcFs)]);
    return t.mtimeMs >= s.mtimeMs && t.size > 0;
  } catch {
    return false;
  }
}

async function generateImageThumbnail(srcFs: string, thumbFs: string): Promise<void> {
  await fsp.mkdir(path.dirname(thumbFs), { recursive: true });
  await sharp(srcFs).rotate().resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY }).toFile(thumbFs);
}

async function generateVideoThumbnail(srcFs: string, thumbFs: string): Promise<void> {
  await fsp.mkdir(path.dirname(thumbFs), { recursive: true });
  const args = (seek: string) => ["-y", "-ss", seek, "-i", srcFs, "-frames:v", "1",
    "-vf", "scale=400:-1", "-f", "webp", thumbFs];
  try {
    await execFileAsync("ffmpeg", args("1"), { timeout: 30_000 });
  } catch {
    await execFileAsync("ffmpeg", args("0"), { timeout: 30_000 });
  }
}

interface ThumbResult { thumbnailUrl: string; generated: boolean; skipped?: boolean }

async function ensureThumbnail(ossUrl: string): Promise<ThumbResult> {
  const thumbUrl = toThumbnailUrl(ossUrl);
  if (!thumbUrl) return { thumbnailUrl: ossUrl, generated: false, skipped: true };
  const srcFs = ossUrlToFs(ossUrl);
  const thumbFs = ossUrlToFs(thumbUrl);
  if (!fs.existsSync(srcFs)) return { thumbnailUrl: ossUrl, generated: false, skipped: true };
  if (await isNewer(thumbFs, srcFs)) return { thumbnailUrl: thumbUrl, generated: false };
  try {
    if (IMAGE_EXTS.has(path.extname(ossUrl).toLowerCase())) {
      await generateImageThumbnail(srcFs, thumbFs);
    } else if (VIDEO_EXTS.has(path.extname(ossUrl).toLowerCase())) {
      await generateVideoThumbnail(srcFs, thumbFs);
    } else {
      return { thumbnailUrl: ossUrl, generated: false, skipped: true };
    }
    return { thumbnailUrl: thumbUrl, generated: true };
  } catch (err) {
    console.error(`  [thumb] 生成失败 ${ossUrl}:`, (err as Error).message);
    return { thumbnailUrl: ossUrl, generated: false, skipped: true };
  }
}

// ─── 路径解析（复刻 canvas_sync._fs_to_oss_url） ───

/**
 * 绝对路径 → /oss/pipeline/<md5(dirname)[:8]>/<basename>，并在 ossDir/pipeline/<hash>/
 * 下建 symlink 指向真实文件。须与 canvas_sync._fs_to_oss_url hash 规则完全一致。
 */
function fsToOssUrl(fsPath: string): string | null {
  const ext = path.extname(fsPath).toLowerCase();
  if (!IMAGE_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) return null;
  const rel = path.relative(OSS_DIR, fsPath);
  if (rel && !rel.startsWith("..")) return `/oss/${rel.split(path.sep).join("/")}`;
  const dir = path.dirname(fsPath);
  const digest = crypto.createHash("md5").update(dir).digest("hex").slice(0, 8);
  const filename = path.basename(fsPath);
  if (!fs.existsSync(fsPath)) return `/oss/pipeline/${digest}/${filename}`; // 占位，不建 symlink
  const ossSubdir = path.join(OSS_DIR, "pipeline", digest);
  fs.mkdirSync(ossSubdir, { recursive: true });
  const linkPath = path.join(ossSubdir, filename);
  if (!fs.existsSync(linkPath)) {
    try {
      fs.symlinkSync(fsPath, linkPath);
    } catch {
      /* 忽略：仍返回路径，前端可走 /local-file 兜底 */
    }
  }
  return `/oss/pipeline/${digest}/${filename}`;
}

function episodeIdFromName(name: string): string | null {
  const m = name.match(/\(([^)]+)\)/);
  return m ? m[1]! : null;
}

function resolveEpisodeRoot(projectName: string, opts: Opts): string | null {
  if (opts.episodeRoot) return opts.episodeRoot;
  const eid = episodeIdFromName(projectName);
  if (!eid) return null;
  for (const root of EPISODE_ROOTS) {
    const cand = path.join(root, eid);
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function pickMediaSource(data: Record<string, unknown>): string | null {
  const sr = data.scene_ref;
  if (typeof sr === "string" && sr) return sr;
  const cr = data.character_refs;
  if (Array.isArray(cr)) {
    for (const r of cr) {
      if (r && typeof r === "object") {
        const tp = (r as Record<string, unknown>).turnaround_path;
        if (typeof tp === "string" && tp) return tp;
      }
    }
  }
  return null;
}

interface Buckets {
  total: string[]; skipped: string[]; healed: string[];
  missingFile: string[]; noSource: string[]; noWorkdir: string[]; failed: string[];
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[backfill-storyboard-media] DB 不存在: ${DB_PATH}（须在仓库根目录执行）`);
    process.exit(1);
  }
  const db = new Database(DB_PATH, opts.dryRun ? { readonly: true } : {});
  const B: Buckets = { total: [], skipped: [], healed: [], missingFile: [], noSource: [], noWorkdir: [], failed: [] };

  try {
    const projWhere = opts.project ? "WHERE id = ?" : "";
    const projParams: unknown[] = opts.project ? [opts.project] : [];
    const projects = db
      .prepare(`SELECT id, name FROM o_project ${projWhere} ORDER BY id DESC`)
      .all(...projParams) as Array<{ id: number; name: string }>;

    console.log(`[backfill-storyboard-media] DB: ${DB_PATH}  ossDir: ${OSS_DIR}`);
    console.log(`[backfill-storyboard-media] 项目数: ${projects.length}${opts.dryRun ? "  (DRY RUN)" : ""}\n`);

    const updateStmt = db.prepare(
      `UPDATE canvas_nodes SET data = ?, updated_at = ? WHERE id = ? AND project_id = ? AND episodes_id = ?`,
    );

    for (const proj of projects) {
      const workdir = resolveEpisodeRoot(proj.name, opts);
      const nodes = db
        .prepare(`SELECT id, episodes_id, data FROM canvas_nodes WHERE project_id = ? AND type = 'storyboard'`)
        .all(proj.id) as Array<{ id: string; episodes_id: number; data: string }>;

      if (nodes.length === 0) continue;
      console.log(`▶ 项目 ${proj.id} 「${proj.name}」  storyboard ${nodes.length} 个  workdir=${workdir ?? "(未解析)"}`);

      for (const n of nodes) {
        B.total.push(n.id);
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(n.data);
        } catch {
          B.failed.push(`${proj.id}/${n.id} (坏 JSON)`);
          continue;
        }

        const tu = data.thumbnailUrl;
        if (typeof tu === "string" && tu.startsWith("/oss/")) {
          B.skipped.push(n.id);
          continue;
        }
        if (!workdir) {
          B.noWorkdir.push(`${proj.id}/${n.id}`);
          continue;
        }
        const src = pickMediaSource(data);
        if (!src) {
          B.noSource.push(`${proj.id}/${n.id}`);
          continue;
        }
        const absPath = path.isAbsolute(src) ? src : path.join(workdir, src);
        if (!fs.existsSync(absPath)) {
          B.missingFile.push(`${proj.id}/${n.id} → ${absPath}`);
          continue;
        }
        // dry-run：验证到此为止（不建 symlink、不生成缩略图、不写库）。
        if (opts.dryRun) {
          B.healed.push(`${proj.id}/${n.id} → ${absPath}`);
          continue;
        }
        const ossUrl = fsToOssUrl(absPath);
        if (!ossUrl) {
          B.failed.push(`${proj.id}/${n.id} (非媒体: ${src})`);
          continue;
        }
        try {
          const res = await ensureThumbnail(ossUrl);
          if (res.skipped) {
            B.failed.push(`${proj.id}/${n.id} (缩略图生成跳过: ${ossUrl})`);
            continue;
          }
          data.filePath = ossUrl;
          data.thumbnailUrl = res.thumbnailUrl;
          if (!opts.dryRun) {
            updateStmt.run(JSON.stringify(data), Date.now(), n.id, proj.id, n.episodes_id);
          }
          B.healed.push(n.id);
        } catch (err) {
          B.failed.push(`${proj.id}/${n.id} (${(err as Error).message})`);
        }
      }
      console.log("");
    }
  } finally {
    db.close();
  }

  const sum = (k: keyof Buckets) => B[k].length;
  console.log("[backfill-storyboard-media] 完成:");
  console.log(`  扫描 ${sum("total")} / 已有跳过 ${sum("skipped")} / 补成功 ${sum("healed")}`);
  console.log(`  缺源(scene_ref/turnaround) ${sum("noSource")} / 文件缺失 ${sum("missingFile")} / workdir未解析 ${sum("noWorkdir")} / 失败 ${sum("failed")}`);
  const show = (title: string, arr: string[]) => {
    if (arr.length === 0) return;
    console.log(`\n${title} (${arr.length}, 前 20):`);
    arr.slice(0, 20).forEach((x) => console.log(`  • ${x}`));
  };
  show("文件缺失（磁盘上找不到）", B.missingFile);
  show("workdir 未解析（用 --episode-root <path> 显式指定）", B.noWorkdir);
  show("无 scene_ref/turnaround_path", B.noSource);
  show("失败", B.failed);
}

void main().catch((err) => {
  console.error("[backfill-storyboard-media] 致命错误:", err);
  process.exit(1);
});
