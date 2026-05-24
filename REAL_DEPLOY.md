# KAIS AIGC Platform — Real Deployment Guide

## 架构

```
┌─────────────┐  ┌──────────────┐  ┌─────────────┐
│ core-backend │  │ movie-agent  │  │ review-platf │
│  :8000       │  │ :8001        │  │ :8091        │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                  │
       │          ┌──────▼───────┐          │
       │          │  gold-team   │          │
       │          │  :8002 (GPU) │          │
       │          └──────┬───────┘          │
       │                 │                  │
  ┌────▼─────────────────▼──────────────────▼──┐
  │            Redis :6379 / PG :5432           │
  └────────────────────────────────────────────┘
       共享卷: /mnt/agents/output
```

## 前置条件

1. **NVIDIA Docker Runtime** 已安装：
   ```bash
   docker info | grep -i nvidia
   # 应该显示 nvidia runtime
   ```

2. **创建产物目录**：
   ```bash
   sudo mkdir -p /mnt/agents/output
   sudo chmod 777 /mnt/agents/output
   ```

3. **确保 gold-team 源码在正确位置**：
   ```bash
   ls ~/.openclaw/workspace/kais-gold-team/requirements-v6.txt
   ls ~/.openclaw/workspace/kais-gold-team/src/v6/main.py
   ```

4. **预构建其他服务镜像**（如果还没有）：
   ```bash
   # 从 smoke compose 先构建基础镜像
   docker compose -f docker-compose.smoke.yml build core-backend movie-agent review-platform
   ```

## 启动

```bash
cd ~/.openclaw/workspace/kais-aigc-platform

# 构建并启动（gold-team 会从源码构建）
docker compose -f docker-compose.real.yml up -d --build

# 仅构建 gold-team（调试用）
docker compose -f docker-compose.real.yml build gold-team
```

### 自定义配置

```bash
# 指定 gold-team 源码路径（默认 ../kais-gold-team）
GOLD_TEAM_PATH=/path/to/kais-gold-team docker compose -f docker-compose.real.yml up -d --build

# 连接外部 ComfyUI 实例（而非容器）
COMFYUI_HOST=192.168.71.166 COMFYUI_PORT=8188 docker compose -f docker-compose.real.yml up -d

# 禁用 ComfyUI（只用 mock engine）
COMFYUI_ENABLED=false docker compose -f docker-compose.real.yml up -d
```

## 验证步骤

```bash
# 1. 检查所有服务状态
docker compose -f docker-compose.real.yml ps

# 2. 验证 gold-team 健康（应显示注册的引擎列表）
curl http://localhost:8002/health

# 3. 验证 movie-agent → gold-team 连通
curl http://localhost:8001/health

# 4. 验证 GPU 可用（在 gold-team 容器内）
docker compose -f docker-compose.real.yml exec gold-team \
  python3 -c "import torch; print(f'CUDA: {torch.cuda.is_available()}, Device: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"N/A\"}')"

# 5. 测试任务提交
curl -X POST http://localhost:8002/v6/tasks \
  -H "Content-Type: application/json" \
  -d '{"engine": "mock", "action": "generate", "params": {"prompt": "test"}}'

# 6. 检查产物目录
ls -la /mnt/agents/output/
```

## 与 Smoke Test 的关系

| | Smoke | Real |
|---|---|---|
| Compose 文件 | `docker-compose.smoke.yml` | `docker-compose.real.yml` |
| gold-team | 预构建镜像/mock | 从源码构建/真实引擎 |
| GPU | 不需要 | NVIDIA runtime |
| ComfyUI | 不连接 | 可连接 |
| 用途 | CI/快速验证 | 生产/开发 |

两者互不影响，可以交替使用（端口相同，不能同时运行）。

## 排错

- **gold-team 启动失败**：`docker compose -f docker-compose.real.yml logs gold-team`
- **GPU 不可用**：确认 `nvidia-container-toolkit` 已安装，`docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi`
- **构建慢**：requirements-v6.txt 依赖少（6 个包），构建应该很快
- **ComfyUI 连接失败**：设 `COMFYUI_ENABLED=false` 先跳过，确认 gold-team 本身正常后再连接

## 停止

```bash
docker compose -f docker-compose.real.yml down
# 保留数据
docker compose -f docker-compose.real.yml down --volumes  # 清除数据
```
