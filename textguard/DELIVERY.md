# Text-Guard M1 交付文档 — 生成图中文错字修复守卫 sidecar + KAP 薄路由

> 分支 `wt/text-guard-m1`,基线 `dc794056`(feat/reverse-dag-view @ 0907)。
> 配方真源:`/data/workspace/blind3_arm_0906/ksfix_v3_banner.py`(0906-0907 Ks 修字战役
> 实证修通,Kai 终审 pass)+ `kais-image-edit-ops` SKILL.md「文字修复 v3」节。
> 本批 = M1:配方装成常驻 sidecar(:5120)+ KAP 两薄路由。

## 0. 交付物清单

| 文件 | 形态 | 说明 |
|---|---|---|
| `textguard/server.py` | Python sidecar | /check /fix /health 三端点,单进程串行;`--selftest` mock 引擎自测 |
| `textguard/kap-textguard.service` | systemd unit | **文档性提交,未安装未 enable** |
| `src/routes/production/text-guard/index.ts` | KAP 薄路由 | POST /check + /fix,转发 127.0.0.1:5120 |
| `src/router.ts` | codegen 重生成 | 新增 text-guard 挂载,`@routes-hash` 已更新 |
| `textguard/DELIVERY.md` | 本文档 | — |

运行依赖:hermes venv(`/data/workspace/hermes-agent/.venv/bin/python3`,已装
rapidocr_onnxruntime + PIL 12.2.0);ComfyUI `comfyui-primary` :8188(qwen-edit-2511
四件套,与现役 `src/routes/production/qwen-edit/config.ts` 一致);产物宿主挂载
`/mnt/agents/output/gpu1/`。零新增 npm 依赖(转发用 node 原生 fetch)。

## 1. 路由接线方式说明(codegen 哪条路,及为什么)

**选路:新增路由文件 + 跑仓内重生成入口,零手编 `src/router.ts`。**

侦察结论(0907 实读代码):
- `src/router.ts` 是生成产物,头部 `// @routes-hash <md5>`;生成器 = `src/core.ts`
  的 `generateRouter()`:fast-glob 扫 `src/routes/**/*.ts`,`SKIP_PATTERNS` 排除
  config/_前缀/helpers/测试等非路由文件,文件路径机械映射挂载路径
  (`production/text-guard/index.ts` → `/api/production/text-guard`),排序后写盘。
- **routes 清单的真源 = 文件系统本身**(`src/routes/` 下每个 default-export
  express Router 的 .ts 文件),没有独立清单文件要改。
- 仓内官方执行入口 = `scripts/regen-router.ts`(注释明确:历史手编 router.ts 被
  重跑冲掉是实锤事故成因,该入口保证重生成一致)。

执行:新增 `src/routes/production/text-guard/index.ts`(照 `qwen-edit/index.ts`
先例:文件夹 + index.ts 形态,default-export Router,内部 `POST /check`、
`POST /fix`),然后仓根跑 `npx tsx scripts/regen-router.ts`。纯字面路径无参数,
无需动 `ROUTE_OVERRIDES`。

已验证:重生成后 `git diff src/router.ts` 除新增 1 行 import + 1 行
`app.use("/api/production/text-guard", route71)` 外全是 routeN 变量重编号
(归一化比对确认零其他实质变化);`@routes-hash` 更新为
`69749b61a7d4c5d9026395b534d3bdcb`。dev 模式启动(`NODE_ENV=dev`)时
`src/app.ts` 会自动跑 `buildRoute()`,与本入口同源 —— codegen 感知闭环,
后续任何重生成都不会冲掉本批路由。

未选的另一条路(手编 router.ts 按生成器产出形态补行):在 hash 与清单上撒谎,
下次任何人跑生成入口即回退,是 regen-router.ts 注释里点名的历史事故成因,弃。

## 2. API 契约

### sidecar 直连(:5120)

**GET /health** → `{code:200, data:{ocr:bool, comfyui:bool, port:5120}, message:"ok"}`
(ocr = RapidOCR 已初始化;comfyui = /system_stats 2s 快探;fix 运行中 health 不被队列锁阻塞)

**POST /check** `{image_path, expect?:[{carrier,text}], regions?:[[x0,y0,x1,y1]]}`

```json
{"code":200,"data":{"findings":[
  {"text":"評彈夜話","conf":0.93,"box":[10,10,40,200],"verdict":"ok","carrier":"竖幡"},
  {"text":"許彈夜話","conf":0.64,"box":[60,10,90,200],"verdict":"suspect"},
  {"text":"聽雨軒","conf":0.0,"box":null,"verdict":"missing","carrier":"木匾"}],
 "image_path":"/path/x.png"},"message":"ok"}
```

