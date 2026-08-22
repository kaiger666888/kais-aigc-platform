---
status: diagnosed
phase: 52-prompt-edit-regenerate-loop
source: [52-01-SUMMARY.md, 52-02-SUMMARY.md, 52-03 code commits dffafd26/1690e36c (SUMMARY owed), v3.0-ROADMAP Phase 52 SC1-4]
started: 2026-08-22T10:59:55+08:00
updated: 2026-08-22T15:45:00+08:00
verification: playwright-self-verified (mock e2e + real-backend headless probes, 2026-08-22)
---

## Current Test

[testing complete]

## Tests

### 1. PromptSection 显示当前 prompt
expected: 画布上打开一个由生成事件产出的资产节点详情面板,「分镜意图」下方出现 prompt 编辑区(textarea),预填产生事件当前配方的 prompt,可直接编辑
result: pass
evidence: "真后端 9999 深链 focus=a-p04-art4(老林-1975):prompt-section 渲染,textarea 预填 902 字符完整 prompt,开头与 DB 配方一致 (probe-52-real.mjs T1)"

### 2. 编辑 prompt 保存后跨刷新存活
expected: 修改 prompt 文本后点保存(乐观写入+save-v2 持久化);刷新页面重新打开该节点面板,显示的仍是编辑后的新 prompt,不是旧值
result: issue
reported: "playwright 自验:点保存后 save-v2 返回 HTTP 400 —— canvasAssetSchema universalRequired 要求 filePath 为非空 string,但图内 80+ 节点(sum-* 摘要卡、无媒体资产)无 filePath;失败回滚路径正常工作(草稿还原、无数据写入、零足迹)"
severity: blocker
root_cause: "src/lib/canvasAssetSchema.ts L23-24 filePath z.string().min(1) 对所有 asset 型节点必填;serialize.ts L261-263 明写『filePath 必填由管线数据保证,序列化器不兜底』——但 kmc sync 直写 DB 的真实图普遍含无 filePath 的 asset 节点,契约假设破产。**波及面=全部项目**:项目 2/2001/1/9999 的 load-v2 原图原样回发 save-v2 均 400(连不编辑的顶栏保存也挂),非 prompt 编辑特有"
artifacts:
  - path: "src/lib/canvasAssetSchema.ts"
    issue: "L23-24 universalRequired.filePath 必填;asset schema 另要求 label/assetType 必填(项目 1/2 实测同样触发)"
  - path: "packages/infinite-canvas/src/v3/serialize.ts"
    issue: "L261-263 media.original==null 时不写 filePath(不兜底是显式设计决定,依赖管线数据保证)"
missing:
  - "裁定无媒体 asset 节点(summary 卡/文本资产)的 filePath 豁免通道:schema nullable/optional 化,或 save-v2 对 pre-existing 节点宽容校验,或 sync 侧补齐字段"
  - "同理复核 label/assetType 必填对存量图的影响(项目 1 p10_images、项目 2 n-p04 实测触发)"

### 3. 一键重生成(改 prompt→重抽)
expected: 保存新 prompt 后「重生成」按钮可用(未保存时防误触),点击触发该节点的生成任务(节点进入 running),完成后新结果回贴同一节点
result: issue
reported: "按钮态契约真机通过(编辑中重生成 disabled=防半编辑误触发,保存后 enabled;probe T3-state);mock e2e 探针复现 test-a 核心断言全过:execute body.prompt/params.prompt=新 prompt、nodeId=资产 id 非 evt_*、nodeType 正确(probe-52-regen-a.mjs)。但真后端因 Test 2 的 save-400,新 prompt 无法落盘,重生成只能携带旧配方 → 真机闭环断在保存环节。'新结果回贴节点'(socket node:state → 卡片刷新)未在真机验证"
severity: major
root_cause: "被 Test 2 blocker 挡断(保存 400 → canonical 未更新 → handleRegenerate 读 canonicalPrompt 提交旧值);提交通道本身(executeNode extra + zod params)52-02 已就绪且 mock 实证"
artifacts:
  - path: "packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx"
    issue: "L683-703 handleRegenerate 以 canonicalPrompt 提交——依赖保存成功,是设计内行为"
