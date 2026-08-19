/**
 * [ONE-OFF — Phase 50 historical backfill, 2026-08-19]
 *
 * Single-shot repair script for the 1612 pre-Phase-48 o_assets rows (INGEST-04
 * + PHASE-02 merged per v2.1 architecture decision 6): backfills candidate
 * groups (member assetsId → primary row id, exactly one isPrimaryView=1 per
 * group) and workflow_phase values derived from meta/meta.provenance/path.
 *
 * [APPLIED AND ARCHIVED — do not run again]
 *
 * This backfill has been applied and archived — do not run again; kept for
 * audit/reproducibility (Phase 47 archive semantics). The --apply gate below
 * (backup flag) remains as the mechanical backstop.
 *
 * APPLIED 2026-08-19 (Plan 50-01, production run):
 *   - planned 538 changes → executed 538/538 in ONE transaction; idempotency
 *     re-run: 0 planned / 0 executed
 *   - 154 candidate groups formed (121 multi-row + 33 single-variant whose
 *     lone row became its own primary); 240 member rows linked via assetsId
 *   - 534 workflow_phase values backfilled (237 from meta incl. nested
 *     meta.provenance.phase, 297 from path); pre-existing values never touched
 *   - 386 eliminated rows byte-untouched (D-05 red line, snapshot-diff proven)
 *
 * Pre-apply backup: data/db2-backup-pre-phase-50.sqlite (gitignored).
 * Audit trail: .planning/phases/50-historical-backfill-contract-guards/
 *   backfill-baseline-dryrun.txt / backfill-apply-log.txt / backfill-post-run-verify.txt
 *
 * NEVER add this to cron, app startup, or any runtime path — it is a repair
 * tool for rows ingested BEFORE Phase 48. The live path for all new data is
 * the Phase 48 ingest route (src/routes/v1/pipeline/ingest/images.ts →
 * ingestImagesPayload), which already lands the grouped shape.
 *
 * Grouping and phase decisions come exclusively from the Phase 48 pure
 * contract layer (src/lib/candidateGrouping.ts — planGroups /
 * deriveWorkflowPhase); this script duplicates none of that logic. It never
 * imports the utils barrel: the knex handle is self-built below so the
 * production singleton is untouched.
 *
 * D-05 red line: rows with state='eliminated' are NEVER modified — excluded
 * at SELECT level (they never even enter the plan) AND guarded inside every
 * UPDATE statement (`state != 'eliminated'`).
 *
 * WR-01 red line (added post-apply by code review; the production run planned
 * state writes: 0, so no archived row was ever affected — this future-proofs
 * the re-run guarantee): state='archived' rows are NEVER state-written.
 * Archiving is a human action (D-05): an archived row may still participate
 * in grouping decisions that require NO state change (assetsId /
 * isPrimaryView / workflow_phase targets), but a group whose chosen primary
 * is archived is skipped whole and itemized in the report (see the
 * archivedPrimarySkips plan field) — the backfill never resurrects an
 * archived row to 'active', and never links members onto an archived primary.
 *
 * Usage (Phase 47 convention):
 *   npm run backfill:phase-50                                  # dry-run (default): report only, 0 writes
 *   npm run backfill:phase-50 -- --apply --i-backed-up-db      # gated apply
 *
 * --apply refuses to run without --i-backed-up-db (exit 1 before opening any
 * write, printing the backup command). Consistency-safe backup:
 *   sqlite3 data/db2.sqlite ".backup 'data/db2-backup-pre-phase-50.sqlite'"
 *
 * Audit trail (committed): .planning/phases/50-historical-backfill-contract-guards/
 *   backfill-baseline-dryrun.txt / backfill-apply-log.txt / backfill-post-run-verify.txt
 * The backup file data/db2-backup-pre-phase-50.sqlite stays gitignored.
 */

import knex from "knex";
import type { Knex } from "knex";
import {
  deriveWorkflowPhase,
  planGroups,
  type IngestImageInput,
} from "../src/lib/candidateGrouping";

// ─── Types ─────────────────────────────────────────────────────────────────

/** One non-eliminated o_assets row joined with its o_image.filePath. */
interface AssetRow {
  id: number;
  name: string | null;
  projectId: number | null;
  imageId: number | null;
  assetsId: number | null;
  isPrimaryView: number | boolean;
  state: string;
  meta: string | null;
  workflowPhase: string | null;
  filePath: string | null;
}

