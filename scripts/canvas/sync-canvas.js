#!/usr/bin/env node
/**
 * sync-canvas.js — 管线每步自动写入画布的钩子 + 项目初始化（重构版）
 *
 * 重构说明：
 *   - 图操作（load/save）单写路径，全部走 ./lib/canvas-client（HTTP v2 API）。
 *   - init-project 仅使用 better-sqlite3（平台仓库已有依赖），
 *     已删除 sqlite3 CLI 字符串插值 fallback（注入风险 + 不可移植）。
 *   - 子命令 / flag / stdout 消息格式与原版本逐字一致（管线 shell 钩子调用契约）。
 *
 * 用法:
 *   sync-canvas.js add-node     --projectId 1800 --episodesId 1 --id "n-step4" --type "asset" --label "Step4: 主角设计" --phase "Step4-CharacterDesign" --state "pending" --x 1600 --y 100
 *   sync-canvas.js update-node  --projectId 1800 --episodesId 1 --id "n-step3" --state "success"
 *   sync-canvas.js add-link     --projectId 1800 --episodesId 1 --id "l7" --source "n-script" --target "n-step4"
 *   sync-canvas.js load         --projectId 1800 --episodesId 1
 *   sync-canvas.js init-project --id 1 --name "P1800时间胶囊" --type "movie-pipeline" --intro "..."
 *
 * API: http://127.0.0.1:10588/api/v2/canvas/（env CANVAS_API_HOST / CANVAS_API_PORT 可覆盖）
 * DB:  SQLite at data/db2.sqlite（env DB_PATH 可覆盖）
 */

const { config, loadGraph, saveGraph, parseArgs, parseRequired, usageExit } = require('./lib/canvas-client');

// ─── 纯函数：节点 / 链接构造（字段与默认值和原实现逐字等价）──

function buildNode(args) {
  const { id, type, label, phase, state, x, y } = args;
  return {
    id,
    type,
    branchId: 'main',
    phaseIndex: 0,
    phaseName: phase || type,
    position: { x: Number(x) || 0, y: Number(y) || 0 },
    size: { width: 280, height: 100 },
    data: {
      label,
      detail: args.detail || '',
      ...(state ? { status: state } : {}),
    },
    state: state || 'idle',
  };
}

function buildLink(args) {
  const { id, source, target } = args;
  return {
    id,
    source,
    target,
    branchId: 'main',
    dataType: args.dataType || 'flow',
  };
}

// ─── Commands ─────────────────────────────────────────────

async function cmdLoad(args) {
  const { projectId, episodesId } = parseRequired(args, ['projectId', 'episodesId']);
  const graph = await loadGraph(Number(projectId), Number(episodesId));
  if (!graph) {
    console.log(JSON.stringify({ nodes: [], links: [] }, null, 2));
    return;
  }
  console.log(JSON.stringify(graph, null, 2));
}

async function cmdAddNode(args) {
  const { projectId, episodesId, id, label } = parseRequired(
    args,
    ['projectId', 'episodesId', 'id', 'type', 'label'],
  );

  const pid = Number(projectId);
  const eid = Number(episodesId);

  const graph = await loadGraph(pid, eid);
  if (!graph) {
    console.error(`No canvas graph found for projectId=${pid} episodesId=${eid}`);
    process.exit(1);
  }

  // Check for duplicate
  if (graph.nodes.find((n) => n.id === id)) {
    console.error(`Node already exists: ${id}`);
    process.exit(1);
  }

  const node = buildNode(args);
  graph.nodes.push(node);
  graph.meta.updatedAt = Date.now();

  await saveGraph(pid, eid, graph);
  console.log(`✅ Node added: ${id} (${label})`);
}

async function cmdUpdateNode(args) {
  const { projectId, episodesId, id } = parseRequired(args, ['projectId', 'episodesId', 'id']);

  const pid = Number(projectId);
  const eid = Number(episodesId);

  const graph = await loadGraph(pid, eid);
  if (!graph) {
    console.error(`No canvas graph found for projectId=${pid} episodesId=${eid}`);
    process.exit(1);
  }

  const node = graph.nodes.find((n) => n.id === id);
  if (!node) {
    console.error(`Node not found: ${id}`);
    process.exit(1);
  }

  // Apply updates
  if (args.state) {
    node.state = args.state;
    node.data = node.data || {};
    node.data.status = args.state;
  }
  if (args.label) {
    node.data = node.data || {};
    node.data.label = args.label;
  }
  if (args.detail) {
    node.data = node.data || {};
    node.data.detail = args.detail;
  }
  if (args.phase) {
    node.phaseName = args.phase;
  }
  if (args.x !== undefined || args.y !== undefined) {
    node.position = {
      x: args.x !== undefined ? Number(args.x) : node.position.x,
      y: args.y !== undefined ? Number(args.y) : node.position.y,
    };
  }

  graph.meta.updatedAt = Date.now();

  await saveGraph(pid, eid, graph);
  console.log(`✅ Node updated: ${id}`);
}

