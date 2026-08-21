# Phase 53: 候选变体契约与选片 (Variant Contract + Picker Upgrade) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-21
**Phase:** 53-候选变体契约与选片 (Variant Contract + Picker Upgrade)
**Areas discussed:** 分期策略(外部门控), 变体墙设计 (VAR-02), 选优回写通道 (VAR-03), G15 失败镜头操作面 (VAR-04), 入口与跨镜串行(追加)

**Mode:** Interactive discuss(用户经 /gsd-manager Continue 进入;要求全程应用 /frontend-design)

---

## 灰区选择

用户全选 4 个初始灰区;首轮完成后再探追加灰区,单选「入口与跨镜串行」(aiScore 口径/Wave B 门槛/缩略图自愈未选,转 Claude's Discretion)。

---

## 分期策略(外部门控)

| Option | Description | Selected |
|--------|-------------|----------|
| 双波拆分 | Wave A = kap 接收端(契约+变体墙+G15 面板)先行;Wave B = khs 映射+VAR-03 闭环等 v2.4 P25 验收 | ✓ |
| 整体等待 | 全部 plan 推迟到 v2.4 验收后 | |
| 乐观并行 | 现在就写 khs 映射,接受返工风险 | |

**User's choice:** 双波拆分 (Recommended)
**Notes:** 符合 ROADMAP"kap 侧纯接收端工作可先行"注释;scout 确认 khs2 v2.4 Phase 25 进行中(25-03 未执行)、p04 dirty。

### 契约先行

| Option | Description | Selected |
|--------|-------------|----------|
| kap schema 先行 | zod candidate envelope + 双端 contract test 先落地(v2.0 四道闸模式) | ✓ |
| khs 先定 | 等 khs manifest 字段稳定后 kap 跟随 | |
| 仅文档约定 | 不写 schema | |

**User's choice:** kap schema 先行 (Recommended)

### 存量数据

| Option | Description | Selected |
|--------|-------------|----------|
| 仅新同步 | 已在流的 p03 候选不动,契约只对增量生效 | ✓ |
| 补 backfill | 按 Phase 50 范式回填 | |
| Claude 定 | planner 依成本决定 | |

**User's choice:** 仅新同步 (Recommended)

### COORD-01 干净判定

| Option | Description | Selected |
|--------|-------------|----------|
| 仅代码文件 | 检查范围 = pipeline/phases/*.py + plugins/kais_aigc/;episodes/ 运行时产物不算 | ✓ |
| 全仓库严格 | 任何 dirty 都 blocker | |
| 允许 stash | dirty 时 stash 后开工 | |

**User's choice:** 仅代码文件 (Recommended)
**Notes:** episodes/ 与 .pipeline-state.json 常态脏,全仓库严格等于永远等待。

---

## 变体墙设计 (VAR-02)

带 ASCII 版式预览的三选一(全屏审片剧场/加宽模态/详情面板 tab)。

| Option | Description | Selected |
|--------|-------------|----------|
| 全屏审片剧场 | 全屏接管、暗色剧场、N-up 视频墙、底部胶片条;签名=同步走带 | ✓ |
| 加宽模态 | 保持模态范式拉到 80vw | |
| 详情面板 tab | NodeDetailPanel 内嵌 tab | |

**User's choice:** 全屏审片剧场 (Recommended)

### 同播语义

| Option | Description | Selected |
|--------|-------------|----------|
| 主控同播+solo声 | 一条主控 transport 驱动全部 take;音频 solo | ✓ |
| 两两 A/B | 仅支持两条进大屏对比 | |
| 各自独立 | 每 take 独立控制 | |

**User's choice:** 主控同播+solo声 (Recommended)

### 卡片信息密度

| Option | Description | Selected |
|--------|-------------|----------|
| 卡上精要+详情区 | 卡=缩略+aiScore+时长+seed+prompt 单行;详情区展开完整 prompt | ✓ |
| 全量上卡 | 所有信息多行上卡 | |
| 极简+hover | 卡只有缩略+score | |

**User's choice:** 卡上精要+详情区 (Recommended)

### 选定交互

| Option | Description | Selected |
|--------|-------------|----------|
| 检视+显式选定 | 点卡=检视,「选定」按钮提交 | ✓ |
| 点选即定 | 现状,点卡即选定关闭 | |
| 待定栏确认 | 加入待定栏统一确认 | |

**User's choice:** 检视+显式选定 (Recommended)
**Notes:** 换 winner 会级联 stale,防误触必要;与端点幂等语义配合。

---

## 选优回写通道 (VAR-03)

| Option | Description | Selected |
|--------|-------------|----------|
| 扩展 select-winner | Phase 49 端点挂 manifest hook(与 reviewBridge 同位) | ✓ |
| 新专用端点 | G13/G14 独立端点 | |
| kmc CLI 调用 | shell 调 kmc 命令 | |

**User's choice:** 扩展 select-winner (Recommended)

### 降级语义

| Option | Description | Selected |
|--------|-------------|----------|
| canvas真值+重试队列 | 选定即时落 canvas,manifest 失败进队列重放 | ✓ |
| 整体成败 | manifest 写不进就 409 回滚 | |
| 仅警告 | toast+log 人工重试 | |

**User's choice:** canvas真值+重试队列 (Recommended)

### G13 双维选定

| Option | Description | Selected |
|--------|-------------|----------|
| 首尾分选 | 首帧墙+尾帧墙各自选定 → selected_first/last_variant | ✓ |
| 成对选定 | 一墙成对卡,复用 chosen_variant_id | |
| Claude 定 | planner 依 manifest 实际字段定 | |

**User's choice:** 首尾分选 (Recommended)

### 前端接线

| Option | Description | Selected |
|--------|-------------|----------|
| 直连端点+optimistic | 本地即时更新+POST,失败回滚+toast | ✓ |
| 纯端点等待 | spinner 等返回 | |
| 保持本地双轨 | 本地+💾保存流(现状) | |

**User's choice:** 直连端点+optimistic (Recommended)

---

## G15 失败镜头操作面 (VAR-04)

带 ASCII 版式预览的落位三选一。

| Option | Description | Selected |
|--------|-------------|----------|
| 独立分诊面板 | 53 建独立面板预留嵌入位,54 gate 中心复用 | ✓ |
| gate中心首块 | 提前动 Phase 54 地基 | |
| 详情面板内嵌 | NodeDetailPanel 内嵌 | |

**User's choice:** 独立分诊面板 (Recommended)

### 批量操作

| Option | Description | Selected |
|--------|-------------|----------|
| 勾选+动作条+确认 | 勾选→底部动作条+二次确认(重渲 GPU 贵) | ✓ |
| 逐条+全选 | 行内按钮+全选 | |
| 两步向导 | 豁免清单/重渲清单分步确认 | |

**User's choice:** 勾选+动作条+确认 (Recommended)

### 回写通道

| Option | Description | Selected |
|--------|-------------|----------|
| G15操作桥 | 豁免=reviewBridge waive 扩展;重渲=同桥 requeue action | ✓ |
| 并入 select-winner | 豁免也走选定端点(语义污染) | |
| kmc CLI | shell 调用 | |

**User's choice:** G15操作桥 (Recommended)

### 归因数据源

| Option | Description | Selected |
|--------|-------------|----------|
| take_log主+review补 | take_log 透传为主+G15 review 归因补充;徽章+展开原始日志 | ✓ |
| 仅 take_log | 不做归因维度 | |
| 仅 review 归因 | 不碰 take_log | |

**User's choice:** take_log主+review补 (Recommended)

---

## 入口与跨镜串行(追加)

| Option | Description | Selected |
|--------|-------------|----------|
| 墙内下一镜 | 审完不关墙直接载入下一待审组 | ✓ |
| 队列模式 | 先入队再逐个传唤 | |
| 不串行 | 逐镜开墙 | |

**User's choice:** 墙内下一镜 (Recommended)

### 串行顺序

| Option | Description | Selected |
|--------|-------------|----------|
| shot序+跳已选 | 同 phase 按 shot_id 序,默认跳过已选定;gate 视角只列该 gate 组 | ✓ |
| 全组过 | 含已选定按序过 | |
| 分数序 | aiScore 升序 | |

**User's choice:** shot序+跳已选 (Recommended)

### 资产中心入口

| Option | Description | Selected |
|--------|-------------|----------|
| 画布主+跳转 | 墙只在画布开;资产中心加「去画布选片」链接(focusAssetNodeId) | ✓ |
| 双宿主内嵌 | 资产中心内嵌墙 | |
| 不动 | 仅靠 isPrimaryView 联动 | |

**User's choice:** 画布主+跳转 (Recommended)

### 键盘流

| Option | Description | Selected |
|--------|-------------|----------|
| 全套键盘流 | 1-9 选 take、Enter 确认、→← 切镜、空格同播 | ✓ |
| 部分键盘 | 仅切镜+同播 | |
| 纯鼠标 | 不做快捷键 | |

**User's choice:** 全套键盘流 (Recommended)

---

## Claude's Discretion

- aiScore 数据源与口径(综合分 vs 维度 chips、归一化)
- Wave B 启动门槛判定工件、G13/G14 闭环 E2E 断言策略
- 候选缩略图 404 自愈实现
- candidate envelope zod schema 具体 shape
- 重试队列持久化载体
- 同播时钟同步实现技术

## Deferred Ideas

None — 讨论未超出 phase 范围。
