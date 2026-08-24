#!/usr/bin/env tsx
/**
 * diagnose-60-roundtrip.ts — Phase 60-01 Task 1 真机 save→reload roundtrip
 * id-diff 探针(:10588 部署产物)。
 *
 * 目的(60-RESEARCH F-2 / Pitfall 2「诊断先于修复」): 在动任何 store/loading
 * 修复之前,实证钉死「真机保存后面板收起」的根因层。候选:
 *   ① vm/视图模型 id 派生在 save→reload 往返中不对称(evt_* 合成 / rawData 袋还原)
 *   ② loadInitialGraph setLoading(true) 造成的卸载闪断
 *   ③ 其他
 * 本探针只管 ①的服务端+客户端数据面:setGraph L445-446 已按 id 重锚,若 roundtrip
 * id 全链稳定,则 store 层重锚语义已足够(60-03 分支 A);任一层漂移则修对应层(分支 B)。
 *
 * 段(全链复现客户端 roundtrip,probe-59-real 范式):
 *   (a) scope 选择: SCOPES=[[2,1],[2001,1]] 遍历 + load-v2 200 + MIGRATE_SUPPORTED
 *       全图校验(migrate 不支持的 V2 类型会让 adaptV2Graph 降级空图,59-04 实测);
 *       全部不可达 → 打印 SKIP 理由 exit 2(RESEARCH Environment Availability 条款)。
 *   (b) roundtrip: loadA = loadV2(pid,eid).data → adaptedA = adaptV2Graph(loadA)
 *       → wire = serializeGraphToV2(adaptedA.graph, adaptedA.rawDataByNodeId)
 *       → POST save-v2 {projectId, episodesId, graph: wire} → loadC = loadV2().data
 *       → adaptedC = adaptV2Graph(loadC)。
 *   (c) 三层 id diff(逐层 PASS/FAIL + 双向差集精确计数):
 *       层1 V2(服务端重组稳定性): loadA.nodes id 集 vs loadC.nodes id 集;
 *           另附 wire→loadC 服务端纯透传差集(层1 非零时的归因器: 非零但 wire→loadC
 *           为零 = 客户端 serialize/adapter 折叠,非服务端漂移——60-03 修点名层)。
 *       层2 V3(完整客户端往返): adaptedA.graph.nodes id 集 vs adaptedC 同;
 *       层3 evt_*(事件重合成确定性): adaptedA/adaptedC 中 evt_ 前缀 id 子集单列比对;
 *       锚点抽检: adaptedA 首个 kind==='asset' 节点 id 断言在 adaptedC 同 id 存在
 *       (detailNode 重锚的最小情形)+ V2 侧首个非 evt 节点同检。
 *   (d) exit 契约: --strict 时任一层差集非空 → exit 1;:10588 不可达 → exit 2;
 *       零漂移 → exit 0。默认(无 flag)只打印报告 exit 0。
 *   (e) finally 零足迹(T-60-01a + review-60 CR-01 恢复守卫): 恢复前先 load-v2
 *       核对当前服务器态 === 探针最后已知态 lastKnownServer(初始 loadA,写库
 *       成功后刷新为 loadC);漂移 = 探针窗口内有并发写(kmc pipeline/画布客户端)
 *       → 放弃恢复、保留并发写入、FAIL + exit 1 交人工对账(不盲写覆盖——静默
 *       数据丢失向量);无漂移且探针写过库 → saveV2(pid, eid, loadA 原图
 *       verbatim) → ≤15s 轮询 load-v2,stripUpdatedAt 深比对全等;不等 →
 *       firstDiff 输出 + exit 1(footprint 失败即探针失败,probe-59-real 同款
 *       纪律);探针未写库 → 跳过回存(净足迹=0,不再制造无谓写库+广播)。
 *
 * ⚠ 导入纪律(probe 实测,2026-08-24): adapter.ts/serialize.ts 内部 import
 * '@kais/flowgraph-v3'(exports-only 包)——root tsconfig moduleResolution:"Node"
 * (node10)不解析 exports map(TS2307 + 级联 implicit-any),故本脚本对这两模块走
 * computed-specifier dynamic import:tsc 静态分析不跟进 packages 程序图(根
 * tsc --noEmit 干净),tsx 运行时经 packages/infinite-canvas/node_modules symlink
 * 正常解析(verify-59-dispatch.ts 先例: 直接相对路径 import flowgraph 源可过
 * root tsc,但 adapter/serialize 的内部 @kais 别名不行,只能绕开静态链接)。
 *
 * 禁止事项(60-01-PLAN): 不修改任何 src/ 生产代码;不写 assetKey 模糊匹配;
 * 探针中途异常也必须走 finally 恢复。
 *
 * Run: npx tsx scripts/diagnose-60-roundtrip.ts [--strict]
 * Exit: 0 零漂移(+恢复全等) / 1 任一层漂移或 footprint 失败 / 2 SKIP(:10588 不可达)
 */

