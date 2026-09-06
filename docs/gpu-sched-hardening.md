# GPU 调度面加固交付文档（R1/R2/R3/R5 风险闭环）

> 工单：KAP GPU 调度面加固。分支 `wt/gpu-sched-hardening`（基线 `b608c7eb` = feat/reverse-dag-view HEAD，已含 M1+M2 双卡调度）。
> 本文档随最后 commit 入库；operator 割接按 §2 序列执行（部署/重启/容器操作全归 operator，代码侧未做任何运行态变更）。
> 日期：2026-09-06。

---

## ① 本批做了什么（C1–C4 逐项 + commit）

### C1（R1）协调面接电 — 配置与文档（commit `063310b5`）
- `.env.example`：`REDIS_URL=redis://127.0.0.1:6390`（systemd 宿主形态走宿主映射端口 6390；容器形态才用 `redis://redis:6379`，compose `environment:` 已对容器显式覆盖，宿主 .env 设 6390 不影响容器取值）+ `KAP_GPU_QUEUE_CROSSPROC=strict` + 三档语义（off/mirror/strict）与 redis 不可达 fail-open 降级说明。GPU 角色化节同步 CDI 化事实（`KAIS_*_GPU_UUID`，勿再走 device_ids legacy）。
- `docker-compose.v9.yml` gold-team `REDIS_URL` 处注明宿主形态取值（原 `.env` 第 30 行注释「容器内自动设置」对 systemd 形态误导）。
- `src/routes/production/llm/index.ts` `/status` 响应新增 `backend` 字段（`scheduler.backendKind`）——割接断言点，本批前该字段不存在（工单 C1.3 的验证项此前无对应实现）。
- 既有单测确认：`gpuQueueCrossProc.test.ts` 全绿（基线 93/93 中含）。注：`makeStore`/`RedisStateStore` 在基线**无**专属单测（全仓 grep 无 test 文件），非本批范围。

### C2（R2）kill-external 死代码复活（commit `7cc1916b`）
- 新增 `scripts/gpu-kill-external.sh`（`bash -n` 过；本机无 shellcheck 未装）：
  - 入参 `<gpu_index> <needed_free_mb> [--dry-run]`（`DRY_RUN=1` 等价）；首行契约 `OK freed=xxx` / `SKIP <reason>`，退出码 0=OK/SKIP、1=用法错误。
  - 候选 = `nvidia-smi --query-compute-apps --id <gpu>` 上**非容器**进程；容器归属按 `/proc/<pid>/cgroup`（v2 `docker-<hex64>.scope` / v1 `/docker/<id>`）对 `docker ps` id 前缀匹配。
  - 防误杀护栏（超出工单最低集，实现期实证补充，见 §2 R2 说明）：① cgroup 不可读跳过；② **system.slice systemd unit 进程跳过**（实测 GPU2 有 `kais-rtx-vsr-3060ti.service` 命中——名字白名单永远列不全，cgroup 判定才稳）；③ 名称/cmdline 含 nvidia 跳过；④ 自身 PID 树跳过；⑤ 常驻引擎排除表 `GPU_KILL_EXTERNAL_EXCLUDE`（默认 `breeze_server,music3-server,rtx_vsr`——均有独立生命周期管理，杀掉即破坏服务；breeze 为 `Restart=on-failure`，SIGTERM 不触发重启=服务直接下线）；⑥ 容器 cgroup 但 docker ps 匹配不到（已退出容器/docker 不可用）保守跳过 + WARN。
  - 杀序：显存降序逐个（TERM→等 3s→仍活 KILL→等 1s），每杀复查 free 够即停；root 属主普通 kill 失败 → `sudo -n kill` → 仍失败 WARN 继续。
  - 实测（本机，dry-run 不发信号）：GPU1 上 7G `python3.13` 正确归属 comfyui-primary 容器跳过；GPU2 上 hermes python 正确识别为 systemd unit 跳过；PATH 桩合成裸进程（真实无害 `sleep` victim + 假 nvidia-smi）走完整杀链输出 `OK freed=16000`。注：bash `kill` 是 builtin，无法用 PATH 桩拦截——桩测时 victim 收到了真实 SIGTERM（即生产行为，符合预期）。
- `GpuScheduler.ts` 接线：`killExternalGpuProcesses` private→protected（子类桩化），`ensureVram` 尾部——注册表驱逐循环后 `currentFree < neededMb` 才调用 + 复读 free + try/catch 双保险吞错。**free 足够时零执行 = 零行为变化**（红线 4，单测断言）。65 行 D9 注释与实际行为对齐。
- 新增 `gpuSchedulerKillExternal.test.ts` 5 用例：足够零调用 / 驱逐不足→清理→达标 granted / 清理 SKIP 原结果不变 / 桩抛异常吞错 / 无候选裸进程画像触发。

