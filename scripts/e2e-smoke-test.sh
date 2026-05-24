#!/usr/bin/env bash
# =============================================================================
# kais-aigc-platform E2E Smoke Test
# =============================================================================
# Validates the full pipeline: health check → create project → create storyboard
# → submit render → poll status → submit to review → cleanup
#
# Usage:
#   bash scripts/e2e-smoke-test.sh
#
# Environment variables (all optional, sensible defaults):
#   CORE_URL             core-backend URL           (default: http://localhost:8000)
#   MOVIE_AGENT_URL      movie-agent URL            (default: http://localhost:8001)
#   GOLD_TEAM_URL        gold-team URL              (default: http://localhost:8002)
#   REVIEW_URL           review-platform URL        (default: http://localhost:8091)
#   POLL_TIMEOUT_SEC     max wait for task          (default: 60)
#   POLL_INTERVAL_SEC    poll interval              (default: 2)
# =============================================================================
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
CORE_URL="${CORE_URL:-http://localhost:8000}"
MOVIE_AGENT_URL="${MOVIE_AGENT_URL:-http://localhost:8001}"
GOLD_TEAM_URL="${GOLD_TEAM_URL:-http://localhost:8002}"
REVIEW_URL="${REVIEW_URL:-http://localhost:8091}"
POLL_TIMEOUT_SEC="${POLL_TIMEOUT_SEC:-60}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-2}"

TIMESTAMP=$(date +%s)
TEST_PROJECT_ID="e2e-${TIMESTAMP}"
TEST_TASK_ID="e2e-task-${TIMESTAMP}"
CLEANUP_REVIEW_IDS=()
CLEANUP_PIPELINE_ID=""

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
  # Extract a value from JSON: json_val '{"key":"val"}' key
  python3 -c "import sys,json; print(json.loads(sys.argv[1]).get(sys.argv[2],''))" "$1" "$2" 2>/dev/null
}

json_val_nested() {
  # Extract nested value: json_val_nested '{"a":{"b":"c"}}' a.b
  python3 -c "
import sys,json,functools
d=json.loads(sys.argv[1])
keys=sys.argv[2].split('.')
try: print(functools.reduce(dict.__getitem__, keys, d))
except: print('')
" "$1" "$2" 2>/dev/null
}

# ─── Cleanup ─────────────────────────────────────────────────────────────────
cleanup() {
  echo -e "\n${DIM}── Cleanup ──${NC}"
  # Clean review cards created during test
  for card_id in "${CLEANUP_REVIEW_IDS[@]}"; do
    curl -sf -m 3 -X DELETE "${REVIEW_URL}/api/v1/v6/shot-cards/${card_id}" 2>/dev/null && \
      log "Deleted review card ${card_id}" || true
  done
  # Clean test task from gold-team (cancel if still running)
  curl -sf -m 3 -X POST "${GOLD_TEAM_URL}/api/v1/tasks/${TEST_TASK_ID}/cancel" 2>/dev/null || true
  log "Cleanup done"
}
trap cleanup EXIT

# =============================================================================
# Banner
# =============================================================================
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║        kais-aigc-platform  E2E Smoke Test                     ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo -e "  Core:       ${CORE_URL}"
echo -e "  MovieAgent: ${MOVIE_AGENT_URL}"
echo -e "  GoldTeam:   ${GOLD_TEAM_URL}"
echo -e "  Review:     ${REVIEW_URL}"
echo -e "  Timestamp:  ${TIMESTAMP}"
echo ""

# =============================================================================
# Phase 1: Health Checks
# =============================================================================
section "Phase 1: Service Health Checks"

CORE_UP=false
MOVIE_UP=false
GOLD_UP=false
REVIEW_UP=false

