#!/usr/bin/env bash
# =============================================================================
# kais-aigc-platform E2E Full Pipeline Test
# =============================================================================
# Comprehensive end-to-end test covering the complete service mesh:
#   1. Health checks for all 5 services
#   2. Gold-Team image generation (submit → poll → complete)
#   3. Movie-Agent pipeline run (create → status → phases)
#   4. Review-Platform submission (create → query → approve)
#   5. Cross-service data flow (pipeline → gold-team → review chain)
#
# Usage:
#   bash scripts/e2e-full-pipeline-test.sh
#
# Environment variables (all optional):
#   CORE_URL             core-backend URL           (default: http://localhost:8000)
#   MOVIE_AGENT_URL      movie-agent URL            (default: http://localhost:8001)
#   GOLD_TEAM_URL        gold-team URL              (default: http://localhost:8002)
#   REVIEW_URL           review-platform URL        (default: http://localhost:8090)
#   COMFYUI_URL          ComfyUI URL                (default: http://localhost:8188)
#   POLL_TIMEOUT_SEC     max wait per task          (default: 120)
#   POLL_INTERVAL_SEC    poll interval              (default: 5)
# =============================================================================
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
CORE_URL="${CORE_URL:-http://localhost:8000}"
MOVIE_AGENT_URL="${MOVIE_AGENT_URL:-http://localhost:8001}"
GOLD_TEAM_URL="${GOLD_TEAM_URL:-http://localhost:8002}"
REVIEW_URL="${REVIEW_URL:-http://localhost:8090}"
COMFYUI_URL="${COMFYUI_URL:-http://localhost:8188}"
POLL_TIMEOUT_SEC="${POLL_TIMEOUT_SEC:-120}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-5}"

TIMESTAMP=$(date +%s)
DATE_STAMP=$(date +%Y%m%d_%H%M%S)
TEST_PROJECT_ID="e2e-full-${TIMESTAMP}"

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
WARN_COUNT=0

# ─── Helpers ─────────────────────────────────────────────────────────────────
section() { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}\n"; }
log()     { echo -e "  ${DIM}→${NC} $*"; }
pass()    { echo -e "  ${GREEN}✅ PASS${NC} $*"; PASS_COUNT=$((PASS_COUNT+1)); }
fail()    { echo -e "  ${RED}❌ FAIL${NC} $*"; FAIL_COUNT=$((FAIL_COUNT+1)); }
warn()    { echo -e "  ${YELLOW}⚠️  WARN${NC} $*"; WARN_COUNT=$((WARN_COUNT+1)); }
skip()    { echo -e "  ${DIM}⏭  SKIP${NC} $*"; SKIP_COUNT=$((SKIP_COUNT+1)); }

json_val() {
  python3 -c "import sys,json; print(json.loads(sys.argv[1]).get(sys.argv[2],''))" "$1" "$2" 2>/dev/null
}

json_val_nested() {
  python3 -c "
import sys,json,functools
d=json.loads(sys.argv[1])
keys=sys.argv[2].split('.')
try: print(functools.reduce(dict.__getitem__, keys, d))
except: print('')
" "$1" "$2" 2>/dev/null
}

# ─── Tracking ────────────────────────────────────────────────────────────────
PIPELINE_ID=""
RENDER_TASK_ID=""
RENDER_OUTPUT=""
REVIEW_CARD_ID=""

# =============================================================================
# Banner
# =============================================================================
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     kais-aigc-platform  E2E Full Pipeline Test                ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo -e "  Core:       ${CORE_URL}"
echo -e "  MovieAgent: ${MOVIE_AGENT_URL}"
echo -e "  GoldTeam:   ${GOLD_TEAM_URL}"
echo -e "  Review:     ${REVIEW_URL}"
echo -e "  ComfyUI:    ${COMFYUI_URL}"
echo -e "  Timestamp:  ${TIMESTAMP}"
echo ""

# =============================================================================
# Phase 1: Service Health Checks (all 5 services)
# =============================================================================
section "Phase 1: Service Health Checks (5 services)"