missing:
  - "解除 Test 2 blocker 后真机提交一次生成任务,验 running 反馈 + 结果回贴"

### 4. 落选变体 prompt 区只读
expected: 打开已落选(loser/deprecated)变体资产的详情面板,prompt 区只读,保存/重生成按钮禁用(无产生事件,配方已并入 winner)
result: issue
reported: "只读保护已实现(commit 1690e36c:isLoserVariant→readonly hint + 双按钮 disabled + textarea disabled)但**UI 入口不可达**:migrate Pass 3 保留落选节点为 curation:'deprecated',但渲染端不把落选候选画上画布(截图实证:仅 winner『分镜候选 A』渲染,loser B 只存在于左侧分镜列表);侧栏 focusShot 只聚焦画布不开面板 → 只读态无法被用户观察到。盘上 e2e REGEN-01-c 因此失败(注入的 sb-cand-b locator 永不出现)"
severity: minor
root_cause: "渲染层对 deprecated 候选不上画布(变体墙/Phase 53 领域)与 52-03 只读保护(详情面板领域)的接缝缺口:e2e 与用户均无路径打开落选节点详情面板"
artifacts:
  - path: "packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx"
    issue: "L640-670 只读分支实现完整,但入口(画布 dblclick/侧栏 focusShot)都到不了 deprecated 节点"
  - path: "packages/infinite-canvas/test/e2e/tests/phase52-regen.mjs"
    issue: "REGEN-01-c 用例经 save-v2 注入变体组后 dblclick sb-cand-b,该节点不渲染 → 用例必败(审计注记的 2 e2e failures 之一)"
missing:
  - "裁定落选变体详情入口:变体墙卡点开详情 / 侧栏 focusShot 打开面板 / 或明确产品决定=落选不可看详情(则删 e2e 用例)"

### 5. stale 角标跨刷新存活
expected: 上游变更(如审核通过)使下游资产出现 stale 琥珀角标后,刷新页面角标仍在(stale 信息经 wire round-trip 不再刷新即丢)
result: pass
evidence: "pass-by-automation(用户裁定 2026-08-22):52-02 serialize 写 data.stale 三字段 ↔ migrate restoreStaleInfo 轻校验还原,flowgraph-v3 vitest 128/128 含 migrate.test 3 用例(stale 还原相等/缺失→null/畸形→null)"

### 6. 重跑后 stale 角标消除
expected: 带 stale 角标的节点重新执行进入 running/成功后角标自动消失;执行失败则角标保留
result: pass
evidence: "pass-by-automation(用户裁定 2026-08-22):52-01 applySocketNodeState running/success 清 stale、failed 留(含 error 归一 failed),canonicalWriteback.test 5 组断言绿(success 清/running 清/failed 留/transform-survival/evt_ 守卫)"

### 7. 换 seed 重跑(REGEN-02)
expected: 事件芯片 popover 中点「🎲 同配方换 seed 重跑」,以同配方+新随机 seed 提交执行任务,按钮有 pending 态反馈,不再是仅 console.log+提示的 TODO 残桩
result: issue
reported: "代码审查+运行态确认:EventParamsPopover.tsx L8/L49-53 handleRerollSeed 仍是『TODO(执行后端): 接 pipeline 重跑入口(同 op + 同配方换 seed)。本期仅组装 + 提示』+ console.log 残桩,点击无任务提交、无 pending 态"
severity: major
root_cause: "plan 52-04 从未执行(零 commit):REGEN-02 未实现;52-02 已备好 executeNode extra {params:{...recipe, seed}} 提交通道但前端未接线"
artifacts:
  - path: "packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx"
    issue: "L49-53 TODO 残桩"
  - path: ".planning/phases/52-prompt-edit-regenerate-loop/52-04-PLAN.md"
    issue: "计划已在盘,wave 2,零执行"
