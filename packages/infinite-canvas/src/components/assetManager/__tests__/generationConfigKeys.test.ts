/**
 * generationConfigKeys 单测（62-01）—— 键面口径 / 域指派 / 阶段映射 / 钳制。
 *
 * D-12 漂移锁的前端静态半：11 嵌套 + 3 扁平 + preCap1×5 + unwired×2 + 锁定区 19
 * 全部程序化断言（非注释）；`p09_shotlist.transition` 不得作为独立键存在
 * （27-02 单键裁决：转场随分镜表候选整体）。契约源 = khs runner.py:2341-2392 实码。
 */
import { describe, it, expect } from 'vitest'
import {
  GENERATION_CONFIG_KEYS,
  LOCKED_CONFIG_KEYS,
  LOCKED_KEYS_TOTAL,
  TYPE_DOMAIN,
  domainOfType,
  PHASE_BY_SUBTYPE,
  clampRedundancy,
} from '../generationConfigKeys'

/** 嵌套键 = phaseKey 含 '.'；扁平键 = 不含。 */
const nested = GENERATION_CONFIG_KEYS.filter((k) => k.phaseKey.includes('.'))
const flat = GENERATION_CONFIG_KEYS.filter((k) => !k.phaseKey.includes('.'))
const phaseKeys = GENERATION_CONFIG_KEYS.map((k) => k.phaseKey)

// ─── 键数与口径（D-12 静态半） ────────────────────────────

describe('GENERATION_CONFIG_KEYS 键面口径（runner.py 实码修正版）', () => {
  it('键数：嵌套恰 11、扁平恰 3、合计 14', () => {
    expect(nested.length).toBe(11)
    expect(flat.length).toBe(3)
    expect(GENERATION_CONFIG_KEYS.length).toBe(14)
  })

  it('preCap1 确定性派生键恰 5（五键逐一点名）；unwired 占位未接线恰 2（bgm/foley）', () => {
    const capped = GENERATION_CONFIG_KEYS.filter((k) => k.preCap1).map((k) => k.phaseKey)
    expect(capped).toEqual([
      'p07_style.style_vector',
      'p07_style.color_intent',
      'p12_compose.master_timeline',
      'p12_compose.audio_mix',
      'p13_master.master_mp4',
    ])
    const unwired = GENERATION_CONFIG_KEYS.filter((k) => k.unwired).map((k) => k.phaseKey)
    expect(unwired.sort()).toEqual(['p12_audio.bgm', 'p12_audio.foley'])
    expect(capped.length).toBe(5)
    expect(unwired.length).toBe(2)
  })

  it('漂移锁：transition 无独立键（已并入 shot_list，仅 note 注记「转场」）', () => {
    expect(phaseKeys).not.toContain('p09_shotlist.transition')
    const shotList = GENERATION_CONFIG_KEYS.find((k) => k.phaseKey === 'p09_shotlist.shot_list')
    expect(shotList?.note).toContain('转场')
  })

  it('扁平键默认值：pre 全 3；p02/p03 final=1；p01_hook final=null 哨兵（缺省回落 pre）', () => {
    for (const k of flat) expect(k.defaultPre).toBe(3)
    const byKey = Object.fromEntries(flat.map((k) => [k.phaseKey, k]))
    expect(byKey['p02_outline'].defaultFinal).toBe(1)
    expect(byKey['p03_script'].defaultFinal).toBe(1)
    expect(byKey['p01_hook'].defaultFinal).toBeNull()
  })

  it('嵌套键默认全 {1,1}，除 topic_kernel（final=1、pre 共享扁平 =3）', () => {
    for (const k of nested) {
      if (k.phaseKey === 'p01_hook.topic_kernel') {
        expect(k.defaultPre).toBe(3)
        expect(k.defaultFinal).toBe(1)
      } else {
        expect(k.defaultPre, k.phaseKey).toBe(1)
        expect(k.defaultFinal, k.phaseKey).toBe(1)
      }
    }
  })

  it('gpuHint 仅 p11_video；tier 指派抽查（llm/engine/deterministic/text 各归位）', () => {
    const hinted = GENERATION_CONFIG_KEYS.filter((k) => k.gpuHint).map((k) => k.phaseKey)
    expect(hinted).toEqual(['p11_video.video_render'])
    const tierOf = (pk: string) => GENERATION_CONFIG_KEYS.find((k) => k.phaseKey === pk)?.tier
    expect(tierOf('p01_hook.topic_kernel')).toBe('llm')
    expect(tierOf('p12_audio.bgm')).toBe('engine')
    expect(tierOf('p13_master.master_mp4')).toBe('deterministic')
    expect(tierOf('p03_script')).toBe('text')
  })
})

