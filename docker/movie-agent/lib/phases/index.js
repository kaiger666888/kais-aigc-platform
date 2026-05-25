/**
 * Phase handlers — 各阶段的介入逻辑
 * pipeline 编排器通过 phaseHandlers[phaseId] 调用对应 handler
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import {
  generateTopics, audienceMatch, deepAudienceAnalysis,
  registerCharacterDNA, registerSceneDNA,
  generateBlueprint, assessQuality,
  generatePoseReferences, generateShotPoses,
  analyzeScript, toGateSupplement, summarizeReport,
} from '../hooks/index.js';
import { GoldTeamClient, GoldTeamError } from '../gold-team-client.js';
import { AssetBus } from '../asset-bus.js';
import { PromptInjector } from '../prompt-injector.js';
import { parseShotToGpuParams, deduplicateSceneNeeds } from '../shot-list-parser.js';
import { AIScorer } from '../ai-scorer.js';
import { callLLMJson } from '../llm.js';

/**
 * 各阶段的 before/after 钩子
 * before: 阶段执行前的预处理
 * after: 阶段执行后的后处理（数据提取、DNA注册等）
 */
export const phaseHandlers = {
  requirement: {
    after: async (pipeline, phase, phaseConfig) => {
      const req = pipeline.config;
      await writeFile(join(pipeline.workdir, 'requirement.json'), JSON.stringify(req, null, 2));

      // 四维蓝图
      try {
        await generateBlueprint(pipeline, req);
      } catch (err) {
        console.warn(`[pipeline] 蓝图生成失败（不阻塞）: ${err.message}`);
      }

      // 受众匹配
      try {
        const matchResult = await audienceMatch({ content: req, platform: pipeline.config.platform || 'douyin' });
        pipeline.audienceMatch = matchResult;
        await writeFile(join(pipeline.workdir, 'audience-match.json'), JSON.stringify(matchResult, null, 2));
        console.log('[pipeline] ✅ 受众匹配完成');
      } catch (e) {
        console.warn(`[pipeline] 受众匹配跳过: ${e.message}`);
      }

      // 选题发散
      try {
        const topics = await generateTopics(req, {
          platform: pipeline.config.platform || 'douyin',
          genre: req.genre,
          blueprint: pipeline.blueprint,
        });
        phaseConfig.data = phaseConfig.data || {};
        phaseConfig.data.candidateTopics = topics;
        pipeline.candidateTopics = topics;
        await writeFile(join(pipeline.workdir, 'candidate-topics.json'), JSON.stringify(topics, null, 2));
        console.log(`[pipeline] ✅ 选题发散完成: ${topics.length} 个`);
      } catch (e) {
        console.warn(`[pipeline] 选题发散跳过: ${e.message}`);
      }

      return { summary: { title: req.title, genre: req.genre }, metrics: { characterCount: req.characters?.length || 0 } };
    },
  },

  'art-direction': {
    after: async (pipeline, phase, phaseConfig) => {
      // 如果没有提供 data，通过 LLM 生成美术方向
      if (!phaseConfig.data) {
        console.log('[art-direction] 未提供 phaseConfig.data，尝试 LLM 生成...');
        phaseConfig.data = await _generateArtDirection(pipeline);
      }

      const data = phaseConfig.data;
      if (!data) return;

      // 如果配置了 gold-team FLUX 模式，通过 GPU 生成候选图
      if (pipeline.config.goldTeam?.enableFluxArt) {
        try {
          const gtClient = _makeGtClient(pipeline);
          const available = await gtClient.ping(5000);
          if (available) {
            const prompt = data.prompt || data.description || '';
            const style = data.style || pipeline.config.style_preference || '';
            const result = await generateArtDirectionViaGoldTeam(pipeline, prompt, style);
            const task = await gtClient.waitForTask(result.taskId, {
              pollIntervalMs: 5000,
              timeoutMs: 600000,
            });

            const artifacts = task.artifacts || [];
            if (artifacts.length) {
              console.log(`[art-direction] ✅ FLUX 生成 ${artifacts.length} 个候选`);
              data.fluxArtifacts = artifacts.map(a => a.path);
            }
          } else {
            console.warn('[art-direction] gold-team 不可用，使用即梦 API');
          }
        } catch (err) {
          if (err instanceof GoldTeamError) {
            console.warn(`[art-direction] gold-team 降级: ${err.message}`);
          } else {
            throw err;
          }
        }
      }

      // 保存产出
      await writeFile(join(pipeline.workdir, 'art_direction.json'), JSON.stringify(data, null, 2));

      // V2: 写入 art-bible.json 资产
      try {
        const bus = new AssetBus(pipeline.workdir);
        await bus.write('art-bible', {
          style_anchor: data.style || data.style_anchor || '',
          lighting_rules: data.lighting || '',
          color_palette: data.color_palette || [],
          composition_rules: data.composition || '',
        });
        console.log('[art-direction] ✅ art-bible.json 已写入资产总线');
      } catch (e) {
        console.warn(`[art-direction] art-bible 写入跳过: ${e.message}`);
      }

      // 构建审核候选
      if (phase.review && !phaseConfig.reviewCandidates?.length) {
        const candidates = [];
        const images = data.fluxArtifacts || data.candidates || [];
        for (let i = 0; i < images.length; i++) {
          candidates.push({
            id: `art-${i + 1}`,
            label: `美术方案 ${i + 1}`,
            description: data.style || '',
            imagePath: images[i],
          });
        }
        phaseConfig.reviewCandidates = candidates;
        if (candidates.length) {
          console.log(`[art-direction] 审核候选: ${candidates.length} 个`);
        }
      }
    },
  },

  character: {
    after: async (pipeline, phase, phaseConfig) => {
      let characters = phaseConfig.data?.characters;

      // 如果没有提供角色数据，尝试 LLM 生成
      if (!characters?.length) {
        console.log('[character] phaseConfig.data.characters 为空，尝试 LLM 生成...');
        characters = await _generateCharacters(pipeline);
        if (!characters?.length) {
          throw new Error('[pipeline] Phase 3 未产出角色数据');
        }
      }
      await registerCharacterDNA(pipeline, characters);

      // V2: 写入 character-assets.json 资产
      try {
        const bus = new AssetBus(pipeline.workdir);
        await bus.write('character-assets', {
          characters: characters.map(c => ({
            name: c.name,
            core_prompt: c.description || c.core_prompt || '',
            ref_images: c.refImages || c.referenceImages || [],
            lora_path: c.lora_path || '',
            seed: c.seed || null,
          })),
        });
        console.log('[character] ✅ character-assets.json 已写入资产总线');
      } catch (e) {
        console.warn(`[character] character-assets 写入跳过: ${e.message}`);
      }

      // 姿态参考图生成（可选，失败不阻断）
      try {
        const poseRefs = await generatePoseReferences(pipeline, characters, {
          mode: pipeline.config.poseMode || 'mixamo',
        });
        pipeline.poseReferences = poseRefs;
        console.log(`[pipeline] ✅ 姿态参考图已生成`);
      } catch (e) {
        console.warn(`[pipeline] 姿态参考图跳过: ${e.message}`);
      }
    },
  },

  scenario: {
    after: async (pipeline, phase, phaseConfig) => {
      if (!phaseConfig.data) return;
      try {
        const analysis = await deepAudienceAnalysis({
          script: typeof phaseConfig.data === 'string' ? phaseConfig.data : phaseConfig.data.script || JSON.stringify(phaseConfig.data),
          platform: pipeline.config.platform || 'douyin',
        });
        pipeline.audienceAnalysis = analysis;
        await writeFile(join(pipeline.workdir, 'audience-analysis.json'), JSON.stringify(analysis, null, 2));
        console.log('[pipeline] ✅ 剧本受众测评完成');
      } catch (e) {
        console.warn(`[pipeline] 剧本受众测评跳过: ${e.message}`);
      }

      // 剧本量化分析（kais-story-score，可选）
      try {
        const storyReport = analyzeScript(phaseConfig.data, {
          language: 'zh',
          storyType: pipeline.config.genre || 'classic_narrative',
        });
        if (storyReport) {
          pipeline.storyScoreReport = storyReport;
          const summary = summarizeReport(storyReport);
          const scorePath = join(pipeline.workdir, 'story-score-report.json');
          await writeFile(scorePath, JSON.stringify(summary, null, 2));
          console.log(`[pipeline] ✅ 剧本量化分析完成: 弧线=${summary.arcShape}(${(summary.arcScore*100).toFixed(0)}%), 建议${summary.adviceCount}条`);
        }
      } catch (e) {
        console.warn(`[pipeline] 剧本量化分析跳过: ${e.message}`);
      }
    },
  },

  voice: {
    after: async (pipeline, phase, phaseConfig) => {
      const workdir = pipeline.workdir;
      const ttsDir = join(workdir, 'assets', 'tts');
      await mkdir(ttsDir, { recursive: true });

      // Collect dialogue lines from phaseConfig.data or scenario.json
      const dialogueLines = phaseConfig.data?.dialogueLines
        || await _loadDialogueFromScenario(workdir);
      if (!dialogueLines?.length) {
        console.log('[pipeline] Phase 4.5 无对白数据，跳过 TTS');
        return { summary: { linesProcessed: 0 }, metrics: {} };
      }

      // Build voice assignments map
      const voiceAssignments = [];

      // Try gold-team TTS first, fallback to local ZHIPU GLM-TTS
      let usedGoldTeam = false;
      try {
        const gtClient = new GoldTeamClient({
          baseUrl: pipeline.config?.goldTeam?.baseUrl,
          apiKey: pipeline.config?.goldTeam?.apiKey,
        });

        // Health check before submitting batch
        const available = await gtClient.ping(5000);
        if (!available) {
          throw new GoldTeamError('gold-team health check failed');
        }

        console.log(`[voice] gold-team 可用，开始提交 ${dialogueLines.length} 条 TTS 任务`);

        for (const line of dialogueLines) {
          const result = await gtClient.submitTTS(line.text, {
            voiceId: line.voiceId || line.voice_id || 'Vivian',
            language: line.language || 'zh',
            outputFormat: line.outputFormat || 'wav',
          });

          // Poll until done (5min timeout per line)
          const task = await gtClient.waitForTask(result.taskId, {
            pollIntervalMs: 3000,
            timeoutMs: 300000,
          });

          // Collect artifact info
          const artifacts = task.artifacts || [];
          const audioFile = artifacts[0]?.path || `${result.taskId}.wav`;
          const outputPath = join(ttsDir, `${line.id || line.lineId || result.taskId}.wav`);

          voiceAssignments.push({
            lineId: line.id || line.lineId || result.taskId,
            character: line.character || line.speaker || '',
            text: line.text,
            voiceId: line.voiceId || line.voice_id || 'Vivian',
            taskId: result.taskId,
            audioFile: basename(outputPath),
            artifactPath: audioFile,
            source: 'gold-team',
          });

          console.log(`[voice] TTS 完成: "${line.text.substring(0, 30)}..." → ${basename(outputPath)}`);
        }

        usedGoldTeam = true;
        console.log(`[voice] gold-team TTS 全部完成: ${voiceAssignments.length} 条`);
      } catch (err) {
        if (err instanceof GoldTeamError) {
          console.warn(`[voice] gold-team 不可用: ${err.message}，使用本地回退`);
          voiceAssignments.length = 0; // Clear partial results
        } else {
          throw err;
        }
      }

      // Fallback: local TTS via ZHIPU GLM-TTS
      if (!usedGoldTeam) {
        console.log(`[voice] 本地 TTS 回退: ${dialogueLines.length} 条`);
        const localResults = await _localTTSFallback(dialogueLines, ttsDir, pipeline.config);
        voiceAssignments.push(...localResults);
      }

      // 声音克隆 / 变声（可选，通过 config.goldTeam 启用）
      if (pipeline.config.goldTeam?.enableVoiceClone && pipeline._gpuVoiceAvailable !== false) {
        const cloneTasks = phaseConfig.data?.cloneTasks || [];
        for (const ct of cloneTasks) {
          try {
            const result = await cloneVoice(pipeline, ct.referenceAudio, ct.text, ct.language || 'zh');
            const gtClient2 = new GoldTeamClient({
              baseUrl: pipeline.config?.goldTeam?.baseUrl,
              apiKey: pipeline.config?.goldTeam?.apiKey,
            });
            const task = await gtClient2.waitForTask(result.taskId, {
              pollIntervalMs: 3000,
              timeoutMs: 300000,
            });
            const artifacts = task.artifacts || [];
            if (artifacts.length) {
              voiceAssignments.push({
                lineId: ct.id || `clone-${voiceAssignments.length + 1}`,
                character: ct.character || '',
                text: ct.text,
                taskId: result.taskId,
                audioFile: `${ct.id || `clone-${voiceAssignments.length + 1}`}.wav`,
                artifactPath: artifacts[0].path,
                source: 'gold-team-clone',
              });
              console.log(`[voice] ✅ 声音克隆完成: "${ct.text.substring(0, 30)}..."`);
            }
          } catch (err) {
            console.warn(`[voice] 声音克隆降级: ${err.message}`);
          }
        }

        const convertTasks = phaseConfig.data?.convertTasks || [];
        for (const cvt of convertTasks) {
          try {
            const result = await convertVoice(pipeline, cvt.sourceAudio, cvt.targetVoice);
            const gtClient3 = new GoldTeamClient({
              baseUrl: pipeline.config?.goldTeam?.baseUrl,
              apiKey: pipeline.config?.goldTeam?.apiKey,
            });
            const task = await gtClient3.waitForTask(result.taskId, {
              pollIntervalMs: 3000,
              timeoutMs: 300000,
            });
            const artifacts = task.artifacts || [];
            if (artifacts.length) {
              voiceAssignments.push({
                lineId: cvt.id || `convert-${voiceAssignments.length + 1}`,
                character: cvt.character || '',
                text: '[voice-convert]',
                taskId: result.taskId,
                audioFile: `${cvt.id || `convert-${voiceAssignments.length + 1}`}.wav`,
                artifactPath: artifacts[0].path,
                source: 'gold-team-convert',
              });
              console.log(`[voice] ✅ 变声完成: ${cvt.sourceAudio} → ${cvt.targetVoice}`);
            }
          } catch (err) {
            console.warn(`[voice] 变声降级: ${err.message}`);
          }
        }
      }

      // Save voice_assignments.json
      await writeFile(
        join(workdir, 'voice_assignments.json'),
        JSON.stringify(voiceAssignments, null, 2),
      );

      return {
        summary: {
          linesProcessed: voiceAssignments.length,
          source: usedGoldTeam ? 'gold-team' : 'local-fallback',
        },
        metrics: {
          ttsLines: voiceAssignments.length,
          usedGoldTeam,
        },
      };
    },
  },

  scene: {
    after: async (pipeline, phase, phaseConfig) => {
      const scenes = phaseConfig.data?.scenes;
      if (!scenes?.length) {
        console.log('[pipeline] Phase 5 无场景数据，跳过场景DNA');
        return;
      }
      try {
        await registerSceneDNA(pipeline, scenes);
      } catch (e) {
        console.warn(`[pipeline] 场景DNA跳过: ${e.message}`);
      }

      // 构建审核候选：从 phaseConfig.data 或磁盘收集场景图候选
      if (phase.review && !phaseConfig.reviewCandidates?.length) {
        phaseConfig.reviewCandidates = _buildSceneReviewCandidates(pipeline.workdir, scenes);
        if (phaseConfig.reviewCandidates.length) {
          console.log(`[pipeline] 场景图审核: ${phaseConfig.reviewCandidates.length} 个候选`);
        }
      }
    },
  },

  storyboard: {
    before: async (pipeline, phase) => {
      // 为需要特定动作的分镜镜头生成姿态参考
      if (!pipeline.poseReferences || !pipeline.shots) return;
      try {
        const shotPoses = await generateShotPoses(
          pipeline, pipeline.shots, pipeline.poseReferences
        );
        pipeline.shotPoses = shotPoses;
        console.log(`[pipeline] ✅ 分镜姿态参考已生成`);
      } catch (e) {
        console.warn(`[pipeline] 分镜姿态参考跳过: ${e.message}`);
      }
    },
    after: async (pipeline, phase, phaseConfig) => {
      // 构建审核候选：从磁盘收集分镜板产出
      if (phase.review && !phaseConfig.reviewCandidates?.length) {
        phaseConfig.reviewCandidates = await _buildStoryboardReviewCandidates(pipeline.workdir, phaseConfig);
        if (phaseConfig.reviewCandidates.length) {
          console.log(`[pipeline] 分镜板审核: ${phaseConfig.reviewCandidates.length} 个候选`);
        }
      }
    },
  },

  camera: {
    before: async (pipeline, phase) => {
      // 恢复角色 DNA（参考图锚定模式）
      if (pipeline.characterDNA.size === 0) {
        try {
          const raw = await readFile(join(pipeline.workdir, 'character-dna.json'), 'utf-8');
          const saved = JSON.parse(raw);
          for (const [name, dna] of Object.entries(saved)) pipeline.characterDNA.set(name, dna);
          console.log(`[pipeline] 恢复了 ${pipeline.characterDNA.size} 个角色DNA卡（参考图锚定模式）`);
        } catch {
          console.warn('[pipeline] ⚠️ 无角色DNA卡，视频生成将不带入角色参考图');
        }
      }

      // 注入角色参考图到 pipeline config，供 camera 阶段使用
      // 即梦通过 @引用 + images 参数实现一致性，不依赖 seed
      if (pipeline.characterDNA.size > 0) {
        const characterRefs = {};
        for (const [name, dna] of pipeline.characterDNA) {
          if (dna.refImages?.length) {
            characterRefs[name] = {
              refImages: dna.refImages,
              description: dna.description || '',
              lastFrameUrl: dna.lastFrameUrl,
            };
          }
        }
        pipeline.config._characterRefs = characterRefs;
        console.log(`[pipeline] ✅ ${Object.keys(characterRefs).length} 个角色参考图已注入（@引用锚定模式）`);
      }

      // 恢复场景 DNA（可选）
      if (pipeline.sceneDNA.size === 0) {
        try {
          const raw = await readFile(join(pipeline.workdir, 'scene-dna.json'), 'utf-8');
          const saved = JSON.parse(raw);
          for (const [name, dna] of Object.entries(saved)) pipeline.sceneDNA.set(name, dna);
        } catch { /* optional */ }
      }
      if (pipeline.sceneDNA.size > 0) {
        const sceneRefs = {};
        for (const [name, dna] of pipeline.sceneDNA) {
          if (dna.refImages?.length) {
            sceneRefs[name] = { refImages: dna.refImages, description: dna.description || '' };
          }
        }
        pipeline.config._sceneRefs = sceneRefs;
        console.log(`[pipeline] ✅ ${Object.keys(sceneRefs).length} 个场景锚定图已注入`);
      }

      // GPU 视频生成模式（可选，通过 config.goldTeam.enableVideoGpu 启用）
      if (pipeline.config.goldTeam?.enableVideoGpu) {
        try {
          const gtClient = _makeGtClient(pipeline);
          const available = await gtClient.ping(5000);
          pipeline._gpuVideoAvailable = available;
          if (available) {
            console.log('[camera] ✅ gold-team GPU 视频生成可用');
          } else {
            console.warn('[camera] gold-team 不可用，使用即梦 API');
          }
        } catch (err) {
          pipeline._gpuVideoAvailable = false;
          console.warn(`[camera] gold-team 检测失败: ${err.message}`);
        }
      }
    },
    after: async (pipeline, phase, phaseConfig) => {
      // 构建审核候选：从磁盘收集视频产出
      if (phase.review && !phaseConfig.reviewCandidates?.length) {
        phaseConfig.reviewCandidates = await _buildCameraReviewCandidates(pipeline.workdir, phaseConfig);
        if (phaseConfig.reviewCandidates.length) {
          console.log(`[pipeline] 视频片段审核: ${phaseConfig.reviewCandidates.length} 个候选`);
        }
      }
    },
  },

  'post-production': {
    after: async (pipeline, phase, phaseConfig) => {
      const data = phaseConfig.data;
      if (!data) return;

      const assetsDir = join(pipeline.workdir, 'assets', 'audio');
      await mkdir(assetsDir, { recursive: true });

      // 配乐生成
      if (pipeline.config.goldTeam?.enableBGM && data.bgmPrompt) {
        try {
          const gtClient = _makeGtClient(pipeline);
          const available = await gtClient.ping(5000);
          if (available) {
            const result = await generateBGM(pipeline, data.bgmPrompt, data.bgmDuration || 60);
            const task = await gtClient.waitForTask(result.taskId, {
              pollIntervalMs: 5000,
              timeoutMs: 600000,
            });
            const artifacts = task.artifacts || [];
            if (artifacts.length) {
              data.bgmArtifact = artifacts[0].path;
              console.log(`[post-production] ✅ BGM 生成完成`);
            }
          }
        } catch (err) {
          if (err instanceof GoldTeamError) {
            console.warn(`[post-production] BGM 生成降级: ${err.message}`);
          } else {
            throw err;
          }
        }
      }

      // 音效生成
      if (pipeline.config.goldTeam?.enableSFX && data.sfxPrompts?.length) {
        try {
          const gtClient = _makeGtClient(pipeline);
          const available = await gtClient.ping(5000);
          if (available) {
            data.sfxArtifacts = [];
            for (const sfxPrompt of data.sfxPrompts) {
              const result = await generateSFX(pipeline, sfxPrompt);
              const task = await gtClient.waitForTask(result.taskId, {
                pollIntervalMs: 3000,
                timeoutMs: 300000,
              });
              const artifacts = task.artifacts || [];
              if (artifacts.length) {
                data.sfxArtifacts.push({ prompt: sfxPrompt, path: artifacts[0].path });
              }
            }
            console.log(`[post-production] ✅ SFX 生成完成: ${data.sfxArtifacts.length} 条`);
          }
        } catch (err) {
          if (err instanceof GoldTeamError) {
            console.warn(`[post-production] SFX 生成降级: ${err.message}`);
          } else {
            throw err;
          }
        }
      }

      await writeFile(join(pipeline.workdir, 'post_production.json'), JSON.stringify(data, null, 2));
    },
  },

  'camera-preview': {
    after: async (pipeline, phase, phaseConfig) => {
      // V2: Low-param preview using video_preview_fast
      const shots = phaseConfig.data?.shots || [];
      const results = [];
      for (const shot of shots) {
        try {
          const result = await generateVideoViaGoldTeam(pipeline, {
            ...shot,
            _preview: true,
          });
          results.push({ shotId: shot.id, taskId: result.taskId, state: 'submitted' });
        } catch (err) {
          console.warn(`[camera-preview] Shot ${shot.id} failed: ${err.message}`);
          results.push({ shotId: shot.id, error: err.message });
        }
      }
      await writeFile(join(pipeline.workdir, 'video_preview_tasks.json'), JSON.stringify({ tasks: results }, null, 2));
      phaseConfig.reviewCandidates = results.filter(r => !r.error).map(r => ({
        id: r.shotId, label: `预览 ${r.shotId}`, description: '',
      }));
    },
  },

  'camera-final': {
    after: async (pipeline, phase, phaseConfig) => {
      // V2: High-param final production — only shots that passed preview
      const previewResults = phaseConfig.data?.approvedShots || phaseConfig.data?.shots || [];
      const results = [];
      for (const shot of previewResults) {
        try {
          // Use PromptInjector for consistent visuals
          const bus = new AssetBus(pipeline.workdir);
          const injector = new PromptInjector(bus);
          const enhancedPrompt = await injector.inject(shot.description, {
            character: shot.character, scene: shot.scene_id, shotId: shot.id,
          });
          const result = await generateVideoViaGoldTeam(pipeline, {
            ...shot, description: enhancedPrompt,
          });
          results.push({ shotId: shot.id, taskId: result.taskId, state: 'submitted' });
        } catch (err) {
          console.warn(`[camera-final] Shot ${shot.id} failed: ${err.message}`);
          results.push({ shotId: shot.id, error: err.message });
        }
      }
      await writeFile(join(pipeline.workdir, 'video_tasks.json'), JSON.stringify({ tasks: results }, null, 2));
    },
  },

  'quality-gate': {
    after: async (pipeline, phase, phaseConfig) => {
      // 阈值配置：支持通过 phaseConfig 或 pipeline.config 覆盖默认
      const thresholds = phaseConfig.thresholds || pipeline.config.qualityGate?.thresholds || { overall: 65 };

      let result;
      try {
        result = await assessQuality(pipeline);
      } catch (assessErr) {
        // 质量评估自身异常 → 直接标记失败
        console.warn(`[pipeline] 质量评估异常: ${assessErr.message}`);
        return {
          summary: { score: 0, action: 'fail', error: assessErr.message },
          metrics: { dimensions: {} },
          status: 'failed',
          passed: false,
          error: assessErr.message,
        };
      }

      // story-score 数据注入质量门控报告
      if (pipeline.storyScoreReport) {
        try {
          const supplement = toGateSupplement(pipeline.storyScoreReport);
          if (supplement) {
            // 追加到门控结果中
            if (result && result.metrics && result.metrics.dimensions) {
              result.metrics.storyScore = supplement;
              result.metrics.dimensions.storyScore = {
                score: pipeline.storyScoreReport.overall_score || 0,
                detail: `5维度量化: 弧线${supplement.arcMatch.bestShape} 情感覆盖${(supplement.emotionCoverage.coverageScore*100).toFixed(0)}% TTR${supplement.textQuality.ttr.toFixed(3)}`,
              };
            }
            const summary = summarizeReport(pipeline.storyScoreReport);
            const scorePath = join(pipeline.workdir, 'story-score-report.json');
            await writeFile(scorePath, JSON.stringify(summary, null, 2));
            console.log(`[pipeline] ✅ story-score数据已注入门控`);
          }
        } catch (e) {
          console.warn(`[pipeline] story-score注入跳过: ${e.message}`);
        }
      }

      // 判定 PASS / FAIL
      const overallScore = result?.summary?.score || 0;
      const passed = overallScore >= thresholds.overall;

      if (!passed) {
        console.warn(`[pipeline] ⚠️ 质量门控未通过但放行 (MVP): ${overallScore} < ${thresholds.overall}`);
      } else {
        console.log(`[pipeline] ✅ 质量门控通过: ${overallScore} >= ${thresholds.overall}`);
      }

      return {
        summary: { ...result?.summary, score: overallScore, action: passed ? 'pass' : 'warn' },
        metrics: result?.metrics || {},
        status: 'completed',
        passed: true,  // MVP: always pass
        scores: result?.metrics?.dimensions || {},
      };
    },
  },

  delivery: {
    after: async (pipeline, phase, phaseConfig) => {
      console.log('[delivery] Phase completed (no-op for mock)');
    },
  },
};