// ── 常量(SCOPES/MIGRATE_SUPPORTED 照搬 probe-59-real.mjs) ──────────────────

const BASE = "http://localhost:10588"

// 探测序(2026-08-24 实测 load-v2 200): 2/1=31 节点(asset/audio/script/storyboard/
// video),2001/1=31 节点(asset/script/storyboard/video)——类型全集 migrate 支持,
// 且两侧均无 evt_/eventChip 持久化节点(层1 不被事件折叠噪音污染)。
const SCOPES: Array<[number, number]> = [[2, 1], [2001, 1]]

// migrate planNode 支持的 V2 类型全集(migrate.ts case 表)——选 scope 前全图校验
// (含不支持类型的图 adaptV2Graph 会 migrate throw → 降级空图,probe-59-real 同款守卫)。
const MIGRATE_SUPPORTED = new Set([
  "script", "storyboard", "keyframe", "video", "voice", "foley", "bgm", "global",
  "mix", "composite", "asset", "audio", "scene_image", "upscale", "face_restore",
  "variant", "reference",
])

const STRICT = process.argv.includes("--strict")

// ── V3 模块本地契约面(computed dynamic import 的类型收窄;运行时即生产函数) ──

interface V3NodeLike { id: string; kind?: string }
interface V2NodeLike { id: string; type?: string }
interface V2GraphLike {
  meta?: Record<string, unknown>
  nodes: V2NodeLike[]
  links?: unknown[]
  branches?: unknown[]
  variantGroups?: unknown[]
}
interface AdaptResultLike {
  graph: { nodes: V3NodeLike[] }
  warnings: string[]
  source: string
  rawDataByNodeId: Map<string, Record<string, unknown>>
}
type AdaptV2GraphFn = (raw: unknown) => AdaptResultLike
type SerializeGraphToV2Fn = (
  graph: unknown,
  rawDataByNodeId: Map<string, Record<string, unknown>> | null,
  viewport?: unknown,
) => V2GraphLike

const V3_DIR = "../packages/infinite-canvas/src/v3"

// ── 共用 HTTP(probe-59-real 同款) ──────────────────────────────────────────

async function post(path: string, body: unknown): Promise<{ status: number; json: any | null }> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  let json: any = null
  try { json = await res.json() } catch { /* non-json */ }
  return { status: res.status, json }
}
const loadV2 = (projectId: number, episodesId: number) =>
  post("/api/canvas/v2/load-v2", { projectId, episodesId })
const saveV2 = (projectId: number, episodesId: number, graph: unknown) =>
  post("/api/canvas/v2/save-v2", { projectId, episodesId, graph })

// ── 深度比对(剔除 meta.updatedAt/lastEventId;键序无关;probe-59-real 同款) ──

