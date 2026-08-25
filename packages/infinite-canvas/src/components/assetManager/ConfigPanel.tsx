/**
 * 配置 Tab（08-25 落地）—— 取代原「选片决策」第 5 Tab 的配置职能：
 *   ① GLM 模型配置：GET/PUT /api/canvas/v2/model-config
 *      （文件面 data/config/model-config.json；优先级 文件 > env > 默认）
 *   ② 管线冗余配置：RedundancyConfigRail 内嵌（原层级视图第三栏整体迁入；
 *      62-02 三源合并读侧 + D-08 两段式写侧语义原样，仅挂载位点变化）
 * 批量决策/域树总览随选片决策视图一并退役（08-25 裁定：不需要批量决策）。
 */
import { useCallback, useEffect, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import {
  ApiError,
  fetchModelConfig,
  putModelConfig,
  type ModelConfig,
  type ModelConfigSource,
} from '../../services/canvasApi'
import RedundancyConfigRail from './RedundancyConfigRail'

/** 字段元数据：key / 中文标签 / 占位即默认值 / 用途注记。 */
const FIELDS: ReadonlyArray<{
  key: keyof ModelConfig
  label: string
  note: string
  mono?: boolean
  secret?: boolean
}> = [
  { key: 'scorerVisionModel', label: '评分视觉模型', note: '图片评分 / 一致性对比（ai-scorer）', mono: true },
  { key: 'textModel', label: '文本模型', note: 'hermes-adapter callLLM 默认', mono: true },
  { key: 'visionModel', label: '视觉模型', note: 'hermes-adapter 多模态默认（原 ZHIPU_VISION_MODEL）', mono: true },
  { key: 'apiBase', label: 'API Base', note: '智谱兼容端点；留空 = 官方 v4', mono: true },
  { key: 'apiKey', label: 'API Key', note: '留空 = 沿用环境变量 ZHIPU_API_KEY', mono: true, secret: true },
]

/** 来源角标三态（与冗余配置来源角标同语义：明示值从哪来，防「以为在用文件值」）。 */
const SOURCE_LABEL: Record<ModelConfigSource[keyof ModelConfigSource], { text: string; title: string; cls: string }> = {
  file: { text: '配置文件', title: 'data/config/model-config.json', cls: 'am-mc__src--file' },
  env: { text: '环境变量', title: '进程 env（ZHIPU_API_KEY / OPENAI_API_KEY）', cls: 'am-mc__src--env' },
  default: { text: '默认', title: '内置默认值（未配置）', cls: 'am-mc__src--default' },
}

export default function ConfigPanel() {
  const showToast = useCanvasStore((s) => s.showToast)
  const projectId = useCanvasStore((s) => s.projectId)
  const episodesId = useCanvasStore((s) => s.episodesId)

  const [form, setForm] = useState<ModelConfig | null>(null)
  const [source, setSource] = useState<ModelConfigSource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showKey, setShowKey] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await fetchModelConfig()
      setForm(data.config)
      setSource(data.source)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const setField = (key: keyof ModelConfig, value: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const save = async () => {
    if (!form) return
    if (form.apiBase.trim() && !/^https?:\/\//.test(form.apiBase.trim())) {
      showToast('API Base 须为 http(s):// 开头', 'warning')
      return
    }
    setSaving(true)
    try {
      const data = await putModelConfig(form)
      setForm(data.config)
      setSource(data.source)
      showToast('GLM 模型配置已保存', 'success')
    } catch (err) {
      showToast(`保存失败：${err instanceof ApiError ? err.message : String(err)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="am-config" data-testid="config-view">
      <div className="am-config__col">
        {/* ── ① GLM 模型配置 ── */}
        <section className="am-config__section" data-testid="model-config-section">
          <header className="am-config__h">
            <span className="am-config__h-ic">🧠</span>
            <div>
              <div className="am-config__h-title">GLM 模型配置</div>
              <div className="am-config__h-sub">
                写入 data/config/model-config.json · 空值回落默认 / 环境变量 · 评分器即时生效，hermes 脚本下次运行生效
              </div>
            </div>
          </header>

          {error ? (
            <div className="am-empty" data-testid="model-config-error">
              配置加载失败：{error}<br />
              <button className="am-btn am-btn--ghost" style={{ marginTop: 12 }} onClick={() => void load()}>重试</button>
            </div>
          ) : !form ? (
            <div className="am-loading"><div className="am-loading__label">正在读取配置…</div></div>
          ) : (
            <>
              <div className="am-mc__fields">
                {FIELDS.map(({ key, label, note, mono, secret }) => (
                  <label key={key} className="am-mc__field">
                    <span className="am-mc__label">
                      {label}
                      {source?.[key] && (() => {
                        const meta = SOURCE_LABEL[source[key]]
                        return (
                          <span
                            className={`am-mc__src ${meta.cls}`}
                            data-testid="model-config-source"
                            data-field={key}
                            data-source={source[key]}
                            title={meta.title}
                          >{meta.text}</span>
                        )
                      })()}
                    </span>
                    <input
                      className={`am-mc__input${mono ? ' am-mc__input--mono' : ''}`}
                      data-testid={`model-config-input-${key}`}
                      type={secret && !showKey ? 'password' : 'text'}
                      value={form[key]}
                      placeholder="（默认）"
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(e) => setField(key, e.target.value)}
                    />
                    <span className="am-mc__note">{note}</span>
                  </label>
                ))}
              </div>
              <footer className="am-mc__foot">
                {form.apiKey && (
                  <button className="am-btn am-btn--ghost" onClick={() => setShowKey((v) => !v)}>
                    {showKey ? '隐藏 Key' : '显示 Key'}
                  </button>
                )}
                <span className="am-mc__spacer" />
                <button className="am-btn am-btn--ghost" onClick={() => void load()} disabled={saving}>
                  撤销改动
                </button>
                <button
                  className="am-btn am-btn--primary"
                  data-testid="model-config-save"
                  onClick={() => void save()}
                  disabled={saving}
                >{saving ? '保存中…' : '保存'}</button>
              </footer>
            </>
          )}
        </section>

        {/* ── ② 管线冗余配置（RedundancyConfigRail 内嵌） ── */}
        <section className="am-config__section" data-testid="redundancy-config-section">
          <header className="am-config__h">
            <span className="am-config__h-ic">🎚️</span>
            <div>
              <div className="am-config__h-title">管线冗余配置</div>
              <div className="am-config__h-sub">
                每阶段候选生成数量（pre / final）· 覆盖层 &gt; requirement.json &gt; 快照默认 · 作用域：当前项目
              </div>
            </div>
          </header>
          {projectId != null && episodesId != null ? (
            <RedundancyConfigRail projectId={projectId} episodesId={episodesId} />
          ) : (
            <div className="am-empty">先在右上角选择项目与分集，再配置冗余。</div>
          )}
        </section>
      </div>
    </div>
  )
}
