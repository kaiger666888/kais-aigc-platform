#!/usr/bin/env node

/**
 * Toonflow Agent 产出物同步脚本 V2
 * 
 * 将 OpenClaw Agent 管线各步骤的产出物同步到 kais-aigc-platform (Toonflow)
 * 
 * 用法：
 *   node scripts/agent-sync.js --project-name "短片名" --asset-type script --file-path ./script.md
 *   node scripts/agent-sync.js --project-name "短片名" --asset-type character_image --file-path ./char.png --metadata '{"name":"主角","prompt":"..."}'
 *   node scripts/agent-sync.js --project-name "短片名" --asset-type scene_image --file-path ./scene.png --metadata '{"name":"戈壁公路","prompt":"..."}'
 *   node scripts/agent-sync.js --project-name "短片名" --asset-type voice --file-path ./voice.mp3 --metadata '{"name":"旁白"}'
 *   node scripts/agent-sync.js --project-name "短片名" --asset-type canvas_graph --file-path ./graph.json --project-id 1781505200640
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const TOONFLOW_API = 'http://localhost:8000';
const API_TIMEOUT = 15000;

// ── Args ──────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const r = { projectName: null, step: null, assetType: null, filePath: null, projectId: null, metadata: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i], n = args[i + 1];
    switch (a) {
      case '--project-name': r.projectName = n; i++; break;
      case '--project-id':   r.projectId = parseInt(n, 10); i++; break;
      case '--step':         r.step = parseInt(n, 10); i++; break;
      case '--asset-type':   r.assetType = n; i++; break;
      case '--file-path':    r.filePath = n; i++; break;
      case '--metadata':
        try { r.metadata = JSON.parse(n); } catch { console.error(`❌ Invalid JSON: ${n}`); process.exit(1); }
        i++; break;
      case '-h': case '--help': printHelp(); process.exit(0);
    }
  }
  if (!r.projectName && !r.projectId) { console.error('❌ 需要 --project-name 或 --project-id'); process.exit(1); }
  if (!r.assetType) { console.error('❌ 需要 --asset-type'); process.exit(1); }
  if (r.assetType !== 'canvas_graph' && !r.filePath) { console.error('❌ 需要 --file-path'); process.exit(1); }
  if (r.filePath && !fs.existsSync(r.filePath) && r.assetType !== 'canvas_graph') {
    console.error(`❌ 文件不存在: ${r.filePath}`); process.exit(1);
  }
  return r;
}

function printHelp() {
  console.log(`
Toonflow Agent 同步脚本 V2

用法: node scripts/agent-sync.js [选项]

必填:  --project-name <名称>  或  --project-id <ID>
       --asset-type <类型>
       --file-path <路径>     (canvas_graph 可省略)

可选:  --step <数字>
       --metadata <JSON>

支持类型:
  script           剧本/大纲/时空剧本
  character_image  角色参考图
  scene_image      场景参考图
  voice            语音/旁白
  canvas_graph     画布FlowGraph JSON
`);
}

// ── HTTP ──────────────────────────────────────────────
function apiPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost', port: 8000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: API_TIMEOUT
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch { resolve({ code: res.statusCode, raw: b }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Project ───────────────────────────────────────────
async function resolveProject(args) {
  // 如果直接给了 projectId
  if (args.projectId) return { id: args.projectId };

  // 按名称查找
  const resp = await apiPost('/api/project/getProject', {});
  if (resp.code === 200 && Array.isArray(resp.data)) {
    const p = resp.data.find(x => x.name === args.projectName);
    if (p) return p;
  }

  // 创建
  const m = args.metadata || {};
  await apiPost('/api/project/addProject', {
    projectType: m.projectType || 'short_film',
    name: args.projectName,
    intro: m.intro || `OpenClaw Agent: ${args.projectName}`,
    type: m.type || '剧情',
    artStyle: m.artStyle || '写实电影摄影',
    directorManual: m.directorManual || '',
    videoRatio: m.videoRatio || '16:9',
    imageModel: m.imageModel || 'jimeng',
    videoModel: m.videoModel || 'wan',
    imageQuality: m.imageQuality || '2k',
    mode: 'agent'
  });
  // 重新查找拿 ID
  const resp2 = await apiPost('/api/project/getProject', {});
  const found = resp2.data.find(x => x.name === args.projectName);
  if (found) return found;
  throw new Error('项目创建后查询失败');
}

// ── Syncers ───────────────────────────────────────────

async function syncScript(projectId, filePath, metadata) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const name = metadata.name || path.basename(filePath, path.extname(filePath));
  const resp = await apiPost('/api/script/addScript', {
    name, content, projectId, assets: metadata.assetIds || []
  });
  console.log(`📄 剧本同步成功: ${name}`);
  return resp;
}

async function syncCharacterImage(projectId, filePath, metadata) {
  const name = metadata.name || path.basename(filePath, path.extname(filePath));
  await apiPost('/api/assets/addAssets', {
    name,
    describe: metadata.description || metadata.describe || metadata.prompt || '',
    type: 'role',
    projectId,
    remark: metadata.remark || `Step ${metadata.step || '?'}`,
    prompt: metadata.prompt || '',
  });
  // 资产系统增强：同时注册到全局资产注册表（带 characterId / viewAngle）
  try {
    await apiPost('/api/v1/assets-registry', {
      asset: {
        name,
        type: 'character',
        prompt: metadata.prompt || '',
        describe: metadata.description || '',
        projectId,
        characterId: metadata.characterId || name,
        viewAngle: metadata.viewAngle || 'front',
        isPrimaryView: metadata.isPrimaryView || false,
        model: metadata.model || '',
        tags: metadata.tags || '',
        meta: metadata.meta || null,
        createdBy: 'agent-sync',
      },
    });
  } catch (e) {
    console.warn(`⚠️ 全局资产注册失败 (非致命): ${e.message}`);
  }
  console.log(`🧑 角色同步成功: ${name}`);
}

async function syncSceneImage(projectId, filePath, metadata) {
  const name = metadata.name || path.basename(filePath, path.extname(filePath));
  await apiPost('/api/assets/addAssets', {
    name,
    describe: metadata.description || metadata.describe || metadata.prompt || '',
    type: 'scene',
    projectId,
    remark: metadata.remark || `Step ${metadata.step || '?'}`,
    prompt: metadata.prompt || '',
  });
  // 资产系统增强：注册到全局资产注册表
  try {
    await apiPost('/api/v1/assets-registry', {
      asset: {
        name,
        type: 'scene',
        prompt: metadata.prompt || '',
        describe: metadata.description || '',
        projectId,
        tags: metadata.tags || '',
        createdBy: 'agent-sync',
      },
    });
  } catch (e) {
    console.warn(`⚠️ 全局资产注册失败 (非致命): ${e.message}`);
  }
  console.log(`🏞️ 场景同步成功: ${name}`);
}

async function syncVoice(projectId, filePath, metadata) {
  const name = metadata.name || path.basename(filePath, path.extname(filePath));
  const fileBuf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1) || 'mp3';
  const mimeMap = { mp3: 'mpeg', wav: 'wav', ogg: 'ogg', flac: 'flac', m4a: 'mp4' };
  const mime = `audio/${mimeMap[ext] || ext}`;
  const b64 = `data:${mime};base64,${fileBuf.toString('base64')}`;
  await apiPost('/api/assets/addAudioAssets', {
    name,
    describe: metadata.description || metadata.describe || '',
    projectId,
    assetsItem: [{ base64: b64, name, prompt: metadata.prompt || '', describe: metadata.description || '' }]
  });
  console.log(`🎙️ 语音同步成功: ${name}`);
}

async function syncCanvasGraph(projectId, filePath) {
  const graph = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  await apiPost('/api/canvas/save', { projectId, episodesId: 1, graph });
  console.log(`🖼️ 画布FlowGraph同步成功`);
}

// ── Main ──────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  console.log(`🔄 Toonflow 同步 V2`);
  console.log(`   类型: ${args.assetType}`);
  console.log(`   文件: ${args.filePath || '(canvas_graph)'}`);
  if (args.projectName) console.log(`   项目: ${args.projectName}`);
  if (args.projectId) console.log(`   项目ID: ${args.projectId}`);

  try {
    const project = await resolveProject(args);
    const pid = project.id;
    console.log(`   解析ID: ${pid}`);

    switch (args.assetType) {
      case 'script':
        await syncScript(pid, args.filePath, args.metadata);
        break;
      case 'character_image':
        await syncCharacterImage(pid, args.filePath, args.metadata);
        break;
      case 'scene_image':
        await syncSceneImage(pid, args.filePath, args.metadata);
        break;
      case 'voice':
        await syncVoice(pid, args.filePath, args.metadata);
        break;
      case 'canvas_graph':
        await syncCanvasGraph(pid, args.filePath);
        break;
      default:
        console.error(`❌ 不支持的类型: ${args.assetType}`);
        process.exit(1);
    }

    console.log(`✅ 同步完成`);
  } catch (err) {
    console.error(`❌ 同步失败: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
