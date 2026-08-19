# GPU 统一调度 · 实施计划

> 2026-08-19 排查产出。驱动事件：ep-ccport-test01 p11a 卡死 5h+（qwen_eye 服务级占位孤儿化 →
> 全引擎 GPU1 排队挂起 → kmc 侧每小时 ReadTimeout 循环，最终靠重启 KAP 解卡）。
> 排查结论：GPU 管理现有三套互不知情的机制（withGpuQueue / GpuScheduler / 绕过路由），
> 九项结构性缺陷 D1–D9（详见本文 §1）。

## 0. 目标与非目标

**目标**：一张 GPU 一把锁、一个账本、一个管理面——所有占用 GPU 的引擎的调度统一收口到 withGpuQueue 体系。

**非目标**：
- 不改 kmc 侧（queue_timeout 以 5xx 返回，kmc video_engine D-09 降级契约天然兼容）
- 不做多机调度（单机双卡）
- 不重构引擎本体（拉起脚本/容器维持现状）

## 1. 缺陷清单（实施项映射）

| # | 缺陷 | 现状位置 | 修复阶段 |
|---|---|---|---|
| D1 | 锁等待无超时（`await acquired` 永不 reject） | `src/lib/gpuVramManager.ts:401` | P1-A |
| D2 | 服务级占用无看门狗（释放只靠下次 allocate 自愈） | `src/routes/production/llm/index.ts:72-95` | P1-B |
| D3 | 等待者与客户端无关联（断连后幽灵等待者照常执行） | gpuVramManager waiters 结构 | P1-A |
| D4 | 队列状态进程私有（dev×2 + prod 三把"全局锁"） | gpuLocks 模块级 Map | P3 |
| D5 | GpuScheduler 停服务不释放占位 | `GpuScheduler.release()` | P1-B |
| D6 | 常驻引擎显存记账错配（requireVramMiB 逐案补丁） | music3/qwen_tts server | P3 |
| D7 | 无管理面（gpu-queue GET-only，手术=重启） | `src/routes/production/gpu-queue/index.ts` | P2 |
| D8 | GPU0 不纳管 | 队列默认 GPU1 | P3 |
| D9 | 注册表与现实脱节（comfyui 注册为 docker，实为裸进程） | `GpuScheduler.getRegisteredServices()` | P3 |
| D10 | 绕过队列的 GPU 路由（同卡撞车） | 见 §P2-A 清单 | P2 |

---

## 2. Phase 1（P0 止血）——队列健壮性

> 今天的事故 = D2（占位孤儿）× D1/D3（等待无限堆积）。任一修复都能把 5h 事故压到 ≤30min；三项齐落 ≤90s 自愈。

### P1-A 等待超时 + 断连取消（D1 + D3）

**改动文件**：`src/lib/gpuVramManager.ts`

1. **waiter 对象化**：
   ```ts
   interface GpuWaiter {
     engine: string;
     enqueuedAt: number;
     resolve: () => void;
     cancel: (reason: "timeout" | "aborted") => void;  // 从 waiters 摘除自己
     signal?: AbortSignal;                             // 客户端断连
   }
   // lock.waiters: Array<GpuWaiter 的 acquire promise 控制>
   ```
2. **锁等待 deadline**：`await acquired` 改 `Promise.race([acquired, timeout])`。
   - env `KAP_GPU_LOCK_WAIT_TIMEOUT_MS`（默认 = KAP_GPU_QUEUE_TIMEOUT_MS = 30min；0 = 禁用）
   - 超时 → 摘除 waiter + `recordEvent("timeout")` + 抛 `QueueTimeoutError`（`kind: "queue_timeout"`，携带 waitedMs/position/holder 信息）
   - ⚠️ 与 vram_retry deadline 的关系：总等待预算 = 锁等待 + vram_retry 共用（取两者之和大纲，避免叠加后超过客户端预算）
