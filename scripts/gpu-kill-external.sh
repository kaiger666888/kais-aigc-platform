#!/usr/bin/env bash
# gpu-kill-external.sh — 清掉指定 GPU 上不属于任何已知服务容器的裸 GPU 进程 (R2, 2026-09-06)
#
# 背景 (docs/gpu-unified-scheduling-plan.md §D9): 宿主机上容器外手动拉起的裸
# ComfyUI/python 进程不在 GpuScheduler 注册表管辖内 (docker start/stop 对其无效),
# 生命周期指令赶不走, ensureVram 驱逐完注册表服务后显存仍不足时由此脚本兜底。
# 部署: sudo cp scripts/gpu-kill-external.sh /usr/local/bin/ && sudo chmod 755
# /usr/local/bin/gpu-kill-external.sh (GpuScheduler.killExternalGpuProcesses 按该路径调用)。
#
# 用法: gpu-kill-external.sh <gpu_index> <needed_free_mb> [--dry-run]
#   --dry-run 也可用环境变量 DRY_RUN=1 — 只打印将杀清单, 不发任何信号。
# 输出契约 (首行, GpuScheduler 按前缀判定):
#   OK freed=<mb>      清理后 free >= needed (freed = 清理前后 free 差值)
#   SKIP <reason>      无需/无法清理 (already-free / no-candidates / dry-run /
#                      insufficient-after-kill ...), reason 内嵌关键数字
# 退出码: 0 = OK 或 SKIP (调用方读首行区分); 1 = 用法错误。
#
# 候选判定 (只杀"裸"进程, 宁漏勿误):
#   1. nvidia-smi --query-compute-apps --id <gpu> 列出该卡全部计算进程;
#   2. /proc/<pid>/cgroup 含 docker 容器 id → 在 docker ps 运行容器里 → 跳过
#      (容器内进程归 compose/注册表管辖, 输出行标注归属容器名); cgroup 有容器
#      id 但 docker ps 匹配不到 (已退出容器/docker 不可用) → 保守跳过 + WARN;
#   3. 非容器进程 = 裸进程候选, 但先过防误杀护栏 (见下)。
# 防误杀护栏:
#   - /proc/<pid>/cgroup 不可读 (内核线程/权限) → 跳过;
#   - cgroup 在 system.slice 的 systemd unit 里 (breeze-tts.service /
#     kais-rtx-vsr-3060ti.service / KAP 自身 unit 的 music3 等) → 跳过 — 有
#     supervisor 管生命周期的进程不归本脚本枪毙 (2026-09-06 实测 GPU2 上
#     kais-rtx-vsr-3060ti.service 命中此例);
#   - 进程名或 cmdline 含 "nvidia" (驱动/persistence 组件) → 跳过;
#   - 自身 PID 树 (脚本与全部祖先) → 跳过;
#   - 已知常驻引擎排除表 (无 systemd unit 时的兜底, 如手动 nohup 拉起的
#     breeze/music3/rtx_vsr): env GPU_KILL_EXTERNAL_EXCLUDE 可扩展 (逗号分隔子串)。
#     注: 常驻引擎显存造成的排队停滞属 R5 已知残余风险 (TTL 自卸), 不在本脚本
#     射程 — 见 docs/gpu-sched-hardening.md。
# 目标画像: 交互 shell (user.slice) 手动拉起后遗留的裸 python/ComfyUI 进程
# (D9 事故形态) — 无 supervisor、无容器、无人管。
# 杀进程顺序: 按显存占用降序逐个 (TERM → 等 3s → 仍活则 KILL → 等 1s), 每杀一个
# 复查 free, 够即停。root 属主: 先普通 kill, 失败再 sudo -n kill (kai 免密),
# 仍失败记 WARN 继续。
set -euo pipefail

# ─── 参数 ────────────────────────────────────────────────────────────────────
if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 <gpu_index> <needed_free_mb> [--dry-run]" >&2
  exit 1
fi
GPU_INDEX="$1"
NEEDED_MB="$2"
DRY_RUN=0
if [[ "${3:-}" == "--dry-run" || "${DRY_RUN:-0}" == "1" ]]; then
  DRY_RUN=1
