/**
 * H3 I2VA/FL2VA 首帧锚定指令行 — 防御性注入 (2026-08-23)。
 *
 * 官方协议要求带帧图的 prompt 显式声明图片与目标视频时间线的对齐关系
 * (docs/minimax-h3-api-guide.md §Prompt 结构化编写 / I2VA/FL2VA 指令行)。
 * 实测(2026-08-23)调用方漏写该行时模型对首帧的保持明显变弱; KMC 一次性
 * 脚本/手动 curl 等路径不保证带上, 故 API 层兜底: 检测不到锚定表述时
 * 自动前置官方指令行。
 *
 * 不注入的场景(有意为之):
 *   - 无首帧图 (L2VA 仅尾帧: 官方指南未给指令行; t2va: 无图片)
 *   - ref2va: 参考图的时间线锚定是调用方 opt-in 决策 (KMC enhancer 协议
 *     默认禁止把参考图对齐 0.00 秒, 除非用户显式要求), API 层不越权代写
 *   - prompt 已含锚定表述 (中英任一): 不重复注入
 */

/** prompt 中已存在锚定表述的判定 (官方英文行 / KMC enhancer 中文行)。 */
const ANCHOR_PRESENT_RE = /0\.00\s*(?:seconds?|秒|s\b)|fully[ _]referenced|0\.00-second\s+mark/i;

/** I2VA (仅首帧) 官方指令行。 */
export const I2VA_ANCHOR_LINE =
  "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";

/** FL2VA (首+尾帧) 官方指令行模板; ${lastSec} 为尾帧对齐时刻(视频时长, 秒)。 */
export const FL2VA_ANCHOR_LINE = (lastSec: string) =>
  `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the ${lastSec}-second mark of the target video.`;

/**
 * 检测 prompt 缺少首帧锚定表述时, 前置官方指令行; 否则原样返回。
 *
 * @param prompt            原始 prompt
 * @param hasFirstFrame     是否有首帧图 (false → 原样返回)
 * @param opts.hasLastFrame 是否还有尾帧图 (true → FL2VA 双图行)
 * @param opts.durationSec  视频时长(秒), FL2VA 尾帧对齐时刻; 缺省用 "S.SS" 占位
 */
export function withFirstFrameAnchor(
  prompt: string,
  hasFirstFrame: boolean,
  opts: { hasLastFrame?: boolean; durationSec?: number } = {},
): string {
  if (!hasFirstFrame) return prompt;
  if (ANCHOR_PRESENT_RE.test(prompt)) return prompt;
  const line = opts.hasLastFrame
    ? FL2VA_ANCHOR_LINE(
        typeof opts.durationSec === "number" && opts.durationSec > 0
          ? opts.durationSec.toFixed(2)
          : "S.SS",
      )
    : I2VA_ANCHOR_LINE;
  return `${line}\n\n${prompt}`;
}