3. **AbortSignal 穿透**：`withGpuQueueTimed(engineKey, fn, opts)` 增加 `opts.signal?: AbortSignal`。
   - 仅在**排队阶段**生效；已获锁后 abort 不中断作业（语义选择：已提交的 GPU 作业跑完比丢弃省配额，但响应已无人收——在事件里记 `orphaned_completion`）
   - 13 处既有调用点不传 signal = 行为完全不变（向后兼容）
4. **路由接入**（重型路由优先）：`minimax-h3/generate`、`qwenTts/speak`、`indextts2/speak`、`flux/sceneGenerate`、`music3/generate`：
   ```ts
   const ac = new AbortController();
   req.on("close", () => ac.abort());
   await withGpuQueueTimed(ENGINE, fn, { signal: ac.signal, ... });
   ```

### P1-B 占用看门狗 + 生命周期联动（D2 + D5）

1. **看门狗**（`gpuVramManager.ts`）：
   ```ts
   acquireEngineOccupancy(engineKey, gpuIndex?, opts?: {
     healthUrl?: string;        // 不传 = 不看护
     checkIntervalMs?: number;  // 默认 30_000
     failThreshold?: number;    // 默认 2（连续 2 次失败 ≈ 60-90s 自愈）
   })
   ```
   - 模块级 occupancy registry + 单一 `setInterval` 轮询所有注册了 healthUrl 的占位
   - 达到阈值 → `releaseEngineOccupancy` + `recordEvent("watchdog_release")` + ERROR log
   - **只释放队列占位，不停服务**（服务停止仍归 GpuScheduler 管——职责不越界）
   - env `KAP_GPU_WATCHDOG=0` 可关（灰度开关）
2. **路由接入**：`llm/index.ts` 传 `healthUrl: EYE_HEALTH_URL`（:8125/health）；`ear/index.ts` 传 :8126/health。
3. **GpuScheduler 联动**（D5）：`GpuScheduler` 构造器注入可选 `occupancyReleaser: (serviceId) => void`；`release()` 成功停服务后回调。注册映射 `qwen-llm → qwen_eye`、`qwen-ear → qwen_ear`。idle 超时停服务时占位不再残留。

### P1 验收（`scripts/verify-phase-49-core.ts`，沿用仓库 verify 惯例）

- [ ] A1（今天事故回归）：占位 handoff 后 kill :8125 → 无任何新请求 → 看门狗 ≤90s 释放 → 排队中的 minimax_h3 获锁
- [ ] A2：等待超 deadline → `queue_timeout` 结构化错误；GET gpu-queue 的 waitingByEngine 归零
- [ ] A3：客户端 abort（排队中断开连接）→ waiter 摘除、事件留痕
- [ ] A4：13 处既有调用点零改动可编译（`npm run lint`）且行为不变
- [ ] A5：GpuScheduler.release 停服务后占位同步释放

---

## 3. Phase 2（P1）——绕过者收编 + 管理面

### P2-A 强制过闸（D10）

**收编清单**（`grep -L withGpuQueue` 实证）：

| 路由 | engineKey | 备注 |
|---|---|---|
| `minimax-h3/i2va.ts` `t2va.ts` `ref2va.ts` | minimax_h3 | 直提 ComfyUI，与 /generate 同引擎必须同锁 |
| `flux/flux2Generate.ts` | flux2 | 12GB 级，撞车主力 |
| `flux/kontext-generate/` | flux2 | kontxt 服务（需求实测后修正） |
| `ltx/*`（8 路由） | ltx | kmc 已退役；挂队列防误调用撞卡即可，不投入更多 |

**实现**：新增 `src/middleware/requireGpuSlot.ts`：
```ts
requireGpuSlot(engineKey)  // 包装 handler：排队 + ensureVram + 信号穿透
```
启动时校验（`app.ts` 挂路由处）：重型路由必须声明 engineKey，否则 refuse to boot——杜绝"忘接队列"复发。