// Phase 8 hook 已在 pipeline.js 的 PHASES 定义中通过 outputFiles 管理
// 后期合成的实际执行由 agent 调用外部工具（ffmpeg等），pipeline 只做检查点

// ─── LLM-based Auto-Generation Helpers ─────────────────────

/**
 * Generate art direction data from requirement using LLM.
 * Falls back to mock data if LLM is unavailable.
 */
async function _generateArtDirection(pipeline) {
  const req = pipeline.config || {};
  const title = req.title || '未命名项目';
  const genre = req.genre || '短片';
  const stylePref = req.style_preference || '';
  const characters = (req.characters || []).map(c => c.name || '角色').join(', ');

  const prompt = `你是一个动画美术总监。请根据以下项目需求，生成美术方向方案。

项目: ${title}
类型: ${genre}
风格偏好: ${stylePref || '由你决定'}
角色: ${characters || '待定'}

请返回 JSON 格式:
{
  "style": "美术风格描述",
  "style_anchor": "视觉锚点关键词",
  "lighting": "光照风格",
  "color_palette": ["#色值1", "#色值2", "#色值3", "#色值4"],
  "composition": "构图原则",
  "description": "整体美术方向描述"
}`;

  try {
    const result = await callLLMJson(prompt, { temperature: 0.7 });
    console.log('[art-direction] ✅ LLM 生成美术方向完成');
    return result;
  } catch (err) {
    console.warn(`[art-direction] LLM 生成失败: ${err.message}，使用 mock 数据`);
    return {
      style: `${genre}动画风格`,
      style_anchor: '2D animation, vibrant colors',
      lighting: '柔和自然光，局部戏剧性光影',
      color_palette: ['#2D5A8E', '#E8A838', '#4CAF50', '#D32F2F'],
      composition: '三分法构图，角色居中',
      description: `${title} 默认美术方向：${genre}风格，色彩鲜明`,
    };
  }
}

