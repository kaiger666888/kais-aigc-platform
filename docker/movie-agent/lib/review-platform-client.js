/**
 * ReviewPlatformClient — 审核平台 Node.js 客户端
 *
 * 零 npm 依赖，使用原生 fetch + AbortSignal.timeout
 * 镜像 Python gold-team client.py 的 API 设计
 */

/**
 * Custom error class for review platform client operations.
 * Wraps all fetch/network errors with descriptive messages including status codes.
 */
export class ReviewClientError extends Error {
  constructor(message, { status, url, cause } = {}) {
    super(message);
    this.name = 'ReviewClientError';
    this.status = status || null;
    this.url = url || null;
    this.cause = cause || null;
  }
}

/**
 * ReviewPlatformClient — HTTP client for the review platform REST API (V2.0, no auth).
 *
 * Supports review submission and status queries.
 * All methods use native fetch with AbortSignal.timeout for zero-dependency operation.
 */
export class ReviewPlatformClient {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl='http://127.0.0.1:8090'] - Review platform base URL
   * @param {number} [options.timeout=10000] - Request timeout in ms
   */
  constructor({ baseUrl, timeout = 10000, traceId = '' } = {}) {
    this._baseUrl = (baseUrl || process.env.REVIEW_PLATFORM_URL || 'http://review-platform:8090').replace(/\/$/, '');
    this._timeout = timeout;
    this._traceId = traceId;
  }

  /**
   * Submit a review to the review platform.
   * POST /api/v1/reviews (V2.0: no auth required).
   *
   * @param {object} params
   * @param {string} params.type - Review type (e.g., "pipeline_phase")
   * @param {string} params.contentRef - Content reference (e.g., "EP01:art-direction")
   * @param {object} [params.metadata] - Additional metadata (phase info, preview images)
   * @param {string} [params.callbackUrl] - URL for approval/rejection callback
   * @param {string} [params.callbackSecret] - HMAC shared secret for callback verification
   * @param {string} [params.priority='normal'] - Priority: low|normal|high|critical
   * @param {number} [params.riskScore=0.5] - Risk score 0.0-1.0
   * @returns {Promise<{reviewId: number, state: string, routing: string}>}
   * @throws {ReviewClientError} If submission fails
   */
  async submitReview({ type, contentRef, metadata, callbackUrl, callbackSecret, priority, riskScore }) {
    const body = {
      type,
      content_ref: contentRef,
      source_system: 'kais-movie-agent',
      metadata: metadata || null,
      priority: priority || 'normal',
      risk_score: riskScore ?? 0.5,
    };
    if (callbackUrl) body.callback_url = callbackUrl;
    if (callbackSecret) body.callback_secret = callbackSecret;

    const url = `${this._baseUrl}/api/v1/reviews`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this._traceId ? { 'X-Trace-Id': this._traceId } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this._timeout),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');

        // Degrade to AUTO on server errors (5xx) — service unavailable
        if (resp.status >= 500) {
          console.warn(`[ReviewClient] 审核服务不可用 (${resp.status}), 降级为 AUTO`);
          this._logDegradedReview({ type, contentRef, metadata, reason: `HTTP ${resp.status}` });
          return { reviewId: null, state: 'DEGRADED_AUTO', routing: 'AUTO', disposition: 'APPROVED', degraded: true };
        }

        throw new ReviewClientError(
          `Submit review failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ''}`,
          { status: resp.status, url },
        );
      }

      const { data } = await resp.json();
      return {
        reviewId: data.review_id,
        state: data.state,
        routing: data.routing,
      };
    } catch (err) {
      // Degrade to AUTO on timeout / network errors
      if (err.name === 'TimeoutError' || err.code === 'UND_ERR_CONNECT_TIMEOUT') {
        console.warn('[ReviewClient] 审核服务不可用 (超时), 降级为 AUTO');
        this._logDegradedReview({ type, contentRef, metadata, reason: 'timeout' });
        return { reviewId: null, state: 'DEGRADED_AUTO', routing: 'AUTO', disposition: 'APPROVED', degraded: true };
      }
      if (err instanceof ReviewClientError) throw err;
      // Degrade to AUTO on any other network / fetch errors
      if (err.type === 'system' || err.cause?.code === 'ECONNREFUSED' || err.cause?.code === 'ENOTFOUND') {
        console.warn(`[ReviewClient] 审核服务不可用 (${err.cause?.code || err.message}), 降级为 AUTO`);
        this._logDegradedReview({ type, contentRef, metadata, reason: err.cause?.code || err.message });
        return { reviewId: null, state: 'DEGRADED_AUTO', routing: 'AUTO', disposition: 'APPROVED', degraded: true };
      }
      throw new ReviewClientError(`Submit request failed: ${err.message}`, { url, cause: err });
    }
  }

  /**
   * Query the status of a previously submitted review.
   * GET /api/v1/reviews/{reviewId} with JWT auth.
   *
   * @param {number|string} reviewId - The review ID returned from submitReview
   * @returns {Promise<{reviewId: number, state: string, disposition: string|null, version: number}>}
   * @throws {ReviewClientError} If query fails
   */
  async queryReviewStatus(reviewId) {
    const url = `${this._baseUrl}/api/v1/reviews/${reviewId}`;

    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          ...(this._traceId ? { 'X-Trace-Id': this._traceId } : {}),
        },
        signal: AbortSignal.timeout(this._timeout),
      });

      if (!resp.ok) {
        throw new ReviewClientError(`Query review failed: ${resp.status} ${resp.statusText}`, {
          status: resp.status, url,
        });
      }

      const { data } = await resp.json();
      return {
        reviewId: data.review_id || data.id,
        state: data.state,
        disposition: data.disposition || null,
        version: data.version,
      };
    } catch (err) {
      if (err instanceof ReviewClientError) throw err;
      throw new ReviewClientError(`Query request failed: ${err.message}`, { url, cause: err });
    }
  }

  /**
   * Create a shot-card on the review platform (V6 API).
   * POST /api/v1/v6/shot-cards/ — no auth required.
   *
   * @param {object} params
   * @param {string} params.projectId - Project ID
   * @param {string} [params.phase='storyboard'] - Phase name
   * @param {string} [params.status='pending'] - Shot card status
   * @param {string} [params.imageUrl] - Image URL
   * @param {object} [params.metadata={}] - Additional metadata
   * @returns {Promise<{id: string, projectId: string, phase: string, status: string}>}
   * @throws {ReviewClientError} If creation fails
   */
  async createShotCard({ projectId, phase = 'storyboard', status = 'pending', imageUrl, metadata = {} }) {
    const body = {
      project_id: String(projectId),
      phase,
      status,
      ...(imageUrl ? { image_url: imageUrl } : {}),
      metadata,
    };

    const url = `${this._baseUrl}/api/v1/v6/shot-cards/`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this._traceId ? { 'X-Trace-Id': this._traceId } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this._timeout),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new ReviewClientError(
          `Create shot-card failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ''}`,
          { status: resp.status, url },
        );
      }

      const { data } = await resp.json();
      return {
        id: data?.id || data?.shot_card_id,
        projectId: data?.project_id || projectId,
        phase: data?.phase || phase,
        status: data?.status || status,
      };
    } catch (err) {
      if (err instanceof ReviewClientError) throw err;
      throw new ReviewClientError(`Create shot-card request failed: ${err.message}`, { url, cause: err });
    }
  }

  /**
   * Log a degraded review for audit trail.
   * @param {object} info
   * @param {string} info.type - Review type
   * @param {string} info.contentRef - Content reference
   * @param {object} [info.metadata] - Review metadata
   * @param {string} info.reason - Degradation reason
   */
  _logDegradedReview({ type, contentRef, metadata, reason }) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      event: 'review_degraded',
      type,
      contentRef,
      reason,
      metadata: metadata ? JSON.stringify(metadata).substring(0, 500) : null,
    }));
  }
}