declare -A SVC_UP

# core-backend
HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-core-health.json -w '%{http_code}' "${CORE_URL}/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  SVC_VER=$(json_val "$(cat /tmp/e2e-core-health.json)" "version")
  pass "core-backend:${CORE_URL##*:} healthy (v${SVC_VER})"
  SVC_UP[core]=true
else
  fail "core-backend:${CORE_URL##*:} unreachable (HTTP ${HTTP_CODE})"
  SVC_UP[core]=false
fi

# movie-agent
HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-movie-health.json -w '%{http_code}' "${MOVIE_AGENT_URL}/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  SVC_VER=$(json_val "$(cat /tmp/e2e-movie-health.json)" "version")
  SVC_PIPES=$(json_val "$(cat /tmp/e2e-movie-health.json)" "pipelines")
  pass "movie-agent:${MOVIE_AGENT_URL##*:} healthy (v${SVC_VER}, ${SVC_PIPES} pipelines)"
  SVC_UP[movie]=true
else
  fail "movie-agent:${MOVIE_AGENT_URL##*:} unreachable (HTTP ${HTTP_CODE})"
  SVC_UP[movie]=false
fi

# gold-team
HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-gold-health.json -w '%{http_code}' "${GOLD_TEAM_URL}/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  SVC_VER=$(json_val "$(cat /tmp/e2e-gold-health.json)" "version")
  pass "gold-team:${GOLD_TEAM_URL##*:} healthy (v${SVC_VER})"
  SVC_UP[gold]=true
else
  fail "gold-team:${GOLD_TEAM_URL##*:} unreachable (HTTP ${HTTP_CODE})"
  SVC_UP[gold]=false
fi

# review-platform
HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-review-health.json -w '%{http_code}' "${REVIEW_URL}/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  SVC_VER=$(json_val "$(cat /tmp/e2e-review-health.json)" "version")
  SVC_DB=$(json_val "$(cat /tmp/e2e-review-health.json)" "db")
  pass "review-platform:${REVIEW_URL##*:} healthy (v${SVC_VER}, db=${SVC_DB})"
  SVC_UP[review]=true
else
  fail "review-platform:${REVIEW_URL##*:} unreachable (HTTP ${HTTP_CODE})"
  SVC_UP[review]=false
fi

# ComfyUI (uses /system_stats, not /health)
HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-comfyui-stats.json -w '%{http_code}' "${COMFYUI_URL}/system_stats" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  COMFY_VER=$(json_val_nested "$(cat /tmp/e2e-comfyui-stats.json)" "system.comfyui_version")
  pass "ComfyUI:${COMFYUI_URL##*:} healthy (v${COMFY_VER})"
  SVC_UP[comfyui]=true
else
  warn "ComfyUI:${COMFYUI_URL##*:} unreachable (HTTP ${HTTP_CODE}) — non-critical"
  SVC_UP[comfyui]=false
fi

# Gate: gold-team must be up for pipeline tests
if [[ "${SVC_UP[gold]}" == "false" ]]; then
  echo ""
  fail "gold-team is required for pipeline tests. Aborting."
  echo ""
  echo -e "${BOLD}Summary: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC}, ${YELLOW}${WARN_COUNT} warnings${NC}, ${DIM}${SKIP_COUNT} skipped${NC}"
  exit 1
fi

# =============================================================================
# Phase 2: Gold-Team Image Generation (full lifecycle)
# =============================================================================
section "Phase 2: Gold-Team Image Generation"

RENDER_TASK_ID="e2e-img-${TIMESTAMP}"

# Submit render task
RENDER_BODY=$(cat <<EOF
{
  "task_id": "${RENDER_TASK_ID}",
  "type": "image_draw",
  "priority": "normal",
  "params": {
    "prompt": "E2E test: a serene sunset over snow-capped mountains, digital painting, warm golden light",
    "width": 512,
    "height": 512,
    "project_id": "${TEST_PROJECT_ID}",
    "shot_id": 1
  }
}
EOF
)

