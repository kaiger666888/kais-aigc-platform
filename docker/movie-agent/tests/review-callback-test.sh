#!/bin/bash
# review-callback-test.sh — Integration test for review callback flow
#
# Prerequisites:
#   1. movie-agent running on localhost:8001
#   2. review-platform running on localhost:8090
#
# Usage:
#   bash tests/review-callback-test.sh

set -euo pipefail

AGENT_URL="${AGENT_URL:-http://localhost:8001}"
REVIEW_URL="${REVIEW_URL:-http://localhost:8090}"

echo "=== Review Callback Integration Test ==="
echo ""

# 1. Health check
echo "--- Step 1: Health check ---"
curl -sf "${AGENT_URL}/health" | jq .
echo ""

# 2. Start a pipeline (only art-direction phase for test)
echo "--- Step 2: Start pipeline (art-direction only) ---"
RESP=$(curl -sf -X POST "${AGENT_URL}/api/v1/pipeline/run" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "test-callback-001",
    "config": {
      "episode": "EP-TEST-CB",
      "phases": ["art-direction"]
    }
  }')
echo "$RESP" | jq .
PIPELINE_ID=$(echo "$RESP" | jq -r '.pipeline_id')
echo "Pipeline ID: $PIPELINE_ID"
echo ""

# Wait a moment for pipeline to submit review
echo "--- Step 3: Wait for review submission (5s) ---"
sleep 5

# 4. Check pipeline status
echo "--- Step 4: Check pipeline status ---"
curl -sf "${AGENT_URL}/api/v1/pipeline/${PIPELINE_ID}/status" | jq .
echo ""

# 5. Simulate review callback (approve)
echo "--- Step 5: Simulate review callback (approve) ---"
# First, find the review_id from pipeline state
STATUS_RESP=$(curl -sf "${AGENT_URL}/api/v1/pipeline/${PIPELINE_ID}/status")
echo "Status: $STATUS_RESP" | jq .

# Get review_id from the pipeline state file (if accessible)
# For testing, we'll use a mock review_id
REVIEW_ID="${REVIEW_ID:-1}"
echo "Using review_id=$REVIEW_ID (override with REVIEW_ID env var)"

CALLBACK_RESP=$(curl -sf -X POST "${AGENT_URL}/api/v1/pipeline/callback/review_result" \
  -H "Content-Type: application/json" \
  -d "{
    \"review_id\": ${REVIEW_ID},
    \"disposition\": \"approved\",
    \"source_system\": \"test\",
    \"result\": {
      \"selected\": [\"candidate-1\"],
      \"scores\": {\"quality\": 8},
      \"feedback\": \"Test approval\"
    }
  }")
echo "Callback response:"
echo "$CALLBACK_RESP" | jq .
echo ""

# 6. Check pipeline status after callback
sleep 2
echo "--- Step 6: Pipeline status after callback ---"
curl -sf "${AGENT_URL}/api/v1/pipeline/${PIPELINE_ID}/status" | jq .
echo ""

echo "=== Test Complete ==="