async function cmdAddLink(args) {
  const { projectId, episodesId, id, source, target } = parseRequired(
    args,
    ['projectId', 'episodesId', 'id', 'source', 'target'],
  );

  const pid = Number(projectId);
  const eid = Number(episodesId);

  const graph = await loadGraph(pid, eid);
  if (!graph) {
    console.error(`No canvas graph found for projectId=${pid} episodesId=${eid}`);
    process.exit(1);
  }

  // Check for duplicate
  if (graph.links.find((l) => l.id === id)) {
    console.error(`Link already exists: ${id}`);
    process.exit(1);
  }

  // Verify source and target nodes exist
  if (!graph.nodes.find((n) => n.id === source)) {
    console.error(`Source node not found: ${source}`);
    process.exit(1);
  }
  if (!graph.nodes.find((n) => n.id === target)) {
    console.error(`Target node not found: ${target}`);
    process.exit(1);
  }

  const link = buildLink(args);
  graph.links.push(link);
  graph.meta.updatedAt = Date.now();

  await saveGraph(pid, eid, graph);
  console.log(`✅ Link added: ${id} (${source} → ${target})`);
}

// ─── init-project: 仅走 better-sqlite3 直写 SQLite ────────

async function cmdInitProject(args) {
  const { id, name } = parseRequired(args, ['id', 'name']);

  const projectId = Number(id);
  const type = args.type || 'movie-pipeline';
  const intro = args.intro || '';
  const mode = args.mode || 'canvas-v2';
  const artStyle = args.artStyle || '';

  // 仅使用 better-sqlite3（平台仓库已有依赖）；缺失时报清晰错误
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    console.error(
      'init-project 需要 better-sqlite3，但当前环境无法加载。\n' +
        '请在平台仓库根目录执行 `npm i better-sqlite3` 或 `yarn install` 后重试。',
    );
    process.exit(1);
  }

  const db = new Database(config.dbPath);
  try {
    // Check if project exists
    const existing = db.prepare('SELECT id FROM o_project WHERE id = ?').get(projectId);
    if (existing) {
      console.log(`⏭️  Project already exists: id=${projectId} name="${name}", skipping`);
      return;
    }

    const now = Date.now();
    // 列映射与原实现一致：--type 写入 type 列，projectType 列固定 'short'
    db.prepare(
      `INSERT INTO o_project (id, name, intro, type, artStyle, mode, projectType, createTime, userId)
       VALUES (?, ?, ?, ?, ?, ?, 'short', ?, 1)`,
    ).run(projectId, name, intro, type, artStyle, mode, now);

    console.log(`✅ Project created: id=${projectId} name="${name}"`);
  } finally {
    db.close();
  }
}

// ─── Main ─────────────────────────────────────────────────

const COMMANDS = {
  'add-node': cmdAddNode,
  'update-node': cmdUpdateNode,
  'add-link': cmdAddLink,
  'load': cmdLoad,
  'init-project': cmdInitProject,
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || !COMMANDS[cmd]) {
    usageExit(`Usage: sync-canvas.js <command> [options]
Commands:
  add-node      Add a node to the canvas
  update-node   Update a node on the canvas
  add-link      Add a link between nodes
  load          Load and print the current canvas graph
  init-project  Create a project in o_project table

Options for add-node:
  --projectId (required)   Project ID
  --episodesId (required)  Episodes ID
  --id (required)          Node ID (e.g. "n-step4")
  --type (required)        Node type (script/asset/storyboard/video/audio)
  --label (required)       Display label
  --phase (optional)       Phase name (e.g. "Step4-CharacterDesign")
  --state (optional)       Node state (idle/pending/running/success/error/cached)
  --x (optional)           X position (default: 0)
  --y (optional)           Y position (default: 0)
  --detail (optional)      Detail text

Options for update-node:
  --projectId (required)   Project ID
  --episodesId (required)  Episodes ID
  --id (required)          Node ID to update
  --state (optional)       New state
  --label (optional)       New label
  --detail (optional)      New detail text
  --phase (optional)       New phase name
  --x (optional)           New X position
  --y (optional)           New Y position

Options for add-link:
  --projectId (required)   Project ID
  --episodesId (required)  Episodes ID
  --id (required)          Link ID (e.g. "l7")
  --source (required)      Source node ID
  --target (required)      Target node ID
  --dataType (optional)    Data type (flow/text/image/video/audio/data) (default: flow)

Options for load:
  --projectId (required)   Project ID
  --episodesId (required)  Episodes ID

Options for init-project:
  --id (required)          Project ID
  --name (required)        Project name
  --type (optional)        Project type (default: movie-pipeline)
  --intro (optional)       Project intro
  --mode (optional)        Project mode (default: canvas-v2)
  --artStyle (optional)    Art style description
`);
  }

  const args = parseArgs(rest);

  try {
    await COMMANDS[cmd](args);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

// 纯函数导出便于测试；仅作为 CLI 入口时执行 main()
if (require.main === module) {
  main();
}

module.exports = { buildNode, buildLink };
