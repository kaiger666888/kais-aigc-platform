#!/usr/bin/env bash
# =============================================================================
# Hermes-Agent Integration Test Runner
# =============================================================================
# Smart runner that handles build, health check, test execution, and teardown.
# Generates JUnit XML report and collects logs on failure.
#
# Usage:
#   ./scripts/run-integration-tests.sh              # Full run
#   ./scripts/run-integration-tests.sh --quick       # Skip build
#   ./scripts/run-integration-tests.sh --no-teardown # Keep container running
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.test.yml"
TEST_DIR="$PROJECT_ROOT/docker/hermes-agent/tests"
REPORT_DIR="$PROJECT_ROOT/test-reports"

HERMES_TEST_PORT="${HERMES_TEST_PORT:-8090}"
HERMES_URL="http://localhost:${HERMES_TEST_PORT}"
NO_TEARDOWN=false
QUICK=false

# Parse args
for arg in "$@"; do
  case "$arg" in
    --no-teardown) NO_TEARDOWN=true ;;
    --quick) QUICK=true ;;
    --help|-h)
      echo "Usage: $0 [--quick] [--no-teardown]"
      echo "  --quick        Skip Docker image build"
      echo "  --no-teardown  Keep container running after tests"
      exit 0
      ;;
  esac
done

cleanup() {
  if [ "$NO_TEARDOWN" = "false" ]; then
    echo "=== Tearing down test container ==="
    docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
  else
    echo "=== Container left running (use --teardown to remove) ==="
  fi
}
trap cleanup EXIT

# Create report directory
mkdir -p "$REPORT_DIR"

# Build
if [ "$QUICK" = "false" ]; then
  echo "=== Building hermes-agent test image ==="
  docker compose -f "$COMPOSE_FILE" build
fi

# Start
echo "=== Starting hermes-agent test container ==="
docker compose -f "$COMPOSE_FILE" up -d

# Wait for health
echo "=== Waiting for hermes-agent health check ==="
HEALTHY=false
for i in $(seq 1 30); do
  if curl -sf "$HERMES_URL/v1/health" > /dev/null 2>&1; then
    echo "hermes-agent is healthy (attempt $i)"
    HEALTHY=true
    break
  fi
  echo "  Waiting... ($i/30)"
  sleep 2
done

if [ "$HEALTHY" = "false" ]; then
  echo "ERROR: hermes-agent did not become healthy within 60 seconds"
  echo "=== Container logs ==="
  docker compose -f "$COMPOSE_FILE" logs hermes-agent
  exit 1
fi

# Run tests
echo "=== Running integration tests ==="
cd "$PROJECT_ROOT/docker/hermes-agent"
TEST_EXIT=0
HERMES_URL="$HERMES_URL" python3 -m pytest \
  tests/conftest_integration.py \
  tests/test_*_integration.py \
  -v \
  --tb=short \
  --junitxml="$REPORT_DIR/integration-test-results.xml" \
  || TEST_EXIT=$?

# Collect logs if failed
if [ $TEST_EXIT -ne 0 ]; then
  echo "=== Tests failed — collecting container logs ==="
  docker compose -f "$COMPOSE_FILE" logs hermes-agent > "$REPORT_DIR/hermes-container.log" 2>&1
  echo "Container logs saved to: $REPORT_DIR/hermes-container.log"
fi

# Summary
echo ""
echo "=== Test Summary ==="
if [ $TEST_EXIT -eq 0 ]; then
  echo "All tests PASSED"
else
  echo "Some tests FAILED (exit code: $TEST_EXIT)"
fi
echo "Report: $REPORT_DIR/integration-test-results.xml"

exit $TEST_EXIT
