---
phase: 57-portal-delivery-pages
plan: 04
subsystem: server
tags: [express, injection, static-islands, custom-element, navbar]
requires: [57-02]
provides:
  - islandNavInjector.ts（createIslandNavInjector：岛 index.html serve 时 navbar 注入——幂等/mtime 缓存/fail-loud 透传/不写磁盘）
  - app.ts 两岛接线（根路径 + extensionless SPA fallback 注入;带扩展名请求不经注入）
affects: [57-08 聚合验证]
key-files:
  created: [src/lib/islandNavInjector.ts]
  modified: [src/app.ts]
key-decisions:
  - decision: 岛根注入 handler 注册在根 webDir static 之前（而非计划原文的「岛段内」）
    rationale: 根 static（app.ts:186 webDir mount）对 /story-map/ 与 /director-desk/ 直接命中 <webDir>/<岛>/index.html,晚注册的岛根路由永不触发——首版按计划字面落位时根路径 0 注入（live curl 证伪后修复）;handler 实例单建,岛段 fallback 复用同缓存。
  - decision: 未命中的带扩展名请求从「被 index.html 吞成 200」改为交 404
    rationale: 计划明文「带扩展名请求仍 express.static 直出」;未命中资产旧态被 index 掩蔽是既有缺陷（arch-proxy extension-aware fallback 注释明载同一修复先例）——两岛自有资产全存在,零破坏。
  - decision: 注入三件套全插 <body> 开标签后（含 <link>）
    rationale: UI-SPEC P-1 注入档原文如此;body 内 stylesheet 合法且阻塞后续渲染,避免导航闪无样式;kap-navbar 文档流置顶（非 fixed）,story-map 自有 sticky Navbar 在其下共存（Pitfall 6 设计即双层）。
  - decision: mtimeMs+size 双键缓存（非 inode）
    rationale: story-map rm -rf 重部署后 inode 变但 fs.stat 不读 inode 也可比;mtimeMs 变化即失效,足够覆盖重部署语义且零额外系统调用。
patterns-established:
  - "serve 时 HTML 注入：路由级 handler 直读直改 + 记忆化缓存（非 res 流拦截/monkey-patch send）——零 express 内部面依赖"
requirements-completed: [PORTAL-02 四岛共脸收口]
duration: 40 min
completed: 2026-08-22T10:35:00+08:00
---

# Phase 57 Plan 04: story-map / director-desk serve 时 navbar 注入 Summary

D-07 落地:两静态岛 index.html 响应被注入共享 navbar（<kap-navbar data-active> + /assets/kap-nav.{css,js}）——四岛共脸收口:门户(57-02) + 画布(57-03) + 两静态岛(本 plan) + Toonflow(57-02 嵌入页),任一页可抵其余三套。

**Tasks:** 1/1 · **Commits:** 1（6f163cf1）· **Files:** 1 created + 1 modified

## 验证证据（live,systemd kais-aigc-platform @10588,restart 后）

- `curl /story-map/` 与 `/director-desk/` 恰好 **1 处 kap-navbar** 且 `data-active="story-map"/"director-desk"` 精确命中;三件套引用齐（kap-nav.css ×1 + kap-nav.js ×1）;注入形态逐字 = `<link …><kap-navbar …></kap-navbar><script defer …>`（body 开标签后）
- 幂等:重复请求仍 1;裸前缀（/story-map、/director-desk）也注入（不再 301 后漏注）
- SPA 子路由 `/story-map/some-spa-route`、`/director-desk/deep/link` 含注入（extensionless fallback 走注入）
- 带扩展名资产 `/story-map/assets/index-ZlW0egw4.js` 200 且 **0 注入**;未命中扩展名资产 → 404（不再被 index 吞）
- `git status data/web/story-map data/web/director-desk` **零改动**（不写磁盘,Do-Not-Regress 9）
- `/` 仍 Toonflow 200（共存零破坏,Do-Not-Regress 6）
- headless 浏览器:注入元素升级成功——6 链接、当前项 剧核/3D导演台（aria-current）、40px 全宽档、CSS 生效（display:flex）
- `node scripts/build-kap-nav.mjs` 重跑产物 hash 不变（455269da）;根 `tsc --noEmit`/`npm run lint` 0

## Deviations

1. **岛根 handler 落位提前到根 webDir static 之前**（关键修复）:计划接口写「app.ts:187-204 岛段改造」,但根 static mount 对岛根 index 有先行命中权——按计划字面落位后 live curl 证伪（根路径 0 注入、SPA 路由 1）。修复=注入 handler 上提至根 static 前;岛段保留资产 static + fallback。语义与计划一致,落位按真实注册序修正。
2. **未命中扩展名请求 404 化**（见 key-decisions;旧态 200-index-掩蔽属缺陷面,顺带修复并记录）。
3. 计划 verify 里 `curl -sI … | grep -qi "200\|content-length"` 简化为 `-w %{http_code}` 精确断言（同义）。

## 运维注记

- 改 injector/app.ts 后需 `sudo -n systemctl restart kais-aigc-platform`（ExecStartPre 自动 build --check）。
- story-map 重部署（rm -rf）后无需任何操作——mtime 缓存自动失效重注。

---

Ready for 57-05（交付页数据面）。
