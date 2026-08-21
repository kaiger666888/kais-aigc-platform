# COORD-01 — khs2 v2.4 并行开发冲突管理规范

**Status:** Active (v3.0 milestone, Phase 51 落地)
**Created:** 2026-08-21
**Scope:** `kais-aigc-platform` (kap) × `kais-hermes-skills` (khs2 / kmc) 双仓并行开发期间的变更纪律
**Referenced by:** `.planning/ROADMAP.md` 架构决策 #4;verify 门 `scripts/verify-phase-51.ts` S5

khs2 v2.4 正在 kais-hermes-skills 仓内重构 kmc 22-phase 管线的内部算法;v3.0 同期要在 kap 侧
(以及部分 kmc 侧契约/映射文件)推进画布创作体验。两条工作流共享 field-map / canvas_sync /
manifest schema 等接缝文件,没有纪律就会互相踩踏。本规范是 ROADMAP 架构决策 #4 的全文成文,
后续每个涉及 kmc 侧变更的 PLAN.md 必须原文引用文末的开工 checklist 复制块。

---

## ① 变更面限定 (Change Surface Restriction)

v3.0 期间,kmc(kais-hermes-skills)侧允许变更的范围**仅限三层契约/映射面**:

1. **field-map** — pipeline 输出字段 ↔ 平台消费的映射表(如 `schema/pipeline-field-map.yaml`、
   `_recon/pipeline-field-map.yaml` 对应的 kmc 侧映射定义);
2. **canvas_sync** — `plugins/kais_aigc/canvas_sync.py` 及其直接契约接缝(画布同步的字段形状、
   save-v2 payload 构造),不含其调用的管线内部逻辑;
3. **manifest schema** — manifest 的 schema/契约层(字段定义、taxonomy、校验规则)。

**受保护面(禁止触碰):** khs2 v2.4 在改的 **kmc 22 phases 内部算法**——各 phase 的生成逻辑、
prompt 模板、引擎编排、内部数据结构演进。v3.0 任何 plan 不得修改这些内部实现;发现契约层
不足以支撑需求时,回写到本规范讨论变更面扩界,而不是直接改 phases 内部。

kap 侧(`kais-aigc-platform`)变更不受此限(本仓是 v3.0 主战场),但凡波及上述三层接缝文件的
kap 侧修改,必须与 kmc 侧同步评审(同一 plan 内成对修改或显式记录兼容窗口)。

## ② 排序约束 (Ordering Constraints)

- **涉及 p04/p09 输出字段映射的 phase(Phase 53 VAR-01)排在 khs2 v2.4 Phase 25 验收完成之后。**
  原因:p04/p09 的输出字段正是 v2.4 在改的 phases 内部算法的产出面,验收前字段形状不稳定,
  提前改映射会被上游变更反复冲掉。
- kap 侧纯接收端工作(消费既有契约、不改映射)不受此约束,可先行。
- ROADMAP 已在 Phase 53 条目挂此前置条件;本条款是其规范出处。

## ③ Plan 开工 Checklist 复制块

以下代码块供后续每个**涉及 kmc 侧变更**的 PLAN.md 在 `<context>` 或开工节中原样引用
(Phase 51-05 为首个示范使用者——该 plan 不触碰 kmc 侧任何文件,变更面检查 N/A,仍在
SUMMARY 中记录 checklist 执行结果):

```markdown
### COORD-01 开工 checklist(涉及 kmc 侧变更的 plan 必查)

- [ ] **kais-hermes-skills 工作树干净**:`git -C /data/workspace/kais-hermes-skills status --porcelain`
      输出为空——有未提交变更时先确认归属(可能是 khs2 v2.4 进行中的工作,踩上去即冲突)。
- [ ] **与上游同步确认**:kais-hermes-skills 已与上游同步(fetch + 确认本地不落后于
      khs2 v2.4 最新验收点),避免基于过期契约做映射变更。
- [ ] **变更面自查**:本 plan 的 kmc 侧改动是否只碰契约/映射三层(field-map / canvas_sync /
      manifest schema)?凡是碰 kmc 22 phases 内部算法的一律停手回议(见规范 ①)。
- [ ] **排序自查**:涉及 p04/p09 输出字段映射?确认 khs2 v2.4 Phase 25 已验收(见规范 ②)。
```

---

## 附:执行与守门

- **守门**:`scripts/verify-phase-51.ts` S5 用 grep 断言本文件存在、含"工作树干净"checklist
  条款、且 ROADMAP.md 含回本文件的引用——三者任一缺失 verify:phase-51 即红。
- **不进 skill 模板**:gsd-plan-phase 是用户级共享 skill(跨项目),项目专属规则不硬编码进去;
  checklist 由 phase 输入(CONTEXT / ROADMAP / 本文件)携带,PLAN.md 原文引用。
- **修订**:变更面扩界或排序约束调整,改本文件并在 ROADMAP 架构决策 #4 同步一句。
