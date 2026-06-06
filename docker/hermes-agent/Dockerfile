# =============================================================================
# Hermes Agent — Minimal Python 3.11 FastAPI container
# =============================================================================
# CPU-only service. No GPU needed.
# Provides domain-agnostic intelligent decision engine on :8080.
# =============================================================================

FROM python:3.11-slim

WORKDIR /app

# Use TUNA mirror for apt (consistent with gold-team Dockerfile pattern)
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list 2>/dev/null || true

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

COPY src/ ./src/
COPY scripts/ ./scripts/

ENV PORT=8080
EXPOSE 8080

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080"]