### C3（R5）breeze_tts 常驻感知（commit `79ba0158`）
- `_client.ts` 新增 `probeBreezeResident(fetchImpl?)`：GET `:5130/health` **1s 硬超时**，返回 `{modelLoaded, loading}`；任何失败（非 200/超时/网络异常）一律 not loaded（fail-closed 走满档）。与既有 `probeBreezeHealth`（5s，status 路由用）分工。
- `config.ts` 常量 `BREEZE_TTS_RESIDENT_INCREMENT_MIB = 2560`（注释注明来源：权重 ~7.2G 已驻留只按合成增量+余量预检，同 music3 先例）。
- `speak.ts` / `voice-design.ts`：`withGpuQueueTimed` 前探测，`model_loaded===true → requireVramMiB: 2560`，否则不传走满档 8192（首次合成与 TTL 过期后首请求自然落满档）。
- `gpuVramManager.ts`：vram_retry 预算耗尽抛 `VramInsufficientError` 前补一条 `recordEvent`（detail 提示注册表外常驻占用可疑源：breeze-tts :5130 TTL 600s 自卸 / systemd 常驻不在 /free 驱逐范围 + 定位手段）。不改重试逻辑本身。
- 测试：新增 `breezeResident.test.ts` 6 用例（注入 fetch 桩全分支 + 常量契约）；既有 `scripts/verify-breeze-tts.ts` 83/83（上游断言以 `upstreamCaptured()` 过滤 R5 /health 探针，契约本身不变）。路由层手动冒烟见 §2 R2 后说明。

### C4（stretch）MemoryStateStore 锁 TTL 惰性过期（commit `226987cc`）
- 锁记录带 `acquiredAt+ttlMs`，读取路径（acquire/getLock/getAllLocks）惰性清扫：过期视为无锁，他人可获取；原 holder release 幂等（过期未易主→成功；已被他人接手→失败不误伤新 holder）；重入 acquire 刷新 TTL 起点。可选注入时钟 `opts.now`（构造签名零破坏）。约 40 行 src 改动，未触发 >100 行放弃条款。
- 新增 `memoryStateStore.test.ts` 5 用例（工单要求的 3 个 + 重入刷新 + 非持有者保护）。

### 验证总况（C5，全部在 worktree 复跑通过）
```
npx tsc --noEmit                                                    # exit 0
node --import tsx --test src/services/gpu/__tests__/*.test.ts \
  src/lib/__tests__/gpuVramManager.test.ts src/lib/__tests__/gpuQueueCrossProc.test.ts \
  src/lib/__tests__/gpuEngineRole.test.ts                           # 103 pass / 0 fail
bash -n scripts/gpu-kill-external.sh                                # exit 0
npx tsx scripts/verify-breeze-tts.ts                                # 83/83
```
**环境偏差自述（合法自纠偏）**：① 工单命令的目录实参形式 `--test src/services/gpu/__tests__/` 在本机 node v24.13.0 + tsx 组合下会因 tsx 把目录解析为 `index.json` 报 ERR_MODULE_NOT_FOUND，产生 1 个**目录伪测试失败**（基线同样如此，非本批引入；目录内全部真实测试通过）；等效 glob 形式 `src/services/gpu/__tests__/*.test.ts` 103/103 全绿，验收请用 glob 形式。② worktree 无 node_modules，已 symlink 主仓 `node_modules`（gitignore 覆盖，不入库）。③ 本机无 shellcheck，未安装（按工单指示跳过）。

---

## ② operator 割接序列

> 顺序建议：R2（拷脚本）→ 代码合入 + rebuild → R1（.env + restart）→ 观察 → R3（容器重建，独立窗口）。
> 1–3 全部是宿主机操作，KAP 为 systemd unit `kais-aigc-platform`（WorkingDirectory=/home/kai/workspace/kais-aigc-platform，跑 `data/serve/app.js` bundle——**改代码后必须先 rebuild 再 restart**）。

### 0. 代码合入 + 重建 bundle（R1/R2/R3 代码侧前置）
```bash
cd /home/kai/workspace/kais-aigc-platform   # systemd 跑的副本, 与 /data/workspace git 真源同步
git fetch && git merge wt/gpu-sched-hardening   # 或 merge 到 master 后快进; 4 个 feat commit
npm run build:server                             # esbuild → data/serve/app.js (验证日志 "✅ Built")
```

