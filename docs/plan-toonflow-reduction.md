# Toonflow 工作台减法重构 — 实施方案

> **日期**: 2026-06-27
> **目标**: 砍掉 Toonflow 工作台交互层（路由 + Electron + 空表），保留精简关系表作为无限画布的资产层
> **原则**: 只减不加。不新建模块，不新建表。砍完后系统必须正常启动且画布功能不受影响。

---

## 现状基线

| 指标 | 数值 |
|------|------|
| src/routes/ 总行数 | 20,210 |
| 路由总数 | 254 |
| Toonflow 工作台路由 | ~179 个 (~7,000 行) |
| 画布 v2 路由 | 21 个 (2,849 行) |
| v1 引擎路由 | 46 个 (4,745 行) |
| Electron scripts | 522 行 + 10 个 devDep |
| 空表 | 7 张 |

---

## 真实依赖图（已验证）

以下 Toonflow 路由**被外部消费者实际调用**，不可直接砍：

```
agent-sync.js 调用:
  /api/project/getProject      ← 查项目
  /api/project/addProject      ← 建项目
  /api/script/addScript        ← 写剧本
  /api/assets/addAssets        ← 写角色/场景图片
  /api/assets/addAudioAssets   ← 写音频
  /api/canvas/save             ← 写画布 FlowGraph (v1 接口)

pipeline-results.ts 调用:
  /api/project/getProject      ← 同上
  /api/project/addProject      ← 同上
  /api/script/addScript        ← 同上
  /api/assets/addAssets        ← 同上
  /api/production/storyboard/addStoryboard  ← 写分镜

convert.ts 读取:
  o_project / o_script / o_assets / o_image / o_storyboard
  o_scriptAssets / o_assets2Storyboard / o_assetsRole2Audio
  o_video / o_videoTrack / o_audio / o_agentWorkData
```

**结论: 只有 5 个 Toonflow 路由有真实外部消费者。**

---

## Phase 1: 安全切除死代码（零风险）

**目标**: 砍掉 0 依赖、0 数据的模块。

### 1.1 删除路由文件

| 模块 | 行数 | 文件数 | 理由 |
|------|------|--------|------|
| `novel/` | 378 | 12 | o_novel 空，无人调用 |
| `artStyle/` | 116 | 4 | o_artStyle 空，无人调用 |
| `cornerScape/` | 213 | 4 | o_assetsRole2Audio 空，pipeline-results 引用但 kv_pipelineRun=0 |
| `assetsGenerate/` | 556 | 5 | Toonflow 工作台专用，无人调用 |
| `production/editImage/` | 235 | 6 | o_imageFlow 空，无人调用 |
| `production/assets/` | 214 | 4 | Toonflow 工作台专用，无人调用 |
| `scriptAgent/` | 116 | 3 | 被 hermes-agent 替代 |
| `login/` | 46 | 1 | Electron 专用 |
| `other/` | 24 | 2 | 删除数据功能 |
| `test/` | 12 | 1 | 测试桩 |
| `setting/dbConfig/` | 168 | 5 | Electron 设置页 |
| `setting/dev/` | 31 | 2 | Electron 开关 |
| `setting/fileManagement/` | 31 | 1 | Electron 文件夹 |
| `setting/loginConfig/` | 32 | 2 | Electron 密码 |
| `setting/memoryConfig/` | 90 | 3 | Electron 记忆 |
| `setting/about/` | 106 | 2 | Electron 更新检查 |
| `general/` | 87 | 3 | Electron 统计面板 |
| `task/` | 92 | 4 | Electron 任务 |
| `agents/` | 78 | 2 | Electron Agent |

**小计: ~2,625 行, 66 个文件**

### 1.2 删除空表

```sql
DROP TABLE IF EXISTS o_novel;
DROP TABLE IF EXISTS o_event;
DROP TABLE IF EXISTS o_eventChapter;
DROP TABLE IF EXISTS o_imageFlow;
DROP TABLE IF EXISTS o_assetsRole2Audio;
DROP TABLE IF EXISTS kv_syncEvent;
DROP TABLE IF EXISTS kv_nodeAsset;
DROP TABLE IF EXISTS kv_shot;
DROP TABLE IF EXISTS kv_shotGraph;
DROP TABLE IF EXISTS kv_snapshot;
DROP TABLE IF EXISTS kv_audit;
DROP TABLE IF EXISTS o_tasks;
DROP TABLE IF EXISTS memories;
```

### 1.3 验证

- `yarn lint` (tsc --noEmit) 通过
- `yarn dev:server` 启动无报错
- 画布页面打开正常 (/infinite-canvas)
- convert / save-v2 / load-v2 / nodes 正常响应

---

## Phase 2: 切除工作台前端路由（中风险）

**目标**: 砍掉只有 Electron 工作台前端消费的路由，保留被 agent-sync / pipeline / convert 实际调用的 5 个路由。

### 2.1 保留的 Toonflow 路由（白名单）

| 路由 | 消费者 | 理由 |
|------|--------|------|
| `project/getProject` | agent-sync, pipeline-results | 查询项目列表 |
| `project/addProject` | agent-sync, pipeline-results | 创建项目 |
| `project/editProject` | convert.ts 间接 | 项目编辑 |
| `project/delProject` | — | 项目删除（配套保留） |
| `script/addScript` | agent-sync, pipeline-results | 写入剧本 |
| `assets/addAssets` | agent-sync, pipeline-results | 写入角色/场景 |
| `assets/addAudioAssets` | agent-sync | 写入音频 |
| `production/storyboard/addStoryboard` | pipeline-results | 写入分镜 |

