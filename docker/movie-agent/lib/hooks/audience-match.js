/**
 * 受众匹配 hook
 * 从 audience-adapter.js 精简而来
 * audience skill 是提示词驱动的，无可调 JS，这里返回结构化 prompt 上下文
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIENCE_SKILL_DIR = join(__dirname, '..', '..', 'skills', 'kais-audience');

function loadAudienceContext() {
  const skillMd = join(AUDIENCE_SKILL_DIR, 'SKILL.md');
  if (!existsSync(skillMd)) return { skillPrompt: '', personas: [] };

  const personasDir = join(AUDIENCE_SKILL_DIR, 'personas');
  const personas = [];
  if (existsSync(personasDir)) {
    for (const f of readdirSync(personasDir).filter(f => f.endsWith('.md'))) {
      personas.push(readFileSync(join(personasDir, f), 'utf-8'));
    }
  }

  return { skillPrompt: readFileSync(skillMd, 'utf-8'), personas };
}

export async function audienceMatch({ content, platform = 'douyin' }) {
  const { skillPrompt } = loadAudienceContext();
  return {
    mode: 'audience-match',
    platform,
    content: {
      title: content.title || '',
      genre: content.genre || '',
      synopsis: content.synopsis || content.description || '',
    },
    skillPrompt,
    instruction: `请按照 kais-audience 的"受众匹配模式"分析以下内容，输出核心受众画像、匹配度、平台适配建议。`,
  };
}

export async function deepAudienceAnalysis({ script, platform = 'douyin' }) {
  const { skillPrompt, personas } = loadAudienceContext();
  return {
    mode: 'deep-analysis',
    platform,
    script: typeof script === 'string' ? script.substring(0, 5000) : JSON.stringify(script),
    personasLoaded: personas.length,
    skillPrompt,
    personas,
    instruction: `请按照 kais-audience 的"深度测评模式"对以下剧本进行完整分析，包括情绪曲线、毒点检测、完播率预测。使用加载的 ${personas.length} 个人设文件组建评审团。`,
  };
}