/**
 * Generate character designs from requirement using LLM.
 * Falls back to mock data if LLM is unavailable.
 */
async function _generateCharacters(pipeline) {
  const req = pipeline.config || {};
  const title = req.title || '未命名项目';
  const genre = req.genre || '短片';
  const inputCharacters = req.characters || [];

  // 如果 requirement 里已经有角色定义（带 name），直接使用
  if (inputCharacters.length > 0 && inputCharacters.some(c => c.description)) {
    console.log(`[character] 使用 requirement 中的 ${inputCharacters.length} 个角色定义`);
    return inputCharacters.map(c => ({
      name: c.name,
      description: c.description || '',
      core_prompt: c.description || c.name,
      refImages: [],
      seed: null,
    }));
  }

  const charNames = inputCharacters.map(c => c.name).filter(Boolean).join(', ') || '主角, 配角';

  const prompt = `你是一个角色设计师。请根据以下项目需求，设计角色。

项目: ${title}
类型: ${genre}
角色名: ${charNames}

请返回 JSON 数组格式:
[
  {
    "name": "角色名",
    "description": "详细外观描述（发型、服装、体型、特征）",
    "personality": "性格特征",
    "color_scheme": ["主色调", "辅助色"],
    "key_features": ["特征1", "特征2"]
  }
]`;

  try {
    const result = await callLLMJson(prompt, { temperature: 0.7 });
    const characters = Array.isArray(result) ? result : [result];
    console.log(`[character] ✅ LLM 生成了 ${characters.length} 个角色`);
    return characters.map(c => ({
      name: c.name || '未命名',
      description: c.description || '',
      core_prompt: c.description || c.name,
      personality: c.personality || '',
      color_scheme: c.color_scheme || [],
      key_features: c.key_features || [],
      refImages: [],
      seed: null,
    }));
  } catch (err) {
    console.warn(`[character] LLM 生成失败: ${err.message}，使用 mock 数据`);
    // 从 requirement 中提取角色名
    const mockChars = inputCharacters.length > 0
      ? inputCharacters.map(c => ({
          name: c.name || '未命名',
          description: `${c.name || '角色'}默认外观`,
          core_prompt: `${c.name || '角色'}动画角色`,
          refImages: [],
          seed: null,
        }))
      : [{
          name: '主角',
          description: '默认主角外观，简洁动画风格',
          core_prompt: '动画主角角色设计',
          refImages: [],
          seed: null,
        }];
    console.log(`[character] 使用 ${mockChars.length} 个 mock 角色`);
    return mockChars;
  }
}

