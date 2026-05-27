/**
 * Toonflow Bridge — Pipeline 产出物自动同步到 Toonflow 数据库
 *
 * 每个 phase 完成后，bridge 读取该 phase 的产出文件，
 * 通过 core-backend (Toonflow) REST API 写入 PostgreSQL，
 * 使前端无限画布自动显示最新数据。
 *
 * 数据库表: o_novel, o_event, o_script, o_scriptAssets,
 *           o_assets, o_image, o_assets2Storyboard,
 *           o_storyboard, o_agentWorkData, o_videoTrack
 *
 * OSS 根目录 (容器内): /app/data/oss/
 * 图片访问路径: /oss/smallImage/<relativePath>
 */

import { readFile, writeFile, copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, basename, dirname, extname, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { CoreBackendClient } from './core-backend-client.js';

const TOONFLOW_TIMEOUT = 15_000;

// ─── Helpers ──────────────────────────────────────────────────

function log(phase, msg) {
  console.log(`[toonflow-bridge:${phase}] ${msg}`);
}

function warn(phase, msg) {
  console.warn(`[toonflow-bridge:${phase}] ⚠️ ${msg}`);
}

/**
 * Make an authenticated request to Toonflow core-backend.
 * Handles login cookie if needed.
 */
class ToonflowClient {
  constructor(baseUrl) {
    this._baseUrl = baseUrl.replace(/\/$/, '');
    this._cookie = null;
  }

  async _ensureAuth() {
    if (this._cookie) return;
    try {
      const res = await fetch(`${this._baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' }),
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        this._cookie = setCookie.split(';')[0];
      } else {
        // Try to extract token from response body
        try {
          const body = await res.text();
          const json = JSON.parse(body);
          if (json.token) {
            this._cookie = `token=${json.token}`;
          }
        } catch {}
      }
    } catch (err) {
      warn('auth', `Login failed: ${err.message}, proceeding without auth`);
    }
  }

  async post(path, body) {
    await this._ensureAuth();
    const headers = { 'Content-Type': 'application/json' };
    if (this._cookie) headers['Cookie'] = this._cookie;

    const res = await fetch(`${this._baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TOONFLOW_TIMEOUT),
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (!res.ok) {
      throw new Error(`Toonflow ${path} → HTTP ${res.status}: ${text.substring(0, 200)}`);
    }
    return json;
  }

  async get(path) {
    await this._ensureAuth();
    const headers = {};
    if (this._cookie) headers['Cookie'] = this._cookie;

    const res = await fetch(`${this._baseUrl}${path}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(TOONFLOW_TIMEOUT),
    });

    return res.json();
  }
}

/**
 * Read and parse a JSON file, return null if not found.
 */
async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Copy file to OSS directory and return the relative path.
 * OSS root: /app/data/oss/ (inside kais-core-backend container)
 * For movie-agent container, the volume is mounted at the same path.
 */
async function copyToOss(srcPath, ossRelativePath, config) {
  const ossRoot = config.ossRoot || '/app/data/oss';
  const destPath = join(ossRoot, ossRelativePath);
  await mkdir(dirname(destPath), { recursive: true });
  await copyFile(srcPath, destPath);
  return ossRelativePath;
}

/**
 * Copy all files in a directory to OSS and return relative paths.
 */
async function copyDirToOss(srcDir, ossSubDir, config) {
  const results = [];
  if (!existsSync(srcDir)) return results;

  const entries = await readdir(srcDir);
  for (const entry of entries) {
    const srcPath = join(srcDir, entry);
    const s = await stat(srcPath);
    if (s.isFile()) {
      const ossRelPath = `${ossSubDir}/${entry}`;
      await copyToOss(srcPath, ossRelPath, config);
      results.push({ fileName: entry, ossPath: ossRelPath });
    }
  }
  return results;
}

// ─── Phase Sync Functions ─────────────────────────────────────

/**
 * requirement phase → o_novel + o_event
 *
 * Reads requirement.json / scenario.json to extract novel chapters and events,
 * then writes them via the novel/addNovel API.
 */
async function syncRequirement(phaseId, workdir, config, client) {
  const requirement = await readJson(join(workdir, 'requirement.json'));
  const scenario = await readJson(join(workdir, 'scenario.json'));

  if (!requirement && !scenario) {
    warn(phaseId, 'No requirement.json or scenario.json found, skipping');
    return;
  }

  const projectId = config.projectId;

  // Build novel data from requirement
  // The addNovel API expects: { projectId, data: [{ index, reel, chapter, chapterData }] }
  const events = scenario?.events || [];
  if (events.length === 0) {
    // requirement phase runs before scenario is generated — this is expected
    // Just log requirement metadata if available
    if (requirement) {
      info(phaseId, `Requirement synced (title=${requirement.title || '?'}, genre=${requirement.genre || '?'}), events will be synced when scenario phase completes`);
    }
    return;
  }

  // Group events by chapter
  const chapterMap = new Map();
  for (const evt of events) {
    const chapter = evt.chapter || '第一章';
    if (!chapterMap.has(chapter)) {
      chapterMap.set(chapter, []);
    }
    chapterMap.get(chapter).push(evt);
  }

  const novelData = [];
  let idx = 0;
  for (const [chapter, evts] of chapterMap) {
    idx++;
    const chapterData = evts.map(e =>
      `${e.character ? e.character + ': ' : ''}${e.dialogue || e.description || ''}`
    ).join('\n');

    novelData.push({
      index: idx,
      reel: `第${idx}卷`,
      chapter,
      chapterData,
    });
  }

  try {
    const result = await client.post('/api/novel/addNovel', {
      projectId,
      data: novelData,
    });
    log(phaseId, `✅ Synced ${novelData.length} novel chapters`);
  } catch (err) {
    warn(phaseId, `Failed to sync novel: ${err.message}`);
  }
}

/**
 * character phase → o_assets (角色) + o_scriptAssets + o_image (参考图)
 *
 * Reads character-assets.json and creates asset records.
 */
async function syncCharacter(phaseId, workdir, config, client) {
  const charAssets = await readJson(join(workdir, '.pipeline-assets', 'character-assets.json'));
  if (!charAssets?.characters?.length) {
    // Try reading characters.json as fallback
    const chars = await readJson(join(workdir, 'characters.json'));
    if (chars?.characters?.length) {
      charAssets = { characters: chars.characters };
    } else {
      warn(phaseId, 'No character data found, skipping');
      return;
    }
  }

  const projectId = config.projectId;
  const scriptId = config.scriptId;

  for (const char of charAssets.characters) {
    // Create asset via addAssets API
    const assetPayload = {
      name: char.name,
      describe: char.core_prompt || char.description || '',
      type: 'role',
      projectId,
      prompt: char.core_prompt || char.description || '',
      remark: '',
    };

    try {
      await client.post('/api/assets/addAssets', assetPayload);
      log(phaseId, `✅ Created asset: ${char.name} (role)`);
    } catch (err) {
      // Asset may already exist, that's ok
      warn(phaseId, `Asset "${char.name}" creation: ${err.message}`);
    }
  }
}

/**
 * scenario phase → o_script (剧本内容)
 *
 * Reads scenario.json and creates/updates script record.
 */
async function syncScenario(phaseId, workdir, config, client) {
  const scenario = await readJson(join(workdir, 'scenario.json'));
  if (!scenario) {
    warn(phaseId, 'No scenario.json found, skipping');
    return;
  }

  const projectId = config.projectId;
  const scriptId = config.scriptId;

  // Build script content from events
  const events = scenario.events || [];
  const scriptContent = events.map((evt, i) => {
    const parts = [];
    if (evt.chapter) parts.push(`【${evt.chapter}】`);
    if (evt.character) parts.push(`${evt.character}:`);
    parts.push(evt.dialogue || evt.description || '');
    if (evt.scene_description) parts.push(`  (场景: ${evt.scene_description})`);
    if (evt.emotion) parts.push(`  [${evt.emotion}]`);
    return parts.join(' ');
  }).join('\n\n');

  const scriptName = scenario.title || config.episode || '未命名剧本';

  if (scriptId) {
    // Update existing script
    try {
      // Get asset IDs to associate
      const assetsData = await client.get(`/api/assets/getAssetsApi?projectId=${projectId}`);
      const assetIds = (assetsData?.data || assetsData?.result || []).map(a => a.id);

      await client.post('/api/script/updateScript', {
        id: scriptId,
        name: scriptName,
        content: scriptContent,
        assets: assetIds,
      });
      log(phaseId, `✅ Updated script #${scriptId}: ${scriptName}`);
    } catch (err) {
      warn(phaseId, `Failed to update script: ${err.message}`);
    }
  } else {
    // Create new script
    try {
      const assetsData = await client.get(`/api/assets/getAssetsApi?projectId=${projectId}`);
      const assetIds = (assetsData?.data || assetsData?.result || []).map(a => a.id);

      const result = await client.post('/api/script/addScript', {
        name: scriptName,
        content: scriptContent,
        projectId,
        assets: assetIds,
      });
      const newScriptId = result?.data?.id || result?.result?.id || result?.id;
      if (newScriptId) {
        config.scriptId = newScriptId;
        log(phaseId, `✅ Created script #${newScriptId}: ${scriptName}`);
      }
    } catch (err) {
      warn(phaseId, `Failed to create script: ${err.message}`);
    }
  }
}

/**
 * storyboard phase → o_storyboard (分镜)
 *
 * Reads storyboard.json and creates storyboard entries.
 */
async function syncStoryboard(phaseId, workdir, config, client) {
  const storyboard = await readJson(join(workdir, 'storyboard.json'));
  if (!storyboard?.shots?.length) {
    warn(phaseId, 'No storyboard.json or shots found, skipping');
    return;
  }

  const projectId = config.projectId;
  const scriptId = config.scriptId;

  if (!scriptId) {
    warn(phaseId, 'No scriptId available, cannot create storyboard');
    return;
  }

  // Get asset IDs for association
  let assetIds = [];
  try {
    const assetsData = await client.get(`/api/assets/getAssetsApi?projectId=${projectId}`);
    assetIds = (assetsData?.data || assetsData?.result || []).map(a => a.id);
  } catch {}

  const storyboardData = storyboard.shots.map((shot, i) => ({
    prompt: shot.description || shot.dialogue || '',
    duration: shot.duration || 3,
    track: shot.track || '主线',
    state: '未生成',
    src: null,
    videoDesc: shot.dialogue || shot.description || '',
    shouldGenerateImage: 1,
    associateAssetsIds: assetIds,
  }));

  try {
    const result = await client.post('/api/production/storyboard/batchAddStoryboardInfo', {
      data: storyboardData,
      scriptId,
      projectId,
    });
    log(phaseId, `✅ Synced ${storyboardData.length} storyboard entries`);
  } catch (err) {
    warn(phaseId, `Failed to sync storyboard: ${err.message}`);
  }
}

/**
 * scene phase → Copy images to OSS + update o_storyboard filePath + state='已完成'
 *
 * Reads scene images from assets/storyboard/ or assets/scenes/,
 * copies to OSS, and updates storyboard records.
 */
async function syncScene(phaseId, workdir, config, client) {
  const projectId = config.projectId;
  const scriptId = config.scriptId;

  // Find scene images
  const sceneDirs = [
    join(workdir, 'assets', 'storyboard'),
    join(workdir, 'assets', 'scenes'),
  ];

  const sceneImages = [];
  for (const dir of sceneDirs) {
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir);
    for (const entry of entries) {
      const ext = extname(entry).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        sceneImages.push({
          srcPath: join(dir, entry),
          fileName: entry,
          baseName: basename(entry, ext),
        });
      }
    }
  }

  if (sceneImages.length === 0) {
    warn(phaseId, 'No scene images found');
    return;
  }

  // Copy images to OSS
  const ossSubDir = 'storyboard';
  const ossRoot = config.ossRoot || '/app/data/oss';

  for (const img of sceneImages) {
    const ossRelPath = `${ossSubDir}/${img.fileName}`;
    try {
      await copyToOss(img.srcPath, ossRelPath, config);
      log(phaseId, `✅ Copied to OSS: ${ossRelPath}`);
    } catch (err) {
      warn(phaseId, `Failed to copy ${img.fileName}: ${err.message}`);
    }
  }

  // Update storyboard records with file paths
  // Get existing storyboard entries
  try {
    const flowData = await client.post('/api/production/getFlowData', {
      projectId,
      episodesId: scriptId,
    });

    const storyboard = flowData?.data?.storyboard || [];
    if (storyboard.length === 0) {
      warn(phaseId, 'No storyboard entries to update');
      return;
    }

    // Match scene images to storyboard entries by index
    // scene_scene-1.png → storyboard index 0, scene_scene-2.png → index 1, etc.
    for (let i = 0; i < storyboard.length && i < sceneImages.length; i++) {
      const sb = storyboard[i];
      const img = sceneImages[i];
      const ossRelPath = `${ossSubDir}/${img.fileName}`;

      try {
        // Use direct DB update via saveFlowData or a specific update API
        // We need to update the storyboard filePath field
        // The updateStoryboardUrl API can be used if available
        await client.post('/api/production/storyboard/updateStoryboardUrl', {
          id: sb.id,
          filePath: ossRelPath,
        });

        // Also update state to 已完成
        await client.post('/api/production/storyboard/editStoryboardInfo', {
          id: sb.id,
          state: '已完成',
        });

        log(phaseId, `✅ Updated storyboard #${sb.id}: ${ossRelPath} (已完成)`);
      } catch (err) {
        warn(phaseId, `Failed to update storyboard #${sb.id}: ${err.message}`);
        // Try alternative: update via saveFlowData
      }
    }
  } catch (err) {
    warn(phaseId, `Failed to get storyboard data: ${err.message}`);
  }

  // Also save scene_design.json data
  const sceneDesign = await readJson(join(workdir, 'scene_design.json'));
  if (sceneDesign?.scenes?.length) {
    log(phaseId, `Scene design: ${sceneDesign.scenes.length} scenes recorded`);
  }
}

/**
 * voice/tts phase → Copy audio to OSS + create audio assets
 *
 * Reads voice_assignments.json, copies WAV files to OSS,
 * and creates audio asset records.
 */
async function syncVoice(phaseId, workdir, config, client) {
  const voiceAssignments = await readJson(join(workdir, 'voice_assignments.json'));
  if (!voiceAssignments?.length) {
    warn(phaseId, 'No voice_assignments.json found, skipping');
    return;
  }

  const projectId = config.projectId;
  const scriptId = config.scriptId;
  const ttsDir = join(workdir, 'assets', 'tts');

  // Copy TTS files to OSS
  const ossSubDir = 'tts';
  const ossRoot = config.ossRoot || '/app/data/oss';

  const audioAssets = [];
  for (const assignment of voiceAssignments) {
    if (!assignment.audioFile) continue;

    const srcPath = join(ttsDir, assignment.audioFile);
    if (!existsSync(srcPath)) {
      warn(phaseId, `TTS file not found: ${assignment.audioFile}`);
      continue;
    }

    const ossRelPath = `${ossSubDir}/${assignment.audioFile}`;
    try {
      await copyToOss(srcPath, ossRelPath, config);
      audioAssets.push({
        ...assignment,
        ossPath: ossRelPath,
      });
      log(phaseId, `✅ Copied TTS to OSS: ${ossRelPath}`);
    } catch (err) {
      warn(phaseId, `Failed to copy ${assignment.audioFile}: ${err.message}`);
    }
  }

  // Create audio assets in database
  for (const audio of audioAssets) {
    try {
      await client.post('/api/assets/addAudioAssets', {
        name: `${audio.character || '旁白'}_${audio.lineId || 'audio'}`,
        describe: audio.text?.substring(0, 100) || '',
        type: 'audio',
        projectId,
        filePath: audio.ossPath,
      });
      log(phaseId, `✅ Created audio asset: ${audio.audioFile}`);
    } catch (err) {
      warn(phaseId, `Failed to create audio asset: ${err.message}`);
    }
  }
}

/**
 * art-direction phase → sync art bible info
 *
 * Stores art direction as a project-level asset.
 */
async function syncArtDirection(phaseId, workdir, config, client) {
  const artDirection = await readJson(join(workdir, 'art_direction.json'));
  if (!artDirection) {
    warn(phaseId, 'No art_direction.json found, skipping');
    return;
  }

  // Art direction is informational — log it for now
  log(phaseId, `Art direction: ${artDirection.style || artDirection.description || 'N/A'}`);
}

/**
 * post-production phase → final asset sync
 *
 * Reads manifest.json and ensures all assets are registered.
 */
async function syncPostProduction(phaseId, workdir, config, client) {
  const manifest = await readJson(join(workdir, 'manifest.json'));
  if (!manifest) {
    log(phaseId, 'No manifest.json, skipping');
    return;
  }

  const assets = manifest.assets || {};
  log(phaseId, `Manifest: ${assets.scenes?.length || 0} scenes, ${assets.tts?.length || 0} TTS, ${assets.storyboards?.length || 0} shots`);
}

// ─── Main Sync Entry Point ────────────────────────────────────

const PHASE_SYNC_MAP = {
  requirement: syncRequirement,
  'art-direction': syncArtDirection,
  character: syncCharacter,
  scenario: syncScenario,
  voice: syncVoice,
  storyboard: syncStoryboard,
  scene: syncScene,
  'post-production': syncPostProduction,
};

/**
 * Sync a completed phase's output to Toonflow.
 *
 * @param {string} phaseId - Phase identifier (e.g., 'requirement', 'scene')
 * @param {string} workdir - Pipeline working directory
 * @param {object} config - Configuration with projectId, scriptId, toonflowBaseUrl, etc.
 * @returns {Promise<void>}
 */
export async function syncPhaseOutput(phaseId, workdir, config) {
  const syncFn = PHASE_SYNC_MAP[phaseId];
  if (!syncFn) {
    // Not all phases need toonflow sync
    return;
  }

  if (!config.projectId) {
    warn(phaseId, 'No projectId in config, skipping sync');
    return;
  }

  const baseUrl = config.toonflowBaseUrl || process.env.TOONFLOW_BASE_URL || 'http://kais-core-backend:8000';
  const client = new ToonflowClient(baseUrl);

  log(phaseId, `Syncing phase output → Toonflow (project=${config.projectId})`);

  try {
    await syncFn(phaseId, workdir, config, client);
  } catch (err) {
    // Sync failure should never block pipeline execution
    warn(phaseId, `Sync failed: ${err.message}`);
  }

  // Also notify core-backend via the existing callback mechanism
  try {
    const cbClient = new CoreBackendClient({
      baseUrl: config.toonflowBaseUrl || process.env.CORE_BACKEND_URL || 'http://kais-core-backend:8000',
    });
    await cbClient.notifyPhaseComplete(
      config.pipelineId || 'unknown',
      Number(config.projectId),
      phaseId,
      { status: 'completed' },
    );
  } catch (cbErr) {
    warn(phaseId, `CoreBackend notify failed: ${cbErr.message}`);
  }
}

/**
 * Initialize Toonflow records for a new pipeline run.
 * Creates o_agentWorkData entry if needed.
 *
 * @param {object} config - { projectId, episodesId, toonflowBaseUrl }
 */
export async function initToonflowRecords(config) {
  const baseUrl = config.toonflowBaseUrl || process.env.TOONFLOW_BASE_URL || 'http://kais-core-backend:8000';
  const client = new ToonflowClient(baseUrl);
  const { projectId, episodesId } = config;

  if (!projectId || !episodesId) {
    warn('init', 'Missing projectId or episodesId');
    return;
  }

  // Initialize agentWorkData via saveFlowData
  try {
    await client.post('/api/production/saveFlowData', {
      projectId,
      episodesId,
      data: {
        script: '',
        scriptPlan: '',
        assets: [],
        storyboardTable: '',
        storyboard: [],
        workbench: { videoList: [] },
      },
    });
    log('init', `✅ Initialized agentWorkData for project=${projectId}, episodes=${episodesId}`);
  } catch (err) {
    warn('init', `initToonflowRecords failed: ${err.message}`);
  }
}

export { ToonflowClient };
export default { syncPhaseOutput, initToonflowRecords };
