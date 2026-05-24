/**
 * kais-review — Canvas 交互式审查系统
 * ES Module
 *
 * 为管线中涉及图像的阶段生成多方案 Canvas 审查页，
 * 用户在浏览器中对比、打分、写意见，提交后结构化回传。
 *
 * 使用方式：
 * 1. 生成多个候选方案（图片）
 * 2. 调用 generateReviewPage() 生成 HTML
 * 3. 用 canvas 工具展示给用户
 * 4. 用户在浏览器中审核并提交
 * 5. 通过 callback 或 poll 获取审核结果
 */

import { writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify((await import('node:child_process')).execFile);

// ─── 审查数据结构 ──────────────────────────────────

/**
 * 创建审查会话
 * @param {object} options
 * @param {string} options.phase - 阶段标识
 * @param {string} options.title - 审查标题
 * @param {string} options.description - 审查说明
 * @param {string} options.selectMode - 选择模式 'single'(单选) | 'multi'(多选) | 'rank'(排序)
 * @param {number} options.minSelect - 最少选几个（multi/rank 模式）
 * @param {number} options.maxSelect - 最多选几个
 * @param {boolean} options.enableScoring - 是否启用评分
 * @param {boolean} options.enableFeedback - 是否启用文字反馈
 * @param {number} options.timeoutSeconds - （已废弃，审核无超时，必须人工确认）
 * @returns {object} 审查会话
 */
export function createReviewSession(options = {}) {
  const id = `review_${Date.now()}_${randomUUID().slice(0, 8)}`;
  return {
    id,
    phase: options.phase || 'unknown',
    title: options.title || '审核',
    description: options.description || '请审核以下方案',
    selectMode: options.selectMode || 'single',
    minSelect: options.minSelect || 1,
    maxSelect: options.maxSelect || 1,
    enableScoring: options.enableScoring !== false,
    enableFeedback: options.enableFeedback !== false,
    items: [],
    createdAt: new Date().toISOString(),
    status: 'pending', // pending | submitted
    result: null,
  };
}

/**
 * 添加审核项（图片候选方案）
 * @param {object} session - 审查会话
 * @param {object} item
 * @param {string} item.id - 候选方案 ID
 * @param {string} item.label - 显示名称
 * @param {string} item.imagePath - 图片本地路径（会被 base64 内嵌）
 * @param {string} [item.description] - 方案描述
 * @param {object} [item.metadata] - 附加数据
 */
export function addReviewItem(session, item) {
  session.items.push({
    id: item.id || `item_${session.items.length + 1}`,
    label: item.label || `方案 ${session.items.length + 1}`,
    imagePath: item.imagePath,
    description: item.description || '',
    metadata: item.metadata || {},
  });
}

/**
 * 批量添加审核项
 */
export function addReviewItems(session, items) {
  for (const item of items) addReviewItem(session, item);
}

// ─── HTML 生成 ────────────────────────────────────────

/**
 * 生成 Canvas 审查 HTML 页面
 * @param {object} session - 审查会话
 * @param {object} options
 * @param {string} options.outputDir - HTML 输出目录
 * @param {string} [options.callbackUrl] - 提交回调 URL
 * @returns {Promise<string>} HTML 文件路径
 */
export async function generateReviewPage(session, options = {}) {
  const { outputDir = '/tmp/kais-reviews', callbackUrl } = options;
  await mkdir(outputDir, { recursive: true });

  // 将所有图片转为 base64
  const itemsWithBase64 = [];
  for (const item of session.items) {
    let base64 = '';
    if (item.imagePath) {
      try {
        const data = await readFile(item.imagePath);
        base64 = `data:image/${getImageMime(item.imagePath)};base64,${data.toString('base64')}`;
      } catch (e) {
        console.warn(`[kais-review] 图片读取失败: ${item.imagePath}`);
        base64 = '';
      }
    }
    itemsWithBase64.push({ ...item, base64 });
  }

  const html = buildReviewHTML(session, itemsWithBase64, callbackUrl);
  const filePath = join(outputDir, `${session.id}.html`);
  await writeFile(filePath, html);

  return filePath;
}

function getImageMime(filePath) {
  const ext = (filePath || '').split('.').pop()?.toLowerCase();
  const mimeMap = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif' };
  return mimeMap[ext] || 'jpeg';
}

function buildReviewHTML(session, items, callbackUrl) {
  const isMulti = session.selectMode === 'multi';
  const isRank = session.selectMode === 'rank';
  const canMulti = isMulti || isRank;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${session.title} — 审核</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, 'SF Pro Display', 'PingFang SC', sans-serif; background: #0d0d12; color: #e0e0e0; min-height: 100vh; padding-bottom: 80px; }

.header { position: sticky; top: 0; z-index: 100; background: rgba(13,13,18,0.95); backdrop-filter: blur(20px); border-bottom: 1px solid #2d2d4a; padding: 20px 32px; display: flex; justify-content: space-between; align-items: flex-start; }
.header h1 { font-size: 20px; color: #fff; margin-bottom: 4px; }
.header .phase { font-size: 12px; color: #888; }
.header .desc { font-size: 13px; color: #aaa; margin-top: 4px; }


.hint { background: rgba(108,92,231,0.1); border: 1px solid rgba(108,92,231,0.3); border-radius: 8px; padding: 12px 20px; margin: 16px 32px; font-size: 13px; color: #a29bfe; }
.hint strong { color: #fff; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; padding: 16px 32px; }

.card {
  background: #1a1a2e; border: 2px solid #2d2d4a; border-radius: 12px;
  overflow: hidden; transition: border-color 0.2s, box-shadow 0.2s; position: relative;
}
.card:hover { border-color: #6c5ce7; }
.card.selected { border-color: #00b894; box-shadow: 0 0 20px rgba(0,184,148,0.2); }
.card.rejected { border-color: #ff6b6b; opacity: 0.4; }

.card-badge {
  position: absolute; top: 12px; left: 12px; z-index: 10;
  width: 32px; height: 32px; border-radius: 50%; border: 2px solid #555;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
  transition: all 0.2s; color: #888;
}
.card.selected .card-badge { border-color: #00b894; background: #00b894; color: #fff; }
.card.rejected .card-badge { border-color: #ff6b6b; background: #ff6b6b; color: #fff; }

.card-rank {
  position: absolute; top: 12px; right: 12px; z-index: 10;
  background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
  border: 1px solid #444; border-radius: 20px; padding: 2px 10px;
  font-size: 12px; color: #fdcb6e; font-weight: 700;
}

.card-img { width: 100%; aspect-ratio: 16/10; object-fit: cover; display: block; background: #111; cursor: pointer; }
.card-img-placeholder { width: 100%; aspect-ratio: 16/10; display: flex; align-items: center; justify-content: center; background: #111; color: #444; font-size: 13px; }

.card-body { padding: 12px 16px; }
.card-label { font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 4px; }
.card-desc { font-size: 12px; color: #888; line-height: 1.5; margin-bottom: 10px; }

/* 评分区域 */
.card-score-section { margin-bottom: 10px; }
.score-row { display: flex; align-items: center; gap: 8px; }
.score-label { font-size: 11px; color: #888; min-width: 24px; }
.score-slider {
  -webkit-appearance: none; appearance: none;
  flex: 1; height: 6px; background: #2d2d4a; border-radius: 3px; outline: none;
}
.score-slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%;
  background: #6c5ce7; cursor: pointer; border: 2px solid #fff;
  box-shadow: 0 0 6px rgba(108,92,231,0.4);
}
.score-slider::-moz-range-thumb {
  width: 18px; height: 18px; border-radius: 50%;
  background: #6c5ce7; cursor: pointer; border: 2px solid #fff;
}
.score-val { font-size: 14px; font-weight: 700; color: #a29bfe; min-width: 24px; text-align: center; }
.score-val.active { color: #00b894; }

/* 反馈 */
.card-feedback { margin-bottom: 10px; }
.card-feedback textarea {
  width: 100%; background: #111; border: 1px solid #2d2d4a; border-radius: 8px;
  color: #e0e0e0; font-size: 12px; padding: 8px 10px; resize: vertical;
  font-family: inherit; line-height: 1.5;
}
.card-feedback textarea:focus { outline: none; border-color: #6c5ce7; }
.card-feedback textarea::placeholder { color: #555; }

/* 操作按钮 */
.card-actions { display: flex; gap: 8px; }
.card-actions button {
  flex: 1; padding: 8px 0; border: 1px solid #2d2d4a; border-radius: 8px;
  background: transparent; color: #aaa; font-size: 13px; cursor: pointer; transition: all 0.2s;
  font-weight: 500;
}
.card-actions button:hover { border-color: #6c5ce7; color: #fff; background: rgba(108,92,231,0.1); }
.card-actions .btn-approve.active { border-color: #00b894; color: #00b894; background: rgba(0,184,148,0.15); }
.card-actions .btn-reject.active { border-color: #ff6b6b; color: #ff6b6b; background: rgba(255,107,107,0.15); }

/* 底部栏 */
.footer {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
  background: rgba(13,13,18,0.98); backdrop-filter: blur(20px);
  border-top: 1px solid #2d2d4a; padding: 14px 32px;
  display: flex; gap: 12px; justify-content: center; align-items: center;
}
.footer-info { font-size: 12px; color: #666; white-space: nowrap; }
.footer button {
  padding: 10px 24px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
}
.btn-submit { background: #6c5ce7; color: #fff; }
.btn-submit:hover { background: #5a4bd6; transform: translateY(-1px); }
.btn-approve-all { background: #00b894; color: #fff; }
.btn-approve-all:hover { background: #00a381; transform: translateY(-1px); }
.btn-reject-all { background: transparent; color: #ff6b6b; border: 1px solid #ff6b6b !important; }
.btn-reject-all:hover { background: rgba(255,107,107,0.1); }
.btn-disabled { opacity: 0.3; cursor: not-allowed !important; pointer-events: none !important; transform: none !important; }

/* Toast */
.toast {
  position: fixed; top: 20px; left: 50%; transform: translateX(-50%) translateY(-20px);
  background: #00b894; color: #fff; padding: 12px 28px; border-radius: 10px;
  font-size: 14px; font-weight: 600; z-index: 2000; opacity: 0;
  transition: opacity 0.3s, transform 0.3s; pointer-events: none;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.toast.error { background: #ff6b6b; }

/* 结果弹窗 */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1500;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none; transition: opacity 0.3s;
}
.modal-overlay.show { opacity: 1; pointer-events: auto; }
.modal {
  background: #1a1a2e; border: 1px solid #2d2d4a; border-radius: 16px;
  padding: 24px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
}
.modal h2 { color: #fff; margin-bottom: 16px; font-size: 18px; }
.modal pre { background: #111; border-radius: 8px; padding: 12px; font-size: 12px; color: #aaa; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
.modal .close-btn { margin-top: 16px; padding: 8px 20px; background: #6c5ce7; color: #fff; border: none; border-radius: 8px; cursor: pointer; }

/* 提交确认页 */
.submitted-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,0.85); backdrop-filter: blur(10px);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none; transition: opacity 0.4s;
}
.submitted-overlay.show { opacity: 1; pointer-events: auto; }
.submitted-card {
  background: #1a1a2e; border: 1px solid #2d2d4a; border-radius: 20px;
  padding: 40px; max-width: 480px; width: 90%; text-align: center;
  transform: scale(0.9); transition: transform 0.4s;
}
.submitted-overlay.show .submitted-card { transform: scale(1); }
.submitted-icon { font-size: 56px; margin-bottom: 16px; }
.submitted-card h2 { color: #fff; font-size: 22px; margin-bottom: 8px; }
.submitted-summary { color: #aaa; font-size: 14px; margin-bottom: 20px; line-height: 1.6; }
.submitted-details {
  background: #111; border-radius: 12px; padding: 16px; text-align: left;
  margin-bottom: 24px; font-size: 13px; color: #ccc; line-height: 1.8;
}
.submitted-details .detail-row { display: flex; justify-content: space-between; border-bottom: 1px solid #2d2d4a; padding: 4px 0; }
.submitted-details .detail-row:last-child { border-bottom: none; }
.submitted-details .detail-label { color: #888; }
.submitted-details .detail-value { color: #00b894; font-weight: 600; }
.submitted-details .detail-value.rejected { color: #ff6b6b; }
.btn-primary { padding: 12px 32px; background: #6c5ce7; color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
.btn-primary:hover { background: #5a4bd6; transform: translateY(-1px); }
.btn-reset { background: transparent; color: #aaa; border: 1px solid #2d2d4a !important; }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>${session.title}</h1>
    <div class="phase">${session.phase}</div>
    <div class="desc">${session.description}</div>
  </div>
</div>

${canMulti
  ? `<div class="hint">💡 ${isRank ? '按偏好排序：点击排号设置顺序' : '可多选：点击👍选中，再次点击取消'} · ${session.enableScoring ? '拖动滑块评分' : ''} · ${session.enableFeedback ? '可写修改意见' : ''}</div>`
  : `<div class="hint">💡 点击 👍 选择方案，可评分并写修改意见</div>`
}

<div class="grid" id="grid">
${items.map((item, i) => `
  <div class="card" data-id="${item.id}">
    ${isRank ? `<div class="card-rank" id="rank-${item.id}">#${i + 1}</div>` : ''}
    ${item.base64
      ? `<img class="card-img" src="${item.base64}" alt="${item.label}" loading="lazy">`
      : `<div class="card-img-placeholder">🖼️ 无图片预览</div>`
    }
    <div class="card-body">
      <div class="card-label">${item.label}</div>
      ${item.description ? `<div class="card-desc">${item.description}</div>` : ''}
      ${session.enableScoring ? `
      <div class="card-score-section">
        <div class="score-row">
          <span class="score-label">评分</span>
          <input type="range" min="1" max="10" value="" class="score-slider" data-item="${item.id}"
            oninput="handleScore('${item.id}', this.value)" onclick="event.stopPropagation()">
          <span class="score-val" id="score-${item.id}">-</span>
        </div>
      </div>
      ` : ''}
      ${session.enableFeedback ? `
      <div class="card-feedback">
        <textarea placeholder="修改意见（可选）..." data-item="${item.id}" rows="2" onclick="event.stopPropagation()"></textarea>
      </div>
      ` : ''}
      <div class="card-actions">
        <button class="btn-approve" data-id="${item.id}" onclick="toggleSelect(event, '${item.id}')">👍 选择</button>
        <button class="btn-reject" data-id="${item.id}" onclick="toggleReject(event, '${item.id}')">👎 不选</button>
      </div>
    </div>
  </div>
`).join('\n')}
</div>

<div class="footer">
  <div class="footer-info" id="status">
    已选 <strong id="sel-count">0</strong> 项 · 拒选 <strong id="rej-count">0</strong> 项
  </div>
  <button class="btn-reset" onclick="resetAll()">🔄 重置</button>
  <button class="btn-reject-all" onclick="rejectAll()">❌ 全部重做</button>
  <button class="btn-submit btn-disabled" id="btn-submit" onclick="submitReview()">📝 提交审核</button>
  <button class="btn-approve-all btn-disabled" id="btn-approve-all" onclick="approveAll()">✅ 全部通过</button>
</div>

<!-- 提交成功确认页 -->
<div class="submitted-overlay" id="submitted-overlay">
  <div class="submitted-card">
    <div class="submitted-icon">✅</div>
    <h2>审核已提交</h2>
    <p class="submitted-summary" id="submitted-summary"></p>
    <div class="submitted-details" id="submitted-details"></div>
    <button class="btn-primary" onclick="resetAll()">🔄 重新审核</button>
  </div>
</div>

<script>
const ITEM_IDS = ${JSON.stringify(items.map(i => i.id))};

const CONFIG = {
  selectMode: '${session.selectMode}',
  minSelect: ${session.minSelect},
  maxSelect: ${session.maxSelect},
  enableScoring: ${session.enableScoring},
  enableFeedback: ${session.enableFeedback},
  sessionId: '${session.id}',
  callbackUrl: '${callbackUrl || ''}',
  isMulti: ${canMulti},
  isRank: ${isRank},
};

const state = {
  selected: new Set(),
  rejected: new Set(),
  scores: {},
};

// ── 计时器 ──
// ── 选择/拒选 ──
function toggleSelect(e, id) {
  e.stopPropagation();
  state.rejected.delete(id);
  if (!CONFIG.isMulti) {
    state.selected.clear();
    state.selected.add(id);
  } else {
    if (state.selected.has(id)) {
      state.selected.delete(id);
    } else {
      if (state.selected.size >= CONFIG.maxSelect) {
        showToast('最多选择 ' + CONFIG.maxSelect + ' 项', true);
        return;
      }
      state.selected.add(id);
    }
  }
  refreshUI();
}

function toggleReject(e, id) {
  e.stopPropagation();
  state.selected.delete(id);
  if (state.rejected.has(id)) {
    state.rejected.delete(id);
  } else {
    state.rejected.add(id);
  }
  refreshUI();
}

function approveAll() {
  state.selected.clear();
  state.rejected.clear();
  ITEM_IDS.forEach(id => state.selected.add(id));
  refreshUI();
}

function rejectAll() {
  state.selected.clear();
  state.rejected.clear();
  ITEM_IDS.forEach(id => state.rejected.add(id));
  refreshUI();
}

// ── 评分 ──
function handleScore(id, val) {
  val = parseInt(val);
  state.scores[id] = val;
  const num = document.getElementById('score-' + id);
  num.textContent = val;
  num.classList.add('active');
}

// ── UI 刷新 ──
function refreshUI() {
  document.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.id;
    card.classList.remove('selected', 'rejected');
    if (state.selected.has(id)) card.classList.add('selected');
    if (state.rejected.has(id)) card.classList.add('rejected');

    // 更新按钮状态
    const approveBtn = card.querySelector('.btn-approve');
    const rejectBtn = card.querySelector('.btn-reject');
    approveBtn.classList.toggle('active', state.selected.has(id));
    rejectBtn.classList.toggle('active', state.rejected.has(id));
    approveBtn.textContent = state.selected.has(id) ? '✅ 已选' : '👍 选择';
    rejectBtn.textContent = state.rejected.has(id) ? '🚫 已拒' : '👎 不选';
  });

  // 更新底部状态
  const selCount = state.selected.size;
  const rejCount = state.rejected.size;
  document.getElementById('sel-count').textContent = selCount;
  document.getElementById('rej-count').textContent = rejCount;

  const canSubmit = selCount >= CONFIG.minSelect || rejCount > 0;
  document.getElementById('btn-submit').classList.toggle('btn-disabled', !canSubmit);
  document.getElementById('btn-approve-all').classList.toggle('btn-disabled', !canSubmit);
}

// ── 提交 ──
function submitReview() {
  if (state.selected.size < CONFIG.minSelect && state.rejected.size === 0) {
    showToast('请至少选择 ' + CONFIG.minSelect + ' 个方案', true);
    return;
  }

  const feedback = {};
  document.querySelectorAll('.card-feedback textarea').forEach(el => {
    if (el.value.trim()) feedback[el.dataset.item] = el.value.trim();
  });

  const selCount = state.selected.size;
  const rejCount = state.rejected.size;
  const result = {
    session_id: CONFIG.sessionId,
    phase: '${session.phase}',
    timestamp: new Date().toISOString(),
    action: selCount > 0 && rejCount === 0 ? 'approved' : rejCount > 0 && selCount === 0 ? 'rejected' : 'mixed',
    selected: Array.from(state.selected),
    rejected: Array.from(state.rejected),
    scores: { ...state.scores },
    feedback: feedback,
  };

  // 发送到服务器
  fetch('/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  }).catch(() => {}); // 静默失败，不阻塞 UI

  // 显示提交确认页
  showSubmittedPage(result);
}

function showSubmittedPage(result) {
  const overlay = document.getElementById('submitted-overlay');
  const summary = document.getElementById('submitted-summary');
  const details = document.getElementById('submitted-details');

  if (result.action === 'approved') {
    summary.textContent = '你已通过所有方案的选择。';
  } else if (result.action === 'rejected') {
    summary.textContent = '你已拒绝所有方案，将重新生成。';
  } else {
    summary.textContent = '你已做出部分选择，结果如下：';
  }

  let detailHTML = '';
  if (result.selected.length > 0) {
    detailHTML += '<div class="detail-row"><span class="detail-label">✅ 已选方案</span><span class="detail-value">' + result.selected.length + ' 项</span></div>';
  }
  if (result.rejected.length > 0) {
    detailHTML += '<div class="detail-row"><span class="detail-label">❌ 拒选方案</span><span class="detail-value rejected">' + result.rejected.length + ' 项</span></div>';
  }
  const scoredCount = Object.keys(result.scores).length;
  if (scoredCount > 0) {
    detailHTML += '<div class="detail-row"><span class="detail-label">⭐ 已评分</span><span class="detail-value">' + scoredCount + ' 项</span></div>';
  }
  const feedbackCount = Object.keys(result.feedback).length;
  if (feedbackCount > 0) {
    detailHTML += '<div class="detail-row"><span class="detail-label">📝 反馈意见</span><span class="detail-value">' + feedbackCount + ' 条</span></div>';
  }
  details.innerHTML = detailHTML;

  overlay.classList.add('show');
}

function resetAll() {
  state.selected.clear();
  state.rejected.clear();
  state.scores = {};

  // 清空所有滑块
  document.querySelectorAll('.score-slider').forEach(s => s.value = '');
  document.querySelectorAll('.score-val').forEach(v => { v.textContent = '-'; v.classList.remove('active'); });

  // 清空所有文本框
  document.querySelectorAll('.card-feedback textarea').forEach(t => t.value = '');

  // 关闭确认页
  document.getElementById('submitted-overlay').classList.remove('show');

  // 重新启用按钮
  document.getElementById('btn-submit').classList.remove('btn-disabled');
  document.getElementById('btn-approve-all').classList.remove('btn-disabled');

  refreshUI();
  showToast('🔄 已重置，请重新审核');
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.className = 'toast', 3000);
}

// 初始化
refreshUI();
</script>
</body>
</html>`;
}

// ─── 结果解析 ────────────────────────────────────────

/**
 * 解析审核结果（从 callback 或手动输入）
 */
export function parseReviewResult(result) {
  return {
    selected: result.selected || [],
    rejected: result.rejected || [],
    scores: result.scores || {},
    feedback: result.feedback || {},
    action: result.action || 'approved',
  };
}

// ─── 快捷：为管线阶段创建标准审查 ─────────────────

/**
 * 创建标准多方案审查（5选1）
 * @param {string} phase - 阶段
 * @param {string} title - 标题
 * @param {Array<{id: string, label: string, imagePath: string, description?: string}>} candidates - 候选方案
 * @param {object} options - 可选配置
 * @returns {Promise<{session: object, htmlPath: string}>}
 */

export async function createStandardReview(phase, title, candidates, options = {}) {
  const session = createReviewSession({
    phase,
    title,
    description: options.description || `请选择最满意的${title.toLowerCase()}`,
    selectMode: options.selectMode || 'single',
    minSelect: options.minSelect || 1,
    maxSelect: options.maxSelect || 1,
    enableScoring: options.enableScoring !== false,
    enableFeedback: options.enableFeedback !== false,
    timeoutSeconds: options.timeoutSeconds || 3600,
  });
  addReviewItems(session, candidates);
  const htmlPath = await generateReviewPage(session, {
    outputDir: options.outputDir,
    callbackUrl: options.callbackUrl,
  });
  return { session, htmlPath };
}


