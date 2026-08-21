# Requirements: v3.0 画布创作体验 (Canvas Creative Experience for kmc)

**Milestone:** v3.0
**Created:** 2026-08-21
**Source:** 三路并行诊断(画布 UX 代码审计 / 平台页面审计 / kmc 创作流需求提取) + 用户圈定 + khs2 并行工作流冲突评估

## v3.0 Requirements

### A. 写路径地基 (WRITE)

- [x] **WRITE-01**: 画布保存切换到 V2 save-v2 / 直接持久化 canonical V3 graph,废弃 `canvasToFlowGraph` legacy v1 绕行;保存失败必须 toast 可见,不再只 console.error
- [x] **WRITE-02**: 右键菜单审核/删除改走 `store.approveNode/rejectNode` canonical 路径;删除有确认且持久化(重载不复活)
- [x] **WRITE-03**: MetadataEditor 镜头意图编辑、socket `node:preview`/`node:state` 更新全部回写 canonical graph,不再只写派生缓存被 applyGraphTransform 覆盖
- [x] **WRITE-04**: 死代码清理 — 4 个旧节点渲染器(ScriptNode/VideoNode/AudioNode/StoryboardNode)、VariantGroupDetail、BranchPanel、StructuredFieldPanel、双份徽章组件、legacy 类型与过期注释(约 2500 行);`@kais/flowgraph-v3` 声明进 dependencies 消除幽灵依赖

### B. 生成-迭代闭环 (REGEN)

- [ ] **REGEN-01**: 节点详情面板内可编辑 prompt,保存后一键重生成(改 prompt→重抽 是 kmc 最高频创作循环)
- [ ] **REGEN-02**: 同配方换 seed 重跑(接通 EventParamsPopover 已有接缝,当前为 TODO/console.log)
- [ ] **REGEN-03**: stale 下游一键重跑链 — stale 角标/详情区给出行动出口,复用 orchestrate 批量执行通道
- [ ] **REGEN-04**: 详情面板交互优化 — 默认宽 75%→~480px;单击切换节点时面板保持打开并跟随刷新(审片场景不再反复开合)

### C. 候选与选片 (VAR)

- [ ] **VAR-01**: field-map / canvas_sync 补 candidate/variant/winner/selected 字段映射(kmc 侧同步修改),p01 hook 候选、p03 N-best、p11a0 条件帧、p11a 预览变体、p11b take-log 不再被压平丢失
- [ ] **VAR-02**: VariantPicker 升级 — 候选卡带 aiScore/时长/prompt 摘要,支持并排大屏对比与视频同播;缩略图走 resolveMediaUrl 修 404
- [ ] **VAR-03**: 选优回写 manifest — G13 条件帧/G14 预览的换选直接写回 kmc manifest(chosen_variant_id / selected_first/last_variant 闭环)
- [ ] **VAR-04**: 失败镜头批量操作(G15)— failed-shots 列表带失败原因标注,支持批量豁免与批量重渲

### D. Gate 中心 (GATE)

- [ ] **GATE-01**: 16 gate 状态模型接入平台 — 读 kmc gates.yaml / review-outcomes,同步 pending/approve/reject/waive 状态
- [ ] **GATE-02**: 画布阻塞态一等呈现 — "管线停在哪道门等你决策"在画布高亮 + gate 面板 + 待办通知
- [ ] **GATE-03**: 画布内 gate 操作闭环 — approve/reject/waive 直接回写 kmc,替代 telegram/CLI 审批

### E. 画布导航与规模 (NAV)

- [ ] **NAV-01**: zone 表对齐 22 phase — 补 p035/p09b/p09c/p10c/p11a*/p12a/p12b/p14/p15 的映射与泳道分组(当前 13-phase 旧结构)
- [ ] **NAV-02**: 分镜层级浏览 — 场景→镜头两级;镜头卡呈现 shot_id/景别/运镜/时长/video_prompt/引用角色&场景缩略图
- [ ] **NAV-03**: 搜索升级为导航器 — 结果列表 + 点击聚焦跳转(复用 focusAssetNodeId 机制)+ `/` 快捷键;不再是"隐藏非命中节点"
- [ ] **NAV-04**: 新资产节点落点修正 — 落在当前视口中心或事件源旁,不再随机坐标
- [ ] **NAV-05**: LOD 默认可读 — fitView 后默认档提升到 keyFields 可读,或记忆每泳道缩放
- [ ] **NAV-06**: 分支 UI 接通 — 复活/重写 BranchPanel 消费既有 branches store 与 selectBranchAsMain(多结局/多版本探索)

