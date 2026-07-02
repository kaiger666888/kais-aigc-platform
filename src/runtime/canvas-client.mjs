/**
 * CanvasClient — kais-aigc-platform 无限画布客户端
 *
 * 封装对画布 API 的 HTTP 调用和 WebSocket 监听。
 * 与现有 ReviewPlatformClient 并行，新增 Canvas 通道。
 *
 * 纯 Node.js 环境（无浏览器 API），ESM 模块。
 * HTTP 使用原生 fetch + AbortSignal.timeout（零依赖）。
 * WS 使用 socket.io-client（需 npm install socket.io-client）。
 *
 * 设计参考:
 *   /home/kai/.openclaw/workspace/docs/infinite-canvas-gsd-r1-merged.md
 *   /home/kai/.openclaw/workspace/docs/gsd-r1-w2-movie-agent.md
 */

import { io } from 'socket.io-client';

/**
 * CanvasClient 自定义错误类
 */
export class CanvasClientError extends Error {
  constructor(message, { status, url, cause } = {}) {
    super(message);
    this.name = 'CanvasClientError';
    this.status = status || null;
    this.url = url || null;
    this.cause = cause || null;
  }
}

/**
 * 默认基础 URL — kais-aigc-platform
 */
const DEFAULT_BASE_URL = 'http://localhost:10588';

/**
 * 默认请求超时（15s）
 */
const DEFAULT_TIMEOUT = 15000;

/**
 * 支持的 WS 事件类型
 */
const SUPPORTED_EVENTS = new Set([
  'connect',
  'disconnect',
  'connect_error',
  'review:approved',
  'review:rejected',
  'node:created',
  'node:updated',
  'node:state',
  'branch:created',
]);

/**
 * CanvasClient — 画布客户端
 *
 * 用法:
 *   const client = new CanvasClient({
 *     baseUrl: 'http://localhost:10588',
 *     projectId: 123,
 *     episodesId: 456,
 *     pipelineId: 'pipe_xxx',
 *   });
 *   await client.loadCanvas();
 *   await client.addNodes([...]);
 *   client.connect();
 *   client.on('review:approved', (payload) => { ... });
 */
