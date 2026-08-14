# H3 Token 预算 — KMC↔KAP 协作方案

> 2026-08-14。基于 RTX 3090 (24GB) 三轮 9 次压力测试
> (comfy_kitchen 0.2.31 + CUDA INT8 convrot 后端 + SageAttention + Turbo 4 步 LoRA,
> REF2VA 3 参考图, Case 08 高动态追逐 prompt)。
>
> 核心规律:**崩溃由 token 总数(宽×高×帧数)决定,不是单帧分辨率**。
> KAP 侧已落地校验(`config.ts` 的 `checkH3TokenBudget` + `generate.ts` 的 400 拒绝/warn 日志)。

## 1. 实测边界数据(权威数据源)

| 配置 | tokens (w×h×f) | 结果 | VRAM 峰值 | 耗时 |
|------|------|------|----------|------|
| 1600×896 × 124f (5.2s) | 177,766,400 | ✅ | 22.3GB | 441s |
| 1472×832 × 124f (5.2s) | 151,863,296 | ✅ | 21.5GB | 313s |
| 1472×832 × 175f (7.3s) | 214,323,200 | ✅ | 22.7GB | 498s |
| 1344×768 × 175f (7.3s) | 180,633,600 | ✅ | 22.3GB | 370s |
| 1344×768 × 243f (10.1s) | 250,822,656 | ✅ | 22.6GB | 514s |
| 1344×768 × 311f (13.0s) | 321,011,712 | ✅ | 22.1GB | 786s |
| 1280×704 × 362f (15.1s) | 326,205,440 | ✅ | 23.1GB | 838s |
| 1216×672 × 362f (15.1s) | 295,809,024 | ✅ | 21.2GB | 625s |
| **1344×768 × 362f (15.1s)** | **373,653,504** | **❌ 崩溃** | — | — |

- **崩溃线 ≈ 374M tokens**(CUDA 和 triton 两个 kitchen 后端都崩,illegal memory access @ Model Initializing 阶段,进程 C++ abort)
- **安全线 = 300M tokens**(生产建议)
- 崩溃与"是否 OOM"无关(VRAM 23GB 没满也崩),是 comfy_kitchen 量化算子在高 token 数下的越界 bug
- 硬约束(与 token 预算叠加):帧数须满足 `n%17==5`;宽高须 ÷32

## 2. KMC 侧选型决策表

按镜头时长选配置(16:9 横屏 / 9:16 竖屏同面积,token 数一致):

| 镜头时长 | 推荐配置 | tokens | 级别 | 备注 |
|---------|---------|--------|------|------|
| ≤5s (≤124f) | **1600×896** 或 1344×768 | ≤178M | ok | 短镜头可吃最高清晰度纪录 |
| 5~10s (≤243f) | **1344×768** | ≤251M | ok | |
| 10~13s (≤311f) | **1344×768** | ≤321M | warn | 321M 实测可过,接近崩溃线 |
| 14~15s (362f) | **1280×704** 或 1216×672 | ≤326M | warn | 满 15s 的最高可用分辨率 = 1280×704 |
| 任何配置 tokens > 340M | — | — | reject | **必须拆段(Motion Context 链式续接)或降分辨率** |

竖屏(9:16 = 768×1344)与横屏 token 数完全相同——768×1344×362f 同样是 373M,**同样会被拒**。竖屏满 15s 用 704×1280。

### 帧数对齐速查(n%17==5)

101 (4.2s) / 124 (5.2s) / 141 (5.9s) / 158 / 175 (7.3s) / 192 / 209 / 226 / 243 (10.1s) / 260 / 277 / 294 / 311 (13.0s) / 328 / 345 / 362 (15.1s)

### 分辨率 × 时长 token 矩阵(ok/warn/reject)

| 分辨率 | 4s/101f | 5s/124f | 8s/175f | 10s/229f | 12s/292f | 15s/362f |
|--------|---------|---------|---------|----------|----------|----------|
| 1600×896 | 145M ok | 178M ok | 251M ok | 328M **warn** | 418M **REJECT** | 519M **REJECT** |
| 1472×832 | 124M ok | 152M ok | 214M ok | 281M ok | 357M **REJECT** | 443M **REJECT** |
| 1344×768 (768×1344) | 104M ok | 128M ok | 181M ok | 236M ok | 301M **warn** | 374M **REJECT** |
| 1280×704 | 91M ok | 112M ok | 158M ok | 206M ok | 263M ok | 326M **warn** |
| 1216×672 | 83M ok | 101M ok | 143M ok | 187M ok | 238M ok | 296M ok |
| 1024×768 (4:3/3:4) | 79M ok | 98M ok | 138M ok | 180M ok | 230M ok | 285M ok |
| 1344×576 (21:9) | 78M ok | 96M ok | 135M ok | 177M ok | 226M ok | 280M ok |
| 768×768 (1:1) | 60M ok | 73M ok | 103M ok | 135M ok | 172M ok | 214M ok |

> KMC 现行调用(`h3_batch_render_v2.py`)固定 768×1344 竖屏 + 按镜头时长算帧。
> duration_sec ≤ 10s 都在 ok 区;若有 13~15s 镜头,768×1344 会踩 REJECT——须降为 704×1280 或拆段。

