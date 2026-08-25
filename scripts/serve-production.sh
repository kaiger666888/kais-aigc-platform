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
# 69-01 (v3.2 WBI-01):manifest 回写通道通电——画布换选真实覆写 khs episode
# 的 iframe-manifest/hook-candidates(70-02 真 v{N} 编号已修,链路完整)。
export KMC_MANIFEST_TRANSPORT="${KMC_MANIFEST_TRANSPORT:-fs}"
export KMC_EPISODES_ROOT="${KMC_EPISODES_ROOT:-/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/episodes}"
LOG=data/serve/production.log
PIDFILE=data/serve/production.pid

# ── 停止旧实例(按 pidfile + 端口兜底)──────────────────────────────
# 端口兜底 2026-08-25 补(审计事故):10:42 有人绕过本脚本裸启动 app.js 占住
# :10588,13:41 本脚本 stop 只按 pidfile 杀 → 新实例 EADDRINUSE 变无监听僵尸,
# 端口被无 env 旧实例服务 5.5h(simulateOnly 回潮)。端口归属者必须一并停掉。
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
  # 端口兜底:杀掉一切仍监听 :$PORT 的进程(含绕过本脚本的手动实例)
  local port_pids
  port_pids="$(ss -ltnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u || true)"
  if [ -n "$port_pids" ]; then
    for p in $port_pids; do
      echo "[serve-production] 端口 $PORT 仍被 pid=$p 占用,停止之"
      kill "$p" || true
    done
    for _ in $(seq 1 20); do
      [ -z "$(ss -ltnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' || true)" ] && break
      sleep 0.5
    done
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
# 端口归属实证(2026-08-25 事故教训):spawn pid 活着 ≠ 在服务。EADDRINUSE 下
# 全局异常 handler 只记日志不退出,spawn pid 存活但端口被别人占——必须断言
# 监听者就是本 pid,否则按失败处理并清理自己(不留无监听僵尸)。
PORT_OWNER="$(ss -ltnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u | tr '\n' ' ' | sed 's/ *$//')"
if [ "$PORT_OWNER" != "$PID" ]; then
  echo "✗ 端口 $PORT 归属 pid=[$PORT_OWNER] ≠ 启动 pid=$PID (EADDRINUSE/启动失败),清理本次实例"
  kill "$PID" 2>/dev/null || true
  tail -5 "$LOG"; exit 1
fi
curl -fsS -m 5 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 \
  || { echo "✗ /health 不通(启动未就绪?),查 $LOG"; tail -5 "$LOG"; exit 1; }
echo "[serve-production] ✅ pid=$PID (端口归属+health 已验) → http://localhost:$PORT (log: $LOG)"
echo "[serve-production] 引擎 env 实证:"
tr '\0' '\n' < "/proc/$PID/environ" | grep -E '^(GOLD_TEAM_URL|KMC_MANIFEST_TRANSPORT)=' || { echo "✗ env 未注入!"; exit 1; }
