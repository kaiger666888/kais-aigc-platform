import { readFile, writeFile } from "fs/promises";
import getPath from "@/utils/getPath";
import fs from "fs";
import path from "path";
import knex from "knex";
import initDB from "@/lib/initDB";
// import fixDB from "@/lib/fixDB";
import type { DB } from "@/types/database";
import crypto from "crypto";
import fixDB from "@/lib/fixDB";
import { loadAllFromDB } from "@/skills/loader";
import { seedDefaultIfEmpty } from "@/skills/defaultSkill";

type TableName = keyof DB & string;
type RowType<TName extends TableName> = DB[TName];

const dbPath = getPath("db2.sqlite");
console.log("数据库目录:", dbPath);
const dbDir = path.dirname(dbPath);

// 确保数据库目录存在
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 创建空数据库文件
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, "");
}

const db = knex({
  client: "better-sqlite3",
  connection: {
    filename: dbPath,
  },
  useNullAsDefault: true,
});

// CR-02 fix: expose a bootReady promise so the HTTP entrypoint (src/app.ts)
// can `await bootReady` before `server.listen()`. Without this, the IIFE runs
// concurrently with HTTP startup and a request arriving between listen() and
// seedDefaultIfEmpty() completion sees an empty registry (breaks SC #1 — empty-
// DB boot must return movie-v1 from GET /api/v1/skills). Resolves `void` on
// success OR failure — on failure we log and still resolve so the server
// starts and routes can return [] / 404 gracefully rather than hanging boot.
let _resolveBoot: () => void;
export const bootReady: Promise<void> = new Promise((resolve) => {
  _resolveBoot = resolve;
});
(async () => {
  try {
    await initDB(db);
    await fixDB(db);
    await loadAllFromDB(db);
    await seedDefaultIfEmpty(db);
    if (process.env.NODE_ENV === "dev") initKnexType(db);
  } catch (err) {
    console.error("[db] boot failed:", err);
    // resolve anyway so app.ts listen proceeds; routes will return [] / 404
    // gracefully (registry will be empty / partially populated).
  } finally {
    _resolveBoot!();
  }
})();

const dbClient = Object.assign(<TName extends TableName>(table: TName) => db<RowType<TName>, RowType<TName>[]>(table), db);
dbClient.schema = db.schema;
export default dbClient;

export { db };

async function initKnexType(knexDb: any) {
  const { Client } = await import("@rmp135/sql-ts");
  const outFile = "src/types/database.d.ts";
  const dbClient = Client.fromConfig({
    interfaceNameFormat: "${table}",
    typeMap: {
      number: ["bigint"],
      string: ["text", "varchar", "char"],
    },
  }).fetchDatabase(knexDb);
  const declarations = await dbClient.toTypescript();
  const dbObject = await dbClient.toObject();
  const customHeader = `//该文件由脚本自动生成，请勿手动修改`;
  // 清除上次的注释头
  let declBody = declarations.replace(/^\/\*[\s\S]*?\*\/\s*/, "");
  declBody = declBody.replace(/(\n\s*)\/\*([^*][\s\S]*?)\*\//g, "$1/**$2*/");
  const tableInterfaces = dbObject.schemas.flatMap((schema) => schema.tables.map((table) => table.interfaceName));
  const aggregateTypes = `
export interface DB {
${tableInterfaces.map((name) => `  ${JSON.stringify(name)}: ${name};`).join("\n")}
}
`;
  // 哈希仅基于结构化信息，header和空格不算
  const hashSource = JSON.stringify({
    tableInterfaces,
    declBody,
  });
  const hash = crypto.createHash("md5").update(hashSource).digest("hex");
  // 文件内容
  const content = `// @db-hash ${hash}\n${customHeader}\n\n` + declBody + aggregateTypes;
  let needWrite = true;
  try {
    const current = await readFile(outFile, "utf8");
    // 文件头已存在相同 hash，不需要写
    const match = current.match(/^\/\/\s*@db-hash\s*([a-zA-Z0-9]+)\n/);
    const currentHash = match ? match[1] : null;
    if (currentHash === hash) {
      needWrite = false;
    }
  } catch (err) {
    needWrite = true;
  }
  if (needWrite) await writeFile(outFile, content, "utf8");
}
