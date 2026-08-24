# Requirements: KAIS AIGC Platform — v3.1 重生成闭环深化

**Defined:** 2026-08-23
**Core Value:** 让 AI 短剧制作流程跑通——从角色设计、剧本生成、分镜、视频生成到后期制作的完整管线能够自动执行并产出可交付的成片。

## v3.1 Requirements

付清 v3.0 收尾锁定的三笔「生成-迭代闭环」欠账 + 审计三笔低优先债 (TD-3/4/5)。改动限 kap 仓画布侧,无跨仓库依赖。

### STALE — 窄触发级联 (地雷 #11)

- [x] **STALE-01**: 用户在详情面板编辑配方后重生成成功,该资产下游节点自动标 stale(角标可见,无需手动触发)
- [x] **STALE-02**: 用户在事件芯片换 seed 重跑成功,下游同样自动标 stale
- [x] **STALE-03**: 编排/批量执行成功**不**触发级联——既有批量链路行为零变化(负向断言锁死)

### RECIPE — 全配方持久化 (§14 窄通道)

- [x] **RECIPE-01**: 用户可在详情面板编辑高级配方字段(steps/cfg/sampler 等)并保存,reload 往返保真
- [x] **RECIPE-02**: 编辑后的高级字段直接进入重生成引擎请求——编辑即真值,窄通道不再丢弃
- [x] **RECIPE-03**: 复杂结构字段(lora/量化等)可编辑;未编辑字段原样保留,不被 nullish 清洗抹掉
- [x] **RECIPE-04**: canvasAssetSchema 与面板可编辑字段集有防漂移守护(verify 断言)

### PANEL — 保存后面板保持

- [x] **PANEL-01**: 真机后端保存 200 后详情面板保持打开,不因 graph:saved 整图重载收起
- [x] **PANEL-02**: 重载恢复的面板锚定与保存前语义等价(同一资产/同一事件锚)

### DEBT — 审计清债 (TD-3/4/5)

- [x] **DEBT-01**: `placeNewAsset(anchor='source')` 获得活调用方(资产中心/画布入口放置新资产),附 e2e
- [x] **DEBT-02**: reviewBridge 列表 URL 尾斜杠修正,307 中间跳消除,回归测试锁死
- [x] **DEBT-03**: `buildMeta` 读回 5 个持久化字段(emotion/promptMeta/murchGrade/archetype/viewAngle),save→reload meta 往返保真 (51-REVIEW I1)
- [x] **DEBT-04**: `node:created` 写入 canonical graph(V3 资产构造)或显式文档化为 ephemeral 并留守护注释 (51-REVIEW I5)

## Future Requirements

Deferred. Tracked but not in current roadmap.

### 变体域 (khs2 gated)

- **VAR-01k**: khs canvas_sync/field-map 结构化 envelope 映射 — gated on khs2 v2.4 Phase 25 验收 (TD-1)
- **VAR-03k**: manifest transport (FS/HTTP) 实现 + kmc 消费闭环 E2E + p13 delivery envelope — 同上 gate
- **VAR-04k**: G15 take_log/failed-shots 真实数据源 + kmc 记录一致 — 同上 gate

### 长期积压 (PROJECT.md Active)

- 角色一致性三件套 (IP-Adapter FaceID / InstantID / PhotoMaker)
- LLM 剧本蓝图生成器
- 多集批量生成
- 第二参考 skill / skill 作者工具链 / 口型同步 / 超分 / 人脸修复 / 帧插值

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| 53 Wave B (khs envelope 映射/manifest transport/G15 数据源) | khs2 v2.4 Phase 25 验收未过 (TD-1 gate);khs 侧改造不进本期 |
| 重生成参数域之外的 prompt 语义辅助 (LLM 改写建议等) | 本期只做持久化与真值通道,不做生成辅助 |
| 跨组共享候选的精确归组语义 | 52-VERIFICATION 遗留,留待变体域 (Wave B 后) 裁定 |
| 移动端 / 非 kmc 消费侧改动 | 改动限 kap 仓画布侧 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RECIPE-01 | Phase 58 | Complete |
| RECIPE-02 | Phase 58 | Complete |
| RECIPE-03 | Phase 58 | Complete |
| RECIPE-04 | Phase 58 | Complete |
| STALE-01 | Phase 59 | Complete |
| STALE-02 | Phase 59 | Complete |
| STALE-03 | Phase 59 | Complete |
| PANEL-01 | Phase 60 | Complete |
| PANEL-02 | Phase 60 | Complete |
| DEBT-01 | Phase 61 | Complete |
| DEBT-02 | Phase 61 | Complete |
| DEBT-03 | Phase 61 | Complete |
| DEBT-04 | Phase 61 | Complete |
