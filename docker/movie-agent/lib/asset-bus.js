/**
 * AssetBus — 跨 Phase 资产总线 (V2)
 *
 * 每个 Phase 审核通过后，产出结构化资产文件写入 .pipeline-assets/
 * 后续 Phase 强制读取，确保一致性。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ASSETS_DIR = '.pipeline-assets';

const ASSET_SCHEMA = {
  'art-bible': {
    file: 'art-bible.json',
    fields: ['style_anchor', 'lighting_rules', 'color_palette', 'composition_rules'],
  },
  'character-assets': {
    file: 'character-assets.json',
    fields: ['characters'],  // [{name, core_prompt, ref_images, lora_path, seed}]
  },
  'voice-timeline': {
    file: 'voice-timeline.json',
    fields: ['timeline'],  // [{start_ms, end_ms, text, character, emotion, pause_after_ms}]
  },
  'shot-list': {
    file: 'shot-list.json',
    fields: ['shots'],  // [{id, shot_size, angle, movement, lens, duration_sec, description}]
  },
  'scene-assets': {
    file: 'scene-assets.json',
    fields: ['scenes'],  // [{id, background_image, lighting, core_prompt}]
  },
};

export class AssetBus {
  constructor(workdir) {
    this._dir = join(workdir, ASSETS_DIR);
    this._cache = new Map();
  }

  async _ensureDir() {
    await mkdir(this._dir, { recursive: true });
  }

  async write(assetName, data) {
    const schema = ASSET_SCHEMA[assetName];
    if (!schema) throw new Error(`Unknown asset: ${assetName}`);
    await this._ensureDir();
    const path = join(this._dir, schema.file);
    await writeFile(path, JSON.stringify(data, null, 2));
    this._cache.set(assetName, data);
    return path;
  }

  async read(assetName) {
    if (this._cache.has(assetName)) return this._cache.get(assetName);
    const schema = ASSET_SCHEMA[assetName];
    if (!schema) throw new Error(`Unknown asset: ${assetName}`);
    try {
      const raw = await readFile(join(this._dir, schema.file), 'utf-8');
      const data = JSON.parse(raw);
      this._cache.set(assetName, data);
      return data;
    } catch {
      return null;
    }
  }

  async require(assetName) {
    const data = await this.read(assetName);
    if (!data) throw new Error(`Required asset "${assetName}" not found in ${this._dir}`);
    return data;
  }

  listAssetNames() {
    return Object.keys(ASSET_SCHEMA);
  }
}

export default AssetBus;
