# Requirements: KAIS AIGC Platform — v3.2 跨仓协调清偿

**Defined:** 2026-08-25 (回溯立项: 11/11 phases 已执行完毕, 本文件按已交付终态固化)
**Core Value:** 让 AI 短剧制作流程跑通——从角色设计、剧本生成、分镜、视频生成到后期制作的完整管线能够自动执行并产出可交付的成片。

**来源:** 08-25 12-agent fan-out 双仓复审 40 findings (15 high/16 med/9 low) → F01-F40 全映射。审查 journal: `~/.claude/projects/-home-kai/fae37383-c066-4151-af3c-0a4805d60741/subagents/workflows/wf_86c8a137-9ef/journal.jsonl`。完整索引: [v3.2-ROADMAP-DRAFT.md](v3.2-ROADMAP-DRAFT.md)。

## v3.2 Requirements

### 引擎真值源 (Engine Truth-Source) — Phase 63

- [x] **ETS-01**: gold-team 容器内引擎真值四文件 (executor/cloud_jimeng/cloud_base/workflow_builder) 回灌入仓, md5 与容器逐一相等, `git log -S` 有历史 (F04; commits b0e8839+39bb666, 47/50 md5 + 3 有意保留)
- [x] **ETS-02**: 按仓 rebuild 镜像与现役容器行为等价——隔离拉起实测 `_T2I_ALLOWED_MODELS={'5.0','5.0lite'}`、`_I2I_MODEL='4.6'` + image_refine 冒烟 completed (重建即等价断言过)
- [x] **ETS-03**: docker-compose.v9.yml 不再从 ../kais-gold-team 分叉仓构建抢 :8002 (F34; pin `kais-gold-team:real` 镜像, kap 938f26e5)
- [x] **ETS-04**: khs2 assets/ 活代码路径 `5.0Pro` 零命中 (F40; 37631a1)

### 相位注册表 (Phase Registry) — Phase 64

- [x] **PRG-01**: kap 22-phase 注册表跟进 p11a5_preview_audio (23 活跃), `verify:phase-55` 12/14 红 → 18/18 绿 (F22; kap 736889db)
- [x] **PRG-02**: khs `_PHASE_PREFIX_RE` 不再折叠 p11a5→p11a, 四工件 (ambient_stems/preview_mix/roughcut_path/roughcut_meta) 进 `_PHASE_OUTPUT_MAP`, DAG 不再恒 pending (F23; khs b432bba)
- [x] **PRG-03**: PHASE_REGISTRY canvasType/assetType 与 khs 实际值逐条相等 (p09b/p11c/p12a/p12b/p13/p15 六处历史分叉修正), 两字段纳入 verify 门 (F24)

### 重生成引擎契约 (Regen Engine Alignment) — Phase 65

- [x] **REA-01**: Stage→TaskType 映射表驱动契约测试——逐 TaskType 对照引擎 executor 消费参数, 终结「五键命中」式字面量验证 (F02)
- [x] **REA-02**: video/video_final 重生成携带 image 参 (referenceImages 通道 canvasApi extra→submitEngineTask), 引擎侧不再缺参 FAILED (F02)
- [x] **REA-03**: audio/voice→tts 携带引擎读的 text 键 (prompt→text 显式映射), 不再对空文本合成 (F02)
- [x] **REA-04**: bgm/foley 重生成按裁决①走 kap 内部端点 (bgm→ACE-Step 异步+轮询 / foley→SA3 同步), 不再投递引擎必拒任务 (F02; 65-04 bc9d783a)
- [x] **REA-05**: 图像重生成配方保真——ratio 从节点资产推导 (不再恒 1:1)、modelVersion→model_version 键名翻译、cloud 不消费键 UI 明示 (F03)
- [x] **REA-06**: seed 语义修正——canvas 路径 seed 不再作为装饰真值回写 canonical (F03)

### 生产通电 (Production Power-On) — Phase 66

- [x] **PWR-01**: 生产启动路径显式加载引擎 env (serve-production.sh export), `/proc/<pid>/environ` 实证 GOLD_TEAM_URL, verify 断言锁「env 缺失告警」而非静默 simulateOnly (F01; 4e60b9c8, pid 2680419)
- [x] **PWR-02**: 灰度次序留档 (image 先行→video/tts 随 65 完成), 未放开类型 UI 明示 (F01)
- [x] **PWR-03**: 真机 e2e probe 可重跑——画布发起图像重生成→:8002 canvas-* 任务 completed→产物落盘→filePath 更新→新图回贴 (probe-66 零足迹 9/9, 40s cloud-jimeng 真渲染; 66-02 真机断点 model_preference 顶层字段系真机探针抓到, 静态 review 双漏)
- [x] **PWR-04**: 52 时代「真机闭环」验证口径回溯标注 (当时建立在 simulate 链上, 真实闭环 66 完成) (F33)

### 豁免桥 (Waive Bridge) — Phase 67

