---
phase: 53-variant-contract-picker-upgrade
plan: 02
subsystem: variant-wall-ui
tags: [var-02, screening-theater, sync-play, keyboard, thumb-self-heal, tdd]

# Dependency graph
requires:
  - phase: 51-canonical-write-path
    provides: canvasStore.selectWinner v3 optimistic 路径(选定通道,墙只改"谁调用")
  - phase: 49-selection-write-back
    provides: selectVariantWinner POST + variant:selected 广播(echo 由 graph store 守卫吸收)
  - phase: 53-variant-contract-picker-upgrade/53-01
    provides: 契约地基(envelope;本 plan UI 侧暂不直接消费,53-03/53-05 接)
provides:
  - wallTransport.ts:createMasterTransport(rAF 主时钟唯一真值/120ms 硬 seek/min-span 回绕/solo mute/stall 对齐/attach-detach-dispose)7 不变量 vitest 锁死
  - useWallKeyboard.ts:D-20 键盘流(1-9 检视/Enter 选定/←→ 切组占位/空格 同播 preventDefault/Esc 关)5 组测试
  - healThumb.ts:createThumbHealer(fetch 注入)三段自愈——单次触发保护//oss/ 白名单//_thumbs/ 切换/占位回退,4 断言锁死(T-53-02-01/02 缓解)
  - VariantWall.tsx:全屏审片剧场(lightboxOverlay 暗底/N-up auto-fit 网格/共享主 playhead 可拖=签名元素/胶片条 aiScore 徽章+seed mono+prompt 截断/检视详情行维度 chips/显式「选定」)
  - variantPickerStore:wall:{groupId} 态 + openWallByGroup(既有 open 协议不动)
affects: [53-03 组物化后墙才有 kmc 组可开, 53-05 frameSlot/串行下一镜接线, 53-06 入口扩展+旧 Picker 删除]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "同播主时钟:masterTime 只由 rAF delta 累加,绝不回读 video.currentTime(反馈环);漂移>120ms 硬 seek,不用 playbackRate"
    - "检视=展开+solo 声合一(D-08/D-06 同一动作);选定是显式第二动作(按钮/Enter),墙不自动关"
    - "缩略自愈三段:onError → 一次性 POST(标记先于请求,失败不重试)→ /_thumbs/ 换 URL;非 /oss/ 零请求;never-throws 占位兜底"
    - "node-env 可测纯模块:rAF 缺失护守 + tickForTest 驱动同一内部 tick;测试与生产行为同源"
    - "handlers ref 转发:键盘 listener 只挂一次,内联闭包每渲染可变"
    - "P10 echo 继承:墙零 socket 订阅,选定 echo 走 graph store 既有 variant:selected 守卫"

key-files:
  created:
    - packages/infinite-canvas/src/components/variants/wallTransport.ts
    - packages/infinite-canvas/src/components/variants/useWallKeyboard.ts
    - packages/infinite-canvas/src/components/variants/healThumb.ts
    - packages/infinite-canvas/src/components/variants/VariantWall.tsx
    - packages/infinite-canvas/src/components/variants/__tests__/wallTransport.test.ts
    - packages/infinite-canvas/src/components/variants/__tests__/useWallKeyboard.test.tsx
    - packages/infinite-canvas/src/components/variants/__tests__/healThumb.test.ts
  modified:
    - packages/infinite-canvas/src/components/variants/variantPickerStore.ts
    - packages/infinite-canvas/src/components/FlowCanvas.tsx
    - scripts/verify-phase-53.ts
    - packages/infinite-canvas/src/theme/cattpuccin.ts

key-decisions:
  - decision: WallCandidate view-model 手写 interface(V3 节点为主 + RF data 补 prompt/seed/variant)
    rationale: 包内不 import root schema(P8);组数据走 graph.variantGroups(绝不走 deprecated-only 的 VariantStackData——53-RESEARCH Critical Gap)。
  - decision: video detach 弱化——React 卸载时 ref 回调拿不到旧元素,detach 靠组重渲 attach 幂等 + dispose 兜底
    rationale: attach 有 includes 去重;换组时旧 video 元素卸载,新元素重新 attach,transport 内数组短暂持有已卸载元素仅造成无害的属性赋值。
  - decision: playhead UI 镜像节流 ~15fps(66ms)
    rationale: 60fps setState 重渲 N-up 墙成本高;15fps 对进度条人眼足够平滑;拖动走 onChange 即时 seek。
  - decision: FlowCanvas Esc 守卫加 wall 态
    rationale: 墙开着时画布 Esc 不应连带关详情面板(useWallKeyboard 自己处理 Esc 关墙)。

requirements-completed: [VAR-02]

duration: 22 min
completed: 2026-08-21T22:12:00Z
---

# Phase 53 Plan 02: 变体墙引擎 + 全屏审片剧场 Summary