### 1. R2 — 部署清理脚本（可先行，与 restart 解耦）
```bash
sudo cp scripts/gpu-kill-external.sh /usr/local/bin/gpu-kill-external.sh
sudo chmod 755 /usr/local/bin/gpu-kill-external.sh
# 冒烟（--dry-run 只读, 不发任何信号）:
/usr/local/bin/gpu-kill-external.sh 1 24000 --dry-run   # 首行应 SKIP ..., 列出候选/跳过原因
/usr/local/bin/gpu-kill-external.sh 0 100 --dry-run
```
- sudoers：kai 已有免密 sudo（脚本内 `sudo -n kill` 直接可用），无需新增白名单。若日后收紧免密范围，最小行：`kai ALL=(root) NOPASSWD: /usr/bin/kill`。
- 脚本未部署时 KAP 行为：ensureVram 尾部调用报 ERROR log（`ENOENT`）后继续原流程——fail-open，不阻塞。

### 2. R1 — 协调面接电（.env 两行 + restart）
```bash
# /home/kai/workspace/kais-aigc-platform/.env 追加（容器形态注释一并修正为 .env.example 口径）:
REDIS_URL=redis://127.0.0.1:6390
KAP_GPU_QUEUE_CROSSPROC=strict

sudo systemctl restart kais-aigc-platform
```
验证清单：
```bash
journalctl -u kais-aigc-platform --since "-5min" | grep -E "Connected to Redis|Initialized \(backend=redis"
#   期望: "[GpuScheduler] Connected to Redis at redis://127.0.0.1:6390 — cross-process GPU coordination active."
#         "[GpuScheduler] Initialized (backend=redis (redis://127.0.0.1:6390))."
#   且不再出现 "[GpuScheduler] REDIS_URL not set" WARN
curl -s localhost:10588/api/production/llm/status | jq .data.backend   # 期望 "redis" (本批新增字段)
# crossproc strict 为惰性初始化 (首次引擎路由过 GPU 锁时打出, 不是 restart 即现):
journalctl -u kais-aigc-platform | grep "gpuQueue:crossproc"           # 期望 mode=strict backend=redis
# redis 连通性 (宿主映射端口 6390):
docker exec kais-aigc-platform-redis-1 redis-cli ping                  # PONG
```
- 时机：idle 窗口 restart（在跑管线作业会断）。redis 无认证、单实例，strict 档互斥 TTL 40min 兜底进程崩溃残留；redis 不可达时 fail-open 降级 off + ERROR log，业务不停摆。

### 3. R3 — 容器 CDI 割接（独立窗口；compose+env 已就绪，欠的只是重建）
前置检查（**gold-team 无在跑任务**才动手；09-06 02:00 实测 0 holder/0 waiter，动手前复查）：
```bash
curl -s localhost:10588/api/production/gpu-queue | jq '{holders, waiters}'   # 期望 holders 全 null / waiters []
docker ps --format '{{.Names}} {{.Status}}' | grep -E 'gold-team|auxiliary'
grep -E 'KAIS_RENDER_GPU_UUID|KAIS_AUX_GPU_UUID' /home/kai/workspace/kais-aigc-platform/.env   # 117/119 行两 UUID 应在位
```
割接：
```bash
cd /home/kai/workspace/kais-aigc-platform
docker compose -f docker-compose.v9.yml up -d --force-recreate comfyui-auxiliary kais-gold-team
```
验证（对照标准 = comfyui-primary 现网 CDI 形态）：
```bash
docker inspect comfyui-auxiliary --format '{{json .HostConfig.DeviceRequests}}'
#   期望 [{"Driver":"cdi","DeviceIDs":["nvidia.com/gpu=GPU-efe011dd-..."]}]  (割接前实测: Driver:"" DeviceIDs:["0"] legacy)
docker inspect kais-gold-team --format '{{json .HostConfig.DeviceRequests}}'
#   期望 [{"Driver":"cdi","DeviceIDs":["nvidia.com/gpu=GPU-c5cdd49c-..."]}]  (割接前实测: Driver:"nvidia" DeviceIDs:["1"] legacy)
docker ps --format '{{.Names}} {{.Status}}'                     # 两容器 Up (auxiliary 原为 exited(0904) )
curl -s localhost:8189/system_stats >/dev/null && echo AUX_OK   # auxiliary :8189 健康
docker logs comfyui-auxiliary --since 5m 2>&1 | tail             # 无 CDI/GPU 注入报错
```

### R1+R2 合并冒烟（restart 后任选）
- breeze 常驻感知（C3）：`curl -s localhost:5130/health | jq .model_loaded` 为 true 时发一条 breeze 合成，journalctl 应见 `[gpuVramManager] ok breeze_tts: need 2560MiB ...`（增量档）；false 时 `need 8192MiB`（满档）。
- kill-external 接线：平时无感（free 足够零调用）。人工验证只在「注册表驱逐完仍不足」发生时于 journalctl 看到 `gpu-kill-external` 相关 OK/SKIP 行；不建议人工制造该状态。

---

## ③ R4 / M3 边界声明（本批不做，非遗漏）