// ─── Phase 4A: Gold-Team V4.1 Engine Integrations ──────────────

function _makeGtClient(pipeline) {
  return new GoldTeamClient({
    baseUrl: pipeline.config?.goldTeam?.baseUrl,
    apiKey: pipeline.config?.goldTeam?.apiKey,
    callbackBaseUrl: pipeline.config?.goldTeam?.callbackBaseUrl,
    traceId: pipeline.traceId,
  });
}

/**
 * 4A.2 art-direction → FLUX 图像生成
 * 通过 gold-team image_draw (FLUX) 引擎生成美术方向候选图
 */
export async function generateArtDirectionViaGoldTeam(pipeline, prompt, style) {
  const gtClient = _makeGtClient(pipeline);

  const result = await gtClient.submitTask({
    taskType: 'image_draw',
    params: {
      prompt: `${prompt}, ${style}`,
      negative_prompt: 'low quality, blurry',
      variant: 'schnell',
      width: 1024,
      height: 1024,
      num_images: 3,
      output_format: 'png',
      extra: {
        flux: {
          guidance_scale: 3.5,
          num_inference_steps: 4,
        },
      },
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:art-direction:${style}`,
  });

  return result;
}

/**
 * 4A.2 备选: FLUX 图像精修（已有草图时）
 */
export async function refineArtDirectionViaGoldTeam(pipeline, sourceImagePath, prompt) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'image_refine',
    params: {
      prompt,
      source_image_path: sourceImagePath,
      output_format: 'png',
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:art-direction-refine`,
  });
}

/**
 * 4A.2 备选: FLUX ControlNet（有参考图时）
 */
export async function controlArtDirectionViaGoldTeam(pipeline, referenceImagePath, prompt) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'image_control',
    params: {
      prompt,
      reference_image_path: referenceImagePath,
      output_format: 'png',
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:art-direction-control`,
  });
}

/**
 * 4A.5 camera → VIDEO_FINAL 视频生成
 * 通过 gold-team video_final / video_preview_fast 引擎生成视频
 */
export async function generateVideoViaGoldTeam(pipeline, shot) {
  const gtClient = _makeGtClient(pipeline);

  const isPreview = pipeline.config.preview_mode;
  const taskType = isPreview ? 'video_preview_fast' : 'video_final';

  const result = await gtClient.submitTask({
    taskType,
    params: {
      prompt: shot.description,
      negative_prompt: 'low quality, watermark, text',
      source_image_path: shot.referenceImage || '',
      width: 832,
      height: 480,
      num_frames: isPreview ? 33 : 81,
      num_inference_steps: isPreview ? 10 : 20,
      fps: 16,
      output_format: 'mp4',
      extra: {
        video_gen: {
          model: 'wan14b',
          guidance_scale: 5.0,
        },
      },
    },
    priority: isPreview ? 1 : 10,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:camera:shot-${shot.id}`,
  });

  return result;
}