同播主时钟纯逻辑(rAF 真值 + 120ms 硬 seek + solo 静音 + min-span 回绕 + stall 对齐)、D-20 键盘流 hook、三段缩略自愈纯模块(fetch 注入)、VariantWall 全屏剧场组件——TDD 红-绿落地,墙取代 FlowCanvas 挂载位的旧 Picker 主体。

**Duration:** 22 min · **Tasks:** 3/3(TDD ×2)· **Files:** 11

## What Was Built

- **wallTransport.ts**(纯模块,零 React):createMasterTransport + HTMLVideoElementLike 注入接口;rAF 主时钟为唯一真值;每 tick 每 video solo 静音 + 漂移硬校正;'waiting' stall 全场暂停对齐;attach/detach/dispose 生命周期完整。**7/7 不变量测试绿。**
- **useWallKeyboard.ts**:D-20 全套键映射;handlers 经 ref 转发,listener 单次挂载;Space/Enter preventDefault。**5/5 测试绿(react-dom/client + React 19 act,AssetCardNode 同款范式)。**
- **healThumb.ts**:三段自愈,单次触发标记先于请求、/oss/ 白名单零请求、/_thumbs/ 才算 healed、never-throws。**4/4 行为锁死(T-53-02-01/02 缓解落测试,非仅 grep)。**
- **VariantWall.tsx**:全屏暗色剧场;N-up auto-fit(320px)墙 + 每格 playhead 镜像 + 共享可拖主 playhead(签名元素:跨变体同步走带);胶片条 160px 卡(getScoreColor 徽章取整分/无 score 显 verdict 弱文本/seed mono/prompt 单行截断);检视详情行(完整 prompt + 维度 chips modalityWeak 底);显式「选定」→ selectWinner + triggerStaleCascade,墙不关;「下一镜」渲染禁用(53-05)。
- **variantPickerStore**:wall:{groupId} + openWallByGroup;close 同清两态;既有牌堆 open 协议不动。
- **FlowCanvas**:<VariantPicker /> → <VariantWall />;Esc 守卫覆盖 wall 态。

## Self-Check: PASSED

- variants 套件 16/16;全套件 235/235;`npx tsc -b` exit 0;root `npx tsc --noEmit` exit 0
- `npm run verify:phase-53` 35/35 复绿(含 S1 契约不回归)
- FlowCanvas 无 `<VariantPicker` 残留;VariantWall 无 💾/variantStack(反双轨)
- healThumb 零 react import;含 `/canvas/v2/thumbnail` + `/_thumbs/` 字面

## Deviations from Plan

**[Rule 2 - 环境] cattpuccin.ts 意外入库** — Found during: Task 3 提交 | Issue: 主题文件 src/theme/cattpuccin.ts 处于 staged-未提交状态且遭遇文件系统悬空 dentry(dirent 在、open 返回 ENOENT,会话中途发生);执行者从 git 对象库(blob 39ec28f3)恢复内容并 update-index --add 复原 entry 后,该 entry 留在暂存区被 Task 3 提交一并带入 | Fix: rm 悬空 dirent → git cat-file 重写文件 → 索引 entry 复原;入库后仓库一致性反而修复(20+ 组件 import 该文件,HEAD 树缺失才是异常——新 clone 之前根本 build 不过) | Files: packages/infinite-canvas/src/theme/cattpuccin.ts | Verification: tsc -b + 235/235 + 墙渲染依赖链全绿 | Commit: ea36f7c5
**[Rule 2 - 工具链] useWallKeyboard 测试范式从 renderHook 改为 createRoot+act** — Found during: Task 2 | Issue: @testing-library/react 不是包依赖 | Fix: 照 AssetCardNode.playBadge 范式(react-dom/client + React 19 act + Probe 组件),行为断言不变 | Files: __tests__/useWallKeyboard.test.tsx | Verification: 5/5 | Commit: f6ad9f31
**[Rule 1 - 测试设计] wallTransport 测试 1/2 尊重锚定+阈值语义修正** — Found during: Task 1 GREEN | Issue: 初版测试未考虑首帧只锚定不推进、以及 ≤120ms 漂移按设计不赋值 | Fix: 测试预置远离 target 的起点 + 双 tick(锚定+推进)——实现未改,DR-5 语义为准 | Verification: 7/7 | Commit: 002001cb

**Total deviations:** 3 auto-fixed(环境 1 / 工具链 1 / 测试设计 1)。**Impact:** 无行为影响;cattpuccin.ts 入库净改善仓库一致性。

## Issues Encountered

None blocking。注:cattpuccin.ts 悬空 dentry 的根因(盘符/overlay 异常)未深究,若再现需查 FS 健康。

---

Ready for 53-03(候选组物化——kmc 候选不在 canvas variantGroups 的 Critical Gap)。
