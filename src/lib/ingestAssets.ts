/**
 * ingestAssets.ts — 候选感知 ingest 服务 (candidate-aware ingest service).
 *
 * Phase 48 INGEST-01/02/03 + PHASE-01 (Plan 48-02). Consumes the pure contract
 * layer from Plan 48-01 (assetTypes + candidateGrouping) and turns group plans
 * into transactional o_assets / o_image writes:
 *
 *   - group members carry assetsId = primary's INTEGER id; primary rows have
 *     assetsId NULL (variants endpoint + /project/:projectId consume this shape)
 *   - exactly one isPrimaryView=true per group, asserted in-transaction so a
 *     violation rolls back the whole batch (D-04 批内保证, T-48-04)
 *   - state is ALWAYS 'active' (D-05 — elimination/archiving is a human action
 *     in the asset center; sync-assets.ts filters state='active')
 *   - type is normalized to the canonical vocabulary (role→character, tool→prop,
 *     D-06); route validates first, the ?? fallback keeps data loss at zero
 *   - workflow_phase derived per image, NEVER guessed (D-08): underivable →
 *     NULL + one console.warn per row
 *
 * The db handle is a PARAMETER (never imported from @/utils) so the Phase 50
 * backfill script and scripts/verify-phase-48.ts can pass their own knex.
 */

import type { Knex } from "knex";
import { normalizeAssetType } from "./assetTypes";
import {
  deriveWorkflowPhase,
  planGroups,
  type AssetGroupPlan,
  type IngestImageInput,
  type ManifestFrameEntry,
} from "./candidateGrouping";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface IngestImagesPayload {
  projectId: number;
  phase?: string;
  images: IngestImageInput[];
  manifests?: ManifestFrameEntry[];
}

export interface IngestAssetEntry {
  imageId: number;
  assetId: number;
  groupKey?: string;
  isPrimary: boolean;
}

export interface IngestGroupSummary {
  groupKey: string;
  primaryAssetId: number;
  memberAssetIds: number[];
}