fi
if [[ ! "$GPU_INDEX" =~ ^[0-9]+$ || ! "$NEEDED_MB" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 <gpu_index> <needed_free_mb> [--dry-run]  (数值参数非法)" >&2
  exit 1
fi

EXCLUDE_PATTERNS="${GPU_KILL_EXTERNAL_EXCLUDE:-breeze_server,music3-server,rtx_vsr}"

free_mb() {
  nvidia-smi --query-gpu=memory.free --id="$GPU_INDEX" --format=csv,noheader,nounits 2>/dev/null \
    | tr -d ' ' | head -1
}

pid_alive() { kill -0 "$1" 2>/dev/null; }

# 自身 PID 树 (脚本进程 + 全部祖先) — 杀到调用链等于自杀
declare -A OWN_TREE=()
_p="$$"
while [[ -n "$_p" && "$_p" != "0" ]]; do
  OWN_TREE["$_p"]=1
  _p=$(awk '/^PPid:/{print $2}' "/proc/$_p/status" 2>/dev/null || echo 0)
done

# 命中排除表 (nvidia 组件 / 常驻引擎): 匹配 nvidia-smi 进程名 + /proc cmdline
excluded_by_name() {
  local names="$1"
  if grep -qiE 'nvidia' <<<"$names"; then return 0; fi
  local pat
  IFS=',' read -ra _pats <<<"$EXCLUDE_PATTERNS"
  for pat in "${_pats[@]}"; do
    [[ -z "$pat" ]] && continue
    if grep -qiF "$pat" <<<"$names"; then return 0; fi
  done
  return 1
}

# ─── 前置检查 ────────────────────────────────────────────────────────────────
if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "SKIP no-nvidia-smi"
  exit 0
fi

INITIAL_FREE="$(free_mb || true)"
if [[ ! "$INITIAL_FREE" =~ ^[0-9]+$ ]]; then
  echo "SKIP nvidia-smi-unreadable (gpu=${GPU_INDEX})"
  exit 0
fi
if (( INITIAL_FREE >= NEEDED_MB )); then
  echo "SKIP already-free ${INITIAL_FREE}>=${NEEDED_MB}"
  exit 0
fi

# 运行容器清单 (id → name)。docker 不可用时留空 → 容器 cgroup 进程全部保守跳过。
declare -A CONTAINERS=()
if command -v docker >/dev/null 2>&1; then
  while IFS=$'\t' read -r cid cname; do
    [[ -n "$cid" ]] && CONTAINERS["$cid"]="$cname"
  done < <(docker ps --format '{{.ID}}\t{{.Names}}' 2>/dev/null || true)
fi

# ─── 候选收集 ────────────────────────────────────────────────────────────────
# 行格式: "<used_mb>\t<pid>\t<name>"; used_mb 非数字 (权限/N/A) 记 0 排最后。
CANDIDATES=()
SKIPPED=()
while IFS=',' read -r raw_pid raw_mem; do
  pid="$(tr -d ' [N/A]' <<<"$raw_pid" | head -1)"
  mem="$(tr -d ' MiB' <<<"$raw_mem" | head -1)"
  [[ "$pid" =~ ^[0-9]+$ ]] || continue
  [[ -n "${OWN_TREE[$pid]:-}" ]] && { SKIPPED+=("pid=$pid own-pid-tree"); continue; }

  cmdline="$(tr '\0' ' ' </proc/"$pid"/cmdline 2>/dev/null || true)"
  comm="$(cat "/proc/$pid/comm" 2>/dev/null || echo '?')"
  names="$comm $cmdline"

  # 容器归属: cgroup 含 docker-<64hex>.scope (v2) 或 /docker/<id> (v1)
  cg="$(cat "/proc/$pid/cgroup" 2>/dev/null)" || { SKIPPED+=("pid=$pid unreadable-cgroup (kernel/driver?)"); continue; }
  # set -e + pipefail: 无 docker 段时两级 grep 均可能退出 1 — 赋值必须吞非零
  hexid="$(grep -oE 'docker[-/][0-9a-f]{12,64}' <<<"$cg" | head -1 | grep -oE '[0-9a-f]{12,64}' || true)"
  if [[ -n "$hexid" ]]; then
    attributed=""
    for cid in "${!CONTAINERS[@]}"; do
      if [[ "$hexid" == "$cid"* ]]; then
        attributed="${CONTAINERS[$cid]}"
        break
      fi
    done
    if [[ -n "$attributed" ]]; then
      SKIPPED+=("pid=$pid container=$attributed (registry/compose 管辖)")
    else
      SKIPPED+=("pid=$pid container-id=${hexid:0:12} unmatched-in-docker-ps (保守跳过)")
      echo "WARN: pid=$pid 在容器 cgroup 但 docker ps 无匹配容器 — 保守跳过" >&2
    fi
    continue
  fi

  # systemd unit 下的进程 (system.slice/*.service) — 有 supervisor, 不在射程
  if grep -qE 'system\.slice/[^/]+\.service' <<<"$cg"; then
    unit="$(awk -F/ '{print $NF}' <<<"$cg")"
    SKIPPED+=("pid=$pid systemd-unit=$unit (supervised, 生命周期归 systemd)")
    continue
  fi

  if excluded_by_name "$names"; then
    SKIPPED+=("pid=$pid excluded-by-name (${comm})")
    continue
  fi

  [[ "$mem" =~ ^[0-9]+$ ]] || mem=0
  CANDIDATES+=("$(printf '%010d\t%s\t%s' "$mem" "$pid" "$comm")")
done < <(nvidia-smi --query-compute-apps=pid,used_memory --id="$GPU_INDEX" --format=csv,noheader,nounits 2>/dev/null || true)

# 显存占用降序 (前导零填充保证字典序)
mapfile -t SORTED < <(printf '%s\n' "${CANDIDATES[@]}" | sort -rn 2>/dev/null || true)
[[ ${#CANDIDATES[@]} -eq 0 ]] && SORTED=()

for s in "${SKIPPED[@]:-}"; do [[ -n "$s" ]] && echo "skip: $s"; done

if [[ ${#SORTED[@]} -eq 0 ]]; then
  echo "SKIP no-candidates (free=${INITIAL_FREE} need=${NEEDED_MB})"
  exit 0
fi

# ─── dry-run: 只列清单 ───────────────────────────────────────────────────────
if [[ $DRY_RUN -eq 1 ]]; then
  echo "SKIP dry-run (candidates ${#SORTED[@]}, free=${INITIAL_FREE} need=${NEEDED_MB})"
  for c in "${SORTED[@]}"; do
    IFS=$'\t' read -r mem pid comm <<<"$c"
    echo "[dry-run] would kill pid=$pid name=$comm vram=$((10#$mem))MiB"
  done
  exit 0
fi

# ─── 逐个清理 (TERM → 3s → KILL → 1s), 每杀复查 free ─────────────────────────
CURRENT_FREE="$INITIAL_FREE"
for c in "${SORTED[@]}"; do
  (( CURRENT_FREE >= NEEDED_MB )) && break
  IFS=$'\t' read -r mem pid comm <<<"$c"
  if ! pid_alive "$pid"; then continue; fi

  echo "kill: pid=$pid name=$comm vram=$((10#$mem))MiB (free=${CURRENT_FREE}/${NEEDED_MB})"
  if ! kill -TERM "$pid" 2>/dev/null; then
    if ! sudo -n kill -TERM "$pid" 2>/dev/null; then
      echo "WARN: pid=$pid TERM 失败 (属主非本用户且 sudo -n 不可用) — 跳过" >&2
      continue
    fi
  fi
  sleep 3
  if pid_alive "$pid"; then
    kill -KILL "$pid" 2>/dev/null || sudo -n kill -KILL "$pid" 2>/dev/null || {
      echo "WARN: pid=$pid KILL 失败 — 跳过" >&2
      continue
    }
    sleep 1
  fi

  next_free="$(free_mb || true)"
  [[ "$next_free" =~ ^[0-9]+$ ]] && CURRENT_FREE="$next_free"
done

FREED=$(( CURRENT_FREE - INITIAL_FREE )); (( FREED < 0 )) && FREED=0
if (( CURRENT_FREE >= NEEDED_MB )); then
  echo "OK freed=${FREED}"
else
  echo "SKIP insufficient-after-kill freed=${FREED} free=${CURRENT_FREE}/${NEEDED_MB}"
fi
