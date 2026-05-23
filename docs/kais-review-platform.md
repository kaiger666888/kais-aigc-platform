# kais-review-platform 改造文档

> **版本**: 1.0  
> **日期**: 2026-05-23  
> **基于**: V6.0 Final Architecture (architecture.md) + review-platform 深度审计报告 (audit-review-platform.md)  
> **目标**: 从当前 FastAPI+HTMX 审核系统演进为 V6.0 治理层

---

## 目录

1. [改造目标](#1-改造目标)
2. [前端迁移评估](#2-前端迁移评估)
3. [数据层改造](#3-数据层改造)
4. [API 改造](#4-api-改造)
5. [移动端审批增强](#5-移动端审批增强)
6. [Git 审计追溯集成](#6-git-审计追溯集成)
7. [迁移步骤和依赖关系](#7-迁移步骤和依赖关系)

---

## 1. 改造目标

### 1.1 当前状态

kais-review-platform 是一个基于 FastAPI + HTMX/Alpine.js + Tailwind CSS 的审核治理系统，包含：

- **后端**: FastAPI + SQLAlchemy 2.0 (async) + arq 任务队列
- **前端**: HTMX SSR + Alpine.js 状态管理 + Jinja2 模板（30+ HTML 文件）
- **数据库**: 独立 PostgreSQL (`reviewdb`)
- **数据模型**: Review (V1) + ShotCard (V2 分镜卡片) + AuditEntry (链式哈希)
- **策略引擎**: Policy V1 (YAML) + V2 (ShotCard 感知 + 策略堆叠)
- **实时通信**: SSE (EventManager) + Telegram Bot (InlineKeyboard)
- **移动端**: PWA + 滑动手势审批 + 离线 Service Worker
- **审计**: Merkle Tree + Git anchoring + 链式哈希 AuditEntry
- **部署**: Docker Compose 5 容器

### 1.2 V6.0 目标角色

在 V6.0 Final Architecture 中，review-platform 的定位是：

| 职责 | 说明 |
|------|------|
| **治理审批入口** | 面向管理员/审核员的 Web 治理平台 |
| **移动端快速审批** | PWA 卡片流，支持 Telegram + 浏览器审批 |
| **五维评分仪表盘** | 聚合 AI 评分，可视化展示质量趋势 |
| **审计追溯中心** | Merkle Tree 验证、Git 标签锚定 |
| **审核闸门** | movie-agent quality-gate 阶段的人工审核端 |

**关键定位变更**: 从"独立审核系统"变为"V6.0 治理层"，与 Toonflow (深度审片工作台) 分工协作。

### 1.3 Gap 总结

| 领域 | 现状 | V6.0 目标 | Gap 评级 |
|------|------|-----------|---------|
| 前端框架 | HTMX + Alpine.js | React Web | 🟡 不建议全面迁移 |
| 五维雷达图 | ScoreVector 存在但全 None | 核心仪表盘功能 | 🟡 数据管道就绪，可视化缺失 |
| 数据库 | 独立 `reviewdb` | 共享 `kais` 库 | 🟡 需 Schema 级迁移 |
| 权限体系 | 4 角色 RBAC | 5+ 角色，含 Toonflow 隔离 | 🟡 需角色扩展 |
| API | 15 router，HTMX + REST 混合 | 纯 REST + 审核回调升级 | 🟢 基础良好 |
| 移动端 | PWA + 滑动审批 + Telegram | 增强批量操作 + 上下文 | 🟢 已对齐 |
| Git 审计 | Merkle + Git anchoring | 相同 | ✅ 完全对齐 |

---

## 2. 前端迁移评估

### 2.1 HTMX/Alpine → React 的必要性和工作量

#### 必要性评估：不推荐全面迁移

| 维度 | HTMX/Alpine (当前) | React (目标) | 评估 |
|------|-------------------|-------------|------|
| **开发效率** | 高 — 零构建步骤，Python 模板直出 | 低 — 需 Vite 构建、状态管理、API 对接 | HTMX 胜 |
| **首屏速度** | 快 — SSR 直出 HTML | 慢 — JS bundle 加载 + 客户端渲染 | HTMX 胜 |
| **资源占用** | 低 — 无 Node.js 运行时 | 高 — 需要 Node.js 构建链 | HTMX 胜 |
| **复杂交互** | 中 — Alpine.js 可处理中等复杂度 | 高 — Canvas/时间线/帧级批注 | React 胜 |
| **组件复用** | 中 — Jinja2 partials | 高 — React 组件库 | React 胜 |
| **部署复杂度** | 低 — CDN 脚本 | 中 — 需要静态资源服务 | HTMX 胜 |

**核心判断**：

1. review-platform 在 V6.0 中的角色是**治理与移动端入口**，不是创作工作台
2. 治理场景以**表单、列表、仪表盘、卡片流**为主，HTMX SSR 完全胜任
3. **Toonflow (Electron)** 才真正需要 React — 时间线编辑、帧级批注、Canvas 操作
4. 全面迁移工作量 4-6 周（30+ 模板 → React 组件），收益极低

#### 推荐方案：保持 HTMX/Alpine + 仪表盘引入 ECharts

```
┌─────────────────────────────────────────────┐
│           kais-review-platform 前端          │
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Dashboard │ │ Workstn  │ │ Mobile PWA   │ │
│  │ (HTMX)   │ │ (HTMX)   │ │ (Alpine.js)  │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Audit    │ │ Policy   │ │ Analytics    │ │
│  │ Cockpit  │ │ Manager  │ │ (HTMX+       │ │
│  │ (HTMX)   │ │ (HTMX)   │ │  ECharts)    │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
│                                             │
│  共享: Tailwind CSS v4 + Alpine.js + HTMX   │
└─────────────────────────────────────────────┘
```

如果未来有强需求，可在 `/analytics` 页引入 **React 微前端**（Vite + Recharts），通过 Nginx 路由分流，不影响其他页面。

### 2.2 五维雷达图仪表盘实现

#### 数据管道

当前基础：
- `ScoreVector` 五维模型已定义：aesthetics / consistency / compliance / technical_quality / audio_match
- `ShotCard.narrative_context["ai_score_dimensions"]` 字段已预留
- `ScoringBus` 插件总线已就位（Phase 0 空实现）

V6.0 数据流：
```
kais-gold-team 生成完成
  → quality-gate 阶段触发 AI 评分
    → 评分写入 ShotCard.narrative_context["ai_score_dimensions"]
      → review-platform API 聚合查询
        → ECharts 雷达图渲染
```

#### API 端点（新增）

```python
# app/api/v1/analytics.py

@router.get("/api/v1/analytics/radar")
async def radar_chart_data(
    project_id: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
):
    """聚合五维评分 → 雷达图 JSON"""
    # SQL: AVG(narrative_context->ai_score_dimensions) GROUP BY project
    # 返回: {"dimensions": [...], "avg_scores": [...], "by_project": {...}}

@router.get("/api/v1/analytics/radar/{shot_id}")
async def shot_radar(shot_id: str):
    """单镜头五维分数 + 项目平均对比"""
```

#### 前端实现（HTMX + ECharts CDN）

```html
<!-- partials/_analytics_radar.html -->
<div id="radar-chart" style="width:100%;height:400px;"></div>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<script>
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
      series: [{ type: 'radar', data: radarData }]
    });
  }
});
</script>
```

#### 仪表盘功能清单

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 项目级雷达图 | **P0** | 单项目所有镜头五维平均分 |
| 镜头级雷达图 | **P0** | 单镜头五维分数（叠加项目平均对比） |
| 异常维度高亮 | **P1** | 低于阈值维度红色标记 |
| 时间趋势 | **P1** | 五维各维度随时间变化折线图 |
| 项目对比 | **P1** | 多项目雷达图叠加 |
| AI 模型对比 | **P2** | 不同评分源模型的结果差异 |
| 导出报告 | **P2** | PDF/图片导出 |

**工作量**: 3-5 天

### 2.3 移动端优化方案

当前移动端已实现 PWA + 滑动手势 + 渐进加载 + 离线 Service Worker。优化方向见[第 5 节](#5-移动端审批增强)。

---

## 3. 数据层改造

### 3.1 Audit DB 与 Toonflow 共享方案

#### 当前状况

```
reviewdb (独立 PostgreSQL)
├── reviews           -- V1 通用审核记录
├── audit_entries     -- 审计日志（链式哈希）
├── shot_cards        -- V2 分镜卡片
├── policy_versions   -- 策略版本管理
└── webhook_configs   -- Webhook 配置
```

#### V6.0 目标

```
kais (共享 PostgreSQL, audit-db 容器)
├── public schema (core-backend 写入, review-platform 读取)
│   ├── projects
│   ├── nodes
│   ├── assets
│   ├── shots
│   ├── shot_versions
│   ├── snapshots
│   └── audit_entries        -- 共享审计日志
│
└── review schema (review-platform 写入)
    ├── governance_decisions -- 治理审批决策
    ├── policy_versions      -- 策略版本管理
    └── webhook_configs      -- Webhook 配置
```

#### 迁移方案：Schema 级隔离（推荐）

**初始化 SQL** (`init-db.sql`):

```sql
-- 创建共享数据库
-- 已由 POSTGRES_DB=kais 环境变量创建

-- review-platform 专用 schema
CREATE SCHEMA IF NOT EXISTS review;

-- 公共表由 kais-core-backend 通过 Alembic migration 管理
-- review 表由 kais-review-platform 通过 Alembic migration 管理

-- 用户与权限
CREATE USER review_app WITH PASSWORD 'review_secure_pass';
CREATE USER core_app WITH PASSWORD 'core_secure_pass';

-- core-backend: public schema 全权
GRANT ALL ON SCHEMA public TO core_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO core_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO core_app;

-- review-platform: review schema 全权, public schema 只读
GRANT ALL ON SCHEMA review TO review_app;
GRANT USAGE ON SCHEMA public TO review_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO review_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO review_app;
GRANT ALL ON ALL TABLES IN SCHEMA review TO review_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA review GRANT ALL ON TABLES TO review_app;

-- audit_entries 写入权限（两方都需要写）
GRANT INSERT ON public.audit_entries TO review_app;
GRANT INSERT ON public.audit_entries TO core_app;

-- 序列权限（ID 生成）
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO review_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA review TO review_app;
```

#### Docker Compose 配置变更

```yaml
# 当前 (独立)
kais-review-platform:
  environment:
    - DATABASE_URL=postgresql://review:review@review-db:5432/reviewdb

# V6.0 (共享)
kais-review-platform:
  environment:
    - DATABASE_URL=postgresql://review_app:review_secure_pass@audit-db:5432/kais
    - DB_SCHEMA_PUBLIC=public    # 只读
    - DB_SCHEMA_REVIEW=review    # 读写
  depends_on:
    - audit-db  # 共享 PostgreSQL
```

#### SQLAlchemy 连接配置

```python
# app/core/database.py 改造

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args={"options": f"-c search_path=review,public"}
    # search_path: 优先查 review schema, fallback 到 public
)

# 公共表模型: 指定 schema="public"
class ShotCard(Base):
    __tablename__ = "shot_cards"
    __table_args__ = {"schema": "public"}

# review 专属表: 指定 schema="review"
class GovernanceDecision(Base):
    __tablename__ = "governance_decisions"
    __table_args__ = {"schema": "review"}
```

#### 数据迁移脚本

```python
# migrations/migrate_to_shared_db.py

async def migrate():
    """从独立 reviewdb 迁移数据到共享 kais 库"""
    # 1. 在 kais 库创建 review schema + 表
    # 2. 迁移 shot_cards → public.shot_cards (如 core-backend 未创建)
    # 3. 迁移 audit_entries → public.audit_entries
    # 4. 迁移 policy_versions → review.policy_versions
    # 5. 迁移 webhook_configs → review.webhook_configs
    # 6. 迁移 reviews → public.reviews 或 review.reviews
    # 7. 验证 Merkle 链完整性
```

**工作量**: 2-3 天

### 3.2 权限隔离设计

#### 角色体系扩展

```python
# 当前 (4 角色)
class Role(str, enum.Enum):
    ADMIN = "admin"
    REVIEWER = "reviewer"
    AUDITOR = "auditor"
    AI_SERVICE = "ai_service"

# V6.0 (5+ 角色，来源标识)
class Role(str, enum.Enum):
    ADMIN = "admin"                 # 全局管理
    REVIEWER = "reviewer"           # 兼容旧角色
    REVIEW_GOV = "review_gov"       # review-platform 治理审批
    TOONFLOW_DEEP = "toonflow_deep" # Toonflow 深度审片
    AUDITOR = "auditor"             # 只读分析
    AI_SERVICE = "ai_service"       # AI 评分提交
```

#### 权限矩阵

| 操作 | TOONFLOW_DEEP | REVIEW_GOV | ADMIN | AUDITOR | AI_SERVICE |
|------|:---:|:---:|:---:|:---:|:---:|
| 查看审核列表 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 帧级批注 | ✅ | ❌ | ✅ | ❌ | ❌ |
| 五维评分 (写) | ✅ | ❌ | ✅ | ❌ | ✅ |
| 五维评分 (读) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 治理审批 (approve/reject) | ❌ | ✅ | ✅ | ❌ | ❌ |
| 批量审批 | ❌ | ✅ | ✅ | ❌ | ❌ |
| 移动端快速审批 | ❌ | ✅ | ✅ | ❌ | ❌ |
| 策略管理 | ❌ | ❌ | ✅ | ❌ | ❌ |
| 审计日志查看 | ✅ | ✅ | ✅ | ✅ | ❌ |
| Merkle 验证 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 触发重新生成 | ✅ | ❌ | ✅ | ❌ | ❌ |
| 提交 AI 评分 | ❌ | ❌ | ❌ | ❌ | ✅ |

#### 实现方式

```python
# app/core/auth.py 扩展

from functools import wraps
from fastapi import Depends, HTTPException

def require_role(*allowed_roles: Role):
    """角色守卫装饰器"""
    async def checker(current_user = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(403, f"Role {current_user.role} not allowed")
        return current_user
    return checker

# 治理审批端点
@router.post("/api/v1/shot-cards/{id}/approve",
    dependencies=[Depends(require_role(Role.REVIEW_GOV, Role.ADMIN))])

# Toonflow 深度审片端点
@router.post("/api/v1/shot-cards/{id}/deep-review",
    dependencies=[Depends(require_role(Role.TOONFLOW_DEEP, Role.ADMIN))])

# AI 评分提交
@router.post("/api/v1/shot-cards/{id}/ai-score",
    dependencies=[Depends(require_role(Role.AI_SERVICE, Role.ADMIN))])
```

#### 审计动作隔离

两方写入不同 AuditEntry action 类型，但共享同一 Merkle Tree：

```python
class AuditAction(str, enum.Enum):
    # Toonflow 深度审片
    DEEP_REVIEW_PASS = "deep_review_pass"
    DEEP_REVIEW_REJECT = "deep_review_reject"
    FRAME_ANNOTATION = "frame_annotation"
    
    # review-platform 治理
    GOVERNANCE_APPROVE = "governance_approve"
    GOVERNANCE_REJECT = "governance_reject"
    BATCH_APPROVE = "batch_approve"
    BATCH_REJECT = "batch_reject"
    
    # AI 自动
    AI_AUTO_SCORE = "ai_auto_score"
    AI_AUTO_PASS = "ai_auto_pass"
    AI_AUTO_REJECT = "ai_auto_reject"
    
    # 系统
    SNAPSHOT_CREATED = "snapshot_created"
    MERKLE_ANCHORED = "merkle_anchored"
```

**工作量**: 1-2 天

---

## 4. API 改造

### 4.1 新增 Toonflow 审核模式 API

review-platform 需要为 Toonflow 深度审片工作台提供数据支持 API：

#### 已有 API（保持不变）

```
GET  /api/v1/shot-cards?project_id={id}&status=pending
GET  /api/v1/shot-cards/{id}
POST /api/v1/shot-cards/{id}/approve
POST /api/v1/shot-cards/{id}/reject
POST /api/v1/shot-cards/batch-approve
POST /api/v1/shot-cards/batch-reject
GET  /api/v1/analytics/radar
GET  /api/v1/analytics/scores
GET  /api/v1/audit/merkle/verify
```

#### 新增 API

##### Toonflow 深度审片数据接口

```python
# 获取镜头上下文（前后镜头 + 角色参考图）
@router.get("/api/v1/shot-cards/{id}/context")
async def get_shot_context(
    id: str,
    context_range: int = 2,  # 前后各 N 张
    current_user = Depends(require_role(Role.TOONFLOW_DEEP, Role.ADMIN, Role.REVIEW_GOV)),
):
    """
    返回:
    {
      "current_shot": {...},
      "prev_shots": [{...}, ...],
      "next_shots": [{...}, ...],
      "character_refs": {
        "char_001": { "reference_image": "...", "style_params": {...} }
      },
      "ai_scores": { "overall": 78, "dimensions": {...} }
    }
    """
```

##### 帧级批注接口（Toonflow 专用）

```python
# 提交帧级批注
@router.post("/api/v1/shot-cards/{id}/annotations")
async def submit_frame_annotation(
    id: str,
    annotation: FrameAnnotationRequest,
    current_user = Depends(require_role(Role.TOONFLOW_DEEP, Role.ADMIN)),
):
    """
    FrameAnnotationRequest:
    {
      "frame_number": 15,
      "region": { "x": 0.2, "y": 0.3, "w": 0.1, "h": 0.15 },
      "type": "character_drift | quality_issue | continuity_error | other",
      "comment": "角色左眼与参考图不一致",
      "severity": "low | medium | high | critical"
    }
    """
```

##### 五维评分写入接口

```python
# Toonflow 或 AI 服务提交五维评分
@router.post("/api/v1/shot-cards/{id}/scores")
async def submit_scores(
    id: str,
    scores: ScoreSubmission,
    current_user = Depends(require_role(Role.TOONFLOW_DEEP, Role.AI_SERVICE, Role.ADMIN)),
):
    """
    ScoreSubmission:
    {
      "source": "toonflow_human | ai_model:v1 | ai_model:v2",
      "dimensions": {
        "aesthetics": 82,
        "consistency": 70,
        "compliance": 90,
        "technical_quality": 75,
        "audio_match": 73
      },
      "notes": "角色一致性偏低"
    }
    """
```

##### 治理审批增强（带五维评分）

```python
# 治理审批（review-platform 专用）
@router.post("/api/v1/shot-cards/{id}/approve")
async def governance_approve(
    id: str,
    request: GovernanceApproval,
    current_user = Depends(require_role(Role.REVIEW_GOV, Role.ADMIN)),
):
    """
    GovernanceApproval:
    {
      "comment": "画面质量达标",
      "scores_override": {       // 可选：治理端覆盖评分
        "compliance": 95
      },
      "tags": ["final_pick"]     // 可选标签
    }
    """

@router.post("/api/v1/shot-cards/{id}/reject")
async def governance_reject(
    id: str,
    request: GovernanceRejection,
    current_user = Depends(require_role(Role.REVIEW_GOV, Role.ADMIN)),
):
    """
    GovernanceRejection:
    {
      "reason": "character_drift | quality_issue | continuity_error | compliance | other",
      "comment": "角色面部与参考图不一致",
      "suggested_action": "regenerate | adjust_params | use_alternate",
      "reject_dimensions": ["consistency"],
      "priority": "normal | urgent"
    }
    """
```

#### API 总览

| 类别 | 端点 | 角色 | 状态 |
|------|------|------|------|
| 查询 | `GET /shot-cards` | ALL (读) | 已有 |
| 查询 | `GET /shot-cards/{id}` | ALL (读) | 已有 |
| 查询 | `GET /shot-cards/{id}/context` | TOONFLOW/GOV/ADMIN | **新增** |
| 治理 | `POST /shot-cards/{id}/approve` | GOV/ADMIN | 已有，**增强** |
| 治理 | `POST /shot-cards/{id}/reject` | GOV/ADMIN | 已有，**增强** |
| 治理 | `POST /shot-cards/batch-approve` | GOV/ADMIN | 已有 |
| 治理 | `POST /shot-cards/batch-reject` | GOV/ADMIN | 已有 |
| 深度审片 | `POST /shot-cards/{id}/annotations` | TOONFLOW/ADMIN | **新增** |
| 评分 | `POST /shot-cards/{id}/scores` | TOONFLOW/AI/ADMIN | **新增** |
| 分析 | `GET /analytics/radar` | ALL (读) | **新增** |
| 分析 | `GET /analytics/scores` | ALL (读) | **新增** |
| 审计 | `GET /audit/merkle/verify` | ALL (读) | 已有 |
| 回调 | `POST /reviews/callback` | 内部 | 已有，**升级** |

### 4.2 审核回调接口升级

#### 当前回调格式

review-platform 审批完成后回调 movie-agent，当前是简单格式。

#### V6.0 标准回调格式

```python
# 审核回调 → movie-agent
POST http://kais-movie-agent:8001/api/v1/reviews/callback

{
  "review_id": "rev_001",
  "pipeline_id": "pipe_001",
  "phase": "video",
  "decision": "approved | rejected | needs_revision",
  "items": [
    {
      "shot_id": "shot_003",
      "decision": "approved",
      "reviewer": "user_001",
      "reviewer_role": "review_gov",
      "reviewed_at": "2026-05-23T15:00:00Z",
      "scores": {
        "aesthetics": 85,
        "consistency": 80,
        "compliance": 95,
        "technical_quality": 88,
        "audio_match": 82
      },
      "annotations": [],           // Toonflow 帧级批注（只读回传）
      "reject_reason": null,       // reject 时必填
      "reject_dimensions": [],     // 不达标维度
      "suggested_action": null     // reject 时的建议动作
    }
  ],
  "audit_entry_ids": [             // 关联审计记录
    "audit_uuid_001"
  ],
  "merkle_leaf_hash": "sha256:...",
  "signature": "HMAC-SHA256 signature"
}
```

#### 回调降级策略

```
review-platform 审核中
  → 超时 2h → 降级到本地审核页 (interactive-review)
    → 超时 30min → AUTO 通过 (记录日志)
```

实现位置: `app/services/callback.py` 升级。

#### 安全机制

- **HMAC-SHA256 签名**: 回调内容签名，movie-agent 验证来源
- **Capability Token**: 一次性审核 Token，使用后失效
- **时间戳窗口**: 回调 5 分钟内有效，防重放

**工作量**: 2-3 天

---

## 5. 移动端审批增强

### 5.1 现有能力（已实现）

| 能力 | 实现方式 | 状态 |
|------|----------|------|
| 卡片流浏览 | Alpine.js + 滑动手势 | ✅ |
| 滑动审批 | 左滑 approve / 右滑 reject | ✅ |
| 渐进加载 | 视觉先行 + 音频异步 | ✅ |
| 手势缩放 | 双指 Pinch-to-zoom | ✅ |
| PWA 离线 | Service Worker + Manifest | ✅ |
| Telegram 审批 | Bot InlineKeyboard | ✅ |

### 5.2 增强计划

#### A. 审批流程增强 (P0-P1)

| 功能 | 优先级 | 说明 | 工作量 |
|------|--------|------|--------|
| **审批原因模板** | P0 | reject 时预设原因列表：角色漂移/画质问题/连续性错误/合规问题/其他 | 1d |
| **批量操作** | P0 | 多选模式，批量 approve/reject | 2d |
| **审批撤销** | P1 | 5 分钟内撤回误操作（从 approved/rejected → pending） | 1d |
| **审批委托** | P2 | 将待审核卡片转发给其他审核员 | 2d |

**审批原因模板实现**:

```html
<!-- partials/mobile/_reject_modal.html -->
<div x-data="rejectModal()">
  <div class="reject-reasons">
    <button @click="selectReason('character_drift')">🎭 角色漂移</button>
    <button @click="selectReason('quality_issue')">画质问题</button>
    <button @click="selectReason('continuity_error')">连续性错误</button>
    <button @click="selectReason('compliance')">合规问题</button>
    <button @click="selectReason('other')">其他</button>
  </div>
  <textarea x-model="comment" placeholder="补充说明（可选）"></textarea>
  <button @click="submitReject()">确认驳回</button>
</div>
```

#### B. 上下文增强 (P1)

| 功能 | 说明 | 工作量 |
|------|------|--------|
| **前后镜头对比** | 卡片中显示序列上下文（前后各 1-2 张缩略图） | 2d |
| **AI 评分摘要** | `ai_score_dimensions` 可视化为小型 SVG 雷达图 | 1d |
| **批注预览** | 显示 Toonflow 帧级批注（只读） | 1d |
| **角色一致性面板** | 同一角色参考图 vs 当前镜头 | 2d |

**AI 评分小雷达图**:

```html
<!-- 在卡片内嵌入迷你 SVG 雷达图 -->
<div class="mini-radar">
  <svg viewBox="0 0 100 100" class="w-16 h-16">
    <!-- 五边形路径 + 评分数据路径 -->
    <polygon :points="radarPoints" fill="rgba(59,130,246,0.3)" 
             stroke="rgb(59,130,246)" stroke-width="1"/>
  </svg>
  <span class="score-badge" :class="scoreColor">78</span>
</div>
```

#### C. 通知与离线增强 (P1-P2)

| 功能 | 说明 | 工作量 |
|------|------|--------|
| **Web Push 通知** | PWA Push API，新审核任务推送 | 2d |
| **离线审批队列** | Service Worker 缓存审批决策，恢复网络后批量同步 | 2d |
| **审核队列状态** | 移动端首页展示待审核数量趋势 | 1d |

**总工作量**: 8-12 天

---

## 6. Git 审计追溯集成

### 6.1 现状：已完全对齐 V6.0 ✅

以下功能已完整实现，无需改造：

| 功能 | 实现 | 文件 |
|------|------|------|
| **链式哈希** | AuditEntry prev_hash/own_hash | `app/models/audit.py` |
| **Merkle Tree** | 每日哈希锚定 | `app/core/merkle.py` |
| **Git commit** | Merkle root → Git | `commit_merkle_root_to_git()` |
| **策略版本** | GitOps 管理 | `PolicyVersion` + `git_policy_provider.py` |
| **双写归档** | PG 实时 + MinIO JSONL | `DualWriteAuditRecorder` |

### 6.2 V6.0 集成增强点

虽然基础已对齐，但与 V6.0 其他服务集成时需注意：

#### 与 kais-core-backend Snapshot Service 协作

```
终审通过 (governance_approve)
  → review-platform 写入 AuditEntry (action=GOVERNANCE_APPROVE)
    → 通知 core-backend Snapshot Service
      → core-backend 创建 Git 标签 (v{version})
        → Snapshot 记录写入 public.snapshots
```

#### Merkle Tree 共享一致性

```
Toonflow 深度审片 → audit_entries (TOONFLOW_DEEP)
review-platform 治理审批 → audit_entries (REVIEW_GOV)
                    ↓
              同一 Merkle Tree 计算
                    ↓
          每日 Git commit 锚定
```

**关键约束**: 两方写入的 AuditEntry 必须在同一 Merkle Tree 中计算。在共享 `kais` 数据库后，Merkle 计算应基于 `public.audit_entries` 全表（不分来源），确保审计链完整性。

#### 新增审计动作类型

在 `AuditAction` 枚举中新增（见 3.2 节），确保：
- `governance_approve/reject` — review-platform 治理
- `deep_review_pass/reject` — Toonflow 深度审片
- `batch_approve/reject` — 批量操作
- `ai_auto_score/pass/reject` — AI 自动闸门

**工作量**: 0.5 天（仅枚举扩展 + Merkle 共享验证）

---

## 7. 迁移步骤和依赖关系

### 7.1 迁移阶段总览

```mermaid
gantt
    title review-platform 改造甘特图
    dateFormat YYYY-MM-DD
    axisFormat %m/%d

    section Phase 0: 数据层迁移
    Audit DB 共享方案实施          :p0a, 2026-06-01, 2d
    Init SQL + Schema 创建         :p0b, after p0a, 1d
    数据迁移脚本                   :p0c, after p0b, 1d
    SQLAlchemy 配置改造            :p0d, after p0b, 1d

    section Phase 1: 权限与 API
    角色体系扩展                   :p1a, after p0d, 1d
    权限守卫实现                   :p1b, after p1a, 1d
    Toonflow 审核模式 API          :p1c, after p1b, 2d
    审核回调接口升级               :p1d, after p1b, 2d

    section Phase 2: 仪表盘
    五维雷达图 API                 :p2a, after p1c, 2d
    ECharts 雷达图前端             :p2b, after p2a, 3d
    仪表盘功能完善                 :p2c, after p2b, 2d

    section Phase 3: 移动端增强
    审批原因模板                   :p3a, after p1d, 1d
    批量操作                       :p3b, after p3a, 2d
    AI 评分迷你雷达图              :p3c, after p2a, 1d
    前后镜头对比                   :p3d, after p3a, 2d
    离线审批队列                   :p3e, after p3b, 2d

    section Phase 4: 集成验证
    Merkle 共享验证                :p4a, after p0c, 1d
    Docker Compose 集成            :p4b, after p3e, 1d
    端到端测试                     :p4c, after p4b, 2d
```

### 7.2 详细步骤

#### Phase 0: 数据层迁移 (Day 1-5)

| 步骤 | 任务 | 依赖 | 工作量 | 产出 |
|------|------|------|--------|------|
| 0.1 | 编写 `init-db.sql` (schema + 权限) | 无 | 0.5d | SQL 脚本 |
| 0.2 | Docker Compose 配置变更 (共享 audit-db) | 0.1 | 0.5d | docker-compose.yml |
| 0.3 | SQLAlchemy 模型改造 (schema 指定) | 0.1 | 1d | models 更新 |
| 0.4 | Alembic migration 适配共享 DB | 0.2, 0.3 | 1d | migration 脚本 |
| 0.5 | 数据迁移脚本 (reviewdb → kais) | 0.4 | 1d | migrate_to_shared_db.py |
| 0.6 | Merkle 链完整性验证 | 0.5 | 0.5d | 验证通过 |
| 0.7 | Docker Compose `up` 验证 | 0.6 | 0.5d | 服务正常启动 |

**验收**: `docker-compose up` → review-platform 连接共享 `kais` DB → 历史数据完整 → Merkle 验证通过

#### Phase 1: 权限与 API (Day 5-10)

| 步骤 | 任务 | 依赖 | 工作量 | 产出 |
|------|------|------|--------|------|
| 1.1 | Role 枚举扩展 + AuditAction 扩展 | Phase 0 | 0.5d | auth.py 更新 |
| 1.2 | `require_role()` 守卫实现 | 1.1 | 0.5d | 装饰器 |
| 1.3 | 全部端点添加角色守卫 | 1.2 | 1d | routes 更新 |
| 1.4 | Toonflow 审核 API (`/context`, `/annotations`, `/scores`) | 1.3 | 2d | 新 API |
| 1.5 | 治理审批 API 增强 (原因模板、五维覆盖) | 1.3 | 1d | API 更新 |
| 1.6 | 审核回调接口升级 (V6.0 格式) | 1.3 | 1d | callback.py |
| 1.7 | API 集成测试 | 1.4-1.6 | 1d | 测试通过 |

**验收**: 角色 A 不能调用角色 B 的端点；回调格式符合 V6.0 标准

#### Phase 2: 五维雷达图仪表盘 (Day 10-17)

| 步骤 | 任务 | 依赖 | 工作量 | 产出 |
|------|------|------|--------|------|
| 2.1 | `/analytics/radar` 聚合 API | Phase 1 | 1d | API 端点 |
| 2.2 | `/analytics/radar/{shot_id}` 镜头级 API | 2.1 | 1d | API 端点 |
| 2.3 | ECharts 雷达图 partial (项目级) | 2.1 | 1.5d | HTML partial |
| 2.4 | 镜头级雷达图 (叠加项目平均) | 2.2, 2.3 | 1.5d | HTML partial |
| 2.5 | 异常维度高亮 | 2.3 | 0.5d | 样式 |
| 2.6 | 时间趋势折线图 | 2.3 | 1d | ECharts 折线 |
| 2.7 | 项目对比雷达图 | 2.3 | 1d | 多数据集 |
| 2.8 | 响应式适配 | 2.3-2.7 | 0.5d | 移动端适配 |

**验收**: 仪表盘页展示项目级/镜头级雷达图，低于阈值的维度红色高亮

#### Phase 3: 移动端增强 (Day 12-20, 与 Phase 2 并行)

| 步骤 | 任务 | 依赖 | 工作量 | 产出 |
|------|------|------|--------|------|
| 3.1 | 审批原因模板 (预设列表 + 补充说明) | Phase 1 | 1d | reject modal |
| 3.2 | 批量选择模式 (多选 + 批量审批) | 3.1 | 2d | 多选 UI |
| 3.3 | AI 评分迷你 SVG 雷达图 (卡片内) | 2.1 | 1d | SVG 组件 |
| 3.4 | 前后镜头对比 (序列上下文) | 3.1 | 2d | 缩略图行 |
| 3.5 | 审批撤销 (5 分钟窗口) | 3.1 | 1d | 撤回逻辑 |
| 3.6 | 离线审批队列 (Service Worker) | 3.2 | 2d | SW 缓存 |

**验收**: 移动端 reject 弹出原因模板；可批量选择；卡片内显示迷你评分图

#### Phase 4: 集成验证 (Day 18-22)

| 步骤 | 任务 | 依赖 | 工作量 | 产出 |
|------|------|------|--------|------|
| 4.1 | 全栈 Docker Compose 端到端测试 | Phase 0-3 | 2d | 测试报告 |
| 4.2 | Merkle + Git 标签全链路验证 | 4.1 | 1d | 验证通过 |
| 4.3 | Telegram 审批集成验证 | 4.1 | 0.5d | Bot 正常 |
| 4.4 | 文档更新 (API 文档 + 部署文档) | 4.1 | 0.5d | docs 更新 |

### 7.3 外部依赖

| 依赖 | 来源 | 影响 | 缓解 |
|------|------|------|------|
| **kais-core-backend API** | Phase 2 (core-backend) | Canvas Sync / Snapshot Service | review-platform 可先行开发，用 mock 接口 |
| **AI 评分数据** | kais-gold-team quality-gate | 五维雷达图需要真实数据 | 先用随机数据开发，后接真实数据 |
| **Toonflow 客户端** | Phase 2+ | Toonflow 审核 API 需要客户端联调 | 先提供 API + 文档，Toonflow 独立开发 |
| **共享 audit-db 容器** | Phase 0 (全局) | 数据库 schema 需与 core-backend 协调 | 先建 review schema，public schema 由 core-backend 管理 |

### 7.4 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Schema 迁移数据丢失 | 低 | 高 | 先备份 reviewdb；迁移脚本 dry-run 模式 |
| Merkle 链断裂 | 低 | 高 | 迁移后全量验证 prev_hash/own_hash 链 |
| 角色扩展影响现有功能 | 中 | 中 | 保留 REVIEWER 兼容角色，新角色增量添加 |
| ECharts 移动端性能 | 低 | 低 | 懒加载 + 图表 resize 防抖 |
| 回调格式变更影响 movie-agent | 中 | 中 | 双写过渡期：旧格式 + 新格式并行 |

### 7.5 工作量汇总

| Phase | 天数 | 说明 |
|-------|------|------|
| Phase 0: 数据层迁移 | 5d | Schema + 权限 + 迁移 |
| Phase 1: 权限与 API | 5d | 角色 + 新 API + 回调升级 |
| Phase 2: 五维雷达图 | 7d | API + ECharts 前端 |
| Phase 3: 移动端增强 | 8d | 审批增强 + 离线 |
| Phase 4: 集成验证 | 3d | 端到端测试 |
| **总计** | **~20 天 (4 周)** | 可部分并行 → **3 周可完成** |

---

## 附录: 文件变更清单

### 新增文件

```
init-db.sql                                    — 共享数据库初始化脚本
migrations/migrate_to_shared_db.py             — 数据迁移脚本
migrations/versions/xxx_add_review_schema.py   — Alembic migration
app/api/v1/toonflow.py                         — Toonflow 审核 API
app/api/v1/analytics_radar.py                  — 五维雷达图 API
app/templates/partials/_analytics_radar.html   — ECharts 雷达图 partial
app/templates/partials/mobile/_reject_modal.html — 审批原因模板
app/services/governance.py                     — 治理审批服务
app/models/governance.py                       — GovernanceDecision 模型
```

### 修改文件

```
app/core/database.py                           — SQLAlchemy schema 配置
app/core/auth.py                               — 角色扩展 + 权限守卫
app/core/merkle.py                             — 共享 Merkle 验证
app/models/audit.py                            — AuditAction 枚举扩展
app/models/__init__.py                         — 新模型注册
app/api/v1/reviews.py                          — 审批 API 增强
app/api/v1/analytics.py                        — 雷达图 API 注册
app/services/callback.py                       — V6.0 回调格式
app/templates/pages/mobile.html                — 移动端增强
app/templates/pages/analytics.html             — 仪表盘页
app/web/routes.py                              — 新路由注册
docker-compose.yml                             — 共享 DB 配置
alembic.ini                                    — 连接配置更新
```