missing:
  - "执行 52-04-PLAN(EventChipClickInfo 补 projectId/episodesId + handleRerollSeed 接 executeNode + pending 态 + e2e phase52-reroll.mjs)"

### 8. stale 下游一键重跑(REGEN-03)
expected: stale 角标或节点详情区提供「重跑下游」出口,点击后复用 orchestrate 批量执行通道重跑整条 stale 链(带进度反馈),完成后 stale 标记消除
result: issue
reported: "useStaleRerun.ts 不存在;NodeBadges 的 stale 三角无点击出口;NodeDetailPanel 无『重跑下游』按钮 —— REGEN-03 的用户可达出口零实现(stale 角标本身、服务端 stale-success 不跳过谓词、socket 清除链已就绪)"
severity: major
root_cause: "plan 52-05 从未执行(零 commit);地基(52-01 getDownstreamIds + 52-02 wire/orchestrate)齐备但 UI 层未接"
artifacts:
  - path: ".planning/phases/52-prompt-edit-regenerate-loop/52-05-PLAN.md"
    issue: "计划已在盘,wave 3,零执行;同时覆盖 REGEN-04"
missing:
  - "执行 52-05-PLAN(useStaleRerun hook + NodeBadges/NodeDetailPanel 出口 + orchestrateCanvas 子集 + e2e)"

### 9. 详情面板默认宽度 ~480px(REGEN-04)
expected: 详情面板默认宽度约 480px(不再占 75% 屏宽),仍可拖拽边缘调整宽度
result: issue
reported: "playwright 实测:1600px 视口下面板宽 1200px(ratio 0.75)——NodeDetailPanel L38-41 仍 window.innerWidth*0.75;且 75% 宽度把画布左侧只剩 400px,probe 中节点 B 的点击被面板遮挡(本身就是审片场景痛点实证)"
severity: minor
root_cause: "REGEN-04 归属 plan 52-05,从未执行"
artifacts:
  - path: "packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx"
    issue: "L38-41 useState 初值 window.innerWidth*0.75"
missing:
  - "默认宽改 ~480px(拖拽调宽保留,52-05-PLAN 范围)"

### 10. 单击切换节点面板保持打开(REGEN-04)
expected: 面板打开状态下单击另一个节点,面板保持打开且内容立即切换到新节点,审片场景不再反复开合
result: issue
reported: "playwright 实测(点击面板外可见节点 a-p04-art31,选中态已切换):面板保持打开=true 但内容**不跟随**(仍显示 art4 的 char_laolin_young 详情)。FlowCanvas L586-593 onNodeClick 现行为是 setDetailNode(null)(注释:单击面板自动缩回)——实测既未缩回也未跟随,单击只改选中环不改面板"
severity: minor
root_cause: "REGEN-04 归属 plan 52-05,从未执行;现交互=单击仅选中,双击才开面板,面板内容不跟随单击"
artifacts:
  - path: "packages/infinite-canvas/src/components/FlowCanvas.tsx"
    issue: "L586-593 onNodeClick setDetailNode(null) 语义与『保持打开+跟随』spec 相反"
missing:
  - "单击已开面板时切换 detailNode 到新节点(52-05-PLAN 范围)"

## Summary

total: 10
passed: 3
issues: 6
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "编辑 prompt 保存后跨刷新存活(save-v2 持久化)"
  status: failed
  reason: "save-v2 HTTP 400:asset 节点 filePath 必填,真实 sync 图普遍缺失;全部项目原图回发均 400,画布保存路径整体不可用"
  severity: blocker
  test: 2
  root_cause: "canvasAssetSchema universalRequired(filePath/label/assetType) 对 sync 存量图过严;serialize 不兜底是显式设计但契约假设(管线数据保证)不成立于 sync 写入路径"
  artifacts:
    - path: "src/lib/canvasAssetSchema.ts"
    - path: "packages/infinite-canvas/src/v3/serialize.ts"
  missing:
    - "裁定并落地无媒体/存量节点的宽容校验通道"
  debug_session: ""

