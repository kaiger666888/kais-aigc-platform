/**
 * 重新生成 src/router.ts(src/core.ts generateRouter 的仓内执行入口)。
 *
 * router.ts 由 core.ts 扫描 src/routes 下的 .ts 机械生成,历史上没有脚本入口,
 * 挂载修正只能手编 —— 一旦有人重跑生成逻辑就会回退(08-25 select-winner
 * 错挂成 /api/canvas/v2/select-winner 即此成因)。本入口保证:ROUTE_OVERRIDES
 * 改在 core.ts,重跑这里即可同步 router.ts 且 @routes-hash 一致。
 *
 * 用法: 必须在仓根执行 `npx tsx scripts/regen-router.ts`(core.ts 的 glob 与
 * relative 均依赖 cwd=repo root)。hash 未变时不写文件。
 */
import generateRouter from "../src/core";

generateRouter()
  .then(() => {
    console.log("[regen-router] src/router.ts 已按 src/core.ts 规则重生成(无变化时不写盘)");
  })
  .catch((err) => {
    console.error("[regen-router] 重生成失败:", err);
    process.exit(1);
  });
