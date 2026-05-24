/**
 * Skill Router — 路由请求到下游 Skill 服务
 *
 * POST /api/v1/skills/toonflow/:action
 * POST /api/v1/skills/jellyfish/:action
 * POST /api/v1/skills/hermes/:action
 * POST /api/v1/skills/gold-team/generate
 */

import { routeSkillRequest } from '../skills/router.js';

const SKILLS_PREFIX = '/api/v1/skills';

export async function skillsRouter(req, res) {
  const { method } = req;
  const path = req._path;

  if (method !== 'POST' || !path.startsWith(SKILLS_PREFIX + '/')) return false;

  // Parse skill and action from path
  // /api/v1/skills/toonflow/sync → skill=toonflow, action=sync
  // /api/v1/skills/gold-team/generate → skill=gold-team, action=generate
  const suffix = path.slice(SKILLS_PREFIX.length + 1);

  // Handle gold-team special case
  let skill, action;
  if (suffix.startsWith('gold-team/')) {
    skill = 'gold-team';
    action = suffix.slice('gold-team/'.length);
  } else {
    const parts = suffix.split('/');
    skill = parts[0];
    action = parts.slice(1).join('/');
  }

  if (!skill) return false;

  try {
    const body = await req._parseBody();
    const result = await routeSkillRequest(skill, action, body);
    return res._json(result, result.ok === false ? 502 : 200);
  } catch (err) {
    return res._json({ ok: false, error: err.message }, 502);
  }
}