- truth: "改 prompt→保存→重生成闭环(任务参数含新 prompt,新结果回贴节点)"
  status: failed
  reason: "真机断在保存 400;mock 层全链已实证(body.prompt/params.prompt/nodeId 正确)"
  severity: major
  test: 3
  root_cause: "被 test-2 blocker 挡断;提交通道(executeNode extra + zod params)已就绪"
  artifacts: []
  missing:
    - "解除保存 blocker 后真机提交+结果回贴验证"
  debug_session: ""

- truth: "落选变体详情面板 prompt 区只读可观察"
  status: failed
  reason: "只读实现完整但落选节点不渲染上画布,详情面板无入口;e2e REGEN-01-c 因此必败"
  severity: minor
  test: 4
  root_cause: "渲染层(变体领域)与面板层(52-03)接缝:deprecated 候选无详情入口"
  artifacts:
    - path: "packages/infinite-canvas/test/e2e/tests/phase52-regen.mjs"
  missing:
    - "裁定落选变体详情入口(变体墙/侧栏/或删用例)"
  debug_session: ""

- truth: "EventParamsPopover 换 seed 重跑提交任务+pending 反馈"
  status: failed
  reason: "TODO/console.log 残桩,REGEN-02 未实现(plan 52-04 零执行)"
  severity: major
  test: 7
  root_cause: "52-04-PLAN 未执行"
  artifacts:
    - path: "packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx"
  missing:
    - "执行 52-04-PLAN"
  debug_session: ""

- truth: "stale 下游一键重跑出口(角标/详情区)"
  status: failed
  reason: "useStaleRerun 不存在,UI 出口零实现(地基已齐)"
  severity: major
  test: 8
  root_cause: "52-05-PLAN 未执行"
  artifacts: []
  missing:
    - "执行 52-05-PLAN"
  debug_session: ""

- truth: "面板默认 ~480px + 单击切换保持打开且内容跟随"
  status: failed
  reason: "实测 1200px(75%);单击面板不缩回但内容不跟随"
  severity: minor
  test: 9
  root_cause: "52-05-PLAN(REGEN-04)未执行"
  artifacts:
    - path: "packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx"
    - path: "packages/infinite-canvas/src/components/FlowCanvas.tsx"
  missing:
    - "执行 52-05-PLAN"
  debug_session: ""

---

## Session Notes

### 自动验证方法与足迹(2026-08-22,本会话)
- mock e2e:`npx playwright test phase52-regen.mjs` → 1 passed(REGEN-01-b reload 往返)+ 2 failed(**均为测试装置问题非产品缺陷**:a=保存后面板保持打开挡住重开 dblclick,核心断言经 probe-52-regen-a.mjs 复现全过;c=注入的落选节点不渲染,见 test-4 gap)
- 真后端 probe:probe-52-real.mjs(deep-link focus 开面板;编辑-保存-400-回滚;零数据足迹,save 全被 400 拒绝,原图无损)、probe-52-panel.mjs / probe-t10c/d.mjs(T9 宽度、T10 跟随)
- save-v2 400 波及面实测:项目 1/2/2001/9999 load-v2 原图原样回发均 400
- 探针脚本(未跟踪,复验用):packages/infinite-canvas/test/e2e/probe-52-regen-a.mjs, probe-52-real.mjs, probe-52-panel.mjs, probe-t10c.mjs, probe-t10d.mjs
- mock backend(9876)为本会话手动拉起,复验后可杀

### 代码状态基线(master @ a42967bd)
- 52-01/02/03 已提交(9 feat commits)且已部署(dist 08-22 09:54,service 09:45 重启)
- **52-04/05/06 零执行**:EventParamsPopover TODO 残桩、useStaleRerun 不存在、面板 75%、verify-phase-52.ts 不存在
- v3.0 审计把 REGEN-01..04 记为 delivered-by-evidence-code-only —— 本次 UAT 实证:REGEN-01 半通(显示+mock 闭环过,真机保存 blocker)、REGEN-02/03/04 未实现
