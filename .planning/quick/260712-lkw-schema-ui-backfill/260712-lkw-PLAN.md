---
quick_id: 260712-lkw
slug: schema-ui-backfill
description: "治本 - 修复资产节点字段缺失根因（schema/导入/UI/backfill）"
date: 2026-07-12
mode: quick
status: planning
---

# Quick Task 260712-lkw: 治本 — 资产节点字段缺失根因修复

## Background

调研显示 689 个 asset 节点中只有 68 个有 `prompt`、11 个有 `assetId` 异步兜底钩子，
大量节点（P04 角色设计 256/256、P07 视觉+风格化 134/134、P08 场景选择 52/52）的
`data` JSON 只有 `label + assetType`，详情面板无内容可显。

根因链条：

1. **Python manifest 写入端**（sibling repo `kais-movie-agent`）：phase 输出的
   `manifest.json` 里完全没有 `prompt` / `description` 字段，只有 `params.*`
   结构化字段（archetype/role 等）。— **本仓库外，本次不动**。
2. **`import-from-dir.ts`**：读取 manifest 时，`itemToArtifact` 只摊平 item
   顶层 scalar，**不展开 `item.params.*`** → manifest 里有的 archetype/role 等
   全部丢失。媒体目录扫描也不读 `.txt` sidecar。
3. **`canvasAssetSchema.ts`**：asset schema 没有 `prompt` / `description` 字段
   声明，所以即使数据存在也未经 schema 流通。
4. **`NodeDetailPanel.tsx` AssetDetail**：只读 `data.prompt`，**不读
   `description`/`tags`/`filename`/`output_key`** → 现存 313 个有 description
   的节点也显示空白。
5. **`PATCH /nodes/batch`**：批量写接口完全跳过 schema 校验。

## Scope

**本仓库内** 的 4 个修复点 + 1 个 backfill 脚本。Python manifest 写入端在 sibling
repo，本次不动 — 但本仓库的 `import-from-dir.ts` 改完后会消化 manifest 已有的
`params.*`，所以 sibling repo 不动也能立即改善。

## Tasks

### Task 1: `import-from-dir.ts` — 摊平 params + 读 .txt sidecar

**Files:**
- `src/routes/canvas/v2/import-from-dir.ts`

**Action:**
1. In `itemToArtifact()`（line ~313）: 当 `item.params` 是 object 时，把里面的
   scalar 字段（`archetype`/`role`/`prompt`/`description`/`view`/`era` 等）merge
   到 `art.extra`，**不覆盖已有的同名字段**。
2. In `artifactsFromMediaFiles()`（line ~438）: 每个媒体文件查找同名 `.txt`
   sidecar（e.g. `foo.png` → `foo.txt`），存在则读取前 500 字符作为
   `description`，并复制到 `prompt`。

**Verify:**
- 对 `data/oss/1783348418513/p04/manifest.json`（有 params.archetype）跑一次本地
  extract，确认 archetype 出现在 artifact 上。
- 对一个含 `.txt` sidecar 的目录跑 `artifactsFromMediaFiles`，确认 description
  被填入。

**Done:** extractArtifactsFromJSON + artifactsFromMediaFiles 单元手测通过。

---

### Task 2: `canvasAssetSchema.ts` — 声明 prompt/description

**Files:**
- `src/lib/canvasAssetSchema.ts`

**Action:**
1. 在 `asset` schema 加 `prompt: z.string().optional()` 和
   `description: z.string().optional()`。
2. 在文件顶部注释更新 contract 描述：管线 SHOULD 填 prompt 或 description；UI 应
   fallback。

**Verify:** tsc；调用 `validateNodeData("asset", {label, assetType, filePath, prompt})` 通过。

**Done:** schema 接受 prompt/description，不破坏现有数据。

---

### Task 3: `NodeDetailPanel.tsx` AssetDetail — fallback 显示

**Files:**
- `packages/infinite-canvas/src/components/NodeDetailPanel.tsx`

**Action:**
1. `AssetDetail`：prompt 缺失时显示 `data.description`（用同样的 prompt 卡片样式，
   标签从 "Prompt 描述" 改为 "描述"）。
2. 当 `data.tags` 是非空数组时，渲染 tags chip 行（参照 ScriptDetail）。
3. 当 `data.filename` 或 `data.output_key` 存在时，在底部加一行小字 metadata：
   "📄 {filename} · {output_key}"，给用户至少看到来源信息。

**Verify:** tsc；用一个只有 description 没有 prompt 的 asset 节点在浏览器里验证
显示正常。

**Done:** 现存 313 个 description-bearing asset 节点立即变为可读。

---

### Task 4: `PATCH /nodes/batch` 加 schema 校验

**Files:**
- `src/routes/canvas/v2/nodes.ts`

**Action:**
- 在 `PATCH /nodes/batch` 循环里，对每个 node 调用 `validateNodeData`，若有错则
  整批拒绝（400），错误信息列出所有失败节点。

**Verify:** tsc；POSTman/curl 一个缺 label 的 asset 到 `/nodes/batch`，确认 400。

**Done:** 关闭批量写校验漏洞。

---

### Task 5: backfill 脚本（仅写，不执行）

**Files:**
- `scripts/backfill-asset-description.ts`（新建）

**Action:**
- 读取 `canvas_nodes` 全部 asset 节点；对每个节点：
  - 若 `data.params` 存在，把 params 里 scalar 字段 merge 到 data 顶层
  - 若 `data.prompt` 为空但 `data.description` 非空，复制 description → prompt
  - 若两者皆空，从 `data.filename` / `data.name` 生成默认 description
- 写回 `canvas_nodes.data`，**dry-run 默认**，`--apply` 才真正落库。
- 报告：扫描 N 个节点，修改 M 个。

**Verify:** `tsx scripts/backfill-asset-description.ts`（dry-run）输出统计合理。

**Done:** 脚本就绪；用户决定何时 `--apply`。

---

## Out of Scope

- Python manifest writer（在 sibling repo `kais-movie-agent`）
- P08 场景选择 phase 的 52 个完全空壳节点（phase 本身没生成媒体，需要 phase 侧
  修复或 UI 标记为 placeholder）
- 现有数据的 backfill 执行（脚本只写到 dry-run，由用户决定）

## Verification

- `npx tsc --noEmit` 通过
- 对 1-2 个 sample manifest.json 跑 extractArtifactsFromJSON，检查 artifact.data
  含 params 字段
- 浏览器加载一个有 description 无 prompt 的 asset 节点，看到描述卡片
