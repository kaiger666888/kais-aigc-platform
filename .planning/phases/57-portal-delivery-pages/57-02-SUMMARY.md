---
phase: 57-portal-delivery-pages
plan: 02
subsystem: ui
tags: [portal, vite, custom-element, express-static, deep-link, react-19]
requires: []
provides:
  - packages/portal 新前端包（vite base '/portal/'，@/@ic alias，3 路由 pathname switch，零 router 库）
  - app.ts 门户段：/portal static + /deliver /toonflow SPA fallback（全局 fallback 之前）+ /canvas 302 白名单翻译（D-05）
  - KapNavbar vanilla custom element 单源（kap-navbar，light DOM，data-active/compact 双档）+ build-kap-nav.mjs 产物链（IIFE js + tokens concat css → data/assets/kap-nav.<hash8>.* + 稳定名 + latest.json manifest）
  - 门户首页三件套：项目分节 + 28px 集行 + 管线带 micro（22 段/sub 60%/weak 填充+顶边线/发丝空段/hover tooltip）+ [画布][交付] ghost 深链发码
  - projects.ts episodes[].phases 直方图（additive，U-08）
  - ribbon.ts 纯函数 + vitest 8 断言（22 段/sortKey/sub 集/filled/href 三组）
affects: [57-03 画布深链消费, 57-04 静态站注入, 57-05 交付页数据面, 57-08 聚合验证]
key-files:
  created: [packages/portal/**, scripts/build-kap-nav.mjs, scripts/deploy-portal.sh]
  modified: [src/app.ts, src/routes/canvas/projects.ts]
key-decisions:
  - decision: navbar 注册走文档壳（index.html 静态 <kap-navbar> + main.tsx bundler 副作用 import，define 幂等守卫）
    rationale: curl /portal/ HTML 需含 kap-navbar（探活断言）；预升级渲染 + 双通道不冲突（守卫防双注册）。
  - decision: 直方图口径 RIBBON_TYPES（asset/reference/script/storyboard/audio/video），排除 zone/phase/suggestion/variant
    rationale: DB 实测 zone 行也带 phase_index（P09 lane zone=2 等），计入会让每段恒 filled，管线带失真。
  - decision: deploy-portal.sh 部署期把 dist/index.html 的 kap-nav.css 稳定名 sed 为 hash 名
    rationale: /assets maxAge 1d 缓存破坏；源文件保持干净（sed 只打 dist）。
  - decision: micro 档段为 <span> 非计划原文的 <button>
    rationale: 整条外层已是 <a>（集级深链），交互元素嵌交互元素是无效 HTML；micro 段无独立动作，full 档（57-05）段级 zone 跳转再上可聚焦元素。
patterns-established:
  - "shell-mounted custom element：静态壳元素 + bundler 注册 + 幂等 define 守卫（三宿主单源范式，57-03/04 复用）"
  - "构建期 tokens concat（tokens.css + 组件 css → 单产物，token 零复制）"
requirements-completed: [PORTAL-01, PORTAL-02]
duration: 95 min
completed: 2026-08-22T09:35:00+08:00
---

# Phase 57 Plan 02: 门户壳骨架 + KapNavbar + 门户首页 Summary

三路由可运行（/portal、/deliver/:ep、/toonflow 同壳不被全局 fallback 吞）+ /canvas 302 深链白名单翻译 + navbar 单源产物链 + 门户首页（项目分节/集行/管线带 micro/深链发码）+ projects.ts phases 直方图 additive 落地。

**Tasks:** 3/3 · **Commits:** 3（2f970b23 / 7aee510f / 17faa8a0）· **Files:** 16 created + 2 modified

## 验证证据（live，systemd kais-aigc-platform.service @10588）

- `curl /portal/`、`/deliver/1`、`/toonflow` → 均含 `<title>制片门户</title>`（Pitfall 1 反向断言过）
- `/canvas?project=3&ep=1&focus=n-abc&zone=p11b` → `Location: /infinite-canvas/?projectId=3&episodesId=1&focus=n-abc&zone=p11b`（精确）
- `/` 仍 Toonflow 200；`POST /api/canvas/projects` 200 → `projects: 63 | ep0: {"id":2,"nodeCount":8,"phases":{"0":3}}` → PHASES-OK（数据面非 NO-DATA-SKIP）
- `data/assets/kap-nav.455269da.{js,css}` 经 /assets 200；js 含 `kap-navbar`；产物 css 含 `--cv-bg-panel` ×3（concat 生效）；`kap-nav.css` 源零 hex（grep = 0）
- `/portal/` HTML 引用 hash 名 css（deploy sed 生效）且含 `kap-navbar`
- vitest 8/8 绿；`tsc -p packages/portal --noEmit` 绿；根 `npm run lint` 绿；`packages/infinite-canvas tsc -b` 绿（跨包 import 零破坏）
- `grep "P0[1-9]|选题" PipelineRibbon.tsx` 为空（词汇全来自 PHASE_REGISTRY）

## Deviations

1. **sub 段 7 非计划的 6**：UI-SPEC/PLAN 列 {P03.5,P09b,P09c,P10c,P11a0,P11c}，但 PHASE_REGISTRY（55 契约测试守护的 SSOT）中 **P08 场景选择也是 sub:true**。ribbon 只跟随注册表（禁内联增删），测试断言注册表真值 7 段并注明偏差。
2. **Express 5 `{*path}` 不匹配裸前缀**：`/toonflow`、`/deliver`（无斜杠）不命中 `/toonflow/{*path}` → 补注册裸路径 GET 处理器（/portal 经 static 301 已覆盖）。
3. **micro 段 <span> 非 <button>**：整条外层 <a> 内嵌 button 是无效 HTML 嵌套；full 档（57-05）段级 zone 跳转再上可聚焦段元素。
4. **生产服务是 systemd 跑 built bundle**（非 nodemon dev）：app.ts 改动需 `systemctl restart`（ExecStartPre 自动 build.js --check）后活体验证。
5. portal `package-lock.json` 被根 .gitignore 拦截未提交（仓库用 yarn lock 的既有约定）；依赖版本与 infinite-canvas 逐字一致，零新增外部包（router/UI 库 grep = 0）。

## 运维注记

- 部署链：`bash scripts/deploy-portal.sh`（自动先跑 build-kap-nav + dist sed hash 化 + .bak 备份）；改 app.ts 后需 restart service。
- 交付页/嵌入页为壳与空态，数据面在 57-05/06；画布 focus/zone 消费在 57-03。

---

Ready for 57-03（画布深链消费 + topbar 内嵌 navbar compact）。
