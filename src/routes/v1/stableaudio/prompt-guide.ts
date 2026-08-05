/**
 * Stable Audio 3 Prompt Guide
 * ============================
 *
 * Source: official SA3 Prompting Guide
 * https://github.com/Stability-AI/stable-audio-3/blob/main/docs/guides/prompting.md
 *
 * SA3 was trained on Freesound + AudioSparx metadata, so AudioSparx-style tags
 * produce the best results. More detail = better output.
 *
 * ─── Tag Reference ────────────────────────────────────────────
 *
 * TrackType (most important — controls output category):
 *   TrackType: Music          → full instrumental tracks, ambient audio
 *   TrackType: Instrument     → isolated instrument / stem
 *   TrackType: SFX            → sound effects, samples
 *   TrackType: One-shot       → short single-hit sounds
 *
 * Optional tags (comma-separated, can combine):
 *   Genre: Funk, Genre: Jazz  → can specify multiple genres
 *   Instruments: Guitar, Saxophone, Bass, Piano
 *   VocalType: Instrumental   → tends to produce higher quality music
 *   BPM: 120                  → specify tempo for music
 *
 * ─── Prompt Templates by Mode ────────────────────────────────
 *
 * ▸ Music (POST /generate):
 *   "TrackType: Music, VocalType: Instrumental, Genre: Tech-House, Instruments: Synth, 128 BPM, euphoric building energy with gospel piano in the drop"
 *
 * ▸ Solo Instrument (POST /generate):
 *   "TrackType: Instrument, Genre: Jazz, Instruments: Saxophone, smooth and mellow, 90 BPM"
 *
 * ▸ SFX (POST /generate):
 *   "TrackType: SFX, heavy thunder rumble with rain on metal roof, cinematic, dark atmosphere"
 *   ⚠ Set short duration (1-5s) for most SFX
 *
 * ▸ One-shot (POST /generate):
 *   "TrackType: One-shot, single bass drop impact hit, deep and punchy"
 *
 * ▸ Audio-to-Audio (POST /transform):
 *   Prompt describes the TRANSFORMATION, not the original:
 *   "TrackType: Music, dark electronic bass heavy version with industrial synths"
 *   denoise controls intensity:
 *     0.3 = light (preserve melody, change timbre)
 *     0.6 = moderate (style transfer)
 *     1.0 = complete regeneration
 *
 * ▸ Inpainting (POST /inpaint):
 *   Prompt describes what the REGENERATED SEGMENT should sound like:
 *   "TrackType: Music, fast tempo jazz piano solo, energetic"
 *   ⚠ "Prompts work best when plausible given the surrounding context"
 *
 * ─── Best Practices ──────────────────────────────────────────
 *
 * 1. Always start with TrackType: — it's the single most impactful tag
 * 2. More detail = better output (genre, instruments, mood, energy, BPM)
 * 3. Set realistic duration — SFX should be short (1-5s), music can be longer
 * 4. For A2A/inpaint: init_noise_level/denoise is highly source-dependent, experiment
 * 5. Negative prompt: "low quality, distorted, noise" works well as default
 */
export const SA3_PROMPT_GUIDE = `
## Prompt Format

Always start with a TrackType tag, then add descriptive detail.

### Tags
  TrackType: Music | Instrument | SFX | One-shot
  Genre: <genre> (can specify multiple)
  Instruments: <list>
  VocalType: Instrumental
  BPM: <number>

### Examples by Endpoint

POST /generate (Text-to-Audio):
  Music:     "TrackType: Music, VocalType: Instrumental, Genre: Tech-House, 128 BPM, euphoric energy"
  Instrument:"TrackType: Instrument, Genre: Jazz, Instruments: Saxophone, smooth mellow, 90 BPM"
  SFX:       "TrackType: SFX, heavy thunder rumble with rain on metal roof, cinematic" (short duration!)
  One-shot:  "TrackType: One-shot, single bass drop impact, deep and punchy"

POST /transform (Audio-to-Audio):
  Describe the transformation:
  "TrackType: Music, dark electronic bass heavy version with industrial synths"
  denoise: 0.3=light timbre change, 0.6=style transfer, 1.0=full regen

POST /inpaint (Inpainting/Continuation):
  Describe the target segment:
  "TrackType: Music, fast jazz piano solo, energetic"
  Tip: prompts work best when plausible given surrounding context
`;

/** Build a recommended prompt from structured input (helper for callers) */
export function buildSa3Prompt(opts: {
  trackType: "Music" | "Instrument" | "SFX" | "One-shot";
  description: string;
  genre?: string;
  instruments?: string[];
  bpm?: number;
  vocalType?: string;
}): string {
  const parts: string[] = [`TrackType: ${opts.trackType}`];

  if (opts.vocalType) parts.push(`VocalType: ${opts.vocalType}`);
  if (opts.genre) parts.push(`Genre: ${opts.genre}`);
  if (opts.instruments?.length) parts.push(`Instruments: ${opts.instruments.join(", ")}`);
  if (opts.bpm) parts.push(`${opts.bpm} BPM`);

  parts.push(opts.description);

  return parts.join(", ");
}
