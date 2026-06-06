# =============================================================================
# KAIS AIGC Platform — Integration Test Makefile
# =============================================================================
# Usage:
#   make test-integration          # Full suite: compose up → test → down
#   make test-integration-quick    # Run tests against already-running container
#   make test-integration-down     # Tear down test container
#   make test-unit                 # Run hermes-agent unit tests (no container)
# =============================================================================

COMPOSE_TEST = docker compose -f docker-compose.test.yml
HERMES_TEST_URL ?= http://localhost:8090
PYTEST = cd docker/hermes-agent && python3 -m pytest
PYTEST_INTEGRATION = cd docker/hermes-agent && HERMES_URL=$(HERMES_TEST_URL) python3 -m pytest tests/conftest_integration.py tests/test_*_integration.py -v --tb=short

.PHONY: test-integration test-integration-quick test-integration-down test-unit test-all

# --- Full integration test: build → up → test → down ---
test-integration:
	@echo "=== Building hermes-agent test image ==="
	$(COMPOSE_TEST) build
	@echo "=== Starting hermes-agent test container ==="
	$(COMPOSE_TEST) up -d
	@echo "=== Waiting for health check ==="
	@for i in $$(seq 1 30); do \
		curl -sf $(HERMES_TEST_URL)/v1/health > /dev/null 2>&1 && break; \
		echo "  Waiting... ($$i/30)"; \
		sleep 2; \
	done
	@echo "=== Running integration tests ==="
	-$(PYTEST_INTEGRATION)
	@TEST_EXIT=$$?; \
	echo "=== Tearing down ==="; \
	$(COMPOSE_TEST) down -v 2>/dev/null; \
	exit $$TEST_EXIT

# --- Quick: run tests against already-running container ---
test-integration-quick:
	HERMES_URL=$(HERMES_TEST_URL) $(PYTEST_INTEGRATION)

# --- Tear down test container ---
test-integration-down:
	$(COMPOSE_TEST) down -v

# --- Unit tests (no container needed) ---
test-unit:
	$(PYTEST) tests/test_routes.py tests/test_core.py tests/test_integration.py -v --tb=short

# --- All tests ---
test-all: test-unit test-integration
