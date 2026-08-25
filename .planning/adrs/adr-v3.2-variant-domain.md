# ADR — v3.2 变体域三项裁定 (Phase 68 / VDR-02)

日期: 2026-08-25 · 状态: 已裁定(执行授权: 「按照你认为正确的顺序执行」,2026-08-25)
影响: Phase 68(本 phase)· Phase 69(Wave B 实施)· Phase 70(换选通道)

---

## 裁定 1: chosen_variant_id 最终类型 = **string finalist id**(裁决点 3,选 a)

**决定**: 换选通道全线的机器可读选定标识为 **string**:
- p01 域: `"v{N}"` (variant_id,如 `"v2"`)
- p11a 域: `"{shot_id}:{variant_id}"`
- p11a0 域: `"{shot_id}:{frame_type}:v{N}"`
- 平台 `result.selected: int[]` 保留为兜底通道(runner_hooks 三通道已合成 `"v{N}"` string)。

**理由**:
1. khs 消费链已按 string 校验且在生产运行:`chosen_from_outcome` 校验 chosen ∈
   finalists id 集(全 string);p11a0 `rsplit(":", 2)` 解析 `{sid}:{ft}:v{N}`。
2. kap/平台侧改 int 兼容需要三仓同时动 + 历史 review 数据回填,成本高且丢失
   作用域信息(裸 int 5 不知道属于哪个 shot/frame_slot——正是 F08 的根因)。
3. 平台无需 schema 变更:comment 通道 `choose:<id>` 本就是 string 透传。

**落地**: Phase 70(select-winner→G13 三重断裂修复)按此实现;kap
manifestWriteback 的 `chosen_variant_id` 字段值从 1-based int 改为完整 scoped
string id。**废弃**: 选项 b(平台并列加 string 字段)。

---

## 裁定 2: candidateScoreSchema percent 域 = **三档 scale + 交叉校验**(VDR-02②)

**决定**: `scale: "unit"(0..1) | "ten"(0..10) | "percent"(0..100)`,
`overall` 域随档位 superRefine 校验(旧恒 max(1) 与 percent 0..100 自相矛盾,
F13)。

**理由**: khs 真实形态锚点——p11a0 iframe-qc 是 **int 0..10**
(`_coerce_score: max(0, min(10, int(raw)))`,合格线 6,08-24 实核;旧注释
「0..100 ints」错误);p03/p11a 是 0..1 float。percent 暂无真实生产者,保留
档位为前向兼容。normalizeScore 增 `ten /10` 归一。

---

## 裁定 3: 跨组候选归组真相源 = **一主两从**(VDR-02③, F11)

**决定**:
- **主(master)**: khs `meta.groupKey`(短横线形 `{sid}_{first|last}`)——
  生产环境唯一在写的真值(p11a iframe-manifest 产 a-flf 节点时生成,
  canvas_sync 写入节点 data + o_assets.meta)。
- **从(derived master, kap)**: kap canonical 形 `shot:{sid}:{slot}`(带
  `cand:` 前缀进 canvas_variant_groups)——分组运算/排序/UI 的规范形;
  `canonicalFlfGroupKey` 是主→从的唯一映射点。
- **从(derived, 资产中心)**: 资产中心 keyframe 分组从 kap canonical 推导,
  不再自持第三套词表。

**理由**: 三套词表(khs 短横线 / kap cand: 规范形 / 资产中心推导形)并存无
裁决是 F11 根因;khs 是生产者(kap 无法反推不存在的键),故 khs 形为主;kap
规范形承担运算职责(冒号分段可机读),映射收口在 `canonicalFlfGroupKey` 一处。

---

## 附带发现(VDR-03 双源校验产出)

真实样本校验(S1f)立即抓到一条 fixture 测不出的漂移:khs p11b take-log
实际键为 `shot_index`(int)+ 常见 `seed: null`,**无 `shot_id`**——旧
takeLogEntrySchema(必填 shot_id / seed 非 null)对生产 take-log 整条拒收。
已对齐:`shot_id`/`shot_index` 双键可选、`seed` nullish。这正是 COORD-02
「verify 门必须测端到端数据链」的又一实证。
