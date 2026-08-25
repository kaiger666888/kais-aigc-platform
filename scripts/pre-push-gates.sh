#!/usr/bin/env bash
# pre-push-gates.sh — KAP 本地 push 前硬门（CI Phase 0 / P3）
#
# 拓扑决策（见 2026-08-25 CI 门槛评估报告 C1/B10）：本仓迭代模式是直推
# master、不开 PR —— 本地 pre-push 是唯一会被真实执行的硬拦层，GitHub
# Actions（ci.yml）只是兜底可见层。预算 ~1 分钟。
#
# 逃生口：git push --no-verify（应急用；CLAUDE.md 要求在 commit message 登记）。
#
# 三道门：
#   1. trufflehog3 密扫 —— 只扫「即将离开本机的增量」：
#      - 有 staged 改动 → 扫 `git diff --cached`
#      - pre-push 场景通常无 staged → 扫 @{upstream}..HEAD 的 push 增量
#      只扫 diff 的 + 行（拦新增）。排除清单来自评估报告 A3 实测基线：
#      797 findings / 5 HIGH 全部是 vendored 与构建产物噪音（node_modules/、
#      .venvs/、docker/hermes-agent/_hermes_source/、data/web/ 打包产物、
#      *.png/*.jpg 二进制熵误报），一方源码（src/、scripts/）零命中。
#      MEDIUM+ 才拦，LOW 噪音放行。
#   2. npx tsc --noEmit（strict，~2.4s）
#   3. esbuild 构建校验（npm run build:server；产物 data/serve/ 已在
#      .gitignore，不污染工作区）。tsc 绿 ≠ 能打包 —— 2026-08-25 评估期间
#      router.ts TS1192 实证 esbuild 是更严的那道门。
#
# 注意：trufflehog3 的 target 必须是目录 —— 单文件 target 会被当作它的
# YAML config 解析（load_config 语义）。故把 + 行写入临时目录再扫目录。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TRUFFLEHOG3=/home/kai/.local/bin/trufflehog3

EXCLUDES=(
    ':(exclude)node_modules'
    ':(exclude)**/node_modules'
    ':(exclude).venvs'
    ':(exclude)**/.venvs'
    ':(exclude)docker/hermes-agent/_hermes_source'
    ':(exclude)data/web'
    ':(exclude)*.png'
    ':(exclude)*.jpg'
    ':(exclude)*.lock'
)

log()  { printf '\n[push-gate] %s\n' "$*"; }
fail() { printf '[push-gate] FAIL: %s\n' "$*" >&2; exit 1; }

# ── Gate 1: trufflehog3 — 密扫增量 diff ────────────────────────────────────
SCAN_DIR="$(mktemp -d /tmp/kap-prepush-scan.XXXXXX)"
DIFF_FILE="$(mktemp /tmp/kap-prepush-diff.XXXXXX)"   # 完整 diff 只做筛选源，不进扫描目录
ADDED_FILE="$SCAN_DIR/added.txt"                     # 只有 + 行被扫描
trap 'rm -rf "$SCAN_DIR" "$DIFF_FILE"' EXIT

git diff --cached -- . "${EXCLUDES[@]}" > "$DIFF_FILE"
if [ ! -s "$DIFF_FILE" ]; then
    UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
    if [ -n "$UPSTREAM" ]; then
        git diff "$UPSTREAM...HEAD" -- . "${EXCLUDES[@]}" > "$DIFF_FILE"
    fi
fi
# 只保留 + 行（新增内容），+++ 头行天然以 + 开头，finding 仍能定位到文件
grep '^+' "$DIFF_FILE" > "$ADDED_FILE" || true

log "1/3 trufflehog3 密扫 — 增量 $(wc -l < "$ADDED_FILE") 行"
if [ -s "$ADDED_FILE" ]; then
    if ! "$TRUFFLEHOG3" --no-entropy -s MEDIUM -f TEXT "$SCAN_DIR"; then
        fail "trufflehog3 在 push 增量中发现 MEDIUM+ 疑似密钥 — 处理后重推（或 --no-verify 登记）"
    fi
else
    echo "  (无增量 diff，跳过)"
fi

# ── Gate 2: tsc 类型检查 ───────────────────────────────────────────────────
log "2/3 tsc --noEmit（strict）"
npx tsc --noEmit || fail "tsc --noEmit 未通过"

# ── Gate 3: esbuild 构建校验 ───────────────────────────────────────────────
log "3/3 esbuild 构建校验（build:server）"
npm run build:server || fail "esbuild 打包失败（tsc 绿 ≠ 能打包）"

log "ALL GATES PASSED ✓"
