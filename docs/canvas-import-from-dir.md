# 画布自动加载：import-from-dir

> 路径 B 方案 — 从约定 workdir 目录结构自动扫描资产，创建画布节点。
> 与路径 A（runner.py Phase 37 自动同步）互补，适用于手动编排或历史项目。

## Endpoint

```
POST /api/canvas/v2/import-from-dir
```

### Body

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `projectId` | number | ✅ | 画布项目 ID |
| `episodesId` | number | ✅ | 画布 episodes ID |
| `workdir` | string | ✅ | 项目工作目录绝对路径 |
| `projectName` | string | ❌ | 项目名（仅用于元信息） |
| `mode` | string | ❌ | `"merge"`（默认，追加到已有画布）或 `"replace"`（全量替换） |

### Response

```json
{
  "code": 200,
  "data": {
    "imported": 17,
    "links": 4,
    "mode": "replace",
    "workdir": "/home/kai/p1800-love-life"
  }
}
```

## 约定目录结构

import-from-dir 自动扫描 workdir 下以下两类资产：

### 1. Phase JSON 文件（根目录）

文件名前缀匹配 → 自动映射到泳道和节点类型：

| 文件名前缀 | 泳道 | 节点类型 | 说明 |
|---|---|---|---|
| `p02_outline` | 0 剧本 | script | 剧本大纲 |
| `p03_script` | 0 剧本 | script | 剧本审计 |
| `p04_character_bible` | 1 资产 | asset | 角色设计 |
| `p05_pain_points` | 0 剧本 | script | 痛点分析 |
| `p06_*` | 2 分镜 | storyboard | 分镜脚本 |
| `p07_scene*` | 1 资产 | reference | 场景参考图 |
| `p07_dreamina*` | 1 资产 | asset | 场景图生成 |
| `p08_scene*` | 2 分镜 | storyboard | 场景分配 |
| `p09_shot_list` | 2 分镜 | storyboard | 镜头列表 |
| `p10_voice*` | 4 音频 | audio | 旁白配音 |
| `p11_video*` | 3 视频 | video | 视频生成 |
| `p11_prompt*` | 3 视频 | video | 视频提示词 |

### 2. 资产目录（assets/）

| 目录 | 泳道 | 节点类型 | 说明 |
|---|---|---|---|
| `assets/scene_images/` | 1 资产 | reference | 场景参考图（PNG/JPG） |
| `assets/video_clips/` | 3 视频 | video | 视频片段（MP4） |
| `assets/narration/` | 4 音频 | audio | 旁白音频（OGG/MP3） |

### 3. 最终产物（output/）

| 文件 | 泳道 | 说明 |
|---|---|---|
| `output/*.mp4` | 3 视频 | 最终合成视频，标记为 `isWinner` |

## 使用示例

### curl

```bash
# 全量替换模式
curl -X POST http://127.0.0.1:10588/api/canvas/v2/import-from-dir \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": 1782917851431,
    "episodesId": 1,
    "workdir": "/home/kai/p1800-love-life",
    "mode": "replace"
  }'

# 合并模式（追加到已有画布）
curl -X POST http://127.0.0.1:10588/api/canvas/v2/import-from-dir \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": 1782917851431,
    "episodesId": 1,
    "workdir": "/home/kai/p1800-love-life",
    "mode": "merge"
  }'
```

### Python (CanvasClient)

```python
import httpx

resp = httpx.post("http://127.0.0.1:10588/api/canvas/v2/import-from-dir", json={
    "projectId": 1782917851431,
    "episodesId": 1,
    "workdir": "/home/kai/p1800-love-life",
    "mode": "replace",
})
print(resp.json())
```

## 两条路径对比

| | 路径 A: runner.py 自动同步 | 路径 B: import-from-dir |
|---|---|---|
| **触发方式** | runner.py 每个 phase 完成后自动触发 | 手动调用 API |
| **适用场景** | 通过 runner.py 跑的新项目 | 手动编排的项目、历史项目回填 |
| **数据粒度** | 精细（每个 phase 的产出物 + review 结果） | 文件级（按约定文件/目录映射） |
| **实时性** | 实时（phase 完成即同步） | 按需（调用时扫描） |
| **代码路径** | `canvas_sync.py` → `on_phase_complete` | `routes/canvas/v2/import-from-dir.ts` |

## 源文件

- Endpoint: `src/routes/canvas/v2/import-from-dir.ts`
- 路由注册: 自动生成（core.ts → router.ts）
- 数据写入: 复用 `appendAndSync()` (canvasEventStore.ts)
