# kais-review-platform 深度审计报告

**审计日期:** 2026-05-23  
**审计范围:** 仓库 `/home/kai/.openclaw/workspace/kais-review-platform` 全量代码  
**对标:** Notion V6.0 Final Architecture  

---

## 0. 仓库现状概览

| 维度 | 现状 |
|------|------|
| 后端框架 | FastAPI + SQLAlchemy 2.0 (async) + Alembic + arq 任务队列 |
| 数据库 | PostgreSQL (TimescaleDB) + Redis 7 + MinIO 对象存储 |
| 前端 | **HTMX + Alpine.js + Tailwind CSS v4 CDN**（服务端渲染，零构建步骤） |
| 认证 | JWT (HS256) + RBAC (ADMIN/REVIEWER/AUDITOR/AI_SERVICE) + 一次性审核 Token + Capability Token |
| 实时通信 | SSE (EventManager) + Telegram Bot (InlineKeyboard 审批) |
| 策略引擎 | Policy V1 (YAML规则) + V2 (ShotCard 感知 + 策略堆叠) |
| 审计追溯 | AuditEntry 链式哈希 (prev_hash/own_hash) + Merkle Tree + Git anchoring |
| 数据模型 | Review (V1通用) + ShotCard (V2分镜卡片) + AuditEntry + PolicyVersion + WebhookConfig |
| 模板系统 | TemplateRegistry (YAML → JSON Schema 验证 → source_system+phase 解析) |
| 双写归档 | DualWriteAuditRecorder (PG 实时 + MinIO JSONL 温冷层) |
| 评分总线 | ScoringBus + ScoreVector 五维模型 (Phase 0: 全部 None) |
| 部署 | Docker Compose 5 容器 (API + Nginx + Postgres + Redis + MinIO + Dozzle) |
| 代码量 | ~70 Python 文件, ~30 HTML 模板, ~5 YAML 配置 |

---

## 1. Gap 清单：当前代码 vs V6.0 目标

### 1.1 🔴 Critical Gap：前端技术栈不匹配

| 项目 | V6.0 目标 | 当前实现 | Gap |
|------|-----------|----------|-----|
| 前端框架 | **React Web** | HTMX + Alpine.js + Jinja2 SSR | 完全不匹配 |
| 构建方式 | React SPA/SSR | 零构建 CDN 脚本 | 架构差异 |
| 组件化 | React 组件库 | Jinja2 partials + HTMX fragments | 不同范式 |

**影响范围：**
- `app/templates/` 全部 30+ HTML 文件
- `app/web/routes.py` 全部 HTMX 路由（~600 行）
- 所有前端交互逻辑（Alpine.js state manager）

### 1.2 🟡 Moderate Gap：五维雷达图仪表盘

| 项目 | V6.0 目标 | 当前实现 | Gap |
|------|-----------|----------|-----|
| 五维雷达图 | 核心仪表盘功能 | ScoringBus 五维模型存在但全为 None (Phase 0) | 数据管道就绪，可视化缺失 |
| 可视化库 | 未指定 | 无图表库引入 | 需要引入 ECharts/D3/Recharts |
| 数据来源 | AI 评分结果 | `ai_score` / `ai_score_dimensions` 字段已在 ShotCard.narrative_context | 数据入口已预留 |

**已有基础：**
- `ScoreVector` 五维模型：aesthetics / consistency / compliance / technical_quality / audio_match
- `ShotCard.narrative_context["ai_score_dimensions"]` 已在 Mobile API 返回
- `app/api/v1/analytics.py` + `partials/_analytics_scores.html` 有 AI 评分分布直方图

### 1.3 🟡 Moderate Gap：Audit DB 共享方案

| 项目 | V6.0 目标 | 当前实现 | Gap |
|------|-----------|----------|-----|
| 共享 DB | kais-core-backend + review-platform 共享 PostgreSQL | review-platform 独占 `reviewdb` | 需要迁移到共享 `kais` 库或建立 DB 链接 |
| 数据库名 | `kais` (V6 docker-compose) | `reviewdb` (当前) | 不一致 |
| 用户 | `kais` / `kais` | `review` / `review` | 不一致 |

### 1.4 🟡 Moderate Gap：权限隔离

