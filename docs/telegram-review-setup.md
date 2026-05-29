# Telegram Inline Buttons 审核交互 — 配置指南

## 概述

当 Pipeline 产出物提交审核后，系统自动在 Telegram 发送带 inline buttons 的审核卡片。用户点击按钮即可 approve/reject/revise，无需离开 Telegram。

## 架构

```
submit-to-review → sendReviewCard() → Telegram Bot API
                                              ↓
User clicks button ← callback_query ← Telegram
                                              ↓
/webhook → handleReviewCallback() → POST /callback/review-result → DB update
                                              ↓
                              editMessageText() 更新卡片状态
```

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from @BotFather |
| `TELEGRAM_REVIEW_CHAT_ID` | ✅ | 接收审核卡片的 chat/topic ID |
| `CALLBACK_BASE_URL` | ❌ | 本服务的外网地址 (default: `http://localhost:3000`) |

## 设置步骤

### 1. 创建 Telegram Bot

```bash
# 在 Telegram 中找 @BotFather
/newbot
# 按提示设置名称，获取 token
```

### 2. 配置环境变量

在 `.env` 或部署配置中添加：

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_REVIEW_CHAT_ID=-100XXXXXXXXXX
CALLBACK_BASE_URL=https://your-domain.com
```

获取 Chat ID:
- 如果是群组/话题：转发一条群消息给 @userinfobot，它会返回 chat_id
- 如果是私聊：直接给 bot 发消息，然后访问 `https://api.telegram.org/bot<TOKEN>/getUpdates`

### 3. 设置 Webhook

服务启动后，注册 Telegram webhook：

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-domain.com/api/v1/telegram/webhook"}'
```

验证：

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

### 4. 重启服务

```bash
cd /home/kai/workspace/kais-aigc-platform
# 根据部署方式重启
```

## 测试

### 手动发送审核卡片

```bash
curl -X POST http://localhost:3000/api/v1/pipeline/submit-to-review \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "test-project",
    "shotId": "shot-001",
    "phase": "image",
    "assetUrl": "https://example.com/test.png",
    "pipelineId": "pipeline-test-001"
  }'
```

如果 `TELEGRAM_REVIEW_CHAT_ID` 已配置，你应该在 Telegram 收到审核卡片。

### 模拟 Callback

```bash
curl -X POST http://localhost:3000/api/v1/telegram/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "callback_query": {
      "id": "test-callback-id",
      "data": "review:approve:pipeline-test-001:image:review-123",
      "message": {
        "chat": {"id": -100XXXXXXXXXX},
        "message_id": 42
      }
    }
  }'
```

## Callback Data 格式

```
review:{action}:{pipelineId}:{phase}:{reviewId}
```

- `action`: `approve` | `reject` | `revise`
- `pipelineId`: Pipeline run ID
- `phase`: 当前审核阶段
- `reviewId`: Review card ID

**注意**: Telegram callback_data 限制 64 字节。如果 pipelineId 很长，可能需要缩短。

## 文件清单

| 文件 | 说明 |
|---|---|
| `src/lib/telegram-review.ts` | 发送审核卡片 + 处理回调 |
| `src/routes/v1/telegram/webhook.ts` | Webhook 入口 |
| `src/routes/v1/pipeline/submit-to-review.ts` | 提交审核时发送 Telegram 通知 |
| `src/router.ts` | 路由注册 |
| `docs/telegram-review-setup.md` | 本文档 |