### 2.2 删除的路由（黑名单）

| 模块 | 行数 | 理由 |
|------|------|------|
| `script/extractAssets` | ~60 | Toonflow 工作台专用 |
| `script/getScrptApi` | ~40 | 同上 |
| `script/exportScript` | ~50 | 同上 |
| `script/getAiRegex` | ~30 | 同上 |
| `script/pollScriptAssets` | ~50 | 同上 |
| `script/batchAddScript` | ~50 | 同上 |
| `script/delScript` | ~30 | 同上 |
| `script/updateScript` | ~50 | 同上 |
| `assets/getImage` | ~40 | Toonflow 工作台专用 |
| `assets/delImage` | ~30 | 同上 |
| `assets/delAssets` | ~30 | 同上 |
| `assets/batchDelete` | ~30 | 同上 |
| `assets/getAssetsApi` | ~40 | 同上 |
| `assets/updateAssets` | ~50 | 同上 |
| `assets/saveAssets` | ~40 | 同上 |
| `assets/uploadClip` | ~30 | 同上 |
| `assets/uploadImage` | ~60 | 同上 |
| `assets/updateAudioAssets` | ~40 | 同上 |
| `assets/pollingPromptAssets` | ~40 | 同上 |
| `assets/pollingImageAssets` | ~40 | 同上 |
| `assets/batchGenerationData` | ~40 | 同上 |
| `assets/getMaterialData` | ~40 | 同上 |
| `production/workbench/*` | 1,092 | Toonflow 工作台视频生成，无人调用 |
| `production/storyboard/*`（除 addStoryboard） | ~650 | 同上 |
| `project/` 中 Director/Visual Manual 相关 | ~500 | Electron 手册功能 |
| `project/getModelDetails` | ~50 | Electron 模型选择 |
| `project/visualManual` | ~40 | 同上 |
| `setting/modelMap/*` | 198 | Electron prompt 映射 |

**小计: ~3,500 行**

### 2.3 验证

- agent-sync.js 6 个 API 调用全部正常
- convert.ts 正常读取关系表
- pipeline ingest 正常写入

---

## Phase 3: 切除 Electron 壳（低风险）

**目标**: 去掉 Electron 构建/打包依赖。

### 3.1 删除

| 文件 | 行数 | 理由 |
|------|------|------|
| `scripts/main.ts` | ~150 | Electron 主进程 |
| `scripts/build.ts` | ~200 | Electron 打包脚本 |
| `scripts/license.ts` | ~80 | Electron 许可证 |
| `scripts/vendor2json.ts` | ~90 | Electron 供应商导出 |
| `electron-builder.yml` (如有) | — | 打包配置 |

### 3.2 package.json 清理

移除 devDependencies:
- `electron`
- `electronmon`
- `@electron/rebuild`
- `electron-builder`（间接）

移除 scripts:
- `dev:gui` / `dev:gui-vite`
- `pack` / `dist` / `dist:win` / `dist:mac` / `dist:linux`

保留 scripts:
- `dev:server` / `start:server` / `start`
- `lint` / `build`（重写为纯 Node 构建）

**小计: ~520 行 + 4 个 devDep**

### 3.3 验证

- `yarn dev:server` 启动正常
- `yarn start:server` 生产模式启动正常

---

## 不动的部分

| 模块 | 行数 | 理由 |
|------|------|------|
| `canvas/` 全部 | 2,849 | 核心画布 |
| `v1/` 全部 | 4,745 | GPU 引擎调度 |
| `vendor 适配器` | 4,568 | 核心商业资产 |
| `setting/vendorConfig/` | 776 | 供应商配置管理 |
| `setting/skillManagement/` | 81 | 技能管理 |
| `setting/promptManage/` | 38 | prompt 模板 |
| `setting/agentDeploy/` | 125 | AI 模型配置 |
| `proxy/` | 87 | gold-team/review 转发 |
| `production/flux/` | 835 | 画布引擎调度 |
| `production/wan22/` | 431 | 画布引擎调度 |
| `production/ltx/` | 1,809 | 画布引擎调度 |
| `production/postprocess/` | 336 | 画布引擎调度 |
| `packages/infinite-canvas/` | 8,196 | 画布前端 |

---

## 预期成果

| 指标 | 改造前 | 改造后 | 变化 |
|------|--------|--------|------|
| src/routes/ 行数 | 20,210 | ~13,000 | -36% |
| 路由总数 | 254 | ~130 | -49% |
| 数据库表 | 36 | 23 | -36% |
| Electron devDep | 4 | 0 | -100% |
| 系统启动路由注册时间 | ~1.2s | ~0.6s | -50% (估) |

---

## 执行顺序

```
Phase 1 (零风险)
  ├─ 1.1 删除 19 个死路由模块 (66 文件, 2625 行)
  ├─ 1.2 删除 13 张空表
  ├─ 1.3 验证 → git commit
  │
Phase 2 (中风险)
  ├─ 2.1 确认白名单 (8 个保留路由)
  ├─ 2.2 删除黑名单路由 (~3500 行)
  ├─ 2.3 验证 agent-sync / convert / pipeline
  ├─ 2.4 git commit
  │
Phase 3 (低风险)
  ├─ 3.1 删除 Electron scripts (520 行)
  ├─ 3.2 清理 package.json (4 devDep)
  ├─ 3.3 验证启动
  └─ 3.4 git commit
```

每个 Phase 独立提交，可随时回退。
