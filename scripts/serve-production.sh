#!/usr/bin/env bash
# serve-production.sh — kap 生产服务正规启动路径(Phase 66 / PWR-01,2026-08-25)。
#
# 由来(review F01):旧启动是裸 `NODE_ENV=production PORT=10588 setsid nohup node
# data/serve/app.js`,.env 里的 GOLD_TEAM_URL 从未被任何路径加载——生产进程
# 恒 simulateOnly,画布重生成两天假成功无人察觉。本脚本是唯一生产启动方式:
#   - 引擎 env 显式落死(GOLD_TEAM_URL,可被外部环境覆盖)
#   - --build 先重建 server bundle(esbuild src/app.ts → data/serve/app.js)
#   - setsid 脱离会话,日志落 data/serve/production.log
# 用法:
#   bash scripts/serve-production.sh            # 直接启动(需已有 data/serve/app.js)
#   bash scripts/serve-production.sh --build    # 先 npm run build:server 再启动
#   STOP=1 bash scripts/serve-production.sh     # 仅停止运行中的实例
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
PORT="${PORT:-10588}"
export NODE_ENV=production
export PORT
# 引擎容器 docker-compose.real.yml 绑 0.0.0.0:8002(本机可达 127.0.0.1)。
# 外部已 export 时尊重外部值(测试环境指向别的引擎)。
export GOLD_TEAM_URL="${GOLD_TEAM_URL:-http://127.0.0.1:8002}"
LOG=data/serve/production.log
PIDFILE=data/serve/production.pid

# ── 停止旧实例(按 pidfile + 端口兜底)──────────────────────────────
stop_existing() {
  if [ -f "$PIDFILE" ]; then
    local old; old="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
      echo "[serve-production] 停止旧实例 pid=$old"
      kill "$old" || true
      for _ in $(seq 1 20); do kill -0 "$old" 2>/dev/null || break; sleep 0.5; done
      kill -0 "$old" 2>/dev/null && { echo "…强杀"; kill -9 "$old" || true; }
    fi
    rm -f "$PIDFILE"
  fi
}

if [ "${STOP:-0}" = "1" ]; then stop_existing; exit 0; fi

if [ "${1:-}" = "--build" ]; then
  echo "[serve-production] 重建 server bundle…"
  npm run build:server
fi

[ -f data/serve/app.js ] || { echo "✗ data/serve/app.js 不存在——先跑 --build"; exit 1; }

stop_existing
mkdir -p data/serve
echo "[serve-production] 启动: PORT=$PORT GOLD_TEAM_URL=$GOLD_TEAM_URL"
setsid nohup node data/serve/app.js >>"$LOG" 2>&1 &
echo $! > "$PIDFILE"
sleep 2
PID="$(cat "$PIDFILE")"
kill -0 "$PID" 2>/dev/null || { echo "✗ 启动失败,查 $LOG"; tail -5 "$LOG"; exit 1; }
echo "[serve-production] ✅ pid=$PID → http://localhost:$PORT (log: $LOG)"
echo "[serve-production] 引擎 env 实证:"
tr '\0' '\n' < "/proc/$PID/environ" | grep -E '^GOLD_TEAM_URL=' || { echo "✗ env 未注入!"; exit 1; }