| 项目 | V6.0 目标 | 当前实现 | Gap |
|------|-----------|----------|-----|
| 角色体系 | Toonflow 深度审片 vs review-platform 治理 | RBAC 4 角色 (ADMIN/REVIEWER/AUDITOR/AI_SERVICE) | 缺少 Toonflow 专用角色/权限组 |
| 写入权限 | review-platform 只读 Audit DB（治理操作可写） | 当前 review-platform 既是审核入口又写 AuditEntry | 需要区分"治理审批"和"深度审片"写入 |
| 审核模式分离 | Toonflow = 深度审片工作台，review-platform = 治理入口 | 当前 review-platform 包含 workstation（桌面三栏审片）| 功能重叠 |

### 1.5 🟢 已对齐：Git 审计追溯

| 项目 | V6.0 目标 | 当前实现 | 状态 |
|------|-----------|----------|------|
| Merkle Tree | 每日审计哈希锚定 | `app/core/merkle.py` 完整实现 | ✅ |
| Git commit | Merkle root → Git | `commit_merkle_root_to_git()` 已实现 | ✅ |
| 策略版本 | GitOps 策略管理 | `PolicyVersion` 表 + `git_policy_provider.py` | ✅ |
| 审计链 | 不可篡改审计日志 | AuditEntry prev_hash/own_hash 链 | ✅ |

### 1.6 🟢 已对齐：移动端快速审批

| 项目 | V6.0 目标 | 当前实现 | 状态 |
|------|-----------|----------|------|
| 卡片流 | 移动端轻量审核 | PWA + 滑动手势 (approve 左滑 / reject 右滑) | ✅ |
| 渐进加载 | 视觉先行，音频异步 | `loadCards()` + `loadAudio()` 分离 | ✅ |
| Telegram 审批 | 通知+内联按钮 | Bot handlers + InlineKeyboard callback | ✅ |
| 离线支持 | Service Worker | `sw.js` 注册已实现 | ✅ |
| Pinch-to-zoom | 手势缩放 | Alpine.js 双指缩放已实现 | ✅ |

---

## 2. 前端从 HTMX/Alpine 到 React 的迁移路径和必要性评估

### 2.1 必要性评估

**不推荐全面迁移到 React**，理由：

1. **当前 HTMX/Alpine 方案已高度成熟**：30+ 模板文件、完整的 HTMX partial 渲染、Alpine.js 状态管理（移动端卡片流 ~400 行），功能完备且稳定运行。

2. **V6.0 中 review-platform 的角色是"治理与移动端入口"**，不是创作工作台。HTMX SSR 完全满足治理仪表盘 + 移动卡片流的需求。React 引入的复杂度（构建链、状态管理、API 对接）对治理场景收益极低。

3. **资源约束**：8-16GB RAM、局域网部署、零构建步骤是明确优势。React SPA 会引入 Node.js 构建依赖、更大 bundle size、更慢的首屏。

4. **Toonflow (Electron) 才需要 React**：V6.0 架构中 Toonflow 是 Electron 桌面应用，深度审片工作台需要 React 的复杂交互能力。但 review-platform 作为独立治理 Web 应用，HTMX 更合适。

### 2.2 如果必须迁移：渐进式路径

```
Phase 1: API 优先（已完成）
  └─ 当前 FastAPI 后端已经是纯 API 架构
  └─ 15 个 API router 提供完整 REST 端点
  └─ HTMX 路由只是薄封装，API 层完全解耦

Phase 2: 引入 React 微前端（仅仪表盘页）
  └─ /analytics 页替换为 React SPA
  └─ 使用 Vite + React + Recharts/ECharts
  └─ 通过 Nginx 路由分流：/analytics/* → React SPA，其余 → HTMX

Phase 3: 渐进迁移
  └─ /audit-cockpit → React（需要复杂图表交互）
  └─ /dashboard, /workstation, /mobile → 保持 HTMX（表单+列表，SSR 优势）

Phase 4: 完全 React（仅当有强烈需求时）
  └─ 全部页面重写为 React 组件
  └─ 预计工作量：4-6 周（30+ 模板 → React 组件）
```

### 2.3 推荐方案

**保持 HTMX/Alpine 为主，仅在五维雷达图仪表盘引入 React 微前端。**

