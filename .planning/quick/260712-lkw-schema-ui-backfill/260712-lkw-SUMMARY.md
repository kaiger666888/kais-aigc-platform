---
quick_id: 260712-lkw
slug: schema-ui-backfill
description: "治本 - 修复资产节点字段缺失根因（schema/导入/UI/backfill）"
date: 2026-07-12
status: complete
mode: quick
commits:
  - 3978346f  # import-from-dir: flatten params + .txt sidecars
  - 4a6f57f3  # schema: prompt/description + batch validation
  - 77569b2f  # UI: AssetDetail fallback rendering
  - c574ae08  # backfill script (dry-run by default)
---

# Quick Task 260712-lkw — 治本 — 资产节点字段缺失根因修复

## What changed

四道治本修复 + 一份 backfill 脚本，针对 "无限画布资产节点只有标签没有内容详述"
的根因链条。

### 1. `src/routes/canvas/v2/import-from-dir.ts`（commit 3978346f）

- `itemToArtifact` 现在摊平 `item.params.*` 到 `art.extra`（不覆盖已有字段）—
  archetype/role/era/prompt 等 manifest 结构化字段不再被默默丢弃。
- `artifactsFromMediaFiles` 改为 async，对每个媒体文件探测同名 `.txt` sidecar
  （`foo.png` → `foo.txt`），存在则把前 500 字符作为 `description` 和 `prompt`。
- `RawArtifact` 接口加入显式 `prompt` 字段；`buildPhaseTree` 把 `art.prompt`
  透传到 `node.data.prompt`。
- `scanWorkdirForArtifacts` 三处 caller 改为 `await`。

### 2. `src/lib/canvasAssetSchema.ts`（commit 4a6f57f3）

- asset schema 声明 `prompt: z.string().optional()` 和 `description: z.string().optional()`。
- 注释更新契约：管线 SHOULD 至少填一个；UI fallback。
- 同 commit 顺带纳入未提交的 withYamlOptional/YAML_OPTIONAL_FIELDS 集成（与
  `schema/pipeline-field-map.yaml` 单一真相源对齐）。

### 3. `src/routes/canvas/v2/nodes.ts`（commit 4a6f57f3）

- `PATCH /nodes/batch` 之前完全跳过 schema 校验。现在在写入前对整批调用
  `validateNodeData`，任一节点失败 → 400 + 全节点错误列表，整批回滚，不部分提交。

### 4. `packages/infinite-canvas/src/components/NodeDetailPanel.tsx`（commit 77569b2f）

- `AssetDetail` 按优先级渲染：
  1. `data.prompt` → "Prompt 描述"（原行为）
  2. `data.description` → "描述"（仅当 prompt 缺失）— 立即修复 313 个有 description
     无 prompt 的现存节点
  3. `data.tags` → 标签 chip 行 — 覆盖 659 个有 tags 的节点
  4. `data.filename / output_key / name` → "来源" 行（仅当上述皆空）— 兜底
     防止详情面板完全空白。

### 5. `scripts/backfill-asset-descriptions.py`（commit c574ae08）

- 一发 backfill，dry-run 默认。策略：
  1. 把 `data.params.*` 摊平到 `data` 顶层
  2. description→prompt 镜像（267 节点）
  3. prompt→description 镜像（6 节点）
  4. 从 archetype/role/filename/output_key 合成（257 节点）
- Dry-run 统计：690 个 asset 节点，160 已完整，530 可修复，0 无信号。

## Verification

- `npx tsc --noEmit`：无新错误（既存 3 个错误与本任务无关）。
- `packages/infinite-canvas` 包内 tsc：NodeDetailPanel.tsx 无错误。
- 对真实 manifest 抽样验证：`extractArtifactsFromJSON` + `flattenParams` 现在能
  正确从 `p04` 拿到 archetype/role，从 `p07` 拿到 scene_id，从 `p09` 拿到 shot_id。
- backfill dry-run 输出符合预期。

## Out of scope（明确不做）

- **Python manifest writer**：在 sibling repo `kais-movie-agent`，本次不动。
  但本仓库的 import-from-dir 改完后已能消化 manifest 已有的 `params.*`，所以
  sibling repo 不动也能立即改善新导入。
- **P08 场景选择 52 个完全空壳节点**：phase 本身没生成媒体，需要 phase 侧
  修复或 UI 标记为 placeholder — 适合单独的 phase 侧任务。
- **执行 backfill**：脚本只写到 dry-run，由用户决定何时 `--apply`。

## Recommended follow-up

1. 跑 `python3 scripts/backfill-asset-descriptions.py --apply` 修复现存 530 节点。
2. 重新加载画布前端，抽样验证 P04/P07 资产节点详情面板有内容。
3. （可选）在 sibling repo `kais-movie-agent` 的 manifest writer 加 `prompt`/`description`
   字段，进一步从源头减少对 backfill 的依赖。
