#!/usr/bin/env bash
# Bootstrap script for the BGM detector Python venv.
# Run once per machine. Idempotent — skips install if venv already exists.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VENV_DIR="${REPO_ROOT}/.venvs/bgm-detector"

if [[ -x "${VENV_DIR}/bin/python3" ]]; then
  echo "[bgm-detector] venv already exists at ${VENV_DIR}"
  if "${VENV_DIR}/bin/python3" -c "import inaSpeechSegmenter" 2>/dev/null; then
    echo "[bgm-detector] inaSpeechSegmenter already installed"
    exit 0
  fi
fi

echo "[bgm-detector] creating venv at ${VENV_DIR}"
python3 -m venv "${VENV_DIR}"
source "${VENV_DIR}/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet inaSpeechSegmenter soundfile scipy numpy

# Pre-download CNN model (skips gender model — not needed for BGM detection)
echo "[bgm-detector] downloading CNN model..."
MODEL_DIR="${HOME}/.keras/inaSpeechSegmenter"
mkdir -p "${MODEL_DIR}"
MODEL_FILE="${MODEL_DIR}/keras_speech_music_noise_cnn.hdf5"

if [[ ! -s "${MODEL_FILE}" ]] || [[ $(stat -c%s "${MODEL_FILE}") -lt 1000000 ]]; then
  if [[ -n "${https_proxy:-}${http_proxy:-}" ]]; then
    echo "[bgm-detector] downloading via proxy ($https_proxy)"
    curl -fsSL -o "${MODEL_FILE}" \
      "https://github.com/ina-foss/inaSpeechSegmenter/releases/download/models/keras_speech_music_noise_cnn.hdf5"
  else
    # Let the first invocation trigger the download from inside Python
    echo "[bgm-detector] no proxy set; model will download on first use"
  fi
fi

echo "[bgm-detector] smoke test..."
"${VENV_DIR}/bin/python3" -c "
import os; os.environ['TF_CPP_MIN_LOG_LEVEL']='3'
from inaSpeechSegmenter import Segmenter
s = Segmenter(detect_gender=False, batch_size=1)
print('OK')
"

echo "[bgm-detector] done. venv at ${VENV_DIR}"
