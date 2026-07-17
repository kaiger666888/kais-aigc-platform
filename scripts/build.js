/**
 * scripts/build.js — Build kais-aigc-platform server bundle.
 *
 * Packs src/app.ts → data/serve/app.js via esbuild.
 * Native modules are marked external (resolved at runtime).
 *
 * Usage:
 *   node scripts/build.js          # build server only
 *   node scripts/build.js --check  # build + verify routes exist in output
 */
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const EXTERNAL = [
  "electron",
  "@huggingface/transformers",
  "onnxruntime-node",
  "vm2",
  "sqlite3",
  "better-sqlite3",
  "sharp",
  "mysql",
  "mysql2",
  "pg",
  "pg-query-stream",
  "oracledb",
  "tedious",
  "mssql",
];

async function main() {
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"),
  );

  console.log("🔨 Building kais-aigc-platform server bundle...\n");

  await esbuild.build({
    entryPoints: ["src/app.ts"],
    bundle: true,
    minify: false,
    format: "cjs",
    allowOverwrite: true,
    outfile: "data/serve/app.js",
    platform: "node",
    target: "esnext",
    tsconfig: "./tsconfig.json",
    alias: { "@": "./src" },
    sourcemap: false,
    external: EXTERNAL,
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  });

  const stat = fs.statSync("data/serve/app.js");
  console.log(`✅ Server bundle: data/serve/app.js (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

  // ── Verify routes exist in the bundle ────────────────
  const check = process.argv.includes("--check");
  if (check) {
    const content = fs.readFileSync("data/serve/app.js", "utf8");
    const required = ["load-v2", "save-v2", "infinite-canvas"];
    const missing = required.filter((r) => !content.includes(r));
    if (missing.length > 0) {
      console.error(`❌ Build verification FAILED — missing: ${missing.join(", ")}`);
      process.exit(1);
    }
    console.log("✅ Route verification passed (load-v2, save-v2, infinite-canvas found)");
  }

  console.log("\n🎉 Build complete!\n");
}

main().catch((err) => {
  console.error("❌ Build failed:", err);
  process.exit(1);
});