- [x] **WBX-01**: review-platform `/api/v1/g15/ops` 端点真实存在——fail-closed episodeRefs 匹配 + waived_shot_ids union 幂等 + approve carry-forward, 容器已重建部署 (F09/F14; 7eea588, 10 用例)
- [x] **WBX-02**: khs 逐镜头子集豁免消费端——operator 豁免 5 失败镜中 2 个 → 只 2 个 waived, 其余照常阻塞, 不再子集放大全量 (F15; runner 注入+p10c/p11c 子集优先双侧测试)
- [x] **WBX-03**: kap 桥诚实化——delivered=false 不再成功 toast, drain 读取 payload 不丢 gate 字段 (排队的 p10c-gate 不再错发成缺省 p11c-gate), 队列重放带上限 (F09/F27; 3312a0c1)
- [x] **WBX-04**: review-platform web UI (htmx 单条/batch) 与 API batch 全部写 metadata.review_result.decision, 三方读法不一致消除 (F16)
- [ ] **WBX-05**: v3.0 UAT 11 真机 drill——khs p10c-gate 收到 comment 后状态正确; G16 听审批量豁免端到端 (⏸ 待活体管线; 代码链全通, 神创深渊集进行中下次 sync 自然覆盖)

### 变体域契约 (Variant Domain Realignment) — Phase 68

- [x] **VDR-01**: candidateEnvelope 契约重冻结——finalists/final_rank/dropped/selection_meta/render_variants 进五源信封 schema, 对 khs2 v2.5 实际产出逐源验证 (F10/F39; verify-53 97→102)
- [x] **VDR-02**: 三 ADR 落死——①chosen_variant_id=string finalist id (per-phase id 空间) ②score scale 三档 unit/ten/percent (p11a0 真实 0..10 不再整条拒收) ③归组真相 khs 短横线形主+kap canonicalFlfGroupKey 单点映射 (F11/F12/F13; adrs/adr-v3.2-variant-domain.md)
- [x] **VDR-03**: verify 门双源校验——fixture 与 khs 真实产出 (take-log.json + db2.sqlite) 双源, S1f 首跑即抓 take-log 真漂移 (实际写 shot_index+seed:null) (F11)
- [x] **VDR-04**: Wave B「验收未过」失实理由三处销账 (gate 08-23 已满足) (F06; REQUIREMENTS/ROADMAP/v3.0-MILESTONE-AUDIT)

### Wave B 实施 (Wave B Implementation) — Phase 69

- [x] **WBI-01**: manifest transport 真实现并通电——`KMC_MANIFEST_TRANSPORT=fs`, 变体墙换选 winner→khs manifest selected_* 覆写 (原子写 tmp+rename, 幂等同值 no-op), S3g 真写 5 断言 (F07; 生产双 env 实证)
- [x] **WBI-02**: G15 分诊面板真实数据源——graphG15Source 消费 failed-shots/per_shot/take-log, fixture 降级为显式测试模式 (F07)
- [x] **WBI-03**: requeue khs 消费端——面板「重渲」→镜头真实进入重渲队列, p11b 与 video-qc slot requeue 并集 (explicit shots 重渲即使 waived) (F35)
- [x] **WBI-04**: khs 五源候选落盘——p03 script-candidates / p11a preview-candidates 新生产者 + _CANDIDATE_FILES 注册, envelope 映射按 68 契约 (F35)

### 换选通道 (Choose/Swap) — Phase 70

- [x] **CHS-01**: choose 载荷携带完整作用域 id——p11a0 `{sid}:{ft}:v{N}` / p11a `{sid}:v{N}` / p01 `v{N}` per-phase id 空间 (F08)
- [x] **CHS-02**: variantNumber 真编号——从节点 variant 字段解析 v{N} (非数组位置), 缺员组不错位 (F08; winner node data.variant→id 后缀→index 兜底)
- [x] **CHS-03**: reviewBridge 相位匹配迁移 fullPhaseToken (/^p\d+[a-z0-9]*/), p11a0→p11c 错批 (=全量豁免放行) 负向断言锁死 (F18; node:test 3→6)
- [x] **CHS-04**: selected 通道类型按 ADR-1 落地——string finalist id, khs chosen_from_outcome 等值校验通过 (F17)
- [ ] **CHS-05**: 端到端真机断言——G13 条件帧变体墙换选→gate 批准→manifest 覆写→p11b 下一轮渲新帧 (⏸ 待活体管线)

### 共存语义 (Canvas↔kmc Coexistence) — Phase 71

- [x] **COX-01**: 用户画布 prompt 编辑不再被 canvas_sync 删建蒸发——裁决②a 画布为配方真值, `_kmc_prompt` 哨兵保留编辑, 重同步后存活 (F05; 往返测试「雨夜改推近」存活)
- [x] **COX-02**: stale 生命周期两仓统一——khs upsert 集中清 stale, n-* 节点不再永久残留 (F05)
- [x] **COX-03**: 画布重生产物回流 kmc——node.data.filePath 变更经 transport 写 canvas-takes.jsonl, kmc 后续 phase 可选消费 (F05)
- [x] **COX-04**: import-from-dir replace 与 saveGraph 行为统一——canvas_variant_groups 关系层同步, 重导入无幽灵变体组/winner 悬空 (F36)
- [x] **COX-05**: sequence 边语义往返存活——linkType 顶层列+data 袋双写, khs 导入→用户保存→序列蓝线不丢 (F37)

