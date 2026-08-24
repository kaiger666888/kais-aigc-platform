---
phase: 60-post-save-panel-persistence
plan: "04"
subsystem: testing
tags: [e2e, panel-persist, d-09, self-echo, savedBy, re-anchor, anchor-miss, no-revival, d-12, regression, playwright]
requires:
  - phase: 60-post-save-panel-persistence
    provides: 60-02 savedBy 契约三件套(客户端跳过分支 + mock 回声观测面 logCall savedBy + 旋钮退役)与 60-03 D-03 warn 验收钩子(本 plan 四用例的全部被测机制)
provides:
  - packages/infinite-canvas/test/e2e/tests/phase60-panel-persist.mjs — D-09 四用例 e2e(六个 -g 组词可独立过滤;头部含地雷 #10/D-04/D-12 纪律)
  - main.tsx testMode 桥 getDetailNode/getSelectedNode 只读 seam — e2e 锚 id 真值断言面(D-09/D-07)
  - D-12 回归记录 — 五文件 18/18 + phase58 8/8 单次串行零红零 flake + 根 tsc 干净(文件头落档)
  - SC4 竞态销案(D-08)e2e 采样窗证据 — 2500ms 全画布角标恒 0,回声活性保留下由客户端自回声跳过消化
affects: [60-05 (verify 门聚合四用例计数/probe 复用 fixture 范式), PANEL-01/PANEL-02 断言面, phase52/59 回归面]
tech-stack:
  added: []  # 零新依赖(T-60-SC 兑现;playwright 既有)
  patterns:
    - "页内 MutationObserver toast spy(window.__toastLog): 3s 自灭瞬态 toast 的可靠捕获——监听 body 增节点文本命中两条精确串,替代事后 locator 竞态"
    - "DOM 延续探针(data-pw60-keep): 测试侧运行时打标记,同 id 重锚 React 复用同一 DOM 节点则标记存活——unmount/remount 的直接行为证据(RESEARCH Pitfall 6 'stay-mounted 非仅 re-opens')"
    - "面板宽度先拖离默认值再断言保持: 480 初值下宽度断言无区分度,resize 拖拽到 ≈560 后 ±2px 容差断言才有「未 unmount」证明力"
key-files:
  created:
    - packages/infinite-canvas/test/e2e/tests/phase60-panel-persist.mjs
  modified:
    - packages/infinite-canvas/src/main.tsx
key-decisions:
  - "面板标题真值链勘正: wire data.label 不进 V3 标题链——标题源是 wire 顶层 phaseName(V2 公共字段 §7 → migrate AssetNodeV3.phaseName → adapter data.label = phaseName || id)。fixture 顶层带 phaseName,test2 改名同步改 phaseName(计划原文仅改 data.label 的机制不可达)"
  - "D-07 断言载体换真锚: setSelectedNodeIds/getSelectedNodeIds 是 React Flow 瞬态镜像(onSelectionChange 在 setGraph 节点换血时被 RF 清空,FlowCanvas L621-623),重载后结构性必丢;对称真锚是 store.selectedNode(dblclick 双设 + setGraph L452/L455 相邻行同语义重锚)→ main.tsx 增 getSelectedNode 桥行(超出计划「仅 getDetailNode 一行」字面,Rule 3)"
  - "test4 采样前提补 exit 2: 计划步骤在 down-1 rerun(exit 1)后直接采样「全画布角标恒 0」——但 mid-1/down-2 角标未进该子集仍在画布(phase59 SC4 既有语义),全画布 0 不可满足;补 mid-1 角标点击(exit 2,链子集 [mid-1,down-2],phase59 SC4 同款第二出口)清完三条链再进 2500ms 采样窗"
  - "补充 phase58-recipe 8/8 回归(超出计划五文件字面): orchestrator 指定 + 实质合理——phase58 全用例走 saveCanvasGraph/savedBy 通道(60-02 单点身份附加改动的共享面),零红佐证六调用方兼容承诺"
  - "requirements.mark-complete 沿例跳过(60-01/02/03 同款): PANEL-01「真机保存 200…」的真机 probe(D-10)与 verify 门(D-11)由 60-05 收口(其 frontmatter 同携 PANEL-01/PANEL-02),届时勾选"
patterns-established:
  - "瞬态 UI 事件捕获三层法: 页内 MutationObserver spy(3s toast)/console listener(页内 reload 非导航,监听存活)/运行时 DOM 标记(unmount 探针)——后续任何「短命 UI 行为」e2e 断言的模板"
requirements-completed: []  # 断言面 mock 侧收口;真机 probe/verify 门待 60-05(见 key-decisions)
duration: 19min
completed: 2026-08-24
---

# Phase 60 Plan 04: D-09 四用例 e2e + D-12 全量回归 Summary

**mock 环境四用例全绿把 PANEL-01/PANEL-02/D-03/D-05/D-06/D-07/D-08 全部变成可重复行为断言(savedBy 上 wire/零 load-v2/warn 捕获/2500ms 角标采样窗机制证据),D-12 五文件+phase58 26/26 零红零 flake——SC4 竞态销案(D-08)采样窗定案。**

## Performance

- **Duration:** 19 min(00:06:13Z → 00:25:53Z UTC;本地 08-24 08:06-08:25 +08)
- **Completed:** 2026-08-24(本地)
- **Tasks:** 2/2
- **Files modified:** 2(1 created: phase60-panel-persist.mjs 414 行;1 modified: main.tsx 桥两 accessor)
- **Commits:** 823d1e98(Task 1)· a1246d11(Task 2)

## 四用例断言清单(逐 SC 映射)

### Test 1 「self-save keeps panel open, silent」(PANEL-01 / SC1 / D-05)

| 断言 | 证据面 |
|------|--------|
| save-v2 body.savedBy 匹配 `/^tab_/` | mock logCall 观测(60-02)——客户端身份上 wire 机制证据 |
| detail-panel 可见 + 标题不变 + getDetailNode().id === trig-1 + DOM 标记存活 | stay-mounted(Pitfall 6: 非「重新打开」) |
| `window.__toastLog` 空(两条 reload toast 精确串零命中) | silent(页内 spy 捕获 3s 瞬态) |
| load-v2 调用计数不变 | **未 reload 最硬信号** |
| 保存按钮文本回归「保存」 | D-05: 200 即反馈,唯一自保存成功反馈面 |

### Test 2 「other-client save reloads and re-anchors, symmetry preserved」(PANEL-02 / SC2 / D-06 / D-07)

| 断言 | 证据面 |
|------|--------|
| toast 命中「Pipeline 同步了新数据…」 | reload toast 只属他端(与 Test 1 silent 对照) |
| getDetailNode().id === trig-1 + getNodes 含 added-1 | reload 落地: 同 id 重锚 + 新真相进入派生模型 |
| 标题 === 「他端改名」 | D-06: 内容随新真相刷新,非冻结快照 |
| DOM 标记存活 + 「🔄 迭代」tab 仍 active(fontWeight 600) + 宽度 ±2px 保持(先拖至 ≈560) | 未 unmount 三重行为证明(panelWidth/tab 仅 unmount 才丢) |
| getSelectedNode().id === trig-1 | D-07 对称: 双锚同活(setGraph L452/L455 相邻行) |

### Test 3 「anchor-miss collapses honestly」(D-03)

| 断言 | 证据面 |
|------|--------|
| `[data-testid="detail-panel"]` count === 0 | 真收起,无占位、无模糊重锚漂移 |
| console 含 `[panel-persist]` 且含 `down-1` | 60-03 warn 验收钩子(默认串) |

### Test 4 「no-revival after rerun」(D-08 / SC4 销案)

| 断言 | 证据面 |
|------|--------|
| panelRegen(trig-1) → 三下游角标可见 + unrel-1 零角标 | 前置成立(负向锚) |
| exit 1(面板 stale-rerun-btn)清 down-1;mid-1/down-2 不受波及 | 既有 SC4 语义(子集隔离) |
| exit 2(mid-1 角标点击)清 mid-1/down-2 | Rule 3 补步(见 Deviations #4) |
| 2500ms 采样窗每 300ms 全画布 `svg[aria-label="stale"]` 计数全程 === 0 | **销案定案**: 回声活性保留(零 mock 旋钮)、两次 rerun 保存的 graph:saved 由客户端 savedBy 自回声跳过消化;跳过失效则 ~1s 复活窗(59 Known Issue #1)必被采样捕获 |

## D-12 回归报告

单次串行跑(playwright workers=1,dist 构建,根 `tsc --noEmit` 干净):

| 文件 | 通过 |
|------|------|
| phase52-regen.mjs | 3/3 |
| phase52-reroll.mjs | 2/2 |
| phase52-stale-panel.mjs | 4/4 |
| phase59-stale-cascade.mjs | 5/5(SC1/SC2/CR-02/SC3/SC4 全绿——SC1-SC3 实时性断言未受 savedBy 改动影响,plan 特别关注项确认) |
| phase60-panel-persist.mjs | 4/4 |
| **五文件合计** | **18/18** |
| phase58-recipe.mjs(补充,orchestrator 指定) | 8/8 |

**零红、零 flake(无隔离重跑需求;phase55-nav 负载噪音面不在本回归范围,未触碰)。**

## Verification

- `npm run build` 成功(dist 纪律,地雷 #10)
- `npx playwright test test/e2e/tests/phase60-panel-persist.mjs` → **4/4 绿**(exit 0)
- 六个 -g 组词独立过滤验证:`self-save`/`silent`/`other-client`/`symmetry`/`anchor-miss`/`no-revival` 各恰匹配 1 用例
- testid 纪律:grep 仅引用既有 `detail-panel`×5/`prompt-regenerate`×2/`prompt-section`/`stale-rerun-btn`,零新增(UI-SPEC §7)
- 根 `npx tsc --noEmit` 干净(Task 1/2 各验)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] fixture 面板标题不可达(计划 Test 2 改名断言机制错误)**
- **Found during:** Task 1 首跑(tests 1-3 标题断言全红,标题实为 'storyboard')
- **Issue:** 计划假定 wire `data.label` 流入面板标题——实际 V3 适配后 RF 节点 `data.label = asset.phaseName || id`(adapter L941),`AssetNodeV3.phaseName = n.phaseName ?? plan.stage`(migrate L519),wire data.label 本体不进标题链。
- **Fix:** fixtureNode 顶层带 `phaseName: data.label`(V2 公共字段 §7 合法用法,三节点标题可区分);Test 2 改名同步改 `phaseName` + `data.label`。
- **Files modified:** phase60-panel-persist.mjs
- **Commit:** 823d1e98

**2. [Rule 3 - Blocking] 保存按钮 locator strict-mode 撞车**
- **Found during:** Task 1 首跑
- **Issue:** `getByRole('button', { name: '保存', exact: true })` 解析到 2 元素——工具栏保存 + 面板 PromptSection 同名「保存」(prompt-save)。
- **Fix:** 收窄至 `.react-flow__panel.top.left`(工具栏 Panel;实测 RF Panel class 为空格分隔 `react-flow__panel top left`,非 `top-left`)。
- **Files modified:** phase60-panel-persist.mjs
- **Commit:** 823d1e98

**3. [Rule 3 - Blocking] D-07 断言载体结构性必丢 → 换真锚 + 桥补一行**
- **Found during:** Task 1 二跑(Test 2 尾断言红)
- **Issue:** 计划用 setSelectedNodeIds/getSelectedNodeIds 断言选中对称——该字段是 React Flow 瞬态镜像,onSelectionChange(FlowCanvas L621-623)在 setGraph 节点换血时被 RF 以空选回调清空,重载后结构性必丢(非本 phase 回归,既有设计)。
- **Fix:** 对称真锚 = store.selectedNode(openDetailPanel 的 dblclick 已双设 selectedNode+detailNode;setGraph L452/L455 相邻行同语义重锚)→ main.tsx 桥增 `getSelectedNode` 只读 accessor(D-07 e2e 观测面;超出计划「main.tsx diff 仅 getDetailNode 一行增量」字面,testMode 门内零运行时影响,注释注明缘由)。
- **Files modified:** main.tsx, phase60-panel-persist.mjs
- **Commit:** 823d1e98

**4. [Rule 3 - Blocking] Test 4 全画布采样前提不可满足 → 补 exit 2**
- **Found during:** Task 1 设计核对(plan 步骤序列与 phase59 SC4 语义矛盾推演,首跑即证)
- **Issue:** 计划 Test 4 步骤在 exit 1(down-1 rerun)后直接采样「全画布角标计数 === 0」——但 mid-1/down-2 角标未进 down-1 子集仍在画布(phase59 SC4 明文断言其保持),全画布 0 永不满足。
- **Fix:** 补 exit 2(mid-1 角标点击 → 链子集 [mid-1, down-2],phase59 SC4 同款第二出口)清完三条链后进 2500ms 采样窗;must_haves「rerun 重跑后 stale 角标归零且采样窗口内保持零」语义完整兑现(no-revival 覆盖两次 rerun 保存)。
- **Files modified:** phase60-panel-persist.mjs
- **Commit:** 823d1e98

### 流程偏差(非代码)

- **补充 phase58-recipe 回归:** 超出计划五文件字面(orchestrator 指定)——共享 saveCanvasGraph/savedBy 通道,8/8 零红佐证 60-02 六调用方兼容承诺;计数落档文件头。

## Auth Gates

None(mock :9876 本地,无认证门槛)。

## Known Stubs

None(四用例全部真实机制链路:socket 广播/saveCanvasGraph/setGraph 重锚/orchestrate;零 mock 旁路)。

## Threat Flags

None(T-60-06 toast spy 只读 DOM 零 store 写兑现;T-60-07 假绿风险缓解兑现——四用例各含机制证据(savedBy 上 wire/load-v2 计数/console.warn 捕获/采样窗),非仅 UI 观感;T-60-SC 零新依赖兑现)。

## TDD Gate Compliance

N/A(plan type: execute,非 tdd;四用例为行为验证面,无 RED/GREEN 循环要求)。

## Self-Check: PASSED

- packages/infinite-canvas/test/e2e/tests/phase60-panel-persist.mjs FOUND
- packages/infinite-canvas/src/main.tsx FOUND(含 getDetailNode/getSelectedNode)
- commits 823d1e98(Task 1) / a1246d11(Task 2) FOUND;两 commit 零文件删除