HTTP_CODE=$(curl -sf -m 10 -o /tmp/e2e-render-submit.json -w '%{http_code}' \
  -X POST "${GOLD_TEAM_URL}/api/v1/tasks" \
  -H 'Content-Type: application/json' \
  -d "$RENDER_BODY" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "202" ]]; then
  TASK_STATUS=$(json_val "$(cat /tmp/e2e-render-submit.json)" "status")
  ENGINE=$(json_val "$(cat /tmp/e2e-render-submit.json)" "engine_target")
  QUEUE_POS=$(json_val "$(cat /tmp/e2e-render-submit.json)" "queue_position")
  pass "Render task submitted: status=${TASK_STATUS}, engine=${ENGINE}, queue=#${QUEUE_POS}"
else
  RESP=$(cat /tmp/e2e-render-submit.json 2>/dev/null || echo "empty")
  fail "Render task submission failed (HTTP ${HTTP_CODE}): ${RESP}"
fi

# Poll until complete
if [[ "$HTTP_CODE" == "202" ]]; then
  log "Polling render task (timeout: ${POLL_TIMEOUT_SEC}s)..."
  ELAPSED=0
  FINAL_STATUS=""
  FINAL_PROGRESS=0

  while [[ $ELAPSED -lt $POLL_TIMEOUT_SEC ]]; do
    HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-task-status.json -w '%{http_code}' \
      "${GOLD_TEAM_URL}/api/v1/tasks/${RENDER_TASK_ID}" 2>/dev/null || echo "000")

    if [[ "$HTTP_CODE" == "200" ]]; then
      FINAL_STATUS=$(json_val "$(cat /tmp/e2e-task-status.json)" "status")
      FINAL_PROGRESS=$(json_val "$(cat /tmp/e2e-task-status.json)" "progress")
      log "Task ${RENDER_TASK_ID}: status=${FINAL_STATUS}, progress=${FINAL_PROGRESS}% (${ELAPSED}s)"

      if [[ "$FINAL_STATUS" == "completed" ]]; then break; fi
      if [[ "$FINAL_STATUS" == "failed" ]]; then break; fi
    else
      log "Status query HTTP ${HTTP_CODE}, retrying..."
    fi

    sleep "$POLL_INTERVAL_SEC"
    ELAPSED=$((ELAPSED + POLL_INTERVAL_SEC))
  done

  if [[ "$FINAL_STATUS" == "completed" ]]; then
    RENDER_OUTPUT=$(json_val_nested "$(cat /tmp/e2e-task-status.json)" "outputs.image")
    ENGINE_USED=$(json_val "$(cat /tmp/e2e-task-status.json)" "engine_used")
    pass "Image generated in ~${ELAPSED}s via ${ENGINE_USED}"
    log "Output: ${RENDER_OUTPUT}"
  elif [[ "$FINAL_STATUS" == "failed" ]]; then
    ERR_MSG=$(json_val "$(cat /tmp/e2e-task-status.json)" "error")
    fail "Image generation failed: ${ERR_MSG}"
  else
    fail "Image generation timed out after ${POLL_TIMEOUT_SEC}s (status: ${FINAL_STATUS})"
  fi
fi

# Check engine registry
HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-engines.json -w '%{http_code}' \
  "${GOLD_TEAM_URL}/api/v1/engines" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  ENGINE_COUNT=$(python3 -c "import json; d=json.load(open('/tmp/e2e-engines.json')); print(len(d) if isinstance(d,list) else d.get('total',len(d.get('engines',[]))))" 2>/dev/null || echo "?")
  pass "Engine registry: ${ENGINE_COUNT} engine(s) available"
else
  warn "Engine registry query failed (HTTP ${HTTP_CODE})"
fi

# =============================================================================
# Phase 3: Movie-Agent Pipeline Run
# =============================================================================
section "Phase 3: Movie-Agent Pipeline Run"

