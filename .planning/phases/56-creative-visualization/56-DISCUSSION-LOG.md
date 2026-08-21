# Phase 56: 创作环节可视化 (Creative Visualization) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-21
**Phase:** 56-创作环节可视化 (Creative Visualization)
**Areas discussed:** 雷达+角标呈现 (VIZ-01), 组视图形态 (VIZ-02), G16 工作台 (VIZ-03), 数据契约消费

**Mode:** Interactive discuss(用户经 /gsd-manager 进入;要求全程应用 /frontend-design;4/4 灰区全选全讨)

---

## 雷达+角标呈现 (VIZ-01)

| 决策 | 选项(✓=选中) |
|------|---------------|
| 雷达呈现位置 | ✓面板+hover弹层 / 节点内嵌常驻 / 仅详情面板 |
| verdict 角标视觉 | ✓眼/耳图标+色环 / score 旁小点 / 第五角 |
| 刷新链路 | ✓socket事件驱动 / 轮询刷新 / 面板拉取 |
| LOD 联动 | ✓L1起显示 / 全LOD常显 / Claude 定 |

**Notes:** ScoreRadar 纯 SVG 已存在直接复用;四角产权制不破坏(verdict 落左下与 stale 共存规则留 planner)。

## 组视图形态 (VIZ-02)

| 决策 | 选项 |
|------|------|
| 载体 | ✓全屏组视图剧场 / 详情面板扩展 / 画布子节点 |
| turnaround 布局 | ✓2×2+同步缩放 / 横向滑轨 / 单图切换 |
| 场景画廊布局 | ✓主图+缩略行 / 等分网格 / 轮播 |
| 试听层级 | ✓卡上mini+完整两级 / 仅面板播放 / hover自动播 |

**Notes:** 与 53 变体墙同族范式,剧场家族体验连贯。

## G16 工作台 (VIZ-03)

| 决策 | 选项 |
|------|------|
| 形态 | ✓审核剧场变体 / 分诊面板模式 / 独立页面 |
| 对照布局 | ✓时间轴对齐双轨 / 分离展示 / 仅转写 |
| 批量豁免通道 | ✓复用G15操作桥 / 自建端点 / 仅本地 |
| 播放组织 | ✓连续播放+键盘 / 手动逐条 / 并行同播 |

**Notes:** 波形×转写共享光标=56 签名元素;豁免复用 53-D15 一套机制两处消费。

## 数据契约消费

| 决策 | 选项 |
|------|------|
| verdict 真值源 | ✓socket scored 事件 / khs 工件拉 / review-platform |
| 维度口径 | ✓数据驱动不硬编码 / 硬编码维度表 / Claude 定 |
| 维度中文文案 | ✓契约层映射表 / 原样英文 / tooltip翻译 |
| 一致性分数据链 | ✓透传展示 / kap 自算 / 不显示 |

**Notes:** 全部走 53 契约链,平台不复制算法。

---

## Claude's Discretion

- hover popover 触发/定位;verdict 与 stale 同角共存规则;波形实现选型;转写分句字段;剧场家族共享容器抽取时机

## Deferred Ideas

None — 讨论未超出 phase 范围。
