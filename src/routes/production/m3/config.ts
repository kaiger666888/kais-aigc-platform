/**
 * m3 — MiniMax-Music3 别名路由 (Kai 决策: Music3 以后简称 m3)
 *
 * 直接 re-export music3 目录的实现, 单一事实源, 不复制代码。
 * 挂载: /api/production/m3/generate + /api/production/m3/status (见 src/router.ts)。
 * 引擎/常量/默认值文档见 ../music3/config.ts。
 */
export * from "../music3/config";
