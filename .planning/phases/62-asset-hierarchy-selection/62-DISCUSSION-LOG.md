# Phase 62: 资产管理中心资产层级与选定逻辑 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-24
**Phase:** 62-asset-hierarchy-selection
**Mode:** autonomous (/goal 指令豁免提问——推荐答案自动接受，理由成文于 CONTEXT)
**Areas discussed:** 层级视图数据语义, 层级化选定通道, 冗余配置入口, e2e 组织

---

## 层级视图数据语义

| Option | Description | Selected |
|--------|-------------|----------|
| 第一层纲 = 资产域分组（REAL_TYPE_GROUPS 扩展）+ 阶段徽标 | o_assets 无 phase 字段，阶段只能启发式；左侧树既成事实 | ✓ |
| 第一层纲 = 管线阶段 P01..P15 | DAG 口径与 42 节点对齐更直白，但归属推导脆弱 | |
| 双纲可切换 | 灵活但 UI 复杂度翻倍，deferred | |

**[auto] Selected:** "资产域分组为纲 + meta.phaseName 阶段徽标" (recommended default)
**Notes:** getGroupKey 为组层唯一轴（三态流转原子单位，HIER-04 绑定）；variantGroupId 以反查徽标形式「复用」而非另立组层；单产物资产挂「单件」桶。

---

## 层级化选定通道

| Option | Description | Selected |
|--------|-------------|----------|
| 既有 updateAsset 全语义 + 画布组映射时 best-effort select-winner 同步 | 两域各自真值 + 桥接复用既有端点，零事务复制 | ✓ |
| 全部改走 select-winner | 需 o_asset→canvas 节点映射，库级资产失效；且 select-winner 无「其余淘汰」语义，破坏 HIER-04 | |
| 维持现状不桥接画布 | 零风险但画布组 winner 悬空，HIER-02 不达标 | |

**[auto] Selected:** "updateAsset 主路径 + select-winner best-effort 同步（不回滚不阻断）" (recommended default)
**Notes:** 镜像 D-07 纪律；批量决策 = 组层多选 + 批量选定（每组最新非淘汰）/批量淘汰，逐组循环单组通道；场景/声纹组豁免批量选定。

---

## 冗余配置入口（HIER-03 写入通道）

| Option | Description | Selected |
|--------|-------------|----------|
| 两段式：kap DB 权威覆盖层 + requirement.json best-effort 写回 | 寻址确定 + 零 khs 依赖 + 结果分级呈现不假成功 | ✓ |
| 纯 requirement.json 文件通道 | 生效最直接但寻址启发式（projectId 部分富化/episodesId 全缺/旧快照无 v2.5 键），脆弱 | |
| 纯 kap 自存覆盖层经 sync 下发 | sync 下发面需 khs 代码，本期范围外——写侧语义不完整 | |

**[auto] Selected:** "两段式" (recommended default)
**Notes:** 读侧三源合并（覆盖层 > requirement.json 实测 > khs 快照默认）；键面 = 27-CONTEXT 灰区 2 快照硬编码常量 + e2e 契约锁；确定性派生类 pre>1 前端禁用 + 后端 400（比 khs 的运行时回落更早拦截）；p10_voice.tts 与报告审计类显式禁用行 + 原因文案。

---

## e2e 组织

| Option | Description | Selected |
|--------|-------------|----------|
| 三链路三文件（hierarchy/selection/redundancy-config）+ 既有全量回归 | 沿 phaseNN 惯例，链路独立可定位 | ✓ |
| 单文件大杂烩 | 文件内用例分组，失败定位差 | |

**[auto] Selected:** "三文件 + 全量回归" (recommended default)

---

## Claude's Discretion

层级视图组件形态与折叠交互（UI-SPEC 定）、徽标/角标视觉、覆盖层 DDL 细节、写回乐观锁实现、e2e 选择器组织、反查 util 提取位置。

## Deferred Ideas

khs sync 下发面、42 节点矩阵自动同步、批量评分自动选优、requirement.json 热加载、阶段主纲切换视图——见 CONTEXT `<deferred>`。
