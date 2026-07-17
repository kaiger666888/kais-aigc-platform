/**
 * 批量缩略图生成脚本 — 为已有 OSS 媒体资产预生成压缩缩略图。
 *
 * 用法：node --experimental-strip-types scripts/gen-thumbnails.ts
 *   或（编译后）：node dist/scripts/gen-thumbnails.js
 *
 * 扫描目标：
 *   - data/oss/scifi-epic/assets/scene_refs/*.png  (场景参考图，3-6MB)
 *   - data/oss/scifi-epic/assets/videos_trimmed/*.mp4  (视频)
 *   - data/oss/scifi-epic/assets/storyboards/*.png 等（可选）
 *
 * 为每个生成 data/oss/_thumbs/... 下的 WebP 缩略图（max 400px, q80）。
 * 幂等：已生成且较新的跳过。
 */

import path from "path";
import { ensureThumbnail } from "../src/lib/thumbnail";

const OSS_BASE = "/oss";

function toOssUrl(fsPath: string): string {
  return fsPath.replace(/^.*\/data\/oss\//, "/oss/");
}

const TARGET_GLOBS: Array<{ dir: string; exts: string[]; label: string }> = [
  { dir: "scifi-epic/assets/scene_refs", exts: [".png", ".jpg", ".jpeg", ".webp"], label: "场景参考图" },
  { dir: "scifi-epic/assets/videos_trimmed", exts: [".mp4", ".webm", ".mov"], label: "视频" },
  { dir: "scifi-epic/assets/storyboards", exts: [".png", ".jpg", ".jpeg", ".webp"], label: "分镜图" },
  { dir: "scifi-epic/assets/characters", exts: [".png", ".jpg", ".jpeg", ".webp"], label: "角色图" },
  { dir: "scifi-epic/assets", exts: [".png", ".jpg", ".jpeg", ".webp"], label: "其他资产" },
];

async function scanDir(
  relDir: string,
  exts: string[],
): Promise<string[]> {
  const fs = await import("fs/promises");
  const ossDir = (await import("@/utils").then((m) => m.default.getPath("oss"))) as string;
  const dir = path.join(ossDir, relDir);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!exts.includes(path.extname(e.name).toLowerCase())) continue;
      files.push(toOssUrl(path.join(dir, e.name)));
    }
    return files;
  } catch {
    return []; // 目录不存在
  }
}

async function main(): Promise<void> {
  const allUrls: string[] = [];
  for (const g of TARGET_GLOBS) {
    const urls = await scanDir(g.dir, g.exts);
    console.log(`[${g.label}] ${g.dir}: ${urls.length} 个文件`);
    allUrls.push(...urls);
  }

  if (allUrls.length === 0) {
    console.log("没有找到任何媒体文件，退出。");
    return;
  }

  console.log(`\n共 ${allUrls.length} 个文件待处理（已生成的会跳过）...\n`);

  let generated = 0;
  let cached = 0;
  let skipped = 0;
  const t0 = Date.now();

  for (let i = 0; i < allUrls.length; i++) {
    const url = allUrls[i];
    try {
      const res = await ensureThumbnail(url);
      if (res.generated) generated++;
      else if (res.skipped) skipped++;
      else cached++;
      if ((i + 1) % 25 === 0 || i === allUrls.length - 1) {
        console.log(
          `  进度 ${i + 1}/${allUrls.length} (新=${generated} 缓存=${cached} 跳过=${skipped})`,
        );
      }
    } catch (err) {
      console.error(`  失败 ${url}:`, err);
      skipped++;
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\n✅ 完成 — 新生成 ${generated}，缓存 ${cached}，跳过 ${skipped}，耗时 ${dt}s`,
  );
}

main().catch((err) => {
  console.error("批量缩略图生成失败:", err);
  process.exit(1);
});
