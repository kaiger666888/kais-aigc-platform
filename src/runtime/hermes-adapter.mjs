/**
 * Hermes Adapter — LLM 调用路由层
 *
 * 将 movie-agent 的 LLM 调用路由到 Hermes MCP server（hermes_llm tool），
 * 替代直接调用 ZHIPU GLM API。
 *
 * 三种模式：
 * 1. Hermes 模式（HERMES_MCP_URL 已设置）→ 通过 HTTP 调用 Hermes MCP server
 * 2. 直连模式（默认）→ 直接调用 ZHIPU GLM API（兼容旧模式）
 *
 * v3.0 (Phase 19) — multimodal 升级（Pitfalls P7 修复）:
 *   - callLLM/callLLMJson 接受 prompt: string 或 prompt: Array<ContentBlock>
 *   - ContentBlock: { type: 'text', text } | { type: 'image_url', image_url: { url } }
 *   - image_url.url 支持 file://path, /abs/path, data:image/...;base64,...
 *   - file:// / abs path 自动读取并转 base64 data URL (智谱 GLM-4.6v 不支持 file://)
 *   - 向后兼容: callLLM(stringPrompt, options) 与 callLLM({prompt, system, ...}) 均可
 *
 * 环境变量：
 * - HERMES_MCP_URL: Hermes MCP server HTTP 地址（如 http://localhost:8080）
 * - HERMES_MCP_API_KEY: 可选的 API key
 * - ZHIPU_VISION_MODEL: 视觉模型名（默认 glm-4.6v）
 */

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const HERMES_URL = process.env.HERMES_MCP_URL || '';
const HERMES_KEY = process.env.HERMES_MCP_API_KEY || '';
const HERMES_TIMEOUT = 60000;

// ─── 默认模型 ─────────────────────────────────────────────

const DEFAULT_TEXT_MODEL = 'glm-5.1';
const DEFAULT_VISION_MODEL = 'glm-4.6v';  // v3.0: 统一升级,可经 ZHIPU_VISION_MODEL 覆盖

/**
 * 返回当前生效的视觉模型名（单一来源，避免 5 处硬编码碎片）。
 * @returns {string}
 */
export function getDefaultVisionModel() {
  return process.env.ZHIPU_VISION_MODEL || DEFAULT_VISION_MODEL;
}

/**
 * 返回当前生效的文本模型名。
 * @returns {string}
 */
export function getDefaultTextModel() {
  return process.env.OPENAI_TEXT_MODEL || DEFAULT_TEXT_MODEL;
}

// ─── imagePathToDataUrl (file:// → base64 data URL) ───────

const _MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

function _detectMime(filePath) {
  const ext = extname(filePath).toLowerCase();
  return _MIME_BY_EXT[ext] || 'image/png';  // 默认 png(智谱可推断)
}

/**
 * 读取图片文件并转换为 data URL（base64）。
 *
 * 智谱 GLM-4.6v 不支持 file:// scheme，必须转 base64。
 * 此 helper 读取文件 + 检测 mime + 返回 `data:image/...;base64,...` URL。
 *
 * @param {string} filePath — 绝对路径或 file:// URL
 * @returns {Promise<string>} data URL
 * @throws {Error} 文件不存在 / 读取失败
 */
export async function imagePathToDataUrl(filePath) {
  // 去掉 file:// 前缀
  let absPath = filePath;
  if (absPath.startsWith('file://')) {
    absPath = absPath.slice('file://'.length);
  }
  const buf = await readFile(absPath);
  const mime = _detectMime(absPath);
  const b64 = buf.toString('base64');
  return `data:${mime};base64,${b64}`;
}

/**
 * 检测给定 URL 是否为本地路径（file:// 或绝对路径 / 相对路径，且非 http/data）。
 */
function _isLocalPath(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('data:')) return false;
  if (url.startsWith('http://') || url.startsWith('https://')) return false;
  return true;  // file:// / /abs/path / ./relpath
}

/**
 * 规范化 content blocks 数组 — 将本地 file:// / abs path 图片转 base64 data URL。
 *
 * @param {Array<{type, text?, image_url?}>} blocks
 * @returns {Promise<Array>} 规范化后的 blocks(所有 image_url 均为 data: 或 http(s):)
 */
