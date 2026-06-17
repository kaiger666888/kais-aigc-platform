# v1.7 Playwright 测试报告

**日期:** 2026-06-18
**测试范围:** v1.7 Infinite Canvas Storyboard & Orchestration (Phase 35-38)
**结果:** ✅ **30 / 30 passed** (59.6s)

## 测试架构

```
packages/infinite-canvas/
├── playwright.config.mjs          # Playwright 配置 + webServer 启动
├── dist/                          # vite build 产物 (服务静态文件)
└── test/e2e/
    ├── helpers.mjs                # 公共 helper (loadCanvas / getCalls / setSelectedNodeIds)
    ├── mock-backend/server.mjs    # Express + Socket.IO mock 服务
    ├── tests/
    │   ├── phase35-storyboard-metadata.mjs   # 7 tests
    │   ├── phase36-orchestrator.mjs          # 9 tests
    │   ├── phase37-batch-execution.mjs       # 8 tests
    │   └── phase38-storyboard-preview.mjs    # 6 tests
    └── results/                   # HTML / JSON / screenshots / traces
```

## 运行方式

```bash
cd packages/infinite-canvas
npx playwright test                # 跑全部 30 个测试
npx playwright test phase35        # 只跑 Phase 35
npx playwright show-report         # 打开 HTML 报告
```

## Mock Backend 设计

`test/e2e/mock-backend/server.mjs` 提供完整的 v1.7 API 模拟:

- **画布持久化:** `POST /api/canvas/load` + `POST /api/canvas/save` — 内存数据库 (`o_agentWorkData` 等价)
- **编排器:** `POST /api/canvas/orchestrate` — 按节点类型拓扑序执行,通过 Socket.IO 推送 `orchestrate:start/progress/done`
- **批量执行:** 同一个 endpoint 接收 `nodeIds: string[]`,自动切 `mode='batch'`
- **分镜预览:** `POST /api/canvas/storyboard/preview` — 延迟广播 `node:preview`
- **单节点执行:** `POST /api/canvas/execute` — 保持向后兼容
- **Skill registry:** `GET /api/v1/skills/:id/node-types` — 返回 5 个内置节点类型

**测试控制接口:**
- `POST /__mock/reset` — 重置 mock 数据库 + config + 清空 activeRuns(终止进行中的 orchestrate)
- `POST /__mock/config` — 动态调整 `orchDelay` / `previewDelay` / `failSecondNode`
- `GET /__mock/calls` — 已记录的 API 调用日志(断言用)
- `GET /__mock/state` — 当前 mock 数据库(验证持久化)
- `POST /__mock/emit` — 主动广播事件(模拟失败场景)

## 测试覆盖矩阵

### Phase 35 — Storyboard Metadata Extension (7 tests)
| Requirement | Test | 状态 |
|---|---|---|
| STORYBOARD-05 | chips render for populated metadata fields | ✅ |
| STORYBOARD-05 | empty fields do not render chips | ✅ |
| STORYBOARD-06 | NodeDetailPanel shows 4 dropdown editors | ✅ |
| STORYBOARD-06 | dropdown change updates store immediately | ✅ |
| STORYBOARD-06 | "未设置" option clears the field | ✅ |
| STORYBOARD-07 | save → reload round-trip preserves metadata | ✅ |
| STORYBOARD-07 | enums enforce valid values (9 options + 未设置) | ✅ |

### Phase 36 — One-Click Film Orchestrator (9 tests)
| Requirement | Test | 状态 |
|---|---|---|
| ORCHESTRATE-01 | button visible + enabled when canvas has nodes | ✅ |
| ORCHESTRATE-01 | button disabled when canvas empty | ✅ |
| ORCHESTRATE-02 | clicking button POSTs /api/canvas/orchestrate (mode='full') | ✅ |
| ORCHESTRATE-03 | topology order (script→asset→storyboard→video→audio) | ✅ |
| ORCHESTRATE-04 | success/cached nodes are skipped | ✅ |
| ORCHESTRATE-05/06 | progress bar + button shows 运行中 (N/M) | ✅ |
| ORCHESTRATE-06 | button disabled while running | ✅ |
| ORCHESTRATE-07 | completion toast "5/5 节点成功" | ✅ |
| ORCHESTRATE-07 | single-node failure does not abort the run | ✅ |

