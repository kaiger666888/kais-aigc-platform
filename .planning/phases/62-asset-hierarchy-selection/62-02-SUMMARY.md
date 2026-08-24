---
phase: 62-asset-hierarchy-selection
plan: "02"
subsystem: api
tags: [generation-config, sqlite, knex, express, three-source-merge, requirement-json, optimistic-lock]
completed: 2026-08-24
duration: ~25min

# Dependency graph
requires:
  - phase: 62-01 (wave 1, parallel)
    provides: 前端键面常量表口径(RESEARCH F 修正版 11+3+18)——本 plan 服务端拷贝逐键对齐,键集相等由 62-07 S-门锁
provides:
  - generation_config_overrides 表(复合 PK project_id+episodes_id+phase_key,boot 幂等建表零迁移)
  - canvasRelationalStore CRUD:list/upsert(全 null=删行)/deleteGenerationConfigOverride
  - GET /api/canvas/v2/generation-config(rows 三源合并 UI-SPEC C8 形状 + fileState)
  - PUT /api/canvas/v2/generation-config/overrides/:phaseKey(writeState 三态 + D-10 服务端钳制兜底)
  - src/lib/generationConfigService.ts 纯函数层(14 键表/两段寻址/tmp+rename+mtime 乐观锁写回/三源合并,fs 全注入可 node:test)
affects: [62-03 (mock 扩面对接本路由形状), 62-06 (冗余配置 UI 消费 rows/writeState), 62-07 (e2e 断言面 + S-门键集相等锁)]

# Tech tracking
tech-stack:
  added: [] # 零新依赖(knex/better-sqlite3/zod/express 既有,T-62-SC)
  patterns:
    - gate-state.ts→gateStateService 先例的 route 薄壳 + lib service 位点(generationConfigService 零 db/零 fs import,FsLike 结构注入)
    - boot 时 relationalCanvasTables append 幂等建表(RESEARCH A 零迁移风险)
    - raw INSERT ON CONFLICT DO UPDATE(upsertNode 先例)复合 PK UPSERT
    - best-effort 文件面三态如实(synced|file-fail|override),EACCES/stale 绝不假成功

key-files:
  created:
    - src/lib/generationConfigService.ts
    - src/lib/__tests__/generationConfig.test.ts
    - src/routes/canvas/v2/generation-config.ts
  modified:
    - src/lib/initDB.ts (relationalCanvasTables append 新表 builder)
    - src/lib/canvasRelationalStore.ts (追加 Generation Config Overrides 区段三函数)
    - src/router.ts (route171 import + 挂载)

decisions:
  - "requirement.json 寻址第一段落地为专用 env GENERATION_CONFIG_REQUIREMENT_FILE(绝对路径,.json 后缀守卫 T-62-05);不复用语义分裂的 KAIS_OUTPUT_DIR"
  - "pipeRoot = OUTPUT_DIR(默认 /mnt/agents/output)拼 /pipelines;段二 pipe-* 按 JSON.project_id||projectId 字符串等值过滤取 mtime 最新"
  - "resolveRequirementFile 返回 {path,mtime,state,values} 超集(plan 契约 {path,state} 的超集)——GET 单次读完成寻址+分类,PUT 复用同一 mtime 作乐观锁基准"
  - "z.coerce.number().nullable() 安全:null 在 ZodNullable 层短路不走 Number(null)=0,null 清旋钮语义保真"
  - "上界 >99 显式 400(T-62-04 防巨值写库);pre<1 与 final 越界走 clampRedundancy 静默钳制(D-10 khs resolver 同式)"
---

# Phase 62 Plan 02: 冗余配置服务端半壁(覆盖层表+CRUD+路由) Summary

**HIER-03 P4/P5:generation_config_overrides 覆盖层表 + canvasRelationalStore CRUD + v2 generation-config 路由(GET 三源合并 / PUT 两段式+writeState 三态)+ 服务端键面拷贝纯函数层,node:test 19 用例全绿。**

## Tasks Completed

| Task | Name | Commit | Key Files |
| ---- | ---- | ------ | --------- |
| 1 | initDB append 新表 + canvasRelationalStore CRUD | 9aa387e8 | src/lib/initDB.ts, src/lib/canvasRelationalStore.ts |
| 2 | 服务端键面拷贝 + 三源合并/寻址/写回纯函数 + node:test | e9796c5e | src/lib/generationConfigService.ts, src/lib/__tests__/generationConfig.test.ts |
| 3 | generation-config 路由(GET/PUT)+ router 挂载 | f9f8ca90 | src/routes/canvas/v2/generation-config.ts, src/router.ts |

## What Was Built

