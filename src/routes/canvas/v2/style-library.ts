import express from "express";
import { z } from "zod";
import fsp from "node:fs/promises";
import path from "node:path";
import { success, error } from "@/lib/responseFormat";
import getPath from "@/utils/getPath";

const router = express.Router();

/**
 * GET/静态 — Krea 2 StyleSwitching 风格库 (2026-09-06, wt/style-library)。
 *
 * 数据源 data/style-library/styles_master.json(3548 条,Krea 2 官方风格库抓取
 * 清洗合并) + thumbs/<id>.webp 本地镜像。与 art_skills(11 套重风格 prefix.md)
 * 并存互补:本库是轻量风格词库,只供画布风格选择器取 prompt,不进管线。
 * o_artStyle 旧机制有意不动(另一套,别混)。
 *
 * 无表化理由(任务书二选一): 3548 条纯只读静态数据,JSON 加载 <100ms 且已随仓
 * 分发,建表(seed 脚本+迁移+双写)零收益;mtime 热重载已覆盖「改 JSON 立即生效」。
 *
 * 路由(挂 /api/canvas/v2/style-library):
 *   GET /categories                一级分类计数(count 降序;含 group_en/group_cn
 *                                  供前端聚合一级 tab;includeRejected 缺省 true —
 *                                  验收契约:全类目计数合计=3548)
 *   GET /list?category=&group=&search=&page=&pageSize=&includeRejected=
 *                                  分页列表;search 匹配 name/name_cn 大小写不敏感;
 *                                  includeRejected 缺省 false —— probe_verdict
 *                                  ='reject'(Kai 终审唯一 1 条 glitch)默认隐藏,
 *                                  前端「显示已否决」开关显式传 true
 *   GET /item?id=                  单条完整定义(含 prompt 模板占位符语义说明)
 *   GET /thumbs/<encodeURIComponent(id)>.webp   缩略图静态服务(express.static,
 *                                  与 app.ts 各静态挂载同款 maxAge/cacheControl)
 *
 * probe_verdict: Z-Image Turbo 迁移探针 Kai 终审,20 条有值(pass/fix)、其余 null;
 * 值由 data/style-library/inject_probe_verdict.py 烧进 JSON(数据与代码分离,扩量
 * 只改数据),本路由只透传不硬编码。
 */

// ─── 数据加载(mtime 热重载 + 进程内缓存)────────────────────────────────

interface StyleRow {
  id: string;
  name: string;
  name_cn: string;
  category_en: string;
  category_cn: string;
  prompt: string;
  negative_prompt: string;
  probe_verdict: "pass" | "fix" | "reject" | null;
}

interface CategoryRow {
  category_en: string;
  category_cn: string;
  group_en: string;
  group_cn: string;
  count: number;
}

interface Library {
  rows: StyleRow[];
  byId: Map<string, StyleRow>;
  categories: CategoryRow[]; // count 降序
  thumbsDir: string;
}

let cache: { mtimeMs: number; library: Library } | null = null;
let inflight: Promise<Library> | null = null;

function dataFile(): string {
  return getPath("style-library/styles_master.json");
}

/** 一级分类:category_cn 去掉数据源清洗期的语言标签前缀(Xxx_ / Xxx-1_)后取
 *  首个 "-" 前段,如 "Illustration-1_动漫-赛璐璐与插画" → "动漫"。与
 *  category_en 首段(如 "Anime-Cel" → "Anime")一一对应,前端聚合一级 tab 用。 */
function splitGroup(categoryEn: string, categoryCn: string): { group_en: string; group_cn: string } {
  const noTag = categoryCn.includes("_") ? categoryCn.slice(categoryCn.indexOf("_") + 1) : categoryCn;
  const dash = noTag.indexOf("-");
  return {
    group_en: categoryEn.includes("-") ? categoryEn.slice(0, categoryEn.indexOf("-")) : categoryEn,
    group_cn: dash > 0 ? noTag.slice(0, dash) : noTag,
  };
}

