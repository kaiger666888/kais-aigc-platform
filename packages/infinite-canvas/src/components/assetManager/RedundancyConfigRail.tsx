/**
 * C8 · RedundancyConfigRail —— HIER-03 冗余配置右栏（62-06）。
 *
 * khs v2.5 键面快照（62-01 修正口径 14 键 = 11 嵌套 + 3 扁平，transition 已并入
 * shot_list 注记）的读侧三源合并展示 + 写侧两段式编辑，挂载于层级视图第三栏
 * （AssetHierarchy toolbar「⚙ 冗余配置」开合，默认收起）。
 *
 * 读侧（D-09）：GET /api/canvas/v2/generation-config——服务端完成三源合并
 * （覆盖层 > requirement.json 实测 > 快照默认），行 source 四态角标：
 *   override「覆盖层」（青弱底）/ requirement「文件值」（金弱底）/
 *   snapshot「快照默认」（中性）/ legacy「无 v2.5 键」（虚线边，旧形态回落）。
 * 写侧（D-08 两段式）：编辑 pre/final → 保存 → PUT overrides/:phaseKey →
 *   writeState 三态徽标（override|synced|file-fail）——服务端判定直映射，
 *   UI 无任何「假定成功」分支（T-62-20）。
 * 钳制双道（D-10）：前端第一道 clampRedundancy 越界即禁用保存 + 行内文案
 *   （62-01 前端常量表同一函数，不另写第二套边界判断）；后端 400 兜底 →
 *   toast 同 message 文案（T-62-19）。
 * 不可配折叠区（D-11）：汇总口径 19 键 = tts 1 + 报告/审计 18（checker 裁定，
 * UI-SPEC 旧稿「30」漂移修正）——summary「不可配键 · 19」，禁用整行 + reason，不隐藏。
 * unwired 键（bgm/foley）：「占位未接线」灰 chip 标注，editable 保持 true
 * （62-01 裁定：写覆盖层允许，运行时暂不消费）。
 */
import { useEffect, useState } from 'react'
import {
  ApiError,
  fetchGenerationConfig,
  putGenerationConfigOverride,
  type ConfigRow,
  type GenerationConfigWriteState,
} from '../../services/canvasApi'
import { useCanvasStore } from '../../store/canvasStore'
import {
  GENERATION_CONFIG_KEYS,
  LOCKED_CONFIG_KEYS,
  LOCKED_KEYS_TOTAL,
  clampRedundancy,
} from './generationConfigKeys'

/** 前端键表索引——preCap1 / unwired / gpuHint / note 由键表驱动（非逐行硬编码，
 *  62-01 表为口径源；服务端 rows 的 editable/lockReason 不参与 UI 门控）。 */
const KEY_BY_PHASE = new Map(GENERATION_CONFIG_KEYS.map((k) => [k.phaseKey, k]))

/** 档位徽标四文案（UI-SPEC Copywriting 逐字）。 */
const TIER_LABEL: Record<ConfigRow['tier'], string> = {
  llm: 'LLM 产物',
  engine: '引擎产物',
  deterministic: '确定性派生',
  text: '文本候选',
}

/** 来源角标四态文案 + tooltip（UI-SPEC Copywriting 逐字）。 */
const SOURCE_CHIP: Record<ConfigRow['source'], { text: string; title: string; cls: string }> = {
  override: { text: '覆盖层', title: 'kap 覆盖层', cls: 'am-cfg__src--override' },
  requirement: { text: '文件值', title: 'requirement.json 实测值', cls: 'am-cfg__src--requirement' },
  snapshot: { text: '快照默认', title: 'khs v2.5 快照默认值', cls: 'am-cfg__src--snapshot' },
  legacy: {
    text: '无 v2.5 键',
    title: 'requirement.json 为 v2.5 前旧形态 · 已回落快照默认',
    cls: 'am-cfg__src--legacy',
  },
}