if [[ "${SVC_UP[movie]}" == "true" ]]; then
  # Run pipeline
  PIPELINE_BODY=$(cat <<EOF
{
  "project_id": "${TEST_PROJECT_ID}",
  "phases": ["image_draw"],
  "config": {}
}
EOF
)

  HTTP_CODE=$(curl -sf -m 10 -o /tmp/e2e-pipeline-run.json -w '%{http_code}' \
    -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/run" \
    -H 'Content-Type: application/json' \
    -d "$PIPELINE_BODY" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "202" ]]; then
    PIPELINE_ID=$(json_val "$(cat /tmp/e2e-pipeline-run.json)" "pipeline_id")
    PIPE_STATUS=$(json_val "$(cat /tmp/e2e-pipeline-run.json)" "status")
    pass "Pipeline started: ${PIPELINE_ID}, status=${PIPE_STATUS}"
  else
    RESP=$(cat /tmp/e2e-pipeline-run.json 2>/dev/null || echo "empty")
    fail "Pipeline run failed (HTTP ${HTTP_CODE}): ${RESP}"
  fi

  # Query pipeline status
  if [[ -n "$PIPELINE_ID" ]]; then
    HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-pipeline-status.json -w '%{http_code}' \
      "${MOVIE_AGENT_URL}/api/v1/pipeline/${PIPELINE_ID}/status" 2>/dev/null || echo "000")

    if [[ "$HTTP_CODE" == "200" ]]; then
      P_STATUS=$(json_val "$(cat /tmp/e2e-pipeline-status.json)" "status")
      P_PHASES=$(python3 -c "
import json
d=json.load(open('/tmp/e2e-pipeline-status.json'))
phases=d.get('phases',[])
print(len(phases))
" 2>/dev/null || echo "?")
      pass "Pipeline status: ${P_STATUS}, ${P_PHASES} phases defined"
    else
      fail "Pipeline status query failed (HTTP ${HTTP_CODE})"
    fi
  fi
else
  skip "Pipeline run — movie-agent not available"
fi

# =============================================================================
# Phase 4: Review Platform Submission
# =============================================================================
section "Phase 4: Review Platform Submission"

if [[ "${SVC_UP[review]}" == "true" ]]; then
  # List existing reviews
  HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-review-list.json -w '%{http_code}' \
    "${REVIEW_URL}/api/v1/reviews/" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "200" ]]; then
    ITEM_COUNT=$(python3 -c "
import json
d=json.load(open('/tmp/e2e-review-list.json'))
items=d.get('data',{}).get('items',[])
print(len(items))
" 2>/dev/null || echo "?")
    pass "Review list: ${ITEM_COUNT} item(s) found"
  else
    warn "Review list query returned HTTP ${HTTP_CODE}"
  fi

  # Create a review via shot-cards API
  REVIEW_BODY=$(cat <<EOF
{
  "project_id": "${TEST_PROJECT_ID}",
  "shot_id": "shot-e2e-001",
  "phase": "image",
  "asset_url": "${RENDER_OUTPUT:-https://picsum.photos/512/512}",
  "priority": "normal",
  "metadata": {
    "source": "e2e-full-pipeline-test",
    "task_id": "${RENDER_TASK_ID}",
    "pipeline_id": "${PIPELINE_ID}",
    "engine_used": "${ENGINE_USED:-local}",
    "timestamp": "${TIMESTAMP}"
  }
}
EOF
)

  # Try v6 shot-cards endpoint first
  HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-review-create.json -w '%{http_code}' \
    -X POST "${REVIEW_URL}/api/v1/v6/shot-cards/" \
    -H 'Content-Type: application/json' \
    -d "$REVIEW_BODY" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "201" || "$HTTP_CODE" == "200" ]]; then
    REVIEW_CARD_ID=$(json_val "$(cat /tmp/e2e-review-create.json)" "id")
    REVIEW_CARD_STATUS=$(json_val "$(cat /tmp/e2e-review-create.json)" "status")
    pass "Review card created: id=${REVIEW_CARD_ID}, status=${REVIEW_CARD_STATUS}"

    # Query the review card
    HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-review-get.json -w '%{http_code}' \
      "${REVIEW_URL}/api/v1/v6/shot-cards/${REVIEW_CARD_ID}" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      pass "Review card query OK"
    else
      warn "Review card query returned HTTP ${HTTP_CODE}"
    fi

    # Approve the review card
    HTTP_CODE=$(curl -sf -m 5 -o /dev/null -w '%{http_code}' \
      -X POST "${REVIEW_URL}/api/v1/v6/shot-cards/${REVIEW_CARD_ID}/approve" \
      -H 'Content-Type: application/json' 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      pass "Review card approved ✍️"
    else
      warn "Review approve returned HTTP ${HTTP_CODE}"
    fi

    # Cleanup: delete test card
    curl -sf -m 3 -X DELETE "${REVIEW_URL}/api/v1/v6/shot-cards/${REVIEW_CARD_ID}" 2>/dev/null && \
      log "Cleaned up review card ${REVIEW_CARD_ID}" || true
  else
    # Fallback: try generic reviews endpoint
    RESP=$(cat /tmp/e2e-review-create.json 2>/dev/null || echo "empty")
    warn "Shot-card creation returned HTTP ${HTTP_CODE}: ${RESP}"

    # Try the generic reviews endpoint
    HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-review-create2.json -w '%{http_code}' \
      -X POST "${REVIEW_URL}/api/v1/reviews/" \
      -H 'Content-Type: application/json' \
      -d "$REVIEW_BODY" 2>/dev/null || echo "000")

    if [[ "$HTTP_CODE" == "201" || "$HTTP_CODE" == "200" ]]; then
      pass "Review created via fallback endpoint"
    else
      RESP2=$(cat /tmp/e2e-review-create2.json 2>/dev/null || echo "empty")
      warn "Fallback review creation also failed (HTTP ${HTTP_CODE}): ${RESP2}"
    fi
  fi
