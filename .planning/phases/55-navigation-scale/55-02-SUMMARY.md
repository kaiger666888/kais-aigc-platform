---
phase: 55-navigation-scale
plan: 02
subsystem: scene-shot-browser
tags: [nav-02, scene-grouping, extract-shots, two-level-browser]

# Dependency graph
requires: []
provides:
  - sceneGrouping 共享 util:sceneNumOf/SCENE_COLORS/sceneColorOf/formatTotalDuration(全仓唯一实现,binding constraint 4)
  - extractShots 增强:videoPrompt(video_prompt ?? ltx_prompt)+ referencedAssets(scope='global' 名字索引回查角色/场景缩略图;Pass 5 纯派生)
  - SceneShotBrowser:场景→镜头两级浏览(viewMode 'scene_shots';场景节头 3px 色带/折叠;镜头卡一级常显 + hover 二级;单击跳画布聚焦)
  - StoryboardShot 接口导出(消费方可 import)
affects: [55-04 搜索导航器消费 sceneNumOf, 55-05 ShotTree 口径迁移]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "引用回查双域词汇:raw.assetType 'character'(kmc)与 meta assetType 'role'(前端联合类型)同义都进角色索引——不逼单一词汇"
    - "空结果零噪音:referencedAssets 两数组皆空时 undefined(不产空对象)"
    - "降级链:缩略 firstFrame → thumbnail → `${sceneColor}33` 色底;引用缩略 null 时色点占位"

key-files:
  created:
    - packages/infinite-canvas/src/utils/sceneGrouping.ts
    - packages/infinite-canvas/src/utils/__tests__/sceneGrouping.test.ts
    - packages/infinite-canvas/src/components/SceneShotBrowser.tsx
  modified:
    - packages/infinite-canvas/src/components/StoryboardTimeline.tsx(口径迁移 + 接口导出 + Pass1/Pass5 增强)
    - packages/infinite-canvas/src/components/__tests__/StoryboardTimeline.shotKey.test.ts(+4)
    - packages/infinite-canvas/src/store/canvasStore.ts(ViewMode +scene_shots)
    - packages/infinite-canvas/src/components/FlowCanvas.tsx(分镜浏览按钮 + 渲染分支)

key-decisions:
  - decision: formatTotalDuration(59.6) 锁定 '00:60' 现状
    rationale: 逐字迁移纪律;秒位 round 不进位是既有展示瑕疵,单测注释锁定防意外变化,不在本 plan 修。
  - decision: ShotCard hover 展开用 onMouseEnter/Leave state(非 CSS :hover)
    rationale: 展开 block 改变卡高(布局变化),需 React state 驱动;grid 内纯 CSS hover 会导致 reflow 抖动。

requirements-completed: [NAV-02]

duration: 42 min
completed: 2026-08-22T01:35:00+08:00
---

# Phase 55 Plan 02: 分镜层级浏览 Summary

NAV-02:sceneGrouping 共享口径(17 用例)+ extractShots 增强(videoPrompt/referencedAssets,+4 用例)+ SceneShotBrowser 两级面板(viewMode 接线);零请求数据面。

**Duration:** 42 min · **Tasks:** 3/3(TDD ×2)· **Files:** 7

## What Was Built

- **sceneGrouping.ts**:SCENE_COLORS(v3theme.modality 四色)/sceneNumOf(首个数字段;S10 两位数不被 0* 吃)/sceneColorOf(循环+钳负)/formatTotalDuration(MM:SS);StoryboardTimeline 删本地定义改 import(行为零变化,24 既有用例不回归)
- **extractShots**:接口 +videoPrompt/+referencedAssets;Pass1 读 video_prompt/ltx_prompt;Pass5 global 资产双索引(characterCanonical/characterId/name/label 名字口径与 ShotTree 同源)→ characters 逐名回查(查不到保留名字 null 缩略)/场景候选 scene_id→scene→「场景 N」回查(查不到空数组)
- **SceneShotBrowser**:graph 派生零请求(禁 p10b board JSON,Pitfall 6);场景节头(3px 色带+「场景 N · X 镜 · MM:SS」+折叠保留计数时长);镜头卡(minmax(200px,1fr) 网格;16:9 降级链;shot_id mono 角标;时长/景别/运镜 chip METADATA_LABELS 中文;hover 画面提示 2 行截断+引用 24px 缩略横排);单击 setFocusAssetNodeId+setViewMode('canvas');空态文案逐字;全卡 button 键盘焦点
- **接线**:ViewMode +'scene_shots';工具栏 film 图标「分镜浏览」;渲染分支

## Self-Check: PASSED

- `npm test` **290/290**(23 文件;+17 sceneGrouping +4 extractShots... 与 55-01 的 +9 phaseRegistry 合计)
- 双根 tsc 0;api/v1/storyboard 引用 0;hex 字面量 0;scene_shots/分镜浏览 grep 齐

## 设计自检(UI-SPEC)

- ✅ 签名元素:3px 场景色带贯穿节头/卡缘(SCENE_COLORS 4 色只出现在场景分组表面,未混 phaseGroup 色)
- ✅ Typography:t1-t4 + 400/600 两档;mono 用于 shot_id/场景号
- ✅ token-only:零新造常量(间距/字号全 --cv-* 或 SCENE_COLORS 派生)
- ✅ Do-Not-Regress 4(focusAssetNodeId 语义不改)/5(全卡 button)/6(93 镜只按场景分组渲染,不平铺)

## Deviations from Plan

**[Rule 1 - 类型现实] 测试 fixture global meta assetType 用合法联合值('role'/'scene'),character 词汇走 raw** — Found during: Task 2 | Issue: meta.assetType 联合无 'character'(前端域是 'role') | Fix: fixture meta 用 'role',raw.assetType 'character'(Pass 5 raw 优先);生产侧 Pass 5 同步接受 'character'|'role' 双词汇 | Verification: tsc 0 + 290/290
**[Rule 1 - 契约] StoryboardShot 接口补 export(消费方 SceneShotBrowser import 需要)** — Found during: Task 3 | Issue: TS2614 接口未导出 | Fix: export interface | Verification: tsc 0

**Total deviations:** 2 auto-fixed。**Impact:** 无;双域词汇决定是必要的生产兼容。

## Issues Encountered

None.

---

Ready for Wave 2(55-03 旧表删除/55-04 SearchNavigator/55-05 lane 缩放记忆)。