function stripUpdatedAt(v: unknown, path = ""): unknown {
  if (Array.isArray(v)) return v.map((x) => stripUpdatedAt(x))
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) {
      // meta.updatedAt / meta.lastEventId = save-v2 的保存簿记字段——非图内容,剔除。
      if (path === "meta" && (k === "updatedAt" || k === "lastEventId")) continue
      out[k] = stripUpdatedAt((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k)
    }
    return out
  }
  return v
}
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(stripUpdatedAt(a)) === JSON.stringify(stripUpdatedAt(b))
}
function firstDiff(a: any, b: any, path = ""): string | null {
  if (deepEqual(a, b)) return null
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return `${path || "(root)"}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (path === "meta" && (k === "updatedAt" || k === "lastEventId")) continue
    const child = path ? `${path}.${k}` : k
    if (!(k in a) || !(k in b)) return `${child}: 仅一侧存在`
    const d = firstDiff(a[k], b[k], child)
    if (d) return d
  }
  return `${path || "(root)"}: 深度不等(未定位)`
}

// ── id diff 工具 ───────────────────────────────────────────────────────────

const idSet = (nodes: Array<{ id: string }>) => new Set(nodes.map((n) => n.id))
/** 双向差集 [A→B(A 有 B 无), B→A(B 有 A 无)],排序保证输出确定。 */
function diffSets(a: Set<string>, b: Set<string>): [string[], string[]] {
  const a2b = [...a].filter((x) => !b.has(x)).sort()
  const b2a = [...b].filter((x) => !a.has(x)).sort()
  return [a2b, b2a]
}

// ── main ───────────────────────────────────────────────────────────────────

const failures: string[] = []
const note = (k: string, ok: boolean, v: string): void => {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${k}: ${v}`)
  if (!ok) failures.push(`${k}: ${v}`)
}

