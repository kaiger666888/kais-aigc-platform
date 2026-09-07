# Text-Guard PATROL 设计与交付说明（detect-only 存量巡检）

对 KAP OSS 存量 episode 的 P07 场景图 + P04 turnaround 批量调 text-guard sidecar
`/check`，产出缺陷清单（谁修、修什么字）供 operator 定修复队列。

**只读巡检**：只调 `/health` + `/check`，禁调 `/fix`、不改 OSS 任何文件、不写 KAP DB、
不动 systemd / 服务。`patrol_out/` 留 untracked 不入库。

## 1. 数据流

```
os.walk 扫描 (178* episode, p07/p04 子树, 文件深度 ≤5)
  → 串行逐图 POST /check {"image_path": <绝对路径>}   (no-expect 模式)
    → patrol_out/patrol_results.jsonl                 (每图一行, append-only, 断点状态)
      → scripts/textguard_patrol_report.py
          → patrol_out/patrol_report.md               (概览 / Suspect Top20 / 全明细 / error 明细)
          → patrol_out/fix_queue.csv                  (仅 suspect, /fix 队列直接输入)
```

- 巡检脚本结束时自动触发一次汇总（复用汇总脚本的 `build_report`，单一实现）。
- 汇总可对已有 jsonl 单独重跑，不必重巡：
  `python3 scripts/textguard_patrol_report.py --jsonl patrol_out/patrol_results.jsonl`

## 2. 扫描口径

- 只取顶层目录名匹配 `^178\d+$` 的 episode；只收路径含 `p07/` 或 `p04/` 组件的 `.png`。
- **文件深度 ≤5**（相对 OSS 根）。工单字面 `-maxdepth 4` 实扫 334 张，会漏
  `1785508691757/p04/turnaround_sheets/batch2|batch3/`（第 5 层）共 51 张；按工单
  自己的盘点（132+178 / 35 / 40 = **385 张**）口径取深度 5。运行时实扫对账
  （与 `find -maxdepth 5` 逐张比对零差异，0.06s）：

  | episode | p07 | p04 | 小计 |
  | --- | --- | --- | --- |
  | 1785508691757（主力集） | 132 | 178 | 310 |
  | 1785119845700 | 3 | 32 | 35 |
  | 1783182686959 | 40 | 0 | 40 |
  | **合计** | | | **385** |

- 非目录清单不写死：每次运行实扫，新落盘的 p07/p04 产物自动进入候选。

## 3. 断点续跑语义

- 结果文件 `patrol_out/patrol_results.jsonl` 是唯一断点状态：append-only，每图一行
  （成功行含 `image_path / elapsed_s / findings_count / suspect_count / top_suspects /
  suspects / checked_at`；失败行含 `status:"error" / error / attempts`）。
- 启动时读已有 jsonl：**仅 `status:"ok"` 的行算已巡**，`error` 行不算（下次运行自动补跑）。
  jsonl 行损坏/空行跳过，不影响其余加载。
- 同图多行（error 被后续 ok 补跑覆盖、冒烟重跑）：汇总**取最后一次出现为准**。
- 冒烟模式（`--smoke N`）**忽略断点**，每次真打 N 张（自证端到端）；结果同样落 jsonl。

## 4. 锁等待与超时预算

sidecar `/check` 与 `/fix` 共享一把进程内串行锁（`ThreadingHTTPServer`：请求先被
accept、再在锁上排队——operator 跑 `/fix`（单轮可达 1800s）期间巡检请求在排队，
不是死锁）；`/health` 免锁可探。预算：

| 项 | 值 | 行为 |
| --- | --- | --- |
| 单图 /check 客户端超时 | 120s | 含锁排队等待；排队超时先到即本次失败 |
| 失败重试 | 1 次 | 重试前静默 5s 防热循环 |
| 重试前 health 门 | — | 失败后先探 `/health`：ocr=false 或不可达 → 进等待循环，恢复后再补这次重试（避免把整段 run 打成 error 行）；health 正常说明是锁占用/超时，直接重试 |
| ocr=false / 不可达等待 | 每 60s 轮询，单次上限 30min | 超限**中止留断点**（exit 3），重跑自动续 |
| 全量时长预期 | ~0.4s/图（实测 66 图 24s） | 纯 OCR CPU 推理，不占卡 |