## 3. KAP 侧防护职责(已落地)

- **token 校验**:`generate.ts` 在解析 width/height/length 之后、提交 ComfyUI 之前调用 `checkH3TokenBudget()`
  - `level=reject` (>340M) → 直接返回 **400**,带 `tokenBudget` 详情(tokens / 安全线 / 崩溃线 / 请求配置 / **suggestion 建议配置**)
  - `level=warn` (300M~340M) → `console.warn` 日志,**放行**(1280×704×362f=326M 实测可过,不误杀)
- **未来可考虑 autoCap**(本次未实现):加 opt-in 参数(如 `autoCap=true`),超线时自动降帧/降分辨率到安全线内再提交,而不是 400。建议等 KMC 侧重试协议稳定后再评估——400+suggestion 已够 KMC 自动降档。

## 4. useCase 档位审计

`H3_USE_CASES` 各档位**均未内置 width/height/length**,尺寸/时长全部继承 API 默认值
(1344×768 × 124f = **128M, ok**)或由调用方显式传入。因此:

| useCase | profile | 默认尺寸×时长 | tokens | 审计结果 |
|---------|---------|--------------|--------|---------|
| preview-lock | turbo | 1344×768×124f | 128M | ✅ ok(不传尺寸时) |
| final-shot | native | 1344×768×124f | 128M | ✅ ok |
| broll | production | 1344×768×124f | 128M | ✅ ok |
| keyframe-interp | production | 1344×768×124f | 128M | ✅ ok |
| portrait-dialogue | production | 1344×768×124f | 128M | ⚠️ 名为"竖屏"但默认 16:9;KMC 传 768×1344 时 token 数相同,≤10s ok |
| motion-board | lightx2v-4 | 1344×768×124f | 128M | ✅ ok |
| lineart-color | lineart-anime | 1344×768×124f | 128M | ✅ ok |

**结论:无任何档位默认超预算**。风险全部来自调用方显式传大尺寸×长时长组合,
而这已被 `checkH3TokenBudget` 的 400 防线兜住。可选后续增强(未做):
为 `portrait-dialogue` 档内置 768×1344 竖屏默认尺寸(行为变更,需单独评审)。

## 5. 错误响应协议 — KMC 自动降档重试建议

KMC 收到 400 token 超限时的响应结构:

```json
{
  "code": 400,
  "error": "token budget 373,653,504 exceeds crash line 340M — 实测 374M (1344×768×362f) 双后端崩溃 (illegal memory access)。满 15s 请用 ≤1280×704",
  "tokenBudget": {
    "tokens": 373653504,
    "level": "reject",
    "safeLine": 300000000,
    "crashLine": 340000000,
    "requested": { "width": 1344, "height": 768, "length": 362 },
    "suggestion": {
      "width": 1280, "height": 704, "length": 362,
      "note": "满时长请降分辨率 (1280×704×362f=326M 实测可过)"
    }
  }
}
```

建议重试流程(KMC 侧伪码):

```python
resp = post_generate(w, h, length, ...)
if resp.status_code == 400 and "tokenBudget" in body:
    sug = body["tokenBudget"]["suggestion"]
    # 首选: 直接采纳 KAP suggestion (已按请求时长给出保真度最高的合法配置)
    resp = post_generate(sug["width"], sug["height"], sug["length"], ...)
    if resp.status_code == 400:  # 仍超(理论上不会): 逐级降档
        for w2, h2 in [(1280, 704), (1216, 672), (1024, 576)]:
            if w2 * h2 * length <= 300_000_000:  # 安全线内
                resp = post_generate(w2, h2, length, ...); break
        else:
            # 时长本身过长: 拆段 (Motion Context 链式续接) —
            # L + (L−ctx)×(N−1) 帧数公式, 每段独立满足 token 预算
            split_into_segments(...)
```

要点:

1. **首选采纳 `tokenBudget.suggestion`** —— KAP 已按"请求时长优先保时长、降分辨率"策略生成建议;
2. 兜底逐级降档到 **安全线 300M 内**(而非崩溃线 340M),给量化算子的越界 bug 留余量;
3. 分辨率降到 1216×672 仍超 → 说明时长本身超限,唯一出路是 **Motion Context 链式拆段**
   (帧数公式 `L+(L−ctx)×(N−1)`,ctx 默认 22;链式必须直出 H3 原生音频 skipFoley,见
   `h3_motion_context_kap_integration_plan.md`);
4. `warn` 级(300M~340M)不会 400,KMC 无需处理;若想规避 warn 区,在 KMC 侧预检
   `w*h*f ≤ 300M` 再提交即可。

## 6. 相关代码位置

- `src/routes/production/minimax-h3/config.ts` — `H3_TOKEN_BUDGET_SAFE` / `H3_TOKEN_BUDGET_CRASH` / `H3_TOKEN_FRONTIER` / `checkH3TokenBudget()`
- `src/routes/production/minimax-h3/generate.ts` — 入参校验接入(reject→400 + suggestion,warn→console.warn 放行)
- KMC 调用样例 — `kais-hermes-skills/skills/kais-movie-pipeline/episodes/ep-shencongshenyuan-ep01/assets/P11/h3_batch_render_v2.py`
