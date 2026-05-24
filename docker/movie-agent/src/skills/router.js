/**
 * Skill Router — 路由分发到下游服务
 *
 * toonflow/*    → core-backend:8000
 * jellyfish/*   → core-backend:8000
 * hermes/*      → hermes-agent (via core-backend /api/v1/llm/chat)
 * gold-team/*   → gold-team:8002
 *
 * 自动降级：下游不可用时返回错误而非崩溃
 */

const SERVICE_MAP = {
  'toonflow': {
    baseUrl: () => process.env.CORE_BACKEND_URL || 'http://kais-core-backend:8000',
    pathPrefix: '/api/v1/toonflow',
  },
  'jellyfish': {
    baseUrl: () => process.env.CORE_BACKEND_URL || 'http://kais-core-backend:8000',
    pathPrefix: '/api/v1/jellyfish',
  },
  'hermes': {
    baseUrl: () => process.env.CORE_BACKEND_URL || 'http://kais-core-backend:8000',
    pathPrefix: '/api/v1/llm',
  },
  'gold-team': {
    baseUrl: () => process.env.GOLD_TEAM_URL || 'http://kais-gold-team:8002',
    pathPrefix: '/api/v1',
  },
};

/**
 * 路由请求到对应下游服务
 * @param {string} skill - 技能名称 (toonflow/jellyfish/hermes/gold-team)
 * @param {string} action - 操作名称
 * @param {object} body - 请求体
 * @returns {Promise<object>}
 */
export async function routeSkillRequest(skill, action, body = {}) {
  const service = SERVICE_MAP[skill];
  if (!service) {
    return { ok: false, error: `Unknown skill: ${skill}` };
  }

  const baseUrl = service.baseUrl();
  const targetPath = `${service.pathPrefix}/${action}`;
  const url = `${baseUrl}${targetPath}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        error: `Upstream ${skill} returned ${response.status}: ${text.slice(0, 200)}`,
        status: response.status,
      };
    }

    const data = await response.json().catch(() => ({}));
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: `Upstream ${skill} unreachable: ${err.message}`,
    };
  }
}

/**
 * Ping 下游服务检查可用性
 */
export async function pingService(serviceName) {
  const service = SERVICE_MAP[serviceName];
  if (!service) return false;

  const baseUrl = service.baseUrl();
  try {
    const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * 获取所有下游服务健康状态
 */
export async function getDownstreamHealth() {
  const results = {};
  for (const name of Object.keys(SERVICE_MAP)) {
    results[name] = await pingService(name);
  }
  return results;
}
