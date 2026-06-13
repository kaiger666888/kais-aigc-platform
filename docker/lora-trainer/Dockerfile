FROM comfyui-worker:pytorch251-v6-gcc

# Clear proxy env
ENV http_proxy=""
ENV https_proxy=""
ENV HTTP_PROXY=""
ENV HTTPS_PROXY=""

# Configure pip
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple \
    && pip config set global.trusted-host pypi.tuna.tsinghua.edu.cn

# Install deps
RUN pip install --no-cache-dir \
    "transformers==4.49.0" \
    "diffusers==0.38.0" \
    "accelerate>=1.0" \
    "bitsandbytes>=0.44" \
    "peft>=0.13" \
    "omegaconf" \
    "voluptuous" \
    "imagesize" \
    "toml" \
    "fastapi" \
    "uvicorn[standard]" \
    "pydantic" \
    "aiofiles" \
    "psutil"

# Copy local sd-scripts source
COPY sd-scripts/ /opt/sd-scripts/
RUN cd /opt/sd-scripts && pip install -e . --no-deps

# Pre-cache HuggingFace tokenizers (CLIP-L + T5)
RUN python3 -c "\
import os; \
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'; \
from transformers import CLIPTokenizer, T5TokenizerFast; \
CLIPTokenizer.from_pretrained('openai/clip-vit-large-patch14'); \
print('CLIP cached'); \
T5TokenizerFast.from_pretrained('google/t5-v1_1-xxl'); \
print('T5 cached')"

WORKDIR /app
COPY lora_trainer_api.py /app/lora_trainer_api.py

ENV HF_ENDPOINT=https://hf-mirror.com
ENV HF_HUB_OFFLINE=1
ENV TRANSFORMERS_OFFLINE=1
ENV PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

EXPOSE 8070
CMD ["python3", "/app/lora_trainer_api.py", "--port", "8070"]
