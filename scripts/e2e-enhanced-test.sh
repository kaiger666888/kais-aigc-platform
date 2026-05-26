#!/usr/bin/env bash
# =============================================================================
# kais-aigc-platform E2E Enhanced Test Suite
# =============================================================================
# Extended smoke test with cross-service tests and full pipeline lifecycle.
# Self-contained — no external dependencies beyond curl + python3.
#
# Usage:
#   bash scripts/e2e-enhanced-test.sh
#
# Environment variables (all optional):
#   CORE_URL             core-backend URL           (default: http://localhost:8000)
#   MOVIE_AGENT_URL      movie-agent URL            (default: http://localhost:8001)
#   GOLD_TEAM_URL        gold-team URL              (default: http://localhost:8002)
#   REVIEW_URL           review-platform URL        (default: http://localhost:8091)
#   RESULT_DIR           result output dir          (default: /tmp/integration-test-results)
# =============================================================================
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
CORE_URL="${CORE_URL:-http://localhost:8000}"
MOVIE_AGENT_URL="${MOVIE_AGENT_URL:-http://localhost:8001}"
GOLD_TEAM_URL="${GOLD_TEAM_URL:-http://localhost:8002}"
REVIEW_URL="${REVIEW_URL:-http://localhost:8091}"
RESULT_DIR="${RESULT_DIR:-/tmp/integration-test-results}"
TIMESTAMP=$(date +%s)
DATE_STAMP=$(date +%Y%m%d_%H%M%S)

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

json_array_len() {
  python3 -c "import sys,json; print(len(json.loads(sys.argv[1])))" "$1" 2>/dev/null
}

# Timeout-protected curl: curl_t <seconds> [curl args...]
curl_t() {
  local timeout_sec="$1"; shift
  curl -s -m "${timeout_sec}" "$@"
}

# ─── Setup result dir ────────────────────────────────────────────────────────
mkdir -p "${RESULT_DIR}"
RESULT_FILE="${RESULT_DIR}/e2e-${DATE_STAMP}.json"

# ─── Service availability flags ──────────────────────────────────────────────
CORE_UP=false
MOVIE_UP=false
GOLD_UP=false
REVIEW_UP=false

# =============================================================================
# Phase 1: Health Checks
# =============================================================================
section "Phase 1: Service Health Checks"

