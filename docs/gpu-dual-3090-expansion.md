# 双 3090 扩展 — KAP 工作模式设计与位点审计

> 2026-09-01。目标：**3060 Ti 保留**，新增第二张 RTX 3090，拓扑扩为
> GPU0 3060Ti(8G) + GPU1 3090(24G) + GPU2 3090(24G)。
> 核心承诺：**今天全部改动对现网零影响（无感），新卡插上后跑一个 setup 脚本即生效。**

## 0. 核心风险：PCIe 枚举漂移（为什么不能假设新卡=GPU2）

现网物理槽位：3060Ti @ `05:00.0`，3090#1 @ `0c:00.0`。
新卡插在总线号介于两者之间的槽位时，**新卡会枚举成 index 1，老 3090 退到 index 2**。
所有按裸索引绑定的位点（`gpuId: 1`、`--gpus device=1`、`CUDA_VISIBLE_DEVICES=1`、`-i 1`）
在那一刻全部指向新卡 —— 大模型撞 8G 卡 OOM、渲染落到空卡、互斥调度全错位。

**防漂移铁律：一律用 UUID 锚定，索引只在运行时解析。**
老 3090 UUID = `GPU-c5cdd49c-5a18-7d0b-2af5-1d2f642538c6`（现网 kap-llm.sh/kap-ear.sh 已用，保留）。
新卡 UUID 插卡日未知 → 占位 `TBD`，由发现规则兜底（见 §2）。

## 1. 目标工作模式（角色模型）

| 角色 | 卡 | 职责 | 服务（Phase A） |
|---|---|---|---|
| `RENDER_GEN1` | 3090 #1（老，UUID c5cdd49c） | 100% 渲染 | comfyui-primary :8188（H3/FLUX/Wan）、kais-gold-team :8002、qwen_tts/indextts2（容器内） |
| `QC_GEN2` | 3090 #2（新） | 判定+音频+LLM 专属 | qwen-ear :8126、qwen-llm/qwen-eye :8125、qwen-vllm :18020、music3、sa3/ace |
| `AUX_LIGHT` | 3060 Ti（保留） | 轻任务 | comfyui-auxiliary :8189、chatterbox、轻 BGM |

Phase A 的结构性收益：**渲染卡与判定/音频卡物理隔离**——
- 消灭 p10c qwen-ear ↔ P11b 渲染的跷跷板（kmc-single-gpu-engine-phase-handoff 的主场景）
- qwen-eye QC / vLLM 不再需要 `qwen38 stop` 给渲染让位；p11b VRAM 竞争崩溃（OOM→502）根除
- kap-llm/kap-ear 的 NEED_MB 窗口等待基本即时满足（QC 卡空闲）

已知残留（记录不解决）：QC 卡内部 ear(21.5G)/eye(20.5G)/vllm(17.5G)/music3(22.5G) 仍两两互斥，
由 GpuScheduler ensureVram 同卡驱逐语义管理（与今天 GPU1 内部行为相同，只是不再被渲染脉冲打断）。

**Phase B（可选项，未排期）**：第二渲染卡（comfyui-secondary :8190 + P11b 批量分流，渲染吞吐 2×）。
角色配置层就绪后，Phase B 只是新增 service profile + 路由，不需要动本设计。

## 2. UUID 解析链（唯一真源 /opt/kais-gpu/gpu.conf）

```
env 覆盖 (KAIS_GPU_<ROLE>_UUID)  →  gpu.conf 角色→UUID  →  发现兜底  →  硬编码现网值
```

- **发现兜底**（新卡 UUID 未知/TBD 时）：`nvidia-smi --query-gpu=index,uuid,name,memory.total`
  中找「name 含 3090 ∧ totalMb≥23000 ∧ uuid≠RENDER_GEN1_UUID」的那张 = QC_GEN2。
  该规则对索引漂移免疫（只按属性+排除法识别）。
- **服务→角色映射** 也在 gpu.conf（`qwen-ear=QC_GEN2` 等）。插卡日的角色切换 = 改 conf + 重启，
  **不需要重新部署 KAP 代码**。conf 缺失时 TS/bash 侧硬编码默认 = 今日拓扑（零行为变化）。
- 索引永远运行时解析：`gpu_index_for <role>`（bash）/ `resolveGpuIndex()`（TS），不落盘不缓存跨重启。

## 3. 位点审计（GPU 绑定全量清单）