判定语义:conf<0.85 = suspect(0906 实测:正字 0.92-0.99 / 错字 0.52-0.84);
expect 表在但该条比对不中(归一化整串包含)= suspect;expect 条目全图零命中
(过半字符都读不到)= missing。`regions` 给出时只保留与其相交的 findings。
> 注:归一化去空格标点;簡繁形近(評/评)属"比对不中"→ suspect,调用方可用
> variants 或 vision 复核消化(见边界声明)。

**POST /fix** `{image_path, box:[x0,y0,x1,y1], expect_text, variants?:[...],
carrier_desc?:"...", max_lottery?:4}`(同步,磁盘级长请求)

→ 命中:`{code:200, data:{hit:true, seed, rounds, ocr_final, output_path}}`;
→ **未中:`code:200 + hit:false` + 最优残差(最高字符覆盖率的那一轮产物)——
引擎边界,不是错误,勿按 4xx/5xx 处理**。

流程(抄参考实现逐段):提交前探活+稳定窗(SETTLE_S=45)→ crop 边距
0.5x宽/0.7x高、地板 40px、钳回图内 → docker cp 进容器 input(失败兜底 ComfyUI
`/upload/image`)→ 直连 `:8188/prompt` 提交 qwen-edit-2511 工作流(节点接线与
0904/0907 实测版逐节点一致)→ 轮询 `/history`(5s 间隔,单轮预算 1800s)→
产物宿主挂载直读 `/mnt/agents/output/gpu1/` → 缩放回原尺寸 → inset24 蒙版
GaussianBlur(14) 羽化贴回 → 手术区(±10px)OCR 复验,expect_text 或任一
variant 归一化整串命中 = 首中即停;种子首发 42-45(战役实证),超出随机补。

prompt 模板(抄参考实现句式):点名载体(carrier_desc,缺省 "sign")+ must read
exactly "目标串" + 方向(按 box 纵横比推断竖/横排:from top to bottom / left to
right)+ Do NOT change any other sign, plaque, or banner + keep ... exactly the same。

### KAP 薄路由(:10588)

- `POST /api/production/text-guard/check` body `{image_path, expect?}` → 转发 /check
- `POST /api/production/text-guard/fix` body `{image_path, box, expect_text, variants?, max_lottery?}`

