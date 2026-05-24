// Git Stage Manager — 阶段级版本管理，为 AIGC 管线每个环节提供 checkpoint/rollback

import { execFile } from 'node:child_process';
import { readdir, stat, writeFile, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

// ─── Stage Definitions ────────────────────────────────────

const STAGE_REGISTRY = {
  requirement:    { label: '需求确认',     glob: ['requirement.json', 'brief.md', 'project-config.json'] },
  'art-direction':{ label: '美术方向',     glob: ['art_direction.json', 'mood_board.png', 'color_palette.json', 'style_ref.png'] },
  character:      { label: '角色设计',     glob: ['characters.json', 'assets/characters/'] },
  scenario:       { label: '剧本编写',     glob: ['scenario.json', 'story_bible.json'] },
  scene:          { label: '场景图生成',   glob: ['assets/scenes/', 'scene_design.json'] },
  sketch:         { label: '线稿生成',     glob: ['assets/sketches/'] },
  render:         { label: '基于线稿渲染', glob: ['assets/scenes/'] },
  storyboard:     { label: '分镜板',       glob: ['storyboard.json', 'shots.json', 'shot_list.json'] },
  camera:         { label: '视频生成',     glob: ['video_tasks.json', 'output/', 'rough_cut.mp4'] },
  delivery:       { label: '后期合成',     glob: ['final.mp4', 'qc_report.json'] },
  review:         { label: '审核修改',     glob: ['*.json'] },
};

const STAGE_ORDER = Object.keys(STAGE_REGISTRY);

// ─── Helpers ──────────────────────────────────────────────

function git(workdir, ...args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', workdir, ...args], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(`git failed: ${stderr || err.message}`));
      resolve(stdout.trim());
    });
  });
}

async function expandGlob(workdir, patterns) {
  const files = [];
  for (const p of patterns) {
    // Simple glob: support * wildcard and trailing /
    if (p.endsWith('/')) {
      try {
        const entries = await readdir(join(workdir, p), { recursive: true, withFileTypes: true });
        for (const e of entries) {
          if (e.isFile()) files.push(join(p, e.name));
        }
      } catch { /* dir may not exist */ }
    } else if (p.includes('*')) {
      const dir = workdir;
      const regex = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && regex.test(e.name)) files.push(e.name);
        }
      } catch { /* ignore */ }
    } else {
      try { await stat(join(workdir, p)); files.push(p); } catch { /* not exist */ }
    }
  }
  return files;
}

// ─── GitStageManager ──────────────────────────────────────

export class GitStageManager {
  /**
   * @param {string} workdir — 项目工作目录（episode 或项目根）
   */
  constructor(workdir) {
    this.workdir = workdir;
    this.metaFile = join(workdir, '.stage-meta.json');
  }

  // ── Init ────────────────────────────────────────────────

  async init() {
    // Ensure git repo
    try { await git(this.workdir, 'rev-parse', '--git-dir'); } catch {
      await git(this.workdir, 'init');
      console.log(`[git-stage] Initialized git repo at ${this.workdir}`);
    }
    // Ensure .gitignore
    const gitignore = join(this.workdir, '.gitignore');
    try { await readFile(gitignore); } catch {
      await writeFile(gitignore, [
        '.stage-meta.json',
        'node_modules/',
        '.DS_Store',
        '*.tmp',
        '*.log',
        '__pycache__/',
      ].join('\n') + '\n');
    }
    return this;
  }

  // ── Checkpoint ──────────────────────────────────────────

  /**
   * 阶段完成后调用，自动 git add + commit
   * @param {string} stageName — 阶段名（scenario/character/art-direction/...）
   * @param {object} [metadata] — 可选元数据
   * @returns {{ success: boolean, commitHash: string, stageName: string, filesCount: number, error?: string }}
   */
  async checkpoint(stageName, metadata = {}) {
    const stage = STAGE_REGISTRY[stageName];
    if (!stage) {
      return { success: false, stageName, commitHash: '', filesCount: 0, error: `Unknown stage: ${stageName}` };
    }

    try {
      // Collect files
      const files = metadata.files || await expandGlob(this.workdir, stage.glob);
      if (files.length === 0 && !metadata.force) {
        return { success: true, stageName, commitHash: '', filesCount: 0, error: 'No files to commit (skipped)' };
      }

      // Add to git
      if (files.length > 0) {
        const addArgs = ['add', ...files];
        await git(this.workdir, ...addArgs);
      }

      // Commit
      const desc = metadata.description || stage.label;
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const msg = `[stage] ${stageName} — ${desc} (${ts})`;
      const commitOutput = await git(this.workdir, 'commit', '-m', msg, '--allow-empty');
      const commitHash = (await git(this.workdir, 'rev-parse', 'HEAD')).slice(0, 8);

      // Update meta
      await this.#updateMeta(stageName, {
        label: stage.label,
        commitHash,
        timestamp: new Date().toISOString(),
        files,
        metrics: metadata.metrics || {},
        description: desc,
      });

