/**
 * emotion-curve-editor.js — 情绪曲线人控交互模块
 *
 * 允许用户在 Phase 2 剧本完成后，调整情绪曲线的节点，
 * 调整后的曲线自动影响下游 Phase 5-7 的 prompt 参数。
 *
 * 核心概念：
 * - 情绪节点：{ timestamp, emotion_type, intensity(0-1), tension(0-1) }
 * - 情绪类型：curiosity / anxiety / empathy / excitement / tension / relief / shock
 * - 张力曲线：从节点序列生成连续张力值，影响视频生成的 prompt
 *
 * 人控流程：
 * 1. 从 1st-director 蓝图自动提取默认情绪曲线
 * 2. 展示给用户（文本格式或可选的 Canvas 可视化）
 * 3. 用户调整（增加/删除/移动节点，调整强度）
 * 4. 锁定后生成下游参数映射
 */

import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ── 情绪类型定义 ──

export const EMOTION_TYPES = {
  curiosity:  { label: '好奇',   color: '#4ECDC4', tensionBase: 0.3, promptHint: 'mysterious, intriguing, unknown' },
  anxiety:    { label: '焦虑',   color: '#FF6B6B', tensionBase: 0.7, promptHint: 'tense, uncertain, racing' },
  empathy:    { label: '共情',   color: '#45B7D1', tensionBase: 0.4, promptHint: 'emotional, tender, vulnerable' },
  excitement: { label: '兴奋',   color: '#F7DC6F', tensionBase: 0.6, promptHint: 'energetic, vibrant, dynamic' },
  tension:    { label: '张力',   color: '#E74C3C', tensionBase: 0.8, promptHint: 'suspenseful, constraining, pressure' },
  relief:     { label: '释然',   color: '#82E0AA', tensionBase: 0.2, promptHint: 'release, warm, gentle' },
  shock:      { label: '震撼',   color: '#AF7AC5', tensionBase: 0.9, promptHint: 'dramatic, impactful, reveal' },
};

// ── 从蓝图提取默认情绪曲线 ──

/**
 * 从 1st-director 蓝图的 timeline 提取情绪节点
 * @param {Array} timeline - 蓝图时间线 [{ timestamp, neuro, emotion, narrative, social }]
 * @returns {Array<{timestamp: string, emotion_type: string, intensity: number, tension: number}>}
 */
export function extractFromBlueprint(timeline) {
  if (!timeline?.length) return [];

  // 蓝图时间线示例：
  // {"timestamp": "0-3s", "emotion": "好奇/惊讶"}
  // {"timestamp": "3-10s", "emotion": "焦虑↑"}

  const emotionIntensityMap = {
    '好奇': 0.4, '惊讶': 0.6, '焦虑': 0.7, '期待': 0.5, '紧张': 0.7,
    '释然': 0.3, '反转': 0.8, '高潮': 0.9, '震撼': 0.9, '满足': 0.3,
    '余韵': 0.2, '共鸣': 0.5, '愤怒': 0.8, '悲伤': 0.6, '恐惧': 0.8,
  };

  return timeline.map((entry, idx) => {
    const emotionStr = entry.emotion || '';
    // 解析主情绪（取第一个，忽略 ↑↓ 标记）
    const primaryEmotion = emotionStr.split(/[\/↑↓,，]/)[0].trim();

    // 关键词→情绪类型映射（覆盖更多蓝图中常见的情绪描述）
    const KEYWORD_MAP = {
      // → curiosity
      '好奇': 'curiosity', '惊讶': 'curiosity', '兴趣': 'curiosity', '疑惑': 'curiosity',
      // → anxiety
      '焦虑': 'anxiety', '不安': 'anxiety', '担忧': 'anxiety', '紧张': 'tension', '压迫': 'anxiety',
      // → empathy
      '共情': 'empathy', '同情': 'empathy', '感动': 'empathy', '心酸': 'empathy', '共鸣': 'empathy',
      // → excitement
      '兴奋': 'excitement', '期待': 'excitement', '激动': 'excitement', '热情': 'excitement',
      // → tension
      '张力': 'tension', '悬念': 'tension', '对峙': 'tension', '危机': 'tension', '紧迫': 'tension',
      // → relief
      '释然': 'relief', '治愈': 'relief', '平静': 'relief', '温暖': 'relief', '满足': 'relief',
      // → shock
      '震撼': 'shock', '反转': 'shock', '高潮': 'shock', '冲击': 'shock', '爆发': 'shock',
      // → default
      '余韵': 'relief', '悲伤': 'empathy', '恐惧': 'anxiety', '愤怒': 'tension',
    };

    const emotionType = KEYWORD_MAP[primaryEmotion] || 'curiosity';

    const intensity = emotionIntensityMap[primaryEmotion] || 0.5;

    return {
      timestamp: entry.timestamp,
      emotion_type: emotionType,
      intensity: Math.min(1, Math.max(0, intensity)),
      tension: EMOTION_TYPES[emotionType]?.tensionBase || 0.5,
      // 保留原始蓝图信息
      _blueprint_neuro: entry.neuro,
      _blueprint_narrative: entry.narrative,
      _blueprint_social: entry.social,
    };
  });
}