/**
 * 4A.5 视频帧插值（提升帧率）
 */
export async function interpolateVideoViaGoldTeam(pipeline, videoPath, targetFps = 30) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'video_interpolate',
    params: {
      source_video_path: videoPath,
      target_fps: targetFps,
      output_format: 'mp4',
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:camera-interpolate`,
  });
}

/**
 * 4A.5 视频风格转换
 */
export async function styleTransferVideoViaGoldTeam(pipeline, videoPath, stylePrompt) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'video_to_video',
    params: {
      source_video_path: videoPath,
      prompt: stylePrompt,
      output_format: 'mp4',
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:camera-style-transfer`,
  });
}

/**
 * 4A.6 voice → VOICE_CLONE 声音克隆
 */
export async function cloneVoice(pipeline, referenceAudio, text, language = 'zh') {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'voice_clone',
    params: {
      text,
      reference_audio_path: referenceAudio,
      reference_text: '',
      language,
      output_format: 'wav',
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:voice-clone`,
  });
}

/**
 * 4A.6 voice → VOICE_CONVERT 变声
 */
export async function convertVoice(pipeline, sourceAudio, targetVoice) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'voice_convert',
    params: {
      source_audio_path: sourceAudio,
      target_voice: targetVoice,
      pitch_shift: 0,
      output_format: 'wav',
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:voice-convert`,
  });
}

