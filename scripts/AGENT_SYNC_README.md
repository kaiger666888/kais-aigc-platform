# Toonflow Agent 产出物同步脚本 - 使用说明

## 概述

本脚本用于将 OpenClaw Agent 管线各步骤的产出物同步到 Toonflow 数据库，以便在前端展示和审核。

## 位置

```bash
/home/kai/workspace/kais-aigc-platform/scripts/agent-sync.js
```

## 支持的资产类型

| 类型 | 说明 | 对应 Step | API 端点 |
|------|------|-----------|----------|
| `script` | 剧本内容 | 5, 6 | `/api/script/addScript` |
| `character_image` | 角色图片 | 7, 8 | `/api/v1/pipeline/ingest/images` |
| `scene_image` | 场景图片 | 9, 10 | `/api/v1/pipeline/ingest/images` |
| `voice` | 语音文件 | 13B, 18 | `/api/assets/addAudioAssets` |
| `video_preview` | 预览视频 | 14 | `/api/v1/pipeline/ingest/videos` |
| `video_final` | 终版视频 | 17 | `/api/v1/pipeline/ingest/videos` |

## 使用方式

### 基本语法

```bash
node scripts/agent-sync.js \
  --project-name <项目名称> \
  --step <步骤编号> \
  --asset-type <资产类型> \
  --file-path <文件路径> \
  --metadata <JSON元数据>
```

### 参数说明

- `--project-name`: 项目名称（必填）- 如果项目不存在会自动创建
- `--step`: 管线步骤编号（可选）- 用于标识当前步骤
- `--asset-type`: 资产类型（必填）- 支持的值见上表
- `--file-path`: 文件路径（必填）- 产出物的绝对路径
- `--metadata`: 元数据 JSON 字符串（可选）- 包含 name, prompt, description 等

### 使用示例

#### 1. 同步剧本

```bash
node scripts/agent-sync.js \
  --project-name "我的短片" \
  --step 6 \
  --asset-type script \
  --file-path "/mnt/agents/output/task_123/script.txt" \
  --metadata '{"name":"第1集剧本","episode":1}'
```

#### 2. 同步角色图片

```bash
node scripts/agent-sync.js \
  --project-name "我的短片" \
  --step 8 \
  --asset-type character_image \
  --file-path "/mnt/agents/output/task_123/character.png" \
  --metadata '{
    "name": "主角",
    "prompt": "一个勇敢的年轻战士",
    "description": "主角角色设计"
  }'
```

#### 3. 同步场景图片

```bash
node scripts/agent-sync.js \
  --project-name "我的短片" \
  --step 10 \
  --asset-type scene_image \
  --file-path "/mnt/agents/output/task_123/scene.png" \
  --metadata '{
    "name": "室内场景",
    "prompt": "现代公寓内部",
    "description": "主角的家"
  }'
```

#### 4. 同步语音

```bash
node scripts/agent-sync.js \
  --project-name "我的短片" \
  --step 13 \
  --asset-type voice \
  --file-path "/mnt/agents/output/task_123/voice.mp3" \
  --metadata '{
    "name": "旁白_第1句",
    "prompt": "旁白内容",
    "description": "旁白声音"
  }'
```

#### 5. 同步预览视频

```bash
node scripts/agent-sync.js \
  --project-name "我的短片" \
  --step 14 \
  --asset-type video_preview \
  --file-path "/mnt/agents/output/task_123/preview.mp4" \
  --metadata '{
    "shotIndex": 5,
    "duration": 3.5,
    "prompt": "镜头描述"
  }'
```

#### 6. 同步终版视频

```bash
node scripts/agent-sync.js \
  --project-name "我的短片" \
  --step 17 \
  --asset-type video_final \
  --file-path "/mnt/agents/output/task_123/final.mp4" \
  --metadata '{
    "shotIndex": 5,
    "duration": 3.5,
    "prompt": "最终镜头"
  }'
```

## 工作流程

1. **项目查询/创建**: 脚本会先查询指定名称的项目，如果不存在则自动创建
2. **资产同步**: 根据资产类型调用相应的 API 端点
3. **路径处理**: 自动将绝对路径转换为相对路径（如果需要）
4. **返回结果**: 显示同步成功/失败信息

## 验证同步成功

同步成功后，脚本会返回以下信息：

```
✅ 找到现有项目: ID <项目ID>
✅ <资产类型>同步成功
✅ 同步完成！
📊 结果: {...}
```

如果同步失败，检查：
1. Toonflow 服务是否运行（localhost:8000）
2. API 路由是否正确
3. 文件路径是否存在
4. metadata JSON 格式是否正确

## 技术细节

### API 映射

| 资产类型 | 主要 API | 备用 API |
|---------|---------|----------|
| script | `/api/script/addScript` | - |
| character_image | `/api/v1/pipeline/ingest/images` | `/api/assets/addAssets` |
| scene_image | `/api/v1/pipeline/ingest/images` | `/api/assets/addAssets` |
| voice | `/api/assets/addAudioAssets` | - |
| video_preview | `/api/v1/pipeline/ingest/videos` | - |
| video_final | `/api/v1/pipeline/ingest/videos` | - |

### 文件路径处理

- 图片/视频：使用相对路径（相对于 `/mnt/agents/output/`）
- 语音：转换为 base64 编码
- 剧本：读取文件内容作为文本

### 错误处理

- API 调用失败时会尝试备用 API（如果可用）
- 文件不存在时会报错并退出
- 无效的 JSON metadata 会报错并退出

## 集成到 kais-movie-agent

详见 `~/.openclaw/workspace/skills/kais-movie-agent/SKILL.md` 中的"🔄 产出物同步到 Toonflow"章节。

## 测试

测试脚本是否正常工作：

```bash
# 测试帮助信息
node /home/kai/workspace/kais-aigc-platform/scripts/agent-sync.js --help

# 测试项目查询（使用现有项目）
node /home/kai/workspace/kais-aigc-platform/scripts/agent-sync.js \
  --project-name "Pipeline E2E Test" \
  --asset-type script \
  --file-path /tmp/test_script.txt \
  --metadata '{"name":"测试剧本"}'
```

## 维护

- 脚本位置：`/home/kai/workspace/kais-aigc-platform/scripts/agent-sync.js`
- 相关文档：`~/.openclaw/workspace/skills/kais-movie-agent/SKILL.md`
- 创建时间：2026-05-28
- 版本：1.0.0