// ── 曲线编辑操作 ──

/**
 * 添加情绪节点
 * @param {Array} curve - 当前曲线
 * @param {object} node - { timestamp, emotion_type, intensity }
 * @returns {Array} 新曲线（按时间排序）
 */
export function addNode(curve, node) {
  const newNode = {
    timestamp: node.timestamp,
    emotion_type: node.emotion_type || 'curiosity',
    intensity: Math.min(1, Math.max(0, node.intensity ?? 0.5)),
    tension: EMOTION_TYPES[node.emotion_type]?.tensionBase ?? 0.5,
  };
  const newCurve = [...curve, newNode];
  return newCurve.sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp));
}

/**
 * 更新节点
 */
export function updateNode(curve, index, updates) {
  const newCurve = [...curve];
  if (index < 0 || index >= newCurve.length) return newCurve;
  newCurve[index] = { ...newCurve[index], ...updates };
  if (updates.emotion_type) {
    newCurve[index].tension = EMOTION_TYPES[updates.emotion_type]?.tensionBase ?? 0.5;
  }
  return newCurve;
}

/**
 * 删除节点
 */
export function removeNode(curve, index) {
  return curve.filter((_, i) => i !== index);
}

/**
 * 验证曲线：检查是否有问题
 * @returns {{ valid: boolean, warnings: string[] }}
 */
export function validateCurve(curve) {
  const warnings = [];

  if (curve.length < 2) {
    warnings.push('情绪曲线至少需要2个节点');
  }

  // 检查锯齿循环（不能连续3个同类型低强度）
  let sameCount = 0;
  let lastType = null;
  for (const node of curve) {
    if (node.emotion_type === lastType && node.intensity < 0.4) {
      sameCount++;
      if (sameCount >= 3) {
        warnings.push(`连续3个以上平淡节点（${EMOTION_TYPES[lastType]?.label}），可能导致观众流失`);
        break;
      }
    } else {
      sameCount = 0;
    }
    lastType = node.emotion_type;
  }

  // 检查张力递进（后半段平均张力应 ≥ 前半段）
  if (curve.length >= 4) {
    const mid = Math.floor(curve.length / 2);
    const firstHalfAvg = curve.slice(0, mid).reduce((s, n) => s + n.tension, 0) / mid;
    const secondHalfAvg = curve.slice(mid).reduce((s, n) => s + n.tension, 0) / (curve.length - mid);
    if (secondHalfAvg < firstHalfAvg * 0.8) {
      warnings.push('张力未递进：后半段张力低于前半段，建议在结尾前增加张力节点');
    }
  }

  // 检查是否有高潮节点（intensity ≥ 0.8）
  const hasClimax = curve.some(n => n.intensity >= 0.8);
  if (!hasClimax) {
    warnings.push('缺少高潮节点（intensity ≥ 0.8），建议在2/3处添加');
  }

  return { valid: warnings.length === 0, warnings };
}

