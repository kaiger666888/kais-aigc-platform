#!/usr/bin/env node
/**
 * sync-canvas.js — 管线每步自动写入画布的钩子 + 项目初始化
 *
 * 用法:
 *   sync-canvas.js add-node     --projectId 1800 --episodesId 1 --id "n-step4" --type "asset" --label "Step4: 主角设计" --phase "Step4-CharacterDesign" --state "pending" --x 1600 --y 100
 *   sync-canvas.js update-node  --projectId 1800 --episodesId 1 --id "n-step3" --state "success"
 *   sync-canvas.js add-link     --projectId 1800 --episodesId 1 --id "l7" --source "n-script" --target "n-step4"
 *   sync-canvas.js load         --projectId 1800 --episodesId 1
 *   sync-canvas.js init-project --id 1 --name "P1800时间胶囊" --type "movie-pipeline" --intro "..."
 *
 * API: http://127.0.0.1:10588/api/v2/canvas/
 * DB:  SQLite at data/db2.sqlite
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// ─── Config ───────────────────────────────────────────────

const API_HOST = process.env.CANVAS_API_HOST || '127.0.0.1';
const API_PORT = parseInt(process.env.CANVAS_API_PORT || '10588', 10);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'db2.sqlite');

// ─── HTTP helper ──────────────────────────────────────────

function apiCall(apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: API_HOST,
        port: API_PORT,
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (d) => (chunks += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(chunks));
          } catch {
            reject(new Error(`Invalid JSON response: ${chunks.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.write(data);
    req.end();
  });
}

// ─── Canvas Graph load/save via v2 API ────────────────────

async function loadGraph(projectId, episodesId) {
  const res = await apiCall('/api/v2/canvas/load', { projectId, episodesId });
  if (res.code === 404 || !res.data) return null;
  return res.data;
}

async function saveGraph(projectId, episodesId, graph) {
  const res = await apiCall('/api/v2/canvas/save', { projectId, episodesId, graph });
  if (res.code !== 200 && res.code !== 0) {
    throw new Error(`Save failed: ${res.message || JSON.stringify(res)}`);
  }
  return res;
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
  const { projectId, episodesId, id, type, label, phase, state, x, y } = parseRequired(
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

  const nodeType = type;
  const now = Date.now();

  const node = {
    id,
    type: nodeType,
    branchId: 'main',
    phaseIndex: 0,
    phaseName: phase || nodeType,
    position: { x: Number(x) || 0, y: Number(y) || 0 },
    size: { width: 280, height: 100 },
    data: {
      label,
      detail: args.detail || '',
      ...(state ? { status: state } : {}),
    },
    state: state || 'idle',
  };

  graph.nodes.push(node);
  graph.meta.updatedAt = now;

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

  const link = {
    id,
    source,
    target,
    branchId: 'main',
    dataType: args.dataType || 'flow',
  };

  graph.links.push(link);
  graph.meta.updatedAt = Date.now();

  await saveGraph(pid, eid, graph);
  console.log(`✅ Link added: ${id} (${source} → ${target})`);
}

// ─── init-project: write directly to SQLite ───────────────

async function cmdInitProject(args) {
  const { id, name } = parseRequired(args, ['id', 'name']);

  const projectId = Number(id);
  const projectType = args.type || 'movie-pipeline';
  const intro = args.intro || '';
  const mode = args.mode || 'canvas-v2';
  const artStyle = args.artStyle || '';

  // Try to load better-sqlite3, fall back to sqlite3 command
  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
  } catch {
    // Fall back to sqlite3 CLI
    return cmdInitProjectViaCli(projectId, name, projectType, intro, mode, artStyle, args);
  }

  try {
    // Check if project exists
    const existing = db.prepare('SELECT id FROM o_project WHERE id = ?').get(projectId);
    if (existing) {
      console.log(`⏭️  Project already exists: id=${projectId} name="${name}", skipping`);
      return;
    }

    const now = Date.now();
    db.prepare(
      `INSERT INTO o_project (id, name, intro, type, artStyle, mode, projectType, createTime, userId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(projectId, name, intro, projectType, artStyle, mode, 'short', now, 1);

    console.log(`✅ Project created: id=${projectId} name="${name}"`);
  } finally {
    db.close();
  }
}

async function cmdInitProjectViaCli(projectId, name, projectType, intro, mode, artStyle, args) {
  // Check if exists
  try {
    const { execSync } = require('child_process');
    const result = execSync(
      `sqlite3 "${DB_PATH}" "SELECT id FROM o_project WHERE id = ${projectId}"`,
    ).toString().trim();
    if (result) {
      console.log(`⏭️  Project already exists: id=${projectId} name="${name}", skipping`);
      return;
    }

    const now = Date.now();
    const escapedName = name.replace(/'/g, "''");
    const escapedIntro = intro.replace(/'/g, "''");
    const escapedArtStyle = artStyle.replace(/'/g, "''");

    execSync(
      `sqlite3 "${DB_PATH}" "INSERT INTO o_project (id, name, intro, type, artStyle, mode, projectType, createTime, userId) VALUES (${projectId}, '${escapedName}', '${escapedIntro}', '${projectType}', '${escapedArtStyle}', '${mode}', 'short', ${now}, 1)"`,
    );
    console.log(`✅ Project created: id=${projectId} name="${name}"`);
  } catch (err) {
    console.error(`Failed to init project: ${err.message}`);
    process.exit(1);
  }
}

// ─── Arg parsing ──────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith('--')) {
        args[key] = val;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function parseRequired(args, required) {
  const missing = required.filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Missing required args: --${missing.join(' --')}`);
    process.exit(1);
  }
  return args;
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
    console.error(`Usage: sync-canvas.js <command> [options]
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
    process.exit(1);
  }

  const args = parseArgs(rest);

  try {
    await COMMANDS[cmd](args);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
