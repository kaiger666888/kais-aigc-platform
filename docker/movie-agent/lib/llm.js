/**
 * 通用 LLM 调用工具 — 通过 Hermes / OpenClaw 代理
 *
 * 使用与 Hermes MCP server 相同的 OpenAI-compatible API 格式。
 * 环境变量: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL (与 Hermes 一致)
 */

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-4-flash';

/**
 * 调用 LLM（OpenAI-compatible chat completions）
 * @param {string} prompt - 用户输入
 * @param {object} [options]
 * @param {string} [options.apiBase] - API base URL (覆盖 LLM_BASE_URL)
 * @param {string} [options.apiKey]  - API key (覆盖 LLM_API_KEY)
 * @param {string} [options.model]   - 模型名 (覆盖 LLM_MODEL)
 * @param {number} [options.temperature]
 * @param {string} [options.system]  - system prompt
 * @param {number} [options.maxRetries=2]
 * @param {number} [options.timeoutMs=60000]
 */
export async function callLLM(prompt, options = {}) {
  const apiBase = options.apiBase || process.env.LLM_BASE_URL || DEFAULT_BASE_URL;
  const apiKey = options.apiKey || process.env.LLM_API_KEY || '';
  const model = options.model || process.env.LLM_MODEL || DEFAULT_MODEL;
  const temperature = options.temperature ?? 0.8;
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 120000;

  const messages = [];
  if (options.system) {
    messages.push({ role: 'system', content: options.system });
  }
  messages.push({ role: 'user', content: prompt });

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages, temperature }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text();
        // Retry on 429 (rate limit) or 5xx (server error)
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.warn(`[llm] API returned ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(`LLM 调用失败: ${res.status} ${errText}`);
      }

      const json = await res.json();
      return json.choices?.[0]?.message?.content || '';
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && err.name !== 'AbortError') {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.warn(`[llm] 请求失败: ${err.message}, 重试中 (${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * 调用 LLM 并解析返回的 JSON
 */
export async function callLLMJson(prompt, options = {}) {
  const content = await callLLM(prompt, options);
  const match = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  throw new Error('LLM 返回内容无法解析为 JSON');
}
