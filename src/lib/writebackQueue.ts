/**
 * writebackQueue.ts — canvas 出站回写重试队列(Phase 53-04 / DR-4)。
 *
 * 选定/豁免/重渲的出站回写是 best-effort 附属通道(D-10:canvas 真值 + 队列
 * 重试,体验不阻塞)。本模块持有 canvas_writeback_queue 表的全部读写:
 *
 *   enqueue → INSERT state='pending', attempts=0, max_attempts=8,
 *             next_attempt_at = now + 30s(首退避)
 *   drainOnce → 串行逐条(state='pending' 且 next_attempt_at<=now,按 id 序):
 *             handler true → 'done';false/throw → attempts+1,
 *             attempts>=max_attempts → 'failed' 终态,
 *             否则 next_attempt_at = now + 30000*2^attempts(指数退避)
 *   ensureDrainStarted → 进程内幂等单例:setInterval 30s + 启动立即一次;
 *             stopDrainForTest() 供测试回收 timer
 *
 * handler 语义约定(重放依赖):handler 自身幂等——"目标值已相等 → 视为成功"
 * (reviewBridge P1 同款)。串行 drain,绝不并发。
 *
 * 53-07 G15 操作桥复用 action 枚举后两值(g15_waive / g15_requeue)。
 *
 * db-as-parameter(P4):全部函数 db 首参,verify 可 :memory: 注入。
 * 本模块可 throw(enqueue 落库失败)——降级策略由调用方决定
 * (manifestWriteback 的 never-throws 包装)。
 */

import type { Knex } from "knex";

// ─── Constants(DR-4 锁定值)───────────────────────────────────────────────

export const WRITEBACK_BACKOFF_BASE_MS = 30_000;
export const WRITEBACK_MAX_ATTEMPTS = 8;
const DRAIN_INTERVAL_MS = 30_000;

export type WritebackAction = "manifest_writeback" | "g15_waive" | "g15_requeue";

export interface WritebackQueueRow {
  id: number
  project_id: number
  episodes_id: number
  action: WritebackAction
  payload: string
  state: "pending" | "done" | "failed"
  attempts: number
  max_attempts: number
  next_attempt_at: number
  last_error: string | null
}

// ─── enqueue ────────────────────────────────────────────────────────────────

export async function enqueueWriteback(
  db: Knex,
  input: {
    projectId: number
    episodesId: number
    action: WritebackAction
    payload: Record<string, unknown>
  },
): Promise<{ id: number }> {
  const now = Date.now();
  const [row] = await db("canvas_writeback_queue")
    .insert({
      project_id: input.projectId,
      episodes_id: input.episodesId,
      action: input.action,
      payload: JSON.stringify(input.payload),
      state: "pending",
      attempts: 0,
      max_attempts: WRITEBACK_MAX_ATTEMPTS,
      next_attempt_at: now + WRITEBACK_BACKOFF_BASE_MS,
      created_at: now,
      updated_at: now,
    })
    .returning("id");
  // sqlite3 driver 返回数组形式;pg 返回对象——两者兼容
  const id = typeof row === "object" && row != null ? (row as { id: number }).id : Number(row);
  return { id };
}

// ─── drainOnce(串行,导出供 verify 手动驱动)──────────────────────────────

export interface DrainHandlers {
  (row: WritebackQueueRow): Promise<boolean>
}

export async function drainOnce(
  db: Knex,
  handler: DrainHandlers,
): Promise<{ processed: number; delivered: number }> {
  const now = Date.now();
  const due: WritebackQueueRow[] = await db("canvas_writeback_queue")
    .where({ state: "pending" })
    .where("next_attempt_at", "<=", now)
    .orderBy("id", "asc")
    .select("*");

  let processed = 0;
  let delivered = 0;
  for (const row of due) {
    processed++;
    let ok = false;
    let errText: string | null = null;
    try {
      ok = await handler(row);
    } catch (err) {
      ok = false;
      errText = err instanceof Error ? err.message : String(err);
    }
    if (ok) {
      delivered++;
      await db("canvas_writeback_queue")
        .where({ id: row.id })
        .update({ state: "done", updated_at: Date.now() });
      continue;
    }
    const attempts = row.attempts + 1;
    const terminal = attempts >= row.max_attempts;
    await db("canvas_writeback_queue")
      .where({ id: row.id })
      .update({
        attempts,
        state: terminal ? "failed" : "pending",
        next_attempt_at: terminal ? row.next_attempt_at : Date.now() + WRITEBACK_BACKOFF_BASE_MS * 2 ** attempts,
        last_error: errText ? errText.slice(0, 500) : "handler returned false",
        updated_at: Date.now(),
      });
  }
  return { processed, delivered };
}

// ─── ensureDrainStarted(进程内单例)────────────────────────────────────────

let drainTimer: ReturnType<typeof setInterval> | null = null;

export function ensureDrainStarted(db: Knex, drainFn: (db: Knex) => Promise<unknown>): void {
  if (drainTimer != null) return;
  void drainFn(db); // 启动立即一次
  drainTimer = setInterval(() => {
    void drainFn(db).catch(() => {
      /* drain 失败静默——下一 tick 重试 */
    });
  }, DRAIN_INTERVAL_MS);
  // 进程不因 drain timer 悬挂
  if (typeof drainTimer.unref === "function") drainTimer.unref();
}

export function stopDrainForTest(): void {
  if (drainTimer != null) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
}
