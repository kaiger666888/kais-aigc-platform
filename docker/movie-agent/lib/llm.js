/**
 * 通用 LLM 调用工具
 */

export async function callLLM(prompt, options = {}) {
  const apiBase = options.apiBase || process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
  const apiKey = options.apiKey || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || '';
  const model = options.model || 'glm-4-flash';
  const temperature = options.temperature ?? 0.8;

  const res = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature }),
  });

  if (!res.ok) throw new Error(`LLM 调用失败: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

export async function callLLMJson(prompt, options = {}) {
  const content = await callLLM(prompt, options);
  const match = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  throw new Error('LLM 返回内容无法解析为 JSON');
}
