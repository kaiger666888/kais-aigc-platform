/**
 * scripts/canvas/backfill-thumbnails.ts — 补生成画布资产缺失的 _thumbs/*.webp 缩略图。
 *
 * 症状：画布满屏
 *   GET /oss/_thumbs/pipeline/<run>/<name>.webp 404 (Not Found)
 *
 * 根因：canvas 同步管线把节点 data.thumbnailUrl 写成 /oss/_thumbs/...webp 形态，
 * 但部分 run（如 bc4b70df 视频、f088288a 图片）的 webp 文件从未真正生成。更棘手的是
 * src/lib/thumbnail.ts 的 needsThumbnailing() 见 URL 含 "/_thumbs/" 即判"已是缩略图"→ 不
 * 重生成 → save-hook 救不回 → 永久死锁 404。
 *
 * 修法（本脚本）：DB 驱动 —— 遍历 canvas_nodes 节点的 data.filePath（= 原图/视频 OSS
 * 路径），对每一个调 ensureThumbnail 重生成其 _thumbs webp。复用 src/lib/thumbnail.ts
 * （sharp max 400px / ffmpeg 首帧，webp q80），路径映射与线上一致，幂等。
 *
 * 为什么 DB 驱动而非全盘扫 /oss：/oss/pipeline 下有 287 个缺失视频缩略图，但绝大多数 run
 * 根本没被任何画布节点引用（属于废弃/测试项目）。DB 驱动只补「画布实际要显示的」，且直接
 * 取 OSS URL 喂给 ensureThumbnail —— 天然绕开符号链接（pipeline 下文件是指向 hermes 输出
 * 的软链）的收集问题，lib 内部 fs.existsSync/sharp/ffmpeg 会自行跟随软链。
 *
 * 用法（仓库根目录执行）：
 *   npx tsx scripts/canvas/backfill-thumbnails.ts                  # 全部项目
 *   npx tsx scripts/canvas/backfill-thumbnails.ts --project 1785042303476   # 仅指定项目
 */
import fsp from "fs/promises";
import path from "path";
// @ts-expect-error — better-sqlite3 无独立类型声明；后端经 knex 用它，运行时正常
import Database from "better-sqlite3";
import u from "@/utils";
import { ensureThumbnail, isMediaPath } from "@/lib/thumbnail";

interface Opts {
  project?: number;
}

function parseArgs(argv: string[]): Opts {
  const opts: Opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project" && argv[i + 1]) {
      opts.project = Number(argv[++i]);
    }
  }
  return opts;
}

/** 从 DB 收集画布节点引用的所有媒体 filePath（去重，OSS 路径）。 */
function collectReferencedMedia(opts: Opts): string[] {
  const dbPath = u.getPath("db2.sqlite");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const where = opts.project ? "WHERE project_id = ?" : "";
    const params: unknown[] = opts.project ? [opts.project] : [];
    const rows = db
      .prepare(
        `SELECT data FROM canvas_nodes ${where}`,
      )
      .all(...params) as Array<{ data: string }>;
    const set = new Set<string>();
    for (const r of rows) {
      if (!r.data) continue;
      try {
        const d = JSON.parse(r.data) as Record<string, unknown>;
        const fp = d.filePath;
        if (typeof fp === "string" && fp.startsWith("/oss/") && isMediaPath(fp)) {
          set.add(fp);
        }
      } catch {
        /* 坏 JSON 跳过 */
      }
    }
    return [...set];
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const scope = opts.project ? `项目 ${opts.project}` : "全部项目";

  const media = collectReferencedMedia(opts);
  console.log(`[backfill-thumbnails] DB: ${u.getPath("db2.sqlite")}`);
  console.log(`[backfill-thumbnails] 范围: ${scope}`);
  console.log(`[backfill-thumbnails] 画布引用的媒体 filePath: ${media.length} 个（去重）`);

  // 先快速统计缺失数（不生成），给用户预期
  let missing = 0;
  for (const m of media) {
    const thumbFs = path.join(
      u.getPath("oss"),
      "_thumbs",
      m.slice("/oss/".length).replace(/\.[^.]+$/, ".webp"),
    );
    try {
      await fsp.access(thumbFs);
    } catch {
      missing++;
    }
  }
  console.log(`[backfill-thumbnails] 其中缺失缩略图: ${missing} 个，开始补生成…`);

  let generated = 0;
  let cached = 0;
  let failed = 0;
  const failures: string[] = [];

  for (let i = 0; i < media.length; i++) {
    const ossUrl = media[i]!;
    try {
      const res = await ensureThumbnail(ossUrl);
      if (res.generated) generated++;
      else if (res.skipped) {
        failed++;
        failures.push(ossUrl);
      } else cached++;
    } catch (err) {
      failed++;
      failures.push(`${ossUrl}  (${(err as Error).message})`);
    }
    if ((i + 1) % 15 === 0) {
      console.log(
        `  进度 ${i + 1}/${media.length}  (新生成 ${generated} / 缓存 ${cached} / 失败 ${failed})`,
      );
    }
  }

  console.log(
    `\n[backfill-thumbnails] 完成: 新生成 ${generated} / 已存在 ${cached} / 失败 ${failed}  (共 ${media.length})`,
  );
  if (failures.length) {
    console.log("失败/跳过（前 20）:");
    failures.slice(0, 20).forEach((f) => console.log("  ✗ " + f));
  }
}

void main().catch((err) => {
  console.error("[backfill-thumbnails] 致命错误:", err);
  process.exit(1);
});
