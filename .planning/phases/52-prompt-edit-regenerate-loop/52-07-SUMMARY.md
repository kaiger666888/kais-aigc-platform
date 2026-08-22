---
plan: 52-07
phase: 52-prompt-edit-regenerate-loop
status: complete
started: 2026-08-22
completed: 2026-08-22
gap_closure: true
commits:
  - "fix(52-07) schema/serialize: canvasAssetSchema 存量宽容化 + serialize 注释纠正(见 git log)"
  - "test(52-07): verify-save-v2-legacy 行为锁 + npm 注册"
  - "fix(52-07): migrate Pass 3 防御 — 变体组候选事件缺失不再整图崩溃"
  - "fix(52-07): execute allowlist 补齐 V3 Stage 全集 — 真机重生成 400 修复"
  - "test(52-07): probe-52-real 两段式真机探针"
key-files:
  created:
    - scripts/canvas/verify-save-v2-legacy-asset.ts
    - packages/infinite-canvas/test/e2e/probe-52-real.mjs
  modified:
    - src/lib/canvasAssetSchema.ts
    - src/routes/canvas/execute.ts
    - packages/infinite-canvas/src/v3/serialize.ts
    - packages/flowgraph-v3/ts/src/migrate.ts
    - packages/flowgraph-v3/ts/tests/migrate.test.ts
    - package.json
---

# 52-07 SUMMARY — save-v2 存量宽容化(52-UAT Test 2 blocker)+ REGEN-01 真机闭环(gap #1/#2)

## 修前诊断回放(宽容面依据,改代码前实测)

4 scope load-v2 原图原样回发 save-v2,修前**全 400**,失败节点按 `{type × 缺失字段}` 聚合(undefined 形态为主 + 显式 null):

| type.field | 数量 | 形态 |
|---|---|---|
| script.description | 127 | undefined |
| audio.shot_id / engine | 75 / 75 | undefined |
| audio.filePath | 74 | undefined |
| filePath(全类型) | 121 + 3 | undefined + **null** |
| storyboard.shot_type | 48 | undefined |
| asset.filePath / assetType / label | 43 / 9 / 3 | undefined |
| duration_sec(audio/storyboard) | 32 + 9 | undefined |
| video.shot_id/engine/duration_sec/resolution | 19×4 | undefined |

**计划预判(asset-only)被实测证伪**:script/audio/storyboard/video 存量形态同样失败。plan 自带的「以实测为准 + 按同款注释模式扩展」条款授权扩展;不扩展则 must-have#1(四项目全 200)不可达——「audio/video 一字不动」的前提「管线数据保证必填」被同一回放证伪(kmc sync 直写 DB 绕过 HTTP,此门只拦 UI 回写)。

**nullish 不降级**:全部缺失形态为 undefined/null,**零空串**——保 `min(1)/min(0)`(在场仍强制形状:空串/负数照旧 400,行为锁双分支锁死)。

## 项目→episodesId 映射(实测非空 scope,非「第一集」)

plan 预判「每项目取第一 episodesId」;实测 1/1、9999/9999 等为空 scope,取非空:**(1,2) 8 节点 / (2,1) 31 / (2001,1) 31 / (9999,1) 489**(执行中 9999 被并行会话 sync 重写为 479,详见下文)。

## schema 落地

- asset 段摘除 `...universalRequired` 展开,filePath/label/assetType 三字段独立 nullish(plan 原范围);label 无缺失证据的类型(**storyboard/script label**)维持必填。
- universalRequired.filePath + audio(shot_id/engine/duration_sec) + video(+resolution) + storyboard(shot_id/shot_type/duration_sec) + script(description;filePath optional→nullish 收显式 null)按证据 nullish 化(**偏差,上述授权内**)。
- `EXPECTED_PARAM_FIELDS_BY_TYPE` 零改动(verify:schema-drift 10/10 复核绿;⚠ 该文件注释不得出现此常量全名——其正则锚定首次出现,注释抢先会解析到 universalRequired 块)。
- serialize.ts L261 注释改写(仅注释):「filePath 必填由管线数据保证」假契约纠正。
- grep 门:universalRequired 4 处 = 1 def + audio/video 展开 ×2 + asset 段注释提及 1(plan 预期 3 的差异为注释文本,结构断言以行为锁 source 节为准)。
- **verify-canvas-shot-timeline additive-only 计数突破**:本修复有意 +15 nullish(asset3+audio3+video4+storyboard3+script2 含 universal 1);该脚本为一次性 Phase 46 产物,未挂任何 npm verify 门(package.json 无注册),突破无害——计划预判条款兑现。

