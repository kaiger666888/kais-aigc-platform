# KAP 双卡调度架构：优先级打断 + GPU2 双人格溢出

> 状态：✅ M1+M2 已实施并上生产（2026-09-06，merge `a6b57184`，独立复验 tsc=0 + gpu 域 70/70 全绿）。
> 生产端点：`GET /api/production/gpu/scheduling`、`GET|POST /api/production/gpu/persona`。
> 待办：M3 队列对接（ComfyUI 深度真信号、KMC 镜头边界回调、evicted 重入队、PersonaSwitchExecutor）；`docker-compose.secondary.yml` 已交付未起容器（人格 B 首次启用时 operator 割接）。
> 作者：Hermes（架构决策）→ GLM 老司机实施。

## 0. 目标与已拍板决策

双 3090（GPU1=RENDER_GEN1，GPU2=QC_GEN2）平时都跑生产；Kai 的开发任务高优先级，可打断生产用卡。三个拍板：

1. **打断语义**：默认 T1（边界让卡），`--force` 才 T2（硬杀）
2. **开发占用 TTL**：2h 自动归还，可续期
3. **双人格渲染溢出**：做，仲裁自动跟随负载，不手动切

## 1. 现状底座（全部已验证在位）

| 组件 | 现状 | 本批角色 |
|---|---|---|
| `GpuScheduler`（`src/services/gpu/GpuScheduler.ts`） | per-GPU 锁（`LOCK_TTL_MS` 5min）、`ensureVram(profile.priority)` 驱逐、空闲自动释放、`releaseAllOnGpu` | 扩展：优先级类 / T0T1T2 / dev-TTL |
| `gpuRoles.ts` | 三角色 UUID 解析链（RENDER_GEN1/QC_GEN2/AUX_LIGHT），调度面 devices=3 | 不动 |
| bash 侧 kap-llm/kap-ear | 角色链已验证落卡（0905/0906 冒烟） | 本批不动 |
| ComfyUI 容器 | primary @GPU1 :8188（CDI 锚定）；auxiliary @GPU0 轻任务 | 新增 secondary 定义 @GPU2 |

**核心空档**：调度只有 `profile.priority` 单维（VRAM 驱逐用），没有「调用方声明的任务优先级」维度；无 drain/边界让卡语义；无 dev 占用 TTL；GPU2 静态角色无溢出能力。

## 2. 设计

### 2.1 优先级模型（调用方声明，不改 profile）

```
PriorityClass:
  dev-P0   Kai 交互式开发验证（唯一可 --force）
  dev-P1   Kai 后台开发任务
  prod-P2  管线在飞链路（KMC 当前 episode）
  prod-P3  批量后台生产（gold-remount 批量、训练）— 默认值
```

`AllocationRequest` 增加字段：`priorityClass?: PriorityClass`（默认 `prod-P3`）、`force?: boolean`（默认 false，仅 dev-P0 合法）、`ttlMin?: number`（仅 dev 类，默认 120）。

### 2.2 打断语义 T0/T1/T2（dev 任务到达、目标卡被 prod 占用时）

| 级 | 动作 | 触发 |
|---|---|---|
| **T0 停派发** | 该卡立即拒绝新的 prod allocate（排队或指往另一卡），在跑任务不受影响 | dev allocate 到达即生效，零成本 |
| **T1 边界让卡**（默认） | 在跑 prod 任务收到让卡信号，在最近安全边界（镜头/请求边界）收尾让卡；上限 15min，超时自动升 T2 | dev 无 force |
| **T2 硬杀** | `ensureVram` 直接驱逐（现机制）；被杀 prod-P3 任务**自动重新入队**（不丢弃） | 仅 dev-P0 + force=true |

**prod 侧契约**：prod 长任务必须按「可中断单元」提交（KMC 渲染单元=物理切镜，天然满足）；GPU 队列消费者在每个单元边界检查卡的 preempt 状态，处于 T1 让卡态则不再提交下一单元。

### 2.3 开发占用 TTL

- dev 类 allocate 默认 TTL=2h，可 `ttlMin` 声明（上限 480min）
- 到期：事件通知 + 卡自动归还 prod 队列 + dev 服务走既有 idle-release 停服
- 交互式 dev-P0 可调 API 续期（重置 TTL 计时）

### 2.4 GPU2 双人格仲裁（Persona Arbiter）

| 人格 | 内容 | 承载 |
|---|---|---|
| **A：QC 驻留**（现状） | qwen-ear/qwen-llm/qwen-vllm/music3 常驻 | 音频/判定/LLM |
| **B：渲染溢出** | QC 服务全停，`comfyui-secondary` 满配容器 @GPU2 :8190 | 与 GPU1 并行消化渲染队列 |

**切换条件**：
- A→B：渲染队列深度 >2（或 P11 phase 活跃信号）∧ QC 服务零排队零活跃
- B→A：QC 任务到达（B 侧当前镜头完成边界让卡，T1 语义）∨ 渲染队列空闲 5min

**实现约束**：
- 切换只在任务边界执行；A 侧切 B = scheduler 逐个 stop QC 服务（释放 21.9GB）→ 起 secondary 容器
- 切换窗口内新渲染任务只进 GPU1；B 期间 QC allocate 走 T1 等待（≤15min）
- 人格状态持久化（Redis store 已有跨进程基座），KAP 重启恢复正确人格
- secondary 容器：CDI 锚 `KAIS_QC_GPU_UUID`（默认 QC_GEN2 UUID），复用 primary 挂载拓扑，端口 :8190，`docker-compose.secondary.yml` 独立文件

### 2.5 可观测 API

- `GET /api/production/gpu/scheduling`：per-GPU 队列深度/在跑/优先级分布/dev 占用 TTL 剩余
- `GET|POST /api/production/gpu/persona`：GPU2 当前人格、切换历史；POST 手动切换（dev-P0 语义）
- dev preempt 事件：谁让的卡、等待时长、被杀重排队列深度

## 3. 实施分期

- **M1（本批）**：优先级模型 + T0/T1/T2 + dev-TTL + scheduling API + 单测
- **M2（本批）**：Persona Arbiter 状态机 + `docker-compose.secondary.yml` + persona API + 单测（仲裁逻辑 mock 测试；容器实起归 operator 割接）
- **M3（后续批）**：队列消费者对接（ComfyUI `/queue` 深度信号进 scheduler、KMC 渲染单元边界回调）

## 4. 红线

1. 无 dev/preempt 流量时现网行为**逐位兼容**（默认参数 = 今日行为）
2. `npx tsc --noEmit` 零新增错误；`node --import tsx --test src/services/gpu/__tests__/` 全绿（存量+新增）
3. `/opt` bash 脚本、systemd、风扇 daemon 本批零接触
4. secondary 容器只交付 compose 定义，**不起容器**（operator 割接）
