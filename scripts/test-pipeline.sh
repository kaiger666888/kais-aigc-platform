#!/usr/bin/env bash
# test-pipeline.sh — Integration test for the shot render pipeline
#
# Tests the full flow:
#   core-backend (shot data) → gold-team (render task) → review-platform (review submission)
#
# Prerequisites:
#   - core-backend running on CORE_URL (default: http://localhost:10588)
#   - gold-team running on GOLD_TEAM_URL (default: http://localhost:8002)
#   - review-platform running on REVIEW_URL (default: http://localhost:8090)
#
# Usage:
#   bash scripts/test-pipeline.sh [PROJECT_ID] [SHOT_ID]
#
# Environment variables:
#   CORE_URL         — core-backend base URL (default: http://localhost:10588)
#   GOLD_TEAM_URL    — gold-team base URL (default: http://localhost:8002)
#   REVIEW_URL       — review-platform base URL (default: http://localhost:8090)
#   API_KEY          — V6 API key for core-backend (default: kais-v6-dev)

set -euo pipefail

# ─── Config ───────────────────────────────────────────
CORE_URL="${CORE_URL:-http://localhost:10588}"
GOLD_TEAM_URL="${GOLD_TEAM_URL:-http://localhost:8002}"
REVIEW_URL="${REVIEW_URL:-http://localhost:8090}"
API_KEY="${API_KEY:-kais-v6-dev}"

PROJECT_ID="${1:-1}"
SHOT_ID="${2:-1}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass=0
fail=0
skip=0

# ─── Helpers ──────────────────────────────────────────
log()  { echo -e "${CYAN}[TEST]${NC} $*"; }
ok()   { echo -e "${GREEN}[PASS]${NC} $*"; ((pass++)); }
err()  { echo -e "${RED}[FAIL]${NC} $*"; ((fail++)); }
warn() { echo -e "${YELLOW}[SKIP]${NC} $*"; ((skip++)); }

check_service() {
  local name="$1" url="$2"
  log "Checking $name at $url ..."
  if curl -sf -o /dev/null -m 3 "$url/health" 2>/dev/null; then
    ok "$name is up"
    return 0
  else
    warn "$name is not reachable at $url"
    return 1
  fi
}

api_get() {
  curl -sf -H "X-API-Key: $API_KEY" "$CORE_URL$1" 2>/dev/null
}

api_post() {
  curl -sf -X POST -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" "$CORE_URL$1" -d "$2" 2>/dev/null
}

# ─── Phase 0: Health Checks ──────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "  Shot Render Pipeline — Integration Test"
echo "═══════════════════════════════════════════════"
echo ""

CORE_UP=false
GOLD_UP=false
REVIEW_UP=false

check_service "core-backend" "$CORE_URL" && CORE_UP=true || true
check_service "gold-team" "$GOLD_TEAM_URL" && GOLD_UP=true || true
check_service "review-platform" "$REVIEW_URL" && REVIEW_UP=true || true
echo ""

if [[ "$CORE_UP" == "false" && "$GOLD_UP" == "false" && "$REVIEW_UP" == "false" ]]; then
  err "All services are down. Start at least one service to run meaningful tests."
  echo ""
  echo "Summary: $pass passed, $fail failed, $skip skipped"
  exit 1
fi

# ─── Phase 1: Fetch shot list from core-backend ──────
echo "── Phase 1: Fetch shot list ───────────────────"
if [[ "$CORE_UP" == "true" ]]; then
  log "GET /api/v1/shots/list/$PROJECT_ID"
  SHOTS=$(api_get "/api/v1/shots/list/$PROJECT_ID")
  if [[ -n "$SHOTS" ]]; then
    ok "Got shot list response"
    echo "$SHOTS" | python3 -m json.tool 2>/dev/null | head -20 || echo "$SHOTS" | head -20
  else
    err "Empty response from shot list (project may not exist: $PROJECT_ID)"
  fi
else
  warn "Skipping shot list — core-backend not running"
fi
echo ""