- 仪表盘页 `/analytics` 需要 ECharts/Recharts 交互式图表，React 组件化有明确收益
- 其余页面（dashboard/workstation/mobile/audit-cockpit）HTMX SSR 完全够用
- 这样既满足 V6.0 "React Web" 字面要求，又不破坏已稳定运行的 HTMX 基础

---

## 3. 与 Audit DB（PostgreSQL）共享给 Toonflow 的方案

### 3.1 当前数据模型

```
reviewdb (PostgreSQL)
├── reviews           -- V1 通用审核记录
├── audit_entries     -- 审计日志（链式哈希）
├── shot_cards        -- V2 分镜卡片
├── policy_versions   -- 策略版本管理
└── webhook_configs   -- Webhook 配置
```

### 3.2 V6.0 目标

```
kais (PostgreSQL, audit-db 容器)
└── 共享给 kais-core-backend + kais-review-platform
    ├── reviews / shot_cards / audit_entries (共享表)
    └── 权限隔离（行级/角色级）
```

### 3.3 推荐迁移方案

**方案 A：Schema 级隔离（推荐）**

```sql
-- 共享数据库 kais
CREATE DATABASE kais;

-- review-platform 使用专用 schema
CREATE SCHEMA review;

-- kais-core-backend 使用 public schema
-- 共享表放在 public schema，两方都可读
-- review-platform 写入 review schema 的治理操作表

-- 共享只读表
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO review_readonly;

-- 权限矩阵
GRANT SELECT ON ALL TABLES IN SCHEMA public TO review_app;
GRANT INSERT, UPDATE ON review.audit_entries TO review_app;
```

**方案 B：DB Link / FDW（轻量集成）**

```sql
-- review-platform 保持独立 reviewdb
-- 通过 postgres_fdw 读取 kais 库的共享表
CREATE EXTENSION postgres_fdw;
CREATE SERVER kais_db FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'audit-db', dbname 'kais');
CREATE USER MAPPING FOR review SERVER kais_db
  OPTIONS (user 'kais_readonly', password 'xxx');

IMPORT FOREIGN SCHEMA public LIMIT TO (reviews, shot_cards, audit_entries)
  FROM SERVER kais_db INTO public;
```

### 3.4 数据同步考虑

- **Toonflow → Audit DB**: Toonflow 深度审片结果通过 kais-core-backend API 写入
- **review-platform → Audit DB**: 治理审批通过 review-platform API 写入
- **读取模式**: review-platform 只读 Toonflow 的审核结果（展示用），写入自己的治理决策
- **Merkle 一致性**: 两方写入的 AuditEntry 应在同一 Merkle Tree 中计算

---

## 4. 权限隔离设计：Toonflow 深度审片 vs review-platform 治理

### 4.1 当前 RBAC 角色

```python
class Role(str, enum.Enum):
    ADMIN = "admin"           # 策略管理、系统配置
    REVIEWER = "reviewer"     # 桌面/移动审核动作
    AUDITOR = "auditor"       # 只读分析
    AI_SERVICE = "ai_service" # 评分提交
```

### 4.2 V6.0 需要的角色扩展

```python
class Role(str, enum.Enum):
    # 现有角色
    ADMIN = "admin"
    REVIEWER = "reviewer"      # review-platform 治理审批
    AUDITOR = "auditor"
    AI_SERVICE = "ai_service"
    
    # 新增：来源标识
    TOONFLOW_DEEP = "toonflow_deep"    # Toonflow 深度审片工作台
    REVIEW_GOV = "review_gov"          # review-platform 治理入口
```

### 4.3 权限矩阵

| 操作 | TOONFLOW_DEEP | REVIEW_GOV | ADMIN | AUDITOR |
|------|:---:|:---:|:---:|:---:|
| 查看审核列表 | ✅ | ✅ | ✅ | ✅ |
| 帧级批注 | ✅ | ❌ | ✅ | ❌ |
| 五维评分 | ✅ (读写) | ✅ (只读) | ✅ | ✅ (只读) |
| 治理审批 (approve/reject) | ❌ | ✅ | ✅ | ❌ |
| 批量审批 | ❌ | ✅ | ✅ | ❌ |
| 移动端快速审批 | ❌ | ✅ | ✅ | ❌ |
| 策略管理 | ❌ | ❌ | ✅ | ❌ |
| 审计日志查看 | ✅ | ✅ | ✅ | ✅ |
| Merkle 验证 | ✅ | ✅ | ✅ | ✅ |
| 触发重新生成 | ✅ | ❌ | ✅ | ❌ |