行为:前置参数校验(缺参/box 非四元数值/URL scheme 拒收 → KAP 400 envelope);
sidecar 响应 `{code,data,message}` **原样透传**(HTTP 状态码一并透传,`hit:false`
也透传 200);sidecar 不可达 → 502、转发超时 → 504(KAP error envelope)。
超时预算:check 300s;**fix 1950s(≥1900s 工单要求,覆盖单轮 1800s poll + 探活
+ 贴回)**。sidecar URL 可用 `TEXTGUARD_URL` 覆盖(默认 http://127.0.0.1:5120)。

## 3. operator 割接序列(本批未执行,归 operator)

```bash
# 0) 前置:合并 wt/text-guard-m1 → master,主仓检出合并后 HEAD
cd /data/workspace/kais-aigc-platform

# 1) 三绿自验(基线复跑)
npx tsc --noEmit                                          # TSC_RC=0
python3 -m py_compile textguard/server.py
python3 textguard/server.py --selftest                    # 35/35 全绿

# 2) 安装 systemd unit(文件已在仓内,拷装)
sudo cp textguard/kap-textguard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kap-textguard
systemctl status kap-textguard --no-pager                 # active (running)

# 3) 验证 curl 三连(sidecar 直连 → KAP 透传)
curl -s http://127.0.0.1:5120/health
#   期望 {"code":200,"data":{"ocr":true,"comfyui":true,"port":5120},...}
curl -s -X POST http://127.0.0.1:5120/check \
  -H 'Content-Type: application/json' \
  -d '{"image_path":"<任一现成生成图>","expect":[{"carrier":"横匾","text":"評彈夜話"}]}'
curl -s -X POST http://127.0.0.1:10588/api/production/text-guard/check \
  -H 'Content-Type: application/json' \
  -d '{"image_path":"<同一张图>"}'
#   期望:两条都 code:200;第二条为 KAP 透传的同一 envelope

# 4) 重启 KAP 使新路由生效
sudo systemctl restart kais-aigc-platform
curl -s -X POST http://127.0.0.1:10588/api/production/text-guard/check \
  -H 'Content-Type: application/json' -d '{"image_path":"<图>"}'   # 再验一次透传

# 5) (可选,GPU 空闲窗口)真跑一发 /fix 验彩票链路 —— 会提交 ComfyUI 任务,
#    生产渲染在跑时勿执行;curl 客户端超时记得 ≥1950s
```

## 4. 回滚序列

```bash
# 1) 下线路由+sidecar
sudo systemctl disable --now kap-textguard
sudo rm /etc/systemd/system/kap-textguard.service && sudo systemctl daemon-reload
sudo systemctl restart kais-aigc-platform
# 2) 代码回退(revert 本批 commit,或整分支不合并)
cd /data/workspace/kais-aigc-platform && git revert <本批commit> && sudo systemctl restart kais-aigc-platform
# 3) 残留清理(可选):/tmp/tgfix_*.png 与 *_tgfix.png 产物按需删
```

sidecar 独立进程,KAP 不依赖其存在(不可达时路由报 502,不影响其他 API);
先停 sidecar 再重启 KAP 或反之皆可。

## 5. 验证清单(operator 验收原样复跑)

```bash
cd /data/workspace/kais-aigc-platform        # 合并后主仓(worktree 内跑同理)
npx tsc --noEmit                             # TSC_RC=0(基线 0,0907 复验 0)
python3 -m py_compile textguard/server.py    # 过
node --check src/routes/production/text-guard/index.ts   # 语法级过
python3 textguard/server.py --selftest       # 35/35 全绿(mock 引擎,不碰 GPU)
```

本批留证(0907,worktree 内实测):TSC_RC=0;py_compile 过;node --check 过;
selftest 35/35;HTTP 层真机冒烟 —— sidecar /health ocr:true + comfyui:true、
/check 真 OCR(CPU)读图出 findings/suspect/missing 判定语义符合 v3 纪律、
KAP 薄路由端到端冒烟:200 透传 / sidecar 400 透传 / KAP 层 400(缺 box、拒
URL)/ sidecar 停机 502,五连全过。全程零 ComfyUI /prompt 提交。

## 6. 边界声明

1. **检测/修复只覆盖中文横竖排印刷体 + 可读书法体**。复杂繁体(如「聽」类)
   在 4 步蒸馏下修不动属引擎边界 —— `hit:false` 如实报,**终解 = 上游 Z-Image
   重生成**(0906 定谳:中文文字场景 Z-Image 直出),本守卫不是文字重写器。
2. **OCR 假阴性与簡繁形近**:书法/艺术字 conf 低或漏检(竖排首字易漏)、
   評/评形近混读 → suspect/比对不中 → 这是"待复核"信号,终裁归 vision 结构级
   复核(人工),勿把 suspect 直接当缺陷重修,也勿把 missing 直接当图片坏。
3. **彩票命中判据 = expect_text/variants 归一化整串包含**;宽子串键(如「彈夜」)
   会把許彈夜話误判修通 —— 服务端已收紧,调用方传 expect 时也须含残差判别字。
   OCR 简繁混读形态可作为 variants 传入(如「评彈夜話」)。
4. **SSRF/路径防线**:sidecar 只认本机现存文件路径(拒 URL scheme);
   `TEXTGUARD_ALLOWED_ROOTS` 可收紧到目录白名单(默认空 = 不限,建议 operator
   在 unit 里配置)。KAP 路由层同样前置拒 URL。
5. **并发纪律**:sidecar 单进程全局锁串行 /check 与 /fix(禁并发进 ComfyUI),
   排队请求阻塞等待;/health 免锁。多目标招牌须逐区多次调 /fix(单载体单目标,
   v2 整图双目标 carrier 混淆实锤败绩)。
6. **超时预算**:单轮 poll 1800s + KAP 转发 1950s;多轮彩票最坏情况(每轮都
   排队到顶)会超 KAP 转发超时 —— 客户端拿到 504 时 sidecar 仍在跑并会落盘
   完成产物(server.log 可查),这是预期行为非故障。GPU 繁忙时段建议调小
   `max_lottery` 或错峰。
7. **产物路径**:输出写 `<源图>_tgfix.png`(源目录不可写时落 /tmp 并在日志
   说明);ComfyUI 中间产物读宿主挂载 `/mnt/agents/output/gpu1/`(docker cp
   取不到,0907 实证)。
8. **禁改面**:qwen-edit 既有路由与 ComfyUI 接线本批只读参照,零改动;
   sidecar 为独立 Python 进程,不引 node 运行时。

## 7. 配置项(sidecar 环境变量,unit 内可覆盖)

| 变量 | 默认 | 语义 |
|---|---|---|
| `TEXTGUARD_PORT` | 5120 | 监听端口(0907 实测空闲) |
| `TEXTGUARD_COMFY_URL` | http://127.0.0.1:8188 | ComfyUI 直连地址 |
| `TEXTGUARD_CONTAINER` | comfyui-primary | crop 上传目标容器(docker cp 主路) |
| `TEXTGUARD_OUTPUT_ROOT` | /mnt/agents/output/gpu1 | ComfyUI 产物宿主挂载根 |
| `TEXTGUARD_SETTLE_S` | 45 | 提交前探活稳定窗秒数(0 关闭;每次 /fix 固定开销) |
| `TEXTGUARD_ROUND_TIMEOUT_S` | 1800 | 单轮彩票 poll 预算 |
| `TEXTGUARD_ALLOWED_ROOTS` | (空) | 本机路径白名单,逗号分隔 |

日志:`textguard/server.log`(append,未做轮转,归 operator logrotate 策略)。
