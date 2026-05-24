/**
 * Mock Pipeline — 最小化冒烟测试用
 * 替代完整的 lib/pipeline.js（有深层 lib/ 依赖）
 * MVP-0 集成联调后替换为完整实现
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class Pipeline {
  constructor({ workdir, episode, config, traceId } = {}) {
    this.workdir = workdir || '/tmp/pipeline';
    this.episode = episode || 'default';
    this.config = config || {};
    this.traceId = traceId || 'mock';
    this.completedPhases = [];
  }

  async runPhase(phaseId) {
    // Mock: 模拟 phase 执行（100ms 延迟）
    await new Promise(r => setTimeout(r, 100));
    this.completedPhases.push(phaseId);
    console.log(`[MockPipeline] Phase ${phaseId} completed`);
  }

  getStatus() {
    return {
      episode: this.episode,
      traceId: this.traceId,
      completedPhases: this.completedPhases,
    };
  }
}