### F. 创作环节可视化 (VIZ)

- [ ] **VIZ-01**: 审核分数可视化 — p03 5-dim / p14 8-dim 雷达图;qwen-eye/qwen-ear verdict 角标直接贴资产节点(消费已有 socket `node:state` scored + aiScore 契约)
- [ ] **VIZ-02**: 角色/场景资产组视图 — turnaround 四视图同屏对比、场景多视角(top-down/front/side/rear)画廊、voice_profile 试听内嵌,替代 240px 卡片平铺
- [ ] **VIZ-03**: 配音审核工作台(G16)— 波形 + 转写文本对照(qwen-ear verdict)+ 逐条试听 + 批量豁免,替代 indextts25 测试页凑合

### G. 平台页面与门户 (PORTAL)

- [ ] **PORTAL-01**: Toonflow 替换评估 — 26MB 无源码 vendored bundle 的替换方案调研 + 自有门户壳原型(路由/导航/项目入口)
- [ ] **PORTAL-02**: 四套前端互链 — 项目页→画布深链、统一导航入口,消除 Toonflow/画布/story-map/director-desk 孤岛
- [ ] **PORTAL-03**: 成片交付页面(p13)— master.mp4 播放 + 交付清单 + G8 终审界面(22-phase 终点当前无 UI)
- [ ] **PORTAL-04**: movie-v1.manifest phase_taxonomy 重对齐 — 12 阶段 → 22 phase/16 gate,review 点用真实 gate 标注

### H. 并行工作流协调 (COORD)

- [x] **COORD-01**: khs2 (kmc v2.4) 冲突管理 — v3.0 kmc 侧变更限定契约/映射层(field-map/canvas_sync/manifest schema),不碰 v2.4 在改的 phases 内部算法;涉及 p04/p09 输出字段映射的 phase 排在 v2.4 Phase 25 验收之后;kmc 侧 phase 开工前检查工作树干净

## Future Requirements (deferred)

- **剧本前段 UI 承载** — p01 选题/p02 大纲/p03 剧本审核/p06 时空剧本的专用页面(story-map 从静态 demo 升级为接管线数据);本期画布内 gate 中心已覆盖其"审批"面,专用编辑器延后
- **剧本打磨 diff 视图** (p03→p035 前后对比)
- **跨集进化建议审批队列** (p15 reflection-suggestions / prompt-overrides UI)
- **真实音频波形** (当前 id 哈希伪波形)
- **director-desk 后端接线** (前端 demo → 接 `/api/v1/director-desk/*`)
- **分组折叠** — 泳道/场景级折叠(93 镜 × 多模态超大画布的进一步缩放治理)

## Out of Scope

- **Toonflow 本体改造** — 无源码,本期只做替换评估与门户壳原型,不做二进制补丁
- **review-platform 消费侧改造** — 跨仓库债务(SC-4 chosen_variant_id),沿用 v2.1 登记口径
- **data/web 根目录 bak 清理** — 卫生问题,走 quick task 不占里程碑需求
- **kmc phases 内部算法改动** — 属于 khs2 v2.4 战场,COORD-01 明确避让

## Traceability

<!-- Filled by roadmap -->

| Requirement | Phase |
|---|---|
| WRITE-01 | Phase 51 |
| WRITE-02 | Phase 51 |
| WRITE-03 | Phase 51 |
| WRITE-04 | Phase 51 |
| REGEN-01 | Phase 52 |
| REGEN-02 | Phase 52 |
| REGEN-03 | Phase 52 |
| REGEN-04 | Phase 52 |
| VAR-01 | Phase 53 (前置: khs2 v2.4 Phase 25 验收完成) |
| VAR-02 | Phase 53 |
| VAR-03 | Phase 53 |
| VAR-04 | Phase 53 |
| GATE-01 | Phase 54 |
| GATE-02 | Phase 54 |
| GATE-03 | Phase 54 |
| NAV-01 | Phase 55 |
| NAV-02 | Phase 55 |
| NAV-03 | Phase 55 |
| NAV-04 | Phase 55 |
| NAV-05 | Phase 55 |
| NAV-06 | Phase 55 |
| VIZ-01 | Phase 56 |
| VIZ-02 | Phase 56 |
| VIZ-03 | Phase 56 |
| PORTAL-01 | Phase 57 (调研型,可与 52-56 并行) |
| PORTAL-02 | Phase 57 |
| PORTAL-03 | Phase 57 |
| PORTAL-04 | Phase 57 |
| COORD-01 | Phase 51 (横切约束并入首个 phase) |
