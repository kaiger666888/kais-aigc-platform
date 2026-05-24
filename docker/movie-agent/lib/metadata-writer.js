/**
 * metadata-writer.js — 资产元数据写入工具
 *
 * 为管线产出的图片/视频写入 XMP 元数据，包含：
 * - character_id / scene_id
 * - phase（哪个阶段产出）
 * - timestamp
 * - style_prefix_hash（用于一致性追踪）
 * - anchor_type（front/three_quarter/side/back/scene/stress_test）
 * - generation_params（model, ratio, strength 等）
 */

import { writeFile, appendFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

/**
 * 写入 JSON sidecar 元数据文件（.meta.json）
 * 放在资产同目录下，与资产文件同名但加 .meta.json 后缀
 */
export async function writeAssetMetadata(filePath, metadata) {
  // metadata: { character_id, scene_id, phase, anchor_type, generation_params, style_prefix, ... }
  const metaPath = filePath + '.meta.json';
  const entry = {
    ...metadata,
    file: basename(filePath),
    created_at: new Date().toISOString(),
    version: '1.0',
  };
  await writeFile(metaPath, JSON.stringify(entry, null, 2));
  return metaPath;
}

/**
 * 为一批资产批量写入元数据
 */
export async function writeBatchMetadata(assets) {
  // assets: [{ path, character_id, scene_id, phase, anchor_type, ... }]
  const results = [];
  for (const asset of assets) {
    const { path, ...metadata } = asset;
    try {
      const metaPath = await writeAssetMetadata(path, metadata);
      results.push({ path, metaPath, success: true });
    } catch (e) {
      results.push({ path, success: false, error: e.message });
    }
  }
  return results;
}

/**
 * 生成资产索引文件（assets-manifest.json）
 * 在每个 phase checkpoint 时调用，汇总本阶段所有产出资产
 */
export async function writePhaseManifest(workdir, phase, assets) {
  const manifestPath = join(workdir, `manifest-${phase}.json`);
  const manifest = {
    phase,
    created_at: new Date().toISOString(),
    assets: assets.map(a => ({
      file: a.path || a.localPath || a.url,
      character_id: a.character_id,
      scene_id: a.scene_id,
      anchor_type: a.anchor_type,
    })),
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

/**
 * 简单的 style_prefix hash（用于一致性追踪）
 */
export function hashStylePrefix(stylePrefix) {
  let hash = 0;
  for (let i = 0; i < stylePrefix.length; i++) {
    const char = stylePrefix.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'sp_' + Math.abs(hash).toString(36);
}