/**
 * 4A.7 post-production → MUSIC_FINAL 配乐生成
 */
export async function generateBGM(pipeline, prompt, duration = 60) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'music_final',
    params: {
      prompt,
      duration,
      output_format: 'mp3',
      extra: { acestep: { bpm: 120, vocal_language: 'instrumental' } },
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:bgm`,
  });
}

/**
 * 4A.7 post-production → SFX 音效生成
 */
export async function generateSFX(pipeline, prompt) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'sfx_generation',
    params: { prompt, output_format: 'wav' },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:sfx`,
  });
}

/**
 * 4A.7 post-production → 音频分离（人声/伴奏）
 */
export async function separateAudio(pipeline, audioPath) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'audio_separate',
    params: { audio_path: audioPath, output_format: 'wav' },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:audio-separate`,
  });
}

/**
 * 4A.8 lip-sync → LIP_SYNC_RT 口型同步
 */
export async function lipSync(pipeline, characterImage, audioPath) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'lip_sync_rt',
    params: {
      source_image_path: characterImage,
      driving_audio_path: audioPath,
      output_format: 'mp4',
    },
    priority: 10,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:lip-sync`,
  });
}

// ─── Voice Phase Helper Functions ────────────────────────────

/**
 * Load dialogue lines from scenario.json on disk.
 * Extracts lines from the scenario structure (various formats supported).
 */