### QC/评分真数据 (QC & Score Real-Data) — Phase 72

- [x] **QVR-01**: 判定数组透传契约 (裁决⑤a 节点保留不展开)——p10c fidelity_check.clips 与 p11c per_shot 以 kap join 可读形状落画布, detectItems 三形状 (数组键/per_shot dict/fidelity_check 嵌套) (F26)
- [x] **QVR-02**: 眼/耳 verdict 角标对真实 kmc 数据命中——shot_id join / shot_index→shot_{N} 兜底, 五值全呈现 (F26)
- [x] **QVR-03**: aiScore 真实生产者——p03 (scores 0..1)/p14 (quality_audit 0..100) 审计分数→节点顶层, 雷达数据链从零起步 (producer 上线+测试绿; ⏸ 存量集回填待下次 episode sync 自然发生) (F28)
- [x] **QVR-04**: DIM_LABELS 与 khs 实际键对齐 (logic/social_resonance_depth/requirement_conformance/info_package_density) + verify 门修真 (源码锚点提取, 首跑即抓 2 处真漂移) (F29)
- [x] **QVR-05**: verdict 词表三值→五值+未评态——skipped/error 呈现「未评」, must_fix 呈现「必修」, 不再静默过滤 (F32)
- [x] **QVR-06**: QC 接入扩展契约——registerAuditToken 可注册词表, khs 新增审计 phase 无需改 kap 源码 (F31)
- [x] **QVR-07**: voice 剧场 metaSub 键对齐——subtype 从 o_assets.meta 同步画布节点, 声纹两级试听真实数据可达 (F30)

### 门中心/调度 (Gate Center & Scheduling) — Phase 73

- [x] **GCX-01**: p11b webhook 哨兵形态——不参与 blocking 竞争, 「异步哨兵」呈现, 存量 26+9 条 APPROVING 实清零 + resolve-stale-gates.py 收官工具 (F19)
- [x] **GCX-02**: 红线三门真实态——kmc 红线 reject 墓碑上浮 (type=detector 别名+submit+立即 reject 409 幂等), 不再恒显 auto (F20)
- [x] **GCX-03**: qwen-eye KAP 宕机兜底受控——队列拒绝 (200/4xx) 不绕队; 0/5xx 走 flock lease 受控拉起, only-lease-holder owns (08-23 死锁根治) (F21)
- [x] **GCX-04**: canvas-status-check.py 改读 v2 关系表 (canvas_nodes/canvas_links 主, legacy 兜底), 排障不再误报 (F38)

## Future Requirements

### 待真机收尾 (carry-forward, 随活体管线自然覆盖)

- **WBX-05**: UAT 11 真机 drill (p10c-gate comment 状态 + G16 批量豁免端到端)
- **CHS-05**: G13 换选端到端真机断言 (manifest 覆写→p11b 渲新帧)
- **QVR-03 存量部**: 存量 episode aiScore 回填 (下次 canvas_sync 自然发生)

## Out of Scope

| Feature | Reason |
|---------|--------|
| kmc 22-phase 主创作流重构 | 本期只清协调欠账, 不动主创作流语义 |
| review-platform 全 UI 改版 | 仅补 decision 持久化与 g15/ops 端点, UI 形态不变 |
| 视频重生成真机灰度全开 | 65 契约对齐完成, 但真机灰度按 PWR-02 次序 image→video/tts 渐进, 不一次性全开 |
| 引擎能力扩展 (新 TaskType/新模型) | 纯清偿性里程碑, 零新能力 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ETS-01..04 | Phase 63 | Complete ✓ |
| PRG-01..03 | Phase 64 | Complete ✓ |
| REA-01..06 | Phase 65 | Complete ✓ |
| PWR-01..04 | Phase 66 | Complete ✓ |
| WBX-01..04 | Phase 67 | Complete ✓ |
| WBX-05 | Phase 67 | Pending (⏸ 待真机) |
| VDR-01..04 | Phase 68 | Complete ✓ |
| WBI-01..04 | Phase 69 | Complete ✓ |
| CHS-01..04 | Phase 70 | Complete ✓ |
| CHS-05 | Phase 70 | Pending (⏸ 待真机) |
| COX-01..05 | Phase 71 | Complete ✓ |
| QVR-01..07 | Phase 72 | Complete ✓ (QVR-03 存量部 ⏸) |
| GCX-01..04 | Phase 73 | Complete ✓ |

**Coverage:**
- v3.2 requirements: 51 total
- Mapped to phases: 51 (40/40 findings 全落 phase, 无遗漏)
- Unmapped: 0 ✓
- Complete: 49 · Pending-真机: 2 (WBX-05, CHS-05) + QVR-03 存量部

---
*Requirements defined: 2026-08-25 (回溯固化——执行先于立项, 状态按已交付终态登记)*
*Last updated: 2026-08-25 after milestone v3.2 formalization*
