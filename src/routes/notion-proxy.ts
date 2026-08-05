/**
 * Notion API 代理 —— 创作文档嵌入
 *
 * Notion CSP `frame-ancestors` 不允许 iframe 嵌入, 必须用 Notion API 读取内容渲染。
 *
 * 路由:
 *   GET  /api/notion/pages?projectId=X
 *       → 返回项目主页面下的子页面列表 (只读一层 child_page blocks)
 *
 *   POST /api/notion/page/:pageId
 *       → 递归读取 Notion 页面 block 树 (最多 3 层深), 返回结构化 JSON
 *
 * 缓存: 5 分钟内存 Map (key = `endpoint:param`)
 * 限速: Notion API ~3 req/s, 递归读取时每次子请求间隔 sleep(300ms)
 *
 * Token: process.env.NOTION_TOKEN
 * 请求头: Notion-Version: 2022-06-28
 */
import express from "express";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

const NOTION_TOKEN = process.env.NOTION_TOKEN || "";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const MAX_DEPTH = 3; // 递归深度上限
const SLEEP_MS = 300; // Notion ~3 req/s 限速间隔

// ─── 项目 Notion 配置 (硬编码) ─────────────────────────────────

const PROJECT_NOTION_PAGES: Record<number, { mainPageId: string; title: string }> = {
  1785508691757: {
    mainPageId: "3ae11082-af8e-80ad-8af7-eada9c3416f0",
    title: "她从深渊归来",
  },
};

// ─── 内存缓存 ─────────────────────────────────────────────────

interface CacheEntry {
  ts: number;
  data: any;
}
const cache = new Map<string, CacheEntry>();

function getCached<T>(key: string): T | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return e.data as T;
}

function setCached(key: string, data: any): void {
  cache.set(key, { ts: Date.now(), data });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Notion HTTP 封装 ─────────────────────────────────────────

function notionHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  [k: string]: any;
}

/** 拉取一个 block 的所有 children (自动翻页)。 */
async function fetchBlockChildren(blockId: string): Promise<NotionBlock[]> {
  const all: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`${NOTION_API}/blocks/${blockId}/children`);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("start_cursor", cursor);

    const resp = await fetch(url, { headers: notionHeaders() });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Notion blocks/${blockId}/children ${resp.status}: ${txt}`);
    }
    const data = (await resp.json()) as { results: NotionBlock[]; has_more: boolean; next_cursor?: string };
    all.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
    if (cursor) await sleep(SLEEP_MS);
  } while (cursor);
  return all;
}

/** 递归读取 block 树, 提取结构化内容。深度限制 MAX_DEPTH。 */
async function fetchBlockTree(blockId: string, depth: number): Promise<NotionBlock[]> {
  if (depth >= MAX_DEPTH) return [];
  const children = await fetchBlockChildren(blockId);
  for (const child of children) {
    if (child.has_children) {
      await sleep(SLEEP_MS);
      try {
        const sub = await fetchBlockTree(child.id, depth + 1);
        (child as any)._children = sub;
      } catch (err: any) {
        (child as any)._childrenError = err?.message || String(err);
      }
    }
  }
  return children;
}

// ─── GET /api/notion/pages ─────────────────────────────────────

router.get("/pages", async (req, res) => {
  if (!NOTION_TOKEN) {
    return res.status(500).send(error("NOTION_TOKEN 未配置 (process.env.NOTION_TOKEN)"));
  }
  const projectIdRaw = (req.query.projectId ?? req.query.project_id) as string | undefined;
  const projectId = projectIdRaw != null ? parseInt(projectIdRaw, 10) : NaN;
  if (isNaN(projectId)) {
    return res.status(400).send(error("缺少或无效的 projectId 查询参数"));
  }
  const cfg = PROJECT_NOTION_PAGES[projectId];
  if (!cfg) {
    return res.status(404).send(error(`项目 ${projectId} 未配置 Notion 文档`));
  }

  const cacheKey = `pages:${projectId}`;
  const cached = getCached<any>(cacheKey);
  if (cached) return res.status(200).send(success(cached));

  try {
    // 只读一层 child_page blocks → 子页面目录列表
    const blocks = await fetchBlockChildren(cfg.mainPageId);
    const pages = blocks
      .filter((b) => b.type === "child_page")
      .map((b) => {
        const cp = b.child_page || {};
        return {
          id: b.id,
          title: cp.title || "(未命名)",
          icon: cp.icon?.emoji || "📄",
        };
      });

    const payload = { projectId, mainPageId: cfg.mainPageId, title: cfg.title, pages };
    setCached(cacheKey, payload);
    return res.status(200).send(success(payload));
  } catch (err: any) {
    console.error("[notion-proxy/pages] 失败:", err);
    return res.status(502).send(error("读取 Notion 页面目录失败: " + err.message));
  }
});

// ─── POST /api/notion/page/:pageId ─────────────────────────────

router.post("/page/:pageId", async (req, res) => {
  if (!NOTION_TOKEN) {
    return res.status(500).send(error("NOTION_TOKEN 未配置 (process.env.NOTION_TOKEN)"));
  }
  const pageId = req.params.pageId;
  if (!pageId) return res.status(400).send(error("缺少 pageId 路径参数"));

  // query 参数 forceRefresh=1 跳过缓存
  const force = req.query.forceRefresh === "1" || req.query.force_refresh === "1";
  const cacheKey = `page:${pageId}`;
  if (!force) {
    const cached = getCached<any>(cacheKey);
    if (cached) return res.status(200).send(success(cached));
  }

  try {
    // 1) 读取页面 meta (标题)
    let title = "";
    try {
      const pageResp = await fetch(`${NOTION_API}/pages/${pageId}`, { headers: notionHeaders() });
      if (pageResp.ok) {
        const pageData = await pageResp.json();
        const propKeys = Object.keys(pageData.properties || {});
        for (const k of propKeys) {
          const prop = pageData.properties[k];
          if (prop && prop.type === "title") {
            title = (prop.title || []).map((t: any) => t.plain_text || "").join("");
            break;
          }
        }
      }
    } catch {
      // 标题读取失败不阻断
    }

    await sleep(SLEEP_MS);

    // 2) 递归读取 block 树
    const blocks = await fetchBlockTree(pageId, 0);
    const payload = { pageId, title, blocks };
    setCached(cacheKey, payload);
    return res.status(200).send(success(payload));
  } catch (err: any) {
    console.error("[notion-proxy/page] 失败:", err);
    return res.status(502).send(error("读取 Notion 页面内容失败: " + err.message));
  }
});

export default router;
