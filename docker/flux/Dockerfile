FROM pytorch/pytorch:2.10.0-cuda12.8-cudnn9-devel

RUN pip install --no-cache-dir \
    diffusers==0.37.1 \
    transformers>=4.49.0 \
    accelerate \
    sentencepiece \
    fastapi \
    uvicorn \
    Pillow

ENV FLUX_MODEL_BASE=/data/models
ENV FLUX_API_PORT=8080
ENV OMP_NUM_THREADS=4

WORKDIR /app
COPY flux_api.py /app/flux_api.py

EXPOSE 8080

CMD ["python3", "flux_api.py"]
