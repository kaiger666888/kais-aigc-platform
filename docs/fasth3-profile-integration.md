# FastH3 5 步档集成交付 (profile="fasth3") — 2026-09-09

FastH3 dense 蒸馏 LoRA 正式集成 KAP。可选档 `fasth3`,**不切默认**——默认档仍是
`lightx2v-8-768p`,useCase (`H3_USE_CASES` / `H3_EXPOSED_USE_CASES`) 与动态分档路由
(`H3_PREVIEW_MOTION_ROUTES`) 一律不动。集成模式 = Kai 拍板「将 FastH3 正式集成到
kap」,先例同 vdn-8 (d3eb69e0)。

## 1. A/B 证据 (为什么是它)

0909 Kai 盲测 R2 定谳 (CTL=同,感知标定通过,判读有效),FastH3 dense 5 步 vs 现役
lightx2v-8-768p 9 步,**三动态全胜 6 vs 2**:

| 组 | 动态 | LXV-8 | FastH3 |
|----|------|-------|--------|
| G1_07 | 高动态 | 0 (差) | 2 (良) |
| G2_08 | 极高动态 | 0 (差) | 1 (中) |
| G3_03 | 低动态竖屏 | 2 (良) | 3 (优) |

e2e 提速: G1 1.60× / G2 1.19× / G3 1.48× (纯采样口径 ~1.9×)。
定谳文件: `/home/kai/shared/2026-09-09/ab_fasth3/verdict_r2.json` (六对盲测产物
mp4 同目录;蓝图脚本为 /tmp 临时件未随台账留存,参数面以代码常量 +
`fasth3Profile.test.ts` 逐字断言为准)。

## 2. 参数面 (代码即权威)

- **权重**: `minimax_h3_fasth3_4step_dense_datafree_comfyui.safetensors`
  (1.04G, 653 张量, 52 组 qkv 融合, operator 0909 转换)。宿主
  `/data/models/comfyui/loras/`,comfyui-primary + comfyui-secondary 双容器
  `models/loras/` 均可见——**勿动权重**。
- **链路**: 基座 = 现役 fl2va int8_convrot (同 lightx2v-8-768p 臂),SigmaShift +
  LoRA 原生链 (非 T8、非 VDN)。走 `buildH3WorkflowLightX2V` 泛化拓扑,无新 builder。
  节点链: `12(UNET) → 14_shift(SigmaShift) → 15(LoRA) → 31/33/34 采样`;
  `20` = ref2va 时 `MiniMaxH3ReferenceToVideo(ref_image_size="match")`。
- **采样**: steps=5 (4 步蒸馏 +1 终步 sigma=0,承 lightx2v-4 家族 N+1 惯例) /
  shift_video=6.0, shift_audio=3.0 (768p 家族口径) / euler + simple / denoise 1.0 /
  strength_model 1.0。

## 3. 改动锚点

| 文件 | 位置 | 内容 |
|------|------|------|
| `src/routes/production/minimax-h3/config.ts` | `:390-424` | `H3_FASTH3` 常量块 (权重/采样/节点槽位) |
| 同上 | `:646` | `H3ProfileName` union 追加 `"fasth3"` |
| 同上 | `:747-754` | `H3_PROFILES["fasth3"]` preset (steps=5 / skipFoley / turbo=native=tespeed=false) |
| 同上 | `:861` | `H3_EXPOSED_PROFILES` 追加 `"fasth3"` (白名单,GET /workflows 能力清单自动带出) |
| `src/routes/production/minimax-h3/generate.ts` | `:1231-1235` | `loraShiftConfig` fasth3 分支 → `H3_FASTH3` (elif 链,LoRA 槽位单值天然互斥) |
| 同上 | `:573-576` | `buildH3WorkflowLightX2V` export (为测试直调,同 T8/Native/VDN 先例) |
| `src/routes/production/minimax-h3/t2va.ts` | `:415-421` | per-mode fasth3 400 拒绝 |
| `src/routes/production/minimax-h3/i2va.ts` | `:448-454` | 同上 |
| `src/routes/production/minimax-h3/ref2va.ts` | `:561-567` | 同上 |
| `src/routes/production/minimax-h3/__tests__/fasth3Profile.test.ts` | 新增 | 55 断言 (配置/构图/e2e) |
| `src/routes/production/minimax-h3/__tests__/h3Cleanup.test.ts` | `:95-103` | 白名单精确断言同步 +fasth3 (仅断言,无行为) |
| `scripts/verify-h3-fasth3.ts` | 新增 | 测试 runner (同 verify-h3-vdn.ts 模式) |

## 4. 语义与边界

- **仅 `/generate` 主路由支持** `profile=fasth3`。per-mode 直调端点
  (t2va/i2va/ref2va) 收到 fasth3 → 400 指引改走 `/generate`——这些端点的 builder
  不消费 `H3_FASTH3`,放行会静默降级 T8 (d3eb69e0 语义守卫,r1 工单"per-mode
  自动可用"论断已被实探证伪,故守卫为必要自纠偏)。
- 显式 `steps` 入参优先于 profile 档位 (5 步可被覆盖);`turbo`/`native` 与 fasth3
  走既有优先级链,LoRA 槽位单值天然互斥。
- 无 vdn-8 式 length 硬边界 (走全局 1216×672 / 362f 家族边界对齐逻辑)。

## 5. 验证 (operator 验收可独立复跑)

```bash
cd /data/workspace/kais-aigc-platform-wt/fasth3   # 或割接后的主仓
npx tsc --noEmit                                    # RC=0
npx tsx --test "src/routes/production/minimax-h3/__tests__/"*.test.ts   # 全绿
npx tsx scripts/verify-h3-fasth3.ts                 # 55/55 (e2e 走 stub 回环, 无真实渲染)
npx tsx scripts/verify-h3-vdn.ts                    # 56/56 回归 (共存不劫持)
```

## 6. operator 割接序列 (本工单司机禁碰,归 operator)

```bash
# 1. 构建 (worktree 分支 wt/fasth3-profile 已合入主仓后, 于主仓执行)
npm run build
# 2. 重启服务
sudo systemctl restart kais-aigc-platform
# 3. 验 PID 换新 (新起进程, 非旧进程残留)
ss -tlnp | grep 10588
# 4. 验能力清单含 fasth3 (H3_EXPOSED_PROFILES 自动带出)
curl -s http://127.0.0.1:10588/api/production/minimax-h3/workflows | grep -o fasth3
# 5. 真渲染冒烟: profile=fasth3 5s 短链 (t2va, 1216×672, 小 length),
#    确认产物 mp4 出片 + audioMode=native (skipFoley); 对照第 2 节参数面抽查
#    ComfyUI prompt 图 (节点 15 lora_name / 14_shift 6,3 / euler+simple+5 步)
```

## 7. 回滚

单 commit 交付,`git revert <commit>` 一键回滚 (含测试与文档,无残余);
权重文件与本集成解耦,无需动 `/data/models/comfyui/loras/`。