export class CanvasClient {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl='http://localhost:10588'] - 画布服务地址
   * @param {number} [options.projectId] - 项目 ID
   * @param {number} [options.episodesId] - 剧集 ID
   * @param {string} [options.pipelineId] - 管线 ID（用于 trace）
   * @param {number} [options.timeout=15000] - HTTP 请求超时（ms）
   * @param {string} [options.traceId] - 追踪 ID
   * @param {string} [options.apiPrefix='/api/canvas/v2'] - REST API 前缀（实际挂载路径）
   * @param {string} [options.legacyApiPrefix='/api/canvas'] - 兼容 v1 路径（review/approve|reject|score）
   */
  constructor({
    baseUrl = DEFAULT_BASE_URL,
    projectId,
    episodesId,
    pipelineId,
    timeout = DEFAULT_TIMEOUT,
    traceId = '',
    apiPrefix = '/api/canvas/v2',
    legacyApiPrefix = '/api/canvas',
  } = {}) {
    this._baseUrl = baseUrl.replace(/\/$/, '');
    this._projectId = projectId;
    this._episodesId = episodesId;
    this._pipelineId = pipelineId;
    this._timeout = timeout;
    this._traceId = traceId;
    this._apiPrefix = apiPrefix;
    this._legacyApiPrefix = legacyApiPrefix;

    /** @type {import('socket.io-client').Socket|null} */
    this._ws = null;
    this._wsConnected = false;
    this._wsReconnectCount = 0;

    /** @type {Map<string, Set<Function>>} — event → callback[] */
    this._listeners = new Map();

    /** @type {Map<string, Set<string>>} — nodeId → pipelineId/phaseId 反查（由调用方注册） */
    this._nodeIndex = new Map();
  }

  // ─── 配置 ──────────────────────────────────────

  /**
   * 更新 projectId/episodesId（用于多 pipeline 共享一个 client 的场景）
   */
  setContext({ projectId, episodesId, pipelineId } = {}) {
    if (projectId !== undefined) this._projectId = projectId;
    if (episodesId !== undefined) this._episodesId = episodesId;
    if (pipelineId !== undefined) this._pipelineId = pipelineId;
  }

  /**
   * 注册 nodeId → { pipelineId, phaseId } 映射，
   * 供 WS 事件回调查找对应的管线和 phase。
   * @param {string} nodeId
   * @param {{pipelineId: string, phaseId: string}} ctx
   */
  registerNode(nodeId, ctx) {
    if (!this._nodeIndex.has(nodeId)) {
      this._nodeIndex.set(nodeId, new Set());
    }
    this._nodeIndex.get(nodeId).add(`${ctx.pipelineId}::${ctx.phaseId}`);
  }

  /**
   * 反查 nodeId 对应的管线/phase
   * @param {string} nodeId
   * @returns {Array<{pipelineId: string, phaseId: string}>}
   */
  lookupNode(nodeId) {
    const entries = this._nodeIndex.get(nodeId);
    if (!entries) return [];
    return [...entries].map(s => {
      const [pipelineId, phaseId] = s.split('::');
      return { pipelineId, phaseId };
    });
  }

  // ─── HTTP 核心 ────────────────────────────────────

  /**
   * 统一 HTTP 请求方法
   * @param {string} path - 完整路径（含前缀）
   * @param {object} [body] - 请求体
   * @param {object} [options]
   * @param {string} [options.method='POST']
   * @returns {Promise<any>} 响应数据（已 unwrap data 字段）
   * @throws {CanvasClientError}
   */
  async _request(path, body, { method = 'POST' } = {}) {
    const url = `${this._baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this._traceId ? { 'X-Trace-Id': this._traceId } : {}),
    };
    const init = {
      method,
      headers,
      signal: AbortSignal.timeout(this._timeout),
    };
    if (body !== undefined && method !== 'GET') {
      init.body = JSON.stringify(body);
    }

    let resp;
    try {
      resp = await fetch(url, init);
    } catch (err) {
      throw new CanvasClientError(`Request failed: ${err.message}`, {
        url,
        cause: err,
      });
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new CanvasClientError(
        `HTTP ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ''}`,
        { status: resp.status, url },
      );
    }

    // 部分端点（如 review/approve）可能返回空 body
    const raw = await resp.text();
    if (!raw) return null;
    try {
      const json = JSON.parse(raw);
      // aigc-platform 返回 { code, msg, data } 格式 — unwrap
      if (json && typeof json === 'object' && 'data' in json && 'code' in json) {
        return json.data;
      }
      return json;
    } catch {
      return raw;
    }
  }

  /**
   * fail-open 调用包装：捕获错误并返回 degraded 标志，
   * 不影响主管线流程（仅记录警告日志）。
   * @param {Function} fn
   * @param {string} operation
   * @returns {Promise<{ok: boolean, data?: any, error?: string, degraded?: boolean}>}
   */
  async _failOpen(fn, operation) {
    try {
      const data = await fn();
      return { ok: true, data };
    } catch (err) {
      console.warn(`[CanvasClient] ${operation} 失败 (降级): ${err.message}`);
      return { ok: false, error: err.message, degraded: true };
    }
  }

  // ─── 画布图 CRUD ───────────────────────────────────

  /**
   * 加载画布图 FlowGraph
   * POST /api/canvas/v2/load-v2
   * @returns {Promise<object|null>} FlowGraph 或 null（不存在时）
   */
  async loadCanvas() {
    this._requireContext();
    return this._request(`${this._apiPrefix}/load-v2`, {
      projectId: this._projectId,
      episodesId: this._episodesId,
    });
  }

  /**
   * 保存画布图（全量覆盖）
   * POST /api/canvas/v2/save-v2
   * @param {object} graph - FlowGraph JSON
   */
  async saveCanvas(graph) {
    this._requireContext();
    if (!graph || typeof graph !== 'object') {
      throw new CanvasClientError('saveCanvas: graph 必须是对象');
    }
    return this._request(`${this._apiPrefix}/save-v2`, {
      projectId: this._projectId,
      episodesId: this._episodesId,
      graph,
    });
  }

  /**
   * 增量 merge：先 load 再 save（合并 nodes/edges/groups/variantGroups）
   * @param {object} updates
   * @param {Array} [updates.nodes] - 新增/更新节点
   * @param {Array} [updates.edges] - 新增连线（同 links）
   * @param {Array} [updates.links] - 新增连线（与 edges 等价）
   * @param {Array} [updates.groups] - 新增分组
   * @param {Array} [updates.variantGroups] - 新增变体组
   * @returns {Promise<object>} 合并后的 graph
   */
  async patchCanvas(updates = {}) {
    this._requireContext();
    const current = (await this.loadCanvas()) || this._emptyGraph();
    const merged = this._mergeGraph(current, updates);
    await this.saveCanvas(merged);
    return merged;
  }

  /**
   * 空图骨架
   */
  _emptyGraph() {
    return {
      nodes: [],
      edges: [],
      groups: [],
      variantGroups: [],
      branches: [],
    };
  }

  /**
   * 合并两个 graph（updates 优先，按 id 去重）
   */
  _mergeGraph(current, updates) {
    const merged = JSON.parse(JSON.stringify(current));
    const mergeList = (key) => {
      const items = updates[key] || updates[key === 'edges' ? 'links' : key];
      if (!Array.isArray(items)) return;
      if (!Array.isArray(merged[key])) merged[key] = [];
      const byId = new Map(merged[key].map(x => [x.id, x]));
      for (const item of items) {
        if (!item || !item.id) continue;
        byId.set(item.id, { ...byId.get(item.id), ...item });
      }
      merged[key] = [...byId.values()];
    };
    mergeList('nodes');
    mergeList('edges');
    mergeList('links');
    mergeList('groups');
    mergeList('variantGroups');
    mergeList('branches');
    return merged;
  }

  // ─── 节点操作 ─────────────────────────────────────

  /**
   * 节点类型 → (phaseIndex, phaseName) 推断表
   * 与 server v2/load-v2 的 PHASE_INDEX_MAP / PHASE_NAME_MAP 同步
   */
  static PHASE_INDEX_MAP = {
    script: 0, asset: 1, '3d': 1, storyboard: 2, video: 3, audio: 4,
    variant: 1, reference: 1, upscale: 3, face_restore: 3, suggestion: 0,
  };
  static PHASE_NAME_MAP = {
    script: '剧本', asset: '资产生成', '3d': '3D 空间', storyboard: '分镜',
    video: '视频生成', audio: '音频生成', variant: '变体生成', reference: '参考图',
    upscale: '超分处理', face_restore: '面部修复', suggestion: 'AI 建议',
  };

  /**
   * 给节点补齐 v2 服务端校验所需字段（branchId, phaseIndex, phaseName, size）
   * 不覆盖调用方已设置的值
   * @private
   */
  _normalizeNode(node) {
    const type = node.type || 'script';
    return {
      branchId: 'main',
      phaseIndex: CanvasClient.PHASE_INDEX_MAP[type] ?? 0,
      phaseName: CanvasClient.PHASE_NAME_MAP[type] ?? '未知',
      size: { width: 260, height: 180 },
      ...node,
    };
  }

  /**
   * 创建单个节点
   * POST /api/canvas/v2/nodes
   * @param {object} node - { id, type, position, size?, data, state, branchId?, phaseIndex?, phaseName?, reviewStatus? }
   */
  async addNode(node) {
    this._requireContext();
    if (!node?.id) throw new CanvasClientError('addNode: node.id 必填');

    try {
      return await this._request(`${this._apiPrefix}/nodes`, {
        projectId: this._projectId,
        episodesId: this._episodesId,
        node: this._normalizeNode(node),
      });
    } catch (err) {
      if (err.status === 404 || err.status === 405) {
        return this.patchCanvas({ nodes: [node] });
      }
      throw err;
    }
  }

  /**
   * 批量创建/更新节点（upsert）
   * PATCH /api/canvas/v2/nodes/batch
   * @param {Array<object>} nodes
   */
  async addNodes(nodes) {
    this._requireContext();
    if (!Array.isArray(nodes) || !nodes.length) {
      return { added: 0 };
    }

    const normalized = nodes.map((n) => this._normalizeNode(n));

    try {
      return await this._request(
        `${this._apiPrefix}/nodes/batch`,
        {
          projectId: this._projectId,
          episodesId: this._episodesId,
          nodes: normalized,
        },
        { method: 'PATCH' },
      );
    } catch (err) {
      if (err.status === 404 || err.status === 405) {
        return this.patchCanvas({ nodes });
      }
      throw err;
    }
  }

  /**
   * 更新节点（任意字段）
   * PATCH /api/canvas/v2/nodes/:nodeId — body: { updates: {...} }
   * @param {string} nodeId
   * @param {object} updates - 任意可合并字段
   */
  async updateNode(nodeId, updates) {
    this._requireContext();
    if (!nodeId) throw new CanvasClientError('updateNode: nodeId 必填');
    if (!updates || typeof updates !== 'object') {
      throw new CanvasClientError('updateNode: updates 必须是对象');
    }

    try {
      return await this._request(
        `${this._apiPrefix}/nodes/${encodeURIComponent(nodeId)}`,
        {
          projectId: this._projectId,
          episodesId: this._episodesId,
          updates,
        },
        { method: 'PATCH' },
      );
    } catch (err) {
      if (err.status === 404 || err.status === 405) {
        return this.patchCanvas({ nodes: [{ id: nodeId, ...updates }] });
      }
      throw err;
    }
  }

  /**
   * 更新节点状态（updateNode 的便捷封装）
   * @param {string} nodeId
   * @param {string} state - idle | pending | running | success | error | skipped
   * @param {number} [progress] - 0..1
   */
  async updateNodeState(nodeId, state, progress) {
    const updates = { state };
    if (typeof progress === 'number') updates.progress = progress;
    return this.updateNode(nodeId, updates);
  }

  // ─── 连线 ─────────────────────────────────────────

  /**
   * 创建连线
   * POST /api/canvas/v2/links
   * @param {object} link - { id, source, target, dataType, branchId?, ... }
   */
  async addLink(link) {
    this._requireContext();
    if (!link?.id) throw new CanvasClientError('addLink: link.id 必填');

    const normalized = { branchId: 'main', ...link };

    try {
      return await this._request(`${this._apiPrefix}/links`, {
        projectId: this._projectId,
        episodesId: this._episodesId,
        link: normalized,
      });
    } catch (err) {
      if (err.status === 404 || err.status === 405) {
        return this.patchCanvas({ edges: [normalized], links: [normalized] });
      }
      throw err;
    }
  }

  // ─── 分支 ─────────────────────────────────────────

  /**
   * 创建分支
   * POST /api/canvas/v2/branches
   * @param {object} branch - { id?, label, parentId?, parentNodeId?, forkReason? }
   *   兼容旧字段：name → label
   */
  async createBranch(branch) {
    this._requireContext();
    if (!branch) throw new CanvasClientError('createBranch: branch 必填');

    // 字段兼容：name → label
    const label = branch.label || branch.name;
    if (!label) throw new CanvasClientError('createBranch: branch.label 必填');

    const normalized = {
      ...branch,
      label,
      // status 不在 create schema 中，丢弃；调用方应使用 updateBranchStatus
      status: undefined,
    };

    try {
      return await this._request(`${this._apiPrefix}/branches`, {
        projectId: this._projectId,
        episodesId: this._episodesId,
        branch: normalized,
      });
    } catch (err) {
      if (err.status === 404 || err.status === 405) {
        return this.patchCanvas({ branches: [branch] });
      }
      throw err;
    }
  }

  /**
   * 更新分支
   * PATCH /api/canvas/v2/branches/:branchId — body: { updates: {...} }
   * @param {string} branchId
   * @param {object} updates - { label?, status?, forkReason?, metadata? }
   */
  async updateBranch(branchId, updates) {
    this._requireContext();
    if (!branchId) throw new CanvasClientError('updateBranch: branchId 必填');
    if (!updates || typeof updates !== 'object') {
      throw new CanvasClientError('updateBranch: updates 必须是对象');
    }

    try {
      return await this._request(
        `${this._apiPrefix}/branches/${encodeURIComponent(branchId)}`,
        {
          projectId: this._projectId,
          episodesId: this._episodesId,
          updates,
        },
        { method: 'PATCH' },
      );
    } catch (err) {
      if (err.status === 404 || err.status === 405) {
        return this.patchCanvas({ branches: [{ id: branchId, ...updates }] });
      }
      throw err;
    }
  }

  /**
   * 更新分支状态（updateBranch 的便捷封装）
   * @param {string} branchId
   * @param {string} status - draft | active | paused | completed | archived | rejected
   */
  async updateBranchStatus(branchId, status) {
    return this.updateBranch(branchId, { status });
  }

  // ─── 变体组 ───────────────────────────────────────

  /**
   * 创建变体组（同产出物的多个候选）
   * PATCH 通过更新 graph.variantGroups 实现
   * @param {object} group - { groupId, parentNodeId, variantNodeIds, winnerNodeId? }
   */
  async createVariantGroup(group) {
    this._requireContext();
    if (!group?.groupId) {
      throw new CanvasClientError('createVariantGroup: group.groupId 必填');
    }
    const normalized = { ...group, id: group.groupId };
    return this.patchCanvas({ variantGroups: [normalized] });
  }

  /**
   * 选择变体组的优胜者
   *
   * NOTE: 服务端目前没有 variant-groups/:id/winner 端点，
   *      始终走 patchCanvas（更新 variantGroups + 标记 winner 节点）。
   *      调用方建议同时调用 approveNode(winnerNodeId) 触发 review 流。
   *
   * @param {string} groupId
   * @param {string} winnerNodeId
   */
  async selectVariantWinner(groupId, winnerNodeId) {
    this._requireContext();
    if (!groupId || !winnerNodeId) {
      throw new CanvasClientError('selectVariantWinner: groupId 和 winnerNodeId 必填');
    }

    return this.patchCanvas({
      variantGroups: [
        { id: groupId, groupId, winnerNodeId },
      ],
      nodes: [{ id: winnerNodeId, isWinner: true }],
    });
  }

  // ─── 审核操作 ─────────────────────────────────────

  /**
   * 审核通过节点
   * POST /api/canvas/review/approve
   * @param {string} nodeId
   * @param {string} [winnerId] - 单选模式下选中的候选 ID
   */
  async approveNode(nodeId, winnerId) {
    this._requireContext();
    if (!nodeId) throw new CanvasClientError('approveNode: nodeId 必填');

    const body = {
      projectId: this._projectId,
      episodesId: this._episodesId,
      nodeId,
    };
    if (winnerId) body.winnerId = winnerId;

    // approve/reject 走 v1 路径（任务 spec 明确）
    return this._request(`${this._legacyApiPrefix}/review/approve`, body);
  }

  /**
   * 驳回节点
   * POST /api/canvas/review/reject
   * @param {string} nodeId
   * @param {string} reason
   */
  async rejectNode(nodeId, reason) {
    this._requireContext();
    if (!nodeId) throw new CanvasClientError('rejectNode: nodeId 必填');

    return this._request(`${this._legacyApiPrefix}/review/reject`, {
      projectId: this._projectId,
      episodesId: this._episodesId,
      nodeId,
      reason: reason || '',
    });
  }

  /**
   * 请求 AI 评分
   * POST /api/canvas/review/score
   * @param {string} nodeId
   * @returns {Promise<{overall: number, quality: number, aesthetic: number, storyConsistency: number}>}
   */
  async requestNodeScore(nodeId) {
    this._requireContext();
    if (!nodeId) throw new CanvasClientError('requestNodeScore: nodeId 必填');

    return this._request(`${this._legacyApiPrefix}/review/score`, {
      projectId: this._projectId,
      episodesId: this._episodesId,
      nodeId,
    });
  }

  // ─── 布局 ─────────────────────────────────────────

  /**
   * 请求画布自动布局
   * POST /api/canvas/v2/layout
   * @param {object} [hints] - 布局提示（透传，服务端按 phaseIndex+branchId 重排）
   * @returns {Promise<object>} 布局后的节点坐标元数据 { nodes: [{id, position}] }
   */
  async requestLayout(hints = {}) {
    this._requireContext();
    return this._request(`${this._apiPrefix}/layout`, {
      projectId: this._projectId,
      episodesId: this._episodesId,
      ...hints,
    });
  }

  /**
   * 简单布局提示：基于 phaseOrder 计算新 phase 分组位置（client-side）
   * 不依赖后端 layout 端点，作为离线 fallback。
   * @param {number} phaseOrder - Phase stageOrder
   * @returns {{x: number, y: number}}
   */
  suggestGroupPosition(phaseOrder) {
    const colWidth = 900;
    return { x: phaseOrder * colWidth, y: 0 };
  }

  /**
   * 简单布局提示：候选节点在变体组内的相对位置
   * @param {number} variantIndex
   * @returns {{x: number, y: number}}
   */
  suggestCandidatePosition(variantIndex) {
    const rowHeight = 280;
    return { x: 0, y: variantIndex * rowHeight };
  }

  // ─── WebSocket ────────────────────────────────────

  /**
   * 建立 WS 连接，监听画布事件
   * 连接失败不抛异常（fail-open），仅打印警告
   */
  connect() {
    if (this._ws) {
      console.warn('[CanvasClient] WS 已存在连接，跳过 connect()');
      return;
    }
    if (!this._projectId) {
      console.warn('[CanvasClient] 缺少 projectId，跳过 WS connect()');
      return;
    }

    let socket;
    try {
      socket = io(`${this._baseUrl}/ws/projects`, {
        query: { projectId: String(this._projectId) },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        timeout: this._timeout,
        forceNew: true,
      });
    } catch (err) {
      console.warn(`[CanvasClient] WS connect 失败 (降级): ${err.message}`);
      return;
    }

    socket.on('connect', () => {
      this._wsConnected = true;
      this._wsReconnectCount = 0;
      console.log(
        `[CanvasClient] WS 已连接 (projectId=${this._projectId})`,
      );
      this._emit('connect', {});
    });

    socket.on('disconnect', (reason) => {
      this._wsConnected = false;
      console.warn(`[CanvasClient] WS 断开: ${reason}`);
      this._emit('disconnect', { reason });
    });

    socket.on('connect_error', (err) => {
      this._wsReconnectCount++;
      if (this._wsReconnectCount % 5 === 0) {
        console.warn(
          `[CanvasClient] WS 重连第 ${this._wsReconnectCount} 次: ${err.message}`,
        );
      }
      this._emit('connect_error', { message: err.message });
    });

    // 注册业务事件监听（由 socket.io 转发到本地 _emit）
    for (const event of SUPPORTED_EVENTS) {
      if (event === 'connect' || event === 'disconnect' || event === 'connect_error') {
        continue; // 已显式注册
      }
      socket.on(event, (payload) => {
        this._emit(event, payload || {});
      });
    }

    this._ws = socket;
  }

  /**
   * 断开 WS 连接，清理所有 listeners
   */
  disconnect() {
    if (!this._ws) return;
    try {
      this._ws.removeAllListeners();
      this._ws.disconnect();
    } catch (err) {
      console.warn(`[CanvasClient] WS disconnect 异常: ${err.message}`);
    }
    this._ws = null;
    this._wsConnected = false;
    this._listeners.clear();
  }

  /**
   * 注册事件监听
   * @param {string} event - 支持：review:approved, review:rejected,
   *   node:created, node:updated, node:state, branch:created,
   *   connect, disconnect, connect_error
   * @param {Function} callback - (payload) => void
   */
  on(event, callback) {
    if (!SUPPORTED_EVENTS.has(event)) {
      console.warn(`[CanvasClient] 不支持的事件: ${event}`);
      return;
    }
    if (typeof callback !== 'function') return;
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
  }

  /**
   * 移除事件监听
   * @param {string} event
   * @param {Function} [callback] - 不传则移除该事件的所有监听
   */
  off(event, callback) {
    if (!this._listeners.has(event)) return;
    if (!callback) {
      this._listeners.delete(event);
      return;
    }
    this._listeners.get(event).delete(callback);
  }

  /**
   * 触发本地 listeners（由 socket.io 事件触发时调用）
   * @param {string} event
   * @param {any} payload
   * @private
   */
  _emit(event, payload) {
    const cbs = this._listeners.get(event);
    if (!cbs || !cbs.size) return;
    for (const cb of cbs) {
      try {
        cb(payload);
      } catch (err) {
        console.error(
          `[CanvasClient] 事件 ${event} 回调异常: ${err.message}`,
        );
      }
    }
  }

  /**
   * 当前 WS 是否已连接
   */
  isConnected() {
    return this._wsConnected && !!this._ws;
  }

  // ─── 辅助 ─────────────────────────────────────────

  /**
   * 检查必需的 context 字段
   * @private
   */
  _requireContext() {
    if (this._projectId === undefined || this._projectId === null) {
      throw new CanvasClientError('projectId 未设置');
    }
    if (this._episodesId === undefined || this._episodesId === null) {
      throw new CanvasClientError('episodesId 未设置');
    }
  }
}

export default CanvasClient;