      return { success: true, commitHash, stageName, filesCount: files.length };
    } catch (err) {
      return { success: false, stageName, commitHash: '', filesCount: 0, error: err.message };
    }
  }

  // ── Log ─────────────────────────────────────────────────

  /**
   * 查看所有阶段提交历史
   * @returns {{ stageName: string, label: string, commitHash: string, timestamp: string, metrics: object }[]}
   */
  async log() {
    const meta = await this.#loadMeta();
    if (!meta?.stages?.length) {
      // Fallback: parse from git log
      try {
        const log = await git(this.workdir, 'log', '--oneline', '--grep=\\[stage\\]');
        if (!log) return [];
        return log.split('\n').map(line => {
          const match = line.match(/^(\w+)\s+\[stage\]\s+(\S+)\s+[—\-]\s+(.+)$/);
          if (!match) return null;
          const stage = STAGE_REGISTRY[match[2]];
          return {
            commitHash: match[1],
            stageName: match[2],
            label: stage?.label || match[2],
            description: match[3],
          };
        }).filter(Boolean);
      } catch {
        return [];
      }
    }
    return meta.stages;
  }

  // ── Rollback ────────────────────────────────────────────

  /**
   * 回滚到指定阶段
   * @param {string} targetStage — 目标阶段名
   * @returns {{ success: boolean, commitHash: string, error?: string }}
   */
  async rollback(targetStage) {
    const history = await this.log();
    const target = history.find(s => s.stageName === targetStage);
    if (!target) {
      return { success: false, commitHash: '', error: `Stage "${targetStage}" not found in history` };
    }

    try {
      await git(this.workdir, 'reset', '--hard', target.commitHash);
      return { success: true, commitHash: target.commitHash };
    } catch (err) {
      return { success: false, commitHash: '', error: err.message };
    }
  }

  // ── Diff ────────────────────────────────────────────────

  /**
   * 比较两个阶段的文件差异
   * @param {string} stageA — 起始阶段
   * @param {string} stageB — 目标阶段
   * @returns {{ added: string[], modified: string[], deleted: string[], diff: string }}
   */
  async diff(stageA, stageB) {
    const history = await this.log();
    const a = history.find(s => s.stageName === stageA);
    const b = history.find(s => s.stageName === stageB);
    if (!a || !b) {
      const missing = !a ? stageA : stageB;
      return { added: [], modified: [], deleted: [], diff: '', error: `Stage "${missing}" not found` };
    }

    try {
      const diffOutput = await git(this.workdir, 'diff', `${a.commitHash}..${b.commitHash}`, '--stat');
      const nameDiff = await git(this.workdir, 'diff', `${a.commitHash}..${b.commitHash}`, '--name-status');
      const added = [], modified = [], deleted = [];
      for (const line of nameDiff.split('\n')) {
        if (!line.trim()) continue;
        const [status, ...nameParts] = line.split('\t');
        const name = nameParts.join('\t');
        if (status === 'A') added.push(name);
        else if (status === 'D') deleted.push(name);
        else modified.push(name);
      }
      return { added, modified, deleted, diff: diffOutput };
    } catch (err) {
      return { added: [], modified: [], deleted: [], diff: '', error: err.message };
    }
  }

  // ── Current Stage ───────────────────────────────────────

  /**
   * 获取当前最新阶段
   * @returns {{ stageName: string, label: string, commitHash: string } | null}
   */
  async getCurrentStage() {
    const history = await this.log();
    return history[history.length - 1] || null;
  }

  // ── Stage Info ──────────────────────────────────────────

  /** 获取所有已注册的阶段定义 */
  static getStages() {
    return STAGE_REGISTRY;
  }

  /** 获取阶段执行顺序 */
  static getStageOrder() {
    return STAGE_ORDER;
  }

  // ── Private ─────────────────────────────────────────────

  async #loadMeta() {
    try {
      const raw = await readFile(this.metaFile, 'utf-8');
      return JSON.parse(raw);
    } catch { return null; }
  }

  async #updateMeta(stageName, info) {
    const meta = await this.#loadMeta() || { episodeId: '', stages: [] };
    meta.stages = meta.stages.filter(s => s.stageName !== stageName);
    meta.stages.push({ stageName, ...info });
    await writeFile(this.metaFile, JSON.stringify(meta, null, 2));
  }
}

