FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl git ffmpeg libsndfile1 gcc g++ && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# Install PyTorch with CUDA support
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu124 -i https://pypi.tuna.tsinghua.edu.cn/simple || \
    pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu121

# Install CosyVoice dependencies
RUN pip install --no-cache-dir \
    conformer==0.3.2 \
    diffusers \
    hydra-core==1.3.2 \
    HyperPyYAML==1.2.3 \
    "librosa==0.10.2" \
    modelscope \
    omegaconf==2.3.0 \
    soundfile \
    "transformers==4.51.3" \
    onnxruntime-gpu \
    openai-whisper \
    inflect \
    wget \
    pyarrow \
    wetext \
    pyworld \
    matcha-tts \
    torchcodec \
    -i https://pypi.tuna.tsinghua.edu.cn/simple

# Patch librosa numba caching issue
RUN find /usr/local/lib/python3.11/site-packages/librosa -name "*.py" -exec \
    sed -i 's/@jit(nopython=True, cache=True)/@jit(nopython=True, cache=False)/g; s/@jit(cache=True)/@jit(cache=False)/g; s/cache=True, /cache=False, /g' {} +

# Clone CosyVoice repo (model downloaded separately via volume or init script)
RUN git clone --depth 1 https://github.com/FunAudioLLM/CosyVoice.git /opt/CosyVoice || \
    echo "CosyVoice clone failed - mount or download manually"

# Copy v6 module
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN groupadd -r kais && useradd -r -g kais kais && \
    chown -R kais:kais /app /opt/CosyVoice
USER kais

ENV PORT=8002
ENV COSYVOICE_ROOT=/opt/CosyVoice
ENV COSYVOICE_MODEL_DIR=/opt/CosyVoice/pretrained_models/iic/CosyVoice2-0.5B
ENV MPLCONFIGDIR=/tmp/matplotlib

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=15s \
  CMD curl -f http://localhost:8002/health || exit 1

CMD ["uvicorn", "src.v6.main:app", "--host", "0.0.0.0", "--port", "8002", "--workers", "1"]