`replace-audio` / `trim` / `status` / `config` / `workflows` 为 CPU 路由，豁免清单显式列出。

### P2-B 管理 API（D7）

`src/routes/production/gpu-queue/index.ts` 扩展：
- `POST /force-release` `{gpuIndex?, engine?}` → 强制释放占位/持锁（记 `admin_release` 事件）
- `POST /purge-waiters` `{engine?}` → 清空幽灵等待者
- `GET /` 扩充 waiter 明细：`[{engine, waitedMs, client, position}]`

⚠️ **安全**：服务监听 `*:10588`（全接口），管理端点必须挂 `KAP_ADMIN_TOKEN` Bearer 校验，缺失 token 则 404。

### P2 验收

- [ ] B1：`/generate` 与 `/i2va` 并发 → 日志可见同一把锁串行
- [ ] B2：无 token 调管理端点 404；有 token 可释放今天场景的孤儿占位（不再需要重启）
- [ ] B3：收编路由回归——各跑一次最小生成任务

---

## 4. Phase 3（P2）——架构归一

1. **状态外置 redis（D4）**：StateStore 接口扩展 holders/waiters 原语 + pub/sub 唤醒；dev server 改用独立 gpuIndex 或只读观测。多实例才真正共享一把锁。
2. **两套锁合并（D5 深层）**：GpuScheduler 的 start/stop/evict 只允许发生在 withGpuQueue 持锁内（llm 路由形状推广为唯一形状）；其 store-lock 降级为内部实现细节。
3. **常驻引擎占用语义（D6）**：music3 / qwen_tts server / indextts2 容器迁到 occupancy 模型（拉起占位、idle 释放占位+服务）；`ensureVram` 可回收显存 = free + Σ已注册可驱逐占用。淘汰 requireVramMiB 逐案补丁。
4. **GPU0 纳管（D8）+ 注册表对齐（D9）**：ENGINE_VRAM_REQUIREMENTS 增加 per-engine gpuIndex；comfyui 注册项改为与现实一致的裸进程管理（或容器化）。

---

## 5. 发布 / 回滚 / 兼容

- **发布链**：`npm run build:server`（esbuild → data/serve/app.js）→ `sudo systemctl restart kais-aigc-platform`。**重启即清空队列内存态**——发布窗口选在无在飞 GPU 作业时（查 GET gpu-queue）。
- **灰度开关**：`KAP_GPU_WATCHDOG=0` / `KAP_GPU_LOCK_WAIT_TIMEOUT_MS=0` 可独立关闭新行为。
- **kmc 兼容**：queue_timeout 为 5xx 结构化错误，kmc `video_engine` D-09 降级契约（timeout/5xx → degraded 重试）天然兼容，kmc 零改动。
- **回滚**：git revert + rebuild + restart。

## 6. 工作量与顺序

| 阶段 | 估时 | 依赖 |
|---|---|---|
| Phase 1（P0） | 2–3 天 | 无 —— **先行落地，独立止血** |
| Phase 2（P1） | 2 天 | Phase 1 的 waiter 对象化 |
| Phase 3（P2） | 3–5 天 | Phase 2 的收编 + 管理 API |

## 7. 主要风险

- **waiter 结构改造**触碰所有排队路径 → 既有 13 调用点签名不变，靠 `npm run lint` + verify 脚本兜底；但队列核心目前**零测试覆盖**，P1 需先补 `src/lib/__tests__/gpuVramManager.test.ts`（fake timers 测超时/取消/看门狗）
- **看门狗误杀**（health 抖动）→ failThreshold=2 + 只释放占位不停服务；误杀代价 = 服务下次 allocate 重拉起（分钟级），远小于死锁代价
- **abort 语义分歧**（排队取消 vs 作业中断）→ 只做排队取消，简单且够用
- **redis 阶段复杂度**（P3）→ 独立 phase 单独评审，不阻塞 P1/P2