async function _loadDialogueFromScenario(workdir) {
  try {
    const raw = await readFile(join(workdir, 'scenario.json'), 'utf-8');
    const scenario = JSON.parse(raw);

    // Try common scenario structures
    const lines = [];

    // Format 1: scenario.dialogues[]
    if (Array.isArray(scenario.dialogues)) {
      for (const d of scenario.dialogues) {
        lines.push({
          id: d.id || `line-${lines.length + 1}`,
          text: d.text || d.content || '',
          character: d.character || d.speaker || '',
          voiceId: d.voiceId || d.voice_id,
          emotion: d.emotion,
        });
      }
      return lines;
    }

    // Format 2: scenario.scenes[].shots[].dialogue
    if (Array.isArray(scenario.scenes)) {
      for (const scene of scenario.scenes) {
        const shots = scene.shots || [];
        for (const shot of shots) {
          if (shot.dialogue) {
            lines.push({
              id: shot.id || shot.shot_id || `line-${lines.length + 1}`,
              text: shot.dialogue.text || shot.dialogue.content || shot.dialogue,
              character: shot.dialogue.character || shot.dialogue.speaker || '',
              voiceId: shot.dialogue.voiceId || shot.dialogue.voice_id,
              emotion: shot.dialogue.emotion,
            });
          }
        }
      }
      return lines;
    }

    // Format 3: scenario.lines[] (flat structure)
    if (Array.isArray(scenario.lines)) {
      for (const l of scenario.lines) {
        lines.push({
          id: l.id || `line-${lines.length + 1}`,
          text: l.text || l.content || '',
          character: l.character || l.speaker || '',
          voiceId: l.voiceId || l.voice_id,
          emotion: l.emotion,
        });
      }
      return lines;
    }

    return lines;
  } catch {
    return null;
  }
}

/**
 * Local TTS fallback using ZHIPU GLM-TTS API.
 * Used when gold-team is unavailable.
 */
