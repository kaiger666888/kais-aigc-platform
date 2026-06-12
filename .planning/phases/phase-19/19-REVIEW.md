---
phase: 19-integration-verification
reviewed: 2026-06-12T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - docker/gold-team/tests/test_integration_pipeline.py
  - docker/gold-team/tests/test_regression_verification.py
  - docker/gold-team/tests/test_tasktype_coverage.py
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 19: Code Review Report

**Reviewed:** 2026-06-12T00:00:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Reviewed three test files for the Phase 19 integration verification suite. One critical defect was found that will cause test failures in CI or any environment without real cloud API credentials. The cloud fallback test (`test_11_cloud_fallback_video_final_without_comfyui`) depends on `_resolve_engine` returning a cloud engine, but the production code gates cloud engine resolution behind an `is_configured` check that requires real API credentials to be set as environment variables. Additional warnings cover duplicated routing logic, fragile assertions, and reliance on private methods.

## Critical Issues

### CR-01: Cloud fallback test will fail without real API credentials

**File:** `docker/gold-team/tests/test_regression_verification.py:174-178`
**Issue:** `test_11_cloud_fallback_video_final_without_comfyui` asserts that `executor._resolve_engine("cloud-kling", task)` returns a non-None engine with `backend_type == BackendType.CLOUD`. However, the production `_resolve_engine` method (`executor.py:747-753`) gates cloud engine resolution behind `engine.is_configured`. `KlingEngine.is_configured` (cloud_kling.py:39-40) returns `True` only when both `KLING_ACCESS_KEY` and `KLING_SECRET_KEY` environment variables are set. In CI or any environment without these secrets, `is_configured` returns `False`, causing `_resolve_engine` to skip the cloud engine and fall through to the mock engine on line 764 of executor.py. The assertion `assert resolved.backend_type == BackendType.CLOUD` will then fail because the mock engine has `backend_type == BackendType.MOCK`.

**Fix:**
```python
def test_11_cloud_fallback_video_final_without_comfyui(self):
    """When no ComfyUI engine is registered, VIDEO_FINAL resolves to cloud engine."""
    from unittest.mock import MagicMock, patch

    from src.v6.engines.cloud_kling import KlingEngine
    from src.v6.engines.mock import MockEngine
    from src.v6.executor import TaskExecutor
    from src.v6.models.task import TaskType

    executor = TaskExecutor()
    cloud_engine = KlingEngine()
    mock_engine = MockEngine()

    executor.register_engine(cloud_engine)
    executor.register_engine(mock_engine)

    # Patch is_configured so _resolve_engine finds the cloud engine
    # without needing real API credentials in CI
    with patch.object(type(cloud_engine), 'is_configured', True):
        task = MagicMock()
        task.type = TaskType.VIDEO_FINAL
        task.params = {"extra": {}}

        resolved = executor._resolve_engine("cloud-kling", task)
        assert resolved is not None, "No engine resolved for cloud-kling"
        assert resolved.backend_type == BackendType.CLOUD, (
            f"Resolved engine is not CLOUD: {resolved.backend_type}"
        )
```

## Warnings

### WR-01: Router-engine ID assertions are fragile and tightly coupled to internal routing tables

**File:** `docker/gold-team/tests/test_tasktype_coverage.py:232,247,262`
**Issue:** Tests `test_music_routes_to_engine`, `test_tts_routes_to_engine`, and `test_image_to_3d_routes_to_engine` assert exact engine IDs (`"acestep-internal"`, `"tts-tracker"`, `"hunyuan3d-local"`) returned by the router. These IDs come from the `DEDICATED_ENGINES` dictionary in `router.py:19-28`. If that mapping changes, these tests break. The tests also exercise both the router AND the executor together, making failures hard to diagnose -- it is unclear whether a failure is in routing or resolution. A better pattern would be to test the router and executor independently.
**Fix:** Consider testing the router's output and the executor's resolution separately, or at minimum add a comment linking the asserted IDs to the `DEDICATED_ENGINES` table they originate from.

### WR-02: Integration pipeline test duplicates production routing logic

**File:** `docker/gold-team/tests/test_integration_pipeline.py:44-106`
**Issue:** `_build_workflow_for_task` is a 62-line function that reimplements the task-type-to-workflow routing logic from `executor.py._execute_task` (lines 229-614). This duplication means the test verifies its own copy of the routing logic, not the production code. If the production routing changes, the test will continue passing while the actual behavior diverges -- a false-negative risk.
**Fix:** Extract the workflow-building logic from `executor.py` into a testable public function (e.g. `build_workflow_for_task(task) -> dict`), and call that function from both the executor and the test.

### WR-03: `_resolve_engine` is a private method tested directly in multiple tests

**File:** `docker/gold-team/tests/test_tasktype_coverage.py:187,201,215,229,245,261`
**File:** `docker/gold-team/tests/test_regression_verification.py:174`
**Issue:** The tests call `executor._resolve_engine(engine_id, task)` directly. This is a private method (prefixed with `_`) whose signature or behavior can change without notice. Tests coupled to private methods break on internal refactors even when public behavior is preserved. Six separate test methods across two files depend on this internal API.
**Fix:** Consider exposing a public `resolve_engine(engine_id, task)` method or testing through a higher-level public API such as `submit` + `poll`.

### WR-04: `sys.path.insert` in test_regression_verification.py is fragile and inconsistent

**File:** `docker/gold-team/tests/test_regression_verification.py:20`
**Issue:** `sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))` manipulates the import path at module level. This assumes a specific directory structure relative to the test file. If the test is moved or invoked from a different working directory, imports will fail. The other two test files (`test_integration_pipeline.py` and `test_tasktype_coverage.py`) do not have this `sys.path` manipulation, creating an inconsistency -- either they rely on a different mechanism or they happen to work via `PYTHONPATH` being set externally.
**Fix:** Use a `conftest.py` with a shared `sys.path` setup, or configure `PYTHONPATH` in `pytest.ini`/`pyproject.toml`, or use proper package installation (editable `pip install -e .`).

## Info

### IN-01: `_grep_count` shells out to system `grep` instead of using Python

**File:** `docker/gold-team/tests/test_regression_verification.py:29-39`
**Issue:** The `_grep_count` helper runs `subprocess.run(["grep", ...])` to search files. This is non-portable (relies on system `grep` being available and supporting the same flags) and slower than using Python's built-in `pathlib` and `re` modules. The other test files do not use subprocess.
**Fix:** Replace with `pathlib.Path.rglob()` + `re.search()` for cross-platform portability.

### IN-02: Unused `_MOCK_COVERED_TYPES`, `_SUBPROCESS_COVERED_TYPES`, `_COMFYUI_ONLY_TYPES` constants

**File:** `docker/gold-team/tests/test_tasktype_coverage.py:28-59`
**Issue:** Three constants (`_MOCK_COVERED_TYPES`, `_SUBPROCESS_COVERED_TYPES`, `_COMFYUI_ONLY_TYPES`) are defined at module level but never referenced by any test method or helper. They appear to be documentation-only or leftover from an earlier iteration.
**Fix:** Remove unused constants or add tests that verify the sets match the actual engine registrations.

### IN-03: `_StubEngine.capabilities` returns a new `EngineCapabilities` on every access

**File:** `docker/gold-team/tests/test_tasktype_coverage.py:92-93`
**Issue:** The `capabilities` property creates a new `EngineCapabilities(supported_types=self._supported)` on every call. While functionally correct, this is slightly wasteful compared to caching the object. Not a correctness issue.
**Fix:** Cache the `EngineCapabilities` instance in `__init__` if desired.

---

_Reviewed: 2026-06-12T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