export interface BackfillGroup {
  groupKey: string;
  primaryRowId: number;
  /** ALL member row ids of the group, including the primary's own id. */
  memberRowIds: number[];
  /** Existing isPrimaryView=1 rows demoted to 0 by this group's convergence
   *  decision (D-05: conflicts resolve via candidateGrouping's primary rule,
   *  every flip is listed in the report). */
  primaryFlipsFrom: number[];
}

/** One row's actual value changes — columns appear ONLY when they differ from
 *  the target, which makes re-running after an apply produce an empty list
 *  (idempotency by construction). */
export interface BackfillDiffRow {
  id: number;
  assetsId?: number | null;
  isPrimaryView?: 0 | 1;
  state?: string;
  workflowPhase?: string;
}

export interface BackfillPlan {
  dbPath: string;
  /** SELECT COUNT(*) BEFORE any work (D-06). */
  totalRows: number;
  scanned: number;
  excludedEliminated: number;
  /** Rows whose imageId is NULL / o_image.filePath is empty — no grouping
   *  input possible, but workflow_phase may still come from meta. */
  noImageId: number;
  duplicatePathSkipped: number;
  duplicatePaths: string[];
  groups: BackfillGroup[];
  groupedRows: number;
  standaloneRows: number;
  /** WR-01: groups whose planGroups-chosen primary row is state='archived'.
   *  Archiving is a human action — the backfill never writes an archived
   *  row's state, and a primary must land 'active' (WR-3 apply assertion),
   *  so these groups are skipped whole (zero grouping writes to any member;
   *  workflow_phase targets still apply) and itemized here. Their member
   *  rows are counted in neither groupedRows nor standaloneRows. */
  archivedPrimarySkips: string[];
  wfFromMeta: number;
  wfFromPath: number;
  wfUnderivable: number;
  wfAlreadySet: number;
  /** D-04 itemization: every row that stays workflow_phase NULL and why. */
  underivableItems: string[];
  warnings: string[];
  diffs: BackfillDiffRow[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Resolve the meta phase signal: top-level `meta.phase` first, falling back
 *  to nested `meta.provenance.phase` (BL-1 — checker-verified production
 *  fact: 129 active rows carry phase ONLY in meta.provenance.phase). Returns
 *  undefined for absent/malformed signals. Never throws. */
function extractMetaPhase(metaRaw: string | null): string | undefined {
  if (!metaRaw) return undefined;
  try {
    const meta: unknown = JSON.parse(metaRaw);
    if (meta !== null && typeof meta === "object") {
      const top = (meta as Record<string, unknown>).phase;
      if (typeof top === "string" && top.length > 0) return top;
      const prov = (meta as Record<string, unknown>).provenance;
      if (prov !== null && typeof prov === "object") {
        const nested = (prov as Record<string, unknown>).phase;
        if (typeof nested === "string" && nested.length > 0) return nested;
      }
    }
  } catch {
    // malformed meta JSON — treat as absent (never blocks the row's other targets)
  }
  return undefined;
}

function underivableReason(metaPhase: string | undefined, filePath: string | null): string {
  const fp =
    filePath && filePath.length > 0 ? filePath : "(no filePath — imageId NULL or empty path)";
  if (metaPhase) return `meta.phase='${metaPhase}' carries no p{NN}; path=${fp} has no p{NN} segment`;
  return `no meta.phase; path=${fp} has no p{NN} segment`;
}

// ─── planBackfill (READ-ONLY) ──────────────────────────────────────────────

/**
 * Scan the non-eliminated o_assets rows and compute the full backfill plan —
 * zero writes. Grouping runs the Phase 48 naming channel (planGroups with NO
 * manifests argument): historical rows were ingested before Phase 48 and no
 * kmc iframe-manifest was ever persisted alongside them, so the `*_v{N}` +
 * canonical-file naming convention is the only — and the same — family signal
 * the online path would have used for these files.
 */
export async function planBackfill(db: Knex, dbPath = "data/db2.sqlite"): Promise<BackfillPlan> {
  // D-06: print-scale counts FIRST, before anything else touches the DB.
  const totalRows = Number((await db("o_assets").count("* as c"))[0]?.c ?? 0);
  const excludedEliminated = Number(
    (await db("o_assets").where({ state: "eliminated" }).count("* as c"))[0]?.c ?? 0,
  );

  // D-05 enforced at query level: eliminated rows never enter the scan, so no
  // diff row id can ever belong to one.
  const rows = (await db("o_assets as a")
    .leftJoin("o_image as o", "o.id", "a.imageId")
    .whereRaw("a.state != 'eliminated'")
    .orderBy("a.id")
    .select(
      "a.id",
      "a.name",
      "a.projectId",
      "a.imageId",
      "a.assetsId",
      "a.isPrimaryView",
      "a.state",
      "a.meta",
      "a.workflow_phase as workflowPhase",
      { filePath: "o.filePath" },
    )) as AssetRow[];

  const diffs: BackfillDiffRow[] = [];
  const diffById = new Map<number, BackfillDiffRow>();
  /** Only call when at least one column is KNOWN to differ; the column is
   *  assigned immediately after. Keeps diffs = actual value changes only. */
  const getDiff = (id: number): BackfillDiffRow => {
    let d = diffById.get(id);
    if (!d) {
      d = { id };
      diffById.set(id, d);
      diffs.push(d);
    }
    return d;
  };

  // Per-projectId buckets — groups never cross projects.
  const buckets = new Map<string, AssetRow[]>();
  for (const r of rows) {
    const key = r.projectId === null || r.projectId === undefined ? "global" : String(r.projectId);
    const arr = buckets.get(key);
    if (arr) arr.push(r);
    else buckets.set(key, [r]);
  }

  const groups: BackfillGroup[] = [];
  const duplicatePaths = new Set<string>();
  const warnings: string[] = [];
  const archivedPrimarySkips: string[] = [];
  let noImageId = 0;
  let duplicatePathSkipped = 0;
  let groupedRows = 0;
  let standaloneRows = 0;

  for (const bucketRows of buckets.values()) {
    // Duplicate filePaths within a bucket are ambiguous (two o_assets rows for
    // one physical file — the CR-01 shape). Deterministic policy: skip them
    // from grouping entirely (no arbitrary twin pick); they keep their current
    // grouping columns and still receive workflow_phase targets below.
    const pathCounts = new Map<string, number>();
    for (const r of bucketRows) {
      const fp = r.filePath ?? "";
      if (fp.length === 0) continue;
      pathCounts.set(fp, (pathCounts.get(fp) ?? 0) + 1);
    }

    const inputs: IngestImageInput[] = [];
    const rowByPath = new Map<string, AssetRow>();
    for (const r of bucketRows) {
      const fp = r.filePath ?? "";
      if (fp.length === 0) {
        noImageId += 1;
        continue;
      }
      if ((pathCounts.get(fp) ?? 0) > 1) {
        duplicatePathSkipped += 1;
        duplicatePaths.add(fp);
        continue;
      }
      rowByPath.set(fp, r);
      inputs.push({ filePath: fp, assetName: r.name ?? fp.split("/").pop() ?? fp });
    }

    // Phase 48 contract layer, naming channel only (see function doc).
    const plan = planGroups(inputs);
    for (const w of plan.warnings) warnings.push(w);

    const groupedRowIds = new Set<number>();
    const archivedSkipRowIds = new Set<number>();
    for (const g of plan.groups) {
      const primaryRow = rowByPath.get(g.primaryFilePath);
      if (!primaryRow) continue; // unreachable (plan built from these inputs) — guarded anyway
      const memberRows = g.memberFilePaths
        .map((fp) => rowByPath.get(fp))
        .filter((r): r is AssetRow => r !== undefined);
      // WR-01: an archived row is red-lined for STATE writes, and the chosen
      // primary must land 'active' (WR-3 apply assertion) — a group whose
      // primary is archived can never converge without un-archiving it, so
      // the whole group is skipped (no grouping writes for ANY member) and
      // itemized. The human archive decision outranks the convergence.
      if (primaryRow.state === "archived") {
        archivedPrimarySkips.push(
          `${g.groupKey}: chosen primary row ${primaryRow.id} is state='archived' — ` +
            `${memberRows.length} row(s) left untouched (grouping would require a state write)`,
        );
        for (const m of memberRows) archivedSkipRowIds.add(m.id);
        continue;
      }
      const primaryRowId = primaryRow.id;
      const primaryFlipsFrom: number[] = [];

      for (const m of memberRows) {
        groupedRowIds.add(m.id);
        const isPrimary = m.id === primaryRowId;
        const targetPrimary: 0 | 1 = isPrimary ? 1 : 0;
        const targetAssetsId: number | null = isPrimary ? null : primaryRowId;
        if ((m.assetsId ?? null) !== targetAssetsId) getDiff(m.id).assetsId = targetAssetsId;
        if (Number(m.isPrimaryView) !== targetPrimary) getDiff(m.id).isPrimaryView = targetPrimary;
        // WR-01: never coerce an archived row back to 'active' — archiving is
        // a human action. Archived members still take the grouping columns
        // above (no state change required). Any OTHER legacy non-active value
        // keeps the original normalization-to-active behavior.
        if (m.state !== "active" && m.state !== "archived") getDiff(m.id).state = "active";
        if (!isPrimary && Number(m.isPrimaryView) === 1) primaryFlipsFrom.push(m.id);
      }
      groups.push({
        groupKey: g.groupKey,
        primaryRowId,
        memberRowIds: memberRows.map((m) => m.id),
        primaryFlipsFrom,
      });
    }
    groupedRows += groupedRowIds.size;
    standaloneRows += inputs.length - groupedRowIds.size - archivedSkipRowIds.size;
  }

  // workflow_phase targets for EVERY scanned row (grouped, standalone, or
  // no-filePath) — D-04 priority meta.phase ∥ meta.provenance.phase > path
  // segment > NULL, resolved by the same pure function the online path uses.
  let wfFromMeta = 0;
  let wfFromPath = 0;
  let wfUnderivable = 0;
  let wfAlreadySet = 0;
  const underivableItems: string[] = [];
  for (const r of rows) {
    const current = (r.workflowPhase ?? "").trim();
    if (current.length > 0) {
      wfAlreadySet += 1; // 156 rows already carry values — NEVER rewritten (idempotency)
      continue;
    }
    const metaPhase = extractMetaPhase(r.meta);
    const target = deriveWorkflowPhase(metaPhase, r.filePath ?? "");
    if (target === null) {
      wfUnderivable += 1;
      underivableItems.push(`row ${r.id}: ${underivableReason(metaPhase, r.filePath)}`);
      continue; // D-04/D-08: stays NULL, never guessed
    }
    if (deriveWorkflowPhase(metaPhase, "") !== null) wfFromMeta += 1;
    else wfFromPath += 1;
    getDiff(r.id).workflowPhase = target;
  }

  diffs.sort((a, b) => a.id - b.id);
  groups.sort((a, b) => (a.groupKey < b.groupKey ? -1 : a.groupKey > b.groupKey ? 1 : 0));

  return {
    dbPath,
    totalRows,
    scanned: rows.length,
    excludedEliminated,
    noImageId,
    duplicatePathSkipped,
    duplicatePaths: [...duplicatePaths].sort(),
    groups,
    groupedRows,
    standaloneRows,
    archivedPrimarySkips,
    wfFromMeta,
    wfFromPath,
    wfUnderivable,
    wfAlreadySet,
    underivableItems,
    warnings,
    diffs,
  };
}

// ─── applyBackfill (ONE transaction) ───────────────────────────────────────

/**
 * Execute the plan inside ONE transaction. Every UPDATE carries the D-05 red
 * line (`state != 'eliminated'`) so a row eliminated between plan and apply is
 * a no-op instead of a write; any UPDATE that would set the state column also
 * carries the WR-01 red line (`state != 'archived'`). After the updates, the
 * ingestAssets-style per-group assertion runs in-transaction: exactly one
 * isPrimaryView=1 row equal to the planned primary, that primary's state ===
 * 'active' (WR-3 — a user-eliminated OR user-archived primary must roll back,
 * never receive linked members), and every member's assetsId === primaryRowId.
 * Any violation throws and rolls back the whole apply.
 */
export async function applyBackfill(
  db: Knex,
  plan: BackfillPlan,
): Promise<{ executedUpdates: number }> {
  let executedUpdates = 0;
  await db.transaction(async (trx) => {
    for (const d of plan.diffs) {
      const sets: Record<string, unknown> = {};
      if (d.assetsId !== undefined) sets.assetsId = d.assetsId;
      if (d.isPrimaryView !== undefined) sets.isPrimaryView = d.isPrimaryView;
      if (d.state !== undefined) sets.state = d.state;
      if (d.workflowPhase !== undefined) sets.workflow_phase = d.workflowPhase;
      if (Object.keys(sets).length === 0) continue;
      let statement = trx("o_assets")
        .where({ id: d.id })
        .whereRaw("state != 'eliminated'");
      if (sets.state !== undefined) {
        // WR-01: the STATE column specifically is red-lined for archived
        // rows — a row archived between plan and apply keeps its human
        // decision. The statement no-ops and the planned-vs-executed
        // MISMATCH in main() then fails loudly. Grouping-only writes never
        // carry `state`, so archived members still take their planned
        // assetsId/isPrimaryView/workflow_phase updates untouched by this.
        statement = statement.whereRaw("state != 'archived'");
      }
      const affected = await statement.update(sets);
      executedUpdates += affected;
    }

    // In-transaction per-group assertion (ingestAssets.ts pattern, Plan 48-02).
    for (const g of plan.groups) {
      const ids = [g.primaryRowId, ...g.memberRowIds];
      const groupRows = (await trx("o_assets").whereIn("id", ids).select(
        "id",
        "assetsId",
        "isPrimaryView",
        "state",
      )) as Array<{ id: number; assetsId: number | null; isPrimaryView: number | boolean; state: string }>;
      const primaryRows = groupRows.filter((r) => Number(r.isPrimaryView) === 1);
      if (primaryRows.length !== 1 || primaryRows[0]?.id !== g.primaryRowId) {
        throw new Error(
          `[backfill:phase-50] group ${g.groupKey}: expected exactly 1 primary (id ${g.primaryRowId}), ` +
            `found [${primaryRows.map((r) => r.id).join(",")}] — transaction rolled back`,
        );
      }
      const primary = groupRows.find((r) => r.id === g.primaryRowId);
      if (!primary || primary.state !== "active") {
        // WR-3: primary eliminated (or archived, WR-01) between plan and
        // apply → rollback, never link members to a non-active row.
        throw new Error(
          `[backfill:phase-50] group ${g.groupKey}: primary row ${g.primaryRowId} state is ` +
            `'${primary?.state ?? "missing"}' (expected 'active') — transaction rolled back`,
        );
      }
      const unlinked = groupRows.filter((r) => r.id !== g.primaryRowId && r.assetsId !== g.primaryRowId);
      if (unlinked.length > 0) {
        throw new Error(
          `[backfill:phase-50] group ${g.groupKey}: member ids [${unlinked
            .map((r) => r.id)
            .join(",")}] not linked to primary id ${g.primaryRowId} — transaction rolled back`,
        );
      }
    }
  });
  return { executedUpdates };
}

// ─── Report ────────────────────────────────────────────────────────────────

export function printReport(plan: BackfillPlan, mode: string): void {
  const lines: string[] = [];
  lines.push("=== Phase 50 historical backfill — candidate groups + workflow_phase ===");
  lines.push(`mode: ${mode}`);
  lines.push(`db: ${plan.dbPath}`);
  lines.push("");
  lines.push("--- scale (D-06: counted before any work) ---");
  lines.push(`o_assets total:               ${plan.totalRows}`);
  lines.push(`scanned (non-eliminated):     ${plan.scanned}`);
  lines.push(`excluded eliminated (D-05):   ${plan.excludedEliminated}  <- never planned, never written`);
  lines.push(`rows without filePath:        ${plan.noImageId}`);
  lines.push(`duplicate-path rows skipped:  ${plan.duplicatePathSkipped} (${plan.duplicatePaths.length} paths)`);
  lines.push("");
  lines.push("--- grouping (planGroups naming channel, no manifests) ---");
  lines.push(`groups planned:               ${plan.groups.length}`);
  lines.push(`rows in groups:               ${plan.groupedRows}`);
  lines.push(`standalone rows (flat, kept): ${plan.standaloneRows}`);
  lines.push(
    `archived-primary groups skipped (WR-01): ${plan.archivedPrimarySkips.length}  <- never state-written, members untouched`,
  );
  lines.push("");
  lines.push("--- planned column writes (diff-only => idempotent by construction) ---");
  lines.push(`assetsId writes:              ${plan.diffs.filter((d) => d.assetsId !== undefined).length}`);
  lines.push(`isPrimaryView 0->1:           ${plan.diffs.filter((d) => d.isPrimaryView === 1).length}`);
  lines.push(`isPrimaryView 1->0:           ${plan.diffs.filter((d) => d.isPrimaryView === 0).length}`);
  lines.push(`state writes:                 ${plan.diffs.filter((d) => d.state !== undefined).length}`);
  const wfWrites = plan.diffs.filter((d) => d.workflowPhase !== undefined).length;
  lines.push(`workflow_phase writes:        ${wfWrites} (from meta: ${plan.wfFromMeta}, from path: ${plan.wfFromPath})`);
  lines.push(`workflow_phase already set:   ${plan.wfAlreadySet} (NOT rewritten - idempotency)`);
  lines.push(`workflow_phase underivable:   ${plan.wfUnderivable} (stay NULL - D-04/D-08, itemized below)`);
  lines.push("");
  const flips = plan.groups.filter((g) => g.primaryFlipsFrom.length > 0);
  lines.push(`--- convergence decisions: ${flips.length} group(s) demote an existing isPrimaryView=1 row (D-05) ---`);
  for (const g of flips) {
    lines.push(`  ${g.groupKey}: chosen primary row ${g.primaryRowId}; demoted rows [${g.primaryFlipsFrom.join(", ")}]`);
  }
  if (plan.duplicatePaths.length > 0) {
    lines.push("");
    lines.push("--- duplicate paths skipped (ambiguous mapping, grouping columns left as-is) ---");
    for (const p of plan.duplicatePaths) lines.push(`  ${p}`);
  }
  if (plan.archivedPrimarySkips.length > 0) {
    lines.push("");
    lines.push("--- archived-primary groups skipped (WR-01: grouping would require a state write) ---");
    for (const s of plan.archivedPrimarySkips) lines.push(`  ${s}`);
  }
  lines.push("");
  lines.push(`--- underivable workflow_phase itemization (${plan.wfUnderivable} rows stay NULL) ---`);
  for (const item of plan.underivableItems) lines.push(`  ${item}`);
  lines.push("");
  lines.push(`Planned changes: ${plan.diffs.length}`);
  console.log(lines.join("\n"));
}

// ─── CLI ───────────────────────────────────────────────────────────────────

const DEFAULT_DB = "data/db2.sqlite";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const backedUp = args.includes("--i-backed-up-db");
  const dbIdx = args.indexOf("--db");
  const dbPath = dbIdx >= 0 && args[dbIdx + 1] ? args[dbIdx + 1] : DEFAULT_DB;

  // D-02 gate — BEFORE any write path is opened.
  if (apply && !backedUp) {
    console.error(
      "REFUSING --apply: pass --i-backed-up-db after backing up the production DB.\n" +
        "Consistency-safe backup (recommended, from a live DB):\n" +
        `  sqlite3 ${dbPath} ".backup 'data/db2-backup-pre-phase-50.sqlite'"\n` +
        "Raw copy alternative (only safe with the DB offline):\n" +
        `  cp ${dbPath} data/db2-backup-pre-phase-50.sqlite`,
    );
    process.exit(1);
  }

  const db = knex({
    client: "better-sqlite3",
    connection: { filename: dbPath },
    useNullAsDefault: true,
  });
  try {
    const plan = await planBackfill(db, dbPath);
    printReport(plan, apply ? "APPLY (plan printed before writes)" : "DRY-RUN (default, no writes)");
    if (apply) {
      const { executedUpdates } = await applyBackfill(db, plan);
      console.log(`Executed updates: ${executedUpdates}`);
      if (executedUpdates !== plan.diffs.length) {
        console.error(
          `[backfill:phase-50] MISMATCH: planned ${plan.diffs.length} row changes but executed ` +
            `${executedUpdates} — a row likely changed state mid-run; inspect before re-running.`,
        );
        process.exitCode = 1;
      }
    } else {
      console.log("Executed updates: 0");
    }
  } finally {
    await db.destroy();
  }
}

// Run only as a direct entry point (npx tsx scripts/backfill-candidate-groups.ts).
// Phase 50-02's verify imports planBackfill/applyBackfill on :memory: databases —
// importing this module must never touch production.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error("[backfill:phase-50] FAILED:", err);
    process.exit(1);
  });
}