失败终局（重试仍败）→ 记 `{"status":"error","error":...}` 行**继续下一张**，不中断整轮。

## 5. 产物判读与 fix_queue

- no-expect 模式下 findings = 图上实际读到的全部文字块；`verdict ∈ ok|suspect`
  （`conf < 0.85 = suspect`，阈值 sidecar 定，巡检不改、如实记录）。无 expect 表
  不会出现 `missing`。
- **自动判读只按 conf 分层**：`ok` 但语义可疑（招牌乱码组合等）不在自动巡检范围，
  归人工 / vision 批。已知 OCR 竖排书法有假阴性盲区（sidecar `ocr_blind` 旗标
  针对 /fix 比对场景，/check 无 expect 不涉及）——巡检结果对「漏检」不可见，
  复核时应知悉。
- `fix_queue.csv`：`image_path,box,text,conf`，仅 suspect 条目（box 为
  `[x0,y0,x1,y1]` 紧凑 JSON，text 经 csv 转义）。
- **与 /fix 的衔接**：`POST /fix` 需 `image_path + expect_text`（必填）`+ box`。
  `expect_text` 是**期望正字**——存量资产没有 expect 表，OCR 只读到「现在错成
  什么样」（即 fix_queue 里的 `text`），「应该是什么字」必须由 operator/vision
  复核定夺后补齐一列，才能逐条喂 /fix。fix_queue 是交接产物，/fix 修复执行不在本单。

## 6. 冒烟实录（C2）

```bash
python3 scripts/textguard_patrol.py --smoke 3
```

主力集 `1785508691757/p07/scene_refs/` 路径序前 3 张，真打 /check（0.37-0.40s/图），
均无文字块（`findings=0`，这 3 张场景图本体无招牌/文字元素，OCR 空结果是正常值）：

| 图 | findings | suspect | 耗时 |
| --- | --- | --- | --- |
| 前世闪回空间_angle_left.png | 0 | 0 | 0.37s |
| 前世闪回空间_front.png | 0 | 0 | 0.40s |
| 前世闪回空间_top_down.png | 0 | 0 | 0.39s |

**事故披露**：首版冒烟脚本有 bug（smoke 过滤只作用于打印、未截断巡检清单），首次
执行把该目录 **66 张全部真打了 /check**（约 25s，全 ok，0 error）。66 次均为只读
/check（无 /fix、无任何写操作），且都是合法巡检候选，结果保留在 jsonl 中作为
有效巡检数据（全量口径下已巡 66 / 待巡 319）。bug 已修复并加「截断必须在巡检前」
注记；修复后复跑 `--smoke 3` 精确 3 张真打。侧车侧无任何状态残留（/check 只读）。

这次 66 图数据同时充当了汇总链路的真实样本：19/66 图含 suspect（21 条，多为单字
低 conf：`福@0.55`、`吉@0.50`、`XA@0.69` 等，招牌/装饰字，语义判读归人工），
`patrol_out/patrol_report.md` 与 `fix_queue.csv` 已按真实数据生成。

## 7. operator 收割路径

- 产物目录：worktree `/data/workspace/kais-aigc-platform-wt/textguard-patrol/patrol_out/`
  （untracked 不入库，收割请按此路径取）。
- 全量巡检（operator 择时执行，可能排队等 sidecar 锁，不阻塞本单验收）：
  ```bash
  cd /data/workspace/kais-aigc-platform-wt/textguard-patrol
  python3 scripts/textguard_patrol.py            # 前台; 可 nohup / tmux
  ```
  中途 Ctrl-C / health 超限中止均留断点；**error 行重跑自动补**，所以撞上 /fix
  长锁导致的超时错误只需稍后再跑一遍即可收敛。
- 报告/队列重生成（不重巡）：`python3 scripts/textguard_patrol_report.py`
- 若需全新冒烟不混入已有断点：`--out-dir /tmp/patrol_smoke --smoke 3`

## 8. 边界声明（本批不做）

- 全量 ~385 张巡检**执行**归 operator 择时跑（脚本交付 + 冒烟自验即验收）。
- `/fix` 修复执行不在本单（`fix_queue.csv` 是交接产物，expect_text 需人工定夺）。
- 语义级判读（vision 复核招牌乱码 / 低 conf 单字）不在本单，自动判读只按 conf 分层。
