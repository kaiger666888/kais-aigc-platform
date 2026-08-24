/**
 * 分镜板阅读器 —— storyboard_board 资产的详情视图（场记板式分镜表）。
 *
 * 数据：o_assets.meta 内嵌的 board JSON（p09c_storyboard_board 产物，结构同
 * .pipeline-assets/storyboard-board.json 的 value：scenes[].shots[] + stats）。
 * meta 解析失败 / 无 scenes → 返回 null，AssetDetail 回退常规媒体详情布局。
 *
 * 结构签名：每镜一条「场记板竖条」（scene 小字 + 镜号大字 mono + 出点转场），
 * 场与场之间用场次闸门分隔。accent 用 --cv-mod-text（文本模态金）——
 * 这块板子就是 text modality 的具象化。
 */
import { useMemo, useState } from 'react'
import { resolveMediaUrl } from '../../utils/mediaUrl'
import type { AssetItem } from './assetManagerData'

interface BoardShot {
  shot_id: string
  thumbnail?: string | null
  shot_scale?: string
  camera_motion?: string
  framing?: string
  duration_sec?: number
  dialogue_summary?: string
  characters?: string[]
  transition_from?: string
  transition_to?: string
  emotion?: string
  action_note?: string
  preview_clip?: string | null
}

interface BoardScene {
  scene_id: string
  scene_title?: string
  shots: BoardShot[]
}

interface Board {
  scenes?: BoardScene[]
  stats?: { total_shots?: number; total_duration_sec?: number; total_scenes?: number }
  generated_at?: string
  episode_id?: string
}

function parseBoard(meta: string | null | undefined): Board | null {
  if (!meta) return null
  try {
    const obj = typeof meta === 'string' ? JSON.parse(meta) : meta
    if (obj && Array.isArray(obj.scenes) && obj.scenes.length > 0) return obj as Board
    return null
  } catch {
    return null
  }
}

/** meta 是否携带可渲染的 board 结构（AssetDetail 决定走阅读器还是常规布局）。 */
export function hasBoard(meta: string | null | undefined): boolean {
  return parseBoard(meta) != null
}

/** Shot 竖排场记板条：S01 小字 / B01 大字 / → 转场出点。 */
function Slate({ shot }: { shot: BoardShot }) {
  const [scene, beat] = (shot.shot_id || '').split('_')
  return (
    <div className="am-sb-slate">
      <span className="am-sb-slate__scene">{scene}</span>
      <span className="am-sb-slate__beat">{beat}</span>
      {shot.transition_to ? (
        <span className="am-sb-slate__trans">→ {shot.transition_to}</span>
      ) : null}
    </div>
  )
}

function ShotThumb({ src }: { src: string }) {
  const [err, setErr] = useState(false)
  const url = resolveMediaUrl(src)
  if (err || !url) return <div className="am-sb-thumb am-sb-thumb--empty" aria-hidden />
  return (
    <img
      className="am-sb-thumb"
      src={url}
      alt=""
      loading="lazy"
      onError={() => setErr(true)}
    />
  )
}

function ShotRow({ shot }: { shot: BoardShot }) {
  const fields: Array<[string, string]> = ([
    ['景别', shot.framing || shot.shot_scale || ''],
    ['运镜', shot.camera_motion || ''],
    ['时长', shot.duration_sec ? `${shot.duration_sec}s` : ''],
    ['情绪', shot.emotion || ''],
    ['人物', Array.isArray(shot.characters) ? shot.characters.join(' / ') : ''],
    ['动作', shot.action_note || ''],
  ] as Array<[string, string]>).filter(([, v]) => v)
  const dlg = shot.dialogue_summary || ''
  return (
    <div className="am-sb-shot">
      <Slate shot={shot} />
      <ShotThumb src={shot.thumbnail || ''} />
      <div className="am-sb-shot__fields">
        {fields.map(([k, v]) => (
          <div className="am-sb-f" key={k}>
            <span className="am-sb-f__k">{k}</span>
            <span className="am-sb-f__v">{v}</span>
          </div>
        ))}
      </div>
      <div className="am-sb-shot__dlg">
        {dlg ? <p>{dlg}</p> : <p className="am-sb-shot__dlg--none">无对白（音效驱动）</p>}
        {shot.preview_clip ? (
          <a
            className="am-sb-shot__clip"
            href={resolveMediaUrl(shot.preview_clip) || '#'}
            target="_blank"
            rel="noreferrer"
          >🎞 预览片段</a>
      ) : null}
      </div>
    </div>
  )
}

export default function StoryboardReader({
  item, onBack,
}: { item: AssetItem; onBack: () => void }) {
  const board = useMemo(() => parseBoard(item.meta), [item.meta])
  if (!board) return null
  const stats = board.stats || {}
  const gen = (board.generated_at || '').slice(0, 16).replace('T', ' ')
  return (
    <div className="am-sb">
      <div className="am-sb-head">
        <button className="am-det__back" onClick={onBack}>‹ 返回资产库</button>
        <div className="am-sb-head__t">
          <span className="am-sb-head__emoji">📜</span>
          <b>{item.name}</b>
          <span className="am-sb-head__stats">
            {stats.total_scenes ?? '—'} 场 · {stats.total_shots ?? '—'} 镜 ·{' '}
            {stats.total_duration_sec ?? '—'}s
          </span>
        </div>
        <div className="am-sb-head__meta">
          {board.episode_id ? <code>{board.episode_id}</code> : null}
          {gen ? <span>{gen}</span> : null}
        </div>
      </div>

      {board.scenes!.map((sc) => (
        <section key={sc.scene_id}>
          <div className="am-sb-gate">
            <b>{sc.scene_id}</b>
            <span>{sc.scene_title && sc.scene_title !== sc.scene_id ? sc.scene_title : ''}</span>
            <i>{sc.shots.length} 镜</i>
          </div>
          {sc.shots.map((sh) => <ShotRow key={sh.shot_id} shot={sh} />)}
        </section>
      ))}

      <p className="am-sb-foot">
        镜头级正文（video_prompt / 声音设计）在分镜分解产物中，尚未导入资产库 —— 当前为板级视图。
      </p>
    </div>
  )
}