async function main(): Promise<number> {
  console.log("=== diagnose-60-roundtrip — 真机 save→reload roundtrip 三层 id-diff(60-01 Task 1 / Prong 1)===")
  console.log(`  base=${BASE} strict=${STRICT}`)

  // V3 生产函数运行时导入(头注释「导入纪律」节)——失败即探针失败(exit 1)。
  let adaptV2Graph: AdaptV2GraphFn
  let serializeGraphToV2: SerializeGraphToV2Fn
  try {
    const adapterMod = (await import(`${V3_DIR}/adapter`)) as { adaptV2Graph: AdaptV2GraphFn }
    const serializeMod = (await import(`${V3_DIR}/serialize`)) as {
      serializeGraphToV2: SerializeGraphToV2Fn
    }
    adaptV2Graph = adapterMod.adaptV2Graph
    serializeGraphToV2 = serializeMod.serializeGraphToV2
    console.log(`  V3 模块运行时导入 ok: adaptV2Graph=${typeof adaptV2Graph} serializeGraphToV2=${typeof serializeGraphToV2}`)
  } catch (err) {
    console.error(`PROBE FAILED: V3 模块动态导入失败: ${(err as Error).message}`)
    return 1
  }

  // ── (a) scope 选择:首个 load-v2 200 + MIGRATE_SUPPORTED 全图通过的 scope ──
  let scopePid = 0
  let scopeEid = 0
  let loadA: V2GraphLike | null = null
  for (const [pid, eid] of SCOPES) {
    let l: Awaited<ReturnType<typeof loadV2>>
    try {
      l = await loadV2(pid, eid)
    } catch (err) {
      console.log(`  scope ${pid}/${eid}: load-v2 fetch 失败(${(err as Error).message}),跳过`)
      continue
    }
    if (l.status !== 200 || l.json?.code !== 200) {
      console.log(`  scope ${pid}/${eid}: load-v2 HTTP ${l.status} code=${l.json?.code},跳过`)
      continue
    }
    const g = l.json.data as V2GraphLike
    const unsupported = (g.nodes ?? []).some((n) => !MIGRATE_SUPPORTED.has(String(n.type)))
    if (unsupported) {
      console.log(`  scope ${pid}/${eid}: 含 migrate 不支持的 V2 节点类型(adaptV2Graph 会降级空图),跳过`)
      continue
    }
    if ((g.nodes ?? []).length === 0) {
      console.log(`  scope ${pid}/${eid}: 空图(0 节点),跳过`)
      continue
    }
    loadA = g
    scopePid = pid
    scopeEid = eid
    break
  }
  if (!loadA) {
    console.error(
      "SKIP: :10588 不可达(load-v2 非 200)或无 MIGRATE_SUPPORTED 全过的非空 scope——" +
      "按 60-01-PLAN (a) 条款如实 SKIP(exit 2);补跑:部署后 npx tsx scripts/diagnose-60-roundtrip.ts --strict",
    )
    return 2
  }

  const evtLike = (n: { id: string; type?: string }) =>
    String(n.id).startsWith("evt_") || n.type === "eventChip"
  const aAssetLike = (loadA.nodes ?? []).filter((n) => !evtLike(n))
  console.log(
    `  选定 scope ${scopePid}/${scopeEid}: nodes=${loadA.nodes.length}(非 evt ${aAssetLike.length},` +
    `evt/eventChip ${loadA.nodes.length - aAssetLike.length}),links=${(loadA.links ?? []).length}`,
  )

  let footprintRestored = false
  let footprintDiff = ""
  // CR-01(review-60)恢复守卫: 探针是否真实写过库 + 最后已观测的服务器态(写库
  // 成功后随 loadC 刷新)。finally 恢复前核对当前态 === lastKnownServer;漂移
  // (并发写)→ 放弃恢复而非盲写覆盖(静默数据丢失),FAIL + exit 1 交人工对账。
  let probeWrote = false
  let lastKnownServer: V2GraphLike = loadA

  try {
    // ── (b) roundtrip 复现客户端全链 ──
    const adaptedA = adaptV2Graph(loadA)
    const warningsA = adaptedA.warnings
    const wire = serializeGraphToV2(adaptedA.graph, adaptedA.rawDataByNodeId, undefined)

    // 客户端折叠守卫(T-60-01b DoS 弱缓解):wire 是要写进生产库的内容——若
    // serialize/adapter 丢节点(wire 非空但少于 loadA 非 evt 集),不再真实落库,
    // 改走内存 roundtrip(adaptedWire)出层2证据,层1 服务端层记 SKIP。
    const wireIds = idSet(wire.nodes)
    const aIds = idSet(loadA.nodes)
    const [a2w, w2a] = diffSets(aIds, wireIds)
    let serverLayerAvailable = true
    let adaptedC: AdaptResultLike
    if (a2w.length > 0 || w2a.length > 0) {
      serverLayerAvailable = false
      console.log(
        `  [WARN] 客户端折叠守卫触发: loadA→wire 双向差集 A→wire=[${a2w.join(",")}] wire→A=[${w2a.join(",")}]` +
        "——真实落库取消(零足迹纪律),层2 改内存 roundtrip(adapt(wire)),层1 服务端层 SKIP",
      )
      adaptedC = adaptV2Graph(wire)
    } else {
      const sv = await saveV2(scopePid, scopeEid, wire)
      if (sv.status !== 200 || sv.json?.code !== 200) {
        // WR-01(review-60): save 失败 → wire 未落库,后续 loadC 读到的只是未
        // 触碰的服务器态——旧版仍照跑层1 diff/锚点抽检,层1 会 vacuous PASS
        // (误导性「服务端重组稳定性 PASS」)或把并发写 spuriously FAIL 误归因
        // 「服务端漂移」。现显式 SKIP 层1;层2/3 由 serverLayerAvailable 门控
        // 一并跳过(失败已 note FAIL 记账:strict → exit 1,非 strict 如实打印
        // 保持既有契约)。
        note("roundtrip save-v2", false, `HTTP ${sv.status} code=${sv.json?.code}: ${JSON.stringify(sv.json).slice(0, 200)}——wire 未落库,层1/层1锚点显式 SKIP(save 未成功不空跑服务器层 diff)`)
        serverLayerAvailable = false
        adaptedC = adaptedA // 未落库:无 C 可比,层 diff 全跳过
      } else {
        probeWrote = true // CR-01: wire 已落库——finally 按原图恢复
        const lc = await loadV2(scopePid, scopeEid)
        if (lc.status !== 200 || lc.json?.code !== 200) {
          note("roundtrip load-v2(C)", false, `HTTP ${lc.status} code=${lc.json?.code}——层1/层1锚点 SKIP(无 C 可读);恢复守卫基准停留 loadA(自家写入未被复核,漂移即保守中止)`)
          adaptedC = adaptedA
          serverLayerAvailable = false
        } else {
          const loadC = lc.json.data as V2GraphLike
          lastKnownServer = loadC // CR-01: 刷新恢复守卫基准(自家写后的已观测服务器态)
          adaptedC = adaptV2Graph(loadC)
          const cIds = idSet(loadC.nodes)

          // ── (c) 层1 V2:服务端重组稳定性 ──
          const [a2c, c2a] = diffSets(aIds, cIds)
          note("层1 V2 id(服务端重组稳定性)", a2c.length === 0 && c2a.length === 0,
            `loadA ${aIds.size} ids vs loadC ${cIds.size} ids,双向差集 loadA→loadC=${a2c.length}${a2c.length ? `[${a2c.join(",")}]` : ""} loadC→loadA=${c2a.length}${c2a.length ? `[${c2a.join(",")}]` : ""}`)
          // 归因器:wire→loadC 纯透传差集(层1 非零时区分服务端漂移 vs 客户端折叠)
          const [w2c, c2w] = diffSets(wireIds, cIds)
          if (a2c.length > 0 || c2a.length > 0) {
            note("层1 归因(wire→loadC 服务端纯透传)", w2c.length === 0 && c2w.length === 0,
              `差集=${w2c.length + c2w.length}${w2c.length || c2w.length ? `(wire→loadC=[${w2c.join(",")}] loadC→wire=[${c2w.join(",")}])` : " =0:层1 漂移来自客户端 serialize/adapter 折叠,非服务端"}`)
          }

          // V2 侧锚点抽检:首个非 evt 节点在 loadC 同 id 存在
          const anchorV2 = aAssetLike[0]
          if (anchorV2 != null) {
            note("层1 锚点抽检(V2 首个非 evt 节点)", cIds.has(anchorV2.id),
              `${anchorV2.id}(type=${anchorV2.type}) 在 loadC ${cIds.has(anchorV2.id) ? "同 id 存在" : "缺失"}`)
          }

          // 层2/层3 用 adaptedC(上面已构造)
        }
      }
    }

    if (serverLayerAvailable || a2w.length > 0 || w2a.length > 0) {
      // ── (c) 层2 V3:完整客户端往返 ──
      const va = adaptedA.graph.nodes
      const vc = adaptedC.graph.nodes
      const [v3a2c, v3c2a] = diffSets(idSet(va), idSet(vc))
      note("层2 V3 id(完整客户端往返)", v3a2c.length === 0 && v3c2a.length === 0,
        `adaptedA ${va.length} ids vs adaptedC ${vc.length} ids,双向差集 A→C=${v3a2c.length}${v3a2c.length ? `[${v3a2c.join(",")}]` : ""} C→A=${v3c2a.length}${v3c2a.length ? `[${v3c2a.join(",")}]` : ""}`)

      // ── (c) 层3 evt_*:事件重合成确定性 ──
      const evtA = va.filter((n) => String(n.id).startsWith("evt_")).map((n) => n.id)
      const evtC = vc.filter((n) => String(n.id).startsWith("evt_")).map((n) => n.id)
      const [e2c, e2a] = diffSets(new Set(evtA), new Set(evtC))
      const vacuous = evtA.length === 0 && evtC.length === 0
      note("层3 evt_* id(事件重合成确定性)", e2c.length === 0 && e2a.length === 0,
        `adaptedA evt ${evtA.length} 个 vs adaptedC evt ${evtC.length} 个,双向差集=${e2c.length + e2a.length}` +
        (vacuous ? "(本图无 evt_ 合成节点——服务端未存事件产物 flat 配方,vacuous PASS)" : `${e2c.length ? `[A→C=${e2c.join(",")}]` : ""}${e2a.length ? `[C→A=${e2a.join(",")}]` : ""}`))

      // ── (c) 锚点抽检:adaptedA 首个 kind==='asset' 节点(detailNode 重锚最小情形) ──
      const anchorV3 = va.find((n) => n.kind === "asset")
      if (anchorV3 != null) {
        const hit = vc.some((n) => n.id === anchorV3.id)
        note("层2 锚点抽检(首个 asset 节点重锚)", hit,
          `${anchorV3.id} 在 adaptedC ${hit ? "同 id 存在(detailNode 按 id 重锚可存活)" : "缺失(重锚必失败→面板收起)"}`)
      }
    }

    // 适配告警计数(warnings 是折叠/降级诊断线索,如实记录)
    console.log(
      `  [INFO] adaptedA.warnings=${warningsA.length} 条${warningsA.length ? `(首3条: ${warningsA.slice(0, 3).join(" | ")})` : ""};adaptedA.source=${adaptedA.source}`,
    )
  } catch (err) {
    console.error(`PROBE FAILED: ${(err as Error).message}`)
    failures.push(`probe crash: ${(err as Error).message}`)
  } finally {
    // ── (e) 零足迹恢复(CR-01 守卫: 恢复前核对无并发写,漂移即中止不盲写)──
    try {
      const pre = await loadV2(scopePid, scopeEid)
      if (pre.status !== 200 || pre.json?.code !== 200) {
        note("恢复(净足迹)", false,
          `恢复前核对 load-v2 失败: HTTP ${pre.status} code=${pre.json?.code}——不盲写回存,人工核查!(CR-01)`)
      } else if (!deepEqual(lastKnownServer, pre.json.data)) {
        footprintDiff = firstDiff(lastKnownServer, pre.json.data) ?? ""
        note("恢复(净足迹)", false,
          `检测到服务器态漂移(探针最后已知态 ≠ 当前态,净足迹≠0): ${footprintDiff}——` +
          "疑似并发写入(kmc pipeline/画布客户端)或探针自身写入未被复核;" +
          "放弃恢复、并发写入被保留,需人工对账!(CR-01)")
      } else if (!probeWrote) {
        // 探针未写库(save 失败或客户端折叠守卫触发):无足迹可恢复,也不再制造
        // 一次无谓写库+广播(旧版此处无条件回存 loadA,本身即对 :10588 的扰动)。
        footprintRestored = true
        note("恢复(净足迹)", true, "探针未写库且服务器态无漂移——无需恢复,净足迹=0")
      } else {
        const r = await saveV2(scopePid, scopeEid, loadA)
        let restored = false
        const deadline = Date.now() + 15_000
        while (Date.now() < deadline) {
          const l = await loadV2(scopePid, scopeEid)
          if (l.status === 200) {
            restored = deepEqual(loadA, l.json.data)
            if (!restored) footprintDiff = firstDiff(loadA, l.json.data) ?? ""
            if (restored) break
          }
          await new Promise((res) => setTimeout(res, 500))
        }
        footprintRestored = r.status === 200 && restored
        note("恢复(净足迹)", footprintRestored,
          `原图回存 HTTP ${r.status};load-v2 深比对原图:${restored ? "全等(剔 meta.updatedAt,净足迹=0)" : "漂移 → " + footprintDiff}`)
      }
    } catch (err) {
      note("恢复(净足迹)", false, `恢复复核失败: ${(err as Error).message}——人工核查!`)
    }
  }

  // ── (d) exit 契约 ──
  if (!footprintRestored) return 1
  if (STRICT && failures.length > 0) {
    console.error(`\n✗ strict 模式 ${failures.length} 项失败:`)
    for (const f of failures) console.error(`  - ${f}`)
    return 1
  }
  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} 项失败(非 strict:详见上方 FAIL 行)`)
  } else {
    console.log("\n✓ diagnose-60-roundtrip 零漂移:三层 id diff 全空 + 恢复全等(净足迹=0)")
  }
  return 0
}

main()
  .then((code) => { process.exit(code) })
  .catch((err) => {
    console.error("PROBE CRASH:", err)
    process.exit(1)
  })