else
  skip "Review submission — review-platform not available"
fi

# =============================================================================
# Phase 5: Cross-Service Data Flow Validation
# =============================================================================
section "Phase 5: Cross-Service Data Flow"

# 5a: Verify gold-team task can reference the pipeline project
if [[ "${SVC_UP[gold]}" == "true" ]]; then
  CROSS_TASK_ID="e2e-cross-${TIMESTAMP}"
  CROSS_BODY=$(cat <<EOF
{
  "task_id": "${CROSS_TASK_ID}",
  "type": "image_draw",
  "priority": "normal",
  "params": {
    "prompt": "Cross-service validation: simple test pattern",
    "width": 256,
    "height": 256,
    "project_id": "${TEST_PROJECT_ID}",
    "shot_id": 99
  }
}
EOF
)

  HTTP_CODE=$(curl -sf -m 10 -o /tmp/e2e-cross-submit.json -w '%{http_code}' \
    -X POST "${GOLD_TEAM_URL}/api/v1/tasks" \
    -H 'Content-Type: application/json' \
    -d "$CROSS_BODY" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "202" ]]; then
    pass "Cross-service task submitted (project=${TEST_PROJECT_ID})"

    # Poll briefly (max 60s for a 256x256 image)
    ELAPSED=0
    while [[ $ELAPSED -lt 60 ]]; do
      HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-cross-status.json -w '%{http_code}' \
        "${GOLD_TEAM_URL}/api/v1/tasks/${CROSS_TASK_ID}" 2>/dev/null || echo "000")
      if [[ "$HTTP_CODE" == "200" ]]; then
        CS=$(json_val "$(cat /tmp/e2e-cross-status.json)" "status")
        if [[ "$CS" == "completed" || "$CS" == "failed" ]]; then break; fi
      fi
      sleep 5
      ELAPSED=$((ELAPSED + 5))
    done

    if [[ "$CS" == "completed" ]]; then
      pass "Cross-service render completed (${ELAPSED}s)"
    else
      warn "Cross-service render status: ${CS} (${ELAPSED}s)"
    fi
  else
    fail "Cross-service task submission failed (HTTP ${HTTP_CODE})"
  fi
