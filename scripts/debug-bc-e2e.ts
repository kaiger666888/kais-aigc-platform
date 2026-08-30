export {};
async function main(): Promise<void> {
  const m = await import("../src/routes/production/minimax-h3/__tests__/blockCache.test");
  try {
    const rs = await m.testHandlerE2e();
    for (const r of rs) {
      if (r.skip) {
        console.log(`SKIP | ${r.name}\n      reason: ${String(r.detail).slice(0, 400)}`);
        continue;
      }
      console.log(`${r.pass ? "OK  " : "FAIL"} | ${r.name}${r.pass ? "" : "\n      detail: " + String(r.detail).slice(0, 400)}`);
    }
    const counted = rs.filter((r: any) => !r.skip);
    console.log(`passed ${counted.filter((r: any) => r.pass).length}/${counted.length} (+${rs.length - counted.length} SKIP)`);
    await m.teardownCtx();
    process.exit(0);
  } catch (err: any) {
    console.error("THROWN:", err?.stack || String(err));
    try { await m.teardownCtx(); } catch {}
    process.exit(3);
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
