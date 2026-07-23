#!/usr/bin/env node
/**
 * 数据库迁移脚本 — 为星渊纪项目的现有节点 thumbnailUrl 替换为压缩缩略图路径。
 *
 * 归档说明：本脚本为一次性迁移脚本，已从 scripts/ 归位至 scripts/oneoffs/（审计存档）。
 *
 * 用法：cd /data/workspace/kais-aigc-platform && node scripts/oneoffs/migrate-thumbnails.js [--projectId 1782745975908] [--episodesId 1]
 *
 * 逻辑：
 *   1. 读取最新 bootstrap 事件的 payload
 *   2. 遍历节点：若 thumbnailUrl 指向原图/原视频（非 _thumbs/），则：
 *      - 保留原路径到 filePath（若 filePath 为空）
 *      - 将 thumbnailUrl 替换为 /oss/_thumbs/...webp
 *   3. 写回 bootstrap 事件 + o_agentWorkData.canvasGraph 快照
 *
 * 幂等：已指向 _thumbs 的节点不重复处理。
 */

"use strict";

const path = require("path");
const fs = require("fs");

const Database = require("better-sqlite3");

function argValue(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const DB_PATH = path.join(__dirname, "..", "..", "..", "data", "db2.sqlite");
const PROJECT_ID = Number(argValue("projectId")) || 1782745975908;
const EPISODES_ID = Number(argValue("episodesId")) || 1;

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv"]);

function toThumbnailUrl(sourcePath) {
  if (!sourcePath || !sourcePath.startsWith("/oss/")) return null;
  const rel = sourcePath.slice("/oss/".length);
  if (rel.startsWith("_thumbs/")) return sourcePath; // already a thumb
  const ext = path.extname(rel);
  const base = ext ? rel.slice(0, -ext.length) : rel;
  return `/oss/_thumbs/${base}.webp`;
}

function isMediaUrl(url) {
  if (!url || typeof url !== "string" || !url.startsWith("/oss/")) return false;
  if (url.includes("/_thumbs/")) return false;
  const ext = path.extname(url).toLowerCase();
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}

function processGraph(graph) {
  let changed = 0;
  let totalNodes = 0;
  if (!graph || !Array.isArray(graph.nodes)) return { changed: 0, totalNodes: 0 };
  for (const node of graph.nodes) {
    totalNodes++;
    const data = node.data;
    if (!data) continue;
    const thumb = data.thumbnailUrl;
    if (!isMediaUrl(thumb)) continue;
    const thumbUrl = toThumbnailUrl(thumb);
    if (thumbUrl && thumbUrl !== thumb) {
      // 保留原图到 filePath（若为空）
      if (!data.filePath) data.filePath = thumb;
      data.thumbnailUrl = thumbUrl;
      changed++;
    }
  }
  return { changed, totalNodes };
}

function main() {
  console.log("DB:", DB_PATH);
  console.log(`Project ${PROJECT_ID} / Episodes ${EPISODES_ID}`);

  const db = new Database(DB_PATH);
  try {
    // 1. 更新最新 bootstrap 事件（以及所有 bootstrap 事件，因为 recomputeGraph 会重放）
    const bootEvents = db
      .prepare(
        "SELECT eventId, payload FROM kv_canvasEvent WHERE projectId=? AND episodesId=? AND type='bootstrap' ORDER BY eventId DESC",
      )
      .all(PROJECT_ID, EPISODES_ID);

    console.log(`Found ${bootEvents.length} bootstrap event(s).`);

    let totalChanged = 0;
    const updateEvent = db.prepare(
      "UPDATE kv_canvasEvent SET payload=? WHERE eventId=?",
    );

    for (const ev of bootEvents) {
      const payload = JSON.parse(ev.payload);
      if (!payload.graph) {
        console.log(`  event ${ev.eventId}: no graph, skip`);
        continue;
      }
      const before = JSON.stringify(payload).length;
      const { changed, totalNodes } = processGraph(payload.graph);
      const after = JSON.stringify(payload).length;
      updateEvent.run(JSON.stringify(payload), ev.eventId);
      console.log(
        `  event ${ev.eventId}: ${totalNodes} nodes, ${changed} thumbnailUrl rewritten (size ${before}→${after})`,
      );
      totalChanged += changed;
    }

    // 2. 更新 o_agentWorkData.canvasGraph 快照（前端读取的缓存）
    const snapRows = db
      .prepare(
        "SELECT id, data, length(data) as dlen FROM o_agentWorkData WHERE projectId=? AND episodesId=? AND key='canvasGraph'",
      )
      .all(String(PROJECT_ID), String(EPISODES_ID));

    console.log(`\nFound ${snapRows.length} canvasGraph snapshot row(s).`);
    const updateSnap = db.prepare("UPDATE o_agentWorkData SET data=?, updateTime=? WHERE id=?");

    for (const row of snapRows) {
      const graph = JSON.parse(row.data);
      const before = row.dlen;
      const { changed, totalNodes } = processGraph(graph);
      const after = JSON.stringify(graph).length;
      updateSnap.run(JSON.stringify(graph), Date.now(), row.id);
      console.log(
        `  snapshot id=${row.id}: ${totalNodes} nodes, ${changed} thumbnailUrl rewritten (size ${before}→${after})`,
      );
    }

    console.log(`\n✅ 完成 — 共重写 ${totalChanged} 个 thumbnailUrl`);
  } finally {
    db.close();
  }
}

main();