async function _localTTSFallback(dialogueLines, ttsDir, config) {
  const apiKey = config?.zhipuApiKey || process.env.ZHIPU_API_KEY || '';
  const apiUrl = config?.zhipuApiUrl || process.env.ZHIPU_API_URL || 'https://open.bigmodel.cn/api/paas/v4/audio/speech';
  const assignments = [];

  if (!apiKey) {
    console.warn('[voice] ZHIPU_API_KEY 未配置，本地 TTS 跳过 — 生成占位文件');
    for (const line of dialogueLines) {
      const placeholderFile = `${line.id || line.lineId || assignments.length + 1}.wav`;
      assignments.push({
        lineId: line.id || line.lineId || `line-${assignments.length + 1}`,
        character: line.character || line.speaker || '',
        text: line.text,
        voiceId: line.voiceId || line.voice_id || 'Vivian',
        audioFile: placeholderFile,
        source: 'placeholder',
      });
    }
    return assignments;
  }

  for (const line of dialogueLines) {
    const voiceId = line.voiceId || line.voice_id || 'male-qn-qingse';
    const fileName = `${line.id || line.lineId || assignments.length + 1}.wav`;
    const outputPath = join(ttsDir, fileName);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'glm-4-voice',
          input: line.text,
          voice: voiceId,
          response_format: 'wav',
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        throw new Error(`GLM-TTS HTTP ${response.status}: ${await response.text().then(t => t.substring(0, 200))}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(outputPath, buffer);

      assignments.push({
        lineId: line.id || line.lineId || `line-${assignments.length + 1}`,
        character: line.character || line.speaker || '',
        text: line.text,
        voiceId,
        audioFile: fileName,
        source: 'local-zhipu',
      });

      console.log(`[voice] 本地 TTS: "${line.text.substring(0, 30)}..." → ${fileName}`);
    } catch (err) {
      console.warn(`[voice] 本地 TTS 失败 ("${line.text.substring(0, 20)}..."): ${err.message}`);
      assignments.push({
        lineId: line.id || line.lineId || `line-${assignments.length + 1}`,
        character: line.character || line.speaker || '',
        text: line.text,
        voiceId,
        audioFile: fileName,
        source: 'failed',
        error: err.message,
      });
    }
  }

  return assignments;
}

// ─── Review Candidate Builders ─────────────────────────────

/**
 * Build review candidates for scene phase from disk artifacts.
 * Collects scene images from assets/scenes/ and scene_design.json.
 */
function _buildSceneReviewCandidates(workdir, scenes) {
  const candidates = [];

  // From phaseConfig.data.scenes — each scene may have generated images
  if (Array.isArray(scenes)) {
    for (const scene of scenes) {
      const id = scene.id || scene.name || `scene-${candidates.length + 1}`;
      const candidate = {
        id,
        label: scene.name || scene.label || id,
        description: scene.description || scene.prompt || '',
        imageUrl: scene.imageUrl || scene.image_url || '',
        imagePath: scene.imagePath || scene.image_path || '',
      };
      // Only include candidates that have visual output
      if (candidate.imageUrl || candidate.imagePath) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

/**
 * Build review candidates for storyboard phase from disk artifacts.
 * Reads storyboard.json / shots.json and collects shot-level candidates.
 */
async function _buildStoryboardReviewCandidates(workdir, phaseConfig) {
  const candidates = [];

  // Try phaseConfig.data first (in-memory)
  const shots = phaseConfig.data?.shots || phaseConfig.data?.frames;
  if (Array.isArray(shots)) {
    for (const shot of shots) {
      const id = shot.id || shot.shot_id || `shot-${candidates.length + 1}`;
      const candidate = {
        id,
        label: shot.label || shot.description || `镜头 ${id}`,
        description: shot.description || shot.dialogue || '',
        imageUrl: shot.imageUrl || shot.image_url || '',
        imagePath: shot.imagePath || shot.image_path || '',
      };
      if (candidate.imageUrl || candidate.imagePath) {
        candidates.push(candidate);
      }
    }
    return candidates;
  }

  // Fallback: read from disk (storyboard.json or shots.json)
  for (const filename of ['storyboard.json', 'shots.json']) {
    try {
      const raw = await readFile(join(workdir, filename), 'utf-8');
      const data = JSON.parse(raw);
      const items = data.shots || data.frames || data.scenes || (Array.isArray(data) ? data : []);
      for (const item of items) {
        const id = item.id || item.shot_id || `shot-${candidates.length + 1}`;
        const candidate = {
          id,
          label: item.label || item.description || `镜头 ${id}`,
          description: item.description || item.dialogue || '',
          imageUrl: item.imageUrl || item.image_url || '',
          imagePath: item.imagePath || item.image_path || '',
        };
        if (candidate.imageUrl || candidate.imagePath) {
          candidates.push(candidate);
        }
      }
      if (candidates.length) return candidates;
    } catch {
      // File not found or invalid, try next
    }
  }

  return candidates;
}

/**
 * Build review candidates for camera phase from disk artifacts.
 * Reads video_tasks.json and collects video segment candidates.
 */
async function _buildCameraReviewCandidates(workdir, phaseConfig) {
  const candidates = [];

  // Try phaseConfig.data first (in-memory)
  const tasks = phaseConfig.data?.tasks || phaseConfig.data?.videos || phaseConfig.data?.segments;
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      const id = task.id || task.task_id || `video-${candidates.length + 1}`;
      const candidate = {
        id,
        label: task.label || task.shot_id || `片段 ${id}`,
        description: task.description || task.prompt || '',
        imageUrl: task.coverUrl || task.cover_url || task.thumbnail || '',
        imagePath: task.coverPath || task.cover_path || '',
        videoUrl: task.videoUrl || task.video_url || task.outputUrl || '',
        videoPath: task.videoPath || task.video_path || task.outputPath || '',
      };
      if (candidate.imageUrl || candidate.imagePath || candidate.videoUrl || candidate.videoPath) {
        candidates.push(candidate);
      }
    }
    return candidates;
  }

  // Fallback: read video_tasks.json from disk
  try {
    const raw = await readFile(join(workdir, 'video_tasks.json'), 'utf-8');
    const data = JSON.parse(raw);
    const items = data.tasks || data.videos || data.segments || (Array.isArray(data) ? data : []);
    for (const item of items) {
      const id = item.id || item.task_id || `video-${candidates.length + 1}`;
      const candidate = {
        id,
        label: item.label || item.shot_id || `片段 ${id}`,
        description: item.description || item.prompt || '',
        imageUrl: item.coverUrl || item.cover_url || item.thumbnail || '',
        imagePath: item.coverPath || item.cover_path || '',
        videoUrl: item.videoUrl || item.video_url || item.outputUrl || '',
        videoPath: item.videoPath || item.video_path || item.outputPath || '',
      };
      if (candidate.imageUrl || candidate.imagePath || candidate.videoUrl || candidate.videoPath) {
        candidates.push(candidate);
      }
    }
  } catch {
    // video_tasks.json not found or invalid
  }

  return candidates;
}
