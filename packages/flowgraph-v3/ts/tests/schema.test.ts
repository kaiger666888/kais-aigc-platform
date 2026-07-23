/**
 * schema.test.ts — FlowGraphV3 契约测试（Stage 1）
 *  - ajv（draft 2020-12 + ajv-formats）对 SSOT schema 校验 fixtures
 *  - producer 语义：additionalProperties:false 生效（unknown-fields 样本被拒）
 *  - Zod 层与 schema 对齐（valid parse 成功 / unknown 拒绝）
 *  - 非法变异：缺 required / bad enum / stage-meta 判别联合错配
 */
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../../schema/flowgraph-v3.schema.json';
import validSample from '../../fixtures/v3-valid.sample.json';
import unknownFieldsSample from '../../fixtures/v3-unknown-fields.sample.json';
import { flowGraphV3Schema, validateFlowGraphV3 } from '../src/zod.js';
import type { FlowGraphV3 } from '../src/types.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe('JSON Schema SSOT (ajv, draft 2020-12)', () => {
  it('valid 全要素样本通过', () => {
    const ok = validate(validSample);
    expect(validate.errors).toBeNull();
    expect(ok).toBe(true);
  });

  it('unknown-fields 样本被 producer 语义拒绝（additionalProperties:false 生效）', () => {
    const ok = validate(unknownFieldsSample);
    expect(ok).toBe(false);
    const msgs = (validate.errors ?? []).map(
      (e) =>
        `${e.instancePath} ${e.message} ${String(
          (e.params as { additionalProperty?: string }).additionalProperty ?? '',
        )}`,
    );
    // 三处注入：顶层 / 资产节点 / 事件节点，全部要被抓住
    expect(msgs.some((m) => m.includes('futureTopLevelField'))).toBe(true);
    expect(msgs.some((m) => m.includes('unknownNodeProp'))).toBe(true);
    expect(msgs.some((m) => m.includes('futureEventField'))).toBe(true);
  });

  it('GenerationParams 是唯一例外：事件 params 内开放字段不被拒', () => {
    const g = clone(validSample) as Record<string, unknown>;
    const nodes = g.nodes as Array<Record<string, unknown>>;
    const evt = nodes.find((n) => n.id === 'evt_decompose')!;
    (evt.params as Record<string, unknown>).brandNewOpParam = { nested: [1, 2, 3] };
    expect(validate(g)).toBe(true);
  });
});

describe('Zod 层', () => {
  it('valid 样本 parse 成功', () => {
    const result = validateFlowGraphV3(validSample);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const g: FlowGraphV3 = result.data;
      expect(g.meta.version).toBe('3');
      expect(g.nodes.length).toBeGreaterThan(0);
      expect(g.variantGroups[0]?.winnerNodeId).toBe('asset_video_01');
    }
  });

  it('flowGraphV3Schema.safeParse 直接可用', () => {
    expect(flowGraphV3Schema.safeParse(validSample).success).toBe(true);
  });

  it('unknown-fields 样本被 Zod strict 拒绝并给出可读错误', () => {
    const result = validateFlowGraphV3(unknownFieldsSample);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('非法变异（必须 fail-loud）', () => {
  it('① 缺 required：meta.version 缺失', () => {
    const g = clone(validSample) as { meta: Record<string, unknown> };
    delete g.meta.version;
    expect(validate(g)).toBe(false);
    expect(validateFlowGraphV3(g).ok).toBe(false);
  });

  it('② bad enum：边 role 取值越界', () => {
    const g = clone(validSample) as { links: Array<Record<string, unknown>> };
    g.links[0]!.role = 'magic_cable';
    expect(validate(g)).toBe(false);
    expect(validateFlowGraphV3(g).ok).toBe(false);
  });

  it('③ stage/meta 判别联合错配：storyboard 字段挂在 keyframe 分支', () => {
    const g = clone(validSample) as {
      nodes: Array<{ id: string; meta?: Record<string, unknown> }>;
    };
    const kf = g.nodes.find((n) => n.id === 'asset_kf_01')!;
    // shotType/durationS 是 storyboard 分支专属；stage 常量又不匹配 storyboard 分支 → oneOf 全灭
    kf.meta = { stage: 'keyframe', shotId: 'shot-001', shotType: 'close-up', durationS: 4 };
    expect(validate(g)).toBe(false);
    expect(validateFlowGraphV3(g).ok).toBe(false);
  });

  it('③b meta 分支缺自身 required：storyboard meta 缺 durationS', () => {
    const g = clone(validSample) as {
      nodes: Array<{ id: string; meta?: Record<string, unknown> }>;
    };
    const sb = g.nodes.find((n) => n.id === 'asset_sb_01')!;
    delete sb.meta!.durationS;
    expect(validate(g)).toBe(false);
    expect(validateFlowGraphV3(g).ok).toBe(false);
  });

  it('③c 节点 stage 与 meta.stage 判别错配：stage:keyframe + meta:{stage:"script"} 被拒（F4）', () => {
    // meta:{stage:'script'} 单看是合法 script 分支（仅 stage 必填），错配发生在节点级耦合
    const g = clone(validSample) as {
      nodes: Array<{ id: string; meta?: Record<string, unknown> }>;
    };
    const kf = g.nodes.find((n) => n.id === 'asset_kf_01')!;
    kf.meta = { stage: 'script', hookType: '悬念' };
    expect(validate(g)).toBe(false); // JSON Schema allOf if/then 交叉校验
    expect(validateFlowGraphV3(g).ok).toBe(false); // Zod superRefine 交叉校验
  });

  it('③d voice/foley/bgm 三分支与节点 stage 同名耦合：stage:voice + meta:{stage:"bgm"} 被拒（F4）', () => {
    const g = clone(validSample) as {
      nodes: Array<{ id: string; meta?: Record<string, unknown> }>;
    };
    const voice = g.nodes.find((n) => n.id === 'asset_voice_01')!;
    voice.meta = { stage: 'bgm', emotion: '紧张' }; // 合法 bgm 分支，但与 stage:'voice' 错配
    expect(validate(g)).toBe(false);
    expect(validateFlowGraphV3(g).ok).toBe(false);
  });

  it('selectMode:"locked" 解构集组（宪法 §11 整组锁定展示）被四层接受（F8 minor）', () => {
    // fixture 已含 vg_decompose（selectMode:'locked'，无 winnerNodeId）
    const g = validSample as { variantGroups: Array<{ id: string; selectMode: string; winnerNodeId?: string }> };
    const vg = g.variantGroups.find((x) => x.id === 'vg_decompose')!;
    expect(vg.selectMode).toBe('locked');
    expect(vg.winnerNodeId).toBeUndefined();
    expect(validate(validSample)).toBe(true);
    expect(validateFlowGraphV3(validSample).ok).toBe(true);
  });
});