1. **覆盖层表(Task 1)**:`generation_config_overrides` 三列复合 PK + n_candidates/final_candidates 可空列(半覆盖)+ idx_gco_scope,append 于 relationalCanvasTables 数组末尾,boot hasTable 守卫幂等建表——10588 实例重启即得,零独立迁移脚本。
2. **store CRUD(Task 1)**:`listGenerationConfigOverrides`(主键序)/`upsertGenerationConfigOverride`(raw ON CONFLICT merge;两值全 null 改 DELETE 行)/`deleteGenerationConfigOverride`,沿 upsertNode/getMeta 先例形态。
3. **纯函数层(Task 2)**:generationConfigService.ts 零 db/零 fs import——14 键表(11 嵌套+3 扁平,tier/默认/preCap1/unwired/gpuHint/note 逐字 RESEARCH F 口径)+ LOCKED(tts+18 汇总不枚举)+ clampRedundancy(effectivePre 基准)+ readRequirementConfig(requirement|legacy|not-found 三态,读失败不抛)+ resolveRequirementFile(两段寻址)+ applyRequirementWrite(tmp+rename+mtime 乐观锁,任一步 throw → file-fail)+ mergeThreeSources(值级 override>requirement>快照;行级较强源;legacy 带 sourceLegacy 角标)。
4. **路由(Task 3)**:GET rows 按 UI-SPEC C8 形状({phaseKey,tier,label,pre,final,source,sourceLegacy?,editable,unwired?,gpuHint?,note?})+ fileState;PUT 校验链 白名单→上界 99→preCap1 400「确定性派生 · pre 固定为 1」→clamp→权威落库→best-effort 写回,writeState ∈ synced|file-fail|override;文件面任何失败不改 HTTP 200。判错看 HTTP status(error 信封 body.code 恒 400 陷阱已在文件头 pin)。router.ts route171 挂载。

## Verification Results

- `npx tsc --noEmit` 零错误(每 task 后 + 收尾共跑 4 次);
- `node --import tsx --test src/lib/__tests__/generationConfig.test.ts`:**19/19 全绿**(三源优先级/半覆盖/哨兵回落/legacy 降级/读失败同态/写回 synced·EACCES·stale 三态/null 清旋钮条目移除/钳制四象限/两段寻址 envFile 优先·双字符串键过滤·mtime 最新·零命中 null);测试全程内存 fake FsLike,**零真实磁盘副作用**;
- 四锚 grep 在场:新表(initDB)、upsertGenerationConfigOverride(store)、挂载(router ×2)、GENERATION_CONFIG_REQUIREMENT_FILE(service+route);
- 三个 commit 合计恰触 files_modified 的 6 个文件,零删除,src/ 工作树干净。

## Deviations from Plan

无实质偏差。两处契约内微调:

1. **[Discretion] resolveRequirementFile 返回形状超集**:plan 记 `{ path, state }`,实现返回 `{ path, mtime, state, values }`——GET 单次读即完成寻址+分类(mtime 是 PUT 乐观锁必需输入,values 免二次读盘);plan 的 `{path,state}` 为其子集,e2e/UI 消费面不受影响。
2. **[Discretion] mergeThreeSources 参数名 overrideRows**(plan 文记 overrideRow):GET 需 scope 全行合并,数组入参(兼收 Record);行为与 plan 描述逐条一致。

执行中自愈一处笔误(Rule 1):service JSDoc 注释内 `pipe-*/` 序列提前终止注释块导致 esbuild 解析错——改写措辞后 19 用例全绿(该修复在 Task 2 commit 前,未产生额外 commit)。

## Known Stubs

None — 所有数据通路已接线:GET 读真实 DB 表+真实文件面,PUT 落真实覆盖层+真实 best-effort 写回。本机 pipe-* 写恒 EACCES 属部署实况而非 stub——writeState='file-fail' 即该实况的设计验证面(T-62-07,62-07 e2e 双 fixture 断言)。

## Notes for Downstream Plans

- **62-03(mock)**:镜像本路由 GET `{rows,fileState}` / PUT `{phaseKey,writeState}` 形状即可;mock 无需真文件面,按 writeState 三态脚本化。
- **62-06(UI)**:rows 元素 editable 恒 true(14 键全部可写,unwired 键带 unwired:true 标注「运行时暂不消费」);lockReason 不出现在 rows(锁定区不入 rows,tts/reportAudit 走 LOCKED_CONFIG_KEYS 折叠区)。
- **62-07(S-门/e2e)**:键集相等锁 = GENERATION_CONFIG_KEYS.phaseKey 集合(前端 62-01 表 vs 本文件);D-12 键面漂移锚已就位。
