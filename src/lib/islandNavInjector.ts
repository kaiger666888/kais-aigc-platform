import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";

/**
 * islandNavInjector.ts — 静态岛共享 navbar 注入(Phase 57-04 / D-07·U-03)。
 *
 * 机制:express serve 时对岛 index.html 的 text/html 响应做后处理——在 <body>
 * 开标签后插入 <kap-navbar data-active> + /assets/kap-nav.{css,js} 引用(57-02
 * 稳定名产物)。选 serve 时而非 deploy 期:director-desk 无部署脚本、story-map
 * 每次 rm -rf 重部署,serve 时单点幂等全覆盖(U-03 裁决)。
 *
 * 红线(UI-SPEC Do-Not-Regress 9):
 *  - 不写磁盘 —— 只在响应流里改写,data/web/ 内容零触碰;
 *  - 幂等 —— 源已含 kap-navbar 则原样透传(防重复嵌套);
 *  - 内存缓存 —— mtimeMs+size 记忆化,文件未变不重读(story-map rm -rf 重部署
 *    后 mtime/inode 变即自动重注);
 *  - fail-loud 不崩 —— stat/read/正则任何异常透传原文件(sendFile)+ 一次性 warn;
 *  - 只由两个固定岛前缀调用,插入内容为静态常量串(activeId 非用户输入),
 *    带扩展名请求不经注入(T-57-04a/b)。
 */

export interface IslandNavInjectorOptions {
  /** 岛静态目录(其下 index.html 为注入对象) */
  islandDir: string;
  /** navbar 当前项 id(story-map / director-desk —— 固定常量,非用户输入) */
  activeId: string;
}

interface InjectCache {
  mtimeMs: number;
  size: number;
  html: string;
}

/** 插入片段:<body> 后——kap-navbar 文档流置顶(position:relative,Pitfall 6 不 fixed 覆盖)。 */
function navSnippet(activeId: string): string {
  return (
    `<link rel="stylesheet" href="/assets/kap-nav.css">` +
    `<kap-navbar data-active="${activeId}"></kap-navbar>` +
    `<script src="/assets/kap-nav.js" defer></script>`
  );
}

/** 与岛挂载段 express.static(maxAge "5m") 对齐的 html 响应头;Content-Length 由 res.send 重算。 */
function sendHtml(res: Response, html: string): void {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300");
  res.send(html);
}

export function createIslandNavInjector(opts: IslandNavInjectorOptions) {
  const { islandDir, activeId } = opts;
  const indexPath = path.join(islandDir, "index.html");
  let cache: InjectCache | null = null;
  let warned = false;
  const warnOnce = (msg: string, err?: unknown): void => {
    if (warned) return;
    warned = true;
    console.warn(`[islandNavInjector:${activeId}] ${msg}`, err ?? "");
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    void req; // 路由已由挂载方限定(岛根/extensionless SPA fallback),handler 不读请求内容
    fs.stat(indexPath, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        warnOnce(`index.html 不可读(${indexPath}),透传原文件路径`, statErr);
        return res.sendFile(indexPath);
      }
      if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
        return sendHtml(res, cache.html);
      }
      fs.readFile(indexPath, "utf8", (readErr, raw) => {
        if (readErr) {
          warnOnce(`index.html 读取失败,透传原文件路径`, readErr);
          return res.sendFile(indexPath);
        }
        let html = raw;
        if (!raw.includes("kap-navbar")) {
          const bodyOpen = /<body[^>]*>/i.exec(raw);
          if (bodyOpen) {
            const at = bodyOpen.index + bodyOpen[0].length;
            html = raw.slice(0, at) + navSnippet(activeId) + raw.slice(at);
          } else {
            warnOnce("index.html 无 <body> 开标签,注入跳过(原样透传)");
          }
        }
        cache = { mtimeMs: stat.mtimeMs, size: stat.size, html };
        return sendHtml(res, html);
      });
    });
  };
}
