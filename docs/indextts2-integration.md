# IndexTTS2 引擎集成文档 — kais-aigc-platform V9.0

## 概述

将 kana112233/ComfyUI-kaola-IndexTTS2 v1.1.1 集成到 kais-aigc-platform 的 MEGAPAK ComfyUI 引擎中。

## 6 大核心能力

| # | 节点 | 功能 | 输入 |
|---|------|------|------|
| 1 | IndexTTS2ModelLoader | 模型加载 + FP16/DeepSpeed/CUDA kernel | model_dir |
| 2 | IndexTTS2VoiceClone | 零样本语音克隆 (5-15秒参考音频) | text + spk_audio |
| 3 | IndexTTS2Emotion(Audio) | 音频参考情绪控制 (说话人-情绪解耦) | text + spk_audio + emo_audio |
| 4 | IndexTTS2Emotion(Vector) | 8维情绪向量精确控制 | text + spk_audio + 8维float |
| 5 | IndexTTS2Emotion(Text) | 自然语言情绪描述 | text + spk_audio + emo_text |
| 6 | IndexTTS2ScriptDubbing(SRT) | 多角色剧本配音 | SRT + voice_1~7 + emo_audio |

## 情绪向量维度

```
[happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]
```
每个维度 0.0-1.0，可独立控制。

## SRT 剧本格式

```srt
1
00:00:00,000 --> 00:00:03,000
唐僧(平静的说)：悟空，你看那夕阳，像不像我们取经路上最美的风景。

2
00:00:04,000 --> 00:00:06,500
孙悟空（愤怒的说）：管他什么妖怪，俺老孙一棒子打下去！
```

### 情绪优先级

1. **最高**: 括号情绪标注 `唐僧(高兴的说)：` → 强制 emo_text 模式
2. **中**: emo_audio_prompt 连接 + SRT 时间切片
3. **最低**: 无情绪控制，纯声音克隆

## 基础设施

### Docker 挂载 (docker-compose.v9.yml)

```yaml
volumes:
  - /data/workspace/comfyui-incremental-nodes/ComfyUI-kaola-IndexTTS2:/root/ComfyUI/custom_nodes/ComfyUI-kaola-IndexTTS2
  - /data/models/IndexTTS-2:/root/ComfyUI/models/IndexTTS-2:ro
  - /data/models/w2v-bert-2.0:/data/models/w2v-bert-2.0:ro
environment:
  W2V_BERT_PATH: "/data/models/w2v-bert-2.0"
```

### 模型文件

| 模型 | 路径 | 大小 |
|------|------|------|
| IndexTTS-2 | /data/models/IndexTTS-2 | ~4GB |
| w2v-bert-2.0 | /data/models/w2v-bert-2.0 | ~1.2GB |

### 依赖安装

`scripts/install-indextts2-deps.sh` — 在 ComfyUI 容器内执行

## 工作流文件

- `workflows/indextts2_full_demo.json` — 全功能6节点 Demo 工作流
- `examples/01_voice_clone.json` — 基础克隆
- `examples/02_emotion_audio.json` — 音频情绪
- `examples/03_emotion_vector.json` — 8维向量
- `examples/04_emotion_text.json` — 文本情绪
- `examples/05_script_dubbing.json` — SRT 多角色配音

## ComfyUI API 集成

IndexTTS2 通过 ComfyUI API (:8188) 调用。gold-team 已有 ComfyUI 集成能力。

### 零样本克隆 API 调用示例

```json
{
  "prompt": {
    "1": { "class_type": "IndexTTS2ModelLoader", "inputs": { "model_dir": "IndexTTS-2", "use_fp16": true } },
    "2": { "class_type": "LoadAudio", "inputs": { "audio": "ref.wav", "subfolder": "input" } },
    "3": { "class_type": "IndexTTS2VoiceClone", "inputs": { "model": ["1", 0], "text": "你好世界", "spk_audio_prompt": ["2", 0] } },
    "4": { "class_type": "SaveAudio", "inputs": { "audio": ["3", 0], "filename_prefix": "output" } }
  }
}
```

## Demo 测试

需要准备:
1. 角色A 音频参考 (唐僧声线, 5-15秒清晰语音)
2. 角色B 音频参考 (孙悟空声线, 5-15秒清晰语音)
3. 可选: 情绪参考音频 (愤怒/悲伤/高兴语音样本)