| # | 位点 | 现状 | 处置 |
|---|---|---|---|
| 1 | `kais-aigc-platform/src/services/gpu/GpuScheduler.ts` — GPU_DEVICES(181-182)、8 个 profile 的 `gpuId`、SERVICE_TO_QUEUE_ENGINE gpuIndex | 硬编码 0/1 | 老司机批：角色化解析 + UUID 字段 + env 覆盖（默认=现状） |
| 2 | `src/lib/gpuVramManager.ts` — ENGINE_GPU_INDEX 全表=1、KAP_VRAM_GPU_INDEX env | 硬编码 1 | 同上批：经 gpuRoles 解析 |
| 3 | `/opt/qwen-llm/kap-llm.sh` — CUDA UUID(88)、vllm `--gpus device=1`(112)、VRAM 轮询 `-i 1`(82,108,190) | UUID+索引混合 | Hermes 直改：source gpu.conf，UUID 由 conf 提供，`-i` 用解析后的索引 |
| 4 | `/opt/qwen-ear/kap-ear.sh` — CUDA UUID(43)、`-i 1`(38,98) | 同上 | 同上 |
| 5 | `docker-compose.v9.yml` — comfyui-primary device_ids["1"]+NVIDIA_VISIBLE_DEVICES "1"、kais-gold-team device_ids["1"](267) | 硬编码索引 | 老司机批：参数化为 `${VAR:-1}`，.env 写入解析值；compose 的 `--gpus` 亦支持 UUID，但参数化索引由 setup 脚本写 .env 兜底即可 |
| 6 | `/data/workspace/qwen38-service/qwen38.sh` — GPU_ID env 默认 1 | 索引 | 保留（有 env 覆盖）；setup 脚本在 .env 写 GPU_ID=解析值 |
| 7 | `kais-gold-team/scripts/tts_manager.py` — CUDA_VISIBLE_DEVICES "0"/"1" | 索引 | 记录不改编（gold-team 已收编进 KAP，直跑路径退役中）；setup 脚本验证项 |
| 8 | `gpu-kill-external.sh`（GpuScheduler 驱逐兜底） | 按 gpuId 参数 | 无需改（接收解析后索引） |

## 4. 插卡日 Runbook（dual-3090-setup.sh 自动化）

前置检查（脚本内置）：无活跃管线 run（kais-movie-center run.log 静默）、:10588 健康。
1. 预检：`nvidia-smi` 见 3 卡；识别新卡（3090 ∧ ≠RENDER_GEN1 UUID），回填 `QC_GEN2_UUID`
2. 角色切换：conf 服务映射 sed 翻转（qwen-llm/qwen-ear/qwen-vllm/music3 → QC_GEN2），逐行 diff 打印
3. compose 参数回填：解析 RENDER_GEN1 当前索引写 .env（防漂移下的 compose 正确性）
4. 重启 KAP（systemd，重启窗口纪律照旧）→ 等健康
5. 验收：跑 verify-dual-3090.sh（§5）
6. **页缓存预热**（老坑保留）：`cat /mnt/storage/models/Qwen3-Omni-30B-A3B-GGUF/*.gguf > /dev/null` 后台跑
回滚：conf 还原（setup 脚本自动备份）+ 重启 KAP，秒级，无数据风险。

## 5. 验收清单（verify-dual-3090.sh）

- [ ] 3 卡在位，角色解析表 role→UUID→index 全部命中预期
- [ ] kap-llm.sh resolve / kap-ear.sh resolve 输出 QC_GEN2 索引（新卡）
- [ ] comfyui-primary 容器进程仍在 RENDER_GEN1（compute-apps cgroup 归属核对）
- [ ] :10588 /api/production/llm/status `devices` 返回 3 卡、locks 结构含 GPU2
- [ ] 功能冒烟：qwen-ear start → 进程落在 QC 卡（nvidia-smi 核对）→ stop 还卡（按需纪律）
- [ ] 渲染回归：:8188 system_stats 200（渲染卡未受扰动）

## 6. 风险与边界

- **不迁移**：3060Ti 角色与全部现役服务端口不变；Phase A 前现网行为逐位相等（conf 默认=现状）。
- 新卡驱动/供电/散热问题属于硬件验收，setup 脚本预检会拦截（带宽/温度只读检查，不做压测——压测另排）。
- GLM 老司机批只做 KAP 代码与 compose 参数化；/opt 脚本与 conf 由 Hermes 维护（职责边界与历史一致）。