// ─── CLI ──────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const workdir = args.find(a => !a.startsWith('-') && a !== command) || process.cwd();

  if (!command) {
    console.log('Usage: git-stage <log|rollback|diff|init> [workdir] [options]');
    console.log('');
    console.log('Commands:');
    console.log('  init [workdir]                  Initialize git repo + .gitignore');
    console.log('  log <workdir>                   Show stage history');
    console.log('  rollback <workdir> <stage>      Rollback to a stage');
    console.log('  diff <workdir> <stageA> <stageB> Compare two stages');
    console.log('  stages                          List registered stages');
    process.exit(0);
  }

  const mgr = new GitStageManager(workdir);

  switch (command) {
    case 'init':
      await mgr.init();
      console.log('✅ Git stage manager initialized');
      break;

    case 'log': {
      const history = await mgr.log();
      if (!history.length) { console.log('No stage commits found.'); break; }
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`  Stage History (${history.length} stages)`);
      console.log(`${'─'.repeat(60)}`);
      for (const s of history) {
        console.log(`  ${s.commitHash?.slice(0, 7) || '--------'}  ${s.stageName.padEnd(18)} ${s.label || ''}`);
        if (s.timestamp) console.log(`  ${''.padEnd(29)} ${s.timestamp}`);
        if (s.metrics && Object.keys(s.metrics).length) {
          console.log(`  ${''.padEnd(29)} 📊 ${JSON.stringify(s.metrics)}`);
        }
      }
      console.log(`${'─'.repeat(60)}\n`);
      break;
    }

    case 'rollback': {
      const target = args[2];
      if (!target) { console.error('Usage: git-stage rollback <workdir> <stage>'); process.exit(1); }
      const result = await mgr.rollback(target);
      if (result.success) console.log(`✅ Rolled back to "${target}" (${result.commitHash.slice(0, 7)})`);
      else console.error(`❌ ${result.error}`);
      break;
    }

    case 'diff': {
      const stageA = args[2], stageB = args[3];
      if (!stageA || !stageB) { console.error('Usage: git-stage diff <workdir> <stageA> <stageB>'); process.exit(1); }
      const result = await mgr.diff(stageA, stageB);
      if (result.error) { console.error(`❌ ${result.error}`); break; }
      console.log(`\n  📊 Diff: ${stageA} → ${stageB}\n`);
      if (result.added.length) console.log(`  + Added (${result.added.length}):    ${result.added.join(', ')}`);
      if (result.modified.length) console.log(`  ~ Modified (${result.modified.length}): ${result.modified.join(', ')}`);
      if (result.deleted.length) console.log(`  - Deleted (${result.deleted.length}):  ${result.deleted.join(', ')}`);
      if (!result.added.length && !result.modified.length && !result.deleted.length) console.log('  (no changes)');
      console.log(`\n${result.diff}\n`);
      break;
    }

    case 'checkpoint': {
      const stage = args[2];
      if (!stage) { console.error('Usage: git-stage checkpoint <workdir> <stageName>'); process.exit(1); }
      const result = await mgr.checkpoint(stage);
      if (result.success) console.log(`✅ Stage "${stage}" checkpointed (${result.filesCount} files, ${result.commitHash?.slice(0,7) || 'N/A'})`);
      else console.log(`⚠️  ${result.error || 'Skipped'}`);
      break;
    }

    case 'current': {
      const cur = await mgr.getCurrentStage();
      if (cur) console.log(`📍 Current: ${cur.stageName} — ${cur.label} (${cur.commitHash?.slice(0,7)})`);
      else console.log('No stages recorded.');
      break;
    }

    case 'stages':
      console.log('\n  Registered Stages (execution order):\n');
      for (const name of STAGE_ORDER) {
        const s = STAGE_REGISTRY[name];
        console.log(`  ${name.padEnd(20)} ${s.label}  [${s.glob.join(', ')}]`);
      }
      console.log('');
      break;

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

// Run as CLI
const isMainModule = process.argv[1]?.endsWith('git-stage-manager.js');
if (isMainModule) main();