### 4.4 实现建议

在 `app/core/auth.py` 中扩展 `require_role()`:

```python
# 治理审批端点：只有 REVIEW_GOV 和 ADMIN 可操作
@router.post("/shot-cards/{id}/approve", dependencies=[Depends(require_role(Role.REVIEW_GOV, Role.ADMIN))])

# Toonflow 深度审片端点：只有 TOONFLOW_DEEP 和 ADMIN
@router.post("/shot-cards/{id}/deep-review", dependencies=[Depends(require_role(Role.TOONFLOW_DEEP, Role.ADMIN))])
```

**关键原则：**
- review-platform 的 `/workstation` 三栏工作台功能应标记为"治理模式"，与 Toonflow 的"深度审片模式"分离
- 两者的审批动作写入不同的 AuditEntry action 类型（`governance_approve` vs `deep_review_pass`）
- 但共享同一个 AuditEntry 表和 Merkle Tree

---

## 5. 移动端审批能力增强方向

### 5.1 现有能力（已实现）

| 能力 | 实现方式 | 文件 |
|------|----------|------|
| 卡片流浏览 | Alpine.js + 滑动手势 | `pages/mobile.html` |
| 滑动审批 | 左滑 approve / 右滑 reject | `mobileState()` |
| 渐进加载 | 视觉先行 + 音频异步 | `loadCards()` / `loadAudio()` |
| 手势缩放 | 双指 Pinch-to-zoom | `onPinchStart/Move/End()` |
| PWA 离线 | Service Worker + Manifest | `static/manifest.json` + `sw.js` |
| Telegram 审批 | Bot InlineKeyboard | `bot/handlers.py` |
| Toast 通知 | 内联 toast 组件 | Alpine.js toast |

### 5.2 增强方向

#### A. 审批流程增强
- **批量操作**：移动端支持多选后批量 approve/reject（当前只有逐张）
- **审批原因模板**：reject 时提供预设原因列表（角色漂移/画质问题/连续性错误等），减少输入
- **审批撤销**：限时（如 5 分钟内）撤回误操作
- **审批委托**：将待审核卡片转发给其他审核员

#### B. 上下文增强
- **前后镜头对比**：在卡片中显示序列上下文（前后各 1-2 张缩略图）
- **角色一致性面板**：展示同一角色的参考图 vs 当前镜头
- **AI 评分摘要**：将 `ai_score_dimensions` 可视化为小型雷达图（Canvas/SVG）
- **批注预览**：显示 Toonflow 深度审片的帧级批注（只读）

#### C. 通知与推送
- **Web Push**：利用 PWA Push API 实现浏览器推送通知
- **Telegram 深度集成**：卡片预览图 + 内联审批 + 统计摘要
- **审核队列状态**：移动端首页展示待审核数量趋势

#### D. 离线增强
- **离线审批队列**：Service Worker 缓存审批决策，恢复网络后批量同步
- **智能预加载**：Wi-Fi 环境下预加载后续卡片的视频/音频

---

## 6. 五维雷达图仪表盘的实现方案

### 6.1 数据管道现状

```
ShotCard.narrative_context (JSONB)
  ├── ai_score: number              -- 总分
  ├── ai_score_dimensions: {        -- 五维分项（已预留字段）
  │     aesthetics: float,
  │     consistency: float,
  │     compliance: float,
  │     technical_quality: float,
  │     audio_match: float
  │   }
  └── ai_score_source: string       -- 评分来源模型
```

`ScoreVector` 模型已定义五维，`ScoringBus` 插件总线已就位（Phase 0 空实现）。

### 6.2 数据流设计

```
kais-gold-team 生成完成
  └─→ quality-gate 阶段触发 AI 评分
      └─→ 评分结果写入 ShotCard.narrative_context["ai_score_dimensions"]
          └─→ review-platform 读取并聚合
              └─→ 五维雷达图可视化
```

### 6.3 API 层（已有基础扩展）