async function loadLibrary(): Promise<Library> {
  const st = await fsp.stat(dataFile());
  if (cache && cache.mtimeMs === st.mtimeMs) return cache.library;
  const raw = JSON.parse(await fsp.readFile(dataFile(), "utf8")) as Array<Record<string, unknown>>;
  const rows: StyleRow[] = raw.map((r) => ({
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    name_cn: String(r.name_cn ?? ""),
    category_en: String(r.category_en ?? ""),
    category_cn: String(r.category_cn ?? ""),
    prompt: String(r.prompt ?? ""),
    negative_prompt: String(r.negative_prompt ?? ""),
    probe_verdict: (r.probe_verdict === "pass" || r.probe_verdict === "fix" || r.probe_verdict === "reject"
      ? r.probe_verdict
      : null),
  }));

  // 分类计数(count 降序;同级按 category_en 字典序决胜,保证输出稳定)
  const counter = new Map<string, CategoryRow>();
  for (const r of rows) {
    let cat = counter.get(r.category_en);
    if (!cat) {
      cat = { category_en: r.category_en, category_cn: r.category_cn, ...splitGroup(r.category_en, r.category_cn), count: 0 };
      counter.set(r.category_en, cat);
    }
    cat.count += 1;
  }
  const categories = [...counter.values()].sort(
    (a, b) => b.count - a.count || (a.category_en < b.category_en ? -1 : 1),
  );

  const library: Library = {
    rows,
    byId: new Map(rows.map((r) => [r.id, r])),
    categories,
    thumbsDir: getPath("style-library/thumbs"),
  };
  cache = { mtimeMs: st.mtimeMs, library };
  return library;
}

