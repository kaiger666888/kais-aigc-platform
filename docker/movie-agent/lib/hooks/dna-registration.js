/**
 * DNA 卡注册 hooks — 4D-Anchor 参考图锚定模式
 *
 * 即梦不暴露 seed，角色/场景一致性通过以下机制实现：
 * - 角色锚定：4D锚点图（Front/3Q/Side）+ 参考图库，所有镜头 @引用
 * - 场景锚定：每个场景生成一张锚定帧，后续镜头复用
 * - 视频接力：Seedance 延长功能，上段成品作为下段参考
 * - 负面特征排除：negative_traits 防止角色漂移
 * - 分层控制：face/outfit/accessories 独立锁定
 *
 * DNA 卡结构（character-dna.json）：
 * {
 *   "角色名": {
 *     refImages: ["正面照URL", "3Q照URL"],
 *     description: "角色外观描述",
 *     negative_traits: ["blonde hair", "beard"],
 *     seedance_profile: { consistency_mode: "strict", default_strength: 0.45 },
 *     video_samples: [],
 *     lastFrameUrl: null,
 *     verified: true
 *   }
 * }
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 注册角色 DNA — 从 CharacterBible 2.0 提取锚点信息
 * @param {object} pipeline - Pipeline 实例（含 workdir, jimengClient, characterDNA）
 * @param {Array} characters - 角色数组，每个含 CharacterBible 2.0 字段
 */
export async function registerCharacterDNA(pipeline, characters) {
  const { workdir, jimengClient, characterDNA } = pipeline;
  if (!jimengClient) { console.warn('[pipeline] jimengClient 未初始化，跳过角色DNA'); return []; }

  for (const char of characters) {
    // 收集参考图：优先 anchors，其次 reference_images
    const refImages = [];
    if (char.anchors) {
      // 4D 锚点优先（按优先级：3Q > Front > Side）
      const priority = ['three_quarter', 'front', 'side'];
      for (const key of priority) {
        if (char.anchors[key] && !refImages.includes(char.anchors[key])) {
          refImages.push(char.anchors[key]);
        }
      }
    }
    // 补充 reference_images 中的 URL（排除已包含的本地路径）
    if (char.reference_images?.length) {
      for (const img of char.reference_images) {
        if (typeof img === 'string' && img.startsWith('http') && !refImages.includes(img)) {
          refImages.push(img);
        }
      }
    }
    // 补充参考图库中的 URL
    if (char.reference_library) {
      for (const [key, ref] of Object.entries(char.reference_library)) {
        if (ref?.url && !refImages.includes(ref.url)) {
          refImages.push(ref.url);
        }
      }
    }

    // 构建 DNA 卡
    const dnaCard = {
      refImages,
      description: char.appearance || char.description || '',
      negative_traits: char.negative_traits || [],
      seedance_profile: char.seedance_profile || {
        consistency_mode: 'strict',
        default_strength: 0.45,
        character_ref_priority: ['three_quarter', 'front'],
      },
      video_samples: char.video_samples || [],
      lastFrameUrl: null,
      verified: false,
    };

    characterDNA.set(char.name, dnaCard);

    if (!refImages.length) {
      console.warn(`[pipeline] ⚠️ 角色 ${char.name} 无参考图URL，DNA卡仅保存描述`);
      continue;
    }

    // 可选：生成验证视频
    if (pipeline.config?.verifyCharacterDNA !== false) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const verification = await jimengClient.generateIdentityVerification(refImages.slice(0, 2), char.name);
          if (verification.taskId) {
            const videoUrl = await jimengClient.pollTask(verification.taskId, { timeoutMs: 300_000 });
            if (videoUrl) {
              const verPath = join(workdir, `character-${char.name}-verification.mp4`);
              await jimengClient.download(videoUrl, verPath);
              console.log(`[pipeline] ✅ 角色 ${char.name} DNA卡已注册 + 验证视频已保存`);
            }
            dnaCard.verified = true;
          }
          break;
        } catch (e) {
          console.warn(`[pipeline] 角色 ${char.name} DNA验证第${attempt}次失败: ${e.message}`);
          if (attempt === 3) {
            console.warn(`[pipeline] 角色 ${char.name} 验证跳过，DNA卡（参考图模式）仍可用`);
          }
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    } else {
      console.log(`[pipeline] ✅ 角色 ${char.name} DNA卡已注册（${refImages.length}张参考图，跳过验证）`);
    }
  }

  // 持久化
  const dnaPath = join(workdir, 'character-dna.json');
  await writeFile(dnaPath, JSON.stringify(Object.fromEntries(characterDNA), null, 2));
  console.log(`[pipeline] ✅ ${characterDNA.size} 个角色DNA卡已保存`);
}

/**
 * 注册场景 DNA — 为每个场景生成锚点帧 + 场景一致性控制
 *
 * 场景一致性策略：
 * - 每个场景生成1张主锚点帧（构图/光影/色调基准）
 * - 可选：生成2张补充角度锚点（远景/近景）
 * - 记录场景 STYLE_VARIANCE（该场景特有的光影/氛围）
 * - 跨镜头共享同一锚点帧
 *
 * DNA 卡结构（scene-dna.json）：
 * {
 *   "场景名": {
 *     refImages: ["锚点帧URL"],
 *     description: "场景描述",
 *     style_variance: "warm indoor lighting, sunset through window",
 *     negative_traits: ["modern furniture", "cars"],
 *     lastFrameUrl: null,
 *     verified: true
 *   }
 * }
 */
export async function registerSceneDNA(pipeline, scenes) {
  const { workdir, jimengClient, sceneDNA } = pipeline;
  if (!jimengClient) { console.warn('[pipeline] jimengClient 未初始化，跳过场景DNA'); return; }
  if (!scenes?.length) return;

  let generateSceneAnchor;
  try {
    ({ generateSceneAnchor } = await import('../../skills/kais-scene-designer/lib/designer.js'));
  } catch { console.warn('[pipeline] kais-scene-designer 不可用，跳过场景DNA'); return; }

  for (const scene of scenes) {
    // 收集场景属性
    const sceneDesc = scene.prompt || scene.description || '';
    const styleVariance = scene.style_variance || scene.mood || '';
    const negativeTraits = scene.negative_traits || [];

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const anchor = await generateSceneAnchor(scene, jimengClient);
        if (!anchor.imageUrl) throw new Error('锚点帧返回空URL');
        sceneDNA.set(scene.name || scene.id, {
          refImages: [anchor.imageUrl],
          description: sceneDesc,
          style_variance: styleVariance,
          negative_traits: negativeTraits,
          lastFrameUrl: null,
          verified: true,
        });
        await jimengClient.download(anchor.imageUrl, join(workdir, `scene-${scene.name || scene.id}-anchor.png`));
        console.log(`[pipeline] ✅ 场景 ${scene.name || scene.id} 锚点帧已生成${negativeTraits.length ? ` (${negativeTraits.length}个排除特征)` : ''}`);
        break;
      } catch (e) {
        if (attempt === 3) throw new Error(`场景 ${scene.name || scene.id} DNA卡生成失败: ${e.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  const path = join(workdir, 'scene-dna.json');
  await writeFile(path, JSON.stringify(Object.fromEntries(sceneDNA), null, 2));
  console.log(`[pipeline] ✅ ${sceneDNA.size} 个场景DNA卡已保存`);
}
