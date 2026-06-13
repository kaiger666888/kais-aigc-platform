# =============================================================================
# Hermes Agent — Minimal Python 3.11 FastAPI container
# =============================================================================
# CPU-only service. No GPU needed.
# Provides domain-agnostic intelligent decision engine on :8080.
# Uses local fork of NousResearch/hermes-agent via build context.
#
# Build context must include:
#   - docker/hermes-agent/src/       (platform wrapper)
#   - docker/hermes-agent/scripts/   (registration scripts)
#   - docker/hermes-agent/requirements.txt
#   - _hermes_source/                (symlink or copy of hermes-agent fork)
# =============================================================================

FROM python:3.11-slim

WORKDIR /app

# Use TUNA mirror for apt (consistent with gold-team Dockerfile pattern)
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list 2>/dev/null || true

# Install hermes-agent from local fork
# _hermes_source is created by build script (rsync from symlink target)
COPY _hermes_source/ /tmp/hermes-agent/
RUN pip install --no-cache-dir /tmp/hermes-agent/ -i https://pypi.tuna.tsinghua.edu.cn/simple && \
    rm -rf /tmp/hermes-agent

# Install platform wrapper dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# Copy local platform wrapper (src/, scripts/)
COPY src/ ./src/
COPY scripts/ ./scripts/

ENV PORT=8080
EXPOSE 8080

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080"]