/** 并发收口:同一时刻只允许一次真实加载(热重载瞬间多请求不重复 parse)。 */
async function getLibrary(): Promise<Library> {
  if (cache) {
    // 快路径:缓存命中仍要 stat 对比 mtime(3548 条 parse 约 40ms,不糊在请求里)
    try {
      const st = await fsp.stat(dataFile());
      if (cache.mtimeMs === st.mtimeMs) return cache.library;
    } catch {
      return cache.library; // 文件暂时不可读(如原子替换瞬间)→ 吐旧缓存
    }
  }
  if (!inflight) {
    inflight = loadLibrary().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

// ─── 缩略图静态服务(express.static,与 app.ts 静态挂载同款参数)───────────

router.use("/thumbs", express.static(getPath("style-library/thumbs"), { acceptRanges: true, maxAge: "1d", cacheControl: true }));

/** thumbUrl 统一在此拼装:相对路径,同源 <img> 直接可用;id 含 "://"、"空格"、
 *  "—" 等字符,一律 encodeURIComponent(serve-static 侧自动 decode 回原文件名)。 */
function thumbUrlOf(id: string): string {
  return `/api/canvas/v2/style-library/thumbs/${encodeURIComponent(id)}.webp`;
}

// ─── Wire schema ──────────────────────────────────────────────────────────

const VERDICTS = ["pass", "fix", "reject"] as const;

const listQuerySchema = z.object({
  category: z.string().max(128).optional(), // 精确 category_en
  group: z.string().max(128).optional(), // 一级分类(group_en 或 group_cn)
  search: z.string().max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(60),
  includeRejected: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const categoriesQuerySchema = z.object({
  // 缺省 true:categories 是全库概览(验收契约合计=3548);前端要在「隐藏否决」
  // 态下显示一致计数时显式传 false。
  includeRejected: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

const itemQuerySchema = z.object({
  id: z.string().min(1).max(256),
});

// ─── Endpoints ────────────────────────────────────────────────────────────

/**
 * GET /api/canvas/v2/style-library/categories
 * → { categories: [{category_en, category_cn, group_en, group_cn, count}] } count 降序
 */
router.get("/categories", async (req, res) => {
  const parse = categoriesQuerySchema.safeParse(req.query);
  if (!parse.success) {
    return res.status(400).send(error("参数校验失败", parse.error.issues));
  }
  try {
    const lib = await getLibrary();
    const filtered = parse.data.includeRejected
      ? lib.categories
      : lib.categories
          .map((c) => ({
            ...c,
            count: lib.rows.filter((r) => r.category_en === c.category_en && r.probe_verdict !== "reject").length,
          }))
          .filter((c) => c.count > 0)
          .sort((a, b) => b.count - a.count || (a.category_en < b.category_en ? -1 : 1));
    return res.status(200).send(success({ categories: filtered }));
  } catch (err) {
    console.error("[canvas:v2/style-library] categories 失败:", err);
    return res.status(500).send(error("风格库分类读取失败", { detail: String((err as Error).message).slice(0, 300) }));
  }
});

/**
 * GET /api/canvas/v2/style-library/list
 * → { total, page, pageSize, items: [{id,name,name_cn,category_en,category_cn,
 *      thumbUrl,prompt,probe_verdict}] }
 */
router.get("/list", async (req, res) => {
  const parse = listQuerySchema.safeParse(req.query);
  if (!parse.success) {
    return res.status(400).send(error("参数校验失败", parse.error.issues));
  }
  const { category, group, search, page, pageSize, includeRejected } = parse.data;
  try {
    const lib = await getLibrary();
    const kw = search?.trim().toLowerCase();
    const rows = lib.rows.filter((r) => {
      if (!includeRejected && r.probe_verdict === "reject") return false;
      if (category != null && r.category_en !== category) return false;
      if (group != null) {
        const g = splitGroup(r.category_en, r.category_cn);
        if (g.group_en !== group && g.group_cn !== group) return false;
      }
      if (kw != null && !r.name.toLowerCase().includes(kw) && !r.name_cn.toLowerCase().includes(kw)) return false;
      return true;
    });
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize).map((r) => ({
      id: r.id,
      name: r.name,
      name_cn: r.name_cn,
      category_en: r.category_en,
      category_cn: r.category_cn,
      thumbUrl: thumbUrlOf(r.id),
      prompt: r.prompt,
      probe_verdict: r.probe_verdict,
    }));
    return res.status(200).send(success({ total: rows.length, page, pageSize, items }));
  } catch (err) {
    console.error("[canvas:v2/style-library] list 失败:", err);
    return res.status(500).send(error("风格库列表读取失败", { detail: String((err as Error).message).slice(0, 300) }));
  }
});

/**
 * GET /api/canvas/v2/style-library/item?id=
 * → 单条完整定义 + usage 语义说明(prompt 模板 "… Subject:{prompt}" 中
 *   {prompt} 为 subject 占位符;留空 = 只用风格词)
 */
router.get("/item", async (req, res) => {
  const parse = itemQuerySchema.safeParse(req.query);
  if (!parse.success) {
    return res.status(400).send(error("参数校验失败", parse.error.issues));
  }
  try {
    const lib = await getLibrary();
    const row = lib.byId.get(parse.data.id);
    if (!row) {
      return res.status(404).send(error(`风格不存在: ${parse.data.id.slice(0, 120)}`));
    }
    return res.status(200).send(
      success({
        ...row,
        thumbUrl: thumbUrlOf(row.id),
        usage: {
          promptTemplate: row.prompt,
          placeholder: "{prompt}",
          placeholderSemantics:
            "{prompt} 为 subject(画面主体)占位符:替换后即为最终提示词;留空则仅用风格词(建议删去结尾 'Subject:' 空占位)",
        },
      }),
    );
  } catch (err) {
    console.error("[canvas:v2/style-library] item 失败:", err);
    return res.status(500).send(error("风格条目读取失败", { detail: String((err as Error).message).slice(0, 300) }));
  }
});

export default router;