export interface IngestResult {
  count: number;
  assets: IngestAssetEntry[];
  groups: IngestGroupSummary[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const LOG_PREFIX = "[pipeline/ingest/images]";

/** MAX(id) of a table inside the running transaction (0 on empty table).
 *  Replaces the collision-prone Date.now()+i id scheme (T-48-05). */
async function maxId(trx: Knex.Transaction, table: "o_assets" | "o_image"): Promise<number> {
  const rows: Array<{ maxId: number | null }> = await trx(table).max({ maxId: "id" });
  return rows[0]?.maxId ?? 0;
}

// ─── Service ───────────────────────────────────────────────────────────────

/**
 * Ingest an image batch as candidate-aware o_assets rows.
 *
 * Grouping comes from planGroups() (manifest channel first, naming fallback —
 * D-02/D-03); primary resolution from the plan (selected_*_variant > canonical
 * > v1 — D-04). The whole batch runs inside ONE transaction: any failure
 * (including the exactly-one-primary assertion) rolls back everything, so a
 * batch can never land partial orphans.
 */
export async function ingestImagesPayload(
  db: Knex,
  payload: IngestImagesPayload,
): Promise<IngestResult> {
  const images = Array.isArray(payload.images) ? payload.images : [];
  if (images.length === 0) {
    return { count: 0, assets: [], groups: [] };
  }
  const now = Date.now();

  return db.transaction(async (trx) => {
    // 1. Group plan (pure contract layer, Plan 48-01)
    const plan = planGroups(images, payload.manifests);

    // 2. Manifest frame prompts by groupKey — kmc prompts are the richest
    //    description source; used only when the member image has no prompt.
    const manifestPromptByKey = new Map<string, string>();
    for (const entry of payload.manifests ?? []) {
      if (!entry || typeof entry.shot_id !== "string") continue;
      if (entry.first_frame_prompt) {
        manifestPromptByKey.set(`shot:${entry.shot_id}:first`, entry.first_frame_prompt);
      }
      if (entry.last_frame_prompt) {
        manifestPromptByKey.set(`shot:${entry.shot_id}:last`, entry.last_frame_prompt);
      }
    }

    // 3. Per-image group info (groupKey + isPrimary), keyed by filePath
    const groupInfoByPath = new Map<string, { groupKey: string; isPrimary: boolean }>();
    for (const g of plan.groups) {
      for (const fp of g.memberFilePaths) {
        groupInfoByPath.set(fp, { groupKey: g.groupKey, isPrimary: fp === g.primaryFilePath });
      }
    }
    const groupByKey = new Map<string, AssetGroupPlan>();
    for (const g of plan.groups) groupByKey.set(g.groupKey, g);

    // 4. Id allocation up front (T-48-05): MAX(id)+1 sequential inside the trx
    let assetSeq = await maxId(trx, "o_assets");
    let imageSeq = await maxId(trx, "o_image");
    const perImage = images.map((img) => {
      imageSeq += 1;
      assetSeq += 1;
      return {
        img,
        imageId: imageSeq,
        assetId: assetSeq,
        info: groupInfoByPath.get(img.filePath),
      };
    });

    // Group summaries (primaryAssetId + all member asset ids)
    const groupSummaries: IngestGroupSummary[] = plan.groups.map((g) => {
      const primaryAssetId = perImage.find((p) => p.img.filePath === g.primaryFilePath)?.assetId;
      if (typeof primaryAssetId !== "number") {
        throw new Error(`${LOG_PREFIX} group ${g.groupKey} primary not present in batch`);
      }
      const memberAssetIds = g.memberFilePaths
        .map((fp) => perImage.find((p) => p.img.filePath === fp)?.assetId)
        .filter((id): id is number => typeof id === "number");
      return { groupKey: g.groupKey, primaryAssetId, memberAssetIds };
    });
    const primaryAssetIdByGroup = new Map<string, number>(
      groupSummaries.map((s) => [s.groupKey, s.primaryAssetId]),
    );

    // 5. Insert order: primaries + standalones first, non-primary members
    //    after — so members' assetsId references resolve inside the same
    //    transaction (stable sort keeps the input order within each tier).
    const insertOrder = [...perImage].sort((a, b) => {
      const ra = a.info && !a.info.isPrimary ? 1 : 0;
      const rb = b.info && !b.info.isPrimary ? 1 : 0;
      return ra - rb;
    });

    for (const e of insertOrder) {
      const img = e.img;
      const info = e.info;
      const group = info ? groupByKey.get(info.groupKey) : undefined;

      // workflow_phase (D-08 不猜): underivable → NULL + warn
      const workflowPhase = deriveWorkflowPhase(payload.phase, img.filePath);
      if (workflowPhase === null) {
        console.warn(`${LOG_PREFIX} workflow_phase 不可推导, 写入 NULL: ${img.filePath}`);
      }

      // prompt: image's own > manifest frame prompt > ""
      let prompt = typeof img.prompt === "string" && img.prompt.length > 0 ? img.prompt : "";
      if (!prompt && info) {
        prompt = manifestPromptByKey.get(info.groupKey) ?? "";
      }

      // meta: { subtype: group.metaSubtype || img.subtype, ...img.meta } or null
      const metaSource: Record<string, unknown> = {
        subtype: group?.metaSubtype || img.subtype,
        ...(img.meta ?? {}),
      };
      for (const k of Object.keys(metaSource)) {
        if (metaSource[k] === undefined) delete metaSource[k];
      }
      const meta = Object.keys(metaSource).length > 0 ? JSON.stringify(metaSource) : null;

      // o_image row with o_assets back-pointer (register_turnaround_b2.py shape)
      await trx("o_image").insert({
        id: e.imageId,
        filePath: img.filePath,
        type: payload.phase || "pipeline",
        assetsId: e.assetId,
        state: "done",
      });

      await trx("o_assets").insert({
        id: e.assetId,
        uuid: `ast-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: img.assetName,
        prompt,
        type: normalizeAssetType(img.assetType ?? "") ?? img.assetType ?? null,
        describe: img.description || "",
        projectId: payload.projectId,
        imageId: e.imageId,
        assetsId: info && !info.isPrimary ? (primaryAssetIdByGroup.get(info.groupKey) ?? null) : null,
        characterId: group?.characterId || img.characterId || null,
        viewAngle: img.viewAngle ?? null,
        isPrimaryView: info ? info.isPrimary : false,
        promptState: "done",
        startTime: now,
        state: "active", // D-05: ingest never writes archived/eliminated
        meta,
        createdAt: now,
        createdBy: "pipeline",
        workflow_phase: workflowPhase,
      });
    }

    // 6. D-04 in-transaction assertion: exactly one isPrimaryView=true row per
    //    group (primary itself + its members). Violation → throw → rollback.
    for (const s of groupSummaries) {
      const primaryRows: Array<{ id: number }> = await trx("o_assets")
        .where(function () {
          this.where("id", s.primaryAssetId).orWhere("assetsId", s.primaryAssetId);
        })
        .where("isPrimaryView", 1);
      if (primaryRows.length !== 1) {
        throw new Error(
          `${LOG_PREFIX} D-04 violated for group ${s.groupKey}: expected exactly 1 primary, found ${primaryRows.length} — batch rolled back`,
        );
      }
    }

    // 7. Response: legacy count + assets fields (each entry gains optional
    //    groupKey/isPrimary — additive, old callers unaffected) + groups summary
    const assets: IngestAssetEntry[] = perImage.map((e) => ({
      imageId: e.imageId,
      assetId: e.assetId,
      ...(e.info?.groupKey ? { groupKey: e.info.groupKey } : {}),
      isPrimary: e.info ? e.info.isPrimary : false,
    }));
    return { count: assets.length, assets, groups: groupSummaries };
  });
}
