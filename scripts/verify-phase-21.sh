#!/usr/bin/env bash
# =============================================================================
# Phase 21 Live Runtime Verification (v1.4)
# =============================================================================
# Closes v1.3 deferred gaps:
#   VERIFY-01 — Full stack healthchecks
#   VERIFY-02 — ACE-Step container healthy (FIX-02)
#   VERIFY-03 — E2E music generation produces MP3 (FIX-03)
#   VERIFY-04 — Dockerfile builds succeed (MERGE-03)
#
# Usage:
#   ./scripts/verify-phase-21.sh           # full verification
#   ./scripts/verify-phase-21.sh --build   # build images first, then verify
#   ./scripts/verify-phase-21.sh --check   # check build status only
# =============================================================================
set -euo pipefail

COMPOSE="docker compose -f docker-compose.v9.yml"
LOG_DIR="/tmp/phase21-verify"
mkdir -p "$LOG_DIR"

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
header() { printf "\n\033[1;36m━━━ %s ━━━\033[0m\n" "$*"; }

# -----------------------------------------------------------------------------
# VERIFY-04: Dockerfile builds
# -----------------------------------------------------------------------------
verify_builds() {
  header "VERIFY-04 / MERGE-03: Dockerfile builds"
  local targets=("kais-core-backend" "kais-gold-team")
  local overall=0
  for svc in "${targets[@]}"; do
    local log="$LOG_DIR/build-${svc}.log"
    yellow "Building ${svc} (log: ${log})..."
    if $COMPOSE build "$svc" >"$log" 2>&1; then
      green "  ✓ ${svc} build succeeded"
    else
      red   "  ✗ ${svc} build FAILED (see ${log})"
      overall=1
    fi
  done
  return $overall
}

# -----------------------------------------------------------------------------
# VERIFY-01: Core 7 services healthy
# -----------------------------------------------------------------------------
verify_stack_health() {
  header "VERIFY-01: Core 7 services healthcheck"
  yellow "Bringing up core stack (no profiles)..."
  $COMPOSE up -d comfyui-primary comfyui-auxiliary kais-core-backend kais-gold-team audit-db redis hermes-agent

  yellow "Waiting up to 5min for healthchecks..."
  local waited=0
  while (( waited < 300 )); do
    local statuses
    statuses=$($COMPOSE ps --format "{{.Name}}|{{.Status}}" 2>/dev/null)
    local healthy
    healthy=$(echo "$statuses" | grep -c "healthy" || true)
    local total
    total=$(echo "$statuses" | grep -c "|" || true)
    printf "  [%3ds] healthy=%s/%s\n" "$waited" "$healthy" "$total"
    if (( healthy >= 7 )); then
      green "  ✓ All 7 core services healthy"
      $COMPOSE ps
      return 0
    fi
    sleep 15
    waited=$((waited + 15))
  done
  red "  ✗ Timeout — not all services healthy within 5min"
  $COMPOSE ps
  return 1
}

# -----------------------------------------------------------------------------
# VERIFY-02: ACE-Step container health, no PermissionError
# -----------------------------------------------------------------------------
verify_acestep_container() {
  header "VERIFY-02 / FIX-02: ACE-Step container health"
  yellow "Bringing up ACE-Step sidecar (profile=ace)..."
  $COMPOSE --profile ace up -d kais-acestep

  yellow "Waiting up to 5min for ACE-Step healthcheck (start_period=300s)..."
  local waited=0
  while (( waited < 360 )); do
    local status
    status=$(docker inspect --format '{{.State.Health.Status}}' kais-acestep 2>/dev/null || echo "starting")
    printf "  [%3ds] kais-acestep health=%s\n" "$waited" "$status"
    if [[ "$status" == "healthy" ]]; then
      green "  ✓ ACE-Step container healthy"
      break
    fi
    sleep 15
    waited=$((waited + 15))
  done

  if [[ "$status" != "healthy" ]]; then
    red "  ✗ ACE-Step did not become healthy"
    return 1
  fi

  yellow "Checking logs for PermissionError..."
  local perm_errors
  perm_errors=$(docker compose -f docker-compose.v9.yml logs kais-acestep 2>&1 | grep -ci "permissionerror" || true)
  if (( perm_errors == 0 )); then
    green "  ✓ Zero PermissionError entries in ACE-Step logs"
    return 0
  else
    red   "  ✗ Found ${perm_errors} PermissionError entries in ACE-Step logs"
    return 1
  fi
}

# -----------------------------------------------------------------------------
# VERIFY-03: E2E music generation produces real MP3
# -----------------------------------------------------------------------------
verify_e2e_music() {
  header "VERIFY-03 / FIX-03: E2E music generation"
  yellow "Submitting music task to gold-team..."
  local resp
  resp=$(curl -sS -X POST http://localhost:8002/api/v1/tasks \
    -H "Content-Type: application/json" \
    -d '{
      "task_type": "music",
      "params": {
        "prompt": "Upbeat electronic test tone, 5 seconds",
        "audio_duration": 5,
        "audio_format": "mp3",
        "model": "acestep-v15-xl-turbo"
      }
    }') || true
  echo "  Submit response: $resp"

  local task_id
  task_id=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('task_id',''))" 2>/dev/null || echo "")
  if [[ -z "$task_id" ]]; then
    red "  ✗ No task_id returned"
    return 1
  fi
  yellow "  Task ID: ${task_id}"

  yellow "Polling up to 6min for completion..."
  local waited=0
  while (( waited < 360 )); do
    local status_json
    status_json=$(curl -sS "http://localhost:8002/api/v1/tasks/${task_id}" 2>/dev/null || echo "{}")
    local state
    state=$(echo "$status_json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
    printf "  [%3ds] state=%s\n" "$waited" "$state"
    if [[ "$state" == "completed" ]]; then
      local output
      output=$(echo "$status_json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
outs = d.get('result', {}).get('outputs', []) or []
print(outs[0].get('path', '') if outs else '')
" 2>/dev/null || echo "")
      if [[ -n "$output" && -f "$output" ]]; then
        local size
        size=$(stat -c%s "$output")
        green "  ✓ Music generated: ${output} (${size} bytes)"
        return 0
      else
        red "  ✗ Completed but no/missing output file: ${output}"
        return 1
      fi
    elif [[ "$state" == "failed" ]]; then
      red "  ✗ Task failed: $(echo "$status_json" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("error",""))' 2>/dev/null)"
      return 1
    fi
    sleep 10
    waited=$((waited + 10))
  done
  red "  ✗ Timeout waiting for task completion"
  return 1
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
case "${1:-}" in
  --build) verify_builds ;;
  --check)
    docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "kais-(core-backend|gold-team)" || echo "No v1.4 images yet"
    ;;
  "" )
    verify_builds
    verify_stack_health
    verify_acestep_container
    verify_e2e_music
    green "\n✓✓✓ Phase 21 verification complete — all 4 VERIFY reqs satisfied ✓✓✓"
    ;;
  *)
    echo "Usage: $0 [--build|--check]"
    exit 1
    ;;
esac
