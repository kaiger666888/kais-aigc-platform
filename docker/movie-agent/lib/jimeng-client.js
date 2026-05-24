/**
 * kais-jimeng — 统一即梦 API 客户端
 *
 * 所有 skill 和 pipeline 通过此客户端与即梦 API 交互，
 * 避免各处重复实现 fetch 逻辑。
 */

export class JimengClient {
  constructor(baseUrl = "http://localhost:8000") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    // 支持多 sessionid 轮询（逗号分隔）
    this.sessionIds = (process.env.JIMENG_SESSION_ID || "").split(",").filter(Boolean);
    this.sessionId = this.sessionIds[0] || "";
    this._sessionIndex = 0;
    this._rateLimitCount = 0;
    this._lastRequestTime = 0;
  }

  /** 带限流感知的请求（指数退避 + 多 session 轮询） */
  async _requestWithRetry(url, options = {}, maxRetries = 5) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const elapsed = Date.now() - this._lastRequestTime;
      if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));
      this._lastRequestTime = Date.now();

      let res;
      try {
        res = await fetch(url, { ...options, headers: { ...options.headers, "Authorization": `Bearer ${this.sessionId}` } });
      } catch (e) {
        if (attempt < maxRetries - 1) { await new Promise(r => setTimeout(r, 2000)); continue; }
        throw e;
      }

      if (res.status === 429) {
        const wait = Math.min(1000 * Math.pow(2, this._rateLimitCount), 16000);
        this._rateLimitCount++;
        console.warn(`[jimeng] 限流 429，等待 ${wait/1000}s (第${this._rateLimitCount}次)`);
        await new Promise(r => setTimeout(r, wait));
        if (this._rateLimitCount >= 3 && this.sessionIds.length > 1) {
          this._sessionIndex = (this._sessionIndex + 1) % this.sessionIds.length;
          this.sessionId = this.sessionIds[this._sessionIndex];
          this._rateLimitCount = 0;
          console.log(`[jimeng] 切换到 session ${this._sessionIndex + 1}/${this.sessionIds.length}`);
        } else if (this._rateLimitCount >= 5 && this.sessionIds.length <= 1) {
          console.warn(`[jimeng] 所有 session 均限流，等待 30s`);
          await new Promise(r => setTimeout(r, 30_000));
          this._rateLimitCount = 0;
        }
        continue;
      }

      if (res.status === 45) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      this._rateLimitCount = 0;
      return res;
    }
    throw new Error('API 请求超过最大重试次数');
  }

  /** 健康检查 */
  async ping(timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/ping`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 文生图/图生图 */
  async generateImage(prompt, options = {}) {
    const { model = "jimeng-5.0", ratio = "16:9", resolution = "2k", seed, images, reference_weight, timeoutMs = 120_000 } = options;

    const body = { model, prompt, ratio, resolution };
    if (seed != null) body.seed = seed;
    if (images?.length) body.images = images;
    if (reference_weight != null) body.reference_weight = reference_weight;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await this._requestWithRetry(`${this.baseUrl}/v1/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(`即梦 API 连接失败: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`即梦 API 错误 ${res.status}: ${text}`);
    }

    const json = await res.json();
    // 返回完整 data 数组 [{ url, seed }, ...]
    return json.data || [];
  }

  /** 视频生成（同步，普通模型如 jimeng-video-3.5-pro） */
  async generateVideo(prompt, options = {}) {
    const { model = "jimeng-video-3.5-pro", ratio = "1:1", duration = 5, timeoutMs = 600_000 } = options;

    const body = { model, prompt, ratio, duration };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await this._requestWithRetry(`${this.baseUrl}/v1/videos/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(`即梦视频 API 连接失败: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`即梦视频 API 错误 ${res.status}: ${text}`);
    }

    const json = await res.json();
    return json.data?.[0]?.url || null;
  }

  /**
   * Seedance 视频生成（iptag/jimeng-api 同步模式，内部自动轮询）
   * 返回视频 URL（向后兼容：调用方可继续用 pollTask(url) 透传获取 URL）
   */
  async submitSeedanceTask(prompt, filePaths, options = {}) {
    const { model = "jimeng-video-seedance-2.0-fast", ratio = "16:9", duration = 4, timeoutMs = 600_000, seed } = options;

    const body = { model, prompt, ratio, duration, file_paths: filePaths };
    if (seed != null) body.seed = seed;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await this._requestWithRetry(`${this.baseUrl}/v1/videos/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(`即梦视频 API 连接失败: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`即梦视频 API 错误 ${res.status}: ${text}`);
    }

    const json = await res.json();
    return json.data?.[0]?.url || null;
  }

  /**
   * @deprecated iptag/jimeng-api 内部自动轮询，此方法现在为透传。
   * submitSeedanceTask 已直接返回视频 URL，pollTask(url) → url。
   */
  async pollTask(urlOrTaskId, _options = {}) {
    return urlOrTaskId;
  }

  /** 下载文件到本地 */
  async download(url, outputPath) {
    const { createWriteStream } = await import("node:fs");
    const { pipeline: streamPipeline } = await import("node:stream/promises");
    const { Readable } = await import("node:stream");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败: ${res.status} ${url}`);
    if (!res.body) throw new Error("响应无 body stream");

    // Node.js fetch body → Node.js readable
    const nodeStream = Readable.fromWeb(res.body);
    await streamPipeline(nodeStream, createWriteStream(outputPath));
    return outputPath;
  }

  /**
   * 从视频URL下载并用ffmpeg截取最后一帧
   * @param {string} videoUrl - 视频下载地址
   * @param {string} outputPath - 输出图片路径
   * @returns {string} 输出图片路径，ffmpeg不可用时返回视频URL本身
   */
  async downloadLastFrame(videoUrl, outputPath) {
    // 检查 ffmpeg 是否可用
    let ffmpegAvailable = false;
    try {
      const { execSync } = await import('child_process');
      execSync('which ffmpeg', { stdio: 'pipe' });
      ffmpegAvailable = true;
    } catch { /* ffmpeg 不可用 */ }

    if (!ffmpegAvailable) {
      console.warn('[JimengClient] ffmpeg 不可用，无法截取最后一帧，返回视频URL');
      return videoUrl;
    }

    const videoPath = outputPath + '.tmp.mp4';
    await this.download(videoUrl, videoPath);
    try {
      const { execSync } = await import('child_process');
      execSync(`ffmpeg -sseof -1 -i "${videoPath}" -frames:v 1 -q:v 2 "${outputPath}" -y`, { stdio: 'pipe' });
    } finally {
      // 清理临时视频
      try {
        const { unlinkSync } = await import('fs');
        unlinkSync(videoPath);
      } catch { /* ignore */ }
    }
    return outputPath;
  }

  /**
   * 生成角色一致性验证视频
   * 即梦不暴露 seed，一致性通过参考图锚定实现。
   * 此方法生成一段短视频验证角色外观是否稳定。
   *
   * @param {string[]} refImages - 参考图URL数组（本地路径或URL）
   * @param {string} characterName - 角色名
   * @param {object} options - { model, ratio }
   * @returns {{ taskId: string, videoUrl: string }}
   */
  async generateIdentityVerification(refImages, characterName, options = {}) {
    const prompt = `${characterName}, slow turn from front to side profile, neutral expression, studio lighting, clean background, character consistency verification`;
    const url = await this.submitSeedanceTask(prompt, refImages, {
      model: options.model || 'jimeng-video-seedance-2.0',
      ratio: options.ratio || '16:9',
      duration: 4,
    });
    return { taskId: url, videoUrl: url };
  }

  /**
   * 生成角色锚定图（高质量角色定妆照）
   * 用即梦文生图从角色描述生成标准参考图，用于后续所有镜头的角色锚定。
   *
   * @param {string} prompt - 角色外观描述
   * @param {object} options - { model, ratio, resolution }
   * @returns {Promise<{ url: string }>} 生成的图片URL
   */
  async generateCharacterAnchor(prompt, options = {}) {
    const { model = 'jimeng-5.0', ratio = '3:4', resolution = '2k' } = options;
    const results = await this.generateImage(prompt, { model, ratio, resolution });
    if (!results?.length) throw new Error('角色锚定图生成失败：无返回结果');
    return { url: results[0].url, seed: results[0].seed || null };
  }
}

export default JimengClient;