# core-backend
HTTP_CODE=$(curl -sf -m 3 -o /tmp/e2e-health-core.json -w '%{http_code}' "${CORE_URL}/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "core-backend is healthy ($(cat /tmp/e2e-health-core.json))"
  CORE_UP=true
else
  fail "core-backend unreachable (HTTP ${HTTP_CODE})"
fi

# movie-agent
HTTP_CODE=$(curl -sf -m 3 -o /tmp/e2e-health-movie.json -w '%{http_code}' "${MOVIE_AGENT_URL}/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "movie-agent is healthy"
  MOVIE_UP=true
else
  warn "movie-agent unreachable (HTTP ${HTTP_CODE})"
fi

# gold-team
HTTP_CODE=$(curl -sf -m 3 -o /tmp/e2e-health-gold.json -w '%{http_code}' "${GOLD_TEAM_URL}/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "gold-team is healthy"
  GOLD_UP=true
else
  fail "gold-team unreachable (HTTP ${HTTP_CODE})"
fi

# review-platform
HTTP_CODE=$(curl -sf -m 3 -o /tmp/e2e-health-review.json -w '%{http_code}' "${REVIEW_URL}/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "review-platform is healthy"
  REVIEW_UP=true
else
  warn "review-platform unreachable (HTTP ${HTTP_CODE})"
fi

# Minimum requirement: gold-team must be up for pipeline tests
if [[ "$GOLD_UP" == "false" ]]; then
  echo ""
  fail "gold-team is required for pipeline tests. Aborting."
  echo -e "\n${BOLD}Summary: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC}, ${YELLOW}${WARN_COUNT} warnings${NC}, ${DIM}${SKIP_COUNT} skipped${NC}"
  exit 1
fi

# =============================================================================
# Phase 2: Create Pipeline via Movie-Agent
# =============================================================================
section "Phase 2: Create Pipeline (Movie-Agent)"

if [[ "$MOVIE_UP" == "true" ]]; then
  PIPELINE_BODY=$(cat <<EOF
{
  "project_id": "${TEST_PROJECT_ID}",
  "config": {
    "phases": ["image_draw"]
  },
  "metadata": {
    "source": "e2e-smoke-test",
    "timestamp": "${TIMESTAMP}"
  }
}
EOF
)
  HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-pipeline.json -w '%{http_code}' \
    -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/create" \
    -H 'Content-Type: application/json' \
    -d "$PIPELINE_BODY" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "201" ]]; then
    PIPELINE_ID=$(json_val "$(cat /tmp/e2e-pipeline.json)" "pipeline_id")
    CLEANUP_PIPELINE_ID="$PIPELINE_ID"
    pass "Pipeline created: ${PIPELINE_ID}"

    # Query pipeline status
    HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-pipeline-status.json -w '%{http_code}' \
      "${MOVIE_AGENT_URL}/api/v1/pipeline/${PIPELINE_ID}/status" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      P_STATUS=$(json_val "$(cat /tmp/e2e-pipeline-status.json)" "status")
      pass "Pipeline status: ${P_STATUS}"
    else
      warn "Could not query pipeline status (HTTP ${HTTP_CODE})"
    fi
  else
    fail "Pipeline creation failed (HTTP ${HTTP_CODE})"
    cat /tmp/e2e-pipeline.json 2>/dev/null | python3 -m json.tool 2>/dev/null || true
  fi
else
  skip "Pipeline creation — movie-agent not running"
fi

# =============================================================================
# Phase 3: Submit Render Task to Gold-Team
# =============================================================================
section "Phase 3: Submit Render Task (Gold-Team)"

RENDER_BODY=$(cat <<EOF
{
  "task_id": "${TEST_TASK_ID}",
  "type": "image_draw",
  "priority": "normal",
  "params": {
    "prompt": "A cute cat sitting on a windowsill, anime style, warm lighting",
    "width": 512,
    "height": 512,
    "project_id": "${TEST_PROJECT_ID}",
    "shot_id": 1
  }
}
EOF
)

HTTP_CODE=$(curl -sf -m 10 -o /tmp/e2e-render.json -w '%{http_code}' \
  -X POST "${GOLD_TEAM_URL}/api/v1/tasks" \
  -H 'Content-Type: application/json' \
  -d "$RENDER_BODY" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "202" ]]; then
  TASK_STATUS=$(json_val "$(cat /tmp/e2e-render.json)" "status")
  ENGINE_TARGET=$(json_val "$(cat /tmp/e2e-render.json)" "engine_target")
  QUEUE_POS=$(json_val "$(cat /tmp/e2e-render.json)" "queue_position")
  pass "Render task submitted: status=${TASK_STATUS}, engine=${ENGINE_TARGET}, queue=#${QUEUE_POS}"
else
  fail "Render task submission failed (HTTP ${HTTP_CODE})"
  cat /tmp/e2e-render.json 2>/dev/null || true
fi

# =============================================================================
# Phase 4: Poll Task Status Until Complete
# =============================================================================
section "Phase 4: Poll Task Status"

ELAPSED=0
FINAL_STATUS=""
FINAL_PROGRESS=0

while [[ $ELAPSED -lt $POLL_TIMEOUT_SEC ]]; do
  HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-task-status.json -w '%{http_code}' \
    "${GOLD_TEAM_URL}/api/v1/tasks/${TEST_TASK_ID}" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "200" ]]; then
    FINAL_STATUS=$(json_val "$(cat /tmp/e2e-task-status.json)" "status")
    FINAL_PROGRESS=$(json_val "$(cat /tmp/e2e-task-status.json)" "progress")
    log "Task ${TEST_TASK_ID}: status=${FINAL_STATUS}, progress=${FINAL_PROGRESS}% (${ELAPSED}s elapsed)"

    if [[ "$FINAL_STATUS" == "completed" ]]; then
      break
    elif [[ "$FINAL_STATUS" == "failed" ]]; then
      ERR_MSG=$(json_val "$(cat /tmp/e2e-task-status.json)" "error")
      break
    fi
  else
    log "Status query returned HTTP ${HTTP_CODE}, retrying..."
  fi

  sleep "$POLL_INTERVAL_SEC"
  ELAPSED=$((ELAPSED + POLL_INTERVAL_SEC))
done

if [[ "$FINAL_STATUS" == "completed" ]]; then
  OUTPUT_IMG=$(json_val_nested "$(cat /tmp/e2e-task-status.json)" "outputs.image")
  ENGINE_USED=$(json_val "$(cat /tmp/e2e-task-status.json)" "engine_used")
  pass "Render completed in ~${ELAPSED}s via ${ENGINE_USED}"
  log "Output: ${OUTPUT_IMG}"
elif [[ "$FINAL_STATUS" == "failed" ]]; then
  fail "Render failed: ${ERR_MSG}"
else
  fail "Render did not complete within ${POLL_TIMEOUT_SEC}s (last status: ${FINAL_STATUS})"
fi

# =============================================================================
# Phase 5: Query Engines / Capacity
# =============================================================================
section "Phase 5: Gold-Team Engine Status"

HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-engines.json -w '%{http_code}' \
  "${GOLD_TEAM_URL}/api/v1/engines" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
  ENGINE_COUNT=$(python3 -c "import json; print(len(json.load(open('/tmp/e2e-engines.json'))))" 2>/dev/null || echo "?")
  pass "Engine registry: ${ENGINE_COUNT} engine(s) registered"
else
  warn "Could not query engine registry (HTTP ${HTTP_CODE})"
fi

HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-capacity.json -w '%{http_code}' \
  "${GOLD_TEAM_URL}/api/v1/engines/capacity" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
  pass "Engine capacity query OK"
else
  warn "Could not query engine capacity (HTTP ${HTTP_CODE})"
fi

# =============================================================================
# Phase 6: Submit to Review Platform
# =============================================================================
section "Phase 6: Submit to Review Platform"

if [[ "$REVIEW_UP" == "true" ]]; then
  REVIEW_BODY=$(cat <<EOF
{
  "project_id": "${TEST_PROJECT_ID}",
  "shot_id": "shot-001",
  "phase": "image",
  "asset_url": "${OUTPUT_IMG:-https://example.com/test-render.jpg}",
  "priority": "normal",
  "metadata": {
    "source": "e2e-smoke-test",
    "task_id": "${TEST_TASK_ID}",
    "engine_used": "${ENGINE_USED:-unknown}"
  }
}
EOF
)

  HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-review.json -w '%{http_code}' \
    -X POST "${REVIEW_URL}/api/v1/v6/shot-cards/" \
    -H 'Content-Type: application/json' \
    -d "$REVIEW_BODY" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "201" ]]; then
    REVIEW_CARD_ID=$(json_val "$(cat /tmp/e2e-review.json)" "id")
    REVIEW_CARD_STATUS=$(json_val "$(cat /tmp/e2e-review.json)" "status")
    CLEANUP_REVIEW_IDS+=("$REVIEW_CARD_ID")
    pass "Review card created: id=${REVIEW_CARD_ID}, status=${REVIEW_CARD_STATUS}"

    # Query the review card
    HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-review-query.json -w '%{http_code}' \
      "${REVIEW_URL}/api/v1/v6/shot-cards/${REVIEW_CARD_ID}" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      pass "Review card query OK"
    else
      warn "Could not query review card (HTTP ${HTTP_CODE})"
    fi

    # Approve the review card
    HTTP_CODE=$(curl -sf -m 5 -o /dev/null -w '%{http_code}' \
      -X POST "${REVIEW_URL}/api/v1/v6/shot-cards/${REVIEW_CARD_ID}/approve" \
      -H 'Content-Type: application/json' 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      pass "Review card approved"
    else
      warn "Could not approve review card (HTTP ${HTTP_CODE})"
    fi
  else
    RESP=$(cat /tmp/e2e-review.json 2>/dev/null || echo "empty")
    fail "Review submission failed (HTTP ${HTTP_CODE}): ${RESP}"
  fi
else
  skip "Review submission — review-platform not running"
fi

# =============================================================================
# Phase 7: Core-Backend Pipeline Proxy (via v1 API)
# =============================================================================
section "Phase 7: Core-Backend → Gold-Team Proxy"

if [[ "$CORE_UP" == "true" ]]; then
  # Submit a task through core-backend's pipeline proxy
  PROXY_TASK_ID="proxy-${TIMESTAMP}"
  PROXY_BODY=$(cat <<EOF
{
  "task_id": "${PROXY_TASK_ID}",
  "type": "image_draw",
  "priority": "normal",
  "params": {
    "prompt": "E2E proxy test - a beautiful sunset",
    "width": 256,
    "height": 256
  }
}
EOF
)
  # Direct to gold-team through core-backend's render-shot needs a kv_shot row.
  # Instead, test the status proxy with a known task ID
  HTTP_CODE=$(curl -s -m 5 -o /tmp/e2e-proxy-status.json -w '%{http_code}' \
    "${CORE_URL}/api/v1/pipeline/status/${TEST_TASK_ID}" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "200" ]]; then
    PROXY_STATUS=$(json_val_nested "$(cat /tmp/e2e-proxy-status.json)" "data.status")
    pass "Core-backend status proxy OK: task=${TEST_TASK_ID}, status=${PROXY_STATUS}"
  elif [[ "$HTTP_CODE" == "404" ]]; then
    # Expected if task already completed and evicted
    warn "Core-backend status proxy returned 404 (task may have been evicted)"
  else
    warn "Core-backend status proxy returned HTTP ${HTTP_CODE}"
  fi

  # Test v1 shots list endpoint
  HTTP_CODE=$(curl -s -m 5 -o /tmp/e2e-shots.json -w '%{http_code}' \
    "${CORE_URL}/api/v1/shots/list/99999" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Core-backend shots list endpoint OK"
  else
    warn "Core-backend shots list returned HTTP ${HTTP_CODE}"
  fi
else
  skip "Core-backend proxy tests — core-backend not running"
fi

# =============================================================================
# Phase 8: Movie-Agent Pipeline Lifecycle (if available)
# =============================================================================
section "Phase 8: Movie-Agent Pipeline Lifecycle"

if [[ "$MOVIE_UP" == "true" && -n "$CLEANUP_PIPELINE_ID" ]]; then
  # Test getting phases
  HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-phases.json -w '%{http_code}' \
    "${MOVIE_AGENT_URL}/api/v1/pipeline/${CLEANUP_PIPELINE_ID}/phases" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "200" ]]; then
    PHASE_COUNT=$(python3 -c "import json; print(len(json.load(open('/tmp/e2e-phases.json'))))" 2>/dev/null || echo "?")
    pass "Pipeline phases: ${PHASE_COUNT} phase(s) defined"
  else
    warn "Could not query pipeline phases (HTTP ${HTTP_CODE})"
  fi

  # Test cancel
  HTTP_CODE=$(curl -sf -m 5 -o /tmp/e2e-cancel.json -w '%{http_code}' \
    -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/${CLEANUP_PIPELINE_ID}/cancel" \
    -H 'Content-Type: application/json' \
    -d '{"reason":"e2e test cleanup"}' 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Pipeline cancelled OK"
    CLEANUP_PIPELINE_ID=""
  else
    warn "Pipeline cancel returned HTTP ${HTTP_CODE}"
  fi
else
  skip "Pipeline lifecycle tests — movie-agent not running or no pipeline created"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║                        SUMMARY                                ║${NC}"
echo -e "${BOLD}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "  ${GREEN}✅ Passed:   ${PASS_COUNT}${NC}"
echo -e "  ${RED}❌ Failed:   ${FAIL_COUNT}${NC}"
echo -e "  ${YELLOW}⚠️  Warnings: ${WARN_COUNT}${NC}"
echo -e "  ${DIM}⏭  Skipped:  ${SKIP_COUNT}${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo -e "\n${RED}${BOLD}RESULT: FAIL${NC} (${FAIL_COUNT} test(s) failed)\n"
  exit 1
else
  echo -e "\n${GREEN}${BOLD}RESULT: PASS${NC} (all critical tests passed)\n"
  exit 0
fi