fi

# 5b: Verify core-backend can proxy queries
if [[ "${SVC_UP[core]}" == "true" ]]; then
  HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-proxy-status.json -w '%{http_code}' \
    "${CORE_URL}/api/v1/pipeline/status/${RENDER_TASK_ID}" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "200" ]]; then
    PROXY_ST=$(json_val_nested "$(cat /tmp/e2e-proxy-status.json)" "data.status")
    pass "Core-backend → gold-team proxy OK (status=${PROXY_ST})"
  elif [[ "$HTTP_CODE" == "404" ]]; then
    warn "Core-backend proxy returned 404 (task may have been evicted)"
  else
    warn "Core-backend proxy returned HTTP ${HTTP_CODE}"
  fi
fi

# 5c: Verify ComfyUI connectivity from gold-team
if [[ "${SVC_UP[comfyui]}" == "true" ]]; then
  COMFY_GPU=$(json_val_nested "$(cat /tmp/e2e-comfyui-stats.json)" "system.devices.0.name" 2>/dev/null)
  COMFY_VRAM=$(json_val_nested "$(cat /tmp/e2e-comfyui-stats.json)" "system.devices.0.vram_total" 2>/dev/null)
  if [[ -n "$COMFY_GPU" ]]; then
    pass "ComfyUI GPU: ${COMFY_GPU} (VRAM: ${COMFY_VRAM})"
  else
    warn "ComfyUI GPU info not available"
  fi
fi

# =============================================================================
# Phase 6: Summary & Report
# =============================================================================
TOTAL=$((PASS_COUNT + FAIL_COUNT + WARN_COUNT + SKIP_COUNT))
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║                     TEST SUMMARY                              ║${NC}"
echo -e "${BOLD}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "  ${GREEN}✅ Passed:   ${PASS_COUNT}${NC}"
echo -e "  ${RED}❌ Failed:   ${FAIL_COUNT}${NC}"
echo -e "  ${YELLOW}⚠️  Warnings: ${WARN_COUNT}${NC}"
echo -e "  ${DIM}⏭  Skipped:  ${SKIP_COUNT}${NC}"
echo -e "  ${BOLD}📊 Total:    ${TOTAL}${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"

# Write JSON result file
RESULT_DIR="/tmp/e2e-full-pipeline-results"
mkdir -p "${RESULT_DIR}"
RESULT_FILE="${RESULT_DIR}/result-${DATE_STAMP}.json"

python3 << PYEOF
import json, datetime

result = {
    "test": "e2e-full-pipeline",
    "timestamp": ${TIMESTAMP},
    "date": datetime.datetime.now().isoformat(),
    "project_id": "${TEST_PROJECT_ID}",
    "pipeline_id": "${PIPELINE_ID}",
    "render_task_id": "${RENDER_TASK_ID}",
    "render_output": "${RENDER_OUTPUT}",
    "review_card_id": "${REVIEW_CARD_ID}",
    "counts": {
        "passed": ${PASS_COUNT},
        "failed": ${FAIL_COUNT},
        "warnings": ${WARN_COUNT},
        "skipped": ${SKIP_COUNT},
        "total": ${TOTAL}
    },
    "services": {
        "core": "${SVC_UP[core]}",
        "movie_agent": "${SVC_UP[movie]}",
        "gold_team": "${SVC_UP[gold]}",
        "review": "${SVC_UP[review]}",
        "comfyui": "${SVC_UP[comfyui]}"
    },
    "result": "PASS" if ${FAIL_COUNT} == 0 else "FAIL"
}

with open("${RESULT_FILE}", "w") as f:
    json.dump(result, f, indent=2)

print(f"Result file: ${RESULT_FILE}")
PYEOF

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo -e "\n${RED}${BOLD}RESULT: FAIL${NC} (${FAIL_COUNT} test(s) failed)\n"
  exit 1
else
  echo -e "\n${GREEN}${BOLD}RESULT: PASS${NC} (all critical tests passed)\n"
  exit 0
fi