### Phase 37 — Batch Execution (8 tests)
| Requirement | Test | 状态 |
|---|---|---|
| BATCH-01 | multi-select + right-click shows batch menu entry | ✅ |
| BATCH-01 | menu shows correct selection count | ✅ |
| BATCH-01 | pane right-click alone (no multi-select) does NOT show batch | ✅ |
| BATCH-02 | batch execution POSTs orchestrate with explicit nodeIds (mode='batch') | ✅ |
| BATCH-03 | success nodes in batch are skipped | ✅ |
| BATCH-04 | batch progress uses same WebSocket channel | ✅ |
| BATCH-05 | single-node right-click still has "执行节点" entry | ✅ |
| BATCH-05 | single-node "执行节点" triggers /api/canvas/execute | ✅ |

### Phase 38 — Storyboard Preview (6 tests)
| Requirement | Test | 状态 |
|---|---|---|
| PREVIEW-01 | 预览构图 button visible on storyboard node | ✅ |
| PREVIEW-01 | button enabled when linkedAssetIds > 0 AND prompt non-empty | ✅ |
| PREVIEW-02 | clicking button POSTs /api/canvas/storyboard/preview | ✅ |
| PREVIEW-01 | shows "预览生成中..." toast on click | ✅ |
| PREVIEW-05 | non-storyboard nodes do not have the preview button | ✅ |
| PREVIEW-05 | preview failure does not block main flow | ✅ |

## 测试策略要点

### 1. React Flow 多选难题
React Flow v12 的 `selectionOnDrag` + Shift+click 在 headless Playwright 中不稳定。我们通过 `?testMode=1` URL 参数在 canvas bundle 中暴露 `window.__kaisCanvas` 控制接口,测试直接调用 `setSelectedNodeIds` 来设置多选状态 — 这绕过了 React Flow 的 DOM 交互层,但完整验证了 v1.7 的应用层逻辑(CanvasContextMenu 读取 `selectedNodeIds` 并调用 orchestrate endpoint)。

仅在生产 bundle 中 testMode 参数被显式传入时激活,不影响生产环境。

### 2. 跨测试状态隔离
每个测试的 `loadCanvas` helper:
1. `page.goto` 加载页面
2. `POST /__mock/reset` 清空 mock 数据库 + config + 清空 activeRuns(终止进行中的 orchestrate)
3. 再次 `page.goto` 让页面基于干净状态加载

mock 的 `activeRuns` 集合确保进行中的 orchestrate 循环会在 reset 后自动终止,避免上一个测试的 orchestrate 事件污染下一个测试。

### 3. Socket.IO Path 配置
mock server 必须用默认 path `/socket.io`(不能自定义 `/ws/projects/socket.io`),因为客户端 `useCanvasSocket` 没有显式设置 path,使用 Socket.IO 默认值。

### 4. 拓扑序验证
通过 ESM 动态 import socket.io-client (CDN) 在浏览器上下文中创建第二个 socket 监听 `orchestrate:progress` 事件,记录 `currentNodeId` 的出现顺序,验证拓扑序 (asset → storyboard → video)。

## 已知约束

1. **headless 限制:** Phase 37 BATCH-01 的 UI 路径(Shift+click / drag-select)在 headless Chromium 中不可靠,通过 testMode hook 绕过。生产环境的真实交互手动验证通过。
2. **真实引擎未集成:** Phase 38 PREVIEW-02..04 的真实 gold-team IMAGE_DRAW 引擎集成仍未实现(这是 v1.7 设计上的延期项,见 STATE.md Deferred Items)。当前测试验证的是路由 + UI + WebSocket 通道的契约。
3. **网络文件:** Phase 36 ORCHESTRATE-03 测试通过 `https://cdn.socket.io/4.8.1/socket.io.esm.min.js` 动态加载 socket.io-client — 离线环境下需要预下载此文件。

## 性能数据

- 全部 30 个测试:**59.6s**(单 worker,串行)
- 平均每个测试:~2s
- 最慢的测试:ORCHESTRATE-03 拓扑序(4.5s,需要 5 节点 × 300ms 延迟)
- 最快的测试:~1.6s(简单的按钮存在性断言)
