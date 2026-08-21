---
phase: 56-creative-visualization
plan: 04
subsystem: viz-02-theater
tags: [viz-02, group-view-theater, turnaround, scene-gallery, voice]
requires: [56-01, 56-02]
provides:
  - theaterStore 开关态 + groupMembership 纯推导(theaterTargetOf 判定三链/deriveGroupMembers 三 join/turnaroundSlots 四宫格;9 用例)
  - TurnaroundView:2×2 同步缩放(wheel ±0.1/hover origin 跟光标/双击+按钮复位/受控 scale)+ 中央 chip 纯展示(一致性透传)
  - SceneGallery:主图 contain + 视角 chip + 64px 缩略行(88×64,select 描边,120ms 淡切);视角数据驱动 viewLabel 回退
  - VoiceProfileBoard:mini ▶(模块级单 audio)+ 完整播放器(audioPeaks 波形 72px/seek/MM:SS/伪波形注记)
  - GroupViewTheater 容器(TheaterShell 消费 + 空态卡 + Esc + 节点详情并存)
  - FlowCanvas 双击前置改道(≤10 行,原链零改动)+ NodeDetailPanel「组视图」次入口
affects: [56-05 G16 同族剧场, verify:phase-56 S-theater 锚点]
key-decisions:
  - decision: 变体组判定去 parentNodeId(V3 VariantGroup 无此字段)
    rationale: findVariantGroupForNode 的 legacy 形状有,但 graph.variantGroups 是 V3 形状;winner/成员二条件已覆盖。
  - decision: NodeDetailPanel zIndex 零改(实测其 overlay 层级高于剧场 40)
  - decision: scene views 聚合 = members.views dict 展平,无 dict 时回退 filePath 列表
requirements-completed: [VIZ-02]
duration: 55 min
completed: 2026-08-22T08:30:00+08:00
---

# Phase 56 Plan 04: 组视图剧场 Summary

双击组资产(变体组/character/scene/voice_profile)开全屏剧场:turnaround 2×2 同步缩放(签名元素)/场景画廊/音色两级试听;非组资产双击原语义零回归。372/372。

**Tasks:** 3/3(TDD ×1)· **Files:** 9 · VariantWall/healThumb/useLod git diff 0;REGEN-04 双击链保留(分支后完整)。

**Deviations:** ①VariantGroupV3 无 parentNodeId(判定删第三条件);②img src null 需 ?? undefined 严格型(3 处);③中心 chip 参考图 fallback thumbnailUrl。auto-fixed。

---

Ready for 56-05(G16 配音听审工作台)。