/** 写结果徽标三串（D-08 指定原文，逐字）。 */
const WRITE_BADGE_TEXT: Record<GenerationConfigWriteState, string> = {
  'override': '已存覆盖层',
  'synced': '已同步 requirement.json',
  'file-fail': '文件面寻址失败——覆盖层已保存',
}

const CLAMP_ERROR_TEXT = '数值越界：pre ≥ 1，final 需在 1..pre 之间'
const PRE_CAP1_REASON = '确定性派生 · pre 固定为 1'
const GPU_HINT_TEXT = 'GPU 成本护栏 · 谨慎调高'
const UNWIRED_CHIP_TEXT = '占位未接线'
const UNWIRED_CHIP_TITLE = '键面占位 · 运行时暂不消费'

/** 值来源角标小 chip（sourceLegacy 旧形态优先显示「无 v2.5 键」虚线态——
 *  服务端 source='legacy' 与 mock sourceLegacy 标注两形态同覆盖）。 */
function SourceChip({ row }: { row: ConfigRow }) {
  const legacy = row.source === 'legacy' || row.sourceLegacy === true
  const meta = legacy ? SOURCE_CHIP.legacy : SOURCE_CHIP[row.source]
  return (
    <span
      className={`am-cfg__src ${meta.cls}`}
      data-testid="config-source-chip"
      data-source={legacy ? 'legacy' : row.source}
      title={meta.title}
    >{meta.text}</span>
  )
}