// ── 下游参数映射 ──

/**
 * 将情绪曲线转换为下游 Phase 5-7 的 prompt 参数
 * @param {Array} curve - 情绪曲线
 * @param {string} timestamp - 当前镜头的时间戳（如 "10-15s"）
 * @returns {{ emotionPrompt: string, lightingHint: string, cameraHint: string, tensionLevel: number }}
 */
export function mapToShotParams(curve, timestamp) {
  const shotStart = parseTimestamp(timestamp);

  // 找到最近的情绪节点（或插值）
  const node = findNodeAtTime(curve, shotStart);
  if (!node) {
    return {
      emotionPrompt: '',
      lightingHint: '',
      cameraHint: '',
      tensionLevel: 0.5,
    };
  }

  const emotionInfo = EMOTION_TYPES[node.emotion_type] || EMOTION_TYPES.curiosity;

  // 张力级别映射到视觉参数
  const tension = node.tension;
  const lightingHint = tension > 0.7
    ? 'high contrast lighting, dramatic shadows'
    : tension > 0.4
      ? 'balanced natural lighting'
      : 'soft warm lighting, diffused';

  const cameraHint = tension > 0.7
    ? 'close-up or tight framing, shallow depth of field'
    : tension > 0.4
      ? 'medium shot, moderate depth'
      : 'wide shot, deep focus, stable';

  return {
    emotionPrompt: emotionInfo.promptHint,
    lightingHint,
    cameraHint,
    tensionLevel: tension,
    emotionType: node.emotion_type,
    emotionLabel: emotionInfo.label,
    intensity: node.intensity,
  };
}

/**
 * 生成完整的情绪曲线 prompt 增强描述
 * 用于在视频生成 prompt 末尾追加情绪指导
 */
export function buildEmotionPromptSuffix(curve, shotTimestamp) {
  const params = mapToShotParams(curve, shotTimestamp);
  if (!params.emotionPrompt) return '';
  return `Mood: ${params.emotionPrompt}. Lighting: ${params.lightingHint}. Camera: ${params.cameraHint}.`;
}

// ── 序列化/反序列化 ──

export async function saveCurve(curve, filePath) {
  await writeFile(filePath, JSON.stringify(curve, null, 2));
}

export async function loadCurve(filePath) {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

// ── 工具函数 ──

function parseTimestamp(ts) {
  // "0-3s" → 1.5, "3-10s" → 6.5, "10s" → 10
  if (!ts) return 0;
  const clean = ts.replace(/s$/i, '');
  if (clean.includes('-')) {
    const [a, b] = clean.split('-').map(Number);
    return (a + b) / 2;
  }
  return Number(clean) || 0;
}

function findNodeAtTime(curve, time) {
  if (!curve.length) return null;
  // 找最近的节点
  let closest = curve[0];
  let minDist = Infinity;
  for (const node of curve) {
    const nodeTime = parseTimestamp(node.timestamp);
    const dist = Math.abs(nodeTime - time);
    if (dist < minDist) {
      minDist = dist;
      closest = node;
    }
  }
  return closest;
}

// ── CLI ──

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'types':
      console.log(JSON.stringify(EMOTION_TYPES, null, 2));
      break;
    case 'extract': {
      const timeline = JSON.parse(process.argv[3] || '[]');
      console.log(JSON.stringify(extractFromBlueprint(timeline), null, 2));
      break;
    }
    case 'validate': {
      const curve = JSON.parse(process.argv[3] || '[]');
      console.log(JSON.stringify(validateCurve(curve), null, 2));
      break;
    }
    case 'map': {
      const curve = JSON.parse(process.argv[3] || '[]');
      const ts = process.argv[4] || '0-3s';
      console.log(JSON.stringify(mapToShotParams(curve, ts), null, 2));
      break;
    }
    default:
      console.error('用法: emotion-curve-editor.js <types|extract|validate|map> [args]');
  }
}
