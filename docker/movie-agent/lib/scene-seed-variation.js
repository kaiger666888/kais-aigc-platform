/**
 * scene-seed-variation.js — 场景种子图锁定→变异流程
 *
 * 解决的问题：
 * - 传统方式：每个镜头独立文生图，场景风格不一致
 * - 种子变异方式：先选一张种子图，后续所有该场景的变体基于种子图生（图生图）
 *
 * 流程：
 * Step A: 种子候选生成（文生图，生成 N 张候选场景图）
 * Step B: 导演选种子（REVIEW GATE）
 * Step C: 基于种子批量变异（图生图，保持场景一致性）
 *
 * 生成策略：
 * - 全景/远景 → strength 0.25（给构图自由度）
 * - 中景 → strength 0.35（平衡）
 * - 特写/近景 → strength 0.50（锁定细节）
 * - 不同时间/天气 → 通过 STYLE_VARIANCE 控制，不改种子
 */

// ── 依赖注入 ──

let _jimengClient = null;

export function injectDeps({ jimengClient }) {
  _jimengClient = jimengClient;
}

// ── 动态 Strength（场景版）──

function getSceneStrength(shotType) {
  const MAP = {
    wide: 0.25,       // 远景：低锁定，构图自由
    long: 0.25,       // 全景
    medium_wide: 0.30, // 中远景
    medium: 0.35,      // 中景：平衡
    medium_close: 0.40, // 中近景
    close_up: 0.50,     // 特写：高锁定，细节重要
    extreme_close: 0.55,// 大特写
    detail: 0.55,       // 细节
    establishing: 0.20,  // 建立镜头：最低锁定
    arial: 0.20,        // 航拍
    default: 0.35,
  };
  return MAP[shotType] || MAP.default;
}

// ── Step A: 种子候选生成 ──

/**
 * 生成 N 张场景候选种子图（文生图）
 * @param {object} scene - { name, prompt, style_variance, negative_traits }
 * @param {object} stylePrefix - { core, identity, variance }
 * @param {object} [options]
 * @param {number} options.count - 候选数量（默认 3）
 * @param {string} options.ratio - 比例（默认 16:9）
 * @returns {Promise<Array<{variant: string, imageUrl: string, prompt: string}>>}
 */
export async function generateSeedCandidates(scene, stylePrefix, options = {}) {
  if (!_jimengClient) throw new Error('jimengClient 未注入');

  const { count = 3, ratio = '16:9', resolution = '2k' } = options;
  const fullPrompt = [stylePrefix.core, stylePrefix.variance, scene.prompt, scene.style_variance]
    .filter(Boolean)
    .join(', ');

  const candidates = [];
  for (let i = 0; i < count; i++) {
    const result = await _jimengClient.generateImage(fullPrompt, { ratio, resolution });
    if (result?.length) {
      candidates.push({
        variant: String.fromCharCode(65 + i),
        imageUrl: result[0].url,
        prompt: fullPrompt,
      });
    }
  }

  return candidates;
}

// ── Step C: 基于种子批量变异 ──

/**
 * 基于种子图生成场景变体（图生图）
 * @param {string} seedImageUrl - 选定的种子图 URL
 * @param {object} scene - 场景信息
 * @param {Array} shots - 镜头列表 [{ shot_id, prompt, shot_type, style_variance? }]
 * @param {object} stylePrefix - { core, identity, variance }
 * @param {object} [options]
 * @param {number} options.baseStrength - 基础 strength（默认从 shot_type 动态获取）
 * @returns {Promise<Array<{shot_id: string, imageUrl: string, strength: number, prompt: string}>>}
 */
export async function generateSeedVariations(seedImageUrl, scene, shots, stylePrefix, options = {}) {
  if (!_jimengClient) throw new Error('jimengClient 未注入');

  const { baseStrength } = options;
  const results = [];

  for (const shot of shots) {
    // 每个镜头的 style_variance 覆盖场景级 variance
    const shotVariance = shot.style_variance || scene.style_variance || '';
    const fullPrompt = [stylePrefix.core, stylePrefix.variance, shot.prompt, shotVariance]
      .filter(Boolean)
      .join(', ');

    // 动态 strength：基础值 + shot_type 修正
    const dynamicStrength = baseStrength ?? getSceneStrength(shot.shot_type);

    const result = await _jimengClient.generateImage(fullPrompt, {
      images: [seedImageUrl],
      reference_weight: dynamicStrength,
      ratio: shot.ratio || '16:9',
      resolution: '2k',
    });

    if (result?.length) {
      results.push({
        shot_id: shot.shot_id,
        imageUrl: result[0].url,
        strength: dynamicStrength,
        prompt: fullPrompt,
      });
    } else {
      results.push({
        shot_id: shot.shot_id,
        imageUrl: null,
        strength: dynamicStrength,
        prompt: fullPrompt,
        error: '生成失败',
      });
    }
  }

  return results;
}

// ── 完整流程编排 ──

/**
 * 完整的种子图锁定→变异流程
 * @param {object} scene - 场景信息
 * @param {object} stylePrefix - 分层风格前缀
 * @param {Array} shots - 镜头列表
 * @param {Function} onSeedSelect - 回调：(candidates) => selectedCandidate (用户选择)
 * @param {object} [options]
 * @returns {Promise<{seed: object, variations: Array}>}
 */
export async function seedVariationPipeline(scene, stylePrefix, shots, onSeedSelect, options = {}) {
  // Step A: 生成种子候选
  console.log(`[scene-seed] 🌱 场景 "${scene.name}" 生成种子候选...`);
  const candidates = await generateSeedCandidates(scene, stylePrefix, options);

  if (candidates.length === 0) {
    throw new Error(`场景 "${scene.name}" 种子候选生成失败`);
  }

  // Step B: 导演选种子
  console.log(`[scene-seed] 📋 场景 "${scene.name}" 生成 ${candidates.length} 个候选，等待选择`);
  const selected = await onSeedSelect(candidates);
  if (!selected?.imageUrl) {
    throw new Error(`场景 "${scene.name}" 未选择种子图`);
  }

  console.log(`[scene-seed] ✅ 场景 "${scene.name}" 选定种子: ${selected.variant}`);

  // Step C: 基于种子批量变异
  console.log(`[scene-seed] 🔄 场景 "${scene.name}" 基于种子生成 ${shots.length} 个变体...`);
  const variations = await generateSeedVariations(selected.imageUrl, scene, shots, stylePrefix);

  const successCount = variations.filter(v => v.imageUrl).length;
  console.log(`[scene-seed] ✅ 场景 "${scene.name}" 完成：${successCount}/${shots.length} 变体成功`);

  return {
    seed: selected,
    variations,
    seed_image_url: selected.imageUrl,
    scene_name: scene.name,
  };
}

// ── CLI ──

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'strength':
      console.log(JSON.stringify({
        wide: 0.25, medium: 0.35, close_up: 0.50,
        establishing: 0.20, default: 0.35,
      }, null, 2));
      break;
    default:
      console.error('用法: scene-seed-variation.js <strength>');
  }
}