export default function RedundancyConfigRail({
  projectId,
  episodesId,
}: {
  projectId: number | null
  episodesId: number | null
}) {
  const showToast = useCanvasStore((s) => s.showToast)
  const [rows, setRows] = useState<ConfigRow[] | null>(null)
  const [fileState, setFileState] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  /** 行编辑态（输入框原始字符串；未编辑键无条目——未编辑沿用行 source，编辑后待保存）。 */
  const [edits, setEdits] = useState<Record<string, { pre?: string; final?: string }>>({})
  /** 写结果徽标（phaseKey → writeState；再次编辑即失效移除）。 */
  const [writeResults, setWriteResults] = useState<Record<string, GenerationConfigWriteState>>({})
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (projectId == null || episodesId == null) {
      setLoading(false)
      setRows(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchGenerationConfig(projectId, episodesId)
      .then((d) => {
        if (cancelled) return
        setRows(d.rows)
        setFileState(d.fileState)
        setEdits({})
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, episodesId, reloadTick])

  const renderRow = (row: ConfigRow) => {
    const keyDef = KEY_BY_PHASE.get(row.phaseKey)
    // preCap1 五键 pre 钉 1 禁用由键表驱动；unwired 键 editable 保持 true（62-01 裁定）。
    const preCap1 = keyDef?.preCap1 === true
    const unwired = row.unwired === true || keyDef?.unwired === true
    const gpuHint = row.gpuHint === true || keyDef?.gpuHint === true
    const note = row.note ?? keyDef?.note
    const edit = edits[row.phaseKey]
    const preStr = preCap1 ? '1' : (edit?.pre ?? String(row.pre))
    const finalStr = edit?.final ?? String(row.final)
    const p = Number(preStr)
    const f = Number(finalStr)
    // D-10 前端道：同一 clampRedundancy 驱动越界判定（钳后不等即越界 + 整数守卫），
    // 不另写第二套边界判断。
    const clamped = Number.isFinite(p) && Number.isFinite(f) ? clampRedundancy(p, f) : null
    const outOfRange =
      clamped == null || !Number.isInteger(p) || !Number.isInteger(f) ||
      clamped.pre !== p || clamped.final !== f
    const dirty = preStr !== String(row.pre) || finalStr !== String(row.final)
    const writeState = writeResults[row.phaseKey]
    const saving = savingKeys.has(row.phaseKey)

    const setEdit = (patch: { pre?: string; final?: string }) => {
      setEdits((prev) => ({ ...prev, [row.phaseKey]: { ...prev[row.phaseKey], ...patch } }))
      // 编辑即失效旧写徽标（新改动未保存，旧结果不再是当前状态）。
      setWriteResults((prev) => {
        if (!(row.phaseKey in prev)) return prev
        const next = { ...prev }
        delete next[row.phaseKey]
        return next
      })
    }

    const handleSave = async () => {
      if (projectId == null || episodesId == null) return
      if (outOfRange || !Number.isInteger(p) || !Number.isInteger(f)) return
      setSavingKeys((prev) => new Set(prev).add(row.phaseKey))
      try {
        const res = await putGenerationConfigOverride(projectId, episodesId, row.phaseKey, {
          nCandidates: p,
          finalCandidates: f,
        })
        setWriteResults((prev) => ({ ...prev, [row.phaseKey]: res.writeState }))
        // 本地行同步为已保存值（覆盖层为最强源，与 GET 回读一致）。
        setRows((prev) =>
          prev
            ? prev.map((r) =>
                r.phaseKey === row.phaseKey
                  ? { ...r, pre: p, final: f, source: 'override' as const, sourceLegacy: undefined }
                  : r,
              )
            : prev,
        )
        setEdits((prev) => {
          if (!(row.phaseKey in prev)) return prev
          const next = { ...prev }
          delete next[row.phaseKey]
          return next
        })
      } catch (err) {
        if (err instanceof ApiError && err.code === 400) {
          // D-10 后端道兜底：toast 同 message 文案（与前端钳制文案同源）。
          showToast(err.message, 'error')
        } else {
          showToast('保存失败: ' + (err instanceof Error ? err.message : String(err)), 'error')
        }
      } finally {
        setSavingKeys((prev) => {
          const next = new Set(prev)
          next.delete(row.phaseKey)
          return next
        })
      }
    }

    return (
      <div
        key={row.phaseKey}
        className="am-cfg__row"
        data-testid="config-row"
        data-phase-key={row.phaseKey}
        data-source={row.source}
        data-tier={row.tier}
      >
        <div className="am-cfg__phase">
          <span className="am-cfg__label">{row.label}</span>
          <span className="am-cfg__pkey" title={row.phaseKey}>{row.phaseKey}</span>
          {note && <span className="am-cfg__note">{note}</span>}
        </div>
        <div className="am-cfg__tier">
          <span
            className={`am-badge am-cfg__tier-badge${row.tier === 'deterministic' ? ' am-cfg__tier-badge--det' : ''}`}
          >{TIER_LABEL[row.tier]}</span>
          {gpuHint && <span className="am-cfg__gpu-hint" title={GPU_HINT_TEXT}>⚠</span>}
          {unwired && (
            <span className="am-cfg__unwired" data-testid="config-unwired-chip" title={UNWIRED_CHIP_TITLE}>
              {UNWIRED_CHIP_TEXT}
            </span>
          )}
        </div>
        <div className="am-cfg__cell">
          <input
            type="number"
            className="am-cfg__input"
            data-testid="config-pre-input"
            data-phase-key={row.phaseKey}
            min={1}
            max={preCap1 ? 1 : 99}
            value={preStr}
            disabled={preCap1}
            onChange={(e) => setEdit({ pre: e.target.value })}
          />
          <SourceChip row={row} />
        </div>
        <div className="am-cfg__cell">
          <input
            type="number"
            className="am-cfg__input"
            data-testid="config-final-input"
            data-phase-key={row.phaseKey}
            min={1}
            max={Number.isFinite(p) && p >= 1 ? p : undefined}
            value={finalStr}
            onChange={(e) => setEdit({ final: e.target.value })}
          />
          <SourceChip row={row} />
        </div>
        {(preCap1 || outOfRange || dirty || writeState) && (
          <div className="am-cfg__meta">
            {preCap1 && <span className="am-cfg__lock-reason">{PRE_CAP1_REASON}</span>}
            {outOfRange && <span className="am-cfg__clamp-error">{CLAMP_ERROR_TEXT}</span>}
            {dirty && (
              <>
                <span className="am-cfg__unsaved">未保存</span>
                <button
                  className="am-btn am-btn--ghost am-cfg__save"
                  data-testid="config-save"
                  data-phase-key={row.phaseKey}
                  disabled={outOfRange || saving}
                  onClick={() => void handleSave()}
                >{saving ? '保存中…' : '保存'}</button>
              </>
            )}
            {writeState && (
              <span
                className={`am-badge am-cfg__write-badge ${writeState === 'file-fail' ? 'am-badge--warn' : 'am-badge--ok'}`}
                data-testid="config-write-badge"
                data-write-state={writeState}
              >{WRITE_BADGE_TEXT[writeState]}</span>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="am-cfg-rail" data-testid="config-rail">
      <div className="am-cfg__head">
        <span className="am-title">冗余配置<span className="am-title__sub">PRE/FINAL CANDIDATES</span></span>
        {fileState && (
          <span
            className="am-cfg__filestate"
            title="requirement.json 文件面状态（requirement / legacy / not-found）"
          >{fileState}</span>
        )}
      </div>

      {loading ? (
        <div className="am-loading">
          {[1, 2, 3].map((i) => <div className="am-skeleton-card" key={i} />)}
          <div className="am-loading__label">正在读取冗余配置…</div>
        </div>
      ) : error ? (
        <div className="am-empty">
          配置加载失败：{error}<br />
          <button
            className="am-btn am-btn--ghost"
            style={{ marginTop: 12 }}
            onClick={() => setReloadTick((t) => t + 1)}
          >重试</button>
        </div>
      ) : projectId == null || episodesId == null ? (
        <div className="am-empty">缺少项目上下文 —— 请先在画布选择项目与分集。</div>
      ) : (
        <>
          <div className="am-cfg__cols">
            <span>阶段</span>
            <span>档位</span>
            <span>pre</span>
            <span>final</span>
          </div>
          <div className="am-cfg__rows">
            {(rows ?? []).map(renderRow)}
          </div>
          {/* ── 不可配折叠区（D-11）：summary「不可配键 · 19」= LOCKED_KEYS_TOTAL
              （tts 1 + 报告/审计 18 汇总，checker 裁定 UI-SPEC 旧稿 30 漂移修正）。
              两禁用行 + reason，不隐藏；行数 = 2（tts 单行 + 汇总行）。 ── */}
          <details className="am-cfg__locked" data-testid="config-locked-section">
            <summary className="am-cfg__locked-summary">不可配键 · {LOCKED_KEYS_TOTAL}</summary>
            <div className="am-cfg__locked-rows">
              <div
                className="am-cfg__locked-row"
                data-testid="config-row-locked"
                data-phase-key={LOCKED_CONFIG_KEYS.tts.phaseKey}
                data-reason={LOCKED_CONFIG_KEYS.tts.reason}
              >
                <div className="am-cfg__phase">
                  <span className="am-cfg__label">语音·TTS</span>
                  <span className="am-cfg__pkey">{LOCKED_CONFIG_KEYS.tts.phaseKey}</span>
                </div>
                <span className="am-cfg__lock-reason">{LOCKED_CONFIG_KEYS.tts.reason}</span>
              </div>
              <div
                className="am-cfg__locked-row"
                data-testid="config-row-locked"
                data-phase-key="__report_audit_aggregate__"
                data-reason={LOCKED_CONFIG_KEYS.reportAudit.reason}
              >
                <div className="am-cfg__phase">
                  <span className="am-cfg__label">报告 / 审计类</span>
                  <span className="am-cfg__pkey">__report_audit_aggregate__</span>
                </div>
                <span className="am-cfg__lock-reason">
                  {LOCKED_CONFIG_KEYS.reportAudit.reason}
                  <span className="am-cfg__lock-count"> · {LOCKED_CONFIG_KEYS.reportAudit.count} 键</span>
                </span>
              </div>
            </div>
          </details>
        </>
      )}
    </aside>
  )
}