async function _normalizeContentBlocks(blocks) {
  if (!Array.isArray(blocks)) return blocks;
  const out = [];
  for (const block of blocks) {
    if (block?.type === 'image_url' && block.image_url?.url) {
      const url = block.image_url.url;
      if (_isLocalPath(url)) {
        try {
          const dataUrl = await imagePathToDataUrl(url);
          out.push({ type: 'image_url', image_url: { url: dataUrl } });
        } catch (err) {
          // 本地文件读取失败 — 不发送此 block,记录警告(不阻塞整体调用)
          console.warn(`[hermes-adapter] 图片转 base64失败(${url}): ${err.message} — 跳过该 image_url`);
        }
      } else {
        // data: 或 http(s): — 直传
        out.push(block);
      }
    } else {
      out.push(block);
    }
  }
  return out;
}

// ─── 参数规范化 ────────────────────────────────────────────

/**
 * 将 callLLM/callLLMJson 的多变调用形式统一规范化。
 *
 * 支持形式:
 *   callLLM(stringPrompt, options)                // 旧式 text-only
 *   callLLM({ prompt, system, model, ... })        // 新式 options-only(continuity-auditor 风格)
 *   callLLM(promptArray, options)                  // 新式 multimodal
 *   callLLM({ prompt: promptArray, system, ... })  // 新式 multimodal + options-only
 *
 * @returns {{ prompt: string|Array, options: object }}
 */
function _normalizeCallArgs(arg1, arg2) {
  if (arg1 !== null && typeof arg1 === 'object' && !Array.isArray(arg1)) {
    // 第一个参数是对象 → options-only 形式
    const merged = { ...arg1, ...(arg2 || {}) };
    const { prompt, ...rest } = merged;
    return { prompt, options: rest };
  }
  // 第一个参数是 string 或 Array → prompt + options
  return { prompt: arg1, options: arg2 || {} };
}

// ─── Hermes 路径 ──────────────────────────────────────────

/**
 * 通过 Hermes MCP 调用 LLM（推荐路径）
 *
 * @param {string|Array} prompt - 用户 prompt(string 或 multimodal blocks)
 * @param {object} options
 * @param {string} [options.system] - 系统 prompt
 * @param {string} [options.model] - 模型名称
 * @param {string} [options.responseFormat] - 'text' 或 'json'
 * @param {number} [options.temperature] - 温度
 * @returns {Promise<string|null>} LLM 响应文本；null 表示应降级到直连
 */
