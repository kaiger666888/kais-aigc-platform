# =============================================================================
# kais-review-platform (审核平台)
# =============================================================================
# Python FastAPI + HTMX/Alpine Web 界面
# 负责: 人工审核、治理审批 API、Audit DB 查询
# 不需要 GPU，只读访问产物目录
# =============================================================================
FROM python:3.11-slim

WORKDIR /app

# 系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖
COPY requirements-review.txt ./requirements.txt

RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 复制源码
COPY src/ ./src/
COPY static/ ./static/
COPY templates/ ./templates/

RUN groupadd -r kais && useradd -r -g kais kais && \
    chown -R kais:kais /app
USER kais

ENV PORT=8090

EXPOSE 8090

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "2"]
