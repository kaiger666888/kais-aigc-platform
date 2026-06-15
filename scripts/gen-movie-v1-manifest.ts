#!/usr/bin/env tsx
/**
 * gen-movie-v1-manifest.ts — extract MOVIE_V1_MANIFEST to a JSON artifact.
 *
 * Phase 33 (COMPLIANCE-01): produces docs/skill-author-guide/movie-v1.manifest.json
 * as the install-ready artifact OpenClaw workspaces POST to /api/v1/skills/register.
 * The TypeScript constant is the source of truth; this script regenerates the
 * JSON file from it on demand.
 *
 * Usage: tsx scripts/gen-movie-v1-manifest.ts [output-path]
 */
import fs from "node:fs";
import { MOVIE_V1_MANIFEST } from "../src/skills/defaultSkill";

const outPath = process.argv[2] ?? "docs/skill-author-guide/movie-v1.manifest.json";
const json = JSON.stringify(MOVIE_V1_MANIFEST, null, 2) + "\n";
fs.writeFileSync(outPath, json);
console.log(`Wrote ${json.length} bytes to ${outPath}`);
