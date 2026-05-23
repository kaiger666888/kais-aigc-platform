# =============================================================================
# kais-gold-team (统一执行 Agent)
# =============================================================================
# Python FastAPI 服务
# 负责: 调用 ComfyUI / 云端引擎执行生成任务
# 需要 NVIDIA GPU (RTX 3090)
# =============================================================================
FROM python:3.11-slim

WORKDIR /app

# 系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        libgl1-mesa-glx \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖（先复制 requirements 利用层缓存）
COPY requirements-gold-team.txt ./requirements.txt

RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 复制源码
COPY src/ ./src/

RUN groupadd -r kais && useradd -r -g kais kais && \
    chown -R kais:kais /app
USER kais

ENV PORT=8002

EXPOSE 8002

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
