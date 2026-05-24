/**
 * HMAC-SHA256 签名工具 — Node.js 版 (ESM)
 *
 * 用于 movie-agent (Node.js) 的回调签名/验证。
 */

import crypto from 'crypto';

function sign(body, secret) {
  /** 生成 HMAC-SHA256 签名，返回 header 值格式: sha256={hex} */
  const sig = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return `sha256=${sig}`;
}

function verify(body, secret, headerValue) {
  /**
   * 验证 HMAC-SHA256 签名。
   * body: 原始请求 body (string 或 Buffer)
   * secret: 共享密钥
   * headerValue: X-HMAC-Signature header 的值，格式 "sha256={hex}"
   */
  if (!headerValue || !headerValue.startsWith('sha256=')) return false;
  const expected = sign(Buffer.isBuffer(body) ? body : Buffer.from(body), secret);
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(headerValue)
  );
}

function getSecret(envVar) {
  /** 从环境变量读取密钥，缺失或为默认值时抛错。 */
  const secret = process.env[envVar];
  if (!secret) throw new Error(`环境变量 ${envVar} 未设置`);
  if (secret === 'change-me-in-production') {
    throw new Error(`环境变量 ${envVar} 仍为默认值，请替换为安全密钥`);
  }
  return secret;
}

export { sign, verify, getSecret };