## verify:save-v2-legacy 行为锁(17 断言,exit 0)

- 行为节:存量形态(undefined/null × 5 类型)放行 + 在场非法(audio filePath 空串/video resolution 空串/duration_sec 负数/asset label 空串)拒绝。
- source 节:save-v2/nodes.ts 校验门仍在、audio/video 段仍展开 universalRequired、asset 段不再展开、nullish 覆面 ≥15。
- forced-fail 自检:临时摘 audio engine nullish → FAIL 16/17 → 恢复 17/17。
- 注意:与 plan 原稿断言方向不同——原稿「audio 缺 filePath → 错误串」基于 asset-only 预判;证据驱动后缺失=放行,**在场空串**才是错误串断言(原契约的形状下限保留)。

## Part A 回放门 + verified no-op(修后)

| scope | save-v2 | 回读深度比对 |
|---|---|---|
| 1/2 | **200**(修前 400) | 全等 |
| 2/1 | **200** | 全等 |
| 2001/1 | **200** | 全等 |
| 9999/1 | **200** | 全等 |

剔除字段 = meta.updatedAt + **meta.lastEventId**(实测发现:save-v2 簿记字段,每次保存必然变动——时间戳+事件序号,health-poll 靠它探变更;非图内容。plan 只预判了 updatedAt)。图内容 nodes/links/branches/variantGroups 及 meta 其余键逐项全等——修复后的保存是 verified no-op。

## Part B REGEN-01 真机闭环(gap #2 / UAT Test 3 missing 项)

B1 保存 200(修前 400)→ B2 reload 往返显新 prompt(UAT Test 2 truth)→ B3 重生成 toast「已提交重生成」+ state **running→success**(socket 链)→ B4 原图回存 + reload 复核回原值(**净足迹=0**)。

## 执行中发现并修复的两颗真机地雷(计划外,Part B 挡断点)

1. **migrate Pass 3 整图崩溃**:并行会话 kmc sync 重写 9999(489→479 节点,envelope 变体组)后,**两个变体组共享候选**——组A合并删除候选事件,组2非空断言 `eventById.get(...)!` throw → adaptV2Graph 降级空图 → **整个 9999 画布消失**(横幅「该项目暂无数据」,479 节点渲染 0)。修复:事件缺失 warn+跳过合并(不造悬空边);migrate.test 双用例回归锁(组间共享候选/winner 事件被前组消费);flowgraph-v3 **130/130** 绿。适配器离线实证:修复前 0 节点 → 修复后 955 节点(958-3 组节点)。
2. **execute allowlist 缺 V3 Stage**:REGEN 提交 nodeType=V3 asset.stage(52-03 地雷 #4 裁定),p04 角色节点 stage=**'global'** 不在 allowlist → 真机重生成 400(mock fixture 只有 storyboard,e2e 测不出)。补齐 Stage 全集(global/keyframe/voice/foley/bgm/mix/composite)。

## 并行会话互操作记载

- build:server 曾捆绑并行会话未提交的 load-v2.ts/candidateGroupDeriver.ts WIP 部署——diff 核对为**纯类型标注**(行为惰性),无功能影响;后续并行会话自行部署时自然收敛。
- 9999 图被并行会话 sync 重写两次(489→479),Part A/B 的「原图」均为当次运行捕获,回存以捕获值为准(verified no-op 比对在同一捕获窗口内完成,不受影响)。

## Deviations(汇总)

1. 宽容面 asset-only → 证据驱动全类型(授权条款内,must-have#1 主导)。
2. 行为锁 audio/video 断言方向改「在场非法拒绝」(同上)。
3. probe no-op 比对剔除 lastEventId(实测发现簿记字段)。
4. B1 不再断言「保存后面板保持打开」——真后端 save 200 后 graph:saved 触发整图 reload 收起面板(mock 无此现象;持久化真值由 B2 承担)。面板收起行为本身未裁定为缺陷,留待产品决定。
5. 两颗计划外真机修复(migrate 防御 + execute allowlist)——均为 Part B 必经挡断点,且 migrate 崩溃是用户可见的生产画布消失。

## Self-Check: PASSED

- 根 tsc --noEmit 0;infinite-canvas tsc -b 0;vitest 401/401 + flowgraph-v3 130/130;verify:schema-drift 10/10;verify:phase-44 45/45;verify:save-v2-legacy 17/17。
- mock e2e:phase52 三件套 8/9(唯一败 = REGEN-01-c,52-08 路由)。
- 真机 probe-52-real 两段式全绿(部署链:build→deploy-canvas→build:server→restart,10588 health 就绪)。