export async function callViaHermes(prompt, options = {}) {
  if (!HERMES_URL) {
    return null; // Signal to fall back to direct call
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (HERMES_KEY) headers['Authorization'] = `Bearer ${HERMES_KEY}`;

    // Hermes 协议当前仅支持 string prompt — multimodal 调用直连降级
    // (Hermes side 升级后再支持 array)
    if (Array.isArray(prompt)) {
      return null;  // signal fallback to direct multimodal call
    }

    const resp = await fetch(`${HERMES_URL}/mcp/tools/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'hermes_llm',
          arguments: {
            prompt,
            system: options.system || '',
            model: options.model || '',
            response_format: options.responseFormat || 'text',
            temperature: options.temperature ?? 0.3,
          },
        },
      }),
      signal: AbortSignal.timeout(HERMES_TIMEOUT),
    });

    if (!resp.ok) {
      throw new Error(`Hermes HTTP ${resp.status}: ${await resp.text().then(t => t.substring(0, 200))}`);
    }

    const json = await resp.json();
    // MCP tool response format: { content: [{ type: "text", text: "..." }] }
    if (json.content?.[0]?.text) {
      return json.content[0].text;
    }
    throw new Error('Unexpected Hermes response format');
  } catch (err) {
    console.warn(`[hermes-adapter] Hermes 调用失败, 降级到直连: ${err.message}`);
    return null; // Signal to fall back
  }
}

/**
 * 智能路由 LLM 调用
 * 优先走 Hermes（仅 text-only），不可用或 multimodal 时降级到直连 ZHIPU API。
 *
 * @param {string|Array|object} arg1 - prompt(string/Array) 或 options 对象
 * @param {object} [arg2] - options(当 arg1 为 prompt 时)
 * @returns {Promise<string>}
 */
export async function callLLM(arg1, arg2) {
  const { prompt, options } = _normalizeCallArgs(arg1, arg2);

  // Try Hermes first (text-only path; Hermes 不支持 multimodal)
  if (!Array.isArray(prompt)) {
    const hermesResult = await callViaHermes(prompt, options);
    if (hermesResult !== null) return hermesResult;
  }

  // Fallback: direct ZHIPU API call
  const apiBase = options.apiBase || process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
  const apiKey = options.apiKey || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || '';
  // 自动检测: multimodal prompt 默认走视觉模型
  const defaultModel = Array.isArray(prompt) ? getDefaultVisionModel() : getDefaultTextModel();
  const model = options.model || defaultModel;
  const temperature = options.temperature ?? 0.8;

  // 构建 messages
  const messages = [];
  if (options.system) messages.push({ role: 'system', content: options.system });

  if (Array.isArray(prompt)) {
    // v3.0: multimodal content blocks (规范化本地图片为 base64 data URL)
    const normalizedBlocks = await _normalizeContentBlocks(prompt);
    messages.push({ role: 'user', content: normalizedBlocks });
  } else {
    // text-only: content 为 string(OpenAI 标准)
    messages.push({ role: 'user', content: prompt });
  }

  // 构建 body — 仅在显式传入时附加 thinking 参数
  const body = { model, messages, temperature };
  if (options.thinking !== undefined) body.thinking = options.thinking;
  if (options.responseFormat === 'json' || options.response_format === 'json') {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`LLM 调用失败: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

/**
 * 智能路由 LLM 调用（返回 JSON）
 *
 * 支持与 callLLM 相同的参数形式,prompt 可以是 string 或 multimodal blocks。
 *
 * @param {string|Array|object} arg1
 * @param {object} [arg2]
 * @returns {Promise<object|array>} 解析后的 JSON
 */
export async function callLLMJson(arg1, arg2) {
  const { prompt, options } = _normalizeCallArgs(arg1, arg2);
  const content = await callLLM({ prompt, ...options, responseFormat: 'json' });
  const match = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }
  throw new Error('LLM 返回内容无法解析为 JSON');
}

/**
 * 检测 Hermes 是否可用
 * @returns {Promise<boolean>}
 */
export async function isHermesAvailable() {
  if (!HERMES_URL) return false;
  try {
    const resp = await fetch(`${HERMES_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Phase 21: Embedding API (BlacklistEngine 语义匹配基础) ───────────

/**
 * 调用 ZHIPU embedding API（embedding-3 模型）生成文本向量。
 *
 * 用于 BlacklistEngine 计算 prompt 间的 cosine similarity，实现"语义级"
 * bad case 匹配（非 regex 子串）。
 *
 * 行为契约:
 *   - 成功 → 返回 number[] (1024 维 for embedding-3)
 *   - 失败 → 返回 null（不 throw），让调用方进入 degraded 模式
 *
 * @param {string} text - 待向量化的文本
 * @param {object} [options]
 * @param {string} [options.model='embedding-3'] - embedding 模型名
 * @param {string} [options.apiBase] - API 基址（默认从 env 推断）
 * @param {string} [options.apiKey] - API key（默认从 env 推断）
 * @returns {Promise<number[]|null>} 向量；null 表示降级/不可达
 */
export async function callEmbedding(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return null;
  }

  const model = options.model || 'embedding-3';
  const apiBase = options.apiBase || process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
  const apiKey = options.apiKey || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || '';

  if (!apiKey) {
    return null;  // 无凭证 → 降级
  }

  try {
    const res = await fetch(`${apiBase}/embeddings`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
      signal: AbortSignal.timeout(HERMES_TIMEOUT),
    });

    if (!res.ok) {
      return null;
    }

    const json = await res.json();
    const vector = json?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      return null;
    }
    return vector;
  } catch {
    return null;  // 网络/解析错误 → 降级（不抛错）
  }
}

export default {
  callLLM,
  callLLMJson,
  callViaHermes,
  callEmbedding,
  isHermesAvailable,
  imagePathToDataUrl,
  getDefaultVisionModel,
  getDefaultTextModel,
};