GPU2 双人格 `PersonaSwitchExecutor` + ComfyUI `/queue` 深度信号 = **已规划的 M3 批次**（见 `docs/gpu-scheduling-architecture.md` M3 待办与 b608c7eb 提交的落地记录）。不入本批的原因：
1. **跨容器生命周期执行器**：persona 切换要驱动 comfyui-secondary 容器拉停（compose 独立文件 `docker-compose.secondary.yml`），属新执行面，需独立设计/测试/割接窗口，与 R1–R5 的「加固既有面」性质不同。
2. **新信号源**：ComfyUI `/queue` 深度信号接入调度决策是新增观测通道（协议、轮询节奏、降级语义都待定），不能与配置修正（R1）/死代码复活（R2）混在一锅出问题难归因。
3. 工单红线 3 明确禁止本批触碰 personaArbiter.ts 与 docker-compose.secondary.yml（未触碰，零 diff）。
M3 工单建议在此基础上叠加：R1 的 strict 协调面与 R2 的清场护栏是其前置依赖，本批已备齐。

---

## ④ R5 残余风险声明

1. **breeze 常驻 → H3 类满卡作业的 TTL 自卸停滞（已可观测，未消除）**：breeze 权重常驻 ~7.2G + ComfyUI 缓存 ~16G 时，H3 作业 ensureVram(18432) 在 /free 驱逐缓存后 free≈16.8G < 18G，vram_retry 空转最长 10min 至 breeze TTL(600s) 自卸才自愈。本批缓解：breeze **自身请求**已按 2560 增量预检（不再假需求 8192 挤占他人判断），且停滞发生时事件环留有 `suspect out-of-registry resident occupancy` 诊断行（§1 C3）可归因。**未消除**：其他引擎撞 breeze 常驻时的 10min 窗口仍在——刻意不选择杀 breeze（有监督服务 + Restart=on-failure 不拦 TERM，杀了服务直接下线，代价大于 10min 停滞）。
2. **通用 resident 登记框架（`registerResidentEngine` + `KAP_VRAM_RESIDENT_AWARE`）留待 M3**：已验证该接口**确无生产调用点**（全仓 grep 仅定义处，R5 事实中的怀疑坐实）。不在本批启用的理由：框架按「可回收常驻贡献」调整 effectiveFree，需要为每个常驻引擎定义驱逐语义与观测口径——这是调度面统一重构（M3 与 persona/queue 信号同批）的决策，单独开启半套框架反而制造第二个事实标准；本批以 breeze 单点探测先例（同 music3 模式）覆盖了实际发生过的故障模式。
3. crossproc strict 的已知语义边界（既有声明，非本批引入）：跨进程互斥安全、不提供全局 FIFO 公平；redis 不可达 fail-open（业务优先）。R1 割接后若 dev tsx 实例与 prod 并存，二者已在同一把 redis 互斥锁下串行。

---

## ⑤ 回滚序列（每步逆操作）

| 步骤 | 回滚操作 | 效果/备注 |
|---|---|---|
| R2 脚本 | `sudo rm /usr/local/bin/gpu-kill-external.sh` | ensureVram 尾部调用 ENOENT → ERROR log 后继续（fail-open）；无需改代码 |
| R1 配置 | 删 .env 两行（`REDIS_URL`、`KAP_GPU_QUEUE_CROSSPROC`）→ `sudo systemctl restart kais-aigc-platform` | 回 memory 单进程 + crossproc off；redis 内残留锁键有 TTL 自清，无脏状态 |
| 代码整体 | `git revert 226987cc 79ba0158 7cc1916b 063310b5`（或 revert 合并 commit）→ `npm run build:server` → restart | 逆序 revert；C1 的 .env.example/compose 注释一并回退无碍（纯文档） |
| R3 容器 | 回退 compose/env 到 0904 CDI 化之前的 revision（`git log -- docker-compose.v9.yml .env` 定位）→ 再次 `docker compose -f docker-compose.v9.yml up -d --force-recreate comfyui-auxiliary kais-gold-team` | force-recreate 已销毁旧容器，无法 docker start 旧体；必须按旧配置重建。注意 auxiliary 割接前本就 exited（回滚=回到已知残缺态，通常无必要——CDI 起不来时优先查 `docker logs` 与 nvidia-container-toolkit CDI 规格而非回滚） |
| C3 观测/增量 | 随代码 revert 整体回退；单独关增量无需回滚（探测失败自动落满档） | fail-closed 设计：/health 不可达 = 满档 = 接线前行为 |

---

*交付物：4 个 feat commit（`063310b5` / `7cc1916b` / `79ba0158` / `226987cc`）+ 本文档 commit，均在 `wt/gpu-sched-hardening` 分支，未 push。*