describe('LOCKED_CONFIG_KEYS（不可配汇总形态）', () => {
  it('tts 单列：phaseKey 与 reason 含「钉死 1」', () => {
    expect(LOCKED_CONFIG_KEYS.tts.phaseKey).toBe('p10_voice.tts')
    expect(LOCKED_CONFIG_KEYS.tts.reason).toContain('钉死 1')
  })

  it('reportAudit 汇总计数 = 18（不逐键枚举）；锁定区总数 = 1 + 18 = 19', () => {
    expect(LOCKED_CONFIG_KEYS.reportAudit.count).toBe(18)
    expect(LOCKED_CONFIG_KEYS.reportAudit.reason).toBe('报告/审计类 · 管线固定')
    expect(LOCKED_KEYS_TOTAL).toBe(19)
  })
})

// ─── L1 域指派（UI-SPEC 层间指派规则） ────────────────────

describe('TYPE_DOMAIN / domainOfType', () => {
  it('keyframe ∈ setting（G13 首尾分选与设定同域）；script → text；video → media', () => {
    expect(domainOfType('keyframe')).toBe('setting')
    expect(TYPE_DOMAIN['keyframe']).toBe('setting')
    expect(domainOfType('script')).toBe('text')
    expect(domainOfType('video')).toBe('media')
  })

  it('UI-SPEC L1 三域全量在表；未列类型兜底 media', () => {
    const settingTypes = ['character', 'scene', 'scene_variant', 'scene_image', 'prop', 'prop_key',
      'prop_consumable', 'costume', 'accessory', 'keyframe']
    const mediaTypes = ['video', 'clip', 'audio', 'voice', 'storyboard']
    const textTypes = ['script_phase', 'outline', 'topic', 'storyboard_board', 'delivery',
      'style', 'requirement', 'story', 'script']
    for (const t of settingTypes) expect(TYPE_DOMAIN[t], t).toBe('setting')
    for (const t of mediaTypes) expect(TYPE_DOMAIN[t], t).toBe('media')
    for (const t of textTypes) expect(TYPE_DOMAIN[t], t).toBe('text')
    expect(Object.keys(TYPE_DOMAIN).length).toBe(settingTypes.length + mediaTypes.length + textTypes.length)
    expect(domainOfType('mystery')).toBe('media') // 未列类型兜底
  })
})

// ─── 子类型→阶段映射（D-01 徽标推导回退表） ────────────────

describe('PHASE_BY_SUBTYPE', () => {
  it('delivery_package → P13 + reportAudit:true（不进单件桶显式节点，计入域 total）', () => {
    expect(PHASE_BY_SUBTYPE.delivery_package).toEqual({ phaseCode: 'P13', reportAudit: true })
  })

  it('抽查：keyframe_first → P09；spatio_temporal_script → P06', () => {
    expect(PHASE_BY_SUBTYPE.keyframe_first?.phaseCode).toBe('P09')
    expect(PHASE_BY_SUBTYPE.spatio_temporal_script?.phaseCode).toBe('P06')
  })

  it("subtype='unknown' 不入表（兜底走 meta 直读）", () => {
    expect(PHASE_BY_SUBTYPE.unknown).toBeUndefined()
  })
})

// ─── 钳制（khs resolver 四象限） ──────────────────────────

describe('clampRedundancy（_vision_review.py:87-91 逐字语义）', () => {
  it.each([
    ['pre<1 抬到 1，final 同步抬到 1', 0, 0, 1, 1],
    ['final>pre 压到 pre', 5, 9, 5, 5],
    ['合法区间原样通过', 3, 2, 3, 2],
    ['下界 (1,1) 恒等', 1, 1, 1, 1],
  ])('%s：(pre=%i, final=%i) → (%i, %i)', (_label, pre, final, ep, ef) => {
    expect(clampRedundancy(pre, final)).toEqual({ pre: ep, final: ef })
  })
})
