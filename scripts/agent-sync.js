#!/usr/bin/env node

/**
 * Toonflow Agent 产出物同步脚本
 * 
 * 用途：将 OpenClaw Agent 管线各步骤的产出物同步到 Toonflow 数据库
 * 
 * 使用方式：
 *   node scripts/agent-sync.js \
 *     --project-name "短片名称" \
 *     --step 8 \
 *     --asset-type character_image \
 *     --file-path /mnt/agents/output/task_123/character.png \
 *     --metadata '{"name":"主角","prompt":"..."}'
 * 
 * 支持的 asset_type：
 *   - script: 剧本内容
 *   - character_image: 角色图片
 *   - scene_image: 场景图片
 *   - voice: 语音文件
 *   - video_preview: 预览视频
 *   - video_final: 终版视频
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const TOONFLOW_API = 'http://localhost:8000';
const API_TIMEOUT = 30000;

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    projectName: null,
    step: null,
    assetType: null,
    filePath: null,
    metadata: {}
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--project-name':
        result.projectName = nextArg;
        i++;
        break;
      case '--step':
        result.step = parseInt(nextArg, 10);
        i++;
        break;
      case '--asset-type':
        result.assetType = nextArg;
        i++;
        break;
      case '--file-path':
        result.filePath = nextArg;
        i++;
        break;
      case '--metadata':
        try {
          result.metadata = JSON.parse(nextArg);
        } catch (e) {
          console.error(`❌ 无效的 JSON metadata: ${nextArg}`);
          process.exit(1);
        }
        i++;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  // 验证必填参数
  if (!result.projectName) {
    console.error('❌ 缺少必填参数: --project-name');
    printHelp();
    process.exit(1);
  }
  if (!result.assetType) {
    console.error('❌ 缺少必填参数: --asset-type');
    printHelp();
    process.exit(1);
  }
  if (!result.filePath) {
    console.error('❌ 缺少必填参数: --file-path');
    printHelp();
    process.exit(1);
  }

  // 验证文件存在
  if (!fs.existsSync(result.filePath)) {
    console.error(`❌ 文件不存在: ${result.filePath}`);
    process.exit(1);
  }

  return result;
}

function printHelp() {
  console.log(`
Toonflow Agent 产出物同步脚本

用法:
  node scripts/agent-sync.js [选项]

选项:
  --project-name <名称>    项目名称 (必填)
  --step <数字>           管线步骤编号 (可选)
  --asset-type <类型>     资产类型 (必填)
                          支持的值: script, character_image, scene_image, voice, video_preview, video_final
  --file-path <路径>      文件路径 (必填)
  --metadata <JSON>       元数据 JSON 字符串 (可选)
  --help, -h              显示帮助信息

示例:
  # 同步角色图片
  node scripts/agent-sync.js \\
    --project-name "我的短片" \\
    --step 8 \\
    --asset-type character_image \\
    --file-path /mnt/agents/output/task_123/character.png \\
    --metadata '{"name":"主角","prompt":"...","description":"..."}'

  # 同步剧本
  node scripts/agent-sync.js \\
    --project-name "我的短片" \\
    --step 6 \\
    --asset-type script \\
    --file-path /mnt/agents/output/task_123/script.txt \\
    --metadata '{"name":"第1集剧本"}'

  # 同步视频
  node scripts/agent-sync.js \\
    --project-name "我的短片" \\
    --step 17 \\
    --asset-type video_final \\
    --file-path /mnt/agents/output/task_123/final.mp4 \\
    --metadata '{"shotIndex":5,"prompt":"..."}'
`);
}

// HTTP 请求辅助函数
function httpRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${json.message || body}`));
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    req.setTimeout(API_TIMEOUT);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// 获取或创建项目
async function getOrCreateProject(projectName) {
  console.log(`📂 查找项目: ${projectName}`);

  // 先尝试查询所有项目，通过名称匹配
  try {
    const options = {
      hostname: 'localhost',
      port: 8000,
      path: '/api/project/getProject',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const response = await httpRequest(options, {});
    if (response.data && Array.isArray(response.data)) {
      const project = response.data.find(p => p.name === projectName);
      if (project && project.id) {
        console.log(`✅ 找到现有项目: ID ${project.id}`);
        return project;
      }
    }
  } catch (error) {
    console.log(`⚠️  查询项目失败: ${error.message}`);
  }

  // 项目不存在，创建新项目
  console.log(`📝 创建新项目: ${projectName}`);

  const createOptions = {
    hostname: 'localhost',
    port: 8000,
    path: '/api/project/addProject',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const createData = {
    projectType: 'short-film',
    name: projectName,
    intro: `由 OpenClaw Agent 自动生成的项目: ${projectName}`,
    type: 'animation',
    artStyle: '',
    directorManual: '',
    videoRatio: '9:16',
    imageModel: '',
    videoModel: '',
    imageQuality: 'high',
    mode: 'agent'
  };

  try {
    const response = await httpRequest(createOptions, createData);
    console.log(`✅ 项目创建成功`);
    // 重新查询获取项目详情
    return await getOrCreateProject(projectName);
  } catch (error) {
    console.error(`❌ 创建项目失败: ${error.message}`);
    throw error;
  }
}

// 同步剧本
async function syncScript(projectId, filePath, metadata) {
  console.log(`📄 同步剧本...`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const name = metadata.name || path.basename(filePath, path.extname(filePath));

  const options = {
    hostname: 'localhost',
    port: 8000,
    path: '/api/script/addScript',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const data = {
    name,
    content,
    projectId,
    assets: metadata.assetIds || []
  };

  const response = await httpRequest(options, data);
  console.log(`✅ 剧本同步成功: ID ${response.data.id || 'created'}`);
  return response.data;
}

// 同步图片（角色/场景）
async function syncImage(projectId, filePath, assetType, metadata) {
  console.log(`🖼️  同步图片 (${assetType})...`);

  // 判断 asset 类型
  const typeMap = {
    'character_image': 'role',
    'scene_image': 'scene'
  };
  const dbType = typeMap[assetType] || 'tool';

  // 使用 /api/v1/pipeline/ingest/images 端点（V1 API）
  const options = {
    hostname: 'localhost',
    port: 8000,
    path: '/api/v1/pipeline/ingest/images',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  // 使用相对路径（相对于 /mnt/agents/output/）
  let relativePath = filePath;
  if (filePath.startsWith('/mnt/agents/output/')) {
    relativePath = filePath.replace('/mnt/agents/output/', '');
  }

  const name = metadata.name || path.basename(filePath, path.extname(filePath));
  const prompt = metadata.prompt || '';
  const description = metadata.description || metadata.describe || '';

  const data = {
    projectId,
    phase: assetType === 'character_image' ? 'character' : 'scene',
    images: [{
      filePath: relativePath,
      assetName: name,
      assetType: dbType,
      prompt,
      description
    }]
  };

  try {
    const response = await httpRequest(options, data);
    console.log(`✅ 图片同步成功`);
    return response.data;
  } catch (error) {
    // 如果 V1 API 失败，尝试使用旧 API
    console.log(`⚠️  V1 API 失败，尝试旧 API: ${error.message}`);
    return await syncImageLegacy(projectId, filePath, assetType, metadata);
  }
}

// 旧版图片同步（备用）
async function syncImageLegacy(projectId, filePath, assetType, metadata) {
  const typeMap = {
    'character_image': 'role',
    'scene_image': 'scene'
  };
  const dbType = typeMap[assetType] || 'tool';

  const options = {
    hostname: 'localhost',
    port: 8000,
    path: '/api/assets/addAssets',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const name = metadata.name || path.basename(filePath, path.extname(filePath));
  const prompt = metadata.prompt || '';
  const description = metadata.description || metadata.describe || '';

  const data = {
    name,
    describe: description,
    type: dbType,
    projectId,
    remark: metadata.remark || '',
    prompt
  };

  const response = await httpRequest(options, data);
  console.log(`✅ 图片同步成功（旧版API）`);
  return response.data;
}

// 同步语音
async function syncVoice(projectId, filePath, metadata) {
  console.log(`🎙️  同步语音...`);

  // 使用相对路径
  let relativePath = filePath;
  if (filePath.startsWith('/mnt/agents/output/')) {
    relativePath = filePath.replace('/mnt/agents/output/', '');
  }

  const options = {
    hostname: 'localhost',
    port: 8000,
    path: '/api/assets/addAudioAssets',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const name = metadata.name || path.basename(filePath, path.extname(filePath));
  const description = metadata.description || metadata.describe || '';

  // 读取文件并转换为 base64
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1);
  const base64 = `data:audio/${ext};base64,${fileBuffer.toString('base64')}`;

  const data = {
    name,
    describe: description,
    projectId,
    assetsItem: [{
      base64,
      name,
      prompt: metadata.prompt || '',
      describe: description
    }]
  };

  const response = await httpRequest(options, data);
  console.log(`✅ 语音同步成功`);
  return response.data;
}

// 同步视频
async function syncVideo(projectId, filePath, assetType, metadata) {
  console.log(`🎬 同步视频 (${assetType})...`);

  const options = {
    hostname: 'localhost',
    port: 8000,
    path: '/api/v1/pipeline/ingest/videos',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  // 使用相对路径
  let relativePath = filePath;
  if (filePath.startsWith('/mnt/agents/output/')) {
    relativePath = filePath.replace('/mnt/agents/output/', '');
  }

  const data = {
    projectId,
    videos: [{
      filePath: relativePath,
      duration: metadata.duration || 0,
      shotIndex: metadata.shotIndex,
      prompt: metadata.prompt || '',
      trackId: metadata.trackId
    }]
  };

  const response = await httpRequest(options, data);
  console.log(`✅ 视频同步成功`);
  return response.data;
}

// 主函数
async function main() {
  console.log('🔄 Toonflow Agent 产出物同步脚本\n');

  const args = parseArgs();
  console.log(`📋 同步参数:`);
  console.log(`   项目: ${args.projectName}`);
  console.log(`   步骤: ${args.step || '未指定'}`);
  console.log(`   类型: ${args.assetType}`);
  console.log(`   文件: ${args.filePath}`);
  console.log(`   元数据: ${JSON.stringify(args.metadata)}\n`);

  try {
    // 1. 获取或创建项目
    const project = await getOrCreateProject(args.projectName);
    const projectId = project.id;

    console.log(`\n📦 开始同步产出物...\n`);

    // 2. 根据类型调用相应的同步函数
    let result;
    switch (args.assetType) {
      case 'script':
        result = await syncScript(projectId, args.filePath, args.metadata);
        break;

      case 'character_image':
      case 'scene_image':
        result = await syncImage(projectId, args.filePath, args.assetType, args.metadata);
        break;

      case 'voice':
        result = await syncVoice(projectId, args.filePath, args.metadata);
        break;

      case 'video_preview':
      case 'video_final':
        result = await syncVideo(projectId, args.filePath, args.assetType, args.metadata);
        break;

      default:
        console.error(`❌ 不支持的资产类型: ${args.assetType}`);
        console.error(`   支持的类型: script, character_image, scene_image, voice, video_preview, video_final`);
        process.exit(1);
    }

    console.log('\n✅ 同步完成！');
    console.log(`📊 结果:`, JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('\n❌ 同步失败:', error.message);
    console.error('请检查:');
    console.error('  1. Toonflow 服务是否运行 (localhost:8000)');
    console.error('  2. API 路由是否正确');
    console.error('  3. 文件路径是否正确');
    process.exit(1);
  }
}

// 运行主函数
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