```python
# app/api/v1/analytics.py 新增端点

@router.get("/api/v1/analytics/radar")
async def radar_chart_data(
    project_id: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
):
    """聚合五维评分数据，返回雷达图所需的 JSON 结构"""
    # SQL: 聚合 narrative_context->ai_score_dimensions 的各维度平均值
    # 返回: {"dimensions": [...], "avg_scores": [...], "by_project": [...]}
```

### 6.4 前端实现（两个方案）

#### 方案 A：HTMX + ECharts（推荐，保持一致性）

```html
<!-- partials/_analytics_radar.html -->
<div id="radar-chart" style="width:100%;height:400px;"></div>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<script>
  // HTMX 加载后初始化 ECharts 雷达图
  document.addEventListener('htmx:afterSettle', function(evt) {
    if (evt.target.id === 'radar-container') {
      var chart = echarts.init(document.getElementById('radar-chart'));
      chart.setOption({
        radar: {
          indicator: [
            { name: '美学', max: 100 },
            { name: '一致性', max: 100 },
            { name: '合规', max: 100 },
            { name: '技术质量', max: 100 },
            { name: '音画匹配', max: 100 }
          ]
        },
        series: [{
          type: 'radar',
          data: radarData  // 从 HTMX partial 注入
        }]
      });
    }
  });
</script>
```

#### 方案 B：React 微前端 + Recharts

```
analytics-react/
├── src/
│   ├── RadarDashboard.tsx    -- 五维雷达图
│   ├── ScoreTrend.tsx        -- 评分趋势折线
│   └── App.tsx
├── vite.config.ts
└── package.json

# Nginx 路由分流
location /analytics/radar {
    proxy_pass http://analytics-react:3000;
}
```

### 6.5 五维评分仪表盘功能清单

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 项目级雷达图 | P0 | 单个项目所有镜头的五维平均分 |
| 镜头级雷达图 | P0 | 单个镜头的五维分数（叠加项目平均作对比） |
| 时间趋势 | P1 | 五维各维度随时间变化的趋势线 |
| 项目对比 | P1 | 多个项目的雷达图叠加对比 |
| AI 模型对比 | P2 | 不同评分源模型的结果对比 |
| 异常高亮 | P1 | 低于阈值的维度红色高亮 |
| 导出报告 | P2 | PDF/图片导出 |

---

## 7. 总结与优先级建议

### 7.1 关键发现

1. **后端架构成熟度高**：FastAPI + SQLAlchemy + 策略引擎 + 审计追溯 + 移动 API 已完整实现，API 层与前端完全解耦
2. **前端技术栈是唯一重大 Gap**：V6.0 目标要求 React，但当前 HTMX/Alpine 方案功能完备且更适合治理场景
3. **五维数据管道已预留**：`ScoreVector` + `narrative_context.ai_score_dimensions` 字段已就位，缺的是 AI 评分模型对接和前端可视化
4. **Git 审计和移动端已完全对齐 V6.0**：Merkle Tree + Telegram Bot + PWA 均已实现
5. **Audit DB 共享和权限隔离需要设计调整**：当前独立数据库，需迁移到共享 schema

### 7.2 推荐实施优先级

| 优先级 | 任务 | 工作量 | 收益 |
|--------|------|--------|------|
| **P0** | 五维雷达图仪表盘（HTMX+ECharts） | 3-5 天 | 治理可视化核心 |
| **P0** | Audit DB 共享方案实施 | 2-3 天 | 解锁 Toonflow 集成 |
| **P1** | 权限隔离角色扩展 | 1-2 天 | 安全基础 |
| **P1** | 移动端增强（审批原因模板、批量操作） | 3-5 天 | 审批效率 |
| **P2** | React 微前端（仅仪表盘页） | 5-7 天 | 技术栈对齐 |
| **P3** | 全面 React 迁移 | 4-6 周 | 不推荐 |

### 7.3 风险提示

- **不建议全面 React 迁移**：HTMX/Alpine 方案在治理场景下的开发效率和运行性能都优于 React SPA
- **Toonflow 才需要 React**：深度审片工作台的复杂交互（时间线、帧级批注、Canvas 操作）适合 React + Electron
- **review-platform 应保持轻量**：作为治理入口和移动端审批，HTMX SSR 的首屏速度和低资源占用是核心优势