# ─── Phase 2: Submit render task ─────────────────────
echo "── Phase 2: Submit render task ────────────────"
if [[ "$CORE_UP" == "true" ]]; then
  log "POST /api/v1/pipeline/render-shot  (shotId=$SHOT_ID, projectId=$PROJECT_ID)"
  RENDER_RESULT=$(api_post "/api/v1/pipeline/render-shot" "{\"shotId\":$SHOT_ID,\"projectId\":$PROJECT_ID,\"taskType\":\"image_draw\",\"priority\":\"normal\"}")
  if [[ -n "$RENDER_RESULT" ]]; then
    RENDER_CODE=$(echo "$RENDER_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code','?'))" 2>/dev/null || echo "?")
    if [[ "$RENDER_CODE" == "200" ]]; then
      ok "Render task submitted successfully"
      TASK_ID=$(echo "$RENDER_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['taskId'])" 2>/dev/null || echo "")
      echo "  Task ID: $TASK_ID"
      echo "$RENDER_RESULT" | python3 -m json.tool 2>/dev/null | head -15 || echo "$RENDER_RESULT" | head -15
    else
      err "Render task failed (code=$RENDER_CODE)"
      echo "$RENDER_RESULT" | python3 -m json.tool 2>/dev/null | head -10 || echo "$RENDER_RESULT" | head -10
      TASK_ID=""
    fi
  else
    err "Empty response from render-shot endpoint"
    TASK_ID=""
  fi
else
  warn "Skipping render task — core-backend not running (need it as API gateway)"
  TASK_ID="test-manual-$(date +%s)"
  log "Using synthetic task ID: $TASK_ID"
fi
echo ""

# ─── Phase 3: Query task status ──────────────────────
echo "── Phase 3: Query task status ─────────────────"
if [[ -n "$TASK_ID" && "$CORE_UP" == "true" ]]; then
  log "GET /api/v1/pipeline/status/$TASK_ID"
  sleep 1  # Brief wait for task to be picked up
  STATUS_RESULT=$(api_get "/api/v1/pipeline/status/$TASK_ID")
  if [[ -n "$STATUS_RESULT" ]]; then
    STATUS_CODE=$(echo "$STATUS_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code','?'))" 2>/dev/null || echo "?")
    if [[ "$STATUS_CODE" == "200" ]]; then
      ok "Task status retrieved"
      echo "$STATUS_RESULT" | python3 -m json.tool 2>/dev/null | head -15 || echo "$STATUS_RESULT" | head -15
    else
      warn "Task status returned non-200 (code=$STATUS_CODE) — task may have completed too fast or not exist"
    fi
  else
    err "Empty response from status endpoint"
  fi
else
  warn "Skipping task status query"
fi
echo ""

# ─── Phase 4: Submit to review ───────────────────────
echo "── Phase 4: Submit to review platform ────────"
if [[ "$CORE_UP" == "true" ]]; then
  REVIEW_BODY=$(cat <<EOF
{
  "projectId": "proj-$PROJECT_ID",
  "shotId": "shot-$SHOT_ID",
  "phase": "image",
  "assetUrl": "https://example.com/test-render.jpg",
  "thumbnailUrl": "https://example.com/test-thumb.jpg",
  "priority": "normal",
  "metadata": {
    "source": "pipeline-test",
    "taskId": "$TASK_ID"
  }
}
EOF
)
  log "POST /api/v1/pipeline/submit-to-review"
  REVIEW_RESULT=$(api_post "/api/v1/pipeline/submit-to-review" "$REVIEW_BODY")
  if [[ -n "$REVIEW_RESULT" ]]; then
    REVIEW_CODE=$(echo "$REVIEW_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code','?'))" 2>/dev/null || echo "?")
    if [[ "$REVIEW_CODE" == "200" ]]; then
      ok "Review submission accepted"
      echo "$REVIEW_RESULT" | python3 -m json.tool 2>/dev/null | head -15 || echo "$REVIEW_RESULT" | head -15
    else
      # May fail if review-platform is down — that's expected in partial test
      if [[ "$REVIEW_UP" == "true" ]]; then
        err "Review submission failed (code=$REVIEW_CODE)"
      else
        warn "Review submission failed — review-platform was already known to be down"
      fi
      echo "$REVIEW_RESULT" | python3 -m json.tool 2>/dev/null | head -10 || echo "$REVIEW_RESULT" | head -10
    fi
  else
    err "Empty response from submit-to-review endpoint"
  fi
else
  warn "Skipping review submission — core-backend not running"
fi
echo ""

# ─── Summary ─────────────────────────────────────────
echo "═══════════════════════════════════════════════"
echo -e "  ${GREEN}$pass passed${NC}, ${RED}$fail failed${NC}, ${YELLOW}$skip skipped${NC}"
echo "═══════════════════════════════════════════════"
echo ""

if [[ $fail -gt 0 ]]; then
  exit 1
fi
exit 0
