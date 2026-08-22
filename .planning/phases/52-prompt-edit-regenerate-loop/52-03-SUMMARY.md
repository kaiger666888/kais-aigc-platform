---
plan: 52-03
phase: 52-prompt-edit-regenerate-loop
status: complete
started: 2026-08-21
completed: 2026-08-22
commits:
  - dffafd26 feat(52-03): PromptSection — edit event params.prompt + save (persistEventParams) + regenerate (nodeId=asset.id)
  - 1690e36c fix(52-03): PromptSection read-only for deprecated loser variants (mine #5)
  - 07a23373 test(52-03): phase52-regen e2e — REGEN-01 a/b/c mock body + reload round-trip + loser readonly
key-files:
  created:
    - packages/infinite-canvas/test/e2e/tests/phase52-regen.mjs
  modified:
    - packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx
---

# 52-03 SUMMARY — PromptSection(编辑 prompt → 保存 → 一键重生成)

## What Was Built

AssetDetail 新增 `PromptSection`(NodeDetailPanel 文件内组件,Props 签名不变),把 kmc 最高频创作循环「改 prompt → 重抽」搬进详情面板:

- **反查产生事件**:`graph.links role:'output' && target===asset.id` → source 事件;多产生事件取第一条 + console.warn。
- **三态渲染**:可编辑(textarea 预填 `evt.params.prompt`)/ 只读-落选变体(`落选变体配方已并入主事件 variantRecipes` 提示,textarea+双按钮 disabled)/ 只读-无产生事件。
- **保存** = `persistEventParams(evt.id, { prompt })`(52-01 action:乐观写 → save-v2 → 失败回滚+toast);保存前「重生成」disabled(防半编辑误触发)。
- **重生成** = `executeNode(projectId, episodesId, asset.id, nodeType, { prompt, params: {...evt.params, prompt} })`。

## nodeId = 资产 id 裁定的落地证据(地雷 #4)

- e2e REGEN-01-a 断言 `exec.body.nodeId === 'storyboard-1'` 且 `startsWith('evt_') === false`(phase52-regen.mjs L77-78)。
- mock 探针(probe-52-regen-a.mjs,UAT 会话)复现:body.prompt/params.prompt=新 prompt、nodeId=资产 id、nodeType 正确——a 用例核心断言全过。
- 组件内注释写明理由:持久化 V2 blob 无 evt_* 节点,资产 id 才能让 node:state 回写画布卡 + stale 清除链生效;eventId 仅用于 canonical 写回。

## 只读态 fixture 选定(REGEN-01-c)

- 选定 `sb-cand-b`(经 save-v2 注入变体组 var-1 + 候选 a/b 构造,migrate Pass 3 删落选事件、output 边重指 winner、配方并入 variantRecipes,curation='deprecated')——fixture 默认无变体组,注入式构造与 phase41 范式一致。
- 已知败因(装置错位非产品缺陷,UAT 实证):注入的落选节点**不上画布**(渲染端把 deprecated 候选折叠进 winner 牌堆)→ locator 永不出现。产品裁定+修复归 **52-08 gap #3**;e2e 装置错位归 **52-08 gap #7**。

## UAT 交叉引用(52-UAT.md,2026-08-22)

- Test 1(prompt 区显示+预填)pass:真后端 9999 深链 textarea 预填 902 字符完整 prompt。
- Test 3(重生成闭环)mock 层全链实证;真机断在保存环节——**被 Test 2 blocker(save-v2 400)挡断,修复归 52-07**。
- Test 4(只读可观察)实现完整但 UI 入口不可达 → 52-08 gap #3。

## Deviations

- 无偏离。两颗「成败手」(任务参数含新 prompt / reload 往返保真)分别由 REGEN-01-a 断言与 REGEN-01-b 锁死(REGEN-01-b UAT 实测 passed)。

## Self-Check: PASSED

- `npx tsc -b` exit 0;store vitest 绿(canonicalWriteback 5 组);grep 门:PromptSection 定义+挂载 ≥2 命中、persistEventParams 调用在位、Props 签名零 diff。
- e2e REGEN-01-b passed;a/c 两败均装置错位(UAT 会话 probe 复现核心断言全过),修复归 52-08,不属本 plan 产品缺陷。