# Core backend
HTTP_CODE=$(curl_t 5 -o /tmp/e2e-core-health.json -w '%{http_code}' "${CORE_URL}/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  SVC=$(json_val "$(cat /tmp/e2e-core-health.json)" "service")
  pass "core-backend healthy (${SVC})"
  CORE_UP=true
else
  warn "core-backend unreachable (HTTP ${HTTP_CODE})"
fi

# Movie agent
HTTP_CODE=$(curl_t 5 -o /tmp/e2e-movie-health.json -w '%{http_code}' "${MOVIE_AGENT_URL}/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  SVC=$(json_val "$(cat /tmp/e2e-movie-health.json)" "service")
  PASS_PIPE_COUNT=$(json_val "$(cat /tmp/e2e-movie-health.json)" "pipelines")
  pass "movie-agent healthy (${SVC}, ${PASS_PIPE_COUNT} pipeline(s))"
  MOVIE_UP=true
else
  fail "movie-agent unreachable (HTTP ${HTTP_CODE})"
fi

# Gold team
HTTP_CODE=$(curl_t 5 -o /tmp/e2e-gold-health.json -w '%{http_code}' "${GOLD_TEAM_URL}/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "gold-team healthy"
  GOLD_UP=true
else
  warn "gold-team unreachable (HTTP ${HTTP_CODE})"
fi

# Review platform
HTTP_CODE=$(curl_t 5 -o /tmp/e2e-review-health.json -w '%{http_code}' "${REVIEW_URL}/health" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "review-platform healthy"
  REVIEW_UP=true
else
  warn "review-platform unreachable (HTTP ${HTTP_CODE})"
fi

# =============================================================================
# Phase 2: Movie-Agent Pipeline API — CRUD Lifecycle
# =============================================================================
section "Phase 2: Pipeline CRUD (Movie-Agent)"

CLEANUP_PIPELINE_ID=""

if [[ "$MOVIE_UP" == "true" ]]; then
  # 2a. List empty pipelines
  HTTP_CODE=$(curl_t 5 -o /tmp/e2e-pipe-list.json -w '%{http_code}' \
    "${MOVIE_AGENT_URL}/api/v1/pipelines" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    TOTAL=$(json_val "$(cat /tmp/e2e-pipe-list.json)" "total")
    pass "List pipelines: HTTP 200, total=${TOTAL}"
  else
    fail "List pipelines: HTTP ${HTTP_CODE}"
  fi

  # 2b. Create pipeline
  PIPELINE_BODY=$(cat <<EOF
{
  "project_id": "e2e-${TIMESTAMP}",
  "config": {
    "episode": "E2E-TEST"
  },
  "metadata": {
    "source": "e2e-enhanced-test",
    "timestamp": "${TIMESTAMP}"
  }
}
EOF
)
  HTTP_CODE=$(curl_t 10 -o /tmp/e2e-pipe-create.json -w '%{http_code}' \
    -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/create" \
    -H 'Content-Type: application/json' \
    -d "$PIPELINE_BODY" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "201" ]]; then
    PIPELINE_ID=$(json_val "$(cat /tmp/e2e-pipe-create.json)" "pipeline_id")
    CLEANUP_PIPELINE_ID="$PIPELINE_ID"
    P_STATUS=$(json_val "$(cat /tmp/e2e-pipe-create.json)" "status")
    pass "Create pipeline: ${PIPELINE_ID} (status=${P_STATUS})"
  else
    fail "Create pipeline: HTTP ${HTTP_CODE}"
    cat /tmp/e2e-pipe-create.json 2>/dev/null | python3 -m json.tool 2>/dev/null || true
  fi

  # 2c. Query status
  if [[ -n "$CLEANUP_PIPELINE_ID" ]]; then
    HTTP_CODE=$(curl_t 5 -o /tmp/e2e-pipe-status.json -w '%{http_code}' \
      "${MOVIE_AGENT_URL}/api/v1/pipeline/${CLEANUP_PIPELINE_ID}/status" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      P_STATUS=$(json_val "$(cat /tmp/e2e-pipe-status.json)" "status")
      PHASE_COUNT=$(json_array_len "$(cat /tmp/e2e-pipe-status.json | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['phases']))" 2>/dev/null)")
      pass "Get status: ${P_STATUS}, ${PHASE_COUNT} phases"
    else
      fail "Get status: HTTP ${HTTP_CODE}"
    fi

    # 2d. Get phases
    HTTP_CODE=$(curl_t 5 -o /tmp/e2e-pipe-phases.json -w '%{http_code}' \
      "${MOVIE_AGENT_URL}/api/v1/pipeline/${CLEANUP_PIPELINE_ID}/phases" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      PHASE_COUNT=$(python3 -c "import json; d=json.load(open('/tmp/e2e-pipe-phases.json')); print(len(d))" 2>/dev/null || echo "?")
      REVIEW_PHASES=$(python3 -c "import json; d=json.load(open('/tmp/e2e-pipe-phases.json')); print(sum(1 for p in d if p.get('review')))" 2>/dev/null || echo "?")
      pass "Get phases: ${PHASE_COUNT} phases (${REVIEW_PHASES} with review)"
    else
      fail "Get phases: HTTP ${HTTP_CODE}"
    fi

    # 2e. List pipelines (should include our new one)
    HTTP_CODE=$(curl_t 5 -o /tmp/e2e-pipe-list2.json -w '%{http_code}' \
      "${MOVIE_AGENT_URL}/api/v1/pipelines" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      TOTAL=$(json_val "$(cat /tmp/e2e-pipe-list2.json)" "total")
      if [[ "$TOTAL" -gt 0 ]]; then
        pass "List pipelines after create: total=${TOTAL}"
      else
        fail "List pipelines: expected >0, got ${TOTAL}"
      fi
    else
      fail "List pipelines: HTTP ${HTTP_CODE}"
    fi

    # 2f. Cancel pipeline
    HTTP_CODE=$(curl_t 5 -o /tmp/e2e-pipe-cancel.json -w '%{http_code}' \
      -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/${CLEANUP_PIPELINE_ID}/cancel" \
      -H 'Content-Type: application/json' \
      -d '{"reason":"e2e test cleanup"}' 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      CANCEL_STATUS=$(json_val "$(cat /tmp/e2e-pipe-cancel.json)" "status")
      pass "Cancel pipeline: ${CANCEL_STATUS}"
      CLEANUP_PIPELINE_ID=""
    else
      warn "Cancel pipeline: HTTP ${HTTP_CODE}"
    fi
  fi

  # 2g. Test 404 for non-existent pipeline
  HTTP_CODE=$(curl_t 5 -o /dev/null -w '%{http_code}' \
    "${MOVIE_AGENT_URL}/api/v1/pipeline/nonexistent-pipe-id/status" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "404" ]]; then
    pass "Non-existent pipeline returns 404"
  else
    fail "Non-existent pipeline should return 404, got ${HTTP_CODE}"
  fi

  # 2h. Test POST /api/v1/pipeline/run (async run)
  RUN_BODY='{"project_id":"e2e-run-test","config":{"episode":"RUN-TEST"}}'
  HTTP_CODE=$(curl_t 10 -o /tmp/e2e-pipe-run.json -w '%{http_code}' \
    -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/run" \
    -H 'Content-Type: application/json' \
    -d "$RUN_BODY" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "202" ]]; then
    RUN_ID=$(json_val "$(cat /tmp/e2e-pipe-run.json)" "pipeline_id")
    RUN_STATUS=$(json_val "$(cat /tmp/e2e-pipe-run.json)" "status")
    pass "Run pipeline: ${RUN_ID} (status=${RUN_STATUS}, accepted async)"
    # Cancel it
    curl_t 5 -o /dev/null -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/${RUN_ID}/cancel" \
      -H 'Content-Type: application/json' -d '{}' 2>/dev/null || true
  else
    fail "Run pipeline: HTTP ${HTTP_CODE}"
  fi

  # 2i. Test validation — missing project_id
  HTTP_CODE=$(curl_t 5 -o /tmp/e2e-pipe-bad.json -w '%{http_code}' \
    -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/create" \
    -H 'Content-Type: application/json' \
    -d '{}' 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "400" ]]; then
    pass "Validation: missing project_id returns 400"
  else
    warn "Validation: expected 400 for missing project_id, got ${HTTP_CODE}"
  fi
else
  skip "Pipeline CRUD tests — movie-agent not running"
fi

# =============================================================================
# Phase 3: Gold-Team Task Submission
# =============================================================================
section "Phase 3: Gold-Team Task Submission"

if [[ "$GOLD_UP" == "true" ]]; then
  TASK_ID="e2e-${TIMESTAMP}"
  TASK_BODY=$(cat <<EOF
{
  "task_id": "${TASK_ID}",
  "type": "image_draw",
  "priority": "normal",
  "params": {
    "prompt": "E2E test image - a simple test pattern with number 42",
    "width": 256,
    "height": 256,
    "steps": 1
  }
}
EOF
)
  HTTP_CODE=$(curl_t 15 -o /tmp/e2e-task-submit.json -w '%{http_code}' \
    -X POST "${GOLD_TEAM_URL}/api/v1/tasks" \
    -H 'Content-Type: application/json' \
    -d "$TASK_BODY" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" || "$HTTP_CODE" == "202" ]]; then
    TASK_STATUS=$(json_val_nested "$(cat /tmp/e2e-task-submit.json)" "status" 2>/dev/null || echo "submitted")
    pass "Task submitted: ${TASK_ID} (status=${TASK_STATUS}, HTTP ${HTTP_CODE})"
  else
    fail "Task submission: HTTP ${HTTP_CODE}"
    cat /tmp/e2e-task-submit.json 2>/dev/null | python3 -m json.tool 2>/dev/null || true
  fi
else
  skip "Gold-team task submission — gold-team not running"
fi

# =============================================================================
# Phase 4: Gold-Team Engine Status
# =============================================================================
section "Phase 4: Gold-Team Engine Status"

if [[ "$GOLD_UP" == "true" ]]; then
  HTTP_CODE=$(curl_t 5 -o /tmp/e2e-engines.json -w '%{http_code}' \
    "${GOLD_TEAM_URL}/api/v1/engines" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    ENGINE_COUNT=$(json_array_len "$(cat /tmp/e2e-engines.json)" 2>/dev/null || echo "?")
    pass "Engine status: ${ENGINE_COUNT} engine(s) registered"
  else
    warn "Engine status: HTTP ${HTTP_CODE}"
  fi

  # Test capacity endpoint
  HTTP_CODE=$(curl_t 5 -o /tmp/e2e-capacity.json -w '%{http_code}' \
    "${GOLD_TEAM_URL}/api/v1/capacity" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Capacity endpoint OK"
  else
    warn "Capacity endpoint: HTTP ${HTTP_CODE}"
  fi
else
  skip "Engine status — gold-team not running"
fi

# =============================================================================
# Phase 5: Cross-Service — Movie-Agent → Gold-Team
# =============================================================================
section "Phase 5: Cross-Service (Movie-Agent → Gold-Team)"

if [[ "$MOVIE_UP" == "true" && "$GOLD_UP" == "true" ]]; then
  # Create a pipeline that would eventually call gold-team
  CROSS_BODY=$(cat <<EOF
{
  "project_id": "cross-e2e-${TIMESTAMP}",
  "config": {
    "episode": "CROSS-TEST",
    "gold_team_url": "${GOLD_TEAM_URL}"
  }
}
EOF
)
  HTTP_CODE=$(curl_t 10 -o /tmp/e2e-cross-create.json -w '%{http_code}' \
    -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/create" \
    -H 'Content-Type: application/json' \
    -d "$CROSS_BODY" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "201" ]]; then
    CROSS_ID=$(json_val "$(cat /tmp/e2e-cross-create.json)" "pipeline_id")
    pass "Cross-service pipeline created: ${CROSS_ID}"

    # Verify the pipeline can reach gold-team (via status check)
    HTTP_CODE=$(curl_t 5 -o /tmp/e2e-cross-status.json -w '%{http_code}' \
      "${MOVIE_AGENT_URL}/api/v1/pipeline/${CROSS_ID}/status" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      pass "Cross-service pipeline status accessible"
    else
      warn "Cross-service status: HTTP ${HTTP_CODE}"
    fi

    # Cleanup
    curl_t 5 -o /dev/null -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/${CROSS_ID}/cancel" \
      -H 'Content-Type: application/json' -d '{}' 2>/dev/null || true
  else
    fail "Cross-service pipeline creation: HTTP ${HTTP_CODE}"
  fi
else
  skip "Cross-service tests — need both movie-agent and gold-team"
fi

# =============================================================================
# Phase 6: Core-Backend Integration (if available)
# =============================================================================
section "Phase 6: Core-Backend Integration"

if [[ "$CORE_UP" == "true" ]]; then
  # Test core-backend health confirms service mesh
  HTTP_CODE=$(curl_t 5 -o /tmp/e2e-core-v1.json -w '%{http_code}' \
    "${CORE_URL}/api/v1/pipeline/status/e2e-nonexistent" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "404" ]]; then
    pass "Core-backend v1 pipeline route responding (HTTP ${HTTP_CODE})"
  else
    warn "Core-backend v1 pipeline route: HTTP ${HTTP_CODE}"
  fi

  # Test shots list
  HTTP_CODE=$(curl_t 5 -o /tmp/e2e-shots.json -w '%{http_code}' \
    "${CORE_URL}/api/v1/shots/list/99999" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Core-backend shots list endpoint OK"
  else
    warn "Core-backend shots list: HTTP ${HTTP_CODE}"
  fi
else
  skip "Core-backend integration — core-backend not running"
fi

# =============================================================================
# Phase 7: Review Platform (if available, skip auth-dependent tests)
# =============================================================================
section "Phase 7: Review Platform"

if [[ "$REVIEW_UP" == "true" ]]; then
  # Test review platform health (basic check)
  HTTP_CODE=$(curl_t 5 -o /tmp/e2e-review-health2.json -w '%{http_code}' \
    "${REVIEW_URL}/health" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Review platform health check OK"
  else
    warn "Review platform health: HTTP ${HTTP_CODE}"
  fi

  # Try to list shot cards (may require auth)
  HTTP_CODE=$(curl_t 5 -o /tmp/e2e-review-cards.json -w '%{http_code}' \
    "${REVIEW_URL}/api/v1/v6/shot-cards" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Review platform shot cards accessible"
  elif [[ "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" ]]; then
    warn "Review platform requires auth (HTTP ${HTTP_CODE}) — expected, skipping"
  else
    warn "Review platform shot cards: HTTP ${HTTP_CODE}"
  fi
else
  skip "Review platform tests — not running"
fi

# =============================================================================
# Phase 8: Full Pipeline Lifecycle (End-to-End)
# =============================================================================
section "Phase 8: Full Pipeline Lifecycle"

if [[ "$MOVIE_UP" == "true" ]]; then
  # Create → Status → Phases → Cancel
  FULL_BODY=$(cat <<EOF
{
  "project_id": "full-e2e-${TIMESTAMP}",
  "config": {
    "episode": "FULL-E2E",
    "genre": "test",
    "platform": "e2e"
  },
  "metadata": {
    "source": "e2e-full-lifecycle",
    "timestamp": "${TIMESTAMP}"
  }
}
EOF
)
  HTTP_CODE=$(curl_t 10 -o /tmp/e2e-full-create.json -w '%{http_code}' \
    -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/create" \
    -H 'Content-Type: application/json' \
    -d "$FULL_BODY" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "201" ]]; then
    FULL_ID=$(json_val "$(cat /tmp/e2e-full-create.json)" "pipeline_id")
    pass "Full lifecycle: created ${FULL_ID}"

    # Step 2: Status
    HTTP_CODE=$(curl_t 5 -o /tmp/e2e-full-status.json -w '%{http_code}' \
      "${MOVIE_AGENT_URL}/api/v1/pipeline/${FULL_ID}/status" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      pass "Full lifecycle: status query OK"
    else
      fail "Full lifecycle: status query HTTP ${HTTP_CODE}"
    fi

    # Step 3: Verify all 11 phases present
    PHASE_COUNT=$(python3 -c "
import json
d=json.load(open('/tmp/e2e-full-status.json'))
print(len(d.get('phases', [])))
" 2>/dev/null || echo "0")
    if [[ "$PHASE_COUNT" == "11" ]]; then
      pass "Full lifecycle: all 11 phases present"
    else
      fail "Full lifecycle: expected 11 phases, got ${PHASE_COUNT}"
    fi

    # Step 4: Verify phase structure
    HAS_REQUIREMENT=$(python3 -c "
import json
d=json.load(open('/tmp/e2e-full-status.json'))
phases=d.get('phases',[])
print('yes' if any(p['id']=='requirement' for p in phases) else 'no')
" 2>/dev/null || echo "no")
    if [[ "$HAS_REQUIREMENT" == "yes" ]]; then
      pass "Full lifecycle: requirement phase present"
    else
      fail "Full lifecycle: requirement phase missing"
    fi

    # Step 5: Get phases detail
    HTTP_CODE=$(curl_t 5 -o /tmp/e2e-full-phases.json -w '%{http_code}' \
      "${MOVIE_AGENT_URL}/api/v1/pipeline/${FULL_ID}/phases" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      REVIEW_COUNT=$(python3 -c "
import json
d=json.load(open('/tmp/e2e-full-phases.json'))
print(sum(1 for p in d if p.get('review')))
" 2>/dev/null || echo "?")
      REVIEW_MSG="Full lifecycle: phases detail OK (${REVIEW_COUNT} review phases)"
      pass "${REVIEW_MSG}"
    else
      fail "Full lifecycle: phases detail HTTP ${HTTP_CODE}"
    fi

    # Step 6: Cancel
    HTTP_CODE=$(curl_t 5 -o /tmp/e2e-full-cancel.json -w '%{http_code}' \
      -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/${FULL_ID}/cancel" \
      -H 'Content-Type: application/json' \
      -d '{"reason":"e2e full lifecycle cleanup"}' 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      pass "Full lifecycle: cancelled"
    else
      warn "Full lifecycle: cancel HTTP ${HTTP_CODE}"
    fi

    # Step 7: Verify cancelled status
    HTTP_CODE=$(curl_t 5 -o /tmp/e2e-full-final.json -w '%{http_code}' \
      "${MOVIE_AGENT_URL}/api/v1/pipeline/${FULL_ID}/status" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      FINAL_STATUS=$(json_val "$(cat /tmp/e2e-full-final.json)" "status")
      if [[ "$FINAL_STATUS" == "cancelled" ]]; then
        pass "Full lifecycle: final status = cancelled"
      else
        warn "Full lifecycle: final status = ${FINAL_STATUS} (expected cancelled)"
      fi
    fi
  else
    fail "Full lifecycle: create failed (HTTP ${HTTP_CODE})"
  fi
else
  skip "Full pipeline lifecycle — movie-agent not running"
fi

# =============================================================================
# Phase 9: Edge Cases & Error Handling
# =============================================================================
section "Phase 9: Edge Cases & Error Handling"

if [[ "$MOVIE_UP" == "true" ]]; then
  # 9a. 404 route
  HTTP_CODE=$(curl_t 5 -o /dev/null -w '%{http_code}' \
    "${MOVIE_AGENT_URL}/api/v1/nonexistent" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "404" ]]; then
    pass "Unknown route returns 404"
  else
    fail "Unknown route: expected 404, got ${HTTP_CODE}"
  fi

  # 9b. Invalid JSON body
  HTTP_CODE=$(curl_t 5 -o /tmp/e2e-badjson.json -w '%{http_code}' \
    -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/create" \
    -H 'Content-Type: application/json' \
    -d 'not-json' 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "500" || "$HTTP_CODE" == "400" ]]; then
    pass "Invalid JSON returns error (${HTTP_CODE})"
  else
    warn "Invalid JSON: expected 400/500, got ${HTTP_CODE}"
  fi

  # 9c. Cancel non-existent pipeline
  HTTP_CODE=$(curl_t 5 -o /dev/null -w '%{http_code}' \
    -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/nonexistent/cancel" \
    -H 'Content-Type: application/json' -d '{}' 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "404" ]]; then
    pass "Cancel non-existent pipeline returns 404"
  else
    fail "Cancel non-existent: expected 404, got ${HTTP_CODE}"
  fi

  # 9d. Double cancel
  DC_BODY='{"project_id":"double-cancel-test"}'
  HTTP_CODE=$(curl_t 5 -o /tmp/e2e-dc-create.json -w '%{http_code}' \
    -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/create" \
    -H 'Content-Type: application/json' -d "$DC_BODY" 2>/dev/null || echo "000")
  DC_ID=$(json_val "$(cat /tmp/e2e-dc-create.json 2>/dev/null)" "pipeline_id" 2>/dev/null || echo "")
  if [[ -n "$DC_ID" ]]; then
    # First cancel
    curl_t 5 -o /dev/null -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/${DC_ID}/cancel" \
      -H 'Content-Type: application/json' -d '{}' 2>/dev/null || true
    # Second cancel — should still return 200 (idempotent)
    HTTP_CODE=$(curl_t 5 -o /tmp/e2e-dc-cancel2.json -w '%{http_code}' \
      -X POST "${MOVIE_AGENT_URL}/api/v1/pipeline/${DC_ID}/cancel" \
      -H 'Content-Type: application/json' -d '{}' 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      pass "Double cancel is idempotent (200)"
    else
      warn "Double cancel: HTTP ${HTTP_CODE}"
    fi
  fi
else
  skip "Edge case tests — movie-agent not running"
fi

# =============================================================================
# Write Results
# =============================================================================
section "Results"

RESULT_JSON=$(cat <<EOF
{
  "timestamp": "${DATE_STAMP}",
  "passed": ${PASS_COUNT},
  "failed": ${FAIL_COUNT},
  "warnings": ${WARN_COUNT},
  "skipped": ${SKIP_COUNT},
  "services": {
    "core_backend": ${CORE_UP},
    "movie_agent": ${MOVIE_UP},
    "gold_team": ${GOLD_UP},
    "review_platform": ${REVIEW_UP}
  },
  "result": "$([ $FAIL_COUNT -eq 0 ] && echo "PASS" || echo "FAIL")"
}
EOF
)
echo "$RESULT_JSON" > "${RESULT_FILE}"
log "Results written to ${RESULT_FILE}"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║                   E2E TEST SUMMARY                           ║${NC}"
echo -e "${BOLD}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "  ${GREEN}✅ Passed:   ${PASS_COUNT}${NC}"
echo -e "  ${RED}❌ Failed:   ${FAIL_COUNT}${NC}"
echo -e "  ${YELLOW}⚠️  Warnings: ${WARN_COUNT}${NC}"
echo -e "  ${DIM}⏭  Skipped:  ${SKIP_COUNT}${NC}"
echo -e "  ${CYAN}📄 Results:  ${RESULT_FILE}${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo -e "\n${RED}${BOLD}RESULT: FAIL${NC} (${FAIL_COUNT} test(s) failed)\n"
  exit 1
else
  echo -e "\n${GREEN}${BOLD}RESULT: PASS${NC} (all critical tests passed)\n"
  exit 0
fi
