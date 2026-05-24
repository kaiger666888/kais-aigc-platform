/**
 * PromptInjector — Prompt 自动注入器 (V2)
 *
 * 所有 GPU 任务的 prompt 不再由 Phase 手写，而是按固定顺序自动拼接：
 * [art-bible.style_anchor] + [art-bible.lighting_rules]
 * + [character.core_prompt] + [scene.core_prompt]
 * + [shot-list.camera指令] + [原始prompt]
 */
import { AssetBus } from './asset-bus.js';

export class PromptInjector {
  constructor(assetBus) {
    this._bus = assetBus;
  }

  async inject(rawPrompt, options = {}) {
    const parts = [];

    // Art bible anchor
    if (!options.skipArtBible) {
      const bible = await this._bus.read('art-bible');
      if (bible) {
        if (bible.style_anchor) parts.push(bible.style_anchor);
        if (bible.lighting_rules) parts.push(bible.lighting_rules);
      }
    }

    // Character core prompt
    if (options.character && !options.skipCharacter) {
      const charAssets = await this._bus.read('character-assets');
      if (charAssets?.characters) {
        const char = charAssets.characters.find(c => c.name === options.character);
        if (char?.core_prompt) parts.push(char.core_prompt);
      }
    }

    // Scene core prompt
    if (options.scene && !options.skipScene) {
      const sceneAssets = await this._bus.read('scene-assets');
      if (sceneAssets?.scenes) {
        const scene = sceneAssets.scenes.find(s => s.id === options.scene);
        if (scene?.core_prompt) parts.push(scene.core_prompt);
      }
    }

    // Shot camera directive
    if (options.shotId && !options.skipShot) {
      const shotList = await this._bus.read('shot-list');
      if (shotList?.shots) {
        const shot = shotList.shots.find(s => s.id === options.shotId);
        if (shot) {
          const camParts = [shot.shot_size, shot.angle, shot.movement, `focal ${shot.lens}`]
            .filter(Boolean);
          if (camParts.length) parts.push(camParts.join(', '));
        }
      }
    }

    // Original prompt last
    if (rawPrompt) parts.push(rawPrompt);

    return parts.join(', ');
  }

  async injectNegative() {
    return 'low quality, blurry, watermark, text, deformed, ugly, bad anatomy';
  }
}

export default PromptInjector;
