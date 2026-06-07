#!/bin/bash
# ACE-Step API Quick Test Script
# Usage: bash scripts/test-ace-api.sh [BASE_URL]
# Default BASE_URL: http://localhost:8000

set -euo pipefail
BASE_URL="${1:-http://localhost:8000}"

echo "========================================="
echo "  ACE-Step API Quick Test"
echo "  Target: $BASE_URL/api/v1/ace"
echo "========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ PASS${NC} $1"; }
fail() { echo -e "${RED}✗ FAIL${NC} $1"; }
info() { echo -e "${CYAN}  →${NC} $1"; }

# Test 1: Health check
echo -e "${YELLOW}[1/4] GET /api/v1/ace/models${NC}"
if HTTP_CODE=$(curl -sf -o /tmp/ace_models.json -w "%{http_code}" "$BASE_URL/api/v1/ace/models"); then
  if [ "$HTTP_CODE" = "200" ]; then
    MODEL_COUNT=$(python3 -c "import json; d=json.load(open('/tmp/ace_models.json')); print(len(d.get('data',{}).get('models',d.get('data',[]))))" 2>/dev/null || echo "?")
    pass "HTTP 200, models: $MODEL_COUNT"
    info "$(cat /tmp/ace_models.json | python3 -m json.tool 2>/dev/null | head -20)"
  else
    fail "HTTP $HTTP_CODE"
  fi
else
  fail "Connection failed (is core-backend running?)"
fi
echo ""

# Test 2: Generate music (minimal prompt)
echo -e "${YELLOW}[2/4] POST /api/v1/ace/generate (text2music)${NC}"
GENERATE_BODY='{"prompt":"cinematic dark tension orchestral, 120 bpm","task_type":"text2music","audio_format":"mp3"}'
if HTTP_CODE=$(curl -sf -o /tmp/ace_generate.json -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  -d "$GENERATE_BODY" \
  "$BASE_URL/api/v1/ace/generate"); then
  if [ "$HTTP_CODE" = "202" ]; then
    TASK_ID=$(python3 -c "import json; d=json.load(open('/tmp/ace_generate.json')); print(d.get('data',{}).get('task_id','?'))" 2>/dev/null || echo "?")
    pass "HTTP 202, task_id=$TASK_ID"
    info "$(cat /tmp/ace_generate.json | python3 -m json.tool 2>/dev/null)"
  else
    fail "HTTP $HTTP_CODE"
    info "$(cat /tmp/ace_generate.json)"
  fi
else
  fail "Connection failed"
fi
echo ""

# Test 3: Generate with full params (cover mode)
echo -e "${YELLOW}[3/4] POST /api/v1/ace/generate (full params)${NC}"
FULL_BODY='{
  "task_type": "text2music",
  "prompt": "upbeat electronic dance with synth melody",
  "bpm": 128,
  "key_scale": "C major",
  "time_signature": "4/4",
  "inference_steps": 8,
  "guidance_scale": 7.0,
  "audio_duration": 30,
  "audio_format": "wav",
  "thinking": true,
  "lm_temperature": 0.85,
  "shift": 3.0,
  "priority": "normal"
}'
if HTTP_CODE=$(curl -sf -o /tmp/ace_full.json -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  -d "$FULL_BODY" \
  "$BASE_URL/api/v1/ace/generate"); then
  if [ "$HTTP_CODE" = "202" ]; then
    FULL_TASK_ID=$(python3 -c "import json; d=json.load(open('/tmp/ace_full.json')); print(d.get('data',{}).get('task_id','?'))" 2>/dev/null || echo "?")
    pass "HTTP 202, task_id=$FULL_TASK_ID (full params accepted)"
    info "$(cat /tmp/ace_full.json | python3 -m json.tool 2>/dev/null)"
  else
    fail "HTTP $HTTP_CODE"
    info "$(cat /tmp/ace_full.json)"
  fi
else
  fail "Connection failed"
fi
echo ""

# Test 4: Validation — missing required fields
echo -e "${YELLOW}[4/4] POST /api/v1/ace/generate (validation)${NC}"
if HTTP_CODE=$(curl -sf -o /tmp/ace_val.json -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  -d '{"task_type":"cover"}' \
  "$BASE_URL/api/v1/ace/generate"); then
  if [ "$HTTP_CODE" = "400" ]; then
    pass "HTTP 400 — correctly rejected missing reference_audio_path"
  else
    fail "Expected 400, got HTTP $HTTP_CODE"
  fi
else
  fail "Connection failed"
fi
echo ""

echo "========================================="
echo "  Test complete. Files in /tmp/ace_*.json"
echo "========================================="
